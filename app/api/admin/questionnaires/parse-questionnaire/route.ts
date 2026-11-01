import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { extractDocx } from '@/lib/utils/admin/questionnaires/docx.extractor'
import { parseDocxToRows } from '@/lib/utils/admin/questionnaires/docx.parser'
import { parseCsvText } from '@/lib/utils/admin/questionnaires/questionnaires.parsers'
import type { ImportRow } from '@/lib/types/admin/questionnaires/questionnaires-types'

export const runtime = 'nodejs'

const MAX_BYTES = 10 * 1024 * 1024
const MAX_REQUEST_BYTES = MAX_BYTES + 64 * 1024
const GENERIC_ERROR = 'Unable to process this file. Check the file type and try again.'
const SCANNED_PDF_ERROR = 'This PDF looks scanned. Please upload a text-based PDF or DOCX.'

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
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 413 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: file instanceof File && file.size > MAX_BYTES ? 413 : 400 })
  }

  const extension = file.name.split('.').pop()?.toLowerCase()
  if (!extension || !['docx', 'pdf', 'csv'].includes(extension)) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 415 })
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let rows: ImportRow[]

    if (extension === 'docx') {
      if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
        return NextResponse.json({ error: GENERIC_ERROR }, { status: 415 })
      }
      const extracted = await extractDocx(file)
      if (!extracted.plainText.trim() && !extracted.html.trim()) {
        return NextResponse.json({ error: GENERIC_ERROR }, { status: 422 })
      }
      const parsedRows = parseDocxToRows(extracted)
      rows = parsedRows.map((row, index) => {
        const embeddedImage = extracted.embeddedImages?.[index]
        return embeddedImage ? { ...row, embeddedImage } : row
      })
    } else if (extension === 'pdf') {
      if (!startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
        return NextResponse.json({ error: GENERIC_ERROR }, { status: 415 })
      }
      const pdfjs = await import('pdfjs-dist')
      const loadingTask = pdfjs.getDocument({ data: bytes })
      const pdf = await loadingTask.promise
      const pageText: string[] = []
      try {
        for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
          const page = await pdf.getPage(pageNo)
          const content = await page.getTextContent()
          pageText.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
        }
      } finally {
        await loadingTask.destroy()
      }
      const plainText = pageText.join('\n').trim()
      if (!plainText) {
        return NextResponse.json({ error: SCANNED_PDF_ERROR }, { status: 422 })
      }
      rows = parseDocxToRows({ html: '', plainText, boldSet: new Set<string>() })
    } else {
      const csvText = csvTextFromBytes(bytes)
      if (csvText === null) {
        return NextResponse.json({ error: GENERIC_ERROR }, { status: 415 })
      }
      const header = csvText.split(/\r\n|\r|\n/, 1)[0]?.replace(/"/g, '').split(',').map((column) => column.trim().toLowerCase()) ?? []
      if (!header.includes('question_text')) {
        return NextResponse.json({ error: GENERIC_ERROR }, { status: 422 })
      }
      rows = parseCsvText(csvText)
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 422 })
    }
    return NextResponse.json({ rows })
  } catch {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 422 })
  }
}
