// lib/services/auth/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Client-side auth service layer.
//
// signInWithId flow:
//   1. POST /api/auth/resolve-user-by-id  → get email from ID
//   2. supabase.auth.signInWithPassword   → create session
//   3. profiles.role                      → canonical role
//   4. getDashboardByRole                 → redirect path
//
// signUpStudent flow:
//   1. supabase.auth.signUp               → create auth user
//   2. POST /api/auth/create-profile      → insert students row (service role)
//
// Social auth delegates entirely to Supabase OAuth.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient }       from '@/lib/supabase/client'
import { normaliseId, isAllowedEmail, ALLOWED_EMAIL_ERROR } from '@/lib/utils/auth'
import { getDashboardByRole } from '@/lib/auth/routing'
type AuthResult = {
  success: boolean
  error?: string
  redirectTo?: string
  emailConfirmationRequired?: boolean
  userId?: string
}

type ResolveUserResult = {
  found: boolean
  email?: string
  error?: string
}

type YearLevel = number | string
import type { Database } from '@/lib/types/database'

type ProfileRow = Database['public']['Tables']['profiles']['Row']
type SignupProgram = Pick<
  Database['public']['Tables']['programs']['Row'],
  'id' | 'code' | 'name' | 'full_name' | 'major' | 'years' | 'school_id'
>

// ── resolveUserById ───────────────────────────────────────────────────────────

export async function resolveUserById(rawId: string): Promise<ResolveUserResult> {
  try {
    const res = await fetch('/api/auth/resolve-user-by-id', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: normaliseId(rawId) }),
    })

    const payload = (await res.json()) as ResolveUserResult
    if (!res.ok) {
      return { found: false, error: payload.error ?? `Server error: ${res.status}` }
    }

    return payload
  } catch {
    return { found: false, error: 'Network error. Please try again.' }
  }
}

// ── signInWithId ──────────────────────────────────────────────────────────────

export async function signInWithId(
  rawId:    string,
  password: string,
  captchaToken?: string,
): Promise<AuthResult> {
  const normalizedId = normaliseId(rawId)
  const resolved     = await resolveUserById(normalizedId)

  if (!resolved.found || !resolved.email) {
    return { success: false, error: resolved.error ?? 'ID not found.' }
  }

  const supabase = createClient()

  const { data, error } = await supabase.auth.signInWithPassword({
    email:    resolved.email,
    password,
    options: { captchaToken },
  })

  if (error || !data.user) {
    const msg = error?.message ?? ''
    return {
      success: false,
      error: msg.toLowerCase().includes('invalid login credentials')
        ? 'Incorrect password.'
        : (msg || 'Sign-in failed.'),
    }
  }

  // Single minimal query — no select("*")
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single() as { data: Pick<ProfileRow, 'role'> | null; error: unknown }

  if (profileError || !profile) {
    return { success: false, error: 'Could not resolve your account role.' }
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !sessionData.session) {
    return { success: false, error: 'Could not confirm your session. Please try again.' }
  }

  return { success: true, redirectTo: getDashboardByRole(profile.role) }
}

// ── signUpStudent ─────────────────────────────────────────────────────────────

export async function signUpStudent(
  studentId:   string,
  fullName:    string,
  email:       string,
  password:    string,
  program:     SignupProgram,
  yearLevel:   YearLevel,
  phone?:      string,
): Promise<AuthResult> {
  if (!isAllowedEmail(email)) { return { success: false, error: ALLOWED_EMAIL_ERROR } }
  try {
    const response = await fetch('/api/auth/create-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userEmail: email.trim().toLowerCase(),
        password,
        studentId: normaliseId(studentId),
        fullName: fullName.trim(),
        programId: program.id,
        programCode: program.code,
        schoolId: program.school_id,
        yearLevel: Number(yearLevel),
        phone: phone?.trim() ?? '',
      }),
    })
    const result = await response.json() as { userId?: string; error?: string }
    if (!response.ok || !result.userId) {
      return { success: false, error: result.error ?? 'Unable to create your account. Please try again.' }
    }
    return { success: true, userId: result.userId }
  } catch {
    return { success: false, error: 'Unable to create your account. Please try again.' }
  }
}

// ── signOut ───────────────────────────────────────────────────────────────────

export async function signOut(): Promise<void> {
  if (typeof window !== 'undefined') {
    window.location.href = '/api/auth/signout'
  }
}

// ── sendOtp ───────────────────────────────────────────────────────────────────

export async function sendOtp(email: string, captchaToken?: string): Promise<AuthResult> {
  const supabase = createClient()
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { captchaToken },
  })
  if (error) {
    return { success: false, error: error.message }
  }
  return { success: true }
}

// ── verifyOtp ─────────────────────────────────────────────────────────────────

export async function verifyOtp(email: string, token: string): Promise<AuthResult & { accessToken?: string; userId?: string }> {
  const supabase = createClient()
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'signup',
  })
  if (error) {
    return { success: false, error: error.message }
  }
  return { success: true, accessToken: data.session?.access_token, userId: data.user?.id }
}

export async function sendSignupOtp(email: string, captchaToken: string): Promise<AuthResult> {
  try {
    const response = await fetch('/api/auth/otp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, captchaToken }),
    })
    const payload = await response.json() as { error?: string }
    return response.ok ? { success: true } : { success: false, error: payload.error ?? 'Could not send a code.' }
  } catch {
    return { success: false, error: 'Could not send a code. Please try again.' }
  }
}

export async function verifySignupOtp(email: string, code: string): Promise<AuthResult & { verified?: boolean }> {
  try {
    const response = await fetch('/api/auth/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    })
    const payload = await response.json() as { verified?: boolean; error?: string }
    return response.ok && payload.verified
      ? { success: true, verified: true }
      : { success: false, verified: false, error: payload.error ?? 'That code is invalid or expired.' }
  } catch {
    return { success: false, verified: false, error: 'Could not verify the code. Please try again.' }
  }
}

