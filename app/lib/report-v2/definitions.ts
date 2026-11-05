/**
 * ONE DEFINITION PER NUMBER (plan "Reports: one trustworthy number", 5 Nov 2026). Every figure on a monthly report —
 * where it is read from in Zernio, what it counts, over which window, and which platform / kind of post gives it at
 * all. The report, its checks, the preview page and Social → Analytics all read these, so the same number is never
 * worked out two ways again. Pure: no I/O.
 *
 * Facts behind the table were read off live Zernio on 5 Nov 2026:
 *  - Instagram gives views, reach, likes, comments, shares and saves for every post but an expired story — a 0 is a
 *    real 0 (Anthony's October carousels: no saves).
 *  - TikTok gives all six on every video.
 *  - LinkedIn gives reach, likes, comments, shares; views only on text posts and personal-profile videos; never saves.
 *  - Facebook reels give views and reach only; Facebook carousels and images give reach and likes only.
 *  - Zernio's follower-stats `granularity=monthly` labels a mid-month count as the 1st (Anthony: "1 Oct" = his 16 Oct
 *    count) — only the DAILY counts are used.
 */

export type MetricPlatform = 'instagram' | 'facebook' | 'tiktok' | 'linkedin'
export type PostKind = 'story' | 'reel' | 'carousel' | 'image' | 'text'
export type PostStat = 'views' | 'reach' | 'likes' | 'comments' | 'shares' | 'saves'
export const POST_STATS: readonly PostStat[] = ['views', 'reach', 'likes', 'comments', 'shares', 'saves']

/* ── a figure always says what it is ─────────────────────────────────────── */

/** 'value' = read and real (0 included); 'not_tracked' = Zernio was not following the account then (since = first day
 *  it was); 'not_given' = the platform does not report this; 'unreadable' = the read failed (reason says why) */
export type FigureState = 'value' | 'not_tracked' | 'not_given' | 'unreadable'
export type Figure = { state: FigureState; value?: number; since?: string | null; reason?: string; source?: string }

export const val = (value: number, source?: string): Figure => ({ state: 'value', value, ...(source ? { source } : {}) })
export const notTracked = (since: string | null, source?: string): Figure => ({ state: 'not_tracked', since, ...(source ? { source } : {}) })
export const notGiven = (source?: string): Figure => ({ state: 'not_given', ...(source ? { source } : {}) })
export const unreadable = (reason: string, source?: string): Figure => ({ state: 'unreadable', reason, ...(source ? { source } : {}) })
export const hasValue = (f: Figure | null | undefined): f is Figure & { value: number } => !!f && f.state === 'value' && typeof f.value === 'number'

/** a figure in plain words, for the page and the portal */
export function figureWords(f: Figure | null | undefined, platformName: string): string {
  if (!f) return 'Not read'
  switch (f.state) {
    case 'value': return (f.value ?? 0).toLocaleString('en-AU')
    case 'not_tracked': return f.since ? `Not tracked before ${shortDay(f.since)}` : 'Not tracked this month'
    case 'not_given': return `${platformName} doesn't give this`
    case 'unreadable': return 'Couldn’t read — Re-read'
  }
}

function shortDay(d: string): string {
  const t = Date.parse(`${d.slice(0, 10)}T00:00:00Z`)
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : d
}

/** a % change only between two real values, and never against 0 */
export function changeOf(now: Figure | null | undefined, before: Figure | null | undefined): { text: string; up: boolean } | null {
  if (!hasValue(now) || !hasValue(before) || before.value === 0) return null
  const pct = Math.round(((now.value - before.value) / before.value) * 100)
  return { text: `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%`, up: pct >= 0 }
}

/* ── the definition list ─────────────────────────────────────────────────── */

export type AccountMetric = 'accountsEngaged' | 'replies' | 'reposts' | 'websiteClicks' | 'followersGained' | 'views' | 'reach' | 'interactions' | 'likes' | 'comments' | 'shares' | 'saves' | 'profileVisits' | 'linkTaps'
export type MetricDef = { source: string; counts: string; window: 'month' | 'month_posts' | 'first_to_last_day' }

const DASH = 'Zernio /analytics/dashboard totals (day by day, the calendar month)'
const IG_INS = 'Zernio /analytics/instagram/account-insights (total_value, the calendar month)'
const FOLLOW = 'Zernio /accounts/follower-stats granularity=daily (never monthly)'
const IG_FOLLOWS = 'Zernio /analytics/instagram/account-insights follows_and_unfollows, breakdown=follow_type'

