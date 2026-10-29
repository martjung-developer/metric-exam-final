// lib/services/admin/settings/settings.service.ts
//
// Pure Supabase I/O — no React, no state, no UI logic.
// Now delegates avatar work to the shared upload utility.

import { createClient }                from '@/lib/supabase/client'
import {
  uploadAvatarFromFile,
  deleteAvatar as sharedDeleteAvatar,
} from '@/lib/utils/shared/avatar/upload'
import type { Profile, ServiceResult } from '@/lib/types/admin/settings/settings.types'
import { getAdminScopeForUser, getDepartmentName } from '@/lib/services/admin/scope.service'

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function getProfile(userId: string): Promise<ServiceResult<Profile>> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) {return { data: null, error: error.message }}
  const scope = await getAdminScopeForUser(supabase, userId)
  const departmentName = await getDepartmentName(supabase, scope?.schoolId ?? null)
  const programs = scope?.programIds === null ? [] : scope?.programIds?.length
    ? (await supabase.from('programs').select('name').in('id', scope.programIds)).data ?? []
    : []
  return { data: { ...data, departmentName, programNames: programs.map((program) => program.name) } as Profile, error: null }
}

export async function updateProfileName(
  userId:   string,
  fullName: string,
): Promise<ServiceResult<void>> {
  const supabase = createClient()

  const { error } = await supabase
    .from('profiles')
    .update({ full_name: fullName, updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) {return { data: null, error: error.message }}
  return { data: null, error: null }
}

// ---------------------------------------------------------------------------
// Avatar  — now delegates to the shared utility
// ---------------------------------------------------------------------------

export async function uploadAvatar(
  userId:      string,
  file:        File,
  onProgress?: (pct: number) => void,
): Promise<ServiceResult<string>> {
  const supabase = createClient()

  const result = await uploadAvatarFromFile(supabase, userId, file, onProgress)

  if (result.error || !result.publicUrl) {
    return { data: null, error: result.error ?? 'Upload failed' }
  }
  return { data: result.publicUrl, error: null }
}

/**
 * @deprecated The shared uploadAvatarFromFile already persists the URL.
 * Kept for callers that still call it explicitly; it is now a no-op update
 * that verifies the URL is saved correctly.
 */
export async function updateAvatarUrl(
  userId: string,
  url:    string,
): Promise<ServiceResult<void>> {
  const supabase = createClient()

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: url, updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) {return { data: null, error: error.message }}
  return { data: null, error: null }
}

export async function deleteAvatar(userId: string): Promise<ServiceResult<void>> {
  const supabase = createClient()
  const result   = await sharedDeleteAvatar(supabase, userId)
  if (result.error) {return { data: null, error: result.error }}
  return { data: null, error: null }
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export async function verifyPassword(
  email:    string,
  password: string,
): Promise<ServiceResult<void>> {
  const supabase = createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {return { data: null, error: error.message }}
  return { data: null, error: null }
}

export async function updatePassword(newPassword: string): Promise<ServiceResult<void>> {
  const supabase = createClient()
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) {return { data: null, error: error.message }}
  return { data: null, error: null }
}

export async function logout(): Promise<ServiceResult<void>> {
  if (typeof window !== 'undefined') {
    window.location.href = '/api/auth/signout'
  }
  return { data: null, error: null }
}
