import 'server-only'
import type { SocialAccount } from '@/lib/db-types'
import { getPublisher } from './publisher'
import {
  clampRange, readDemographics, readEnvelope, refusalWords, shiftDays, sortSlices,
  type Point, type SectionKey, type Slice,
} from './channel-insights-core'

/**
 * A CHANNEL'S DEEP ANALYTICS, ONE TAB AT A TIME (the owner, 2 Nov 2026). Each tab is read only when it is opened, a
 * few Zernio calls each (it allows about 6 analytics calls a second). Addresses, parameters and replies read live —
 * see channel-insights-core.ts. Every section either carries its numbers or `problem`: the platform's refusal in
 * plain words, never an empty panel.
 */

type Range = { from: string; to: string }
type Read = { status: number; body: unknown }

const read = async (path: string, params: Record<string, string | undefined>): Promise<Read> =>
  (await getPublisher().readAnalytics(path, params)) ?? { status: 0, body: { error: 'Not set up' } }

const ok = (r: Read) => r.status >= 200 && r.status < 300

/** The day after — LinkedIn's personal-profile call reads `toDate` as exclusive. */
const dayAfter = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10) }

export type SectionResult =
  | { problem: string }
  | { kind: 'ig_account'; range: Range; clamped: boolean; totals: Record<string, number>; follows: number | null; unfollows: number | null; reach: Point[]; viewsByFormat: Slice[]; delay: string | null }
  | { kind: 'followers'; range: Range; clamped: boolean; current: number; gained: number; lost: number; count: Point[]; gainedByDay: Point[]; lostByDay: Point[]; delay: string | null }
  | { kind: 'ig_audience'; followers: Record<string, Slice[]>; engaged: Record<string, Slice[]> }
  | { kind: 'stories'; stories: { id: string; mediaType: string | null; permalink: string | null; thumbnail: string | null; at: string | null; source: string; metrics: Record<string, number> }[] }
  | { kind: 'tagged'; posts: { id: string; username: string | null; caption: string; permalink: string | null; thumbnail: string | null; at: string | null; likes: number | null; comments: number | null; mediaType: string | null }[] }
  | { kind: 'tt_account'; range: Range; clamped: boolean; totals: Record<string, number>; followers: Point[]; delay: string | null }
  | { kind: 'fb_page'; range: Range; clamped: boolean; totals: Record<string, number>; views: Point[]; engagements: Point[]; unavailable: string[]; delay: string | null }
  | { kind: 'fb_audience'; demographics: Record<string, Slice[]>; snapshotDate: string | null }
  | { kind: 'li_org'; range: Range; clamped: boolean; totals: Record<string, number>; impressions: Point[]; clicks: Point[]; delay: string | null }
  | { kind: 'li_personal'; range: Range; totals: Record<string, number> }
  | { kind: 'li_audience'; demographics: Record<string, Slice[]> }

