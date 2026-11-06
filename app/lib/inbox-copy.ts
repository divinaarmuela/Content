import 'server-only'
import { table } from '@/lib/db'
import { encodeKey } from '@/lib/db-types'
import type {
  InboxAccountSync, InboxClientSync, InboxCommentCache, InboxConversation as ConvoRow, InboxReplyLog, SocialAccount,
} from '@/lib/db-types'
import { getPublisher } from './publisher'
import { nextCursor, type InboxConversation, type InboxMessage } from './inbox-core'
import {
  annotateComments, clientsToRecheck, copyToList, correctFromThread, foldInboxEvent, fromLivePage, replyCounts,
  withoutUnsent, type AnnotatedComment, type CopyRow, type InboxEvent, type ZComment,
  replyLogRow,
} from './inbox-copy-core'

/**
 * THE INBOX COPY — the database half (rules in inbox-copy-core.ts). Every function here is best effort for the
 * page: a copy that cannot be written leaves the live answer standing, never an error on screen.
 */

const convos = () => table<ConvoRow>('inbox_conversations')
const accountSync = () => table<InboxAccountSync>('inbox_account_sync')
const clientSync = () => table<InboxClientSync>('inbox_client_sync')
const commentCache = () => table<InboxCommentCache>('inbox_comment_cache')
const replyLog = () => table<InboxReplyLog>('inbox_reply_log')

export const convoKey = (accountId: string, conversationId: string) => `${encodeKey(accountId)}__${encodeKey(conversationId)}`
export const postKey = (accountId: string, postId: string) => `${encodeKey(accountId)}__${encodeKey(postId)}`

const toCopy = (r: ConvoRow): CopyRow => ({
  data: r.data as InboxConversation,
  last_message_id: r.last_message_id,
  unsent_ids: Array.isArray(r.unsent_ids) ? (r.unsent_ids as string[]) : [],
})

async function writeRow(accountId: string, conversationId: string, row: CopyRow): Promise<void> {
  await convos().upsert({
    id: convoKey(accountId, conversationId), account_id: accountId, conversation_id: conversationId,
    data: row.data, updated_time: row.data.updatedTime ?? null, last_message_id: row.last_message_id,
    unsent_ids: row.unsent_ids, fetched_at: new Date().toISOString(),
  })
}

/* ── DMs ─────────────────────────────────────────────────────────────────── */

/** A webhook, folded into the copy. Uses claim() so two deliveries landing together both count. */
export async function applyInboxEvent(ev: InboxEvent): Promise<boolean> {
  try {
    // THE SAME CONVERSATION UNDER ANOTHER ID (6 Nov 2026): Zernio's list names an Instagram DM by the person's id,
    // its webhook by its own internal id — so each new message made a second row. Fold into the row the list
    // already has (participant id, then platform conversation id) when there is one; the webhook's own id otherwise.
    let target = ev.conversationId
    for (const alt of ev.otherIds ?? []) {
      if (alt === ev.conversationId) continue
      const hit = await convos().get(convoKey(ev.accountId, alt)).catch(() => null)
      if (hit) { target = alt; break }
    }
    ev = { ...ev, conversationId: target }
    const id = convoKey(ev.accountId, ev.conversationId)
    let changed = false
    await convos().claim(id, current => {
      const next = foldInboxEvent(current ? toCopy(current) : null, ev)
      if (!next) return null
      changed = true
      return {
        id, account_id: ev.accountId, conversation_id: ev.conversationId, data: next.data,
        updated_time: next.data.updatedTime ?? null, last_message_id: next.last_message_id,
        unsent_ids: next.unsent_ids, fetched_at: current?.fetched_at ?? new Date().toISOString(),
      }
    })
    return changed
  } catch (e) {
    console.error('[inbox copy] could not fold the event in:', e)
    return false
  }
}

/** The copy for these accounts, and the accounts that have none yet. */
export async function readConversationCopy(accountIds: readonly string[]): Promise<{
  list: InboxConversation[]; missing: string[]; fetchedAt: Map<string, string | null>; cursors: Record<string, string | null>
}> {
  const want = new Set(accountIds)
  const [rows, syncs] = await Promise.all([
    convos().list({ where: r => want.has(r.account_id) }).catch(() => [] as ConvoRow[]),
    accountSync().list({ where: r => want.has(r.id) }).catch(() => [] as InboxAccountSync[]),
  ])
  const fetchedAt = new Map(syncs.map(s => [s.id, s.fetched_at]))
  const cursors: Record<string, string | null> = {}
  for (const s of syncs) cursors[s.id] = s.cursor
  return {
    list: copyToList(rows),
    missing: accountIds.filter(a => !fetchedAt.get(a)),
    fetchedAt,
    cursors,
  }
}

