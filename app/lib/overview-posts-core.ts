/**
 * "POSTS THIS MONTH", per client account — the Overview's answer to the
 * owner's question of 10 Sep 2026: "for super admin they can see totals
 * posted per account and the metrics… if posted/scheduled then show that for
 * the month".
 *
 * Pure. No I/O, no clock of its own — the caller hands in `now`.
 *
 * Three rules, each one already settled somewhere else and reused here so two
 * screens can never disagree:
 *
 *   1. **The counting is the Posts page's counting.** `clientStats` and
 *      `outcomesForJob` (post-outcome-core) decide what "went out", "booked"
 *      and "did not go out" mean, in POSTS. This file only chooses which jobs
 *      belong to which account and to this month, then asks them.
 *   2. **The month is the CLIENT's month.** `monthInZone` on the client's own
 *      zone: on the first night of a month a Melbourne client and a London
 *      one are in different months, and each should be counted in theirs.
 *   3. **Absent is not zero** (post-analytics-core's rule). An account whose
 *      posts have no analytics rows yet has `null` metrics, printed as
 *      nothing at all, never as "0 interactions".
 *
 * By hand is recorded on the CARD, not on a channel (`posted_slides.hand`
 * carries a time and a link, never an account), so it cannot honestly be
 * pinned to one account when a client has several. A client with exactly one
 * account gets its by-hand count on that row; a client with more gets its own
 * "posted by hand" row, so no number is invented.
 */

import { numberOrNull } from './post-analytics-core'
import { interactionsOf } from './post-performance-core'
import {
  clientStats, postsTabs,
  type ByHandRow, type OutcomeJob,
} from './post-outcome-core'
import { DEFAULT_TZ, monthInZone } from './timezone-core'

/* ── what goes in ───────────────────────────────────────────────────────── */

/** A `social_accounts` row, as this file reads it. */
export type MonthAccount = {
  id: string
  client_id: string | null
  platform: string
  provider_account_id: string
  username: string | null
  name?: string | null
  active?: boolean
}

/** A `clients` row: the name on the row and the zone the month is read in. */
export type MonthClient = { id: string; name: string; timezone?: string | null }

/** A `publish_jobs` row. */
export type MonthJob = OutcomeJob & { id: string; client_id?: string | null }

/** A `post_analytics` row. */
export type MonthAnalytic = {
  publish_job_id?: string | null
  item_id?: string | null
  platform?: string | null
  published_at?: string | null
  views?: number | null
  reach?: number | null
  impressions?: number | null
  likes?: number | null
  comments?: number | null
  shares?: number | null
  saves?: number | null
}

/* ── what comes out ─────────────────────────────────────────────────────── */

export type MonthMetrics = {
  /** likes + comments + shares + saves, over what the platforms reported */
  interactions: number | null
  likes: number | null
  comments: number | null
  /** views, or impressions where a platform counts those instead */
  views: number | null
}

export type AccountPostsRow = {
  /** stable per row: the account, or the client's by-hand row */
  key: string
  /** null on a client's "posted by hand" row — by hand has no channel */
  account_id: string | null
  client_id: string | null
  client_name: string
  platform: string | null
  username: string | null
  went_out: number
  booked: number
  did_not: number
  by_hand: number
  metrics: MonthMetrics
}

/* ── which month a job belongs to ───────────────────────────────────────── */

/**
 * The one time a job is ABOUT: when it went out, else when it is booked for,
 * else when it last moved. A job made in August and booked for September is a
 * September post, which is where the person looking for it will look.
 */
export function jobMonthStamp(job: OutcomeJob): string | null {
  const tabs = postsTabs(job)
  if (tabs.has('posted')) return job.published_at ?? job.updated_at ?? job.created_at ?? null
  if (tabs.has('scheduled')) return job.scheduled_for ?? job.created_at ?? null
  return job.updated_at ?? job.created_at ?? null
}

/** the provider account ids a job was sent to, with the channel each was on */
export function jobTargets(job: OutcomeJob): { platform: string; accountId: string | null }[] {
  const raw = (job as { targets?: unknown }).targets
  if (!Array.isArray(raw)) return []
  return raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map(t => ({
      platform: String(t.platform ?? '').toLowerCase(),
      accountId: t.accountId == null ? null : String(t.accountId),
    }))
    .filter(t => t.platform || t.accountId)
}