export const DEFINITIONS: Record<MetricPlatform, Partial<Record<AccountMetric, MetricDef>>> = {
  instagram: {
    followersGained: { source: IG_FOLLOWS, counts: "Instagram's own net: follows − unfollows in the month (daily count only as the fallback)", window: 'month' },
    views: { source: IG_INS, counts: 'views during the month, any post', window: 'month' },
    reach: { source: IG_INS, counts: 'accounts reached during the month', window: 'month' },
    interactions: { source: IG_INS, counts: 'total_interactions (may exceed the four parts: the rest is "other")', window: 'month' },
    likes: { source: IG_INS, counts: 'likes during the month', window: 'month' },
    comments: { source: IG_INS, counts: 'comments during the month', window: 'month' },
    shares: { source: IG_INS, counts: 'shares during the month', window: 'month' },
    saves: { source: IG_INS, counts: 'saves during the month', window: 'month' },
    profileVisits: { source: IG_INS, counts: 'profile_views', window: 'month' },
    linkTaps: { source: IG_INS, counts: 'profile_links_taps', window: 'month' },
    accountsEngaged: { source: IG_INS, counts: 'accounts_engaged: different accounts that interacted', window: 'month' },
    replies: { source: IG_INS, counts: 'replies', window: 'month' },
    reposts: { source: IG_INS, counts: 'reposts', window: 'month' },
    websiteClicks: { source: IG_INS, counts: 'website_clicks', window: 'month' },
  },
  facebook: {
    followersGained: { source: FOLLOW, counts: 'last tracked day − first tracked day (≥7 days tracked)', window: 'first_to_last_day' },
    views: { source: DASH, counts: 'views during the month; the month\'s posts\' own numbers when Zernio has no day-by-day', window: 'month' },
    reach: { source: DASH, counts: 'reach during the month', window: 'month' },
    interactions: { source: DASH, counts: 'likes + comments + shares + saves given', window: 'month' },
    likes: { source: DASH, counts: 'likes', window: 'month' },
    comments: { source: DASH, counts: 'comments', window: 'month' },
    shares: { source: DASH, counts: 'shares', window: 'month' },
  },
  tiktok: {
    followersGained: { source: FOLLOW, counts: 'last tracked day − first tracked day (≥7 days tracked)', window: 'first_to_last_day' },
    views: { source: DASH, counts: 'views (the month\'s posts when the profile has two TikTok accounts)', window: 'month' },
    reach: { source: DASH, counts: 'reach', window: 'month' },
    interactions: { source: DASH, counts: 'likes + comments + shares + saves', window: 'month' },
    likes: { source: DASH, counts: 'likes', window: 'month' }, comments: { source: DASH, counts: 'comments', window: 'month' },
    shares: { source: DASH, counts: 'shares', window: 'month' }, saves: { source: DASH, counts: 'saves', window: 'month' },
  },
  linkedin: {
    followersGained: { source: FOLLOW, counts: 'last tracked day − first tracked day (≥7 days tracked)', window: 'first_to_last_day' },
    views: { source: DASH, counts: 'views (text posts and personal videos only)', window: 'month' },
    reach: { source: DASH, counts: 'reach', window: 'month' },
    interactions: { source: DASH, counts: 'likes + comments + shares', window: 'month' },
    likes: { source: DASH, counts: 'likes', window: 'month' }, comments: { source: DASH, counts: 'comments', window: 'month' },
    shares: { source: DASH, counts: 'shares', window: 'month' },
  },
}

/** does the platform report this account-level number at all */
export function accountGives(platform: string, metric: AccountMetric): boolean {
  return !!DEFINITIONS[platform as MetricPlatform]?.[metric]
}

/** which numbers a platform gives for one kind of post */
export function postGives(platform: string, kind: PostKind): readonly PostStat[] {
  switch (platform) {
    case 'instagram': return kind === 'story' ? [] : POST_STATS
    case 'tiktok': return POST_STATS
    case 'linkedin': return kind === 'text' ? ['views', 'reach', 'likes', 'comments', 'shares'] : ['reach', 'likes', 'comments', 'shares']
    case 'facebook': return kind === 'reel' ? ['views', 'reach'] : kind === 'story' ? [] : ['reach', 'likes']
    default: return []
  }
}

/** "What Facebook gives" in words, per kind of post */
export function givesWords(platform: string): { kind: PostKind; stats: readonly PostStat[] }[] {
  const kinds: PostKind[] = platform === 'linkedin' ? ['text', 'image', 'reel'] : ['reel', 'carousel', 'image']
  return kinds.map(kind => ({ kind, stats: postGives(platform, kind) }))
}

/** PER-POST extras (owner approved 5 Nov 2026) from Zernio /analytics posts[].analytics — the post's lifetime so far.
 *  Shown where the platform gives them, or where a value > 0 came back. */
