/**
 * THE INBOX COPY'S RULES, pure (the owner, 6 Nov 2026: "make it fast" — and "what if they unsent?").
 *
 * Zernio is the source. We keep its answers so the lists open at once, and keep them current four ways:
 *   1. its webhooks (message.received / sent / edited / deleted / read, conversation.started, comment.received)
 *      are folded in here as they arrive — `foldInboxEvent`;
 *   2. opening ONE conversation or ONE post reads it live from Zernio and corrects the copy — `correctFromThread`;
 *   3. a background re-check every 10 minutes, for clients someone looked at recently — `clientsToRecheck`;
 *   4. an UNSENT message is never shown with its old words: Zernio's `message.deleted` keeps the pre-delete text in
 *      its payload, so this module never reads `text` off a delete, and remembers the id so a later live read of the
 *      thread drops it too — `withoutUnsent`.
 *
 * Facebook sends no unsend event and no network sends a comment-deleted event; those are caught by (2) and (3).
 */
import type { InboxConversation, InboxMessage } from './inbox-core'
import { dayLabel, isMine as isMineMsg, messageAt } from './inbox-core'

/**
 * Each bubble's layout in ONE pass (6 Nov 2026: the chat worked out "is this my last message?" by scanning the rest
 * of the thread for every message — O(n²) on each draw). Same answers, linear.
 */
export function threadLayout(
  messages: readonly InboxMessage[], sentBy: Readonly<Record<string, string>>, now: number,
): { day: string | null; sameSideAsPrev: boolean; mine: boolean; lastOfMine: boolean; by: string | null }[] {
  let lastMine = -1
  messages.forEach((m, i) => { if (isMineMsg(m)) lastMine = i })
  let prevDay: string | null = null
  let prevMine: boolean | null = null
  return messages.map((m, i) => {
    const mine = isMineMsg(m)
    const day = dayLabel(messageAt(m), now)
    const newDay = i === 0 || day !== prevDay
    const out = {
      day: newDay ? day : null,
      sameSideAsPrev: !newDay && prevMine === mine,
      mine,
      lastOfMine: i === lastMine,
      by: sentBy[m.id ?? String(i)] ?? null,
    }
    prevDay = day; prevMine = mine
    return out
  })
}

/** The words shown where an unsent message's preview was. Never the old text. */
export const UNSENT_WORDS = 'A message was unsent'

/** One inbox webhook, as much of it as the copy uses. */
export type InboxEvent = {
  detail: string
  accountId: string
  conversationId: string
  messageId?: string | null
  /** received / sent / edited only — never read from a delete */
  text?: string | null
  at?: string | null
  incoming?: boolean
  platform?: string | null
  accountUsername?: string | null
  participantName?: string | null
  participantUsername?: string | null
  participantPicture?: string | null
}

/** A conversation row in the copy, before it is written. */
export type CopyRow = {
  data: InboxConversation
  last_message_id: string | null
  unsent_ids: string[]
}

const t = (iso?: string | null) => (iso ? Date.parse(iso) || 0 : 0)

/**
 * Fold one webhook into the row it touches (null = no row yet). Returns the new row, or null when the event changes
 * nothing that is shown. Safe to apply twice: a redelivered message carries the same id and time.
 */
export function foldInboxEvent(row: CopyRow | null, ev: InboxEvent): CopyRow | null {
  const base: CopyRow = row
    ? { data: { ...row.data }, last_message_id: row.last_message_id, unsent_ids: [...row.unsent_ids] }
    : {
        data: {
          id: ev.conversationId, accountId: ev.accountId,
          ...(ev.platform ? { platform: ev.platform } : {}),
          ...(ev.accountUsername ? { accountUsername: ev.accountUsername } : {}),
          unreadCount: 0,
        },
        last_message_id: null, unsent_ids: [],
      }
  const d = base.data
  // who it is with — fill a blank only, Zernio's list stays the authority on names
  if (ev.participantName && !d.participantName) d.participantName = ev.participantName
  if (ev.participantUsername && !d.participantUsername) d.participantUsername = ev.participantUsername
  if (ev.participantPicture && !d.participantPicture) d.participantPicture = ev.participantPicture

  switch (ev.detail) {
    case 'message.received':
    case 'message.sent': {
      if (ev.messageId && base.unsent_ids.includes(ev.messageId)) return row ? null : base
      const at = ev.at ?? new Date().toISOString()
      const newer = t(at) >= t(d.updatedTime)
      const repeat = !!ev.messageId && ev.messageId === base.last_message_id
      if (newer && !repeat) {
        d.lastMessage = ev.text ?? ''
        d.updatedTime = at
        base.last_message_id = ev.messageId ?? null
        // a message they wrote is unread until someone opens it; our own sent message never is
        if (ev.detail === 'message.received' && ev.incoming !== false) d.unreadCount = (d.unreadCount ?? 0) + 1
      }
      return base
    }
    case 'message.edited': {
      if (!row) return null
      if (ev.messageId && ev.messageId === base.last_message_id && ev.text != null) { d.lastMessage = ev.text; return base }
      return null
    }
    case 'message.deleted': {
      // the pre-delete text is in the payload; it is NOT read here
      if (ev.messageId && !base.unsent_ids.includes(ev.messageId)) base.unsent_ids.push(ev.messageId)
      if (!row) return base
      const wasLast = (!!ev.messageId && ev.messageId === base.last_message_id)
        || (!ev.messageId) || (!base.last_message_id && !!ev.at && t(ev.at) >= t(d.updatedTime))
      if (wasLast) {
        d.lastMessage = UNSENT_WORDS
        if (ev.incoming !== false && (d.unreadCount ?? 0) > 0) d.unreadCount = (d.unreadCount ?? 0) - 1
      }
      return base
    }
    case 'conversation.started':
      return row ? null : base
    default:
      // message.read / delivered / failed / reactions change nothing the list shows
      return null
  }
}

