/**
 * HOW A POST DID — the maths behind the "How it did" section, in plain words.
 *
 * The owner asked for two things about every post that goes out through the
 * board: did anyone interact with it, and has the account gained followers
 * since. Everything that answers those questions is here, pure — no I/O, no
 * database, no provider — so the card, the board, the portal and the cron all
 * read the same numbers and call them the same names.
 *
 * Three rules:
 *
 *   1. **Absent is not zero.** A platform that does not report saves (TikTok)
 *      and a post nobody saved are different facts. A metric the platform has
 *      is a chip; one it lacks is not drawn; one it has not counted yet says
 *      so in a sentence.
 *   2. **Followers are the account's, not the post's.** The count moves for a
 *      hundred reasons, so the card says "since this post" — a fact about the
 *      calendar — and, when a later post went out, "until your next post", so
 *      two posts a day apart do not both claim the same gain.
 *   3. **Never a blank, never an error.** Every function here answers with
 *      something the card can print for a post with no data at all.
 */
import { compactCount, numberOrNull, type PostMetrics } from './post-analytics-core'

/* ── shapes ────────────────────────────────────────────────────────────── */

/** One day of one account's follower count, as the provider reports it. */
export type FollowerPoint = { date: string; followers: number }

/** One day of one post's numbers, as the provider's timeline reports it. */
export type TimelineRow = {
  date: string
  platform?: string | null
  impressions?: number | null
  reach?: number | null
  likes?: number | null
  comments?: number | null
  shares?: number | null
  saves?: number | null
  views?: number | null
  clicks?: number | null
  follows?: number | null
}

/** A point on the sparkline: the day, and the running total that day. */
export type SparkPoint = { date: string; value: number }

export type TimelineSummary = {
  /** how many days the platform has reported on */
  days: number
  /**
   * The running total of interactions, one point per day, at most the last
   * thirty. Cumulative on purpose: the shape a person reads off a sparkline
   * is "is it still growing", which a per-day series hides in noise.
   */
  series: SparkPoint[]
  /** the same, for how many people saw it — impressions, or views when a
   *  platform counts plays instead */
  seen: SparkPoint[]
  /** whether the provider's rows were read as daily snapshots of the running
   *  total ('cumulative') or as each day's own count ('daily') */
  mode: 'cumulative' | 'daily'
}

export type FollowerDelta = {
  /** followers gained (or lost, negative) */
  delta: number
  /** the count on the post's day, and the count at the end of the window */
  from: number
  to: number
  fromDate: string
  toDate: string
  /** where the window ends: today, or the account's next post through the board */
  until: 'now' | 'next_post'
}

export type InteractionPart = {
  key: 'likes' | 'comments' | 'shares' | 'saves'
  label: string
  value: number
}

export type Interactions = {
  /** likes + comments + shares + saves, over the parts the platform reported;
   *  null when it reported none of them */
  total: number | null
  parts: InteractionPart[]
}

/** A chip under the big number: one figure the platform actually has. */
export type MetricChip = {
  key: 'likes' | 'comments' | 'shares' | 'saves' | 'reach' | 'views'
  label: string
  value: number
}

/** Who said what under the post — the latest few, names and text. */
export type PostComment = {
  id: string
  author: string
  text: string
  at: string | null
}

/**
 * The whole summary, as the cache stores it on the post's row and every
 * surface reads it. Small on purpose: the sparkline series is capped at
 * thirty points and the comments at ten, so a subscription to the row carries
 * it without carrying the provider's raw body.
 */
export type PostPerformance = {
  interactions: Interactions
  chips: MetricChip[]
  timeline: TimelineSummary
  /** the delta until now — always computed when the account has a series */
  followers_since: FollowerDelta | null
  /** the delta until the account's next post through the board — only when
   *  there is one; the card shows THIS one when it exists */
  followers_until_next: FollowerDelta | null
  comments: PostComment[]
  /** the provider's id for this post — the Inbox opens on it */
  provider_post_id: string | null
  computed_at: string
}

/* ── the calendar ──────────────────────────────────────────────────────── */

export const DEFAULT_TZ = 'Australia/Melbourne'

