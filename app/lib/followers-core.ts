/**
 * WHO FOLLOWS — the list, who joined, who left. The pure half.
 *
 * Instagram tells nobody when somebody followed. What it does do is hand the
 * follower list back NEWEST FIRST, so the only way to know a join date is to
 * look regularly and notice who was not there yesterday. That is what this
 * feature is: a daily look at the newest N (cheap — one or two provider
 * requests — and every new follower is in that slice), and a full read of
 * the list once a week or once a month (capped) which is the only look that
 * may say somebody LEFT.
 *
 * The provider is behind `FollowerSource` (follower-source.ts) and its name
 * never reaches a screen — the owner's rule. Nothing in here does I/O, so all
 * of it is unit-tested: the parsers, the diff, the piles, the guards.
 */

export const MELBOURNE = 'Australia/Melbourne'

/** the newest-N read every morning, unless a client chose otherwise */
export const DAILY_TOP_DEFAULT = 100
export const DAILY_TOP_MIN = 25
export const DAILY_TOP_MAX = 500
/** the most a full read will ever pull — ~400 requests on a 50-a-page source */
export const FULL_CAP = 20_000
/** a full read of a bigger account than the cap is not "the list", and must
 *  never mark anyone as gone — see fullReadComplete() */
export const COMPLETE_RATIO = 0.9
/** followers per provider request, as observed live (v1 chunk: 50) */
export const PAGE_SIZE = 50
/** what one provider request costs — kept server-side, never rendered */
export const REQUEST_COST_USD = 0.001
/** a "Refresh now" is honoured once an hour per account */
export const REFRESH_MIN_GAP_MS = 60 * 60 * 1000
/** a "new this week" / "left this week" pile looks back this far */
export const WEEK_DAYS = 7

export type SnapshotMode = 'top' | 'full'
export type SnapshotTrigger = 'scheduled' | 'manual'
export type FullCadence = 'weekly' | 'monthly' | 'off'
export type SnapshotStatus = 'running' | 'done' | 'private' | 'failed'

export type FollowerRow = {
  id: string
  account_id: string
  client_id: string
  pk: string
  username: string
  full_name: string | null
  profile_pic: string | null
  is_private: boolean
  is_verified: boolean
  /** the day we first saw them; null = already there when watching began */
  first_seen_at: string | null
  last_seen_at: string
  /** the day a full read found them missing; null while they follow */
  gone_at: string | null
  /** where the last look found them, 0 = newest */
  position_last: number | null
  updated_at?: string
}

export type FollowerSnapshotRow = {
  id: string
  account_id: string
  client_id: string
  platform: string
  mode: SnapshotMode
  trigger: SnapshotTrigger
  day: string
  taken_at: string
  count: number | null
  seen: number
  requests: number
  limit: number
  cursor: string | null
  user_pk: string | null
  seeded: boolean
  source: string
  cost_note: string | null
  status: SnapshotStatus
  error: string | null
  created_at?: string
  updated_at?: string
}

/** one person, as the source hands them over, trimmed to what we keep */
export type SourceFollower = {
  pk: string
  username: string
  full_name: string | null
  profile_pic: string | null
  is_private: boolean
  is_verified: boolean
}

export type SourceProfile = {
  pk: string
  username: string
  is_private: boolean
  follower_count: number | null
}

/* ── time ──────────────────────────────────────────────────────────────── */

/** `YYYY-MM-DD` in a zone — the calendar day a look belongs to */
export function dayKey(now: Date, tz: string = MELBOURNE): string {
  return now.toLocaleDateString('en-CA', { timeZone: tz })
}

/** the snapshot id — CLAIMED, so the bucket is the whole once-per guard */
export function snapshotId(accountId: string, mode: SnapshotMode, bucket: string): string {
  return `${accountId}:${mode}:${bucket}`
}

/** a scheduled look is bucketed by day; a "Refresh now" by the hour */
export function snapshotBucket(trigger: SnapshotTrigger, now: Date, tz: string = MELBOURNE): string {
  const day = dayKey(now, tz)
  if (trigger === 'scheduled') return day
  const hour = now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).slice(0, 2)
  return `${day}T${hour}`
}

/** shift a `YYYY-MM-DD` by whole days (UTC arithmetic on the calendar) */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/* ── settings ──────────────────────────────────────────────────────────── */

export type FollowerSettings = {
  dailyTop: number
  fullCadence: FullCadence
  onPortal: boolean
}

