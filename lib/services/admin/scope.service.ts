import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'

type DB = SupabaseClient<Database>

export interface AdminScope {
  role: 'admin' | 'faculty'
  schoolId: string | null
  programIds: string[] | null
  programCodes: string[] | null
}

export async function getDepartmentName(client: DB, schoolId: string | null): Promise<string | null> {
  if (!schoolId) return null
  const { data } = await client.from('schools').select('name').eq('id', schoolId).maybeSingle()
  return data?.name ?? null
}

export async function getScopedRecipientIds(client: DB, scope: AdminScope): Promise<Set<string>> {
  const students = await readRows<{ id: string; user_id: string | null; program_id: string | null }>(client, 'students', 'id,user_id,program_id')
  const faculty = await readRows<{ user_id: string | null; program_id: string | null; id: string; school_id: string | null }>(client, 'faculty', 'user_id,program_id,id,school_id')
  const mappings = await readRows<{ faculty_id: string; program_id: string; is_program_head: boolean }>(client, 'faculty_programs', 'faculty_id,program_id,is_program_head')
  const admins = await readRows<{ user_id: string | null; school_id: string | null }>(client, 'admins', 'user_id,school_id')
  const allowed = scope.programIds === null ? null : new Set(scope.programIds)
  const ids = new Set<string>()
  for (const row of students) if (allowed === null || (row.program_id !== null && allowed.has(row.program_id))) {
    if (row.id) ids.add(row.id)
    if (row.user_id) ids.add(row.user_id)
  }
  for (const row of faculty) {
    const headPrograms = mappings.filter((m) => m.faculty_id === row.id && m.is_program_head).map((m) => m.program_id)
    const matches = allowed === null || (row.program_id !== null && allowed.has(row.program_id)) || headPrograms.some((id) => allowed.has(id))
    if (matches && row.user_id) ids.add(row.user_id)
  }
  for (const row of admins) if (row.user_id && (scope.schoolId === null ? scope.role === 'admin' : row.school_id === scope.schoolId)) ids.add(row.user_id)
  return ids
}

export async function getScopedPrograms(client: DB, scope: AdminScope): Promise<Array<{ id: string; code: string; name: string }>> {
  if (scope.programIds === null) {
    const { data } = await client.from('programs').select('id,code,name')
    return data ?? []
  }
  if (!scope.programIds.length) return []
  const { data } = await client.from('programs').select('id,code,name').in('id', scope.programIds)
  return data ?? []
}

async function readRows<T>(client: DB, table: string, select: string, filters: Array<[string, string]> = []): Promise<T[]> {
  let query = (client.from(table as never) as unknown as { select: (columns: string) => any }).select(select)
  for (const [column, value] of filters) query = query.eq(column, value)
  const { data } = await query
  return (data ?? []) as T[]
}

export async function getAdminScopeForUser(client: DB, userId: string): Promise<AdminScope | null> {
  const profileRows = await readRows<{ role: 'admin' | 'faculty' }>(client, 'profiles', 'role', [['id', userId]])
  const role = profileRows[0]?.role
  if (role !== 'admin' && role !== 'faculty') return null
  if (role === 'admin') {
    const rows = await readRows<{ school_id: string | null }>(client, 'admins', 'school_id', [['user_id', userId]])
    const schoolId = rows[0]?.school_id ?? null
    if (!schoolId) return { role, schoolId: null, programIds: null, programCodes: null }
    const programs = (await client.from('programs').select('id,code').eq('school_id', schoolId)).data ?? []
    return { role, schoolId, programIds: programs.map((p) => p.id), programCodes: programs.map((p) => p.code) }
  }
  const facultyRows = await readRows<{ id: string; school_id: string | null; program_id: string | null; is_program_head: boolean }>(client, 'faculty', 'id,school_id,program_id,is_program_head', [['user_id', userId]])
  const faculty = facultyRows[0]
  if (!faculty) return null
  const mapped = await readRows<{ program_id: string; is_program_head: boolean }>(client, 'faculty_programs', 'program_id,is_program_head', [['faculty_id', faculty.id]])
  const programIds = [...new Set([...(faculty.is_program_head ? mapped.map((row) => row.program_id) : mapped.filter((row) => row.is_program_head).map((row) => row.program_id)), ...(faculty.program_id ? [faculty.program_id] : [])])]
  const programs = programIds.length ? (await client.from('programs').select('id,code').in('id', programIds)).data ?? [] : []
  return { role, schoolId: faculty.school_id, programIds, programCodes: programs.map((p) => p.code) }
}

export async function resolveAdminScope(client: DB, userId?: string): Promise<AdminScope | null> {
  let id = userId
  if (!id) {
    const { data } = await client.auth.getUser()
    id = data.user?.id
  }
  if (!id) return null

  return getAdminScopeForUser(client, id)
}

export function examMatchesScope(
  exam: { program_id: string | null; allowed_programs: string[] | null; program: string | null },
  scope: AdminScope,
): boolean {
  if (scope.programIds === null) return true
  const ids = scope.programIds
  const codes = scope.programCodes ?? []
  if (exam.program_id && ids.includes(exam.program_id)) return true
  if (exam.allowed_programs?.length) return exam.allowed_programs.some((v) => ids.includes(v) || codes.includes(v))
  return exam.program_id === null && exam.allowed_programs === null && Boolean(exam.program && codes.includes(exam.program))
}

export async function isExamInScope(client: DB, examId: string, scope: AdminScope): Promise<boolean> {
  const { data } = await client.from('exams').select('program_id,allowed_programs,program').eq('id', examId).maybeSingle()
  return Boolean(data && examMatchesScope(data, scope))
}

export async function getScopedExamIds(client: DB, scope: AdminScope): Promise<string[]> {
  const query = client.from('exams').select('id,program_id,allowed_programs,program')
  if (scope.programIds !== null) {
    const { data: rows } = await query
    return (rows ?? []).filter((row) => examMatchesScope(row, scope)).map((row) => row.id)
  }
  const { data: rows } = await query
  return (rows ?? []).map((row) => row.id)
}

export async function getScopedQuestionBankIds(client: DB, scope: AdminScope): Promise<string[]> {
  const query = (client.from('question_banks' as never) as unknown as { select: (columns: string) => any }).select('id,program_id')
  const { data } = await query
  const rows = (data ?? []) as Array<{ id: string; program_id: string | null }>
  return scope.programIds === null ? rows.map((row) => row.id) : rows.filter((row) => row.program_id !== null && scope.programIds?.includes(row.program_id)).map((row) => row.id)
}
