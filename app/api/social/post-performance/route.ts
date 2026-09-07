import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireSignedIn, authzErrorResponse, AuthzError } from '@/app/lib/authz'
import { loadItemForUser } from '@/app/lib/production-access'
import { getPublisher } from '@/app/lib/publisher'
import { analyticsForItems, refreshStaleAnalyticsInBackground } from '@/app/lib/post-analytics'
import { isStale, metricsPending } from '@/app/lib/post-analytics-core'
import { readPerformance, type PostPerformance } from '@/app/lib/post-performance-core'

/**
 * HOW ONE POST DID — the card's question.
 *
 *   GET /api/social/post-performance?item=<content item id>
 *
 * Answers from the per-post cache, never from the provider: the numbers are
 * what the half-hourly sweep last wrote, and the card is told how old they
 * are. When they are stale the sweep is nudged in the background (same budget
 * the portal uses) and the card's live subscription to the row picks up the
 * fresh figures when they land — so a person opening a card minutes after a
 * post goes live waits at most a few seconds, and a busy board never spends
 * the provider's rate limit on renders.
 *
 * Scoped by item, through the same gate the card itself passes
 * (`loadItemForUser`): a person who cannot open the card cannot read its
 * numbers by pasting an id. Team only — the client's portal has its own path.
 */
export type PostPerformanceResponse = {
  item: string
  /** the summary, or null when nothing has been cached for this item */
  performance: PostPerformance | null
  platform: string | null
  post_url: string | null
  synced_at: string | null
  /** the platform has not handed over figures yet */
  pending: boolean
  /** is a provider connected at all — the card's words depend on it */
  configured: boolean
}

export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      if (user.role === 'client') throw new AuthzError('Insufficient permissions', 403)
      const item = new URL(req.url).searchParams.get('item')
      if (!item) return NextResponse.json({ error: 'item is required' }, { status: 400 })

      const row = await loadItemForUser(user, item)
      const cached = (await analyticsForItems([item])).get(item) ?? null

      if (row.client_id && (!cached || isStale(cached.synced_at))) {
        refreshStaleAnalyticsInBackground(row.client_id)
      }

      const body: PostPerformanceResponse = {
        item,
        performance: readPerformance(cached?.performance),
        platform: cached?.platform ?? null,
        post_url: cached?.platform_post_url ?? null,
        synced_at: cached?.synced_at ?? null,
        pending: metricsPending(cached),
        configured: getPublisher().configured(),
      }
      return NextResponse.json(body)
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
