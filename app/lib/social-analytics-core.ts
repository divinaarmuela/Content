/**
 * ANALYTICS BY CLIENT → CHANNEL → POST (the owner, 2 Nov 2026: "revamp it by client then branch it out through
 * social medias, and when click in it the posts are there, then when click analytic is there; in the posts page
 * can categorize by weekly etc"). Pure: Zernio's /analytics rows in, the page's numbers out.
 */

export type MetricKey = 'views' | 'impressions' | 'reach' | 'likes' | 'comments' | 'shares' | 'saves' | 'clicks'

export const METRIC_WORDS: readonly [MetricKey, string][] = [
  ['views', 'Views'], ['impressions', 'Impressions'], ['reach', 'Reach'], ['likes', 'Likes'],
  ['comments', 'Comments'], ['shares', 'Shares'], ['saves', 'Saves'], ['clicks', 'Clicks'],
]

export type Metrics = Record<MetricKey, number>

/** One published post, only what the pages draw (Zernio's row is ~10 KB of media links). */
export type AnalyticsPost = {
  id: string
  content: string
  publishedAt: string | null
  platform: string | null
  /** Zernio's account id — our social_accounts.provider_account_id */
  accountId: string | null
  url: string | null
  thumbnail: string | null
  mediaType: string | null
  metrics: Metrics
  /** Zernio's engagement rate, a percentage — null when it gave none */
  engagementRate: number | null
  /** when these numbers were last read from the platform */
  updatedAt: string | null
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export const emptyMetrics = (): Metrics =>
  ({ views: 0, impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0 })

/** Zernio's row → the page's post. Null for a row without an id. */
export function trimPost(raw: unknown): AnalyticsPost | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  // a list row carries `_id` and `platforms`; one post asked for by id carries `postId` and `platformAnalytics`
  const id = typeof r._id === 'string' ? r._id : typeof r.postId === 'string' ? r.postId : null
  if (!id) return null
  const perPlatform = Array.isArray(r.platforms) ? r.platforms : Array.isArray(r.platformAnalytics) ? r.platformAnalytics : []
  const first = (perPlatform[0] ?? null) as Record<string, unknown> | null
  const a = (r.analytics ?? first?.analytics ?? {}) as Record<string, unknown>
  const metrics = emptyMetrics()
  for (const [k] of METRIC_WORDS) metrics[k] = num(a[k])
  const media = Array.isArray(r.mediaItems) ? r.mediaItems[0] as Record<string, unknown> | undefined : undefined
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return {
    id,
    content: typeof r.content === 'string' ? r.content.slice(0, 600) : '',
    publishedAt: str(r.publishedAt),
    platform: str(r.platform) ?? str(first?.platform),
    accountId: str(first?.accountId),
    url: str(r.platformPostUrl) ?? str(first?.platformPostUrl),
    thumbnail: str(r.thumbnailUrl) ?? str(media?.thumbnail) ?? (media?.type === 'image' ? str(media?.url) : null),
    mediaType: str(r.mediaType),
    metrics,
    engagementRate: typeof a.engagementRate === 'number' ? a.engagementRate : null,
    updatedAt: str(a.lastUpdated),
  }
}

/** Likes + comments + shares + saves — what "engagement" means on these pages. */
export const engagement = (m: Metrics): number => m.likes + m.comments + m.shares + m.saves

export function sumMetrics(posts: readonly AnalyticsPost[]): Metrics {
  const out = emptyMetrics()
  for (const p of posts) for (const [k] of METRIC_WORDS) out[k] += p.metrics[k]
  return out
}

/** The day a post went up where the audience is (YYYY-MM-DD). */
export function dayIn(iso: string | null, tz: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA', { timeZone: tz })
}

/** The Monday of a day's week. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

const short = (day: string, withYear = false) => new Date(`${day}T00:00:00Z`)
  .toLocaleDateString('en-AU', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' })

export type GroupBy = 'week' | 'month' | 'none'

/** The grouping follows the days picked — no second filter (the owner, 2 Nov 2026): up to a fortnight is one
 *  list, up to about four months goes week by week, anything longer month by month. */
export function groupFor(range: { from: string; to: string }): GroupBy {
  const days = Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000) + 1
  if (!(days > 0)) return 'none'
  return days <= 14 ? 'none' : days <= 124 ? 'week' : 'month'
}

