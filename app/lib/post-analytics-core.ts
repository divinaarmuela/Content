/**
 * Per-post numbers, shaped for the people who read them. Pure — no I/O, no
 * database, no provider — so the portal, the dashboard and the cron all agree
 * on what a post "did" and what to call it.
 *
 * Two rules, both borrowed from portal-words.ts:
 *
 *   1. **Client words only.** A client never reads "impressions",
 *      "engagement rate" or "sync status". They read Views, Reach, Likes,
 *      Comments, Shares, Saves — and nothing else appears on their screen.
 *   2. **Absent is not zero.** A platform that has not reported yet and a post
 *      nobody saw are different facts, and printing "0 views" for the first is
 *      a lie the client acts on. Null metrics are dropped from the row, and a
 *      row with nothing in it says the numbers are still coming.
 */
import { contentTypePlural } from './portal-words'

/** The metrics we keep, in the shape the table stores them. */
export type PostMetrics = {
  views: number | null
  reach: number | null
  impressions: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  engagement_rate: number | null
}

/** One post's cached analytics, as every surface receives it. */
export type PostAnalyticsRow = PostMetrics & {
  provider_post_id: string
  platform: string | null
  platform_post_url: string | null
  /** the provider's readiness word — 'pending' means "not ready", not "zero" */
  sync_status: string | null
  published_at: string | null
  synced_at: string
  /**
   * Where this row came from: 'provider' (we published it) or 'external' (a
   * human posted it on the platform and we matched their link to the post).
   * Optional because the column arrived after the table did — a row read from
   * an un-migrated database carries no source, and that reads as 'provider',
   * which is what every row written before the migration was.
   */
  source?: string | null
}

/** Were these numbers found by matching a hand-posted link? */
export function isExternalRow(row: { source?: string | null } | null | undefined): boolean {
  return String(row?.source ?? '').toLowerCase() === 'external'
}

export const EMPTY_METRICS: PostMetrics = {
  views: null, reach: null, impressions: null, likes: null,
  comments: null, shares: null, saves: null, engagement_rate: null,
}

/** A provider number, or null. Guards against "1,204", "" and NaN alike. */
export function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * The provider's `/analytics?postId=…` body, reduced to our row.
 *
 * Defensive on every field: this is the one place a vendor's shape touches
 * ours, and a missing `platformAnalytics` array or a renamed key must degrade
 * to "no numbers yet" rather than throw inside a cron.
 */
export function shapePostAnalytics(
  providerPostId: string,
  raw: unknown,
): (PostAnalyticsRow & { raw: unknown }) | null {
  if (!providerPostId || !raw || typeof raw !== 'object') return null
  const body = raw as Record<string, unknown>
  const a = (body.analytics ?? {}) as Record<string, unknown>

  const platforms = Array.isArray(body.platformAnalytics)
    ? (body.platformAnalytics as Record<string, unknown>[])
    : []
  // the first platform that actually carries a link wins — a post fanned out
  // to three channels has one live URL worth showing, not three
  const withUrl = platforms.find(p => typeof p.platformPostUrl === 'string' && p.platformPostUrl)
  const first = withUrl ?? platforms[0]

  // the per-platform block carries fuller numbers than the roll-up on a
  // single-platform post; prefer it and fall back to the roll-up
  const pa = (first?.analytics ?? {}) as Record<string, unknown>

  const syncStatus = [first?.syncStatus, body.syncStatus]
    .find(v => typeof v === 'string' && v) as string | undefined

  /**
   * A pending post has NO numbers — not zero of them.
   *
   * Verified against the live API: while `syncStatus` is 'pending' the
   * per-platform `analytics` is literally `null` and the roll-up is a block of
   * zeros. Those zeros are placeholders the provider fills in later, and
   * storing them as measurements is how a Reel published an hour ago comes to
   * tell a client it got 0 views. Absent is not zero, so pending is null.
   */
  const pending = String(syncStatus ?? '').toLowerCase() === 'pending'
  const pick = (key: string) => (pending ? null : numberOrNull(pa[key] ?? a[key]))

  return {
    provider_post_id: providerPostId,
    platform: typeof first?.platform === 'string' ? first.platform : null,
    platform_post_url: typeof first?.platformPostUrl === 'string' ? first.platformPostUrl
      : typeof body.platformPostUrl === 'string' ? body.platformPostUrl : null,
    views: pick('views'),
    reach: pick('reach'),
    impressions: pick('impressions'),
    likes: pick('likes'),
    comments: pick('comments'),
    shares: pick('shares'),
    saves: pick('saves'),
    engagement_rate: pending ? null : numberOrNull(pa.engagementRate ?? a.engagementRate),
    sync_status: syncStatus ?? null,
    published_at: typeof body.publishedAt === 'string' ? body.publishedAt : null,
    synced_at: new Date().toISOString(),
    raw: body,
  }
}