/** A live thread with every unsent message taken out — by id, whatever Zernio itself still returns. */
export function withoutUnsent(messages: readonly InboxMessage[], unsentIds: readonly string[]): InboxMessage[] {
  if (!unsentIds.length) return [...messages]
  const gone = new Set(unsentIds)
  return messages.filter(m => !(m.id && gone.has(m.id)))
}

/**
 * Correct a conversation's row from a LIVE read of its newest messages (oldest-to-newest, unsent already removed).
 * The preview and time become the newest message that is still there; an empty thread keeps the row as it was.
 */
export function correctFromThread(row: CopyRow, messages: readonly InboxMessage[], opened: boolean): CopyRow {
  const last = messages[messages.length - 1]
  const data = { ...row.data }
  if (last) {
    const words = last.text ?? last.message ?? ''
    data.lastMessage = words || ((last.attachments ?? []).length ? '[Attachment]' : '')
    const at = messageAt(last)
    if (at) data.updatedTime = at
  }
  if (opened) data.unreadCount = 0
  return { ...row, data, last_message_id: last?.id ?? row.last_message_id }
}

/** Merge Zernio's live page into the copy: Zernio's row wins, except a preview whose last message we know was unsent. */
export function fromLivePage(live: InboxConversation, existing: CopyRow | null): CopyRow {
  const unsent = existing?.unsent_ids ?? []
  const data = { ...live }
  const sameLast = !!existing && t(live.updatedTime) <= t(existing.data.updatedTime)
  if (existing && sameLast && existing.data.lastMessage === UNSENT_WORDS) data.lastMessage = UNSENT_WORDS
  return { data, last_message_id: sameLast ? existing?.last_message_id ?? null : null, unsent_ids: unsent }
}

/* ── comments: has the team replied? ─────────────────────────────────────── */

/** A comment as Zernio's GET /inbox/comments/{postId} returns it (read live 6 Nov 2026). */
export type ZComment = {
  id: string
  message?: string
  text?: string
  createdTime?: string
  from?: { id?: string; name?: string; username?: string; isOwner?: boolean }
  replyCount?: number
  replies?: ZComment[]
  hidden?: boolean
  isHidden?: boolean
}

/** A reply the team sent from this app (inbox_reply_log): `target_id` is the comment id, or the conversation id. */
export type OurReply = { target_id: string; by_name: string | null; at: string; kind?: string; text?: string }

export type ReplyState = {
  /** 'replied' | 'needs' — and 'own' for the account's own top-level comment, which nobody answers */
  state: 'replied' | 'needs' | 'own'
  /** a team member's name when the reply was sent from this app; null when it was made on the platform itself */
  by: string | null
  at: string | null
  /** true when the reply was made outside the app (Instagram, Zernio) — we cannot know who */
  outside?: boolean
}

/**
 * Has the client's account answered this comment? Yes when one of its replies is written by the account itself
 * (Zernio marks it `from.isOwner: true`), or when our team replied from this app (recorded by us, with who). The
 * newest of the two is what is shown. A comment the account wrote itself is not waiting for anyone.
 */
export function replyState(c: ZComment, ours: readonly OurReply[]): ReplyState {
  if (c.from?.isOwner) return { state: 'own', by: null, at: null }
  let best: { by: string | null; at: string | null; outside: boolean } | null = null
  for (const r of c.replies ?? []) {
    if (!r.from?.isOwner) continue
    const at = r.createdTime ?? null
    if (!best || t(at) > t(best.at)) best = { by: null, at, outside: true }
  }
  // our own log wins over the platform's copy of the same reply (it knows who): a reply sent from the app also shows
  // in Zernio's replies a few seconds later, so anything within 10 minutes is the same reply
  for (const r of ours) {
    if (r.target_id !== c.id || (r.kind && r.kind !== 'comment')) continue
    if (!best || t(r.at) >= t(best.at) - 10 * 60_000) best = { by: r.by_name, at: r.at, outside: false }
  }
  return best ? { state: 'replied', ...best } : { state: 'needs', by: null, at: null }
}

