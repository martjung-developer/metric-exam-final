import { NextResponse, type NextRequest } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { normaliseId } from '@/lib/utils/auth'

export const runtime = 'nodejs'

const WINDOW_MS = 15 * 60 * 1000
const IP_LIMIT = 20
const ID_LIMIT = 5
const requests = new Map<string, { count: number; expiresAt: number }>()
const genericFailure = () => NextResponse.json(
  { success: false, error: 'Invalid ID or password' },
  { status: 401 },
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

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET
  if (!secret) {
    return false
  }
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    })
    const result = await response.json() as { success?: boolean }
    return response.ok && result.success === true
  } catch {
    return false
  }
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
    if (typeof input.id !== 'string' || typeof input.password !== 'string' || typeof input.captchaToken !== 'string') {
      return genericFailure()
    }

    const id = normaliseId(input.id)
    const password = input.password
    const captchaToken = input.captchaToken
    const ip = request.headers.get('x-real-ip')?.trim()
      || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown'
    if (!id || !password || !captchaToken || consumeRateLimit(`ip:${ip}`, IP_LIMIT, Date.now())) {
      return genericFailure()
    }
    if (!await verifyTurnstile(captchaToken, ip)) {
      return genericFailure()
    }
    if (consumeRateLimit(`id:${id}`, ID_LIMIT, Date.now())) {
      return genericFailure()
    }

    const service = getServiceClient()
    const [studentResult, facultyResult, adminResult] = await Promise.all([
      service.from('students').select('id').eq('student_id', id).maybeSingle()
        .overrideTypes<{ id: string }, { merge: false }>(),
      service.from('faculty').select('user_id, is_active').eq('faculty_id', id).maybeSingle()
        .overrideTypes<{ user_id: string | null; is_active: boolean }, { merge: false }>(),
      service.from('admins').select('user_id').eq('admin_id', id).maybeSingle()
        .overrideTypes<{ user_id: string | null }, { merge: false }>(),
    ])

    const userId = studentResult.data?.id
      ?? (facultyResult.data?.is_active ? facultyResult.data.user_id : null)
      ?? adminResult.data?.user_id
    let email: string | null = null

    if (userId) {
      const { data } = await service.from('profiles').select('email').eq('id', userId).single()
      email = data?.email ?? null
    } else if (/^\d{2}-\d{4}-\d{3}$/.test(id)) {
      const { data } = await service.auth.admin.listUsers()
      const match = data.users.find((user) => {
        const studentId = (user.user_metadata as Record<string, unknown> | null)?.student_id
        return typeof studentId === 'string' && normaliseId(studentId) === id
      })
      if (match?.id) {
        const { data: profile } = await service.from('profiles').select('email').eq('id', match.id).single()
        email = profile?.email ?? null
      }
    }

    if (!email) {
      return genericFailure()
    }
    const supabase = await createSessionClient()
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken },
    })
    if (error) {
      return genericFailure()
    }

    return NextResponse.json({ success: true })
  } catch {
    return genericFailure()
  }
}