/** "2026-09-07" for an instant, in a zone. Null for garbage. */
export function dayKey(iso: string | number | Date | null | undefined, tz: string = DEFAULT_TZ): string | null {
  if (iso === null || iso === undefined || iso === '') return null
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  try {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

/** A clean, sorted copy of a follower series — bad rows dropped, one per day. */
export function cleanSeries(series: FollowerPoint[] | null | undefined): FollowerPoint[] {
  const byDay = new Map<string, number>()
  for (const p of series ?? []) {
    const date = typeof p?.date === 'string' ? p.date.slice(0, 10) : null
    const n = numberOrNull(p?.followers)
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || n === null) continue
    byDay.set(date, n)
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, followers]) => ({ date, followers }))
}

/**
 * The follower count on a day: the nearest point at or before it.
 *
 * The provider refreshes once a day, so the post's own day usually has a
 * point; when it does not (a post from before tracking began, or a gap), the
 * last count before it is the honest answer. A day before the series began
 * has no answer at all.
 */
export function followersOn(series: FollowerPoint[], day: string): FollowerPoint | null {
  let best: FollowerPoint | null = null
  for (const p of cleanSeries(series)) {
    if (p.date <= day) best = p
    else break
  }
  return best
}

/**
 * Followers gained since the post went up: today's count minus the count on
 * the post's day. Null when the series cannot answer — no points, or none on
 * or before the post's day.
 */
export function followersSince(
  series: FollowerPoint[] | null | undefined,
  postedAtISO: string | null | undefined,
  tz: string = DEFAULT_TZ,
  now: number | Date = Date.now(),
): FollowerDelta | null {
  const clean = cleanSeries(series)
  const postDay = dayKey(postedAtISO, tz)
  if (!postDay || clean.length === 0) return null
  const from = followersOn(clean, postDay)
  if (!from) return null
  // "today" is the latest point the provider has, never later than now
  const today = dayKey(now, tz) ?? postDay
  const to = followersOn(clean, today) ?? clean[clean.length - 1]
  if (to.date < from.date) return null
  return {
    delta: to.followers - from.followers,
    from: from.followers, to: to.followers,
    fromDate: from.date, toDate: to.date,
    until: 'now',
  }
}

/**
 * The same delta, but only until the account's NEXT post through the board.
 *
 * Without this, two posts a day apart would both claim the same gain. With
 * a next post the window closes on ITS day; with none this is `followersSince`
 * with `until: 'now'`. Ends before it begins (both posts on one day) reads
 * as zero for that day, not null: the card still has something honest to say.
 */
export function followersSinceAttributed(
  series: FollowerPoint[] | null | undefined,
  postedAtISO: string | null | undefined,
  nextPostAtISO: string | null | undefined,
  tz: string = DEFAULT_TZ,
  now: number | Date = Date.now(),
): FollowerDelta | null {
  const open = followersSince(series, postedAtISO, tz, now)
  if (!open) return null
  const nextDay = dayKey(nextPostAtISO, tz)
  if (!nextDay || nextDay >= open.toDate) return open
  const clean = cleanSeries(series)
  const to = followersOn(clean, nextDay)
  if (!to || to.date < open.fromDate) return { ...open, delta: 0, to: open.from, toDate: open.fromDate, until: 'next_post' }
  return {
    delta: to.followers - open.from,
    from: open.from, to: to.followers,
    fromDate: open.fromDate, toDate: to.date,
    until: 'next_post',
  }
}

/* ── interactions ──────────────────────────────────────────────────────── */

const PART_LABELS: Record<InteractionPart['key'], string> = {
  likes: 'Likes', comments: 'Comments', shares: 'Shares', saves: 'Saves',
}

/** likes + comments + shares + saves, over whatever the platform reported. */
export function interactionsOf(m: Partial<PostMetrics> | null | undefined): Interactions {
  const parts: InteractionPart[] = []
  for (const key of ['likes', 'comments', 'shares', 'saves'] as const) {
    const v = numberOrNull(m?.[key])
    if (v !== null) parts.push({ key, label: PART_LABELS[key], value: v })
  }
  return {
    total: parts.length ? parts.reduce((s, p) => s + p.value, 0) : null,
    parts,
  }
}

/**
 * Which figures each platform actually publishes — verified against the
 * provider's KPI matrix. A metric outside a platform's list is never drawn,
 * even as a zero, because it is not a measurement.
 */