export type AnnotatedComment = ZComment & { reply: ReplyState }

export function annotateComments(list: readonly ZComment[], ours: readonly OurReply[]): AnnotatedComment[] {
  return list.map(c => ({ ...c, reply: replyState(c, ours) }))
}

export function replyCounts(list: readonly AnnotatedComment[]): { needs_reply: number; replied: number } {
  let needs_reply = 0, replied = 0
  for (const c of list) {
    if (c.reply.state === 'needs') needs_reply++
    else if (c.reply.state === 'replied') replied++
  }
  return { needs_reply, replied }
}

export type ReplyFilter = 'all' | 'needs' | 'replied'
export function filterByReply(list: readonly AnnotatedComment[], f: ReplyFilter): AnnotatedComment[] {
  return f === 'all' ? [...list] : list.filter(c => c.reply.state === f)
}

const PLATFORM_WORDS: Record<string, string> = {
  instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn',
  twitter: 'X', threads: 'Threads', bluesky: 'Bluesky', reddit: 'Reddit',
}

/** "Replied by Sam · 3h ago", or "Replied on Instagram · 3h ago" when it was answered outside the app. */
export function replyLabel(r: ReplyState, platform: string | null | undefined, now: number): string {
  if (r.state !== 'replied') return r.state === 'needs' ? 'Needs a reply' : ''
  const when = r.at ? ` · ${agoShort(r.at, now)}` : ''
  if (r.by) return `Replied by ${r.by}${when}`
  const where = PLATFORM_WORDS[String(platform ?? '').toLowerCase()]
  return `Replied ${where ? `on ${where}` : 'outside the app'}${when}`
}

export function agoShort(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - t(iso)) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/**
 * Which team member sent this DM from the app: the log row for the same conversation with the same words within
 * 10 minutes of it. Null for a message sent outside the app (or by an automation), whose sender we cannot know.
 */
export function whoSent(
  m: InboxMessage, conversationId: string,
  log: readonly { kind: string; target_id: string; text: string; at: string; by_name: string | null }[],
): string | null {
  const words = (m.text ?? m.message ?? '').trim()
  const at = t(messageAt(m))
  if (!words) return null
  let best: { by: string | null; gap: number } | null = null
  for (const r of log) {
    if (r.kind !== 'dm' || r.target_id !== conversationId || r.text.trim() !== words) continue
    const gap = Math.abs(t(r.at) - at)
    if (gap <= 10 * 60_000 && (!best || gap < best.gap)) best = { by: r.by_name, gap }
  }
  return best?.by ?? null
}

/** The log row for one send — pure, so what is recorded is pinned by a test. */
export function replyLogRow(
  r: { kind: 'comment' | 'private_reply' | 'dm'; teamUserId: string | null; byName: string | null; targetId: string; postId?: string | null; accountId: string | null; text: string },
  account: { platform?: string | null; client_id?: string | null } | null, at: string,
) {
  return {
    kind: r.kind, team_user_id: r.teamUserId, by_name: r.byName, at,
    platform: account?.platform ?? null, client_id: account?.client_id ?? null, account_id: r.accountId,
    target_id: r.targetId, post_id: r.postId ?? null, text: r.text.slice(0, 2000),
  }
}

/* ── freshness ───────────────────────────────────────────────────────────── */

/** "Updated just now" / "Updated 4 min ago" / "Checking…" — the small line over each list. */
export function freshnessWords(checkedAt: string | null, checking: boolean, now: number): string {
  if (checking) return 'Checking for anything new…'
  if (!checkedAt) return ''
  const min = Math.floor((now - t(checkedAt)) / 60_000)
  if (min < 1) return 'Updated just now'
  if (min < 60) return `Updated ${min} min ago`
  const h = Math.floor(min / 60)
  return `Updated ${h} hour${h === 1 ? '' : 's'} ago`
}

/** The re-check's list: clients someone looked at within `windowMs`, not checked in the last `minGapMs`. */
export function clientsToRecheck(
  rows: readonly { id: string; viewed_at: string | null; checked_at: string | null }[],
  now: number, windowMs = 3 * 3600_000, minGapMs = 8 * 60_000,
): string[] {
  return rows
    .filter(r => r.viewed_at && now - t(r.viewed_at) <= windowMs && now - t(r.checked_at) >= minGapMs)
    .sort((a, b) => t(b.viewed_at) - t(a.viewed_at))
    .map(r => r.id)
}

/** Copy rows → the list the page shows: one per conversation, newest first. */
export function copyToList(rows: readonly { data: unknown }[]): InboxConversation[] {
  return rows
    .map(r => r.data as InboxConversation)
    .filter(c => c && typeof c.id === 'string')
    .sort((a, b) => t(b.updatedTime) - t(a.updatedTime))
}

