import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

type SupabaseDiagnostic = {
  message?: string
  code?: string
  status?: number
  details?: string
  hint?: string
}

function logSupabaseError(context: string, error: unknown) {
  const diagnostic = error as SupabaseDiagnostic
  console.error(`[signup-otp/verify] ${context}`, {
    message: diagnostic?.message ?? String(error),
    code: diagnostic?.code ?? null,
    status: diagnostic?.status ?? null,
    details: diagnostic?.details ?? null,
    hint: diagnostic?.hint ?? null,
  })
}

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  if (!url || !key) { throw new Error('Supabase service configuration is missing.') }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ verified: false, error: 'Invalid request.' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null ||
      typeof (body as Record<string, unknown>).email !== 'string' ||
      typeof (body as Record<string, unknown>).code !== 'string') {
    return NextResponse.json({ verified: false, error: 'Email and code are required.' }, { status: 400 })
  }
  const email = (body as { email: string }).email.trim().toLowerCase()
  const code = (body as { code: string }).code.trim()
  if (!/^[^\s@]+@lccbonline\.edu\.ph$/i.test(email) || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ verified: false, error: 'That code is invalid or expired.' }, { status: 400 })
  }

  let supabase
  try {
    supabase = createServiceClient()
  } catch (error) {
    logSupabaseError('Supabase configuration failed', error)
    return NextResponse.json({ verified: false, error: 'Verification is temporarily unavailable.' }, { status: 500 })
  }

  const { data: otp, error } = await supabase
    .from('signup_otps')
    .select('id, code, attempts')
    .eq('email', email)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    logSupabaseError('code lookup failed', error)
    return NextResponse.json({ verified: false, error: 'Verification is temporarily unavailable.' }, { status: 500 })
  }
  if (!otp) { return NextResponse.json({ verified: false, error: 'That code is invalid or expired.' }, { status: 400 }) }
  if (otp.attempts >= 5) {
    return NextResponse.json({ verified: false, error: 'Too many attempts. Request a new code.' }, { status: 429 })
  }

  if (otp.code !== code) {
    const { error: attemptError } = await supabase
      .from('signup_otps')
      .update({ attempts: otp.attempts + 1 })
      .eq('id', otp.id)
      .is('consumed_at', null)
    if (attemptError) { logSupabaseError('failed-attempt update failed', attemptError) }
    return NextResponse.json({ verified: false, error: otp.attempts + 1 >= 5
      ? 'Too many attempts. Request a new code.'
      : 'That code is invalid or expired.' }, { status: otp.attempts + 1 >= 5 ? 429 : 400 })
  }

  const { data: consumed, error: consumeError } = await supabase
    .from('signup_otps')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', otp.id)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle()
  if (consumeError || !consumed) {
    if (consumeError) { logSupabaseError('code consumption failed', consumeError) }
    return NextResponse.json({ verified: false, error: 'That code is invalid or expired.' }, { status: 400 })
  }

  return NextResponse.json({ verified: true })
}
