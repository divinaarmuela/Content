/**
 * REPLYING FROM THE DASHBOARD — the pure half (the owner, 22 Sep 2026: "no
 * auto reply … but please integrate reply systems from the dashboard").
 *
 * A person writes every reply; nothing here composes one. This decides
 * which thread a reply to a prospect goes down, what the timeline says
 * about it, and why a channel is not available yet. No I/O.
 */

import { cleanHandle } from './acquisition-core'

export type ReplyChannel = 'instagram' | 'email'
export const REPLY_CHANNELS: readonly ReplyChannel[] = ['instagram', 'email']

export function isReplyChannel(v: unknown): v is ReplyChannel {
  return (REPLY_CHANNELS as readonly string[]).includes(String(v))
}

export const REPLY_MAX = 1000

/** the message as it will be sent: trimmed, bounded — empty is refused */
export function cleanReply(raw: unknown): string | null {
  const s = String(raw ?? '').replace(/\r\n/g, '\n').trim().slice(0, REPLY_MAX)
  return s || null
}

type Thread = { handle: string; conversationId: string; accountId: string; ours: string }

/** the prospect's own thread with one of MD Media's Instagram accounts, when there is one */
export function threadFor(threads: readonly Thread[], instagram: string | null | undefined): Thread | null {
  const handle = (cleanHandle(instagram) ?? '').toLowerCase()
  if (!handle) return null
  return threads.find(t => t.handle.toLowerCase() === handle) ?? null
}

export const NO_INSTAGRAM_THREAD = 'No Instagram thread with them yet — they have not written to MD Media’s account. A first DM to a stranger goes from the Inbox page.'
export const NO_INSTAGRAM_HANDLE = 'Add their Instagram handle first.'
/** EMAIL (22 Sep 2026): the connected mailboxes are read-only to the app until the gmail.send scope is authorised — an admin step, not a code one */
export const EMAIL_REPLY_NOT_YET = 'Replying by email from here needs the mailboxes authorised to send (the gmail.send scope in Google Admin → Domain-wide delegation). Until then, reply from the inbox itself.'

/** what the timeline says: who replied, where, and the words — never rewritten */
export function replyDetail(channel: ReplyChannel, ours: string | null, message: string): string {
  const where = channel === 'instagram' ? `on Instagram${ours ? ` as @${ours.replace(/^@/, '')}` : ''}` : 'by email'
  return `Replied ${where}: “${message.replace(/\s+/g, ' ').trim().slice(0, 300)}”`
}

/** a reply answers the standing "Reply to their DM" next action */
export function nextActionAfterReply(nextAction: string | null | undefined): string | null | undefined {
  return /reply to their dm/i.test(String(nextAction ?? '')) ? null : nextAction
}
