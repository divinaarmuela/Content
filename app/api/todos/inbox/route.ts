import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { authzErrorResponse, requireRole } from '../../../lib/authz'
import { inboxItemOf, type InboxRow } from '../../../lib/todo-inbox-core'

/**
 * THE TO-DOS INBOX (the owner, 20 Oct 2026, Manal's video of Asana's Inbox: "when you click there you can see when
 * people tag you in their own tasks … I'll click on it and … we can collaborate on it and comment"). What the bell
 * and the emails already said about to-dos — assigned you, tagged you, commented, completed, added you — as a list,
 * newest first, each opening its task. GET: my last 150. POST { ids } (or { all: true }): read.
 */
export async function GET() {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const rows = await table<InboxRow>('notification_log').list({
        by: { recipient_id: user.id }, where: r => r.entity_type === 'todo', orderBy: [['created_at', 'desc']], limit: 150,
      })
      return NextResponse.json({ items: rows.map(inboxItemOf) })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const body = await req.json().catch(() => ({})) as { ids?: unknown; all?: unknown }
      const ids = Array.isArray(body.ids) ? new Set(body.ids.map(String)) : null
      const log = table<InboxRow>('notification_log')
      const unread = await log.list({ by: { recipient_id: user.id }, where: r => r.entity_type === 'todo' && r.read_at == null && (body.all === true || !!ids?.has(r.id)) })
      const now = new Date().toISOString()
      await Promise.all(unread.map(r => log.update(r.id, { read_at: now } as never)))
      return NextResponse.json({ read: unread.length })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
