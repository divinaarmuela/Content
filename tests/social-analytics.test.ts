import { describe, expect, it } from 'vitest'
import {
  engagement, groupPosts, mondayOf, readTimeline, sortPosts, sumMetrics, summariseByAccount, trimPost,
} from '../app/lib/social-analytics-core'

const TZ = 'Australia/Melbourne'
// the shape Zernio's /analytics list returned on 2 Nov 2026 (trimmed)
const row = (id: string, publishedAt: string, a: Record<string, number>, accountId = 'acc1') => ({
  _id: id, content: `post ${id}`, publishedAt, platform: 'facebook', isExternal: true, mediaType: 'carousel',
  thumbnailUrl: `https://img/${id}.jpg`, platformPostUrl: `https://fb/${id}`,
  analytics: { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0, engagementRate: 1.86, ...a },
  platforms: [{ platform: 'facebook', accountId, analytics: {} }],
})

describe('analytics by client → channel → post (2 Nov 2026)', () => {
  it('reads a list row and a one-post answer the same way', () => {
    const p = trimPost(row('a', '2026-11-01T08:59:28.000Z', { impressions: 161, reach: 94, likes: 3, clicks: 22 }))!
    expect(p).toMatchObject({ id: 'a', platform: 'facebook', accountId: 'acc1', url: 'https://fb/a', external: true, engagementRate: 1.86 })
    expect(p.metrics).toMatchObject({ impressions: 161, reach: 94, likes: 3, clicks: 22, views: 0 })
    const one = trimPost({ postId: 'a', publishedAt: '2026-11-01T08:59:28.000Z', analytics: { impressions: 161 },
      platformAnalytics: [{ platform: 'facebook', accountId: 'acc1' }] })!
    expect(one).toMatchObject({ id: 'a', accountId: 'acc1', platform: 'facebook' })
    expect(trimPost({ content: 'no id' })).toBeNull()
  })

  it('groups by Melbourne week (Monday to Sunday), newest week first, each with its totals', () => {
    const posts = [
      row('sun', '2026-11-01T08:59:28.000Z', { reach: 10, likes: 1 }), // Sun 1 Nov in Melbourne
      row('mon', '2026-11-01T14:30:00.000Z', { reach: 5 }),           // Mon 2 Nov 01:30 in Melbourne
      row('wed', '2026-10-28T02:00:00.000Z', { reach: 1, comments: 2 }),
    ].map(r => trimPost(r)!)
    expect(mondayOf('2026-11-01')).toBe('2026-10-26')
    const weeks = groupPosts(posts, 'week', TZ)
    expect(weeks.map(w => w.key)).toEqual(['2026-11-02', '2026-10-26'])
    expect(weeks[1].posts.map(p => p.id)).toEqual(['sun', 'wed'])
    expect(weeks[1].totals.reach).toBe(11)
    expect(weeks[1].label).toBe('Week of 26 Oct – 1 Nov 2026')
    expect(groupPosts(posts, 'month', TZ).map(g => g.label)).toEqual(['November 2026', 'October 2026'])
    expect(groupPosts(posts, 'none', TZ)[0].posts).toHaveLength(3)
  })

  it('sorts, sums and splits by channel', () => {
    const posts = [
      row('a', '2026-10-01T00:00:00Z', { views: 50, likes: 1 }, 'x'),
      row('b', '2026-10-02T00:00:00Z', { impressions: 80, likes: 9, saves: 1 }, 'y'),
      row('c', '2026-10-03T00:00:00Z', { views: 10 }, 'x'),
    ].map(r => trimPost(r)!)
    expect(sortPosts(posts, 'newest').map(p => p.id)).toEqual(['c', 'b', 'a'])
    expect(sortPosts(posts, 'views').map(p => p.id)).toEqual(['b', 'a', 'c'])
    expect(sortPosts(posts, 'engagement')[0].id).toBe('b')
    expect(engagement(sumMetrics(posts))).toBe(11)
    const by = summariseByAccount(posts)
    expect(by.get('x')).toMatchObject({ posts: 2, totals: { views: 60 } })
    expect(by.get('y')?.posts).toBe(1)
  })

  it('reads a post’s day-by-day readings, one row per day per platform', () => {
    const t = readTimeline({ timeline: [
      { date: '2026-11-02', platform: 'facebook', impressions: 161 },
      { date: '2026-11-01', platform: 'facebook', impressions: 108 },
      { date: '2026-11-01', platform: 'instagram', impressions: 2 },
    ] })
    expect(t.map(d => [d.date, d.metrics.impressions])).toEqual([['2026-11-01', 110], ['2026-11-02', 161]])
    expect(readTimeline(null)).toEqual([])
  })
})
