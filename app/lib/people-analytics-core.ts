/**
 * THE PEOPLE BEHIND THE NUMBERS — the pure half.
 *
 * Every other analytics screen counts things. This one names people: one row
 * per person per client account, joining the three lists the app already
 * keeps — who follows (`followers`), who liked or commented on a post we put
 * out (`post_analytics.interactors`), and who has spoken to the client in the
 * Inbox (`inbox_touches`). Nothing here fetches anything; it folds together
 * what the daily jobs already wrote.
 *
 * ── WHAT "FROM MD MEDIA" HONESTLY MEANS ───────────────────────────────────
 *
 * Instagram gives nobody a follow timestamp. Not the client, not us, not the
 * provider the follower list is read through. The only thing anyone can know
 * is the day somebody FIRST APPEARED in the follower list, which is the day
 * after we last looked and did not see them — so "followed on 5 Sep" really
 * means "was not there on the 4th and was there on the 5th".
 *
 * The interaction side is coarser still. A post's likers and commenters are
 * read once a day for the post's first week, and the list carries no per-
 * person time: we know a handle is among the likers, we do NOT know the hour,
 * or even the day, they pressed like. The best date available for an
 * interaction is the day the post went up.
 *
 * So the rule this module implements —
 *
 *     a person is LIKELY from us when they liked or commented on one of our
 *     posts that went out ON OR BEFORE the day they first appeared in the
 *     follower list
 *
 * — is a sequence of two soft dates, not a tracked click. It cannot be a
 * claim of cause, and the screen never makes one: the cell reads
 * "Likely — after ‘Hero reel’", never "Came from Hero reel". Three ways it
 * can be wrong, all of them acceptable and none of them hidden:
 *
 *   1. Somebody who already followed for a year and liked the post is not
 *      counted — their first_seen_at is null (they were there before we
 *      started watching) and a null never qualifies.
 *   2. Somebody who found the post through a friend's story on the same day
 *      they followed for an unrelated reason counts as "likely". Same day is
 *      as fine a resolution as the platform allows.
 *   3. A person who liked the post a week after following still shows the
 *      interaction under "What they did" — it just does not make them
 *      "likely from us", because the order is the wrong way round. (The
 *      other direction, "followed and THEN liked", is `followedFromPost` in
 *      followers-core; the two answer different questions and neither is a
 *      substitute for the other.)
 *
 * ── THE INBOX SIDE ────────────────────────────────────────────────────────
 *
 * "Reached out" is the last day a person appeared in the Inbox as a comment
 * author or the other half of a DM thread. The Inbox reads live from the
 * publisher, so `inbox_touches` is a note of who was seen the last time a
 * person opened it — see `inbox-people.ts` for what that does and does not
 * catch. A blank cell means "not seen in the Inbox", never "never wrote".
 */

import { shiftDay, shortDay, type FollowerRow } from './followers-core'

/* ── what goes in ──────────────────────────────────────────────────────── */

/** the little of a follower row this join reads */
export type PeopleFollower = Pick<
  FollowerRow,
  'username' | 'full_name' | 'profile_pic' | 'is_private' | 'is_verified' | 'first_seen_at' | 'gone_at'
>

/** one face, however we came to know it */
export type PeopleFace = {
  username: string
  full_name: string | null
  profile_pic: string | null
}

/** one of our posts, with everybody it is known to have touched */
export type PeoplePost = {
  item_id: string | null
  /** what the work is called — the words a person would recognise */
  title: string | null
  /** the post's own page, when we can address it */
  href: string | null
  /** the day it went out, Melbourne — null when it never published */
  day: string | null
  /** handles, lower-case, as `Interactors` stores them */
  likers: string[]
  commenters: string[]
  /** faces by lower-case handle */
  people: Record<string, PeopleFace>
}

/** somebody seen in the Inbox */
export type InboxTouch = {
  username: string
  name: string | null
  kind: InboxKind
  /** ISO instant of the last time they were seen there */
  last_at: string
}

export type InboxKind = 'comment' | 'message' | 'both'

/* ── what comes out ────────────────────────────────────────────────────── */

export type PeopleAction = {
  kind: 'liked' | 'commented' | 'liked and commented'
  item_id: string | null
  title: string
  href: string | null
  day: string | null
}

/** the "From MD Media" verdict — never stronger than the evidence */
export type FromUs = {
  likely: boolean
  /** the post they touched last before following */
  title: string | null
  day: string | null
}

