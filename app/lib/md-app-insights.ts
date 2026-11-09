import 'server-only'
import { authFor, mdGraph } from './md-app'
import { IG_ACCOUNT_METRICS, IG_MEDIA_METRICS, PAGE_METRICS, parseMdInsights } from './md-app-core'

/**
 * MD APP INSIGHTS TAB — the I/O half (9 Nov 2026). The last 28 days for the client's Instagram account and Facebook
 * Page, each recent Instagram post's numbers, and the list of Pages this connection can manage. Read only. What
 * Meta's App Review watches for instagram_basic, instagram_manage_insights, pages_show_list, pages_read_engagement
 * and read_insights. A metric Meta refuses is left out rather than failing the whole tab.
 */

const { get, pageAuth, pickedOf } = mdGraph

export type Metric = { key: string; label: string; value: number | null }
export type PostStat = { id: string; caption: string; thumb: string | null; link: string | null; time: string | null; metrics: Metric[] }
export type InsightsOut = {
  range: { since: string; until: string }
  instagram: null | { username: string | null; picture: string | null; followers: number | null; posts: number | null; metrics: Metric[]; recent: PostStat[]; error: string | null }
  facebook: null | { name: string | null; picture: string | null; followers: number | null; metrics: Metric[]; error: string | null }
  pages: { id: string; name: string; followers: number | null; picture: string | null; picked: boolean }[]
}

const WORDS: Record<string, string> = {
  reach: 'Accounts reached', views: 'Views', profile_views: 'Profile visits', accounts_engaged: 'Accounts engaged',
  total_interactions: 'Interactions', follows_and_unfollows: 'Follows', likes: 'Likes', comments: 'Comments', saved: 'Saves', shares: 'Shares',
  page_follows: 'Followers', page_daily_follows_unique: 'New followers', page_media_view: 'Views', page_total_media_view_unique: 'People reached',
  page_post_engagements: 'Post engagements', page_views_total: 'Page visits',
}
const toMetrics = (rows: { metric: string; value: number | null }[], order: readonly string[]) =>
  order.map(k => ({ key: k, label: WORDS[k] ?? k, value: rows.find(r => r.metric === k)?.value ?? null })).filter(m => m.value !== null)
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Could not read')
const num = (v: unknown) => (typeof v === 'number' ? v : Number.isFinite(Number(v)) ? Number(v) : null)

export async function insightsFor(clientId: string, now = new Date()): Promise<InsightsOut> {
  const { auth, picked } = await authFor(clientId)
  const until = Math.floor(now.getTime() / 1000)
  const since = until - 28 * 86400
  const range = { since: new Date(since * 1000).toISOString().slice(0, 10), until: now.toISOString().slice(0, 10) }
  const ig = picked.some(r => r.kind === 'instagram') ? pickedOf(picked, 'instagram') : null
  const page = picked.some(r => r.kind === 'page') ? pickedOf(picked, 'page') : null

  const igPart = async (): Promise<InsightsOut['instagram']> => {
    if (!ig) return null
    const profile = await get(auth, ig, { fields: 'username,profile_picture_url,followers_count,media_count' }).catch(() => null)
    let metrics: Metric[] = []; let error: string | null = null
    try {
      metrics = toMetrics(parseMdInsights(await get(auth, `${ig}/insights`, { metric: IG_ACCOUNT_METRICS.join(','), period: 'day', metric_type: 'total_value', since, until })), IG_ACCOUNT_METRICS)
    } catch (e) { error = msg(e) }
    const media = await get(auth, `${ig}/media`, { fields: 'id,caption,timestamp,permalink,media_type,media_url,thumbnail_url', limit: 6 }).catch(() => null)
    const rows: any[] = Array.isArray(media?.data) ? media.data : []
    const recent = await Promise.all(rows.map(async r => ({
      id: String(r.id), caption: typeof r.caption === 'string' ? r.caption : '', link: r.permalink ?? null, time: r.timestamp ?? null,
      thumb: r.thumbnail_url ?? (r.media_type === 'VIDEO' ? null : r.media_url ?? null),
      metrics: toMetrics(parseMdInsights(await get(auth, `${r.id}/insights`, { metric: IG_MEDIA_METRICS.join(',') }).catch(() => null)), IG_MEDIA_METRICS),
    })))
    return { username: profile?.username ?? null, picture: profile?.profile_picture_url ?? null, followers: num(profile?.followers_count), posts: num(profile?.media_count), metrics, recent, error }
  }

  const fbPart = async (): Promise<InsightsOut['facebook']> => {
    if (!page) return null
    try {
      const pa = await pageAuth(auth, page)
      const profile = await get(pa, page, { fields: 'name,followers_count,picture{url}' }).catch(() => null)
      let metrics: Metric[] = []; let error: string | null = null
      try {
        const rows = parseMdInsights(await get(pa, `${page}/insights`, { metric: PAGE_METRICS.filter(m => m !== 'page_follows').join(','), period: 'day', since, until }))
        metrics = toMetrics(rows, PAGE_METRICS)
      } catch (e) { error = msg(e) }
      return { name: profile?.name ?? null, picture: profile?.picture?.data?.url ?? null, followers: num(profile?.followers_count), metrics, error }
    } catch (e) { return { name: null, picture: null, followers: null, metrics: [], error: msg(e) } }
  }

  // pages_show_list: the Pages this login manages; the picked one is marked
  const pagesPart = async (): Promise<InsightsOut['pages']> => {
    const json = await get(auth, 'me/accounts', { fields: 'id,name,followers_count,picture{url}', limit: 50 }).catch(() => null)
    const list: any[] = Array.isArray(json?.data) ? json.data : []
    const out = list.map(p => ({ id: String(p.id), name: String(p.name ?? p.id), followers: num(p.followers_count), picture: p.picture?.data?.url ?? null, picked: String(p.id) === page }))
    if (page && !out.some(p => p.id === page)) {
      const one = await get(auth, page, { fields: 'id,name,followers_count,picture{url}' }).catch(() => null)
      if (one) out.unshift({ id: page, name: String(one.name ?? page), followers: num(one.followers_count), picture: one.picture?.data?.url ?? null, picked: true })
    }
    return out
  }

  const [instagram, facebook, pages] = await Promise.all([igPart(), fbPart(), pagesPart()])
  return { range, instagram, facebook, pages }
}
