/**
 * REPORT V2 — Zernio's answers in, stated figures out. Pure: every rule about which number means what lives here and in
 * definitions.ts, and is driven by recorded answers in tests/fixtures/zernio.
 */
import { monthRange, previousMonth } from '../client-report-core'
import {
  accountGives, DEFINITIONS, followerGain, followerPoints, hasValue, igNetFollows, notGiven, notTracked, postExtraGiven, postGives, POST_STATS, unreadable, val,
  type Figure, type MetricPlatform, type PostExtra, type PostKind, type PostStat,
} from './definitions'
import { MONTH_METRICS, type MonthMetric, type RawAccountMonth, type V2Platform, type V2PlatformId, type V2Post, type ZernioAnswer } from './types'

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Record<string, unknown>[] : [])
const metricTotal = (metrics: Record<string, unknown>, k: string) => num(obj(metrics[k]).total ?? obj(metrics[k]).value ?? metrics[k])

const POSTS_SRC = "the month's posts' own numbers (Zernio /analytics)"

/** the kind of post, from Zernio's mediaType / mediaProductType (LinkedIn's media-less posts are 'text') */
export function kindOf(p: Record<string, unknown>, platform: string): PostKind {
  if (String(p.mediaProductType ?? '').toUpperCase() === 'STORY') return 'story'
  const items = arr(p.mediaItems)
  const f = String(p.mediaType ?? items[0]?.type ?? '').toLowerCase()
  if (/carousel|album/.test(f) || items.length > 1) return 'carousel'
  if (/video|reel/.test(f)) return 'reel'
  if (platform === 'linkedin' && !items.length && (!f || f === 'text')) return 'text'
  return 'image'
}

/** a TikTok % breakdown, as an object of numbers or a list of { type, percentage } */
export function percentMap(v: unknown): Record<string, number> | null {
  const out: Record<string, number> = {}
  if (Array.isArray(v)) {
    for (const r of arr(v)) {
      const k = String(r.type ?? r.name ?? r.key ?? r.source ?? '')
      const n = num(r.percentage ?? r.percent ?? r.value)
      if (k && n != null) out[k] = n
    }
  } else for (const [k, x] of Object.entries(obj(v))) { const n = num(x); if (n != null) out[k] = n }
  if (!Object.keys(out).length) return null
  // Zernio gives TikTok's shares as fractions (0.6 = 60%, read 5 Nov 2026): said as %
  if (Object.values(out).every(n => n >= 0 && n <= 1)) for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 1000) / 10
  return out
}

export function toPost(p: Record<string, unknown>, platform: V2PlatformId, mdmIds: ReadonlySet<string>): V2Post {
  const a = obj(p.analytics ?? p.metrics)
  const plat = arr(p.platforms).find(x => String(x.platform ?? '') === platform) ?? {}
  const items = arr(p.mediaItems)
  const kind = kindOf(p, platform)
  const gives = postGives(platform, kind)
  const raw: Record<PostStat, number | null> = {
    views: num(a.views) ?? num(a.impressions), reach: num(a.reach), likes: num(a.likes), comments: num(a.comments), shares: num(a.shares), saves: num(a.saves),
  }
  const stats = Object.fromEntries(POST_STATS.map(s => {
    const v = raw[s]
    // the platform gives it → a value, 0 included; it doesn't but a number > 0 came back anyway → shown (and flagged by the checks)
    const f: Figure = gives.includes(s) ? (v == null ? notGiven() : val(v)) : (v != null && v > 0 ? val(v) : notGiven())
    return [s, f]
  })) as Record<PostStat, Figure>
  const extrasRaw: Record<PostExtra, number | null> = {
    follows: num(a.follows), profileVisits: num(a.profileViews), reposts: num(a.reposts), websiteClicks: num(a.websiteClicks),
    avgWatchSec: num(a.igReelsAvgWatchTime) != null ? Math.round(num(a.igReelsAvgWatchTime)! / 100) / 10 : null,
    completionRate: num(a.completionRate), skipRate: num(a.reelsSkipRate),
  }
  const extras: Partial<Record<PostExtra, number>> = {}
  for (const [k, v] of Object.entries(extrasRaw) as [PostExtra, number | null][]) {
    if (v == null) continue
    if (v > 0 || postExtraGiven(platform, kind, k)) extras[k] = v
  }
  const id = String(p._id ?? p.id ?? p.postId ?? '')
  return {
    id, platform, kind,
    publishedAt: String(p.publishedAt ?? plat.publishedAt ?? p.scheduledFor ?? '') || null,
    url: String(p.platformPostUrl ?? plat.platformPostUrl ?? '') || null,
    thumbnail: String(p.thumbnailUrl ?? items[0]?.url ?? '') || null,
    caption: String(p.content ?? p.caption ?? '').slice(0, 600),
    byMdm: mdmIds.has(id),
    stats, extras,
    ...(platform === 'tiktok' ? { audienceTypes: percentMap(a.audienceTypes), impressionSources: percentMap(a.impressionSources) } : {}),
  }
}