/**
 * One page of one account's conversations, read live from Zernio and saved over the copy. `cursor` null = the newest
 * page (and the account's sync time moves); a cursor = "Load older". Returns the page, or null when Zernio failed.
 */
export async function refreshConversationPage(accountId: string, cursor: string | null): Promise<{
  list: InboxConversation[]; cursor: string | null
} | null> {
  const page = await getPublisher().listConversations({ accountId, limit: 50, cursor }).catch(() => null)
  if (!page) return null
  const raw = (page as { data?: unknown }).data
  const list = (Array.isArray(raw) ? raw : []) as InboxConversation[]
  const next = nextCursor(page)
  const existing = await convos().list({ by: { account_id: accountId } as Partial<ConvoRow> }).catch(() => [] as ConvoRow[])
  const byId = new Map(existing.map(r => [r.conversation_id, r]))
  const out: InboxConversation[] = []
  const writes: Promise<unknown>[] = []
  for (const c of list) {
    if (!c || typeof c.id !== 'string') continue
    const had = byId.get(c.id)
    const row = fromLivePage({ ...c, accountId: c.accountId ?? accountId }, had ? toCopy(had) : null)
    out.push(row.data)
    // only a row that changed is written
    if (!had || JSON.stringify(had.data) !== JSON.stringify(row.data)) writes.push(writeRow(accountId, c.id, row).catch(() => {}))
  }
  await Promise.all(writes)
  // the newest page sets the time and the place "Load older" starts; an older page only moves the cursor on
  const now = new Date().toISOString()
  await accountSync().upsert(cursor === null ? { id: accountId, cursor: next, fetched_at: now } : { id: accountId, cursor: next }).catch(() => {})
  return { list: out, cursor: next }
}

/**
 * ONE conversation, live: the newest 50 messages with every unsent one taken out, and the copy corrected from what
 * is really there. `opened` clears its unread count in the copy.
 */
export async function liveThread(conversationId: string, accountId: string, opened: boolean): Promise<InboxMessage[] | null> {
  const raw = await getPublisher().conversationMessages(conversationId, accountId, { latest: true }) as
    { data?: InboxMessage[]; messages?: InboxMessage[] } | InboxMessage[] | null
  if (raw == null) return null
  const newestFirst: InboxMessage[] = Array.isArray(raw) ? raw : raw?.data ?? raw?.messages ?? []
  const sorted = [...newestFirst].sort((a, b) => Date.parse(at(a)) - Date.parse(at(b)))
  const row = await convos().get(convoKey(accountId, conversationId)).catch(() => null)
  const copy = row ? toCopy(row) : null
  const messages = withoutUnsent(sorted, copy?.unsent_ids ?? [])
  if (copy) await writeRow(accountId, conversationId, correctFromThread(copy, messages, opened)).catch(() => {})
  return messages
}
const at = (m: InboxMessage) => m.createdTime ?? m.createdAt ?? m.timestamp ?? ''

/** Someone looked at this client's Inbox — the re-check covers it for the next few hours. */
export async function noteClientViewed(clientId: string): Promise<void> {
  await clientSync().claim(clientId, cur => ({
    id: clientId, viewed_at: new Date().toISOString(), checked_at: cur?.checked_at ?? null,
  })).catch(() => {})
}

/* ── comments ────────────────────────────────────────────────────────────── */

/** The reply log rows for these comment / conversation ids. */
export async function replyLogFor(targetIds: readonly string[]): Promise<InboxReplyLog[]> {
  if (!targetIds.length) return []
  const want = new Set(targetIds)
  return replyLog().list({ where: r => want.has(r.target_id) }).catch(() => [] as InboxReplyLog[])
}

/** Recent replies for these clients (null = every client), newest first: the "Reply log". */
export async function recentReplyLog(clientIds: readonly string[] | null, limit = 100): Promise<InboxReplyLog[]> {
  const want = clientIds ? new Set(clientIds) : null
  const rows = await replyLog().list({ where: r => !want || (!!r.client_id && want.has(r.client_id)) }).catch(() => [] as InboxReplyLog[])
  return rows.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit)
}

