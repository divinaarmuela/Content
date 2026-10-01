/**
 * WHO HAS BEEN SEEN IN THE INBOX — the pure half of `inbox-people.ts`.
 *
 * The Inbox reads live from the publisher (Zernio); these parsers read the
 * conversations and comments it already fetched, and decide which connected
 * account a sighting belongs to. Nothing here fetches anything.
 *
 * (Moved out of people-analytics-core.ts on 1 Oct 2026, when the People page
 * and the third-party follower read it was built on were removed.)
 */

/** somebody seen in the Inbox */
export type InboxTouch = {
  username: string
  name: string | null
  kind: InboxKind
  /** ISO instant of the last time they were seen there */
  last_at: string
  /** …and the first */
  first_at?: string | null
}

export type InboxKind = 'comment' | 'message' | 'both'

/* ── addresses ─────────────────────────────────────────────────────────── */

export function instagramProfileHref(username: string): string {
  return `https://www.instagram.com/${encodeURIComponent(username.replace(/^@/, ''))}/`
}

/** the Inbox, opened on this person */
export function inboxPersonHref(username: string): string {
  return `/dashboard/social/inbox?who=${encodeURIComponent(username.replace(/^@/, ''))}`
}

const key = (username: string) => username.trim().replace(/^@/, '').toLowerCase()

function mergeKind(a: InboxKind | null, b: InboxKind): InboxKind {
  if (a === null || a === b) return b
  return 'both'
}

/* ── reading the Inbox's own answers ───────────────────────────────────── */

/**
 * The Inbox holds nothing of its own: it asks the publisher for conversations
 * and comments every time somebody opens it, draws them, and forgets them.
 * So the only way to answer "did this person also reach out?" is to keep a
 * note of who those live answers named. These parsers do that reading —
 * loosely, the way the Inbox itself reads them, because the shapes vary by
 * platform and a shape we do not recognise must come back as "nobody", never
 * as a wrong name.
 */
export type TouchSeen = {
  username: string
  name: string | null
  kind: InboxKind
  /** ISO instant, or null when the payload carried no time */
  at: string | null
  conversation_id: string | null
  post_id: string | null
  account_id: string | null
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** whatever list a publisher answer is wrapped in */
function listOf(raw: unknown, ...fields: string[]): unknown[] {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') return []
  const it = raw as Record<string, unknown>
  for (const f of ['data', ...fields]) {
    const v = it[f]
    if (Array.isArray(v)) return v
    if (v && typeof v === 'object') {
      const nested = listOf(v, ...fields)
      if (nested.length) return nested
    }
  }
  return []
}

/** the DM threads a person's Inbox just loaded — one touch per participant */
export function touchesFromConversations(raw: unknown): TouchSeen[] {
  const out: TouchSeen[] = []
  for (const item of listOf(raw, 'conversations')) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    const p = (c.participant && typeof c.participant === 'object' ? c.participant : {}) as Record<string, unknown>
    // ONLY A THREAD THEY WROTE IN (30 Sep 2026: every conversation counted as "they DMed", including the ones our
    // own comment-to-DM automation opened — crestlineconsultants became an "MD Media lead … then DMed" without ever
    // writing). From the list alone the one sure sign is a message of theirs still unread; a thread opened in the
    // Inbox is noted from its messages (`touchFromThread`), and every new incoming DM from the webhook.
    const unread = typeof c.unreadCount === 'number' ? c.unreadCount : 0
    if (unread <= 0) continue
    // Instagram sometimes hands back only its numeric id as the "username" (30 Sep 2026: crestlineconsultants came
    // through as 2655487891576698, a row of its own with none of her history). A number is never a handle: the
    // participant's name is used when it reads as one, and otherwise the thread is not noted under a number.
    const given = text(c.participantUsername) ?? text(p.username)
    const named = text(c.participantName) ?? text(p.name)
    const username = given && !/^\d+$/.test(given) ? given
      : named && /^[A-Za-z0-9._]+$/.test(named) ? named
      : null
    if (!username) continue
    out.push({
      username,
      name: text(c.participantName) ?? text(p.name),
      kind: 'message',
      at: text(c.updatedTime) ?? text(c.lastMessageTime) ?? null,
      conversation_id: text(c.id),
      post_id: null,
      account_id: text(c.accountId),
    })
  }
  return out
}

/**
 * The comments on one post, as the thread pane just loaded them. `ours` is
 * the connected accounts' own handles: the client answering their own post is
 * not somebody reaching out, and counting them would make every post look
 * like a conversation.
 */
export function touchesFromComments(raw: unknown, ctx: {
  accountId: string | null
  postId: string | null
  ours?: readonly string[]
}): TouchSeen[] {
  const mine = new Set((ctx.ours ?? []).map(key).filter(Boolean))
  const out: TouchSeen[] = []
  for (const item of listOf(raw, 'comments')) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    const from = (c.from && typeof c.from === 'object' ? c.from : {}) as Record<string, unknown>
    const username = text(c.username) ?? text(from.username)
    if (!username || mine.has(key(username))) continue
    out.push({
      username,
      name: text(c.name) ?? text(from.name),
      kind: 'comment',
      at: text(c.createdTime) ?? text(c.timestamp) ?? null,
      conversation_id: null,
      post_id: ctx.postId,
      account_id: ctx.accountId,
    })
  }
  return out
}