export type PostExtra = 'follows' | 'profileVisits' | 'reposts' | 'websiteClicks' | 'avgWatchSec' | 'completionRate' | 'skipRate'
export const POST_EXTRAS: { key: PostExtra; field: string; platforms: readonly MetricPlatform[]; words: string; kinds?: readonly PostKind[] }[] = [
  { key: 'follows', field: 'analytics.follows', platforms: ['instagram'], words: 'followed from this post' },
  { key: 'profileVisits', field: 'analytics.profileViews', platforms: ['instagram'], words: 'profile visits' },
  { key: 'reposts', field: 'analytics.reposts', platforms: ['instagram'], words: 'reposts' },
  { key: 'websiteClicks', field: 'analytics.websiteClicks', platforms: [], words: 'website clicks' },
  { key: 'avgWatchSec', field: 'analytics.igReelsAvgWatchTime (ms → s)', platforms: ['instagram'], words: 'average watch (s)', kinds: ['reel'] },
  { key: 'completionRate', field: 'analytics.completionRate', platforms: ['instagram'], words: 'watched to the end (%)', kinds: ['reel'] },
  { key: 'skipRate', field: 'analytics.reelsSkipRate', platforms: ['instagram'], words: 'skipped in the first 3 s (%)', kinds: ['reel'] },
]
export const TIKTOK_MIX = {
  audienceTypes: { field: 'analytics.audienceTypes', words: 'Who watched (% of viewers)' },
  impressionSources: { field: 'analytics.impressionSources', words: 'Where the views came from (%)' },
}
export function postExtraGiven(platform: string, kind: PostKind, key: PostExtra): boolean {
  const d = POST_EXTRAS.find(x => x.key === key)
  return !!d && (d.platforms as readonly string[]).includes(platform) && (!d.kinds || d.kinds.includes(kind))
}

/* ── followers ───────────────────────────────────────────────────────────── */

export type FollowerPoint = { date: string; followers: number }

/** Zernio's daily readings for one account, cleaned and sorted */
export function followerPoints(readings: unknown): FollowerPoint[] {
  if (!Array.isArray(readings)) return []
  return readings
    .map(r => (r ?? {}) as { date?: unknown; followers?: unknown })
    .map(r => ({ date: typeof r.date === 'string' ? r.date.slice(0, 10) : '', followers: typeof r.followers === 'number' ? r.followers : typeof r.followers === 'string' && r.followers.trim() ? Number(r.followers) : NaN }))
    .filter(p => p.date && Number.isFinite(p.followers))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export type FollowerGain = Figure & { start?: number; end?: number; startDay?: string; endDay?: string }

/**
 * THE ONE FOLLOWER GAIN (report AND Social → Analytics): the first tracked day in [from, to] → the last tracked day in
 * [from, to], both inclusive. Fewer than `minDays` days between the first tracked day and `to` (a month needs a week)
 * = not tracked. Anthony's Instagram October: 3 Oct 2,371 → 31 Oct 2,414 = +43, and November's "last month" is the same
 * +43 because it is the same call for October.
 */
export function followerGain(points: readonly FollowerPoint[], from: string, to: string, minDays = 7): FollowerGain {
  const inRange = points.filter(p => p.date >= from && p.date <= to)
  if (inRange.length < 2) return { ...notTracked(inRange[0]?.date ?? null, FOLLOW) }
  const first = inRange[0], last = inRange[inRange.length - 1]
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${first.date}T00:00:00Z`)) / 864e5 + 1
  if (days < minDays) return { ...notTracked(first.date, FOLLOW) }
  return { state: 'value', value: last.followers - first.followers, since: first.date, source: FOLLOW, start: first.followers, end: last.followers, startDay: first.date, endDay: last.date }
}

export const IG_FOLLOWS_SOURCE = 'Zernio /analytics/instagram/account-insights follows_and_unfollows by follow_type (Instagram\'s own net)'

/**
 * INSTAGRAM'S OWN NET FOLLOWERS (verified 5 Nov 2026): account-insights metrics=follows_and_unfollows,
 * breakdown=follow_type gives FOLLOWER (follows) and NON_FOLLOWER (unfollows). Anthony October: 82 − 38 = +44, exactly
 * Instagram's app. Null when the answer has no breakdown (then the daily count is the fallback).
 */
export function igNetFollows(answer: unknown): { follows: number; unfollows: number } | null {
  const metrics = (answer && typeof answer === 'object' ? (answer as { metrics?: unknown }).metrics : null) as Record<string, unknown> | null
  const m = (metrics?.follows_and_unfollows ?? null) as Record<string, unknown> | null
  if (!m) return null
  const raw = m.breakdowns ?? m.breakdown ?? (m.breakdown as { results?: unknown } | undefined)?.results
  const rows = Array.isArray(raw) ? raw as Record<string, unknown>[] : []
  const pick = (re: RegExp) => rows.filter(r => re.test(String(r.dimension ?? r.dimensionValue ?? r.key ?? ''))).reduce<number | null>((n, r) => {
    const v = typeof r.value === 'number' ? r.value : Number(r.value)
    return Number.isFinite(v) ? (n ?? 0) + v : n
  }, null)
  const follows = pick(/^follower$/i), unfollows = pick(/^non[_ ]?follower$/i)
  if (follows == null && unfollows == null) return null
  return { follows: follows ?? 0, unfollows: unfollows ?? 0 }
}