/** EVERY REPLY SENT FROM THE APP IS LOGGED: who on the team, when, where, and the words (6 Nov 2026). */
export async function logReply(r: {
  kind: 'comment' | 'private_reply' | 'dm'; teamUserId: string | null; byName: string | null; targetId: string
  postId?: string | null; accountId: string | null; text: string
}): Promise<void> {
  try {
    const account = r.accountId
      ? (await table<SocialAccount>('social_accounts').list({ where: a => a.provider_account_id === r.accountId, limit: 1 }))[0]
      : null
    await replyLog().insert(replyLogRow(r, account ?? null, new Date().toISOString()))
  } catch (e) { console.error('[inbox copy] could not log the reply:', e) }
}

/** One post's comments LIVE, annotated replied / needs a reply, and kept with their counts. */
export async function liveComments(postId: string, accountId: string | null): Promise<{ raw: unknown; comments: AnnotatedComment[] } | null> {
  const raw = await getPublisher().postComments(postId, accountId)
  if (raw == null) return null
  const r = raw as { comments?: ZComment[]; data?: ZComment[] } | ZComment[]
  const list: ZComment[] = Array.isArray(r) ? r : r.comments ?? r.data ?? []
  const comments = annotateComments(list, await replyLogFor(list.map(c => c.id)))
  if (accountId) {
    await commentCache().upsert({
      id: postKey(accountId, postId), account_id: accountId, post_id: postId, comments,
      ...replyCounts(comments), fetched_at: new Date().toISOString(),
    }).catch(() => {})
  }
  return { raw, comments }
}

export async function cachedComments(postId: string, accountId: string): Promise<{ comments: AnnotatedComment[]; fetched_at: string } | null> {
  const row = await commentCache().get(postKey(accountId, postId)).catch(() => null)
  return row && Array.isArray(row.comments) ? { comments: row.comments as AnnotatedComment[], fetched_at: row.fetched_at } : null
}

/** needs-a-reply counts per `<accountId>:<postId>`, for the post list. */
export async function needsReplyByPost(accountIds: readonly string[]): Promise<Map<string, { needs_reply: number; replied: number; fetched_at: string }>> {
  const want = new Set(accountIds)
  const rows = await commentCache().list({ where: r => want.has(r.account_id) }).catch(() => [] as InboxCommentCache[])
  return new Map(rows.map(r => [`${r.account_id}:${r.post_id}`, { needs_reply: r.needs_reply, replied: r.replied, fetched_at: r.fetched_at }]))
}

/** A comment arrived by webhook: its post's saved comments are now behind — drop them so the next open reads live
 *  and the post's count is not shown stale. Its "N new" comes from inbox_touches as before. */
export async function commentArrived(accountId: string | null, postId: string | null): Promise<void> {
  if (!accountId || !postId) return
  const row = await commentCache().get(postKey(accountId, postId)).catch(() => null)
  if (row) await commentCache().update(row.id, { fetched_at: new Date(0).toISOString() }).catch(() => {})
}

/* ── the 10-minute re-check ──────────────────────────────────────────────── */

/** Zernio allows about 10 requests every 2 seconds across the key; the re-check keeps to ~3 a second. */
const GAP_MS = 350
const pause = () => new Promise(r => setTimeout(r, GAP_MS))

/**
 * Clients somebody had open in the last 3 hours: each account's newest conversation page, then every saved post
 * copy that is behind (a comment arrived) or older than 30 minutes, newest 5 posts per account. Catches what no
 * webhook says: Facebook unsends, deleted comments, a missed delivery.
 */
export async function recheckRecentClients(now = Date.now()): Promise<{ clients: number; calls: number }> {
  const syncs = await clientSync().list({ fresh: true }).catch(() => [] as InboxClientSync[])
  const due = clientsToRecheck(syncs, now).slice(0, 8)
  if (!due.length) return { clients: 0, calls: 0 }
  const accounts = await table<SocialAccount>('social_accounts').list().catch(() => [] as SocialAccount[])
  let calls = 0
  for (const clientId of due) {
    const mine = accounts.filter(a => a.client_id === clientId && a.active !== false && a.provider_account_id)
    for (const a of mine) {
      await refreshConversationPage(String(a.provider_account_id), null); calls++; await pause()
      const posts = (await commentCache().list({ by: { account_id: String(a.provider_account_id) } as Partial<InboxCommentCache> }).catch(() => []))
        .filter(p => now - (Date.parse(p.fetched_at) || 0) > 30 * 60_000)
        .slice(0, 5)
      for (const p of posts) { await liveComments(p.post_id, p.account_id).catch(() => null); calls++; await pause() }
    }
    await clientSync().update(clientId, { checked_at: new Date().toISOString() }).catch(() => {})
  }
  return { clients: due.length, calls }
}

/** Run `fn` over `items` a few at a time — Zernio's inbox calls share one allowance. */
export async function inBatches<T, R>(items: readonly T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)))
  return out
}
