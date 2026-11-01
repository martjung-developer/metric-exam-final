import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractDocx } from '@/lib/utils/admin/questionnaires/docx.extractor'
import { parseDocxToRows } from '@/lib/utils/admin/questionnaires/docx.parser'
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

function logParseReason(reason: string): void {
  // TEMP-DIAG: emit a short reason code only; never include upload contents.
  console.error(`[TEMP-DIAG] ${reason}`)
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte)
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
    logParseReason('file_too_large')
    return NextResponse.json({ error: SIZE_ERROR }, { status: 413 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    logParseReason('form_data_failed')
    return NextResponse.json({ error: 'Could not read uploaded file.' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) {
    logParseReason(file instanceof File && file.size > MAX_BYTES ? 'file_too_large' : 'invalid_upload')
    return NextResponse.json({ error: file instanceof File && file.size > MAX_BYTES ? SIZE_ERROR : 'Could not read uploaded file.' }, { status: file instanceof File && file.size > MAX_BYTES ? 413 : 400 })
  }

  const extension = file.name.split('.').pop()?.toLowerCase()
  if (!extension || !['docx', 'pdf', 'csv'].includes(extension)) {
    logParseReason('wrong_file_type')
    return NextResponse.json({ error: TYPE_ERROR }, { status: 415 })
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let rows: ImportRow[]

    if (extension === 'docx') {
      if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
        logParseReason('wrong_file_type')
        return NextResponse.json({ error: TYPE_ERROR }, { status: 415 })
      }
      let extracted: Awaited<ReturnType<typeof extractDocx>>
      try {
        extracted = await extractDocx(file)
      } catch {
        logParseReason('docx_structure_failed')
        return NextResponse.json({ error: DOCX_ERROR }, { status: 422 })
      }
      if (!extracted.plainText.trim() && !extracted.html.trim()) {
        logParseReason('docx_empty')
        return NextResponse.json({ error: DOCX_ERROR }, { status: 422 })
      }
      let parsedRows: ImportRow[]
      try {
        parsedRows = parseDocxToRows(extracted)
      } catch {
        logParseReason('docx_row_parse_failed')
        return NextResponse.json({ error: DOCX_ERROR }, { status: 422 })
      }
      rows = parsedRows.map((row, index) => {
        const embeddedImage = extracted.embeddedImages?.[index]
        const normalized = {
          ...row,
          question_type: 'multiple_choice' as const,
          points: 1,
          difficulty: 'medium' as const,
          explanation: '',
          scenario: '',
          image: '',
        }
        return embeddedImage ? { ...normalized, embeddedImage } : normalized
      })
    } else if (extension === 'pdf') {
      if (!startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
        logParseReason('wrong_file_type')
        return NextResponse.json({ error: TYPE_ERROR }, { status: 415 })
      }
      let plainText = ''
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        const loadingTask = pdfjs.getDocument({ data: bytes })
        const pdf = await loadingTask.promise
        const pageText: string[] = []
        try {
          for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
            const page = await pdf.getPage(pageNo)
            const content = await page.getTextContent()
            pageText.push(content.items.map((item) => {
              if (!('str' in item)) { return '' }
              const transform = 'transform' in item ? item.transform : null
              const y = Array.isArray(transform) ? transform[5] : null
              const pageHeight = page.view[3] - page.view[1]
              if (/^\d{1,3}$/.test(item.str.trim()) && y !== null && (y < 32 || y > pageHeight - 32)) { return '' }
              return `${item.str}${'hasEOL' in item && item.hasEOL ? '\n' : ' '}`
            }).join(''))
          }
        } finally {
          await loadingTask.destroy()
        }
        plainText = pageText.join('\n').trim()
      } catch {
        logParseReason('pdf_extraction_failed')
        return NextResponse.json({ error: PDF_ERROR }, { status: 422 })
      }
      if (!plainText) {
        logParseReason('pdf_no_text')
        return NextResponse.json({ error: SCANNED_PDF_ERROR }, { status: 422 })
      }
      rows = parsePdfTextToRows(plainText)
    } else {
      const csvText = csvTextFromBytes(bytes)
      if (csvText === null) {
        logParseReason('csv_encoding_invalid')
        return NextResponse.json({ error: 'Could not read CSV file.' }, { status: 415 })
      }
      const header = csvText.split(/\r\n|\r|\n/, 1)[0]?.replace(/"/g, '').split(',').map((column) => column.trim().toLowerCase()) ?? []
      if (!header.includes('question_text')) {
        logParseReason('csv_header_invalid')
        return NextResponse.json({ error: NO_QUESTIONS_ERROR }, { status: 422 })
      }
      rows = parseCsvText(csvText)
    }

    if (rows.length === 0) {
      logParseReason('no_questions_found')
      return NextResponse.json({ error: NO_QUESTIONS_ERROR }, { status: 422 })
    }
    return NextResponse.json({ rows })
  } catch {
    logParseReason('row_normalization_failed')
    return NextResponse.json({ error: NO_QUESTIONS_ERROR }, { status: 422 })
  }
}