export function isFullCadence(v: unknown): v is FullCadence {
  return v === 'weekly' || v === 'monthly' || v === 'off'
}

/** the client's three choices, with the defaults for a client who never chose */
export function settingsOf(client: {
  followers_daily_top?: number | null
  followers_full_cadence?: string | null
  followers_on_portal?: boolean | null
} | null | undefined): FollowerSettings {
  const top = typeof client?.followers_daily_top === 'number' && Number.isFinite(client.followers_daily_top)
    ? Math.min(DAILY_TOP_MAX, Math.max(DAILY_TOP_MIN, Math.round(client.followers_daily_top)))
    : DAILY_TOP_DEFAULT
  return {
    dailyTop: top,
    fullCadence: isFullCadence(client?.followers_full_cadence) ? client.followers_full_cadence : 'monthly',
    onPortal: client?.followers_on_portal === true,
  }
}

/** which look today is: the full one on its day, the top-N every other day */
export function modeForDay(cadence: FullCadence, day: string): SnapshotMode {
  if (cadence === 'off') return 'top'
  const d = new Date(`${day}T00:00:00Z`)
  if (cadence === 'weekly') return d.getUTCDay() === 1 ? 'full' : 'top'   // Monday
  return d.getUTCDate() === 1 ? 'full' : 'top'                           // the 1st
}

export function limitFor(mode: SnapshotMode, settings: FollowerSettings): number {
  return mode === 'full' ? FULL_CAP : settings.dailyTop
}

/* ── the source's answers ──────────────────────────────────────────────── */

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null)
const httpsUrl = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\//.test(v) ? v : null)

export function fromSourceUser(u: unknown): SourceFollower | null {
  if (!u || typeof u !== 'object') return null
  const it = u as Record<string, unknown>
  const pk = str(it.pk) ?? str(it.id)
  const username = str(it.username)
  if (!pk || !username) return null
  return {
    pk,
    username: username.slice(0, 80),
    full_name: str(it.full_name)?.slice(0, 120) ?? null,
    profile_pic: httpsUrl(it.profile_pic_url),
    is_private: it.is_private === true,
    is_verified: it.is_verified === true,
  }
}

export function parseProfile(json: unknown): SourceProfile | null {
  if (!json || typeof json !== 'object') return null
  const it = json as Record<string, unknown>
  const pk = str(it.pk) ?? str(it.id)
  const username = str(it.username)
  if (!pk || !username) return null
  return {
    pk, username,
    is_private: it.is_private === true,
    follower_count: typeof it.follower_count === 'number' ? it.follower_count : null,
  }
}

/**
 * One page of followers. The provider's OpenAPI says `[users[], cursor]`; its
 * help page shows `{ users, next_max_id }`; the GraphQL variant says
 * `end_cursor`. Live it was the tuple. All three are read, because a shape
 * that changed under us must read as "no page", never as "the list ended".
 */
export function parseChunk(json: unknown): { users: SourceFollower[]; next: string | null } | null {
  let rawUsers: unknown
  let rawNext: unknown
  if (Array.isArray(json)) {
    if (!Array.isArray(json[0])) return null
    rawUsers = json[0]
    rawNext = json[1]
  } else if (json && typeof json === 'object') {
    const it = json as Record<string, unknown>
    rawUsers = it.users
    rawNext = it.next_max_id ?? it.end_cursor ?? it.next ?? null
    if (!Array.isArray(rawUsers)) return null
  } else {
    return null
  }
  const users = (rawUsers as unknown[]).map(fromSourceUser).filter((u): u is SourceFollower => u !== null)
  return { users, next: str(rawNext) }
}

/* ── the diff ──────────────────────────────────────────────────────────── */

export function followerId(accountId: string, pk: string): string {
  return `${accountId}:${pk}`
}

/**
 * A page of people seen today, folded into what we already knew.
 *
 * Seen today → last_seen_at is today and they are not gone. A stranger is
 * NEW only when an earlier look had finished (`seeded`): on the very first
 * look everybody is a stranger and nobody joined today — their join date is
 * "before we started watching", stored as null and shown as "—".
 */