const PLATFORM_METRICS: Record<string, MetricChip['key'][]> = {
  instagram: ['likes', 'comments', 'shares', 'saves', 'reach', 'views'],
  facebook: ['likes', 'comments', 'shares', 'reach', 'views'],
  tiktok: ['likes', 'comments', 'shares', 'views'],
  youtube: ['likes', 'comments', 'views'],
  linkedin: ['likes', 'comments', 'shares', 'reach'],
  threads: ['likes', 'comments', 'shares', 'views'],
  bluesky: ['likes', 'comments', 'shares'],
  pinterest: ['saves', 'comments', 'views'],
  x: ['likes', 'comments', 'shares', 'views'],
  twitter: ['likes', 'comments', 'shares', 'views'],
}
const ALL_CHIPS: MetricChip['key'][] = ['likes', 'comments', 'shares', 'saves', 'reach', 'views']
const CHIP_LABELS: Record<MetricChip['key'], string> = {
  likes: 'likes', comments: 'comments', shares: 'shares', saves: 'saves', reach: 'reach', views: 'views',
}

/** The chips under the big number: only the metrics this platform has, and
 *  only the ones it has reported. "Views" is impressions on a still. */
export function platformChips(
  m: Partial<PostMetrics> | null | undefined,
  platform: string | null | undefined,
): MetricChip[] {
  const allowed = PLATFORM_METRICS[String(platform ?? '').toLowerCase()] ?? ALL_CHIPS
  const out: MetricChip[] = []
  for (const key of ALL_CHIPS) {
    if (!allowed.includes(key)) continue
    const v = key === 'views'
      ? numberOrNull(m?.views) ?? numberOrNull(m?.impressions)
      : numberOrNull(m?.[key])
    if (v !== null) out.push({ key, label: CHIP_LABELS[key], value: v })
  }
  return out
}

/* ── the timeline ──────────────────────────────────────────────────────── */

