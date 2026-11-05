/**
 * REPORT V2 — every Zernio read for one account's month, through an injected fetcher (the live API in the app,
 * recorded answers in tests/fixtures/zernio). Read only: nothing here writes anywhere.
 */
import { monthRange, previousMonth } from '../client-report-core'
import type { RawAccountMonth, V2Account, ZernioAnswer, ZernioFetch } from './types'

export const IG_METRICS = 'views,reach,total_interactions,profile_views,profile_links_taps,likes,comments,shares,saves,accounts_engaged,replies,reposts,website_clicks'

export async function readAccountMonth(z: ZernioFetch, acc: V2Account, profileId: string | null, month: string, today: string): Promise<RawAccountMonth> {
  const { from, to } = monthRange(month)
  const prev = monthRange(previousMonth(month))
  const profile = profileId ? { profileId } : {}
  const dash = await z('/analytics/dashboard', { ...profile, platform: acc.platform, fromDate: from, toDate: to, compare: 'previous_period', topPosts: 10, recentPosts: 0 })
  const prevDash = await z('/analytics/dashboard', { ...profile, platform: acc.platform, fromDate: prev.from, toDate: prev.to, topPosts: 0, recentPosts: 0 })
  // DAILY, NEVER MONTHLY: the monthly bucket labelled "1 Oct" carries a mid-month count (5 Nov 2026)
  const followerStats = await z('/accounts/follower-stats', { accountIds: acc.id, fromDate: prev.from, toDate: to <= today ? to : today, granularity: 'daily' })
  const posts: ZernioAnswer[] = []
  for (let page = 1; page <= 5; page++) {
    const r = await z<{ pagination?: { pages?: number } }>('/analytics', { platform: acc.platform, accountId: acc.id, fromDate: from, toDate: to, limit: 100, page, source: 'all' })
    posts.push(r as ZernioAnswer)
    if (!r.ok || !(Number(r.data.pagination?.pages) > page)) break
  }
  // the posts MD Media sent through the app (Zernio source=late)
  const late = await z('/analytics', { platform: acc.platform, accountId: acc.id, fromDate: from, toDate: to, limit: 100, page: 1, source: 'late' })
  let ig: RawAccountMonth['ig'] = null
  if (acc.platform === 'instagram') {
    const insights = await z('/analytics/instagram/account-insights', { accountId: acc.id, metrics: IG_METRICS, fromDate: from, toDate: to, metricType: 'total_value' })
    const prevInsights = await z('/analytics/instagram/account-insights', { accountId: acc.id, metrics: IG_METRICS, fromDate: prev.from, toDate: prev.to, metricType: 'total_value' })
    const split = await z('/analytics/instagram/account-insights', { accountId: acc.id, metrics: 'views', fromDate: from, toDate: to, metricType: 'total_value', breakdown: 'follow_type' })
    const net = await z('/analytics/instagram/account-insights', { accountId: acc.id, metrics: 'follows_and_unfollows', fromDate: from, toDate: to, metricType: 'total_value', breakdown: 'follow_type' })
    const prevNet = await z('/analytics/instagram/account-insights', { accountId: acc.id, metrics: 'follows_and_unfollows', fromDate: prev.from, toDate: prev.to, metricType: 'total_value', breakdown: 'follow_type' })
    ig = { insights, prevInsights, split, net, prevNet }
  }
  return { account: acc, month, today, dash, prevDash, followerStats, posts, late, ig }
}
