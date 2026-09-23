import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { EmailIngestLog } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { availableMailboxes } from '../../../../../lib/email-lead'
import { fetchThread } from '../../../../../lib/gmail'
import { conversationRefusal, conversationView } from '../../../../../lib/acq-conversation-core'

/**
 * ONE SCANNED MESSAGE'S CONVERSATION (the owner, 23 Sep 2026: "just create a
 * page which shows the convo for that"): the scanner's log row and the Gmail
 * thread it sits in, read with the same credentials the scanner uses. Read
 * only; nothing is marked, moved or sent.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler') // any team role; excludes `client`
      const { id } = await params
      const row = await table<EmailIngestLog>('email_ingest_log').get(id).catch(() => null)
      const boxes = row ? await availableMailboxes() : []
      const box = row ? boxes.find(b => b.email.toLowerCase() === String(row.mailbox ?? '').toLowerCase()) ?? null : null
      const refusal = conversationRefusal(row as never, box !== null)
      if (refusal || !row || !box) return NextResponse.json({ error: refusal ?? 'Cannot read that thread' }, { status: row ? 409 : 404 })
      const thread = await fetchThread(box, String(row.gmail_message_id))
      return NextResponse.json(conversationView(row as never, thread))
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
