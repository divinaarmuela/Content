import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { EmailIngestLog, Prospect as ProspectRow } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { availableMailboxes } from '../../../../../lib/email-lead'
import { fetchThread, mailboxCanSend, sendReply } from '../../../../../lib/gmail'
import { logAcqEvent } from '../../../../../lib/acquisition'
import { prospectForSender } from '../../../../../lib/acquisition-core'
import {
  conversationRefusal, conversationView, MAILBOX_CANNOT_SEND, NOBODY_TO_REPLY_TO, REPLY_TEXT_MAX, replyDraft, replyHtml,
} from '../../../../../lib/acq-conversation-core'

/**
 * ONE SCANNED MESSAGE'S CONVERSATION (the owner, 23 Sep 2026: "just create a
 * page which shows the convo for that"): the scanner's log row and the Gmail
 * thread it sits in, read with the same credentials the scanner uses.
 * GET reads; POST sends one reply from that mailbox into that thread, and
 * only because a person pressed Send.
 */
async function threadFor(id: string) {
  const row = await table<EmailIngestLog>('email_ingest_log').get(id).catch(() => null)
  const boxes = row ? await availableMailboxes() : []
  const box = row ? boxes.find(b => b.email.toLowerCase() === String(row.mailbox ?? '').toLowerCase()) ?? null : null
  const refusal = conversationRefusal(row as never, box !== null)
  if (refusal || !row || !box) return { error: refusal ?? 'Cannot read that thread', status: row ? 409 : 404 } as const
  const thread = await fetchThread(box, String(row.gmail_message_id))
  return { row, box, thread } as const
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler') // any team role; excludes `client`
      const { id } = await params
      const t = await threadFor(id)
      if ('error' in t) return NextResponse.json({ error: t.error }, { status: t.status })
      return NextResponse.json({ ...conversationView(t.row as never, t.thread), can_send: mailboxCanSend(t.box), reply_to: replyDraft(t.thread, String(t.row.subject ?? ''))?.to ?? null })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const body = await req.json().catch(() => ({})) as { message?: unknown }
      const text = String(body.message ?? '').trim()
      if (!text) return NextResponse.json({ error: 'Write the reply first' }, { status: 400 })
      if (text.length > REPLY_TEXT_MAX) return NextResponse.json({ error: `Keep it under ${REPLY_TEXT_MAX} characters` }, { status: 400 })
      const t = await threadFor(id)
      if ('error' in t) return NextResponse.json({ error: t.error }, { status: t.status })
      if (!mailboxCanSend(t.box)) return NextResponse.json({ error: MAILBOX_CANNOT_SEND(t.box.email) }, { status: 409 })
      const draft = replyDraft(t.thread, String(t.row.subject ?? ''))
      if (!draft) return NextResponse.json({ error: NOBODY_TO_REPLY_TO }, { status: 409 })
      const sent = await sendReply(t.box, { to: draft.to, subject: draft.subject, text, html: replyHtml(text), threadId: draft.threadId ?? undefined, inReplyTo: draft.inReplyTo ?? undefined, references: draft.references ?? undefined })
      // if the sender is a prospect, the reply is on their timeline too — the thread itself is the record otherwise
      try {
        const prospects = await table<ProspectRow>('prospects').list({ limit: 2000 })
        const match = prospectForSender(prospects, draft.to)
        if (match) await logAcqEvent({ prospectId: match.prospect.id, kind: 'follow_up', by: user.id, source: 'person', detail: `Replied by email from ${t.box.email}: ${text.slice(0, 300)}` })
      } catch (e) { console.error('[conversation] reply sent but not logged on the prospect:', e) }
      return NextResponse.json({ ok: true, id: sent.id, threadId: sent.threadId, from: t.box.email, to: draft.to })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
