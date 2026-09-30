/**
 * THE INBOX'S RULES, pure (30 Sep 2026: "the social inbox is too slow and the layout is outdated"; "explain the 24 hour
 * and 7 day"). What the page and the send route both need to agree on:
 *
 *   - which side of a DM a message is on, and when the lead last wrote;
 *   - Meta's messaging window, counted from the LEAD'S last message (the business's own messages never reset it):
 *       0–24 h   anything may be sent;
 *       24 h–7 d only a reply typed by a person, sent with Meta's HUMAN_AGENT tag (Zernio: "Instagram only supports
 *                HUMAN_AGENT");
 *       after 7 d nothing, until they write again.
 */

export type InboxMessage = {
  id?: string
  text?: string
  message?: string
  direction?: string
  isFromMe?: boolean
  createdTime?: string
  createdAt?: string
  timestamp?: string
}

export type InboxConversation = {
  id: string
  accountId?: string
  accountUsername?: string
  platform?: string
  participantName?: string
  participantUsername?: string
  participantPicture?: string | null
  lastMessage?: string | { text?: string }
  updatedTime?: string
  unreadCount?: number
  url?: string
}

export const HOUR = 60 * 60 * 1000
export const OPEN_HOURS = 24
export const HUMAN_DAYS = 7

export const isMine = (m: InboxMessage): boolean =>
  m.isFromMe === true || m.direction === 'outgoing' || m.direction === 'sent' || m.direction === 'outbound'

export const messageAt = (m: InboxMessage): string | null => m.createdTime ?? m.createdAt ?? m.timestamp ?? null

/** When the lead last wrote — the only clock Meta's window runs on. Null when they never have. */
export function lastInboundAt(messages: readonly InboxMessage[]): string | null {
  let best: string | null = null
  for (const m of messages) {
    if (isMine(m)) continue
    const at = messageAt(m)
    if (at && (best === null || Date.parse(at) > Date.parse(best))) best = at
  }
  return best
}

export type ReplyWindow =
  | { state: 'open'; words: string; tag: null }
  | { state: 'human'; words: string; tag: 'HUMAN_AGENT' }
  | { state: 'closed'; words: string; tag: null }

/** Where this conversation stands for a reply sent now. */
export function replyWindow(messages: readonly InboxMessage[], now: number): ReplyWindow {
  const last = lastInboundAt(messages)
  if (!last) return { state: 'closed', words: 'Closed — they have not written to this account, so it cannot message them first', tag: null }
  const since = now - Date.parse(last)
  if (since < OPEN_HOURS * HOUR) {
    const left = Math.max(1, Math.ceil((OPEN_HOURS * HOUR - since) / HOUR))
    return { state: 'open', words: `Reply window: ${left}h left`, tag: null }
  }
  if (since < HUMAN_DAYS * 24 * HOUR) {
    const left = Math.max(1, Math.ceil((HUMAN_DAYS * 24 * HOUR - since) / (24 * HOUR)))
    return { state: 'human', words: `Team reply only — ${left} day${left === 1 ? '' : 's'} left. It goes out marked as a person's reply.`, tag: 'HUMAN_AGENT' }
  }
  return { state: 'closed', words: 'Closed — more than 7 days since they last wrote. It opens again when they message or comment.', tag: null }
}

/** Every page of one or more accounts' conversations, merged: one row per conversation, newest first. */
export function mergeConversations(pages: readonly unknown[]): InboxConversation[] {
  const byId = new Map<string, InboxConversation>()
  for (const page of pages) {
    const r = page as { data?: unknown } | null
    const list = Array.isArray(r?.data) ? r.data : Array.isArray(page) ? page : []
    for (const c of list as InboxConversation[]) if (c && typeof c.id === 'string') byId.set(`${c.accountId ?? ''}:${c.id}`, c)
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.updatedTime ?? '') - Date.parse(a.updatedTime ?? '') || 0)
}

/** The cursor for the next page, when the provider says there is one. */
export function nextCursor(page: unknown): string | null {
  const p = (page as { pagination?: { hasMore?: boolean; nextCursor?: string | null } } | null)?.pagination
  return p?.hasMore && typeof p.nextCursor === 'string' && p.nextCursor ? p.nextCursor : null
}

export type InboxFilter = 'all' | 'unread' | 'automation'

/** The list's filters and search; `automated` = the people an automation has written to. */
export function filterConversations(
  list: readonly InboxConversation[], filter: InboxFilter, search: string, automated: ReadonlySet<string>,
): InboxConversation[] {
  const q = search.trim().replace(/^@/, '').toLowerCase()
  return list.filter(c => {
    const names = [c.participantName, c.participantUsername].map(v => String(v ?? '').toLowerCase())
    if (q && !names.some(n => n.includes(q))) return false
    if (filter === 'unread') return (c.unreadCount ?? 0) > 0
    if (filter === 'automation') return names.some(n => automated.has(n.replace(/^@/, '')))
    return true
  })
}
