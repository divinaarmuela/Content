import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireSignedIn, authzErrorResponse } from '../../../lib/authz'

export const dynamic = 'force-dynamic'

/** The signed-in person's own notification history — the same rows the
 *  email outbox wrote, so the page can never disagree with the inbox.
 *  `?count=1` returns just the unread number, cheap enough for the bell
 *  to poll. */
export async function GET(req: Request) {
  try {
    const user = await requireSignedIn()

    if (new URL(req.url).searchParams.get('count') === '1') {
      const { count } = await supabase
        .from('notification_log')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', user.id)
        .is('read_at', null)
      return NextResponse.json({ unread: count ?? 0 })
    }

    const { data, error } = await supabase
      .from('notification_log')
      .select('id, event_type, subject, status, entity_type, entity_id, created_at, read_at')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw new Error(error.message)
    return NextResponse.json({ notifications: data ?? [] })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Opening the feed marks everything read — idempotent, no per-row races.
 *  Rows keep their unread tint for the visit (the page marks state after
 *  it has rendered what was new). */
export async function POST() {
  try {
    const user = await requireSignedIn()
    await supabase
      .from('notification_log')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', user.id)
      .is('read_at', null)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
