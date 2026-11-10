import { NextResponse, type NextRequest } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { normaliseId } from '@/lib/utils/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WINDOW_MS = 15 * 60 * 1000
const IP_LIMIT = 20
const ID_LIMIT = 5
const requests = new Map<string, { count: number; expiresAt: number }>()
const LOGIN_DIAGNOSTIC = 'login-diagnostic-v1'
const genericFailure = () => NextResponse.json(
  { success: false, error: 'Invalid ID or password' },
  { status: 401 },
)
const diagnosticFailure = (reason: string, status = 503) => NextResponse.json(
  { success: false, error: `Login service problem (${reason}). Check the app server logs and campus Supabase settings.`, diagnostic: LOGIN_DIAGNOSTIC },
  { status },
)

function consumeRateLimit(key: string, limit: number, now: number): boolean {
  const bucket = requests.get(key)
  if (bucket && bucket.expiresAt > now && bucket.count >= limit) {
    return true
  }
  if (!bucket || bucket.expiresAt <= now) {
    requests.set(key, { count: 1, expiresAt: now + WINDOW_MS })
  } else {
    bucket.count += 1
  }

  if (requests.size > 5000) {
    for (const [key, bucket] of requests) {
      if (bucket.expiresAt <= now) {
        requests.delete(key)
      }
    }
  }
  return false
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    throw new Error('Service client unavailable')
  }
  return createServiceClient<Database>(url, key, { auth: { persistSession: false } })
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json()
    if (typeof body !== 'object' || body === null) {
      return genericFailure()
    }
    const input = body as Record<string, unknown>
    if (typeof input.id !== 'string' || typeof input.password !== 'string' || (input.captchaToken !== undefined && typeof input.captchaToken !== 'string')) {
      return genericFailure()
    }

    const id = normaliseId(input.id)
    const password = input.password
    const captchaToken = typeof input.captchaToken === 'string' ? input.captchaToken : ''
    const ip = request.headers.get('x-real-ip')?.trim()
      || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown'
    if (!id || !password) {
      return genericFailure()
    }
    if (input.captchaToken !== undefined && !captchaToken) {
      return genericFailure()
    }
    if (consumeRateLimit(`ip:${ip}`, IP_LIMIT, Date.now())) {
      return diagnosticFailure('rate limit reached; restart the app server to clear local test limits', 429)
    }
    if (consumeRateLimit(`id:${id}`, ID_LIMIT, Date.now())) {
      console.error('[TEMP-DIAG] rate_limited')
      return diagnosticFailure('rate limit reached; restart the app server to clear local test limits', 429)
    }

    let service: ReturnType<typeof getServiceClient>
    try {
      service = getServiceClient()
    } catch {
      console.error('[login-with-id] Supabase URL or service role key is missing')
      return diagnosticFailure('server configuration is missing')
    }
    const [studentResult, facultyResult, adminResult] = await Promise.all([
      service.from('students').select('id, user_id').eq('student_id', id).maybeSingle()
        .overrideTypes<{ id: string; user_id: string | null }, { merge: false }>(),
      service.from('faculty').select('user_id, is_active').eq('faculty_id', id).maybeSingle()
        .overrideTypes<{ user_id: string | null; is_active: boolean }, { merge: false }>(),
      service.from('admins').select('user_id').eq('admin_id', id).maybeSingle()
        .overrideTypes<{ user_id: string | null }, { merge: false }>(),
    ])
    const lookupError = studentResult.error ?? facultyResult.error ?? adminResult.error
    if (lookupError) {
      console.error('[login-with-id] ID lookup failed', { code: lookupError.code, message: lookupError.message })
      return diagnosticFailure('account lookup failed; check schema, grants, and service key')
    }

    // `id` references profiles; `user_id` is the explicit Auth link and may
    // be the only populated key for imported student records.
    const userId = studentResult.data?.user_id ?? studentResult.data?.id
      ?? (facultyResult.data?.is_active ? facultyResult.data.user_id : null)
      ?? adminResult.data?.user_id
    let foundUser = Boolean(userId)
    let email: string | null = null

    if (userId) {
      const { data } = await service.from('profiles').select('email').eq('id', userId).maybeSingle()
      email = data?.email ?? null
      // Imported/legacy accounts may have an auth user and student row but
      // no profiles row. Auth email is sufficient for password verification;
      // downstream routing still requires a profile and will explain setup.
      if (!email) {
        const { data: authUser, error } = await service.auth.admin.getUserById(userId)
        if (error) {
          console.error('[login-with-id] auth user lookup failed', { message: error.message })
          return diagnosticFailure('Auth user lookup failed')
        }
        email = authUser.user?.email ?? null
      }
    } else if (/^\d{2}-\d{4}-\d{3}$/.test(id)) {
      let page = 1
      let match: Awaited<ReturnType<typeof service.auth.admin.getUserById>>['data']['user'] | null = null
      while (!match) {
        const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) {
          console.error('[login-with-id] auth user search failed', { message: error.message })
          return diagnosticFailure('Auth account search failed')
        }
        match = data.users.find((user) => {
        const studentId = (user.user_metadata as Record<string, unknown> | null)?.student_id
        return typeof studentId === 'string' && normaliseId(studentId) === id
        }) ?? null
        if (data.users.length < 1000) break
        page += 1
      }
      if (match?.id) {
        foundUser = true
        const { data: profile } = await service.from('profiles').select('email').eq('id', match.id).maybeSingle()
        email = profile?.email ?? match.email ?? null
      }
    }

    if (!email) {
      console.error(`[login-with-id] ${foundUser ? 'linked account has no Auth email' : 'ID was not found in account tables or Auth metadata'}`)
      return genericFailure()
    }
    const supabase = await createSessionClient()
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      ...(captchaToken ? { options: { captchaToken } } : {}),
    })
    if (error) {
      if (/captcha/i.test(error.message)) {
        console.error('[login-with-id] Supabase rejected CAPTCHA token', { message: error.message })
        return diagnosticFailure('Supabase CAPTCHA verification failed; test Turnstile keys may not be accepted by Supabase')
      } else {
        const safeMessage = error.message.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
        console.error(`[TEMP-DIAG] signin_error:${safeMessage}`)
      }
      return genericFailure()
    }

    return NextResponse.json({ success: true, diagnostic: LOGIN_DIAGNOSTIC })
  } catch {
    console.error('[login-with-id] unexpected login service error')
    return diagnosticFailure('unexpected server error')
  }
}