export function applySeen(input: {
  existing: ReadonlyMap<string, FollowerRow>
  seen: SourceFollower[]
  accountId: string
  clientId: string
  day: string
  seeded: boolean
  /** how many were already read before this page — positions continue */
  offset: number
}): FollowerRow[] {
  const { existing, seen, accountId, clientId, day, seeded, offset } = input
  const out: FollowerRow[] = []
  const done = new Set<string>()
  for (const u of seen) {
    if (done.has(u.pk)) continue
    done.add(u.pk)
    const id = followerId(accountId, u.pk)
    const was = existing.get(id)
    out.push({
      id, account_id: accountId, client_id: clientId, pk: u.pk,
      username: u.username, full_name: u.full_name, profile_pic: u.profile_pic,
      is_private: u.is_private, is_verified: u.is_verified,
      first_seen_at: was ? was.first_seen_at : (seeded ? day : null),
      last_seen_at: day,
      gone_at: null,
      position_last: offset + out.length,
    })
  }
  return out
}

/** After a COMPLETE full read: everyone we knew who was not seen today left. */
export function markLeft(rows: Iterable<FollowerRow>, day: string): FollowerRow[] {
  const out: FollowerRow[] = []
  for (const r of rows) {
    if (r.gone_at === null && r.last_seen_at !== day) out.push({ ...r, gone_at: day })
  }
  return out
}

/**
 * Was the whole list read? Only then may anyone be marked as gone.
 *
 * A null cursor is NOT proof on its own: live, a 104-million-follower account
 * answered its first page of 50 with a null cursor — the platform stops
 * paginating the very big ones. So the read must also have reached (nearly)
 * the count the profile reported, or the cap when the account is over it.
 * An account over the cap is therefore never told anyone left, and the page
 * says so in words.
 */
export function fullReadComplete(s: Pick<FollowerSnapshotRow, 'mode' | 'cursor' | 'seen' | 'count' | 'limit'>): boolean {
  if (s.mode !== 'full') return false
  if (s.cursor !== null) return false
  if (s.count === null) return false
  if (s.count > s.limit) return false
  return s.seen >= Math.floor(s.count * COMPLETE_RATIO)
}

/** should the read stop after this page? */
export function readFinished(s: Pick<FollowerSnapshotRow, 'cursor' | 'seen' | 'limit'>): boolean {
  return s.cursor === null || s.seen >= s.limit
}

export function costNote(requests: number): string {
  const usd = Math.max(0.001, requests * REQUEST_COST_USD)
  return `~$${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)}`
}

/* ── guards ────────────────────────────────────────────────────────────── */

export type RefreshVerdict = { ok: true } | { ok: false; reason: 'running' | 'too_soon'; retryAt: string }

/** a "Refresh now" against the latest look at this account */
export function refreshAllowed(latest: Pick<FollowerSnapshotRow, 'status' | 'taken_at'> | null, now: Date): RefreshVerdict {
  if (!latest) return { ok: true }
  const at = Date.parse(latest.taken_at)
  if (latest.status === 'running' && now.getTime() - at < REFRESH_MIN_GAP_MS) {
    return { ok: false, reason: 'running', retryAt: new Date(at + REFRESH_MIN_GAP_MS).toISOString() }
  }
  if (now.getTime() - at < REFRESH_MIN_GAP_MS) {
    return { ok: false, reason: 'too_soon', retryAt: new Date(at + REFRESH_MIN_GAP_MS).toISOString() }
  }
  return { ok: true }
}

/** the newest look, by when it was taken */
export function latestOf<T extends { taken_at: string }>(rows: T[]): T | null {
  return rows.reduce<T | null>((best, r) => (!best || r.taken_at > best.taken_at ? r : best), null)
}

/* ── the piles ─────────────────────────────────────────────────────────── */

export type FollowerPiles = {
  /** joined in the last week, newest day first, newest within a day first */
  newThisWeek: { day: string; rows: FollowerRow[] }[]
  /** left in the last week, most recent first */
  leftThisWeek: FollowerRow[]
  /** everybody still following, newest first */
  all: FollowerRow[]
  /** the size of `all` before any page cap */
  following: number
}

/** newest first: seen most recently, then by where the look found them */
export function newestFirst(a: FollowerRow, b: FollowerRow): number {
  if (a.last_seen_at !== b.last_seen_at) return a.last_seen_at < b.last_seen_at ? 1 : -1
  const pa = a.position_last ?? Number.MAX_SAFE_INTEGER
  const pb = b.position_last ?? Number.MAX_SAFE_INTEGER
  if (pa !== pb) return pa - pb
  return a.username.localeCompare(b.username)
}