export type PeopleRow = {
  /** the handle, lower-case — the key everything joins on */
  key: string
  username: string
  full_name: string | null
  profile_pic: string | null
  is_private: boolean
  is_verified: boolean
  profile_href: string
  /** newest first */
  actions: PeopleAction[]
  followed_on: string | null
  gone_on: string | null
  from_us: FromUs
  reached_out_on: string | null
  reached_out_how: InboxKind | null
  inbox_href: string
}

export const A_POST = 'a post'

/* ── addresses ─────────────────────────────────────────────────────────── */

export function instagramProfileHref(username: string): string {
  return `https://www.instagram.com/${encodeURIComponent(username.replace(/^@/, ''))}/`
}

/** the Inbox, opened on this person */
export function inboxPersonHref(username: string): string {
  return `/dashboard/social/inbox?who=${encodeURIComponent(username.replace(/^@/, ''))}`
}

/* ── the join ──────────────────────────────────────────────────────────── */

const key = (username: string) => username.trim().replace(/^@/, '').toLowerCase()

/** newest first; a day we do not know sorts last */
function byDayDesc(a: { day: string | null }, b: { day: string | null }): number {
  if (a.day === b.day) return 0
  if (a.day === null) return 1
  if (b.day === null) return -1
  return a.day < b.day ? 1 : -1
}

function mergeKind(a: InboxKind | null, b: InboxKind): InboxKind {
  if (a === null || a === b) return b
  return 'both'
}

/** the day part of an ISO instant, or null when it is not one */
export function dayOfInstant(iso: string | null | undefined): string | null {
  if (!iso || typeof iso !== 'string') return null
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso)
  return m ? m[1] : null
}

/**
 * One row per person: everybody we follow-watch, everybody who touched a
 * post, everybody in the Inbox — the union, not the intersection. A person
 * who liked a reel and never followed is exactly as interesting as one who
 * followed and said nothing, and both belong on the same table.
 */
export function buildPeople(input: {
  followers: readonly PeopleFollower[]
  posts: readonly PeoplePost[]
  inbox: readonly InboxTouch[]
}): PeopleRow[] {
  const rows = new Map<string, PeopleRow>()

  const blank = (username: string, face?: PeopleFace | null): PeopleRow => ({
    key: key(username),
    username: username.replace(/^@/, ''),
    full_name: face?.full_name ?? null,
    profile_pic: face?.profile_pic ?? null,
    is_private: false,
    is_verified: false,
    profile_href: instagramProfileHref(username),
    actions: [],
    followed_on: null,
    gone_on: null,
    from_us: { likely: false, title: null, day: null },
    reached_out_on: null,
    reached_out_how: null,
    inbox_href: inboxPersonHref(username),
  })

  const at = (username: string, face?: PeopleFace | null): PeopleRow | null => {
    const k = key(username)
    if (!k) return null
    const found = rows.get(k)
    if (found) {
      if (!found.full_name && face?.full_name) found.full_name = face.full_name
      if (!found.profile_pic && face?.profile_pic) found.profile_pic = face.profile_pic
      return found
    }
    const made = blank(username, face)
    rows.set(k, made)
    return made
  }

  for (const f of input.followers) {
    const row = at(f.username)
    if (!row) continue
    row.full_name = f.full_name ?? row.full_name
    row.profile_pic = f.profile_pic ?? row.profile_pic
    row.is_private = f.is_private
    row.is_verified = f.is_verified
    row.followed_on = f.first_seen_at
    row.gone_on = f.gone_at
  }

  for (const post of input.posts) {
    const liked = new Set(post.likers.map(key).filter(Boolean))
    const commented = new Set(post.commenters.map(key).filter(Boolean))
    for (const k of new Set([...liked, ...commented])) {
      const face = post.people[k] ?? null
      const row = at(face?.username ?? k, face)
      if (!row) continue
      const l = liked.has(k)
      const c = commented.has(k)
      row.actions.push({
        kind: l && c ? 'liked and commented' : l ? 'liked' : 'commented',
        item_id: post.item_id,
        title: post.title?.trim() || A_POST,
        href: post.href,
        day: post.day,
      })
    }
  }

  for (const touch of input.inbox) {
    const row = at(touch.username, { username: touch.username, full_name: touch.name, profile_pic: null })
    if (!row) continue
    const day = dayOfInstant(touch.last_at)
    if (day && (row.reached_out_on === null || day > row.reached_out_on)) row.reached_out_on = day
    row.reached_out_how = mergeKind(row.reached_out_how, touch.kind)
  }

  for (const row of rows.values()) {
    row.actions.sort((a, b) => byDayDesc(a, b) || a.title.localeCompare(b.title))
    row.from_us = likelyFromUs(row.followed_on, row.actions)
  }

  return [...rows.values()].sort(defaultOrder)
}

