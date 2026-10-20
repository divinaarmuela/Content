import { describe, expect, it } from 'vitest'
import { boardOrder, clientBoard, coverWords, itemsInMonth, publishedItems, scheduledItems } from '../app/lib/content-board-core'

// shaped like Zernio, read live 20 Oct 2026: Jordan Wilson's video came back as one analytics entry per network,
// each carrying the same latePostId
const clientOf = (id: string | null) => (id === 'ig-jw' || id === 'tt-jw' || id === 'li-jw' ? 'jordan' : id === 'ig-p' ? 'pattons' : null)
const analytics = { posts: [
  { _id: 'a1', latePostId: 'z1', publishedAt: '2026-10-20T08:18:53Z', status: 'published', mediaType: 'video', mediaProductType: 'REELS', content: 'Dream home', thumbnailUrl: 'https://t/1.jpg',
    platforms: [{ platform: 'instagram', status: 'published', accountId: 'ig-jw', platformPostUrl: 'https://instagram.com/reel/x', analytics: { views: 30, likes: 6, comments: 1, shares: 0, saves: 2 } }] },
  { _id: 'a2', latePostId: 'z1', publishedAt: '2026-10-20T08:17:57Z', status: 'published', mediaType: 'video',
    platforms: [{ platform: 'tiktok', status: 'published', accountId: 'tt-jw', platformPostUrl: 'https://tiktok.com/x', analytics: { views: 100, likes: 4, comments: 0, shares: 1, saves: 0 } }] },
  // posted by Pattons on Instagram themselves: no latePostId, not ours
  { _id: 'a3', publishedAt: '2026-10-19T04:47:01Z', status: 'published', mediaType: 'image',
    platforms: [{ platform: 'instagram', status: 'published', accountId: 'ig-p', analytics: { views: 500 } }] },
  { _id: 'a4', latePostId: 'z2', publishedAt: '2026-10-05T01:00:00Z', status: 'published', mediaType: 'image', mediaItems: [{}, {}],
    platforms: [{ platform: 'linkedin', status: 'published', accountId: 'li-jw', analytics: { impressions: 50, likes: 2 } }] },
] }
const scheduled = { posts: [
  { _id: 's1', status: 'scheduled', scheduledFor: '2026-10-28T07:00:00Z', mediaItems: [{ type: 'video', url: 'https://v.mp4' }], content: 'Next one',
    platforms: [{ platform: 'instagram', accountId: { _id: 'ig-jw' } }, { platform: 'linkedin', accountId: 'li-jw' }] },
  { _id: 's2', status: 'scheduled', scheduledFor: '2026-10-29T07:00:00Z', mediaItems: [{ type: 'image', url: 'https://i.jpg' }],
    platforms: [{ platform: 'instagram', accountId: 'ig-jw', platformSpecificData: { contentType: 'story' } }] },
  { _id: 's3', status: 'scheduled', scheduledFor: '2026-11-04T07:00:00Z', mediaItems: [{ type: 'image', url: 'https://i2.jpg' }],
    platforms: [{ platform: 'instagram', accountId: 'ig-jw' }] },
] }

describe('published, from Zernio', () => {
  const items = publishedItems(analytics, clientOf)
  it('one item per post however many networks, numbers summed, links kept per network', () => {
    const reel = items.find(i => i.key === 'p:z1')!
    expect(reel).toMatchObject({ kind: 'reel', clientId: 'jordan', state: 'published', views: 130, likes: 10, at: '2026-10-20T08:17:57Z' })
    expect(reel.networks).toEqual([{ platform: 'instagram', url: 'https://instagram.com/reel/x' }, { platform: 'tiktok', url: 'https://tiktok.com/x' }])
  })
  it('leaves out what a client posted themselves', () => {
    expect(items.some(i => i.clientId === 'pattons')).toBe(false)
  })
  it('a carousel is a graphic; impressions stand in for views', () => {
    expect(items.find(i => i.key === 'p:z2')).toMatchObject({ kind: 'graphic', views: 50 })
  })
})

describe('scheduled, from Zernio', () => {
  const items = scheduledItems(scheduled, clientOf)
  it('reads each network’s own file when the post has no shared media (how the app books)', () => {
    const [i] = scheduledItems({ posts: [{ _id: 'j1', status: 'scheduled', scheduledFor: '2026-10-22T07:00:00Z',
      platforms: [{ platform: 'instagram', accountId: 'ig-jw', customMedia: [{ type: 'video', url: 'https://c.mp4', thumbnail: 'https://c.jpg' }] }] }] }, clientOf)
    expect(i).toMatchObject({ kind: 'reel', thumbnail: 'https://c.jpg' })
  })
  it('a video is a reel, a story only when every network posts it as one', () => {
    expect(items.map(i => [i.key, i.kind, i.clientId])).toEqual([['s:s1', 'reel', 'jordan'], ['s:s2', 'story', 'jordan'], ['s:s3', 'graphic', 'jordan']])
    expect(items[0].networks.map(n => n.platform)).toEqual(['instagram', 'linkedin'])
  })
})

describe('a client’s month', () => {
  const waiting = scheduledItems(scheduled, clientOf)
  const month = itemsInMonth([...publishedItems(analytics, clientOf), ...waiting], '2026-10')
  const b = clientBoard('jordan', month, waiting, Date.parse('2026-10-20T10:00:00Z'))
  it('counts each kind out and to go', () => {
    expect(b.counts.reel).toEqual({ published: 1, scheduled: 1 })
    expect(b.counts.story).toEqual({ published: 0, scheduled: 1 })
    expect(b.counts.graphic).toEqual({ published: 1, scheduled: 0 })
    expect([b.published, b.scheduled]).toEqual([2, 2])
  })
  it('scheduled until reaches past the month; numbers are only what went out', () => {
    expect(b.scheduledUntil).toBe('2026-11-04T07:00:00Z')
    expect(b.next).toBe('2026-10-28T07:00:00Z')
    expect(b.metrics.views).toBe(180)
    expect(b.top?.key).toBe('p:z1')
    expect(b.networks).toEqual({ instagram: 3, tiktok: 1, linkedin: 2 })
  })
  it('the busiest client first', () => {
    const quiet = clientBoard('nobody', month, waiting)
    expect([quiet, b].sort(boardOrder)[0].clientId).toBe('jordan')
  })
})

describe('how far ahead', () => {
  const now = Date.parse('2026-10-20T00:00:00Z')
  it('green past a week, amber inside one, red when nothing waits', () => {
    expect(coverWords('2026-11-04T07:00:00Z', now).tone).toBe('good')
    expect(coverWords('2026-10-24T07:00:00Z', now).tone).toBe('soon')
    expect(coverWords(null, now)).toEqual({ text: 'Nothing scheduled ahead', tone: 'none' })
    expect(coverWords('2026-10-01T00:00:00Z', now).tone).toBe('none')
  })
})
