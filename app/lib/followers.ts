import 'server-only'
import { rtdbFetch, table } from '@/lib/db'
import type { Client, SocialAccount } from '@/lib/db-types'
import { configuredSource, followersEnabled, type FollowerSource } from './follower-source'
import {
  applySeen, costNote, dayKey, followerId, fullReadComplete, latestOf, limitFor, markLeft,
  modeForDay, readFinished, refreshAllowed, settingsOf, snapshotBucket, snapshotId,
  type FollowerRow, type FollowerSnapshotRow, type SnapshotMode, type SnapshotTrigger,
} from './followers-core'

/**
 * WHO FOLLOWS — the database half.
 *
 * A look at an account is a `follower_snapshots` row, CLAIMED on
 * `<account>:<mode>:<bucket>` (CLAUDE.md trap 11): the claim IS the
 * once-per-day guard, and a "Refresh now" buckets by the hour so it is the
 * once-per-hour guard too. The read then advances a page at a time —
 * `advanceSnapshot` — because a full list is hundreds of sequential provider
 * requests and no single request handler lives that long. Progress (cursor,
 * pages read) lives on the row, so a step that dies is resumed from where
 * the row says, never from the start.
 *
 * Every follower seen is written as it is seen (one row per person, id
 * `<account>:<pk>`), which is why the pages need no buffer between steps:
 * "seen today" is a fact about the row, and "left" is worked out at the end
 * from the rows that were NOT seen today — only after a full read that
 * demonstrably reached the end of the list.
 *
 * Reads of an account's followers are key-range queries (`orderBy=$key`
 * with the account prefix), so they need no `.indexOn` in the rules and
 * never read another account's people.
 */

const SNAPSHOTS = 'follower_snapshots'
const FOLLOWERS = 'followers'
/** pages per advance — ~50 requests, well inside one function's time */
export const PAGES_PER_STEP = 40
/** the most advances one look is allowed: 20 × 40 pages × 50 = 40,000 people */
export const MAX_STEPS = 20
const WRITE_CHUNK = 400
/** the highest key in a range: the last code point, after every key with the prefix */
const RANGE_END = String.fromCharCode(0xf8ff)

export { followersEnabled }

const snapshots = () => table<FollowerSnapshotRow>(SNAPSHOTS)

/* ── reads ─────────────────────────────────────────────────────────────── */

/** every row whose key starts with `<prefix>` — a range on the key itself */
async function rowsWithPrefix<T extends { id: string }>(tableName: string, prefix: string): Promise<T[]> {
  const node = await rtdbFetch(`/mdm/tables/${tableName}`, {
    query: { orderBy: '"$key"', startAt: JSON.stringify(prefix), endAt: JSON.stringify(prefix + RANGE_END) },
    table: tableName,
  })
  if (!node || typeof node !== 'object') return []
  return Object.entries(node as Record<string, Record<string, unknown>>)
    // the fake database in tests answers a key range with the whole node;
    // filtering here costs nothing live and keeps the tests honest
    .filter(([id]) => id.startsWith(prefix))
    .map(([id, r]) => ({ ...r, id } as T))
}

function normaliseFollower(r: Record<string, unknown> & { id: string }): FollowerRow {
  return {
    id: r.id,
    account_id: String(r.account_id ?? ''),
    client_id: String(r.client_id ?? ''),
    pk: String(r.pk ?? ''),
    username: String(r.username ?? ''),
    full_name: typeof r.full_name === 'string' ? r.full_name : null,
    profile_pic: typeof r.profile_pic === 'string' ? r.profile_pic : null,
    is_private: r.is_private === true,
    is_verified: r.is_verified === true,
    first_seen_at: typeof r.first_seen_at === 'string' ? r.first_seen_at : null,
    last_seen_at: String(r.last_seen_at ?? ''),
    gone_at: typeof r.gone_at === 'string' ? r.gone_at : null,
    position_last: typeof r.position_last === 'number' ? r.position_last : null,
  }
}