/** the newest touch per person, so one write covers a page of repeats */
export function foldTouches(seen: readonly TouchSeen[]): TouchSeen[] {
  const by = new Map<string, TouchSeen>()
  for (const t of seen) {
    const k = key(t.username)
    if (!k) continue
    const prev = by.get(k)
    if (!prev) { by.set(k, { ...t }); continue }
    const kind = mergeKind(prev.kind, t.kind)
    by.set(k, (t.at ?? '') > (prev.at ?? '')
      ? { ...t, kind, name: t.name ?? prev.name }
      : { ...prev, kind, name: prev.name ?? t.name })
  }
  return [...by.values()]
}

/** the handle a touch is keyed by — lower-case, no leading @ */
export function touchHandle(username: string): string {
  return key(username)
}

/* ── one account per handle (29 Sep 2026) ─────────────────────────────────
 * The same Instagram account (testbusinessaccount2026) was connected twice in
 * Zernio, under two clients. Zernio delivers a comment once PER CONNECTED
 * ACCOUNT, and a touch is keyed by the account it came to, so one comment
 * became two `inbox_touches` rows — one per client. The rule: accounts that
 * share a platform and a handle are ONE account, and it belongs to the best
 * client among them. */

export type AccountForPick = {
  id: string
  provider_account_id: string
  platform: string
  username: string | null
  client_id: string | null
  active?: boolean | null
}
/** the client a `client_id` names, or null/undefined when there is no such client */
export type ClientForPick = { name?: string | null; status?: string | null } | null | undefined

/** "platform:handle" — the identity two connections of one real account share; null without a handle */
export function accountIdentity(a: Pick<AccountForPick, 'platform' | 'username'>): string | null {
  const handle = a.username ? key(a.username) : ''
  return handle ? `${String(a.platform).toLowerCase()}:${handle}` : null
}

/**
 * How good a home an account is, best first: linked to a client that exists and is not archived;
 * that client's name does not start with "ZZ" (the agency's test clients); the connection is live.
 */
function accountRank(a: AccountForPick, clientOf: (id: string) => ClientForPick): number[] {
  const c = a.client_id ? clientOf(a.client_id) : null
  const real = !!c && c.status !== 'archived'
  const notTest = real && !/^\s*zz/i.test(String(c?.name ?? ''))
  return [real ? 0 : 1, notTest ? 0 : 1, a.active === false ? 1 : 0]
}

/**
 * THE ONE ACCOUNT, among connections of the same platform + handle, that a touch or a follower
 * read is recorded for. Never drops the only match: one candidate is returned as it is, and an
 * empty list is null. Ties break on the provider account id, then the row id, so every webhook
 * delivery of the same comment lands on the same account.
 */
export function preferredAccount<T extends AccountForPick>(
  candidates: readonly T[], clientOf: (id: string) => ClientForPick,
): T | null {
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]
  const ranked = candidates.map(a => ({ a, r: accountRank(a, clientOf) }))
  ranked.sort((x, y) => {
    for (let i = 0; i < x.r.length; i++) if (x.r[i] !== y.r[i]) return x.r[i] - y.r[i]
    return x.a.provider_account_id.localeCompare(y.a.provider_account_id) || x.a.id.localeCompare(y.a.id)
  })
  return ranked[0].a
}

/**
 * The account a touch that arrived on `providerAccountId` is recorded for: itself, unless another
 * connection of the same platform + handle is a better home. An unknown account is returned as
 * null, so the caller keeps the id it was given.
 */
export function canonicalAccount<T extends AccountForPick>(
  accounts: readonly T[], providerAccountId: string, clientOf: (id: string) => ClientForPick,
): T | null {
  const self = accounts.find(a => a.provider_account_id === providerAccountId)
  if (!self) return null
  const id = accountIdentity(self)
  if (!id) return self
  return preferredAccount(accounts.filter(a => accountIdentity(a) === id), clientOf) ?? self
}

/** One account per platform + handle, the preferred one; accounts with no handle are all kept. Order kept. */
export function onePerIdentity<T extends AccountForPick>(
  accounts: readonly T[], clientOf: (id: string) => ClientForPick,
): T[] {
  const groups = new Map<string, T[]>()
  for (const a of accounts) {
    const id = accountIdentity(a)
    if (id) groups.set(id, [...(groups.get(id) ?? []), a])
  }
  return accounts.filter(a => {
    const id = accountIdentity(a)
    return !id || preferredAccount(groups.get(id)!, clientOf) === a
  })
}

/** folding one sighting into the row we already had */
export function nextTouch(
  prev: { kind: string; first_at: string; last_at: string; name: string | null } | null,
  seen: Pick<TouchSeen, 'kind' | 'at' | 'name'>,
  now: string,
): { kind: InboxKind; first_at: string; last_at: string; name: string | null } {
  const at = seen.at ?? now
  if (!prev) return { kind: seen.kind, first_at: at, last_at: at, name: seen.name }
  const was = prev.kind === 'comment' || prev.kind === 'message' || prev.kind === 'both' ? prev.kind : seen.kind
  return {
    kind: mergeKind(was, seen.kind),
    first_at: prev.first_at < at ? prev.first_at : at,
    last_at: prev.last_at > at ? prev.last_at : at,
    name: seen.name ?? prev.name,
  }
}

/** A thread just read in the Inbox: a touch only when THEY wrote in it, dated by their last message. */
export function touchFromThread(
  convo: { id?: string; accountId?: string; participantName?: string; participantUsername?: string },
  lastTheirs: string | null,
): TouchSeen[] {
  if (!lastTheirs) return []
  return touchesFromConversations({ data: [{ ...convo, unreadCount: 1, updatedTime: lastTheirs }] })
}