/** One cell of the metrics row: a client word and a formatted figure. */
export type MetricCell = { key: string; label: string; value: number }

/**
 * The metrics row for one post, in reading order.
 *
 * "Views" is `views` when the platform reports it (a Reel) and `impressions`
 * when it does not (a still, where the platform counts times-shown instead).
 * They answer the same question for the person reading — "how many people saw
 * this" — and only one of them is ever present, so they share a column and a
 * word rather than teaching the client a vocabulary they did not ask for.
 */
export function metricCells(m: Partial<PostMetrics> | null | undefined): MetricCell[] {
  if (!m) return []
  const seen = m.views ?? m.impressions ?? null
  const cells: MetricCell[] = [
    { key: 'views', label: 'Views', value: seen ?? NaN },
    { key: 'reach', label: 'Reach', value: m.reach ?? NaN },
    { key: 'likes', label: 'Likes', value: m.likes ?? NaN },
    { key: 'comments', label: 'Comments', value: m.comments ?? NaN },
    { key: 'shares', label: 'Shares', value: m.shares ?? NaN },
    { key: 'saves', label: 'Saves', value: m.saves ?? NaN },
  ]
  return cells.filter(c => Number.isFinite(c.value))
}

/**
 * Are this post's numbers ready to show?
 *
 * `syncStatus: 'pending'` is the provider saying the platform has not handed
 * over the figures yet. A row that exists but is pending, and a post with no
 * row at all, are the same thing to the client: come back shortly.
 */
export function metricsPending(row: Partial<PostAnalyticsRow> | null | undefined): boolean {
  if (!row) return true
  if (String(row.sync_status ?? '').toLowerCase() === 'pending') return true
  return metricCells(row).length === 0
}

/** What the card says while the platform is still counting. */
export const METRICS_PENDING_LINE = 'Numbers arrive within the hour'

/**
 * A figure at a glance: 1204 → "1.2k", 1_240_000 → "1.2m".
 *
 * Only past a thousand — a post with 847 views says 847, because rounding a
 * small number to "0.8k" reads as evasion. One decimal, and never a trailing
 * ".0k".
 */
export function compactCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs < 1000) return String(Math.round(n))
  const [div, suffix] = abs < 1_000_000 ? [1000, 'k'] : [1_000_000, 'm']
  const scaled = n / div
  // one decimal, but 12.0k is just 12k
  const text = Math.abs(scaled) >= 100 ? String(Math.round(scaled)) : scaled.toFixed(1).replace(/\.0$/, '')
  return `${text}${suffix}`
}

/**
 * "Updated 12 min ago".
 *
 * A number with no age on it invites the client to believe it is live. It is
 * not — it is as fresh as the last sync, and saying so is the difference
 * between a stale figure and a wrong one.
 */