function normaliseSnapshot(r: Record<string, unknown> & { id: string }): FollowerSnapshotRow {
  return {
    id: r.id,
    account_id: String(r.account_id ?? ''),
    client_id: String(r.client_id ?? ''),
    platform: String(r.platform ?? 'instagram'),
    mode: r.mode === 'full' ? 'full' : 'top',
    trigger: r.trigger === 'manual' ? 'manual' : 'scheduled',
    day: String(r.day ?? ''),
    taken_at: String(r.taken_at ?? ''),
    count: typeof r.count === 'number' ? r.count : null,
    seen: typeof r.seen === 'number' ? r.seen : 0,
    requests: typeof r.requests === 'number' ? r.requests : 0,
    limit: typeof r.limit === 'number' ? r.limit : 0,
    cursor: typeof r.cursor === 'string' ? r.cursor : null,
    user_pk: typeof r.user_pk === 'string' ? r.user_pk : null,
    seeded: r.seeded === true,
    source: String(r.source ?? ''),
    cost_note: typeof r.cost_note === 'string' ? r.cost_note : null,
    status: (['running', 'done', 'private', 'failed'] as const).find(s => s === r.status) ?? 'failed',
    error: typeof r.error === 'string' ? r.error : null,
  }
}

export async function followersOf(accountId: string): Promise<FollowerRow[]> {
  const rows = await rowsWithPrefix<Record<string, unknown> & { id: string }>(FOLLOWERS, `${accountId}:`)
  return rows.map(normaliseFollower).filter(r => r.account_id === accountId && r.pk)
}

export async function snapshotsOf(accountId: string): Promise<FollowerSnapshotRow[]> {
  const rows = await rowsWithPrefix<Record<string, unknown> & { id: string }>(SNAPSHOTS, `${accountId}:`)
  return rows.map(normaliseSnapshot).filter(r => r.account_id === accountId)
}

export async function latestSnapshot(accountId: string): Promise<FollowerSnapshotRow | null> {
  return latestOf(await snapshotsOf(accountId))
}

/** the newest FINISHED look — what the page's count and words come from */
export async function latestFinishedSnapshot(accountId: string): Promise<FollowerSnapshotRow | null> {
  return latestOf((await snapshotsOf(accountId)).filter(s => s.status !== 'running'))
}

/* ── writes ────────────────────────────────────────────────────────────── */

/** many follower rows in one multi-path write, a few hundred at a time */
async function writeFollowers(rows: FollowerRow[]): Promise<void> {
  const now = new Date().toISOString()
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const patch: Record<string, unknown> = {}
    for (const r of rows.slice(i, i + WRITE_CHUNK)) {
      patch[`tables/${FOLLOWERS}/${r.id}`] = { ...r, updated_at: now }
    }
    await rtdbFetch('/mdm', { method: 'PATCH', body: JSON.stringify(patch), table: FOLLOWERS })
  }
}

/* ── the account ───────────────────────────────────────────────────────── */

export type WatchedAccount = {
  account: SocialAccount
  client: Client
}

/** an Instagram account of a client, with a handle to look up — or why not */
export async function watchedAccount(accountId: string): Promise<{ ok: true; value: WatchedAccount } | { ok: false; reason: string }> {
  const account = await table<SocialAccount>('social_accounts').get(accountId)
  if (!account) return { ok: false, reason: 'no such account' }
  if (account.platform !== 'instagram') return { ok: false, reason: 'not instagram' }
  if (!account.client_id) return { ok: false, reason: 'no client' }
  if (!account.username) return { ok: false, reason: 'no username' }
  if (account.active === false) return { ok: false, reason: 'inactive' }
  const client = await table<Client>('clients').get(account.client_id)
  if (!client) return { ok: false, reason: 'no client' }
  return { ok: true, value: { account, client } }
}

