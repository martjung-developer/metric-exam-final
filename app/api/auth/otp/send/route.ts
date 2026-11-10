import { randomInt } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

export const runtime = 'nodejs'

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
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null ||
      typeof (body as Record<string, unknown>).email !== 'string' ||
      typeof (body as Record<string, unknown>).captchaToken !== 'string') {
    return NextResponse.json({ error: 'Email and CAPTCHA are required.' }, { status: 400 })
  }

  const email = (body as { email: string }).email.trim().toLowerCase()
  const captchaToken = (body as { captchaToken: string }).captchaToken
  if (!/^[^\s@]+@lccbonline\.edu\.ph$/i.test(email)) {
    return NextResponse.json({ error: 'Please use your @lccbonline.edu.ph school email.' }, { status: 403 })
  }

  const captchaSecret = process.env.TURNSTILE_SECRET
  if (!captchaSecret) {
    console.error('[signup-otp/send] TURNSTILE_SECRET is not set.')
    return NextResponse.json({ error: 'Verification service is unavailable.' }, { status: 500 })
  }

  const captchaBody = new URLSearchParams({ secret: captchaSecret, response: captchaToken })
  let captchaResponse: Response
  try {
    captchaResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: captchaBody,
    })
  } catch {
    return NextResponse.json({ error: 'Could not verify CAPTCHA. Please try again.' }, { status: 502 })
  }
  const captchaResult = await captchaResponse.json() as { success?: boolean }
  if (!captchaResponse.ok || !captchaResult.success) {
    return NextResponse.json({ error: 'CAPTCHA verification failed. Please try again.' }, { status: 400 })
  }

  let supabase
  try {
    supabase = createServiceClient()
  } catch (error) {
    console.error('[signup-otp/send] Supabase configuration error:', error)
    return NextResponse.json({ error: 'Email verification is temporarily unavailable.' }, { status: 500 })
  }

  const now = new Date()
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  const { count, error: countError } = await supabase
    .from('signup_otps')
    .select('id', { count: 'exact', head: true })
    .eq('email', email)
    .gte('created_at', hourAgo)
  if (countError) {
    console.error('[signup-otp/send] Rate-limit query failed:', countError.message)
    return NextResponse.json({ error: 'Could not send a code right now.' }, { status: 500 })
  }
  if ((count ?? 0) >= 5) {
    return NextResponse.json({ error: 'Too many codes requested. Please try again later.' }, { status: 429 })
  }

  const { data: latest, error: latestError } = await supabase
    .from('signup_otps')
    .select('created_at')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestError) {
    console.error('[signup-otp/send] Cooldown query failed:', latestError.message)
    return NextResponse.json({ error: 'Could not send a code right now.' }, { status: 500 })
  }
  if (latest && now.getTime() - new Date(latest.created_at).getTime() < 60_000) {
    return NextResponse.json({ error: 'Please wait 60 seconds before requesting another code.' }, { status: 429 })
  }

  const smtpHost = process.env.SMTP_HOST
  const smtpPort = Number(process.env.SMTP_PORT ?? 587)
  const smtpUser = process.env.SMTP_USER
  const smtpPassword = process.env.SMTP_PASSWORD
  const smtpFrom = process.env.SMTP_FROM ?? process.env.RESEND_FROM_EMAIL ?? smtpUser
  if (!smtpHost || !smtpUser || !smtpPassword || !smtpFrom || !Number.isFinite(smtpPort)) {
    console.error('[signup-otp/send] SMTP configuration is incomplete.')
    return NextResponse.json({ error: 'Email delivery is temporarily unavailable.' }, { status: 500 })
  }

  const { error: invalidateError } = await supabase
    .from('signup_otps')
    .update({ consumed_at: now.toISOString() })
    .eq('email', email)
    .is('consumed_at', null)
  if (invalidateError) {
    console.error('[signup-otp/send] Could not invalidate prior codes:', invalidateError.message)
    return NextResponse.json({ error: 'Could not send a code right now.' }, { status: 500 })
  }

  const code = String(randomInt(100_000, 1_000_000))
  const { data: inserted, error: insertError } = await supabase
    .from('signup_otps')
    .insert({ email, code, expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString() })
    .select('id')
    .single()
  if (insertError || !inserted) {
    console.error('[signup-otp/send] Could not store code:', insertError?.message)
    return NextResponse.json({ error: 'Could not send a code right now.' }, { status: 500 })
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPassword },
    })
    await transporter.sendMail({
      from: smtpFrom,
      to: email,
      subject: 'Your M.E.T.R.I.C. verification code',
      text: `Your signup verification code is ${code}. It expires in 10 minutes.`,
      html: `<p>Your signup verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes.</p>`,
    })
  } catch (error) {
    console.error('[signup-otp/send] Email delivery failed:', error)
    await supabase.from('signup_otps').update({ consumed_at: new Date().toISOString() }).eq('id', inserted.id)
    return NextResponse.json({ error: 'Could not deliver the code. Please try again.' }, { status: 502 })
  }

  return NextResponse.json({ sent: true })
}
