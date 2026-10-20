import { describe, expect, it } from 'vitest'
import {
  piecesFromZernioScheduled, scheduledUntilByClient,
  byClient, compact, engagement, inMonth, kindOf, monthKey, monthRange, piecesFromApp, piecesFromZernio, platformsIn,
  sanitiseTrackerPatch, shiftMonth, totals, trackerLine, trackerPosts,
} from '../app/lib/content-tracker-core'

// shaped like Zernio's /analytics list (read live, 20 Oct 2026: Jordan Wilson's Instagram reel)
const reel = {
  _id: 'a1', latePostId: 'z1', content: 'Building your dream home…', publishedAt: '2026-10-20T08:18:53.000Z', status: 'published',
  analytics: { views: 30, reach: 16, likes: 6, comments: 0, shares: 0, saves: 0, engagementRate: 20 },
  platforms: [{ platform: 'instagram', status: 'published', accountId: 'ig-jw', accountUsername: 'jordanwilson._', platformPostUrl: 'https://www.instagram.com/reel/DetYsRAjMZM/', analytics: { views: 30, reach: 16, likes: 6, comments: 0, shares: 0, saves: 0, engagementRate: 20 } }],
  platform: 'instagram', mediaType: 'video', mediaProductType: 'REELS', thumbnailUrl: 'https://cdn/t.jpg', mediaItems: [{ type: 'video' }],
}
const native = {
  _id: 'a2', content: 'Posted on the phone', publishedAt: '2026-10-01T01:00:00.000Z', status: 'published',
  platforms: [{ platform: 'tiktok', status: 'published', accountId: 'tt-x', analytics: { views: 1200, likes: 40, comments: 3, shares: 2, saves: 5 } }],
  mediaType: 'video', mediaItems: [{ type: 'video' }],
}
const clientOf = (id: string | null) => (id === 'ig-jw' ? 'jordan' : null)

describe('a Zernio list becomes the tracker\'s posts', () => {
  const posts = trackerPosts({ posts: [reel, native, { _id: 'x', status: 'failed', publishedAt: '2026-10-02T00:00:00Z' }] }, clientOf)
  it('one row per network that went out, newest first, with its client', () => {
    expect(posts.map(p => [p.platform, p.clientId])).toEqual([['instagram', 'jordan'], ['tiktok', null]])
  })
  it('knows a post made through the app from one made on the network', () => {
    expect(posts[0].via).toBe('app')
    expect(posts[1].via).toBe('native')
  })
  it('carries the link, the picture, the kind and the numbers', () => {
    expect(posts[0]).toMatchObject({ url: 'https://www.instagram.com/reel/DetYsRAjMZM/', thumbnail: 'https://cdn/t.jpg', kind: 'Reel', views: 30, likes: 6, account: 'jordanwilson._' })
  })
  it('ignores what did not go out', () => {
    expect(posts.some(p => p.id.startsWith('x'))).toBe(false)
  })
})

describe('the month', () => {
  it('is read in Melbourne: 31 Oct 23:30 UTC is already November there', () => {
    expect(monthKey('2026-10-31T23:30:00Z')).toBe('2026-11')
    expect(monthKey('2026-10-31T10:00:00Z')).toBe('2026-10')
  })
  it('asks Zernio a day either side, then keeps only the month', () => {
    expect(monthRange('2026-10')).toEqual({ from: '2026-09-30', to: '2026-11-01' })
    expect(monthRange('2026-13')).toBeNull()
    const posts = trackerPosts({ posts: [reel, { ...native, publishedAt: '2026-09-30T10:00:00Z' }] }, clientOf)
    expect(inMonth(posts, '2026-10').map(p => p.platform)).toEqual(['instagram'])
  })
  it('steps back and forward across a year', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })
})

describe('per client', () => {
  const posts = trackerPosts({ posts: [reel, native] }, clientOf)
  it('totals each client, busiest first, unlinked accounts last', () => {
    const rows = byClient(posts)
    expect(rows.map(r => r.clientId)).toEqual(['jordan', null])
    expect(rows[0]).toMatchObject({ posts: 1, byPlatform: { instagram: 1 }, views: 30, likes: 6 })
  })
  it('engagement is interactions over views', () => {
    expect(engagement({ views: 1200, reach: 0, likes: 40, comments: 3, shares: 2, saves: 5 })).toBe(4.2)
    expect(engagement({ views: 0, reach: 0, likes: 1, comments: 0, shares: 0, saves: 0 })).toBeNull()
    expect(totals(posts).posts).toBe(2)
  })
})

describe('words', () => {
  it('names the kind of post', () => {
    expect(kindOf('tiktok', 'image', null, 4)).toBe('Photo post')
    expect(kindOf('instagram', 'image', null, 3)).toBe('Carousel')
    expect(kindOf('linkedin', 'video', null, 1)).toBe('Video')
    expect(kindOf('linkedin', 'text', null, 0)).toBe('Text')
  })
  it('orders the networks and shortens big numbers', () => {
    expect(platformsIn([{ platform: 'linkedin' }, { platform: 'instagram' }, { platform: 'tiktok' }])).toEqual(['instagram', 'tiktok', 'linkedin'])
    expect(compact(12_400)).toBe('12k')
    expect(compact(1_250)).toBe('1.3k')
    expect(compact(950)).toBe('950')
  })
})