export function piles(rows: FollowerRow[], today: string): FollowerPiles {
  const since = shiftDay(today, -(WEEK_DAYS - 1))
  const following = rows.filter(r => r.gone_at === null).sort(newestFirst)
  const byDay = new Map<string, FollowerRow[]>()
  for (const r of following) {
    if (r.first_seen_at && r.first_seen_at >= since) {
      const list = byDay.get(r.first_seen_at) ?? []
      list.push(r)
      byDay.set(r.first_seen_at, list)
    }
  }
  const newThisWeek = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, list]) => ({ day, rows: list }))
  const leftThisWeek = rows
    .filter(r => r.gone_at !== null && r.gone_at >= since)
    .sort((a, b) => (a.gone_at! < b.gone_at! ? 1 : a.gone_at! > b.gone_at! ? -1 : a.username.localeCompare(b.username)))
  return { newThisWeek, leftThisWeek, all: following, following: following.length }
}

/** a name search over the All pile — handle or name, case-blind */
export function matchesSearch(r: Pick<FollowerRow, 'username' | 'full_name'>, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return r.username.toLowerCase().includes(needle) || (r.full_name ?? '').toLowerCase().includes(needle)
}

/* ── words ─────────────────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "5 Sep" from a `YYYY-MM-DD` — spelled here, not by the locale, which
 *  says "Sept" on some machines and "Sep" on others */