/** every account the morning job should look at today, and how */
export async function accountsDueToday(now: Date = new Date()): Promise<{ accountId: string; mode: SnapshotMode; day: string }[]> {
  if (!followersEnabled()) return []
  const day = dayKey(now)
  const accounts = await table<SocialAccount>('social_accounts').list({
    where: a => a.platform === 'instagram' && !!a.client_id && !!a.username && a.active !== false,
  })
  if (accounts.length === 0) return []
  const clients = await table<Client>('clients').list()
  const byId = new Map(clients.map(c => [c.id, c]))
  const out: { accountId: string; mode: SnapshotMode; day: string }[] = []
  for (const a of accounts) {
    const client = byId.get(a.client_id as string)
    if (!client || client.status === 'archived') continue
    out.push({ accountId: a.id, mode: modeForDay(settingsOf(client).fullCadence, day), day })
  }
  return out
}

/* ── one look, step by step ────────────────────────────────────────────── */

export type BeginResult =
  | { status: 'running'; id: string }
  | { status: 'skipped'; reason: string }
  | { status: 'private' | 'failed'; id: string; reason: string }

/**
 * Claim today's look and read the profile (one request).
 *
 * The claim decides everything: whoever creates the row does the work, and
 * anybody else — a second cron tick, a retry, a manager pressing Refresh
 * twice — finds it taken and stands down. A private account is settled here,
 * before a single follower page is asked for.
 */
export async function beginSnapshot(input: {
  accountId: string
  mode: SnapshotMode
  trigger: SnapshotTrigger
  now?: Date
  source?: FollowerSource | null
}): Promise<BeginResult> {
  const now = input.now ?? new Date()
  const source = input.source === undefined ? configuredSource() : input.source
  if (!source) return { status: 'skipped', reason: 'not switched on' }

  const watched = await watchedAccount(input.accountId)
  if (!watched.ok) return { status: 'skipped', reason: watched.reason }
  const { account, client } = watched.value
  const settings = settingsOf(client)
  const day = dayKey(now)
  const id = snapshotId(account.id, input.mode, snapshotBucket(input.trigger, now))

  // Was there ever a finished look? Decides whether a stranger today is NEW.
  // A FULL read is seeded only by an earlier full read: after a week of
  // top-100 looks the first whole-list read meets thousands of strangers deep
  // in the list, and none of them joined today.
  const earlier = await snapshotsOf(account.id)
  const seeded = earlier.some(s => s.status === 'done' && (input.mode === 'top' || s.mode === 'full'))
  if (input.trigger === 'manual') {
    const verdict = refreshAllowed(latestOf(earlier), now)
    if (!verdict.ok) return { status: 'skipped', reason: verdict.reason }
  }

  const stamp = now.toISOString()
  const seat = await snapshots().claim(id, current => current ? null : ({
    id, account_id: account.id, client_id: client.id, platform: 'instagram',
    mode: input.mode, trigger: input.trigger, day, taken_at: stamp,
    count: null, seen: 0, requests: 0, limit: limitFor(input.mode, settings),
    cursor: null, user_pk: null, seeded, source: source.name, cost_note: null,
    status: 'running', error: null,
  }))
  if (!seat.claimed) return { status: 'skipped', reason: 'already looked at' }

  const profile = await source.profile(account.username as string)
  if (!profile.ok) {
    await snapshots().update(id, { status: 'failed', error: profile.error, requests: 1, cost_note: costNote(1) })
    return { status: 'failed', id, reason: profile.error }
  }
  if (profile.value.is_private) {
    await snapshots().update(id, {
      status: 'private', requests: 1, cost_note: costNote(1),
      user_pk: profile.value.pk, count: profile.value.follower_count,
    })
    return { status: 'private', id, reason: 'private' }
  }
  await snapshots().update(id, { requests: 1, user_pk: profile.value.pk, count: profile.value.follower_count })
  return { status: 'running', id }
}

export type AdvanceResult = { done: boolean; status: FollowerSnapshotRow['status']; seen: number; requests: number; left?: number; reason?: string }

/**
 * Read up to `maxPages` pages from where the row says we are, writing each
 * page's people as they arrive, and finish the look when the list ends or
 * the cap is reached.
 */
