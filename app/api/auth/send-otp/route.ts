import { NextResponse } from 'next/server'
import type { SendOtpResult } from '@/lib/types/auth/'

export async function POST(): Promise<NextResponse<SendOtpResult>> {
  return NextResponse.json(
    { sent: false, error: 'This endpoint is disabled. Use the signup verification flow.' },
    { status: 410 },
  )
}
