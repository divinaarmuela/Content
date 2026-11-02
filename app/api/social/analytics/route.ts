import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { SocialAccount, Client } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'

/** Sum per-account daily series into one, matched by date. */
function mergeDaily(raws: unknown[]): { dailyData: { date: string; metrics: Record<string, number> }[] } | null {
  const byDate = new Map<string, Record<string, number>>()
  for (const raw of raws) {
    const days = (raw as { dailyData?: unknown } | null)?.dailyData
    if (!Array.isArray(days)) continue
    for (const d of days) {
      const { date, metrics } = (d ?? {}) as { date?: string; metrics?: Record<string, unknown> }
      if (!date) continue
      const bucket = byDate.get(date) ?? {}
      for (const [k, v] of Object.entries(metrics ?? {})) {
        if (typeof v === 'number') bucket[k] = (bucket[k] ?? 0) + v
      }
      byDate.set(date, bucket)
    }
  }
  if (byDate.size === 0) return null
  return {
    dailyData: [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, metrics]) => ({ date, metrics })),
  }
}

/** Every post published between two days with its numbers (Zernio's /analytics, 100 a page, at most 10 pages). */
async function postsBetween(fromDate: string, toDate: string): Promise<{ posts: unknown[] } | null> {
  const publisher = getPublisher()
  const posts: unknown[] = []
  for (let page = 1; page <= 10; page++) {
    const res = await publisher.analyticsPage({ fromDate, toDate, page, limit: 100 }).catch(() => null) as
      { posts?: unknown[]; pagination?: { pages?: number } } | null
    if (!res) return page === 1 ? null : { posts }
    posts.push(...(res.posts ?? []))
    if (page >= Number(res.pagination?.pages ?? 1) || (res.posts ?? []).length === 0) break
  }
  return { posts }
}

/**
 * Cross-account analytics for the whole agency, or one client.
 *
 * Sources are fetched together and allowed to fail independently — a platform
 * that has not synced yet should leave one panel empty, not the page.
 */
export async function GET(req: Request) {
  return withRequestCache(async () => {
  try {
    await requireRole('scheduler')
    const url = new URL(req.url)
    const clientId = url.searchParams.get('clientId')
    // A WEEK (2 Nov 2026): every post published in those days, page by page — the default list is only the newest
    const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
    const from = day(url.searchParams.get('from')), to = day(url.searchParams.get('to'))

    const rows = await table<SocialAccount>('social_accounts').list({
      by: { active: true },
      where: clientId ? a => a.client_id === clientId : undefined,
    })
    // the columns the old select named
    const accounts = rows.map(r => ({
      id: r.id, client_id: r.client_id, platform: r.platform,
      provider_account_id: r.provider_account_id, username: r.username, active: r.active,
    }))

    const publisher = getPublisher()
    const providerIds = accounts.map(a => a.provider_account_id).filter(Boolean)

    // The provider aggregates across every connected account by default, so a
    // client filter means asking per-account and merging — not filtering after.
    const [daily, followers, analytics, bestTimes] = await Promise.all([
      clientId
        ? Promise.all(providerIds.map(id => publisher.dailyMetrics(id))).then(mergeDaily)
        : publisher.dailyMetrics(),
      publisher.followerStats(),
      from && to ? postsBetween(from, to) : publisher.postAnalytics(),
      clientId
        ? Promise.all(providerIds.map(id => publisher.bestTimes(id)))
            .then(list => ({ sources: list.filter(Boolean) }))
        : publisher.bestTimes(),
    ])

    // clients, so the UI can name an account's owner without a second call
    const clients = (await table<Client>('clients').list()).map(c => ({ id: c.id, name: c.name }))

    return NextResponse.json({
      accounts,
      clients,
      daily,
      followers,
      analytics,
      bestTimes,
      provider: { configured: publisher.configured() },
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