/* ── the build ──────────────────────────────────────────────────────────── */

type Bucket = {
  row: AccountPostsRow
  jobs: MonthJob[]
  metrics: { interactions: number | null; likes: number | null; comments: number | null; views: number | null }
}

const add = (a: number | null, b: number | null) => (b === null ? a : (a ?? 0) + b)

/**
 * One row per client account with something on it this month, and one extra
 * row per client whose by-hand posts cannot be pinned to a single account.
 * Newest agencies first is meaningless here, so: busiest account first, then
 * the client's name.
 */
export function monthPostsByAccount(input: {
  now: string | number | Date
  accounts: readonly MonthAccount[]
  clients: readonly MonthClient[]
  jobs: readonly MonthJob[]
  byHand: readonly ByHandRow[]
  analytics: readonly MonthAnalytic[]
  /** the clients this viewer may see; null is every client */
  clientIds?: readonly string[] | null
  defaultTz?: string
}): AccountPostsRow[] {
  const fallbackTz = input.defaultTz || DEFAULT_TZ
  const clientById = new Map(input.clients.map(c => [c.id, c]))
  const scope = input.clientIds == null ? null : new Set(input.clientIds)
  const maySee = (clientId: string | null | undefined) =>
    clientId != null && (scope === null || scope.has(clientId)) && clientById.has(clientId)

  const tzOf = (clientId: string) => clientById.get(clientId)?.timezone || fallbackTz
  const monthOf = (clientId: string) => monthInZone(input.now, tzOf(clientId))
  const inMonth = (iso: string | null | undefined, clientId: string) => {
    if (!iso) return false
    const want = monthOf(clientId)
    const got = monthInZone(iso, tzOf(clientId))
    return !!want && !!got && want.month === got.month && want.year === got.year
  }

  const accounts = input.accounts.filter(a => a.active !== false && maySee(a.client_id))
  const byProvider = new Map<string, MonthAccount>()
  for (const a of accounts) if (a.provider_account_id) byProvider.set(String(a.provider_account_id), a)
  const accountsOfClient = new Map<string, MonthAccount[]>()
  for (const a of accounts) {
    const list = accountsOfClient.get(a.client_id as string) ?? []
    list.push(a)
    accountsOfClient.set(a.client_id as string, list)
  }

  const buckets = new Map<string, Bucket>()
  const bucketFor = (a: MonthAccount): Bucket => {
    let b = buckets.get(a.id)
    if (!b) {
      b = {
        row: {
          key: a.id,
          account_id: a.id,
          client_id: a.client_id,
          client_name: clientById.get(a.client_id as string)?.name ?? 'No client',
          platform: a.platform,
          username: a.username ?? a.name ?? null,
          went_out: 0, booked: 0, did_not: 0, by_hand: 0,
          metrics: { interactions: null, likes: null, comments: null, views: null },
        },
        jobs: [],
        metrics: { interactions: null, likes: null, comments: null, views: null },
      }
      buckets.set(a.id, b)
    }
    return b
  }

  /** which accounts a job touched: its targets, else the client's channels */
  const accountsForJob = (job: MonthJob): MonthAccount[] => {
    const targets = jobTargets(job)
    const found = new Map<string, MonthAccount>()
    for (const t of targets) {
      const byId = t.accountId ? byProvider.get(t.accountId) : undefined
      const hit = byId && byId.client_id === (job.client_id ?? null) ? byId
        : (accountsOfClient.get(job.client_id as string) ?? []).find(a => a.platform.toLowerCase() === t.platform)
      if (hit) { found.set(hit.id, hit); continue }
      // an account the client switched OFF is left out on purpose; one that
      // has been disconnected since (TikTok on 10 Sep 2026) has no row at all
      // any more, and its posts still happened, so they sit on a row that
      // says so
      const switchedOff = input.accounts.some(a => a.client_id === (job.client_id ?? null) && a.platform.toLowerCase() === t.platform)
      if (t.platform && !switchedOff) {
        const gone: MonthAccount = {
          id: `gone:${job.client_id ?? ''}:${t.platform}`, client_id: job.client_id ?? null,
          platform: t.platform, provider_account_id: '', username: null, name: 'No longer connected',
        }
        found.set(gone.id, gone)
      }
    }
    return [...found.values()]
  }

  /* the jobs, month by month in each client's own zone */
  const jobsById = new Map<string, MonthJob>()
  for (const job of input.jobs) {
    jobsById.set(job.id, job)
    const clientId = job.client_id ?? null
    if (!maySee(clientId)) continue
    if (!inMonth(jobMonthStamp(job), clientId as string)) continue
    for (const a of accountsForJob(job)) bucketFor(a).jobs.push(job)
  }

  /* the numbers, from the Posts page's own counting */
  for (const b of buckets.values()) {
    // one client per bucket, so clientStats answers with exactly one row
    const stats = clientStats(b.jobs, [])[0]
    if (!stats) continue
    b.row.went_out = stats.went_out
    b.row.booked = stats.booked
    b.row.did_not = stats.did_not
  }

  /* the metrics, attributed to the account the post actually went out on */
  for (const row of input.analytics) {
    const job = (row.publish_job_id ? jobsById.get(String(row.publish_job_id)) : undefined)
      ?? (row.item_id ? input.jobs.find(j => (j as { content_item_id?: string | null }).content_item_id === row.item_id) : undefined)
    if (!job) continue
    const clientId = job.client_id ?? null
    if (!maySee(clientId)) continue
    const at = row.published_at ?? job.published_at ?? jobMonthStamp(job)
    if (!inMonth(at, clientId as string)) continue
    const platform = String(row.platform ?? '').toLowerCase()
    const on = accountsForJob(job)
    const account = (platform ? on.find(a => a.platform.toLowerCase() === platform) : undefined)
      ?? (on.length === 1 ? on[0] : undefined)
    if (!account) continue
    const b = bucketFor(account)
    b.metrics.interactions = add(b.metrics.interactions, interactionsOf(row).total)
    b.metrics.likes = add(b.metrics.likes, numberOrNull(row.likes))
    b.metrics.comments = add(b.metrics.comments, numberOrNull(row.comments))
    b.metrics.views = add(b.metrics.views, numberOrNull(row.views) ?? numberOrNull(row.impressions))
  }
  for (const b of buckets.values()) b.row.metrics = b.metrics

  /* by hand: onto the client's one account, or onto a row of its own */
  const handByClient = new Map<string, number>()
  for (const h of input.byHand) {
    const clientId = h.client_id ?? null
    if (!maySee(clientId)) continue
    if (!inMonth(h.at, clientId as string)) continue
    handByClient.set(clientId as string, (handByClient.get(clientId as string) ?? 0) + 1)
  }
  const extra: AccountPostsRow[] = []
  for (const [clientId, n] of handByClient) {
    const on = accountsOfClient.get(clientId) ?? []
    if (on.length === 1) { bucketFor(on[0]).row.by_hand += n; continue }
    extra.push({
      key: `hand-${clientId}`,
      account_id: null,
      client_id: clientId,
      client_name: clientById.get(clientId)?.name ?? 'No client',
      platform: null,
      username: null,
      went_out: 0, booked: 0, did_not: 0, by_hand: n,
      metrics: { interactions: null, likes: null, comments: null, views: null },
    })
  }
  const rows = [...buckets.values()].map(b => b.row).concat(extra)

  return rows
    .filter(r => r.went_out + r.booked + r.did_not + r.by_hand > 0)
    .sort((a, b) => {
      const total = (r: AccountPostsRow) => r.went_out + r.booked + r.did_not + r.by_hand
      return total(b) - total(a)
        || a.client_name.localeCompare(b.client_name)
        || String(a.platform ?? '').localeCompare(String(b.platform ?? ''))
    })
}

