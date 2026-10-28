import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createSupabaseClient, type User } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'
import type { NextRequest } from 'next/server'
import { isAllowedEmail, ALLOWED_EMAIL_ERROR } from '@/lib/utils/auth'

type StudentInsert = Database['public']['Tables']['students']['Insert']
type ProfileInsert = Database['public']['Tables']['profiles']['Insert']

type CreateProfileBody = {
  userId?: string
  userEmail: string
  password?: string
  studentId: string
  fullName: string
  programId: string
  programCode?: string
  schoolId?: string | null
  yearLevel: number
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 })
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>).userEmail !== 'string' ||
    ((body as Record<string, unknown>).userId !== undefined && typeof (body as Record<string, unknown>).userId !== 'string') ||
    (!(body as Record<string, unknown>).userId && typeof (body as Record<string, unknown>).password !== 'string') ||
    typeof (body as Record<string, unknown>).studentId !== 'string' ||
    typeof (body as Record<string, unknown>).fullName !== 'string' ||
    typeof (body as Record<string, unknown>).programId !== 'string' ||
    typeof (body as Record<string, unknown>).yearLevel !== 'number'
  ) {
    return NextResponse.json(
      { success: false, error: 'Missing or invalid required fields.' },
      { status: 422 },
    )
  }

  const {
    userId: requestedUserId,
    password,
    studentId,
    fullName,
    programId,
    schoolId,
    yearLevel,
  } = body as CreateProfileBody

  const submittedEmail = (body as CreateProfileBody).userEmail
  if (!submittedEmail || !isAllowedEmail(submittedEmail)) {
    return NextResponse.json({ success: false, error: ALLOWED_EMAIL_ERROR }, { status: 403 })
  }

  if (!Number.isInteger(yearLevel) || yearLevel < 1 || yearLevel > 5) {
    return NextResponse.json(
      { success: false, error: 'Invalid year level.' },
      { status: 422 },
    )
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  if (!serviceKey) {
    console.error('[create-profile] SUPABASE_SERVICE_ROLE_KEY is not set.')
    return NextResponse.json(
      { success: false, error: 'Server configuration error.' },
      { status: 500 },
    )
  }

  const cookieStore = await cookies()
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '',
    serviceKey,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    },
  )

  const otpSupabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '',
    serviceKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const otpCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString()
  const { data: consumedOtp, error: otpError } = await otpSupabase
    .from('signup_otps')
    .select('id')
    .eq('email', submittedEmail.trim().toLowerCase())
    .not('consumed_at', 'is', null)
    .gte('consumed_at', otpCutoff)
    .order('consumed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (otpError || !consumedOtp) {
    if (otpError) { console.error('[create-profile] signup OTP lookup failed:', otpError.message) }
    return NextResponse.json({ success: false, error: 'Verify your email before completing signup.' }, { status: 403 })
  }

  const { data: programRow, error: programErr } = await supabase
    .from('programs')
    .select('id, school_id')
    .eq('id', programId)
    .maybeSingle()

  if (programErr || !programRow?.id) {
    return NextResponse.json(
      { success: false, error: 'Selected program is invalid.' },
      { status: 422 },
    )
  }

  let authUser: User
  if (requestedUserId) {
    const { data: authUserData, error: authUserErr } = await supabase.auth.admin.getUserById(requestedUserId)
    if (authUserErr || !authUserData.user) {
      console.error('[create-profile] getUserById error:', authUserErr?.message)
      return NextResponse.json({ success: false, error: 'Could not fetch user.' }, { status: 500 })
    }
    authUser = authUserData.user
  } else {
    if (!password || password.length < 8) {
      return NextResponse.json({ success: false, error: 'Password must be at least 8 characters.' }, { status: 422 })
    }
    const { data: createdUserData, error: createUserError } = await supabase.auth.admin.createUser({
      email: submittedEmail.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName.trim(), role: 'student' },
    })
    if (createUserError || !createdUserData.user) {
      if (createUserError) { console.error('[create-profile] auth user creation failed:', createUserError.message) }
      return NextResponse.json({ success: false, error: 'Unable to create your account. Please try again.' }, { status: 400 })
    }
    authUser = createdUserData.user
  }

  const userId = authUser.id
  if (!authUser.email || !isAllowedEmail(authUser.email) ||
      authUser.email.trim().toLowerCase() !== submittedEmail.trim().toLowerCase()) {
    return NextResponse.json({ success: false, error: ALLOWED_EMAIL_ERROR }, { status: 403 })
  }

  if (!authUser.email_confirmed_at) {
    const { error: confirmError } = await supabase.auth.admin.updateUserById(userId, { email_confirm: true })
    if (confirmError) {
      console.error('[create-profile] email confirmation update failed:', confirmError.message)
      return NextResponse.json({ success: false, error: 'Account verification failed. Please try again.' }, { status: 500 })
    }
  }

  const profileInsert: ProfileInsert = {
    id: userId,
    email: authUser.email,
    full_name: fullName.trim(),
    role: 'student',
  }

  try {
    const { data: existingProfile, error: profileCheckErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle()

    if (profileCheckErr) { throw profileCheckErr }

    if (!existingProfile) {
      const { error: profileInsertErr } = await supabase
        .from('profiles')
        .insert(profileInsert)

      if (profileInsertErr) { throw profileInsertErr }
    }
  } catch (profileErr) {
    const err = profileErr as { code?: string; message?: string }
    console.error('[create-profile] profile insert error:', err.code, err.message)
    return NextResponse.json(
      { success: false, error: err.message ?? 'Profile setup failed.' },
      { status: 500 },
    )
  }

  const studentInsert: StudentInsert = {
    id: userId,
    user_id: userId,
    student_id: studentId,
    year_level: Number(yearLevel),
    program_id: programRow.id,
    school_id: schoolId ?? programRow.school_id ?? null,
  }

  try {
    const { error: insertErr } = await supabase
      .from('students')
      .insert(studentInsert)

    if (insertErr) { throw insertErr }
  } catch (studentErr) {
    const err = studentErr as { code?: string; message?: string }
    console.error('[create-profile] students upsert error:', err.code, err.message)
    return NextResponse.json(
      { success: false, error: 'Account created but profile setup failed. Please contact support.' },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}