export function shortDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return day
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`
}

/** the day a follower joined, in words; "—" when it was before we watched */
export function followedWords(r: Pick<FollowerRow, 'first_seen_at'>): string {
  return r.first_seen_at ? `Followed on ${shortDay(r.first_seen_at)}` : '—'
}

export function leftWords(r: Pick<FollowerRow, 'gone_at'>): string {
  return r.gone_at ? `Left on ${shortDay(r.gone_at)}` : ''
}

/** the line under the count on the tab, from the latest finished look */
export function lastLookWords(latest: Pick<FollowerSnapshotRow, 'status' | 'day' | 'mode' | 'seen' | 'count' | 'limit' | 'cursor'> | null): string {
  if (!latest) return 'Not looked at yet — the first look happens tomorrow morning.'
  if (latest.status === 'running') return 'Looking now…'
  if (latest.status === 'private') return 'This account is private, so its followers can’t be listed.'
  if (latest.status === 'failed') return `The last look, on ${shortDay(latest.day)}, didn’t finish. It will try again tomorrow morning.`
  if (latest.mode === 'full') {
    return fullReadComplete(latest)
      ? `Whole list read on ${shortDay(latest.day)}.`
      : `Read the newest ${latest.seen.toLocaleString()} on ${shortDay(latest.day)} — the whole list couldn’t be read, so nobody is marked as having left.`
  }
  return `Newest ${latest.seen.toLocaleString()} checked on ${shortDay(latest.day)}.`
}

/* ── the portal's copy ─────────────────────────────────────────────────── */

export type PortalFollower = {
  username: string
  full_name: string | null
  profile_pic: string | null
  is_verified: boolean
  day: string
}

export type PortalFollowers = {
  count: number | null
  new_this_week: PortalFollower[]
  left_this_week: PortalFollower[]
  as_of: string | null
  /** per recent post: who followed and then liked or commented on it */
  from_posts: { title: string; count: number; names: string[] }[]
}

/**
 * What the client's portal is told: names, faces, the day. Never an id, a
 * status, an error, a cost or a source — the same sanitising every other
 * portal payload gets. Names of PRIVATE accounts are kept: the client's own
 * follower list shows them the same names on Instagram.
 */
export function portalFollowers(input: {
  rows: FollowerRow[]
  count: number | null
  today: string
  latest: Pick<FollowerSnapshotRow, 'status' | 'day'> | null
  posts?: { title: string | null; followed: Pick<FollowedFromPost, 'username' | 'full_name'>[] }[]
}): PortalFollowers {
  const p = piles(input.rows, input.today)
  const strip = (r: FollowerRow, day: string): PortalFollower => ({
    username: r.username, full_name: r.full_name, profile_pic: r.profile_pic, is_verified: r.is_verified, day,
  })
  return {
    count: input.count,
    new_this_week: p.newThisWeek.flatMap(d => d.rows.map(r => strip(r, d.day))).slice(0, 200),
    left_this_week: p.leftThisWeek.map(r => strip(r, r.gone_at!)).slice(0, 200),
    as_of: input.latest && input.latest.status !== 'running' ? input.latest.day : null,
    from_posts: (input.posts ?? [])
      .filter(p => p.followed.length > 0)
      .map(p => ({
        title: p.title?.trim() || 'a post',
        count: p.followed.length,
        names: p.followed.slice(0, 12).map(f => f.full_name || `@${f.username}`),
      })),
  }
}

/* ── who interacted with a post, and who followed from it ─────────────── */

/** a post's likers and commenters are read once a day for this long */
export const INTERACTORS_DAYS = 7
/** comment pages read per day per post — a handful of requests, never a loop */
export const COMMENT_PAGES_MAX = 3

/** one person who liked or commented — the little that the cross needs */
export type Interactor = {
  username: string
  full_name: string | null
  profile_pic: string | null
}

/** somebody who followed on or after the post went up AND liked or commented */
export type FollowedFromPost = Interactor & {
  how: 'liked' | 'commented' | 'liked and commented'
  followed_on: string
}

/** what is stored on the post's analytics row, beside `performance` */
export type Interactors = {
  /** the platform's id for the post, cached after the first look */
  media_id: string | null
  /** usernames, lower-case — the cross joins on these */
  likers: string[]
  commenters: string[]
  /** faces and names, by username, for the avatar row */
  people: Record<string, Interactor>
  fetched_at: string | null
  /** the day of the last read, Melbourne — the once-a-day guard */
  fetched_day: string | null
  reads: number
  /** the cross with the account's followers, recomputed after every look */
  followed: FollowedFromPost[]
  status: 'running' | 'done' | 'failed' | 'disabled'
  error: string | null
}

export function emptyInteractors(): Interactors {
  return {
    media_id: null, likers: [], commenters: [], people: {}, fetched_at: null, fetched_day: null,
    reads: 0, followed: [], status: 'done', error: null,
  }
}

export function readInteractors(v: unknown): Interactors | null {
  if (!v || typeof v !== 'object') return null
  const it = v as Partial<Interactors>
  const names = (x: unknown) => Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []
  return {
    media_id: typeof it.media_id === 'string' ? it.media_id : null,
    likers: names(it.likers),
    commenters: names(it.commenters),
    people: it.people && typeof it.people === 'object' ? it.people as Record<string, Interactor> : {},
    fetched_at: typeof it.fetched_at === 'string' ? it.fetched_at : null,
    fetched_day: typeof it.fetched_day === 'string' ? it.fetched_day : null,
    reads: typeof it.reads === 'number' ? it.reads : 0,
    followed: Array.isArray(it.followed) ? it.followed as FollowedFromPost[] : [],
    status: it.status === 'running' || it.status === 'failed' || it.status === 'disabled' ? it.status : 'done',
    error: typeof it.error === 'string' ? it.error : null,
  }
}

/** the platform's media id off the source's media object */
export function parseMediaId(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const it = json as Record<string, unknown>
  return str(it.id) ?? str(it.pk)
}

/** `/media/likers` answers a flat list of people */
export function parseLikers(json: unknown): Interactor[] | null {
  const list = Array.isArray(json) ? json : (json && typeof json === 'object' && Array.isArray((json as { users?: unknown }).users))
    ? (json as { users: unknown[] }).users : null
  if (!list) return null
  return list.map(fromSourceUser).filter((u): u is SourceFollower => u !== null)
    .map(u => ({ username: u.username, full_name: u.full_name, profile_pic: u.profile_pic }))
}

/** `/media/comments/chunk` answers `[comments[], cursor, …]`; each comment carries its `user` */
export function parseCommentsChunk(json: unknown): { people: Interactor[]; next: string | null } | null {
  let list: unknown
  let next: unknown = null
  if (Array.isArray(json) && Array.isArray(json[0])) { list = json[0]; next = json[1] }
  else if (Array.isArray(json)) { list = json }
  else if (json && typeof json === 'object') {
    const it = json as Record<string, unknown>
    list = it.comments ?? it.items
    next = it.next_max_id ?? it.next_min_id ?? it.end_cursor ?? null
  }
  if (!Array.isArray(list)) return null
  const people = list
    .map(c => (c && typeof c === 'object' ? fromSourceUser((c as { user?: unknown }).user) : null))
    .filter((u): u is SourceFollower => u !== null)
    .map(u => ({ username: u.username, full_name: u.full_name, profile_pic: u.profile_pic }))
  return { people, next: str(next) }
}

/** the day the post went up, Melbourne */
export function postDay(publishedAt: string | null | undefined, tz: string = MELBOURNE): string | null {
  if (!publishedAt) return null
  const t = Date.parse(publishedAt)
  if (!Number.isFinite(t)) return null
  return dayKey(new Date(t), tz)
}

/** is this post inside its first week — the only time its likers are read */
export function postWindowOpen(publishedAt: string | null | undefined, today: string): boolean {
  const day = postDay(publishedAt)
  if (!day) return false
  return day <= today && day > shiftDay(today, -INTERACTORS_DAYS)
}

/** fold a day's read into what the row already held — sets are unioned, never replaced */
export function mergeInteractors(prev: Interactors | null, read: {
  media_id: string | null
  likers: Interactor[]
  commenters: Interactor[]
  now: string
  today: string
}): Interactors {
  const base = prev ?? emptyInteractors()
  const people = { ...base.people }
  const key = (p: Interactor) => p.username.toLowerCase()
  for (const p of [...read.likers, ...read.commenters]) people[key(p)] = p
  const union = (a: string[], b: Interactor[]) => [...new Set([...a, ...b.map(key)])]
  return {
    ...base,
    media_id: read.media_id ?? base.media_id,
    likers: union(base.likers, read.likers),
    commenters: union(base.commenters, read.commenters),
    people,
    fetched_at: read.now,
    fetched_day: read.today,
    reads: base.reads + 1,
    status: 'done',
    error: null,
  }
}

/**
 * THE CROSS: who followed from this post.
 *
 * A follower whose join day is on or after the post's day, within the
 * post's first week, and whose handle is among the post's likers or
 * commenters. A join day we do not know (null — they were already there)
 * never counts: the claim is "followed, then interacted", and it is only
 * made when both halves are known.
 */
export function followedFromPost(input: {
  followers: Pick<FollowerRow, 'username' | 'full_name' | 'profile_pic' | 'first_seen_at' | 'gone_at'>[]
  interactors: Pick<Interactors, 'likers' | 'commenters' | 'people'> | null
  publishedAt: string | null | undefined
}): FollowedFromPost[] {
  const day = postDay(input.publishedAt)
  if (!day || !input.interactors) return []
  const until = shiftDay(day, INTERACTORS_DAYS)
  const liked = new Set(input.interactors.likers.map(s => s.toLowerCase()))
  const commented = new Set(input.interactors.commenters.map(s => s.toLowerCase()))
  const out: FollowedFromPost[] = []
  for (const f of input.followers) {
    if (!f.first_seen_at || f.first_seen_at < day || f.first_seen_at > until) continue
    const u = f.username.toLowerCase()
    const l = liked.has(u), c = commented.has(u)
    if (!l && !c) continue
    const face = input.interactors.people[u]
    out.push({
      username: f.username,
      full_name: f.full_name ?? face?.full_name ?? null,
      profile_pic: f.profile_pic ?? face?.profile_pic ?? null,
      how: l && c ? 'liked and commented' : l ? 'liked' : 'commented',
      followed_on: f.first_seen_at,
    })
  }
  return out.sort((a, b) => a.followed_on < b.followed_on ? 1 : a.followed_on > b.followed_on ? -1 : a.username.localeCompare(b.username))
}

/** "7 from this post" — the board card's extra bit, or null */
export function fromThisPostBit(followed: FollowedFromPost[] | null | undefined): string | null {
  const n = followed?.length ?? 0
  return n > 0 ? `${n} from this post` : null
}

/** the board line with the cross folded in: "42 interactions · +12 followers · 7 from this post" */
export function withFromThisPost(line: string | null, followed: FollowedFromPost[] | null | undefined): string | null {
  const bit = fromThisPostBit(followed)
  if (!bit) return line
  return line ? `${line} · ${bit}` : bit
}

/** the How-it-did sentence: "7 of them liked or commented on this post" */
export function fromThisPostLine(followed: FollowedFromPost[] | null | undefined): string | null {
  const n = followed?.length ?? 0
  if (n === 0) return null
  return n === 1 ? '1 of them liked or commented on this post' : `${n} of them liked or commented on this post`
}

/** the chip on a new follower in the Followers tab: "liked Hero reel" */
export function fromPostChip(how: FollowedFromPost['how'], title: string | null): string {
  const what = title?.trim() || 'a post'
  return `${how} ${what}`
}
