// app/api/admin/notifications/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/types/database'
import type { SendNotificationPayload } from '@/lib/types/admin/notifications/notifications.types'
import { resolveAdminScope, getScopedRecipientIds, getScopedPrograms } from '@/lib/services/admin/scope.service'

function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing Supabase service role env vars.')
  }
  return createServiceClient<Database>(url, key, { auth: { persistSession: false } })
}

async function getLoggedInUserId() {
  const supabaseSession = await createServerClient()
  const { data: { user }, error } = await supabaseSession.auth.getUser()
  if (error || !user) {
    return null
  }
  return user.id
}

export async function GET() {
  try {
    const userId = await getLoggedInUserId()
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 })
    }

    const supabase = getServiceRoleClient()
    const scope = await resolveAdminScope(supabase, userId)
    if (!scope) {return NextResponse.json({ success: false, error: 'Forbidden.' }, { status: 403 })}
    const scopedUserIds = await getScopedRecipientIds(supabase, scope)
    const allowedPrograms = new Set((await getScopedPrograms(supabase, scope)).map((program) => program.id))

    const [notificationsResult, students] = await Promise.all([
      supabase
        .from('notifications')
        .select('*')
        .in('user_id', Array.from(scopedUserIds))
        .order('created_at', { ascending: false }),
      (async () => {
        let query = supabase.from('students').select('id,user_id,program_id')
        query = query.in('program_id', [...allowedPrograms])
        const { data: students } = await query
        const profileIds = (students ?? []).flatMap((student) => [student.id, student.user_id]).filter((id): id is string => Boolean(id))
        const { data: profiles } = profileIds.length ? await supabase.from('profiles').select('id,full_name,email').in('id', profileIds) : { data: [] }
        const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]))
        return (students ?? []).flatMap((student) => {
          const profile = byId.get(student.user_id ?? '') ?? byId.get(student.id)
          return profile ? [{ id: student.user_id ?? student.id, full_name: profile.full_name, email: profile.email, students: { id: student.id } }] : []
        })
      })(),
    ])

    if (notificationsResult.error) {
      return NextResponse.json({ success: false, error: notificationsResult.error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, notifications: notificationsResult.data ?? [], students })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getLoggedInUserId()
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 })
    }

    const payload = (await req.json()) as SendNotificationPayload
    const title = payload.title?.trim() ?? ''
    const message = payload.message?.trim() ?? ''
    const recipientIds = Array.from(new Set(payload.recipientIds ?? []))

    if (!title || !message) {
      return NextResponse.json({ success: false, error: 'Title and message are required.' }, { status: 400 })
    }
    if (recipientIds.length === 0) {
      return NextResponse.json({ success: false, error: 'At least one recipient is required.' }, { status: 400 })
    }

    const supabase = getServiceRoleClient()
    const scope = await resolveAdminScope(supabase, userId)
    if (!scope) {return NextResponse.json({ success: false, error: 'Forbidden.' }, { status: 403 })}
    const scopedUserIds = await getScopedRecipientIds(supabase, scope)
    const hasOutOfScopeRecipient = recipientIds.some((id) => !scopedUserIds.has(id))
    if (hasOutOfScopeRecipient) {
      return NextResponse.json({ success: false, error: 'Forbidden.' }, { status: 403 })
    }

    const rows = recipientIds.map((uid) => ({
      user_id: uid,
      title,
      message,
      type: payload.type,
      is_read: false,
    }))

    const { error } = await supabase.from('notifications').insert(rows)
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
