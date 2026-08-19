import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
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

/**
 * Cross-account analytics for the whole agency, or one client.
 *
 * Sources are fetched together and allowed to fail independently — a platform
 * that has not synced yet should leave one panel empty, not the page.
 */
export async function GET(req: Request) {
  try {
    await requireRole('scheduler')
    const clientId = new URL(req.url).searchParams.get('clientId')

    let q = supabase
      .from('social_accounts')
      .select('id, client_id, platform, provider_account_id, username, active')
      .eq('active', true)
    if (clientId) q = q.eq('client_id', clientId)
    const { data: accounts } = await q

    const publisher = getPublisher()
    const providerIds = (accounts ?? []).map(a => a.provider_account_id).filter(Boolean)

    // The provider aggregates across every connected account by default, so a
    // client filter means asking per-account and merging — not filtering after.
    const [daily, followers, analytics, bestTimes] = await Promise.all([
      clientId
        ? Promise.all(providerIds.map(id => publisher.dailyMetrics(id))).then(mergeDaily)
        : publisher.dailyMetrics(),
      publisher.followerStats(),
      publisher.postAnalytics(),
      clientId
        ? Promise.all(providerIds.map(id => publisher.bestTimes(id)))
            .then(list => ({ sources: list.filter(Boolean) }))
        : publisher.bestTimes(),
    ])

    // clients, so the UI can name an account's owner without a second call
    const { data: clients } = await supabase.from('clients').select('id, name')

    return NextResponse.json({
      accounts: accounts ?? [],
      clients: clients ?? [],
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
}