export type PostGroup = { key: string; label: string; posts: AnalyticsPost[]; totals: Metrics }

/** Posts into weeks (Monday to Sunday) or months, newest group first; each group keeps the order it was given. */
export function groupPosts(posts: readonly AnalyticsPost[], by: GroupBy, tz: string): PostGroup[] {
  if (by === 'none') return [{ key: 'all', label: 'All posts', posts: [...posts], totals: sumMetrics(posts) }]
  const groups = new Map<string, AnalyticsPost[]>()
  for (const p of posts) {
    const day = dayIn(p.publishedAt, tz)
    const key = !day ? 'undated' : by === 'week' ? mondayOf(day) : day.slice(0, 7)
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'undated' ? 1 : b === 'undated' ? -1 : b.localeCompare(a)))
    .map(([key, list]) => {
      let label = 'No date'
      if (key !== 'undated' && by === 'week') {
        const end = new Date(`${key}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 6)
        label = `Week of ${short(key)} – ${short(end.toISOString().slice(0, 10), true)}`
      } else if (key !== 'undated') {
        label = new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      }
      return { key, label, posts: list, totals: sumMetrics(list) }
    })
}

export type PostSort = 'newest' | 'views' | 'engagement' | 'reach'

export const SORT_WORDS: readonly { key: PostSort; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'views', label: 'Most views' },
  { key: 'reach', label: 'Most reach' },
  { key: 'engagement', label: 'Most engaged' },
]

export function sortPosts(posts: readonly AnalyticsPost[], by: PostSort): AnalyticsPost[] {
  const score = (p: AnalyticsPost) => by === 'views' ? Math.max(p.metrics.views, p.metrics.impressions)
    : by === 'reach' ? p.metrics.reach : engagement(p.metrics)
  return [...posts].sort((a, b) => by === 'newest'
    ? (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '')
    : score(b) - score(a) || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
}

/** One channel's numbers for a period, for the client's page. */
export type ChannelSummary = { accountId: string; posts: number; totals: Metrics }

export function summariseByAccount(posts: readonly AnalyticsPost[]): Map<string, ChannelSummary> {
  const out = new Map<string, ChannelSummary>()
  for (const p of posts) {
    if (!p.accountId) continue
    const s = out.get(p.accountId) ?? { accountId: p.accountId, posts: 0, totals: emptyMetrics() }
    s.posts += 1
    for (const [k] of METRIC_WORDS) s.totals[k] += p.metrics[k]
    out.set(p.accountId, s)
  }
  return out
}

/** One day of a post's life, from Zernio's post-timeline (one row per day per platform). */
export type TimelineDay = { date: string; metrics: Metrics }

export function readTimeline(raw: unknown): TimelineDay[] {
  const rows = (raw as { timeline?: unknown } | null)?.timeline
  if (!Array.isArray(rows)) return []
  const byDate = new Map<string, Metrics>()
  for (const row of rows) {
    const r = (row ?? {}) as Record<string, unknown>
    const date = typeof r.date === 'string' ? r.date.slice(0, 10) : null
    if (!date) continue
    const m = byDate.get(date) ?? emptyMetrics()
    for (const [k] of METRIC_WORDS) m[k] += num(r[k])
    byDate.set(date, m)
  }
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, metrics]) => ({ date, metrics }))
}

/**
 * HOW MANY FOLLOWERS IN THESE DAYS (the owner, 2 Nov 2026: "+followers since what? this can be confusing"). Zernio's
 * follower-stats readings for one account, asked for the days picked: the change is the latest reading minus the
 * first, and `since` is the day of that first reading — which is later than the range's start when Zernio's history
 * is shorter, so the words say which day it really counts from. Null with fewer than two readings.
 */
export function followerChange(readings: unknown): { change: number; since: string } | null {
  if (!Array.isArray(readings)) return null
  const pts = readings
    .map(r => (r ?? {}) as { date?: unknown; followers?: unknown })
    .filter((r): r is { date: string; followers: number } => typeof r.date === 'string' && typeof r.followers === 'number')
    .sort((a, b) => a.date.localeCompare(b.date))
  if (pts.length < 2) return null
  return { change: pts[pts.length - 1].followers - pts[0].followers, since: pts[0].date.slice(0, 10) }
}

/**
 * A DEAD PICTURE (the owner, 2 Nov 2026: "how come some show no thumbnail"). TikTok's picture links are signed and
 * carry `x-expires` (seconds); Zernio keeps the link it read when the post first synced and — unlike Meta's, which it
 * copies to its own storage — never renews it, so a TikTok post a few weeks old has a link that no longer opens
 * (Basfoods' late-September posts: expired 17 Oct). True when the link says it has run out.
 */
export function pictureExpired(url: string | null, nowMs: number): boolean {
  if (!url) return false
  try {
    const exp = Number(new URL(url).searchParams.get('x-expires'))
    return Number.isFinite(exp) && exp > 0 && exp * 1000 <= nowMs
  } catch { return false }
}

/** Swap expired pictures for the ones in the account's live feed (Zernio's /accounts/{id}/posts: `{ posts: [{ id,
 *  permalink, picture }] }`, read from the platform at that moment — its latest 25 or so). Matched on the post's
 *  link, or the platform's post id inside it. Posts older than the feed keep no picture. */
export function refreshPictures(posts: readonly AnalyticsPost[], feed: unknown, nowMs: number): AnalyticsPost[] {
  const list = Array.isArray((feed as { posts?: unknown } | null)?.posts) ? (feed as { posts: Record<string, unknown>[] }).posts : []
  const norm = (u: string) => u.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase()
  const byLink = new Map<string, string>()
  const byId = new Map<string, string>()
  for (const f of list) {
    const pic = typeof f.picture === 'string' && f.picture ? f.picture : null
    if (!pic) continue
    if (typeof f.permalink === 'string' && f.permalink) byLink.set(norm(f.permalink), pic)
    if (typeof f.id === 'string' && f.id) byId.set(f.id, pic)
  }
  return posts.map(p => {
    if (p.thumbnail && !pictureExpired(p.thumbnail, nowMs)) return p
    const fromLink = p.url ? byLink.get(norm(p.url)) : undefined
    const idInLink = p.url?.match(/(\d{8,})/)?.[1]
    const fresh = fromLink ?? (idInLink ? byId.get(idInLink) : undefined)
    return { ...p, thumbnail: fresh ?? null }
  })
}

/**
 * HOW UP TO DATE THESE NUMBERS ARE — said on the page, as the Reporting page does (the owner, 2 Nov 2026: "mention when
 * the data is full … so we know when the data is"). The timings are Zernio's own (its analytics guide, "Show freshness,
 * not real time", read 2 Nov 2026): likes and comments are re-read about every hour, reach and views arrive about a day
 * after a post goes up on Instagram, followers are counted once a day, posts made on the platforms are picked up about
 * every 90 minutes.
 */
export const FRESHNESS_RULES: readonly { what: string; how: string }[] = [
  { what: 'Likes and comments', how: 'updated about every hour' },
  { what: 'Reach and views', how: 'come in about a day after a post goes up' },
  { what: 'Followers', how: 'counted once a day' },
  { what: 'Posts made on the apps directly', how: 'show here within about an hour and a half' },
]

export type Freshness = { tone: 'green' | 'blue'; title: string; words: string }

/**
 * Whether the days picked are complete yet, from Melbourne's today: a range reaching yesterday or today is still
 * filling in. Zernio's own "being re-read" flag (`dataStaleness`) is NOT used: it counts every account in the agency,
 * not the client on screen — it read 5 stale accounts on every call on 2 Nov 2026, so it would have said "being read
 * again" on every page, for good.
 */
export function freshnessFor(range: { from: string; to: string }, today: string): Freshness {
  const y = new Date(`${today}T00:00:00Z`); y.setUTCDate(y.getUTCDate() - 1)
  const yesterday = y.toISOString().slice(0, 10)
  if (range.to >= yesterday) {
    return { tone: 'blue', title: 'The newest days are still coming in',
      words: 'Posts from today and yesterday are still collecting their reach and views, so their numbers will grow. Everything older than that is in.' }
  }
  return { tone: 'green', title: 'These days are complete',
    words: 'Every post here has been up for over a day, so its reach and views are in. Likes and comments still tick up as people find older posts.' }
}