/**
 * THE RULE, on its own so it can be argued with.
 *
 * Likely from us when the person's first day in the follower list is known
 * AND they touched one of our posts that went out on or before that day. The
 * post named is the LAST such post — the one closest to the follow, which is
 * the one a person would point at.
 */
export function likelyFromUs(
  followedOn: string | null,
  actions: readonly Pick<PeopleAction, 'title' | 'day'>[],
): FromUs {
  if (!followedOn) return { likely: false, title: null, day: null }
  let best: { title: string; day: string } | null = null
  for (const a of actions) {
    if (!a.day || a.day > followedOn) continue
    if (!best || a.day > best.day) best = { title: a.title, day: a.day }
  }
  return best ? { likely: true, title: best.title, day: best.day } : { likely: false, title: null, day: null }
}

/** newest follower first, then whoever spoke most recently, then by handle */
export function defaultOrder(a: PeopleRow, b: PeopleRow): number {
  if (a.followed_on !== b.followed_on) {
    if (a.followed_on === null) return 1
    if (b.followed_on === null) return -1
    return a.followed_on < b.followed_on ? 1 : -1
  }
  if (a.reached_out_on !== b.reached_out_on) {
    if (a.reached_out_on === null) return 1
    if (b.reached_out_on === null) return -1
    return a.reached_out_on < b.reached_out_on ? 1 : -1
  }
  return a.username.localeCompare(b.username)
}

/* ── the period ────────────────────────────────────────────────────────── */

export const PERIODS = [30, 90] as const
export type Period = 30 | 90 | null

/** the first day inside a period; null means "everything we have" */
export function sinceDay(today: string, period: Period): string | null {
  return period === null ? null : shiftDay(today, -(period - 1))
}

/** did anything at all about this person happen inside the period? */
export function inPeriod(row: PeopleRow, since: string | null): boolean {
  if (since === null) return true
  if (row.followed_on && row.followed_on >= since) return true
  if (row.gone_on && row.gone_on >= since) return true
  if (row.reached_out_on && row.reached_out_on >= since) return true
  return row.actions.some(a => a.day !== null && a.day >= since)
}

/* ── search, sort, counts ──────────────────────────────────────────────── */

export function matchesPerson(row: PeopleRow, q: string): boolean {
  const needle = q.trim().replace(/^@/, '').toLowerCase()
  if (!needle) return true
  return row.username.toLowerCase().includes(needle) || (row.full_name ?? '').toLowerCase().includes(needle)
}

export type PeopleSort = 'person' | 'did' | 'followed' | 'from_us' | 'reached'
export type SortDir = 'asc' | 'desc'

/** the sensible first press of each column: dates newest first, names A–Z */
export function firstDirFor(sort: PeopleSort): SortDir {
  return sort === 'person' ? 'asc' : 'desc'
}

export function sortPeople(rows: readonly PeopleRow[], sort: PeopleSort, dir: SortDir): PeopleRow[] {
  const nulls = (v: string | null) => (v === null ? '' : v)
  const cmp = (a: PeopleRow, b: PeopleRow): number => {
    switch (sort) {
      case 'person': return a.username.localeCompare(b.username)
      case 'did': return a.actions.length - b.actions.length || a.username.localeCompare(b.username)
      case 'followed': return nulls(a.followed_on).localeCompare(nulls(b.followed_on)) || a.username.localeCompare(b.username)
      case 'from_us': return Number(a.from_us.likely) - Number(b.from_us.likely) || a.username.localeCompare(b.username)
      case 'reached': return nulls(a.reached_out_on).localeCompare(nulls(b.reached_out_on)) || a.username.localeCompare(b.username)
    }
  }
  const out = [...rows].sort(cmp)
  return dir === 'desc' ? out.reverse() : out
}

/** everything the table shows, in one pass: period, then search, then order */
export function viewPeople(rows: readonly PeopleRow[], view: {
  since: string | null
  q: string
  sort: PeopleSort
  dir: SortDir
}): PeopleRow[] {
  const kept = rows.filter(r => inPeriod(r, view.since) && matchesPerson(r, view.q))
  return sortPeople(kept, view.sort, view.dir)
}

export type PeopleCounts = {
  followersGained: number
  interactedFirst: number
  reachedOut: number
  postsPublished: number
}

/**
 * The four plain counts above the table, for the period.
 *
 * "Gained" counts people whose first day in the list falls inside the period
 * — somebody who was already there is not a gain, and somebody whose join day
 * we never knew cannot be dated into a period at all.
 */
