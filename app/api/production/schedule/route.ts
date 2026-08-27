import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireSignedIn, requireRole, authzErrorResponse } from '../../../lib/authz'
import { accessibleClientIds } from '../../../lib/production-access'

/**
 * Everything with a scheduled time, for the calendar.
 *
 * Scoped the same way the item list is: a client sees only their own, a
 * scheduler sees their assigned clients. The calendar is a different view of
 * the same data as the queue, not a separate source of truth.
 */
export async function GET(req: Request) {
  try {
    const user = await requireSignedIn()
    const url = new URL(req.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')

    let q = supabase
      .from('schedule_entries')
      .select(`
        id, item_id, platform, scheduled_at, publish_status, published_at,
        live_url, tool_url,
        content_items ( id, title, status, content_type, client_id, clients ( name, timezone ) )
      `)
      .order('scheduled_at', { ascending: true })
      .limit(500)

    if (from) q = q.gte('scheduled_at', from)
    if (to) q = q.lte('scheduled_at', to)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    // scope after the join: the client id lives on the item, not the entry
    const allowed = await accessibleClientIds(user)
    const rows = (data ?? []).filter(r => {
      if (allowed === null) return true
      const item = r.content_items as unknown as { client_id?: string } | null
      return item?.client_id ? allowed.includes(item.client_id) : false
    })

    return NextResponse.json(rows)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
