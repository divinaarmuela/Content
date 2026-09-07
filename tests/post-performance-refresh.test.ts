import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * The refresh writes "How it did" beside the numbers — one cache, one upsert.
 *
 * What has to be true:
 *   - the per-post row carries `performance` with the follower delta for the
 *     account the post went to, the timeline series and the latest comments;
 *   - the follower series is asked for ONCE per sweep, not once per post;
 *   - the next post through the board closes the first post's window;
 *   - a provider that refuses the timeline (no add-on) or the comments still
 *     leaves the numbers on the row — the decorations are optional, the row
 *     is not.
 */

const NOW = new Date('2026-09-06T05:00:00.000Z')
const SERIES = [
  { date: '2026-08-30', followers: 100 },
  { date: '2026-09-01', followers: 110 },
  { date: '2026-09-02', followers: 115 },
  { date: '2026-09-04', followers: 121 },
  { date: '2026-09-06', followers: 127 },
]

const postAnalytics = vi.fn(async (postId?: string) => ({
  _id: postId, publishedAt: postId === 'zp-2' ? '2026-09-04T02:00:00.000Z' : '2026-09-01T02:00:00.000Z',
  syncStatus: 'synced',
  platformAnalytics: [{
    platform: 'instagram', syncStatus: 'synced', platformPostUrl: `https://instagram.com/p/${postId}/`,
    analytics: { likes: 30, comments: 4, shares: 6, saves: 2, reach: 1830, impressions: 2100 },
  }],
}))
const postTimeline = vi.fn(async () => ({
  timeline: [{ date: '2026-09-01', likes: 20 }, { date: '2026-09-02', likes: 10, comments: 4, shares: 6, saves: 2 }],
}))
const postComments = vi.fn(async () => ({ data: [{ id: 'c1', text: 'Love it', username: 'ana', createdTime: '2026-09-02T00:00:00Z' }] }))
const followerStats = vi.fn(async () => ({
  accounts: [{ _id: 'acc-ig', currentFollowers: 127 }],
  stats: { 'acc-ig': SERIES },
}))

vi.mock('../app/lib/publisher', () => ({
  getPublisher: () => ({
    name: 'fake', configured: () => true, postAnalytics, postTimeline, postComments, followerStats,
  }),
}))
// the permalink back-fill's side trip; not under test here
vi.mock('../app/lib/production-publish', () => ({ recordPublishOnItem: vi.fn(async () => undefined) }))
vi.mock('../app/lib/external-post-match', () => ({ sweepExternalPosts: vi.fn(async () => ({ scanned: 0, matched: 0, refreshed: 0 })) }))

const { refreshOnePost, refreshRecentPostAnalytics, forgetFollowerStats } = await import('../app/lib/post-analytics')
const { readPerformance } = await import('../app/lib/post-performance-core')

type Json = Record<string, unknown>
let fake: ReturnType<typeof seedDb>
const job = (id: string, publishedAt: string, postId: string): Json => ({
  id, client_id: 'client-1', content_item_id: `item-${id}`, status: 'published',
  provider_post_id: postId, permalink: null, published_at: publishedAt, created_at: publishedAt,
  targets: [{ platform: 'instagram', accountId: 'acc-ig' }],
})

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  forgetFollowerStats()
  postAnalytics.mockClear(); postTimeline.mockClear(); postComments.mockClear(); followerStats.mockClear()
  fake = seedDb({
    publish_jobs: [
      job('j1', '2026-09-01T02:00:00.000Z', 'zp-1'),
      job('j2', '2026-09-04T02:00:00.000Z', 'zp-2'),
    ] as unknown as Row[],
    schedule_entries: [
      { id: 'e1', item_id: 'item-j1', platform: 'instagram', live_url: 'x' },
      { id: 'e2', item_id: 'item-j2', platform: 'instagram', live_url: 'x' },
    ] as unknown as Row[],
    post_analytics: [],
  })
})
afterEach(() => { fake?.restore(); vi.useRealTimers() })