/** the month's TikTok mix: each post's % weighted by its views */
export function viewsWeighted(posts: readonly V2Post[], k: 'audienceTypes' | 'impressionSources'): Record<string, number> {
  const sum: Record<string, number> = {}
  let w = 0
  for (const p of posts) {
    const m = p[k]; const v = hasValue(p.stats.views) ? p.stats.views.value : 0
    if (!m || !(v > 0)) continue
    w += v
    for (const [key, pct] of Object.entries(m)) sum[key] = (sum[key] ?? 0) + pct * v
  }
  if (!w) return {}
  return Object.fromEntries(Object.entries(sum).map(([key, n]) => [key, Math.round((n / w) * 10) / 10]))
}

const errOf = (a: ZernioAnswer | null | undefined) => (a && !a.ok ? a.error : null)

/** one account's month, every number stated */
export function normaliseAccount(raw: RawAccountMonth): V2Platform {
  const { account: acc, month: m } = raw
  const p = acc.platform
  const def = (k: MonthMetric | 'followersGained') => DEFINITIONS[p as MetricPlatform]?.[k]?.source
  const notes: string[] = []
  const { from, to } = monthRange(m)
  const prevRange = monthRange(previousMonth(m))

  // posts
  const mdm = new Set(raw.late && raw.late.ok ? arr(obj(raw.late.data).posts).map(x => String(x._id ?? x.id ?? x.postId ?? '')) : [])
  const postsErr = raw.posts.find(x => !x.ok)
  const posts = raw.posts.flatMap(x => (x.ok ? arr(obj(x.data).posts) : [])).map(x => toPost(x, p, mdm)).filter(x => x.id)
  if (postsErr && !posts.length) notes.push(`The posts could not be read (${errOf(postsErr)})`)

  // month totals
  const dashErr = errOf(raw.dash)
  const d = raw.dash.ok ? obj(raw.dash.data) : {}
  const totals = obj(d.totals)
  const onPlatform = arr(obj(d.followers).byAccount).filter(a => String(a.platform ?? p) === p)
  const oneAccount = onPlatform.length <= 1 && (!onPlatform.length || String(onPlatform[0].accountId) === acc.id)
  const monthEmpty = !(num(totals.views) || num(totals.impressions) || num(totals.reach) || num(totals.likes))
  const postsHave = posts.some(x => POST_STATS.some(s => hasValue(x.stats[s]) && x.stats[s].value! > 0))
  const byPosts = raw.dash.ok && (((p === 'tiktok' || p === 'linkedin') && !oneAccount) || (monthEmpty && postsHave))
  if (raw.dash.ok && monthEmpty && postsHave) notes.push("Zernio has no day-by-day figures for this month (the account was connected later), so the totals are this month's posts' own numbers")
  if (raw.dash.ok && (p === 'tiktok' || p === 'linkedin') && !oneAccount) notes.push(`The profile holds more than one ${p} account, so the totals are this account's posts' own numbers`)

  const figures = {} as Record<MonthMetric, Figure>
  const dashValue = (k: MonthMetric): number | null => {
    switch (k) {
      case 'views': return num(totals.views) ?? num(totals.impressions)
      case 'reach': case 'likes': case 'comments': case 'shares': case 'saves': return num(totals[k])
      case 'interactions': return [totals.likes, totals.comments, totals.shares, totals.saves].map(num).reduce<number | null>((n, v) => (v == null ? n : (n ?? 0) + v), null)
      default: return null
    }
  }
  const sumPosts = (k: PostStat): Figure => {
    const giving = posts.filter(x => x.stats[k].state === 'value')
    if (!giving.length) return notGiven(POSTS_SRC)
    return val(giving.reduce((n, x) => n + (x.stats[k].value ?? 0), 0), POSTS_SRC)
  }
  for (const k of MONTH_METRICS) {
    if (!accountGives(p, k)) { figures[k] = notGiven(def(k)); continue }
    if (byPosts) {
      if (k === 'interactions') {
        const parts = (['likes', 'comments', 'shares', 'saves'] as const).map(sumPosts).filter(hasValue)
        figures[k] = parts.length ? val(parts.reduce((n, f) => n + f.value, 0), POSTS_SRC) : notGiven(POSTS_SRC)
      } else figures[k] = (POST_STATS as readonly string[]).includes(k) ? sumPosts(k as PostStat) : notGiven(POSTS_SRC)
      continue
    }
    if (dashErr) { figures[k] = unreadable(dashErr, def(k)); continue }
    const v = dashValue(k)
    figures[k] = v == null ? notGiven(def(k)) : val(v, def(k))
  }
  // WAS ZERNIO FOLLOWING THE ACCOUNT LAST MONTH? (5 Nov 2026 verification: MGMT's Facebook, tracked from 19 Oct, read
  // September as 0 views) — no daily count in last month = last month is "not tracked", never 0
  const fsPts = raw.followerStats.ok ? followerPoints(obj(obj(raw.followerStats.data).stats)[acc.id]) : []
  const firstTracked = fsPts[0]?.date ?? null
  const trackedLastMonth = !raw.followerStats.ok || fsPts.some(x => x.date >= prevRange.from && x.date <= prevRange.to)
  if (firstTracked && firstTracked > from && firstTracked <= to && !byPosts) notes.push(`Zernio has followed this account only since ${firstTracked}, so the month's totals start then`)
  const previous = {} as V2Platform['previous']
  for (const k of ['views', 'reach', 'interactions'] as const) {
    if (byPosts) { previous[k] = notTracked(null, POSTS_SRC); continue }
    if (!trackedLastMonth) { previous[k] = notTracked(firstTracked, def(k)); continue }
    const e = errOf(raw.prevDash)
    if (e) { previous[k] = unreadable(e); continue }
    const t = obj(obj(raw.prevDash.ok ? raw.prevDash.data : {}).totals)
    const v = k === 'views' ? num(t.views) ?? num(t.impressions) : k === 'reach' ? num(t.reach)
      : [t.likes, t.comments, t.shares, t.saves].map(num).reduce<number | null>((n, x) => (x == null ? n : (n ?? 0) + x), null)
    previous[k] = v == null ? notGiven(def(k)) : val(v, def(k))
  }

  // followers: the daily count (every platform), Instagram's own net where it has one
  const monthTo = to <= raw.today ? to : raw.today
  let dailyGained: Figure = unreadable('not read'), prevDaily: Figure = unreadable('not read')
  let start: number | null = null, end: number | null = null, trackedFrom: string | null = null
  if (raw.followerStats.ok) {
    const pts = followerPoints(obj(obj(raw.followerStats.data).stats)[acc.id])
    const g = followerGain(pts, from, monthTo)
    const pg = followerGain(pts, prevRange.from, prevRange.to)
    start = g.start ?? null; end = g.end ?? null; trackedFrom = g.startDay ?? g.since ?? null
    dailyGained = strip(g); prevDaily = strip(pg)
  } else { dailyGained = unreadable(raw.followerStats.error); prevDaily = unreadable(raw.followerStats.error) }
  let gained = dailyGained, previousGained = prevDaily
  let follows: number | null = null, unfollows: number | null = null
  let interactionsOther: number | null = null, viewsFromFollowersPct: number | null = null

  if (p === 'instagram' && raw.ig) {
    const IG = DEFINITIONS.instagram
    const ins = raw.ig.insights
    if (ins.ok) {
      const mt = obj(obj(ins.data).metrics)
      const map: Record<MonthMetric, string> = {
        views: 'views', reach: 'reach', interactions: 'total_interactions', likes: 'likes', comments: 'comments', shares: 'shares', saves: 'saves',
        profileVisits: 'profile_views', linkTaps: 'profile_links_taps', accountsEngaged: 'accounts_engaged', replies: 'replies', reposts: 'reposts', websiteClicks: 'website_clicks',
      }
      for (const k of MONTH_METRICS) {
        const v = metricTotal(mt, map[k])
        figures[k] = v == null ? notGiven(IG[k]?.source) : val(v, IG[k]?.source)
      }
    } else for (const k of MONTH_METRICS) figures[k] = unreadable(ins.error, IG[k]?.source)
    const pi = raw.ig.prevInsights
    if (pi.ok) {
      const mt = obj(obj(pi.data).metrics)
      previous.views = val0(metricTotal(mt, 'views'), IG.views?.source)
      previous.reach = val0(metricTotal(mt, 'reach'), IG.reach?.source)
      previous.interactions = val0(metricTotal(mt, 'total_interactions'), IG.interactions?.source)
    } else for (const k of ['views', 'reach', 'interactions'] as const) previous[k] = unreadable(pi.error)
    const parts = (['likes', 'comments', 'shares', 'saves'] as const).reduce((n, k) => n + (hasValue(figures[k]) ? figures[k].value! : 0), 0)
    if (hasValue(figures.interactions) && figures.interactions.value > parts) interactionsOther = figures.interactions.value - parts
    // views from followers / non-followers
    if (raw.ig.split.ok) {
      const v = obj(obj(obj(raw.ig.split.data).metrics).views)
      const rows = arr(v.breakdown ?? v.breakdowns ?? obj(v.breakdown).results)
      const sum = (re: RegExp) => rows.filter(r => re.test(String(r.dimension ?? r.dimensionValue ?? r.key ?? ''))).reduce((n, r) => n + (num(r.value) ?? 0), 0)
      const f = sum(/^follower$/i), nf = sum(/non[_ ]?follower/i)
      if (f + nf > 0) viewsFromFollowersPct = Math.round((f / (f + nf)) * 1000) / 10
    }
    // INSTAGRAM'S OWN NET (5 Nov 2026: Anthony October 82 follows − 38 unfollows = +44, the app's figure)
    const net = raw.ig.net.ok ? igNetFollows(raw.ig.net.data) : null
    if (net) { follows = net.follows; unfollows = net.unfollows; gained = val(net.follows - net.unfollows, IG.followersGained?.source); gained.since = from }
    else notes.push("Instagram's own follows and unfollows could not be read, so the gain is from Zernio's daily count")
    const pnet = raw.ig.prevNet.ok ? igNetFollows(raw.ig.prevNet.data) : null
    if (pnet) { previousGained = val(pnet.follows - pnet.unfollows, IG.followersGained?.source); previousGained.since = prevRange.from }
  }

  return {
    platform: p, accountId: acc.id, handle: acc.handle,
    countedAs: byPosts ? 'posts' : 'month',
    figures, previous,
    followers: { gained, previousGained, start, end, trackedFrom, follows, unfollows, dailyGained },
    interactionsOther, viewsFromFollowersPct,
    tiktokMix: p === 'tiktok' ? (() => {
      const audienceTypes = viewsWeighted(posts, 'audienceTypes'), impressionSources = viewsWeighted(posts, 'impressionSources')
      return Object.keys(audienceTypes).length || Object.keys(impressionSources).length ? { audienceTypes, impressionSources } : null
    })() : null,
    posts, notes,
  }
}

function val0(v: number | null, source?: string): Figure { return v == null ? notGiven(source) : val(v, source) }
function strip(g: Figure & { start?: number; end?: number; startDay?: string; endDay?: string }): Figure {
  const out: Figure = { state: g.state }
  if (g.value != null) out.value = g.value
  if (g.since !== undefined) out.since = g.since
  if (g.reason) out.reason = g.reason
  if (g.source) out.source = g.source
  return out
}
