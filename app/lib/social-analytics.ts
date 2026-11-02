import 'server-only'
import { table } from '@/lib/db'
import type { Client, SocialAccount } from '@/lib/db-types'
import { getPublisher } from './publisher'
import { followerChange, pictureExpired, refreshPictures, trimPost, type AnalyticsPost } from './social-analytics-core'

const PAGE = 100

/**
 * Every post published between two days (inclusive) with its numbers — Zernio's /analytics, which covers posts
 * made on the platform itself too. One channel when `accountId` (Zernio's id) is given. The first page says how
 * many there are; the rest are read three at a time — Zernio allows about 6 analytics calls a second (its rate-limit
 * docs, read 2 Nov 2026), and a client's page reads two channels at once. Null when Zernio cannot be read at all.
 */
export async function publishedBetween(
  from: string, to: string, opts: { accountId?: string; maxPages?: number } = {},
): Promise<{ posts: AnalyticsPost[]; complete: boolean; asOf: string | null; syncing: boolean } | null> {
  const publisher = getPublisher()
  const read = (page: number) => publisher
    .analyticsPage({ fromDate: from, toDate: to, page, limit: PAGE, ...(opts.accountId ? { accountId: opts.accountId } : {}) })
    .catch(() => null) as Promise<{
      posts?: unknown[]; pagination?: { pages?: number }
      overview?: { lastSync?: string; dataStaleness?: { staleAccountCount?: number; syncTriggered?: boolean } }
    } | null>
  const first = await read(1)
  if (!first) return null
  const raws: unknown[] = [...(first.posts ?? [])]
  const pages = Math.max(1, Number(first.pagination?.pages ?? 1))
  const last = Math.min(pages, opts.maxPages ?? 30)
  for (let start = 2; start <= last; start += 3) {
    const batch = await Promise.all(Array.from({ length: Math.min(3, last - start + 1) }, (_, i) => read(start + i)))
    for (const res of batch) raws.push(...(res?.posts ?? []))
  }
  const posts = raws.map(trimPost).filter((p): p is AnalyticsPost => p !== null)
  // when Zernio last read these accounts, and whether it is reading some again now ("data as of", its guide says)
  const stale = first.overview?.dataStaleness
  return {
    posts, complete: last >= pages,
    asOf: typeof first.overview?.lastSync === 'string' ? first.overview.lastSync : null,
    syncing: !!stale?.syncTriggered,
  }
}

export type ChannelRow = {
  id: string; client_id: string | null; platform: string; provider_account_id: string
  username: string | null; name: string | null; avatar_url: string | null
  /** today's count */
  followers: number | null
  /** gained (or lost) over the days picked, counted from `growthSince` — the first reading inside them */
  growth: number | null
  growthSince: string | null
  /** when today's follower count was read */
  followersReadAt: string | null
}

type FollowerStats = {
  accounts?: { _id: string; currentFollowers?: number; lastUpdated?: string }[]
  stats?: Record<string, unknown>
} | null

/** Today's followers and the change over the days picked, per Zernio account id. */
export async function followersFor(range: { from: string; to: string }, accountIds?: string[]) {
  const raw = await getPublisher().followerStats({ fromDate: range.from, toDate: range.to, accountIds }).catch(() => null) as FollowerStats
  const out = new Map<string, { followers: number | null; growth: number | null; growthSince: string | null; readAt: string | null }>()
  for (const a of raw?.accounts ?? []) {
    const ch = followerChange(raw?.stats?.[a._id])
    out.set(a._id, {
      followers: typeof a.currentFollowers === 'number' ? a.currentFollowers : null,
      growth: ch?.change ?? null,
      growthSince: ch?.since ?? null,
      readAt: typeof a.lastUpdated === 'string' ? a.lastUpdated : null,
    })
  }
  return out
}

/** The active channels (one client's, or everyone's) with their followers over the days picked, and the clients' names. */
export async function channelsWithFollowers(clientId: string | null, range: { from: string; to: string }): Promise<{ channels: ChannelRow[]; clients: { id: string; name: string }[] }> {
  const [rows, clients] = await Promise.all([
    table<SocialAccount>('social_accounts').list({
      by: { active: true },
      where: clientId ? a => a.client_id === clientId : undefined,
    }),
    table<Client>('clients').list(),
  ])
  const followers = await followersFor(range, clientId ? rows.map(r => r.provider_account_id).filter(Boolean) : undefined)
  return {
    channels: rows.map(r => {
      const f = followers.get(r.provider_account_id)
      return {
        id: r.id, client_id: r.client_id, platform: r.platform, provider_account_id: r.provider_account_id,
        username: r.username, name: r.name, avatar_url: r.avatar_url,
        followers: f?.followers ?? null, growth: f?.growth ?? null, growthSince: f?.growthSince ?? null,
        followersReadAt: f?.readAt ?? null,
      }
    }),
    clients: clients.map(c => ({ id: c.id, name: c.name })),
  }
}

/** Expired TikTok pictures swapped for fresh ones from the account's live feed — one feed read, only when needed. */
export async function withLivePictures(posts: AnalyticsPost[], providerAccountId: string): Promise<AnalyticsPost[]> {
  const now = Date.now()
  if (!posts.some(p => pictureExpired(p.thumbnail, now))) return posts
  const feed = await getPublisher().accountPosts(providerAccountId).catch(() => null)
  return refreshPictures(posts, feed, now)
}