describe('the deliverables sheet', () => {
  const at = '2026-10-10T08:00:00.000Z'
  const app = piecesFromApp([
    { id: 'p1', client_id: 'c', stage: 'posted', scheduled_for: at, slides: [{ type: 'image' }], channels: ['ig'], per_channel: {} },
    { id: 'p2', client_id: 'c', stage: 'booked', scheduled_for: '2026-10-28T08:00:00Z', slides: [{ type: 'video' }], channels: ['ig', 'li'], per_channel: {} },
    { id: 'p3', client_id: 'c', stage: 'booked', scheduled_for: '2026-11-02T08:00:00Z', slides: [{ type: 'video' }], channels: ['ig'], per_channel: {} },
    { id: 'p4', client_id: 'c', stage: 'booked', scheduled_for: at, slides: [{ type: 'image' }], channels: ['ig'], per_channel: { ig: { kind: 'story' } } },
    { id: 'p5', client_id: 'c', stage: 'ready', scheduled_for: at, slides: [{ type: 'image' }], channels: ['ig'], per_channel: {} },
  ], id => (id === 'li' ? 'linkedin' : 'instagram'))
  it('counts each booked or posted post once, a story on its own, nothing not yet booked', () => {
    expect(app.map(p => [p.key, p.kind])).toEqual([['a:p1', 'graphic'], ['a:p2', 'reel'], ['a:p3', 'reel'], ['a:p4:story', 'story']])
  })
  it('counts only what went out through Zernio, a post on several networks once — never the client’s own posts', () => {
    const z = piecesFromZernio({ posts: [
      { ...native, _id: 'n1' },
      { ...reel, _id: 'r-ig' },                                                    // the app's own: skipped
      { _id: 'd1', latePostId: 'zz', publishedAt: at, status: 'published', mediaType: 'image', platforms: [{ platform: 'instagram', accountId: 'ig-jw' }] },
      { _id: 'd2', latePostId: 'zz', publishedAt: at, status: 'published', mediaType: 'image', platforms: [{ platform: 'linkedin', accountId: 'li-jw' }] },
    ] }, clientOf, new Set(['z1']))
    // n1 has no Zernio post id: the client posted it themselves (Pattons, 20 Oct 2026)
    expect(z.map(p => [p.key, p.kind, p.linkedin])).toEqual([['z:zz', 'graphic', true]])
    expect(piecesFromZernio({ posts: [reel] }, clientOf).map(p => [p.key, p.clientId])).toEqual([['z:z1', 'jordan']])
  })
  it('a client\'s month: required against scheduled, what is needed, until when', () => {
    const line = trackerLine('c', app, '2026-10', { required_graphics: 3, required_reels: 1, notes: 'links on stories' }, null, 'Karly')
    expect(line.graphics).toEqual({ required: 3, scheduled: 1 })
    expect(line.reels).toEqual({ required: 1, scheduled: 1 })
    expect(line.stories).toBe(1)
    expect(line.linkedin).toBe(1)
    expect(line.status).toBe('In progress')
    expect(line.needed).toBe('2 graphics')
    expect(line.scheduledUntil).toBe('2026-11-02T08:00:00Z')
    expect(line.responsible).toBe('Karly')
    expect(line.notes).toBe('links on stories')
  })
  it('carries last month\'s targets, and is complete once they are met', () => {
    const line = trackerLine('c', app, '2026-10', null, { required_graphics: 1, required_reels: 1 })
    expect(line.carried).toBe(true)
    expect(line.status).toBe('Complete')
    expect(line.needed).toBeNull()
    expect(trackerLine('c', [], '2026-10', null, null).status).toBe('No target set')
    expect(trackerLine('c', [], '2026-10', { required_reels: 4 }, null)).toMatchObject({ status: 'Not started', needed: '4 reels' })
  })
  it('keeps only sensible edits', () => {
    expect(sanitiseTrackerPatch({ required_graphics: '6', required_reels: -2, notes: '  hi ', in_asana: true, other: 1 }))
      .toEqual({ required_graphics: 6, notes: 'hi', in_asana: true })
    expect(sanitiseTrackerPatch({ required_reels: '' })).toEqual({ required_reels: null })
  })
})

describe('scheduled until', () => {
  it('is each client’s last post waiting in Zernio, whichever way the account is named', () => {
    const m = scheduledUntilByClient({ posts: [
      { status: 'scheduled', scheduledFor: '2026-10-28T07:00:00Z', platforms: [{ accountId: 'ig-jw' }] },
      { status: 'scheduled', scheduledFor: '2026-11-03T07:00:00Z', platforms: [{ accountId: { _id: 'ig-jw' } }] },
      { status: 'scheduled', scheduledFor: '2026-12-01T07:00:00Z', platforms: [{ accountId: 'someone-else' }] },
    ] }, clientOf)
    expect(m.get('jordan')).toBe('2026-11-03T07:00:00Z')
    expect(m.size).toBe(1)
  })
})

describe('what is still waiting in Zernio counts as scheduled for its month', () => {
  it('one piece per post, a reel by its video, a story beside it', () => {
    const p = piecesFromZernioScheduled({ posts: [
      { _id: 's1', status: 'scheduled', scheduledFor: '2026-10-28T07:00:00Z', mediaItems: [{ type: 'video' }], platforms: [{ platform: 'instagram', accountId: { _id: 'ig-jw' } }, { platform: 'linkedin', accountId: 'li' }] },
      { _id: 's2', status: 'scheduled', scheduledFor: '2026-10-29T07:00:00Z', mediaItems: [{ type: 'image' }], platforms: [{ platform: 'instagram', accountId: 'ig-jw', platformSpecificData: { contentType: 'story' } }] },
    ] }, clientOf)
    expect(p.map(x => [x.key, x.kind, x.clientId, x.linkedin])).toEqual([['zs:s1', 'reel', 'jordan', true], ['zs:s2:story', 'story', 'jordan', false]])
  })
})