/** The provider's `/analytics/post-timeline` body, reduced to rows. */
export function shapeTimeline(raw: unknown): TimelineRow[] {
  const body = (raw ?? {}) as { timeline?: unknown; data?: unknown }
  const list = Array.isArray(body.timeline) ? body.timeline
    : Array.isArray(body.data) ? body.data
    : Array.isArray(raw) ? raw : []
  const rows: TimelineRow[] = []
  for (const r of list as Record<string, unknown>[]) {
    const date = typeof r?.date === 'string' ? r.date.slice(0, 10) : null
    if (!date) continue
    rows.push({
      date,
      platform: typeof r.platform === 'string' ? r.platform : null,
      impressions: numberOrNull(r.impressions), reach: numberOrNull(r.reach),
      likes: numberOrNull(r.likes), comments: numberOrNull(r.comments),
      shares: numberOrNull(r.shares), saves: numberOrNull(r.saves),
      views: numberOrNull(r.views), clicks: numberOrNull(r.clicks),
      follows: numberOrNull(r.follows),
    })
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

const rowInteractions = (r: TimelineRow) =>
  (r.likes ?? 0) + (r.comments ?? 0) + (r.shares ?? 0) + (r.saves ?? 0)
// a still reports impressions and a literal `views: 0`; a Reel the reverse —
// whichever the platform actually counted is the one that is not zero
const rowSeen = (r: TimelineRow) => Math.max(r.views ?? 0, r.impressions ?? 0)

/**
 * Totals + a small daily series for the sparkline.
 *
 * The provider's rows are one per day per platform. Whether each row is that
 * day's own count or a snapshot of the running total is not stated, so it is
 * decided against the post's known totals when they are given: if the LAST
 * row already equals the total, the rows are snapshots; if the SUM does, they
 * are daily counts. With nothing to compare against (or all zeros) rows are
 * read as daily counts and summed, which is right for a series that never
 * decreases and harmless for one that is flat.
 */
export function summariseTimeline(
  rows: TimelineRow[] | null | undefined,
  totals?: Partial<PostMetrics> | null,
  points = 30,
): TimelineSummary {
  // several platforms on one post: fold each day together
  const byDay = new Map<string, TimelineRow>()
  for (const r of rows ?? []) {
    if (!r?.date) continue
    const cur = byDay.get(r.date)
    byDay.set(r.date, cur ? {
      date: r.date,
      impressions: (cur.impressions ?? 0) + (r.impressions ?? 0),
      reach: (cur.reach ?? 0) + (r.reach ?? 0),
      likes: (cur.likes ?? 0) + (r.likes ?? 0),
      comments: (cur.comments ?? 0) + (r.comments ?? 0),
      shares: (cur.shares ?? 0) + (r.shares ?? 0),
      saves: (cur.saves ?? 0) + (r.saves ?? 0),
      views: cur.views == null && r.views == null ? null : (cur.views ?? 0) + (r.views ?? 0),
    } : { ...r })
  }
  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
  if (days.length === 0) return { days: 0, series: [], seen: [], mode: 'daily' }

  const known = interactionsOf(totals).total
  const last = rowInteractions(days[days.length - 1])
  const sum = days.reduce((s, r) => s + rowInteractions(r), 0)
  const mode: TimelineSummary['mode'] =
    known !== null && known > 0 && last === known && sum !== known ? 'cumulative' : 'daily'

  let runI = 0
  let runS = 0
  const series: SparkPoint[] = []
  const seen: SparkPoint[] = []
  for (const r of days) {
    if (mode === 'cumulative') { runI = rowInteractions(r); runS = rowSeen(r) }
    else { runI += rowInteractions(r); runS += rowSeen(r) }
    series.push({ date: r.date, value: runI })
    seen.push({ date: r.date, value: runS })
  }
  return {
    days: days.length,
    series: series.slice(-points),
    seen: seen.slice(-points),
    mode,
  }
}

/* ── comments ──────────────────────────────────────────────────────────── */

/**
 * The provider's inbox comments for one post, reduced to name + text, newest
 * first, capped. The same shape the Inbox page reads: `username`, or `from`.
 */
export function shapeComments(raw: unknown, cap = 10): PostComment[] {
  const body = raw as { data?: unknown; comments?: unknown } | unknown[] | null | undefined
  const list = Array.isArray(body) ? body
    : Array.isArray((body as { data?: unknown })?.data) ? (body as { data: unknown[] }).data
    : Array.isArray((body as { comments?: unknown })?.comments) ? (body as { comments: unknown[] }).comments
    : []
  const out: PostComment[] = []
  for (const c of list as Record<string, unknown>[]) {
    if (!c || typeof c !== 'object') continue
    if (c.hidden === true) continue
    const id = String(c.id ?? c._id ?? '')
    const text = String(c.text ?? c.message ?? '').trim()
    if (!id || !text) continue
    const from = (c.from ?? {}) as { username?: unknown; name?: unknown }
    const author = String(c.username ?? from.username ?? from.name ?? c.authorName ?? '').trim() || 'someone'
    const atRaw = c.createdTime ?? c.timestamp ?? c.created_at ?? null
    const at = typeof atRaw === 'string' && !Number.isNaN(new Date(atRaw).getTime()) ? atRaw : null
    out.push({ id, author, text, at })
  }
  out.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
  return out.slice(0, cap)
}

/* ── follower stats ────────────────────────────────────────────────────── */

export type FollowerStats = {
  /** per provider account id: the daily series */
  series: Map<string, FollowerPoint[]>
  /** per provider account id: today's count */
  current: Map<string, number>
}

/** The provider's `/accounts/follower-stats` body, keyed by account id. */
export function shapeFollowerStats(raw: unknown): FollowerStats {
  const out: FollowerStats = { series: new Map(), current: new Map() }
  const body = (raw ?? {}) as { accounts?: unknown; stats?: unknown }
  const stats = (body.stats && typeof body.stats === 'object' ? body.stats : {}) as Record<string, unknown>
  for (const [id, list] of Object.entries(stats)) {
    if (!Array.isArray(list)) continue
    out.series.set(id, cleanSeries(list as FollowerPoint[]))
  }
  for (const a of Array.isArray(body.accounts) ? body.accounts as Record<string, unknown>[] : []) {
    const id = typeof a?._id === 'string' ? a._id : typeof a?.id === 'string' ? a.id : null
    const n = numberOrNull(a?.currentFollowers)
    if (id && n !== null) out.current.set(id, n)
  }
  return out
}

/* ── the summary ───────────────────────────────────────────────────────── */

export function buildPerformance(input: {
  metrics: Partial<PostMetrics> | null | undefined
  platform: string | null | undefined
  postedAt: string | null | undefined
  nextPostAt?: string | null
  timeline?: TimelineRow[] | null
  followers?: FollowerPoint[] | null
  comments?: PostComment[] | null
  providerPostId?: string | null
  tz?: string
  now?: number | Date
}): PostPerformance {
  const tz = input.tz ?? DEFAULT_TZ
  const now = input.now ?? Date.now()
  const since = followersSince(input.followers, input.postedAt, tz, now)
  const attributed = input.nextPostAt
    ? followersSinceAttributed(input.followers, input.postedAt, input.nextPostAt, tz, now)
    : null
  return {
    interactions: interactionsOf(input.metrics),
    chips: platformChips(input.metrics, input.platform),
    timeline: summariseTimeline(input.timeline, input.metrics),
    followers_since: since,
    followers_until_next: attributed && attributed.until === 'next_post' ? attributed : null,
    comments: (input.comments ?? []).slice(0, 10),
    provider_post_id: input.providerPostId ?? null,
    computed_at: new Date(now).toISOString(),
  }
}

/** Read a stored summary back, tolerating a row from before the column. */
export function readPerformance(v: unknown): PostPerformance | null {
  if (!v || typeof v !== 'object') return null
  const p = v as Partial<PostPerformance>
  if (!p.interactions || !Array.isArray(p.chips)) return null
  return {
    interactions: p.interactions,
    chips: p.chips,
    timeline: p.timeline ?? { days: 0, series: [], seen: [], mode: 'daily' },
    followers_since: p.followers_since ?? null,
    followers_until_next: p.followers_until_next ?? null,
    comments: Array.isArray(p.comments) ? p.comments : [],
    provider_post_id: p.provider_post_id ?? null,
    computed_at: p.computed_at ?? '',
  }
}

/** The follower delta the card shows: attributed when there is a next post. */
export function shownFollowers(p: PostPerformance | null | undefined): FollowerDelta | null {
  return p?.followers_until_next ?? p?.followers_since ?? null
}

/* ── words ─────────────────────────────────────────────────────────────── */

/** "+12", "−3", "0" — a signed count, with a real minus sign. */
export function signed(n: number): string {
  if (n > 0) return `+${compactCount(n)}`
  if (n < 0) return `−${compactCount(-n)}`
  return '0'
}

/** "+12 followers since this post" · "+12 followers until your next post" */
export function followersLine(d: FollowerDelta | null | undefined): string | null {
  if (!d) return null
  const n = Math.abs(d.delta)
  const word = n === 1 ? 'follower' : 'followers'
  return d.until === 'next_post'
    ? `${signed(d.delta)} ${word} until your next post`
    : `${signed(d.delta)} ${word} since this post`
}

/** the small print under the follower line — what the window means */
export function followersNote(d: FollowerDelta | null | undefined): string | null {
  if (!d) return null
  return d.until === 'next_post'
    ? 'Counted from the day this went up to the day your next post did, so two posts never share a gain.'
    : 'Counted from the day this went up to today. Followers move for many reasons — this is the calendar, not a cause.'
}

/** Does the post have anything to show at all? */
export function hasNumbers(p: PostPerformance | null | undefined): boolean {
  if (!p) return false
  return p.interactions.total !== null || p.chips.length > 0 || p.followers_since !== null
}

const PLATFORM_WORD: Record<string, string> = {
  instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube',
  linkedin: 'LinkedIn', threads: 'Threads', bluesky: 'Bluesky', pinterest: 'Pinterest', x: 'X',
}

/** What the section says when the platform has not counted yet. */
export function noNumbersLine(platform: string | null | undefined): string {
  const word = PLATFORM_WORD[String(platform ?? '').toLowerCase()] ?? 'The platform'
  return `No numbers yet — ${word} usually reports within a day.`
}

/** "42 people interacted · reach 1,830 · +12 followers since" */
export function performanceLine(p: PostPerformance | null | undefined): string | null {
  if (!p || !hasNumbers(p)) return null
  const bits: string[] = []
  const total = p.interactions.total
  if (total !== null) {
    bits.push(total === 1 ? '1 person interacted' : `${compactCount(total)} people interacted`)
  }
  const reach = p.chips.find(c => c.key === 'reach') ?? p.chips.find(c => c.key === 'views')
  if (reach) bits.push(`${reach.label} ${reach.value.toLocaleString('en-AU')}`)
  const f = shownFollowers(p)
  if (f) bits.push(`${signed(f.delta)} followers ${f.until === 'next_post' ? 'until next post' : 'since'}`)
  return bits.length ? bits.join(' · ') : null
}

/** The board card's one line: "42 interactions · +12 followers". */
export function boardLine(p: PostPerformance | null | undefined): string | null {
  if (!p || !hasNumbers(p)) return null
  const bits: string[] = []
  const total = p.interactions.total
  if (total !== null) bits.push(`${compactCount(total)} ${total === 1 ? 'interaction' : 'interactions'}`)
  const f = shownFollowers(p)
  if (f) bits.push(`${signed(f.delta)} followers`)
  return bits.length ? bits.join(' · ') : null
}

/** The portal's row, in the client's words: "42 people interacted · +12 followers since". */
export function portalLine(p: PostPerformance | null | undefined): string | null {
  if (!p) return null
  const bits: string[] = []
  const total = p.interactions.total
  if (total !== null) bits.push(total === 1 ? '1 person interacted' : `${compactCount(total)} people interacted`)
  const f = shownFollowers(p)
  if (f) bits.push(`${signed(f.delta)} followers ${f.until === 'next_post' ? 'until the next post' : 'since'}`)
  return bits.length ? bits.join(' · ') : null
}

/* ── which post came next ──────────────────────────────────────────────── */

/** A published job, as the attribution needs it. */
export type PostedJob = {
  id: string
  published_at: string | null
  /** the job's stored targets: `[{ platform, accountId }]` */
  targets: unknown
}

/** The provider account ids a job posted to. */
export function accountIdsOf(targets: unknown): string[] {
  if (!Array.isArray(targets)) return []
  return targets
    .map(t => String((t as { accountId?: unknown })?.accountId ?? ''))
    .filter(Boolean)
}

/**
 * The account's next post through the board after this one, by publish time
 * — the point where this post stops claiming the follower gain. Only jobs
 * that share an account count: a LinkedIn post the day after an Instagram
 * one does not close the Instagram window.
 */
export function nextPostAfter(job: PostedJob, others: PostedJob[]): string | null {
  const at = job.published_at
  if (!at) return null
  const mine = new Set(accountIdsOf(job.targets))
  let best: string | null = null
  for (const o of others) {
    if (o.id === job.id || !o.published_at || o.published_at <= at) continue
    if (mine.size && !accountIdsOf(o.targets).some(id => mine.has(id))) continue
    if (best === null || o.published_at < best) best = o.published_at
  }
  return best
}

/* ── the portal's slice ────────────────────────────────────────────────── */

/**
 * What the client's card carries: the interaction total, the follower
 * delta with its window, and the sparkline's points. No comments, no
 * commenter names, no provider ids — the client reads how it did, not who.
 */
export type PortalPerformance = {
  interactions: number | null
  followers: { delta: number; until: 'now' | 'next_post' } | null
  spark: SparkPoint[]
}

export function portalPerformance(p: PostPerformance | null | undefined): PortalPerformance | null {
  if (!p || !hasNumbers(p)) return null
  const f = shownFollowers(p)
  return {
    interactions: p.interactions.total,
    followers: f ? { delta: f.delta, until: f.until } : null,
    spark: p.timeline.series,
  }
}

/** "+12 followers since this post" — the client's version of `followersLine`. */
export function portalFollowersLine(f: PortalPerformance['followers']): string | null {
  if (!f) return null
  const n = Math.abs(f.delta)
  const word = n === 1 ? 'follower' : 'followers'
  return f.until === 'next_post'
    ? `${signed(f.delta)} ${word} between this post and the next`
    : `${signed(f.delta)} ${word} since this post`
}

/* ── the sparkline's geometry ──────────────────────────────────────────── */

/** The SVG path for a series, in a box — pure so a test can pin it. */
export function sparkPath(
  points: (SparkPoint | number)[],
  width = 120, height = 28, pad = 2,
): { line: string; area: string; last: { x: number; y: number } | null } {
  const values = points.map(p => (typeof p === 'number' ? p : p.value))
  if (values.length === 0) return { line: '', area: '', last: null }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const step = values.length > 1 ? innerW / (values.length - 1) : 0
  const xy = values.map((v, i) => ({
    x: +(pad + (values.length > 1 ? i * step : innerW / 2)).toFixed(2),
    y: +(pad + innerH - ((v - min) / span) * innerH).toFixed(2),
  }))
  const line = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
  const base = height - pad
  const area = `${line} L${xy[xy.length - 1].x} ${base} L${xy[0].x} ${base} Z`
  return { line, area, last: xy[xy.length - 1] }
}
