// web/app/api/admin/approvals/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchPendingReviewItems } from '@/lib/services/approval/approval.service'
import type { ApprovalStatus, PendingReviewItem } from '@/lib/types/approval'
import { resolveAdminScope, getScopedExamIds, getScopedPrograms, getScopedQuestionBankIds } from '@/lib/services/admin/scope.service'

type ApprovalListMode = 'pending' | 'all'

type ApprovalExamRow = {
  id: string
  title: string
  submitted_by: string | null
  submitted_at: string | null
  approval_status: ApprovalStatus
  review_notes: string | null
  programs: { code: string | null; name: string | null } | { code: string | null; name: string | null }[] | null
  profiles: { full_name: string | null } | { full_name: string | null }[] | null
}

export async function GET(req: Request): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'admin' && profile.role !== 'faculty')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const scope = await resolveAdminScope(supabase, user.id)
  if (!scope) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (profile.role === 'faculty' && scope.programIds?.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const scopedExamIds = await getScopedExamIds(supabase, scope)
  const scopedPrograms = await getScopedPrograms(supabase, scope)
  const scopedProgramIds = scope.programIds === null ? null : scopedPrograms.map((program) => program.id)
  const scopedBankIds = await getScopedQuestionBankIds(supabase, scope)

  const mode = (new URL(req.url).searchParams.get('mode') ?? 'pending') as ApprovalListMode

  try {
    if (mode !== 'all') {
    const items = await fetchPendingReviewItems(supabase, scopedProgramIds, scopedExamIds, scopedBankIds)
      return NextResponse.json({ items })
    }

    let query = supabase
      .from('exams')
      .select('id,title,program_id,submitted_at,approval_status,review_notes,submitted_by, programs(code,name), profiles!exams_submitted_by_fkey(full_name)')
      .in('approval_status', ['pending_review', 'approved', 'rejected', 'published'])

    if (scope.programIds !== null) query = query.in('id', scopedExamIds)

    const { data: exams, error } = await query
      .order('submitted_at', { ascending: false })

    if (error) {
      throw new Error(error.message)
    }

    const examItems: PendingReviewItem[] = ((exams ?? []) as ApprovalExamRow[]).map((row) => {
      const program = Array.isArray(row.programs) ? row.programs[0] : row.programs
      const submitter = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
      return {
        id: row.id,
        entityType: 'exam',
        title: row.title,
        submittedBy: row.submitted_by,
        submittedAt: row.submitted_at,
        programCode: program?.code ?? null,
        status: row.approval_status as ApprovalStatus,
        reviewNotes: row.review_notes,
        submittedByName: submitter?.full_name ?? null,
        programName: program?.name ?? null,
      }
    })

    let bankQuery = supabase.from('question_banks').select('id,title,program_id,submitted_at,approval_status,review_notes,submitted_by, programs(code,name), profiles!question_banks_submitted_by_fkey(full_name)').in('approval_status', ['pending_review', 'approved', 'rejected', 'published'])
    if (scope.programIds !== null) bankQuery = bankQuery.in('id', scopedBankIds)
    const { data: banks, error: bankError } = await bankQuery.order('submitted_at', { ascending: false })
    if (bankError) throw new Error(bankError.message)
    const bankItems = ((banks ?? []) as ApprovalExamRow[]).map((row): PendingReviewItem => {
      const program = Array.isArray(row.programs) ? row.programs[0] : row.programs
      const submitter = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
      return { id: row.id, entityType: 'question_bank', title: row.title, submittedBy: row.submitted_by, submittedAt: row.submitted_at, programCode: program?.code ?? null, programName: program?.name ?? null, status: row.approval_status, reviewNotes: row.review_notes, submittedByName: submitter?.full_name ?? null }
    })
    return NextResponse.json({ items: [...examItems, ...bankItems] })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load approvals.' },
      { status: 500 },
    )
  }
}