const rows = () => fake.rows('post_analytics') as unknown as Json[]
// the database drops nulls, exactly as the real one does; the reader restores them
const perfOf = (row: Json | undefined) => readPerformance(row?.performance)!

describe('refreshOnePost', () => {
  it('writes the summary beside the numbers, in one row', async () => {
    const r = await refreshOnePost(job('j1', '2026-09-01T02:00:00.000Z', 'zp-1') as never)
    expect(r.updated).toBe(true)
    const row = rows().find(x => x.provider_post_id === 'zp-1')!
    expect(row.likes).toBe(30)
    const perf = perfOf(row)
    expect(perf.interactions.total).toBe(42)
    expect(perf.followers_since?.delta).toBe(17)
    // j2 went out on the 4th on the same account: the window closes there
    expect(perf.followers_until_next).toMatchObject({ delta: 11, toDate: '2026-09-04' })
    expect(perf.comments[0].author).toBe('ana')
    expect(perf.timeline.series.map(s => s.value)).toEqual([20, 42])
    expect(perf.provider_post_id).toBe('zp-1')
  })

  it('the last post has an open window', async () => {
    await refreshOnePost(job('j2', '2026-09-04T02:00:00.000Z', 'zp-2') as never)
    const perf = perfOf(rows().find(x => x.provider_post_id === 'zp-2'))
    expect(perf.followers_since).toMatchObject({ delta: 6, until: 'now' })
    expect(perf.followers_until_next).toBeNull()
  })

  it('a refused timeline or comments still leaves the numbers on the row', async () => {
    postTimeline.mockResolvedValueOnce(null as never)
    postComments.mockRejectedValueOnce(new Error('403'))
    followerStats.mockResolvedValueOnce({ error: 'Analytics add-on required' } as never)
    const r = await refreshOnePost(job('j1', '2026-09-01T02:00:00.000Z', 'zp-1') as never)
    expect(r.updated).toBe(true)
    const perf = perfOf(rows()[0])
    expect(perf.interactions.total).toBe(42)
    expect(perf.followers_since).toBeNull()
    expect(perf.comments).toEqual([])
    expect(perf.timeline.days).toBe(0)
  })
})

describe('refreshRecentPostAnalytics', () => {
  it('asks for the follower series once for the whole sweep', async () => {
    const out = await refreshRecentPostAnalytics(90)
    expect(out.updated).toBe(2)
    expect(followerStats).toHaveBeenCalledTimes(1)
    expect(postTimeline).toHaveBeenCalledTimes(2)
    expect(postComments).toHaveBeenCalledTimes(2)
    const byPost = new Map(rows().map(r => [r.provider_post_id, perfOf(r)]))
    expect(byPost.get('zp-1')?.followers_until_next?.delta).toBe(11)
    expect(byPost.get('zp-2')?.followers_until_next).toBeNull()
  })
})

/**
 * The real follower series, on the connected account. Off by default: it
 * spends a provider call and needs ZERNIO_API_KEY in the shell.
 *
 *   LIVE=1 ZERNIO_API_KEY=… npx vitest run tests/post-performance-refresh.test.ts
 */
describe.runIf(process.env.LIVE === '1' && !!process.env.ZERNIO_API_KEY)('follower stats (live provider)', () => {
  it('shapes the live body into a per-account daily series', async () => {
    const { shapeFollowerStats } = await import('../app/lib/post-performance-core')
    const res = await fetch(`${process.env.ZERNIO_API_URL ?? 'https://zernio.com/api/v1'}/accounts/follower-stats`, {
      headers: { Authorization: `Bearer ${process.env.ZERNIO_API_KEY}` },
    })
    expect(res.ok).toBe(true)
    const stats = shapeFollowerStats(await res.json())
    expect(stats.series.size).toBeGreaterThan(0)
    for (const [id, series] of stats.series) {
      console.log(`LIVE ${id}: ${series.length} days, latest ${series[series.length - 1]?.followers}`)
      expect(series.every(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date))).toBe(true)
    }
  })
})
