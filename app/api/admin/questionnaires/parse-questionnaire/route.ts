import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseCsvText, parsePdfTextToRows } from '@/lib/utils/admin/questionnaires/questionnaires.parsers'
import type { ImportRow } from '@/lib/types/admin/questionnaires/questionnaires-types'

export const runtime = 'nodejs'

const MAX_BYTES = 10 * 1024 * 1024
const MAX_REQUEST_BYTES = MAX_BYTES + 64 * 1024
const TYPE_ERROR = 'Unsupported file type. Please upload a CSV, DOCX, or PDF file.'
const SIZE_ERROR = 'File is too large. The maximum size is 10 MB.'
const DOCX_ERROR = 'Could not read DOCX structure. Please check the file and try again.'
const PDF_ERROR = 'Could not read PDF text. Please upload a text-based PDF or DOCX.'
const NO_QUESTIONS_ERROR = 'No questions found in this file.'
const SCANNED_PDF_ERROR = 'This PDF looks scanned. Please upload a text-based PDF or DOCX.'

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
}

async function parseWithPython(bytes: Uint8Array, extension: '.docx' | '.pdf'): Promise<{ rows: ImportRow[]; text?: string }> {
  const endpoint = new URL(process.env.QUESTIONNAIRE_PARSER_URL ?? 'http://127.0.0.1:8765/parse')
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) {
    throw new Error('Parser service must use loopback HTTP.')
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Extension': extension },
    body: Buffer.from(bytes),
    signal: AbortSignal.timeout(45_000),
  })
  if (!response.ok) { throw new Error('Python parser rejected the upload.') }
  const result = await response.json() as { rows?: ImportRow[]; text?: string }
  return { rows: Array.isArray(result.rows) ? result.rows : [], text: result.text }
}

function normalizePythonRows(rows: ImportRow[]): ImportRow[] {
  return rows.map((row, index) => {
    const isTrueFalse = [row.option_a, row.option_b].some(Boolean) &&
      /^true$/i.test(row.option_a.trim()) && /^false$/i.test(row.option_b.trim())
    return {
      _rowIndex: index + 1,
      _valid: false,
      _errors: row._errors ?? [],
      _warnings: visualReferenceWarnings(row.question_text),
      question_text: row.question_text ?? '',
      question_type: isTrueFalse ? 'true_false' : row.question_type ?? 'multiple_choice',
      points: row.points ?? 1,
      difficulty: row.difficulty ?? 'medium',
      option_a: row.option_a ?? '',
      option_b: row.option_b ?? '',
      option_c: row.option_c ?? '',
      option_d: row.option_d ?? '',
      correct_answer: row.correct_answer ?? '',
      explanation: row.explanation ?? '',
      scenario: row.scenario ?? '',
      image: row.image ?? '',
      exam_id: '',
      program_id: '',
    }
  })
}

function visualReferenceWarnings(questionText: string): string[] {
  return /\b(?:image|figure|diagram|chart|illustration|picture)\b/i.test(questionText)
    ? ['Question may reference a visual; verify that its image is included.']
    : []
}

function normalizeQuestionText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function csvTextFromBytes(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) { return null }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
  } catch {
    return null
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unable to process this file.' }, { status: 401 })
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin' && profile?.role !== 'faculty') {
    return NextResponse.json({ error: 'Unable to process this file.' }, { status: 403 })
  }

  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: SIZE_ERROR }, { status: 413 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Could not read uploaded file.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: file instanceof File && file.size > MAX_BYTES ? SIZE_ERROR : 'Could not read uploaded file.' }, { status: file instanceof File && file.size > MAX_BYTES ? 413 : 400 })
  }

  const extension = file.name.split('.').pop()?.toLowerCase()
  if (!extension || !['docx', 'pdf', 'csv'].includes(extension)) {
    return NextResponse.json({ error: TYPE_ERROR }, { status: 415 })
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let rows: ImportRow[]

    if (extension === 'docx') {
      if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
        return NextResponse.json({ error: TYPE_ERROR }, { status: 415 })
      }
      try {
        const parsed = await parseWithPython(bytes, '.docx')
        rows = normalizePythonRows(parsed.rows)
      } catch {
        return NextResponse.json({ error: DOCX_ERROR }, { status: 422 })
      }
    } else if (extension === 'pdf') {
      if (!startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
        return NextResponse.json({ error: TYPE_ERROR }, { status: 415 })
      }
      let parsed: { rows: ImportRow[]; text?: string }
      try {
        parsed = await parseWithPython(bytes, '.pdf')
      } catch {
        return NextResponse.json({ error: PDF_ERROR }, { status: 422 })
      }
      if (!parsed.text?.trim()) {
        return NextResponse.json({ error: SCANNED_PDF_ERROR }, { status: 422 })
      }
      rows = parsePdfTextToRows(parsed.text)
      const styledRows = normalizePythonRows(parsed.rows)
      const answersByQuestion = new Map<string, string>(
        styledRows
          .filter((row) => row.correct_answer.trim())
          .map((row) => [normalizeQuestionText(row.question_text), row.correct_answer] as const),
      )
      rows = rows.map((row) => {
        const answer = answersByQuestion.get(normalizeQuestionText(row.question_text)) ?? ''
        return {
          ...row,
          ...(answer ? { correct_answer: answer, _errors: row._errors.filter((error) => error !== 'Answer is missing.') } : {}),
          _warnings: visualReferenceWarnings(row.question_text),
        }
      })
    } else {
      const csvText = csvTextFromBytes(bytes)
      if (csvText === null) {
        return NextResponse.json({ error: 'Could not read CSV file.' }, { status: 415 })
      }
      const header = csvText.split(/\r\n|\r|\n/, 1)[0]?.replace(/"/g, '').split(',').map((column) => column.trim().toLowerCase()) ?? []
      if (!header.includes('question_text')) {
        return NextResponse.json({ error: NO_QUESTIONS_ERROR }, { status: 422 })
      }
      rows = parseCsvText(csvText)
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: NO_QUESTIONS_ERROR }, { status: 422 })
    }
    return NextResponse.json({ rows })
  } catch {
    return NextResponse.json({ error: NO_QUESTIONS_ERROR }, { status: 422 })
  }
}
