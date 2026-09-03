import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { NotificationLog } from '@/lib/db-types'
import { requireSignedIn, authzErrorResponse } from '../../../lib/authz'

export const dynamic = 'force-dynamic'

/** The signed-in person's own notification history — the same rows the
 *  email outbox wrote, so the page can never disagree with the inbox.
 *  `?count=1` returns just the unread number, cheap enough for the bell
 *  to poll. */
export async function GET(req: Request) {
  return withRequestCache(async () => {
  try {
    const user = await requireSignedIn()
    const log = table<NotificationLog>('notification_log')

    if (new URL(req.url).searchParams.get('count') === '1') {
      const unread = await log.count({ by: { recipient_id: user.id }, where: r => r.read_at == null })
      return NextResponse.json({ unread })
    }

    const rows = await log.list({
      by: { recipient_id: user.id },
      orderBy: [['created_at', 'desc']],
      limit: 50,
    })
    // the projection the old select named — the body_html never leaves here
    const notifications = rows.map(r => ({
      id: r.id, event_type: r.event_type, subject: r.subject, status: r.status,
      entity_type: r.entity_type, entity_id: r.entity_id,
      created_at: r.created_at, read_at: r.read_at,
    }))
    return NextResponse.json({ notifications })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Opening the feed marks everything read — idempotent, no per-row races.
 *  Rows keep their unread tint for the visit (the page marks state after
 *  it has rendered what was new). */
export async function POST() {
  return withRequestCache(async () => {
  try {
    const user = await requireSignedIn()
    const log = table<NotificationLog>('notification_log')
    const unread = await log.list({ by: { recipient_id: user.id }, where: r => r.read_at == null })
    const now = new Date().toISOString()
    await Promise.all(unread.map(r => log.update(r.id, { read_at: now })))
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