export async function loadSection(account: SocialAccount, section: SectionKey, asked: Range): Promise<SectionResult> {
  const id = account.provider_account_id
  const platform = account.platform
  const words = (r: Read) => ({ problem: refusalWords(r.status, r.body, platform) })
  const { clamped, ...range } = clampRange(asked)
  const dates = { fromDate: range.from, toDate: range.to }

  if (platform === 'instagram') {
    if (section === 'account') {
      const path = '/analytics/instagram/account-insights'
      const totals = await read(path, { accountId: id, ...dates, metricType: 'total_value',
        metrics: 'reach,views,accounts_engaged,total_interactions,likes,comments,saves,shares,replies,reposts,profile_views,profile_links_taps,website_clicks' })
      if (!ok(totals)) return words(totals)
      // follows and unfollows only come apart with the follow_type breakdown — FOLLOWER = follows, NON_FOLLOWER =
      // unfollows (Meta's naming); without it the total reads 0
      const [follows, reach, views] = await Promise.all([
        read(path, { accountId: id, ...dates, metricType: 'total_value', metrics: 'follows_and_unfollows', breakdown: 'follow_type' }),
        read(path, { accountId: id, ...dates, metricType: 'time_series', metrics: 'reach' }),
        read(path, { accountId: id, ...dates, metricType: 'total_value', metrics: 'views', breakdown: 'media_product_type' }),
      ])
      const t = readEnvelope(totals.body)
      const f = ok(follows) ? readEnvelope(follows.body).breakdowns.follows_and_unfollows ?? [] : null
      return {
        kind: 'ig_account', range, clamped, totals: t.totals, delay: t.delay,
        follows: f ? f.find(s => s.label === 'FOLLOWER')?.value ?? 0 : null,
        unfollows: f ? f.find(s => s.label === 'NON_FOLLOWER')?.value ?? 0 : null,
        reach: ok(reach) ? readEnvelope(reach.body).series.reach ?? [] : [],
        viewsByFormat: ok(views) ? readEnvelope(views.body).breakdowns.views ?? [] : [],
      }
    }
    if (section === 'followers') {
      const r = await read('/analytics/instagram/follower-history', { accountId: id, ...dates, metricType: 'time_series',
        metrics: 'follower_count,followers_gained,followers_lost' })
      if (!ok(r)) return words(r)
      const e = readEnvelope(r.body)
      const count = e.series.follower_count ?? []
      return {
        kind: 'followers', range, clamped, delay: e.delay,
        current: count.length ? count[count.length - 1].value : e.totals.follower_count ?? 0,
        gained: (e.series.followers_gained ?? []).reduce((s, p) => s + p.value, 0),
        lost: (e.series.followers_lost ?? []).reduce((s, p) => s + p.value, 0),
        count, gainedByDay: e.series.followers_gained ?? [], lostByDay: e.series.followers_lost ?? [],
      }
    }
    if (section === 'audience') {
      const path = '/analytics/instagram/demographics'
      const [fol, eng] = await Promise.all([
        read(path, { accountId: id, metric: 'follower_demographics', breakdown: 'age,gender,country,city', timeframe: 'this_month' }),
        read(path, { accountId: id, metric: 'engaged_audience_demographics', breakdown: 'age,gender,country,city', timeframe: 'this_month' }),
      ])
      if (!ok(fol)) return words(fol)
      return { kind: 'ig_audience', followers: readDemographics(fol.body), engaged: ok(eng) ? readDemographics(eng.body) : {} }
    }
    if (section === 'stories') {
      const list = await read(`/accounts/${encodeURIComponent(id)}/instagram/stories`, {})
      if (!ok(list)) return words(list)
      const raw = ((list.body as { data?: unknown[] })?.data ?? []) as Record<string, unknown>[]
      const stories: Extract<SectionResult, { kind: 'stories' }>['stories'] = []
      // three at a time — inside Zernio's per-second allowance
      for (let i = 0; i < raw.length; i += 3) {
        const batch = await Promise.all(raw.slice(i, i + 3).map(async s => {
          const sid = String(s.id ?? '')
          const ins = sid ? await read(`/accounts/${encodeURIComponent(id)}/instagram/stories/${encodeURIComponent(sid)}/insights`, {}) : null
          const d = ((ins && ok(ins) ? (ins.body as { data?: unknown })?.data : null) ?? {}) as { source?: unknown; metrics?: Record<string, unknown> }
          const metrics: Record<string, number> = {}
          for (const [k, v] of Object.entries(d.metrics ?? {})) if (typeof v === 'number') metrics[k] = v
          return {
            id: sid, mediaType: typeof s.mediaType === 'string' ? s.mediaType : null,
            permalink: typeof s.permalink === 'string' ? s.permalink : null,
            thumbnail: typeof s.thumbnailUrl === 'string' ? s.thumbnailUrl : typeof s.mediaUrl === 'string' ? s.mediaUrl : null,
            at: typeof s.timestamp === 'string' ? s.timestamp : null,
            source: typeof d.source === 'string' ? d.source : 'unavailable', metrics,
          }
        }))
        stories.push(...batch)
      }
      return { kind: 'stories', stories }
    }
    if (section === 'tagged') {
      const r = await read(`/accounts/${encodeURIComponent(id)}/instagram/tags`, { limit: '50' })
      if (!ok(r)) return words(r)
      const raw = ((r.body as { data?: unknown[] })?.data ?? []) as Record<string, unknown>[]
      const s = (v: unknown) => (typeof v === 'string' && v ? v : null)
      return {
        kind: 'tagged',
        posts: raw.map(p => ({
          id: String(p.id ?? ''), username: s(p.username), caption: typeof p.caption === 'string' ? p.caption.slice(0, 400) : '',
          permalink: s(p.permalink), thumbnail: s(p.thumbnailUrl) ?? s(p.mediaUrl), at: s(p.timestamp),
          likes: typeof p.likeCount === 'number' ? p.likeCount : null, comments: typeof p.commentsCount === 'number' ? p.commentsCount : null,
          mediaType: s(p.mediaType),
        })),
      }
    }
  }

  if (platform === 'tiktok' && section === 'account') {
    const path = '/analytics/tiktok/account-insights'
    const [totals, series] = await Promise.all([
      read(path, { accountId: id, ...dates, metricType: 'total_value', metrics: 'follower_count,following_count,likes_count,video_count,followers_gained,followers_lost' }),
      read(path, { accountId: id, ...dates, metricType: 'time_series', metrics: 'follower_count' }),
    ])
    if (!ok(totals)) return words(totals)
    const t = readEnvelope(totals.body)
    return { kind: 'tt_account', range, clamped, totals: t.totals, delay: t.delay, followers: ok(series) ? readEnvelope(series.body).series.follower_count ?? [] : [] }
  }

  if (platform === 'facebook') {
    if (section === 'page') {
      const path = '/analytics/facebook/page-insights'
      const [totals, series] = await Promise.all([
        read(path, { accountId: id, ...dates, metricType: 'total_value',
          metrics: 'page_media_view,page_views_total,page_post_engagements,page_video_views,page_video_view_time,page_follows,followers_gained,followers_lost' }),
        read(path, { accountId: id, ...dates, metricType: 'time_series', metrics: 'page_media_view,page_post_engagements' }),
      ])
      if (!ok(totals)) return words(totals)
      const t = readEnvelope(totals.body)
      const s = ok(series) ? readEnvelope(series.body) : null
      return {
        kind: 'fb_page', range, clamped, totals: t.totals, unavailable: t.unavailable, delay: t.delay,
        views: shiftDays(s?.series.page_media_view ?? [], -1), engagements: shiftDays(s?.series.page_post_engagements ?? [], -1),
      }
    }
    if (section === 'audience') {
      const r = await read('/analytics/facebook/demographics', { accountId: id, breakdown: 'country,city' })
      if (!ok(r)) return words(r)
      const snap = (r.body as { snapshotDate?: unknown })?.snapshotDate
      return { kind: 'fb_audience', demographics: readDemographics(r.body), snapshotDate: typeof snap === 'string' ? snap : null }
    }
  }

  if (platform === 'linkedin') {
    if (section === 'page') {
      const path = '/analytics/linkedin/org-aggregate-analytics'
      const [totals, series] = await Promise.all([
        read(path, { accountId: id, ...dates, metricType: 'total_value',
          metrics: 'impressions,unique_impressions,clicks,likes,comments,shares,engagement_rate,organic_followers_gained,paid_followers_gained,followers_gained,followers_lost,page_views_total' }),
        read(path, { accountId: id, ...dates, metricType: 'time_series', metrics: 'impressions,clicks' }),
      ])
      if (ok(totals)) {
        const t = readEnvelope(totals.body)
        const s = ok(series) ? readEnvelope(series.body) : null
        return { kind: 'li_org', range, clamped, totals: t.totals, delay: t.delay, impressions: s?.series.impressions ?? [], clicks: s?.series.clicks ?? [] }
      }
      // a personal profile has its own call, and a different reply (`analytics: { impressions, reach, … }`)
      if (/personal_account_not_supported/.test(JSON.stringify(totals.body))) {
        const p = await read(`/accounts/${encodeURIComponent(id)}/linkedin-aggregate-analytics`, { aggregation: 'TOTAL', fromDate: asked.from, toDate: dayAfter(asked.to) })
        if (!ok(p)) return words(p)
        const a = ((p.body as { analytics?: Record<string, unknown> })?.analytics ?? {})
        const out: Record<string, number> = {}
        for (const [k, v] of Object.entries(a)) if (typeof v === 'number') out[k] = v
        return { kind: 'li_personal', range: asked, totals: out }
      }
      return words(totals)
    }
    if (section === 'audience') {
      const r = await read('/analytics/linkedin/demographics', { accountId: id, breakdown: 'function,seniority,industry,company_size,country,region' })
      if (!ok(r)) {
        if (/personal_account_not_supported|organization/i.test(JSON.stringify(r.body))) {
          return { problem: 'LinkedIn only gives who follows a company page. This is a personal profile, so there is no make-up to show.' }
        }
        return words(r)
      }
      const d = ((r.body as { demographics?: Record<string, unknown> })?.demographics ?? {})
      const demographics: Record<string, Slice[]> = {}
      for (const [k, v] of Object.entries(d)) { const s = sortSlices(v); if (s.length) demographics[k] = s }
      return { kind: 'li_audience', demographics }
    }
  }

  return { problem: 'This channel has no such numbers.' }
}
