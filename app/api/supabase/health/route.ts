import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { connected: false, message: 'Supabase URL or publishable key is not configured.' },
      { status: 503 },
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, '')}/auth/v1/health`,
      {
        headers: { apikey: supabaseKey },
        signal: controller.signal,
        cache: 'no-store',
      },
    )

    if (!response.ok) {
      return NextResponse.json(
        { connected: false, message: `Supabase responded with HTTP ${response.status}.` },
        { status: 503 },
      )
    }

    return NextResponse.json({ connected: true, message: 'Supabase connection successful.' })
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'Supabase connection timed out.'
      : 'Could not reach Supabase from the Next.js server.'

    return NextResponse.json(
      { connected: false, message },
      { status: 503 },
    )
  } finally {
    clearTimeout(timeout)
  }
}
