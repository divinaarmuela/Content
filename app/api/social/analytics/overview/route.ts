import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { getPublisher } from '@/app/lib/publisher'
import { channelsWithFollowers, publishedBetween } from '@/app/lib/social-analytics'
import { sortPosts, summariseByAccount, type AnalyticsPost, type ChannelSummary } from '@/app/lib/social-analytics-core'

const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

/**
 * ANALYTICS BY CLIENT (2 Nov 2026). `GET ?from&to` — every client with its channels and each channel's numbers
 * for those days; `&clientId=` — one client, each channel asked on its own (exact, not one shared list cut down),
 * plus that client's best posts. Read only, from Zernio.
 */
export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler')
      const url = new URL(req.url)
      const from = day(url.searchParams.get('from')), to = day(url.searchParams.get('to'))
      if (!from || !to) return NextResponse.json({ error: 'Pick the days to show' }, { status: 400 })
      const clientId = url.searchParams.get('clientId')

      const { channels, clients } = await channelsWithFollowers(clientId)
      let posts: AnalyticsPost[] = []
      let complete = true
      let readable = true
      if (clientId) {
        // two channels at a time: Zernio allows about 6 analytics calls a second
        const each: Awaited<ReturnType<typeof publishedBetween>>[] = []
        for (let i = 0; i < channels.length; i += 2) {
          each.push(...await Promise.all(channels.slice(i, i + 2).map(c => publishedBetween(from, to, { accountId: c.provider_account_id }))))
        }
        readable = each.some(Boolean) || channels.length === 0
        for (const r of each) { posts.push(...(r?.posts ?? [])); if (r && !r.complete) complete = false }
      } else {
        const r = await publishedBetween(from, to)
        readable = !!r
        posts = r?.posts ?? []
        complete = r?.complete ?? false
      }
      const mine = new Set(channels.map(c => c.provider_account_id))
      posts = posts.filter(p => p.accountId && mine.has(p.accountId))
      const summaries: Record<string, ChannelSummary> = Object.fromEntries(summariseByAccount(posts))

      return NextResponse.json({
        clients: clientId ? clients.filter(c => c.id === clientId) : clients,
        channels,
        summaries,
        top: clientId ? sortPosts(posts, 'views').slice(0, 6) : [],
        complete,
        readable,
        configured: getPublisher().configured(),
      })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