export async function advanceSnapshot(id: string, opts: { maxPages?: number; source?: FollowerSource | null } = {}): Promise<AdvanceResult> {
  const source = opts.source === undefined ? configuredSource() : opts.source
  const row = await snapshots().get(id, { fresh: true })
  if (!row) return { done: true, status: 'failed', seen: 0, requests: 0, reason: 'no such look' }
  const s = normaliseSnapshot(row as unknown as Record<string, unknown> & { id: string })
  if (s.status !== 'running') return { done: true, status: s.status, seen: s.seen, requests: s.requests }
  if (!source || !s.user_pk) {
    await snapshots().update(id, { status: 'failed', error: 'not switched on', cost_note: costNote(s.requests) })
    return { done: true, status: 'failed', seen: s.seen, requests: s.requests, reason: 'not switched on' }
  }

  const existing = new Map((await followersOf(s.account_id)).map(r => [r.id, r]))
  let seen = s.seen
  let requests = s.requests
  let cursor = s.cursor
  const maxPages = opts.maxPages ?? PAGES_PER_STEP

  for (let page = 0; page < maxPages; page++) {
    // a page that has already been read past the end is not asked for again
    if (seen > 0 && readFinished({ cursor, seen, limit: s.limit })) break
    const r = await source.followers(s.user_pk, cursor)
    requests += 1
    if (!r.ok) {
      // a failed request has already been paid for — settle and stop
      await snapshots().update(id, { status: 'failed', error: r.error, seen, requests, cursor, cost_note: costNote(requests) })
      return { done: true, status: 'failed', seen, requests, reason: r.error }
    }
    const rows = applySeen({
      existing, seen: r.value.users, accountId: s.account_id, clientId: s.client_id,
      day: s.day, seeded: s.seeded, offset: seen,
    })
    for (const x of rows) existing.set(x.id, x)
    await writeFollowers(rows)
    seen += rows.length
    cursor = r.value.users.length === 0 ? null : r.value.next
    await snapshots().update(id, { seen, requests, cursor })
    if (readFinished({ cursor, seen, limit: s.limit })) break
  }

  if (!readFinished({ cursor, seen, limit: s.limit })) {
    return { done: false, status: 'running', seen, requests }
  }

  // the end of the read: only a demonstrably complete full read may say who left
  let left = 0
  if (fullReadComplete({ mode: s.mode, cursor, seen, count: s.count, limit: s.limit })) {
    const gone = markLeft(existing.values(), s.day)
    await writeFollowers(gone)
    left = gone.length
  }
  await snapshots().update(id, { status: 'done', seen, requests, cursor, cost_note: costNote(requests), error: null })
  return { done: true, status: 'done', seen, requests, left }
}

/** a look that ran out of steps — settled so the row never stays `running` */
export async function failSnapshot(id: string, reason: string): Promise<AdvanceResult> {
  const row = await snapshots().get(id, { fresh: true })
  if (!row) return { done: true, status: 'failed', seen: 0, requests: 0, reason }
  if (row.status !== 'running') return { done: true, status: row.status, seen: row.seen, requests: row.requests }
  await snapshots().update(id, { status: 'failed', error: reason, cost_note: costNote(row.requests) })
  return { done: true, status: 'failed', seen: row.seen, requests: row.requests, reason }
}

/**
 * The whole look in one go — for tests and for anything that already runs
 * in the background. The Inngest function calls the two halves as steps.
 */
export async function runSnapshot(input: Parameters<typeof beginSnapshot>[0]): Promise<BeginResult | AdvanceResult> {
  const begun = await beginSnapshot(input)
  if (begun.status !== 'running') return begun
  for (let i = 0; i < MAX_STEPS; i++) {
    const r = await advanceSnapshot(begun.id, { source: input.source })
    if (r.done) return r
  }
  return failSnapshot(begun.id, 'too long')
}

/** the id a follower row would have — for callers joining on it */
export { followerId }
