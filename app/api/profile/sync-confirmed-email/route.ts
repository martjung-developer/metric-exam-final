import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { isAllowedEmail, ALLOWED_EMAIL_ERROR } from '@/lib/utils/auth'
import type { Database } from '@/lib/types/database'

export async function POST(req: Request): Promise<NextResponse> {
  const sessionClient = await createSessionClient()
  const { data: auth, error: authError } = await sessionClient.auth.getUser()
  const user = auth.user
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const body = await req.json().catch(() => null) as { email?: unknown } | null
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !isAllowedEmail(email)) {
    return NextResponse.json({ error: ALLOWED_EMAIL_ERROR }, { status: 400 })
  }
  if (!user.email_confirmed_at || user.email?.trim().toLowerCase() !== email) {
    return NextResponse.json({ error: 'Confirm the new email address before syncing it.' }, { status: 403 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    return NextResponse.json({ error: 'Email sync is unavailable.' }, { status: 500 })
  }

  const serviceClient = createServiceClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('role,email')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !profile || (profile.role !== 'admin' && profile.role !== 'faculty')) {
    return NextResponse.json({ error: 'Profile not found.' }, { status: 404 })
  }
  const table = profile.role === 'admin' ? 'admins' : 'faculty'
  const { error: staffError } = await serviceClient
    .from(table)
    .update({ email })
    .eq('user_id', user.id)
  if (staffError) {
    return NextResponse.json({ error: staffError.message }, { status: 500 })
  }

  if (profile.email.trim().toLowerCase() !== email) {
    const { error: updateProfileError } = await serviceClient
      .from('profiles')
      .update({ email, updated_at: new Date().toISOString() })
      .eq('id', user.id)
    if (updateProfileError) {
      return NextResponse.json({ error: updateProfileError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}
