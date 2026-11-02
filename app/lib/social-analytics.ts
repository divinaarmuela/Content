import 'server-only'
import { table } from '@/lib/db'
import type { Client, SocialAccount } from '@/lib/db-types'
import { getPublisher } from './publisher'
import { trimPost, type AnalyticsPost } from './social-analytics-core'

const PAGE = 100

/**
 * Every post published between two days (inclusive) with its numbers — Zernio's /analytics, which covers posts
 * made on the platform itself too. One channel when `accountId` (Zernio's id) is given. The first page says how
 * many there are; the rest are read five at a time. Null when Zernio cannot be read at all.
 */
export async function publishedBetween(
  from: string, to: string, opts: { accountId?: string; maxPages?: number } = {},
): Promise<{ posts: AnalyticsPost[]; complete: boolean } | null> {
  const publisher = getPublisher()
  const read = (page: number) => publisher
    .analyticsPage({ fromDate: from, toDate: to, page, limit: PAGE, ...(opts.accountId ? { accountId: opts.accountId } : {}) })
    .catch(() => null) as Promise<{ posts?: unknown[]; pagination?: { pages?: number } } | null>
  const first = await read(1)
  if (!first) return null
  const raws: unknown[] = [...(first.posts ?? [])]
  const pages = Math.max(1, Number(first.pagination?.pages ?? 1))
  const last = Math.min(pages, opts.maxPages ?? 30)
  for (let start = 2; start <= last; start += 5) {
    const batch = await Promise.all(Array.from({ length: Math.min(5, last - start + 1) }, (_, i) => read(start + i)))
    for (const res of batch) raws.push(...(res?.posts ?? []))
  }
  const posts = raws.map(trimPost).filter((p): p is AnalyticsPost => p !== null)
  return { posts, complete: last >= pages }
}

export type ChannelRow = {
  id: string; client_id: string | null; platform: string; provider_account_id: string
  username: string | null; name: string | null; avatar_url: string | null
  followers: number | null; growth: number | null
}

/** The active channels (one client's, or everyone's) with their follower counts, and the clients' names. */
export async function channelsWithFollowers(clientId?: string | null): Promise<{ channels: ChannelRow[]; clients: { id: string; name: string }[] }> {
  const [rows, clients, followers] = await Promise.all([
    table<SocialAccount>('social_accounts').list({
      by: { active: true },
      where: clientId ? a => a.client_id === clientId : undefined,
    }),
    table<Client>('clients').list(),
    getPublisher().followerStats().catch(() => null) as Promise<{ accounts?: { _id: string; currentFollowers?: number; growth?: number }[] } | null>,
  ])
  const byId = new Map((followers?.accounts ?? []).map(f => [f._id, f]))
  return {
    channels: rows.map(r => {
      const f = byId.get(r.provider_account_id)
      return {
        id: r.id, client_id: r.client_id, platform: r.platform, provider_account_id: r.provider_account_id,
        username: r.username, name: r.name, avatar_url: r.avatar_url,
        followers: typeof f?.currentFollowers === 'number' ? f.currentFollowers : null,
        growth: typeof f?.growth === 'number' ? f.growth : null,
      }
    }),
    clients: clients.map(c => ({ id: c.id, name: c.name })),
  }
}