export function peopleCounts(
  rows: readonly PeopleRow[],
  posts: readonly Pick<PeoplePost, 'day'>[],
  since: string | null,
): PeopleCounts {
  const within = (day: string | null) => day !== null && (since === null || day >= since)
  const gained = rows.filter(r => within(r.followed_on))
  return {
    followersGained: gained.length,
    interactedFirst: gained.filter(r => r.from_us.likely).length,
    reachedOut: rows.filter(r => within(r.reached_out_on)).length,
    postsPublished: posts.filter(p => within(p.day)).length,
  }
}

/* ── words ─────────────────────────────────────────────────────────────── */

/** "liked Hero reel" · "commented on Menu carousel" */
export function actionWords(a: Pick<PeopleAction, 'kind' | 'title'>): string {
  const what = a.title.trim() || A_POST
  return a.kind === 'liked' ? `liked ${what}` : `${a.kind} on ${what}`
}

/** the whole cell in one line, for a card or a CSV */
export function whatTheyDidWords(actions: readonly PeopleAction[]): string {
  if (actions.length === 0) return '—'
  const first = actionWords(actions[0])
  return actions.length === 1 ? first : `${first} · ${actions.length - 1} more`
}

/** "5 Sep" · "5 Sep, left 12 Sep" · "—" */
export function followedWordsFor(row: Pick<PeopleRow, 'followed_on' | 'gone_on'>): string {
  const gone = row.gone_on ? `left ${shortDay(row.gone_on)}` : ''
  if (!row.followed_on) return gone || '—'
  return gone ? `${shortDay(row.followed_on)}, ${gone}` : shortDay(row.followed_on)
}

/**
 * The most this cell is ever allowed to say. "Likely", and the post they
 * touched first — never "came from", which the dates cannot support.
 */
export function fromUsWords(from: FromUs): string {
  if (!from.likely) return '—'
  return from.title ? `Likely — after ‘${from.title}’` : 'Likely'
}

/** the one-line explanation under the column, in plain words */
export const FROM_US_EXPLAINER =
  'Someone who liked or commented on one of our posts on or before the day they first showed up in the follower list. ' +
  'Instagram never says when a person followed, so this is the order of two days we do know — a strong hint, not proof.'

export function reachedOutWords(row: Pick<PeopleRow, 'reached_out_on' | 'reached_out_how'>): string {
  if (!row.reached_out_on) return '—'
  const how = row.reached_out_how === 'comment' ? 'commented'
    : row.reached_out_how === 'message' ? 'messaged'
    : 'messaged and commented'
  return `${shortDay(row.reached_out_on)} — ${how}`
}

/** the one line a screen shows instead of an empty table */
export function emptyLine(state: PeopleState, clientName: string | null): string {
  const who = clientName ? `${clientName}’s` : 'this'
  switch (state) {
    case 'pick_client':
      return 'Choose a client above to see the people behind the numbers.'
    case 'not_instagram':
      return `${clientName ?? 'This client'} has no Instagram account connected yet, so there is nobody to list.`
    case 'off':
      return 'Follower watching is not switched on yet, so there is nobody to list.'
    case 'private':
      return `${who} Instagram account is private, so its followers can’t be listed and this table stays empty.`
    case 'waiting':
      return `Nobody has been looked at yet — the first look at ${who} followers happens tomorrow morning.`
    case 'ready':
      return 'Nobody yet for this period. Try a longer period, or clear the search.'
  }
}

export type PeopleState = 'pick_client' | 'not_instagram' | 'off' | 'private' | 'waiting' | 'ready'

/* ── the download ──────────────────────────────────────────────────────── */

export const CSV_HEADERS = [
  'Handle', 'Name', 'What they did', 'Followed', 'Left', 'From MD Media', 'Reached out', 'Profile',
] as const

function cell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** the table as a spreadsheet — the same words the screen shows, no ids */
export function peopleCsv(rows: readonly PeopleRow[]): string {
  const lines = [CSV_HEADERS.join(',')]
  for (const r of rows) {
    lines.push([
      `@${r.username}`,
      r.full_name ?? '',
      r.actions.length === 0 ? '' : r.actions.map(actionWords).join('; '),
      r.followed_on ?? '',
      r.gone_on ?? '',
      r.from_us.likely ? fromUsWords(r.from_us) : '',
      r.reached_out_on ? reachedOutWords(r) : '',
      r.profile_href,
    ].map(v => cell(String(v))).join(','))
  }
  return lines.join('\r\n')
}

/** `people-hillside-cafe-2026-09-07.csv` — a name a person can find again */
export function csvFilename(clientName: string | null, today: string): string {
  const slug = (clientName ?? 'clients').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'clients'
  return `people-${slug}-${today}.csv`
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
    const username = text(c.participantUsername) ?? text(p.username)
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