export function updatedAgo(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const mins = Math.floor((now - t) / 60_000)
  if (mins < 0) return 'Updated just now'
  if (mins < 1) return 'Updated just now'
  if (mins < 60) return `Updated ${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Updated ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  return `Updated ${days} ${days === 1 ? 'day' : 'days'} ago`
}

/** The agency's zone. Every "this month" in the portal means Melbourne's. */
export const PORTAL_TZ = 'Australia/Melbourne'

/** "2026-08" for an instant, in Melbourne. The month boundary is the
 *  agency's, not the reader's — a client opening the portal from London on
 *  the 1st should see the same month their account manager does. */
export function melbourneMonthKey(iso: string | number | Date, tz: string = PORTAL_TZ): string | null {
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit',
  }).formatToParts(d)
  const year = parts.find(p => p.type === 'year')?.value
  const month = parts.find(p => p.type === 'month')?.value
  return year && month ? `${year}-${month}` : null
}

export type MonthTotals = { views: number; likes: number; posts: number }

/**
 * "This month: 1.2k views · 84 likes".
 *
 * Counts only posts whose published_at falls in the current Melbourne month,
 * and only metrics that exist — a post still pending contributes nothing
 * rather than a zero that drags the total down invisibly.
 */
export function monthTotals(
  rows: (Partial<PostAnalyticsRow> & { published_at?: string | null })[],
  now: number | Date = Date.now(),
  tz: string = PORTAL_TZ,
): MonthTotals {
  const key = melbourneMonthKey(now instanceof Date ? now : new Date(now), tz)
  const totals: MonthTotals = { views: 0, likes: 0, posts: 0 }
  for (const r of rows ?? []) {
    if (!r?.published_at) continue
    if (melbourneMonthKey(r.published_at, tz) !== key) continue
    totals.posts++
    const seen = r.views ?? r.impressions ?? null
    if (typeof seen === 'number' && Number.isFinite(seen)) totals.views += seen
    if (typeof r.likes === 'number' && Number.isFinite(r.likes)) totals.likes += r.likes
  }
  return totals
}

/** The one line under the Published heading, or null when there is nothing
 *  worth saying — a month with no numbers yet gets silence, not "0 views". */
export function monthTotalsLine(totals: MonthTotals | null | undefined): string | null {
  if (!totals || totals.posts === 0) return null
  if (totals.views === 0 && totals.likes === 0) return null
  const bits: string[] = []
  if (totals.views > 0) bits.push(`${compactCount(totals.views)} views`)
  if (totals.likes > 0) bits.push(`${compactCount(totals.likes)} likes`)
  return `This month: ${bits.join(' · ')}`
}

/**
 * The same month, cut by what the piece IS.
 *
 * "1.2k views" over a month of Reels and graphics adds two different things
 * together: a Reel is measured in plays, a still in how many people it
 * reached. The roll-up says which is which, in the client's own words, so a
 * month of five carousels is not silently reported as five failed Reels.
 */
export type TypeTotals = {
  type: string
  label: string
  posts: number
  /** which figure this kind of piece is judged on */
  metric: 'views' | 'reach'
  value: number
  likes: number
}

/** Reels and videos are watched; everything else is seen. */
export function metricForType(contentType: string | null | undefined): 'views' | 'reach' {
  return ['reel', 'video'].includes(String(contentType ?? '').toLowerCase()) ? 'views' : 'reach'
}

export type TypedRow = {
  content_type: string | null
  published_at?: string | null
} & Partial<PostMetrics>

export function typeTotals(
  rows: TypedRow[],
  now: number | Date = Date.now(),
  tz: string = PORTAL_TZ,
): TypeTotals[] {
  const key = melbourneMonthKey(now instanceof Date ? now : new Date(now), tz)
  const byType = new Map<string, TypeTotals>()
  const order: string[] = []

  for (const r of rows ?? []) {
    if (!r?.published_at) continue
    if (melbourneMonthKey(r.published_at, tz) !== key) continue
    const type = String(r.content_type ?? '').toLowerCase() || 'other'
    const metric = metricForType(type)
    if (!byType.has(type)) {
      byType.set(type, {
        type, label: contentTypePlural(type), posts: 0, metric, value: 0, likes: 0,
      })
      order.push(type)
    }
    const t = byType.get(type)!
    t.posts++
    // a Reel with no `views` still answers the question with impressions; a
    // still with no `reach` falls back the same way, rather than reporting 0
    const value = metric === 'views'
      ? r.views ?? r.impressions ?? null
      : r.reach ?? r.impressions ?? r.views ?? null
    if (typeof value === 'number' && Number.isFinite(value)) t.value += value
    if (typeof r.likes === 'number' && Number.isFinite(r.likes)) t.likes += r.likes
  }

  // biggest first — the month's headline is whatever the client got most of
  return order.map(t => byType.get(t)!).sort((a, b) => b.posts - a.posts || b.value - a.value)
}

/** "Reels · 3 posts · 12.4k views · 310 likes" — or null when there is
 *  nothing but zeroes, which is the platform not having counted yet. */
/**
 * The lines under the portal's Published heading. Pure, so a SERVER page can
 * compute them: the first version of this lived in a 'use client' component
 * file, and calling it from the server page was fine locally but a 500 on
 * Vercel ("Attempted to call publishedLines() from the server").
 */
export function publishedLines(data: {
  published_totals?: MonthTotals | null
  published_by_type?: TypeTotals[] | null
}): (string | null)[] {
  return [
    monthTotalsLine(data.published_totals),
    ...(data.published_by_type ?? []).map(typeTotalsLine),
  ]
}

export function typeTotalsLine(t: TypeTotals | null | undefined): string | null {
  if (!t || t.posts === 0) return null
  const bits = [`${t.posts} ${t.posts === 1 ? 'post' : 'posts'}`]
  if (t.value > 0) bits.push(`${compactCount(t.value)} ${t.metric}`)
  if (t.likes > 0) bits.push(`${compactCount(t.likes)} likes`)
  return `${t.label} · ${bits.join(' · ')}`
}

/** Is a cached row old enough to be worth asking the provider again? */
export function isStale(syncedAt: string | null | undefined, now: number = Date.now(), minutes = 30): boolean {
  if (!syncedAt) return true
  const t = new Date(syncedAt).getTime()
  if (Number.isNaN(t)) return true
  return now - t > minutes * 60_000
}
