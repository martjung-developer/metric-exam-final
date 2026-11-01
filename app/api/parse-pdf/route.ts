// app/api/parse-pdf/route.ts
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { extractDocx } from "@/lib/utils/admin/questionnaires/docx.extractor"
import { parseDocxToRows } from "@/lib/utils/admin/questionnaires/docx.parser"
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin' && profile?.role !== 'faculty') {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }

  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'File exceeds 10 MB limit.' }, { status: 413 })
  }
  const formData = await req.formData()
  const uploadedFile = formData.get("file") as File

  if (!uploadedFile) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 })
  }

  if (uploadedFile.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'File exceeds 10 MB limit.' }, { status: 413 })
  }
  if (!uploadedFile.name.toLowerCase().endsWith('.docx') || uploadedFile.type !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return NextResponse.json({ error: 'Only DOCX files are supported.' }, { status: 415 })
  }

  const fileName = uploadedFile.name.toLowerCase()

  if (fileName.endsWith(".docx")) {
    const extracted = await extractDocx(uploadedFile)
    const rows = parseDocxToRows(extracted)
    return NextResponse.json({ rows })
  }

  return NextResponse.json({ error: 'Only DOCX files are supported.' }, { status: 415 })
}