/* ── the words ──────────────────────────────────────────────────────────── */

/** "Went out 6 · Booked 3 · Did not go out 1 · 2 by hand" — zeros left out. */
export function postCountsLine(row: AccountPostsRow): string {
  const parts = [
    row.went_out > 0 ? `Went out ${row.went_out}` : null,
    row.booked > 0 ? `Booked ${row.booked}` : null,
    row.did_not > 0 ? `Did not go out ${row.did_not}` : null,
    row.by_hand > 0 ? `${row.by_hand} by hand` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Nothing yet'
}

/**
 * "1.2k interactions · 800 likes · 40 comments · 3.9k views", over the figures
 * the platforms actually reported. Null when they reported none: a post whose
 * numbers have not landed says nothing rather than zero.
 */
export function postMetricsLine(
  row: AccountPostsRow,
  compact: (n: number | null | undefined) => string,
): string | null {
  const parts = [
    row.metrics.interactions !== null ? `${compact(row.metrics.interactions)} interactions` : null,
    row.metrics.likes !== null ? `${compact(row.metrics.likes)} likes` : null,
    row.metrics.comments !== null ? `${compact(row.metrics.comments)} comments` : null,
    row.metrics.views !== null ? `${compact(row.metrics.views)} views` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/** "@sunsetco" — the handle as a person writes it, or the channel's name. */
export function accountHandle(row: AccountPostsRow): string {
  const u = (row.username ?? '').trim()
  if (!u) return row.platform ? row.platform : 'Posted by hand'
  return u.startsWith('@') ? u : `@${u}`
}

/** what the card says when the month is empty */
export const NO_POSTS_THIS_MONTH = 'Nothing posted or booked this month yet.'

/* ── the counts from Zernio itself (29 Oct 2026) ─────────────────────────────
 * The owner: "thats wrong data … make sure we get that from zernio". The panel counted our own publishing jobs, and
 * every CANCELLED one — each edit, re-book or take-off of a booked post — as "Did not go out": Justin's Instagram read
 * "Went out 7 · Did not go out 16" when Zernio held 8 published and none failed. The counts now come from the posts
 * Zernio itself holds, one per network the post was on: published → went out, still to go → booked, failed → did not
 * go out; cancelled is not a post at all. Instagram jobs held in our own queue (meta_ig, which Zernio never sees) are
 * added from the job, the same way. "Waiting on the client" (the owner: "if scheduled but waiting client approval")
 * is our posts': booked and still waiting on the client's word, or with the client before booking. Pure. */

export type ZernioPlatformLite = { platform?: string | null; status?: string | null; publishedAt?: string | null; scheduledFor?: string | null; accountId?: { _id?: string | null } | string | null; customContent?: string | null; platformPostUrl?: string | null; errorMessage?: string | null }
export type ZernioPostLite = { _id?: string; status?: string | null; scheduledFor?: string | null; content?: string | null; platforms?: ZernioPlatformLite[] | null }
/** ONE LINE OF AN ACCOUNT'S MONTH (the owner, 29 Oct 2026: "its unclear what went out 3 can we make a proper log maybe
 *  caption like how zernio dashboard is"): when, what happened, its words, where it is, and why it did not go */
export type PostLogEntry = { id: string; status: 'went_out' | 'booked' | 'did_not'; at: string | null; caption: string; url: string | null; error: string | null
  /** every network this same post was on, with how each went (the owner: "it should show … which social platforms it published") */
  networks?: { platform: string; status: 'went_out' | 'booked' | 'did_not' | 'other'; url: string | null }[]
  /** SCHEDULED, BUT THE CLIENT HAS NOT APPROVED IT YET (the owner, 29 Oct 2026: "add a tag booked in but awaiting client
   *  approval") — it goes only once they do */
  awaiting_client?: boolean }
export type LiveCounts = { went_out: number; booked: number; did_not: number }
export type WaitingPost = { post_id: string; at: string | null; booked: boolean }

const BOOKED_STATES = ['pending', 'scheduled', 'publishing', 'processing', 'queued']
const providerIdOf = (a: ZernioPlatformLite['accountId']): string | null => (typeof a === 'string' ? a : a?._id ? String(a._id) : null)

/** went out / booked / did not go out per our account id, for the month, from Zernio's posts */
export function zernioMonthCounts(
  posts: readonly ZernioPostLite[],
  accountByProvider: ReadonlyMap<string, { id: string; client_id: string | null }>,
  inMonth: (iso: string | null | undefined, clientId: string) => boolean,
  log?: Map<string, PostLogEntry[]>,
): Map<string, LiveCounts> {
  const out = new Map<string, LiveCounts>()
  const bump = (id: string, k: keyof LiveCounts, entry: Omit<PostLogEntry, 'status'>) => {
    const c = out.get(id) ?? { went_out: 0, booked: 0, did_not: 0 }; c[k]++; out.set(id, c)
    if (log) log.set(id, [...(log.get(id) ?? []), { ...entry, status: k }])
  }
  for (const p of posts) {
    for (const e of p.platforms ?? []) {
      const pid = providerIdOf(e.accountId)
      const acct = pid ? accountByProvider.get(pid) : undefined
      if (!acct || !acct.client_id) continue
      const st = String(e.status ?? p.status ?? '').toLowerCase()
      const when = e.scheduledFor ?? p.scheduledFor ?? null
      const entry = (at: string | null) => ({
        id: `${p._id ?? ''}:${e.platform ?? ''}`, at, caption: String(e.customContent || p.content || '').trim(),
        url: e.platformPostUrl ?? null, error: e.errorMessage ?? null,
        networks: (p.platforms ?? []).map(x => {
          const s = String(x.status ?? '').toLowerCase()
          return { platform: String(x.platform ?? ''), status: (s === 'published' ? 'went_out' : BOOKED_STATES.includes(s) ? 'booked' : s === 'failed' ? 'did_not' : 'other') as 'went_out' | 'booked' | 'did_not' | 'other', url: x.platformPostUrl ?? null }
        }),
      })
      if (st === 'published') { const at = e.publishedAt ?? when; if (inMonth(at, acct.client_id)) bump(acct.id, 'went_out', entry(at)) }
      else if (BOOKED_STATES.includes(st)) { if (inMonth(when, acct.client_id)) bump(acct.id, 'booked', entry(when)) }
      else if (st === 'failed') { if (inMonth(when, acct.client_id)) bump(acct.id, 'did_not', entry(when)) }
    }
  }
  return out
}

/** our own Instagram queue (provider meta_ig) — the posts Zernio never sees — added in the same three words */
export function metaQueueCounts(
  jobs: readonly (MonthJob & { provider?: string | null; status?: string | null; scheduled_for?: string | null; published_at?: string | null; updated_at?: string | null })[],
  accountsOfJob: (job: MonthJob) => { id: string; client_id: string | null }[],
  inMonth: (iso: string | null | undefined, clientId: string) => boolean,
  into: Map<string, LiveCounts>,
  log?: Map<string, PostLogEntry[]>,
): Map<string, LiveCounts> {
  for (const j of jobs) {
    if (String(j.provider ?? '') !== 'meta_ig') continue
    const st = String(j.status ?? '')
    const k: keyof LiveCounts | null = st === 'published' ? 'went_out' : ['queued', 'publishing', 'scheduled'].includes(st) ? 'booked' : st === 'failed' ? 'did_not' : null
    if (!k) continue
    const when = k === 'went_out' ? (j.published_at ?? j.scheduled_for) : (j.scheduled_for ?? j.updated_at)
    for (const a of accountsOfJob(j)) {
      if (!a.client_id || !inMonth(when, a.client_id)) continue
      const c = into.get(a.id) ?? { went_out: 0, booked: 0, did_not: 0 }
      c[k]++
      into.set(a.id, c)
      if (log) log.set(a.id, [...(log.get(a.id) ?? []), {
        id: `job:${j.id}`, status: k, at: when ?? null, caption: String((j as { caption?: unknown }).caption ?? '').trim(),
        url: (j as { permalink?: string | null }).permalink ?? null, error: k === 'did_not' ? String((j as { error?: unknown }).error ?? '') || null : null,
      }])
    }
  }
  return into
}

/** "8 posts went out · 2 posts scheduled · 1 post waiting on the client · 2 posts posted by hand" — zeros left out.
 *  A post waiting on the client is held back until they say yes (post-stage-core.waitingForClient), so it is not among
 *  Zernio's scheduled ones and nothing is taken off that number (29 Oct 2026: it was, and November read 8 short) */
export function liveCountsLine(row: AccountPostsRow & { waiting?: readonly WaitingPost[] }): string {
  // in words, never a bare number after a word — a card can be NAMED "3" (the owner: "sometimes they name the card 3")
  const posts = (n: number) => `${n} post${n === 1 ? '' : 's'}`
  const booked = row.booked
  const waiting = (row.waiting ?? []).length
  const parts = [
    row.went_out > 0 ? `${posts(row.went_out)} went out` : null,
    booked > 0 ? `${posts(booked)} scheduled` : null,
    waiting > 0 ? `${posts(waiting)} waiting on the client` : null,
    // "did not go out" is not shown (the owner, 29 Oct 2026: "remove the did not go out ones")
    row.by_hand > 0 ? `${posts(row.by_hand)} posted by hand` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Nothing this month'
}

/* ── one line per client (29 Oct 2026) ───────────────────────────────────────
 * The owner: "why does it show two social platforms from same client it should be one … client name, show posts shows
 * the post like it is … and I can still see all the socials underneath". One post sent to Instagram, LinkedIn and TikTok
 * was three lines of "8 posts went out". Now: the client, its posts counted ONCE each, every post once in its log with
 * the networks it went to, and the client's accounts listed under it.
 */
export type MonthRow = AccountPostsRow & { waiting?: WaitingPost[]; log?: PostLogEntry[] }
export type ClientMonth = {
  key: string
  client_id: string | null
  client_name: string
  went_out: number
  booked: number
  did_not: number
  by_hand: number
  metrics: MonthMetrics
  waiting: WaitingPost[]
  /** undefined when the counts came from our own jobs, not Zernio — there is no post list then */
  log?: PostLogEntry[]
  /** the client's accounts with anything this month, each with its own numbers */
  accounts: MonthRow[]
}

/** the post a log line is about — `<zernio post>:<network>` is one post on one network; `job:<id>` is one job */
const postKeyOf = (e: PostLogEntry) => (e.id.startsWith('job:') || e.id.startsWith('post:') ? e.id : e.id.split(':')[0] || e.id)
const RANK: Record<PostLogEntry['status'], number> = { went_out: 2, booked: 1, did_not: 0 }
const sumOrNull = (xs: (number | null)[]) => xs.reduce<number | null>((a, b) => (b === null ? a : (a ?? 0) + b), null)

export function postsByClient(rows: readonly MonthRow[]): ClientMonth[] {
  const groups = new Map<string, MonthRow[]>()
  for (const r of rows) {
    const k = r.client_id ?? `row:${r.key}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  const out: ClientMonth[] = []
  for (const [key, list] of groups) {
    const channels = list.filter(r => r.platform)
    const hasLog = channels.some(r => r.log !== undefined)
    // every post once: the furthest it got on any network (went out beats booked), newest first
    const posts = new Map<string, PostLogEntry>()
    for (const r of channels) for (const e of r.log ?? []) {
      const k = postKeyOf(e)
      const had = posts.get(k)
      if (!had || RANK[e.status] > RANK[had.status]) posts.set(k, { ...e, id: k })
    }
    const log = [...posts.values()].sort((x, y) => String(y.at ?? '').localeCompare(String(x.at ?? '')))
    const waiting = [...new Map(list.flatMap(r => r.waiting ?? []).map(w => [w.post_id, w])).values()]
      .sort((x, y) => String(x.at ?? '').localeCompare(String(y.at ?? '')))
    out.push({
      key, client_id: list[0].client_id, client_name: list[0].client_name,
      // counted from the posts themselves when Zernio answered; our own jobs have no post to count by, so each
      // channel's number is the client's (the largest — a post on three channels is one post)
      went_out: hasLog ? log.filter(e => e.status === 'went_out').length : Math.max(0, ...channels.map(r => r.went_out)),
      // a post awaiting the client is counted once, as waiting on them, not also as scheduled
      booked: hasLog ? log.filter(e => e.status === 'booked' && !e.awaiting_client).length : Math.max(0, ...channels.map(r => r.booked)),
      did_not: Math.max(0, ...channels.map(r => r.did_not)),
      by_hand: list.reduce((n, r) => n + r.by_hand, 0),
      metrics: {
        interactions: sumOrNull(list.map(r => r.metrics.interactions)),
        likes: sumOrNull(list.map(r => r.metrics.likes)),
        comments: sumOrNull(list.map(r => r.metrics.comments)),
        views: sumOrNull(list.map(r => r.metrics.views)),
      },
      waiting,
      log: hasLog ? log : undefined,
      accounts: channels,
    })
  }
  return out.sort((a, b) => (b.went_out + b.booked + b.by_hand) - (a.went_out + a.booked + a.by_hand) || a.client_name.localeCompare(b.client_name))
}

/** "2026-11" → a moment in the middle of that month, so every client's own zone reads it as that month; null for
 *  anything else, or a month more than two years either side */
export function middleOfMonth(month: string | null, now = new Date()): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? '')
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2])
  if (mo < 1 || mo > 12) return null
  const at = new Date(Date.UTC(y, mo - 1, 15, 12))
  return Math.abs(at.getTime() - now.getTime()) > 2 * 366 * 86_400_000 ? null : at
}
