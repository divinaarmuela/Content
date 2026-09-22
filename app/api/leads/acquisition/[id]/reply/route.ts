import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Prospect as ProspectRow } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { getPublisher } from '../../../../../lib/publisher'
import { ownThreads } from '../../../../../lib/acq-agent'
import { logAcqEvent } from '../../../../../lib/acquisition'
import {
  cleanReply, EMAIL_REPLY_NOT_YET, isReplyChannel, nextActionAfterReply, NO_INSTAGRAM_HANDLE, NO_INSTAGRAM_THREAD, replyDetail, threadFor,
} from '../../../../../lib/acq-reply-core'

/**
 * A PERSON'S REPLY TO A PROSPECT, FROM THE DASHBOARD (the owner, 22 Sep
 * 2026: "no auto reply … but please integrate reply systems from the
 * dashboard"). The words are the person's, typed on the prospect sheet;
 * this sends them down the prospect's own Instagram thread with MD Media's
 * account — the same send the Inbox page makes — and puts the reply on the
 * timeline as a follow-up. No AI writes here. Email is refused with the
 * reason until the mailboxes are authorised to send (acq-reply-core.ts).
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler') // any team role; excludes `client`
      const { id } = await params
      const body = await req.json().catch(() => ({})) as { channel?: unknown; message?: unknown }
      if (!isReplyChannel(body.channel)) return NextResponse.json({ error: 'Pick Instagram or email' }, { status: 400 })
      const message = cleanReply(body.message)
      if (!message) return NextResponse.json({ error: 'Write the reply first' }, { status: 422 })
      const p = await table<ProspectRow>('prospects').get(id) as (ProspectRow & { instagram?: string | null; next_action?: string | null }) | null
      if (!p) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })

      if (body.channel === 'email') return NextResponse.json({ error: EMAIL_REPLY_NOT_YET }, { status: 501 })

      if (!p.instagram) return NextResponse.json({ error: NO_INSTAGRAM_HANDLE }, { status: 409 })
      const thread = threadFor(await ownThreads(), p.instagram)
      if (!thread) return NextResponse.json({ error: NO_INSTAGRAM_THREAD }, { status: 409 })

      await getPublisher().sendConversationMessage(thread.conversationId, thread.accountId, message)
      const now = new Date().toISOString()
      await logAcqEvent({ prospectId: id, kind: 'follow_up', by: user.id, detail: replyDetail('instagram', thread.ours, message) })
      await table<ProspectRow>('prospects').update(id, { next_action: nextActionAfterReply(p.next_action) ?? null, updated_at: now } as never)
      return NextResponse.json({ sent: true, ours: thread.ours })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
