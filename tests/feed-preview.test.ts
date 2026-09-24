import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { feedTiles, feedWords, liveTiles, type LiveTile, type PlannedTile } from '../app/lib/feed-preview-core'

/**
 * THE FEED AS IT WILL LOOK (the owner, 24 Sep 2026, pointing at Later's
 * visual Instagram planner: "cant u see the link i shared").
 */
describe('the account’s own grid under what is planned', () => {
  // the shape the provider returned for Alia Fragrance on 24 Sep 2026
  const raw = {
    status: 'success',
    posts: [
      { id: '1791', message: 'finish the sentence.', createdTime: '2026-09-24T05:00:15.000Z', picture: 'https://cdn/a.jpg', permalink: 'https://www.instagram.com/p/DdqFXLnkU3D/', mediaType: 'image', likeCount: 5, commentCount: 0 },
      { id: '1810', message: 'quietly made.', createdTime: '2026-09-23T06:33:03.000Z', picture: 'https://cdn/b.jpg', permalink: 'https://www.instagram.com/reel/Ddnq3ecijpQ/', mediaType: 'video', likeCount: 18, commentCount: 0 },
      { id: 'nopic', message: 'no picture', createdTime: '2026-09-22T06:33:03.000Z', mediaType: 'image' },
    ],
  }

  it('reads the account’s posts, newest first, and skips one with nothing to draw', () => {
    const tiles = liveTiles(raw)
    expect(tiles.map(t => t.id)).toEqual(['1791', '1810'])
    expect(tiles[0]).toMatchObject({ kind: 'live', permalink: 'https://www.instagram.com/p/DdqFXLnkU3D/', mediaType: 'image', likes: 5, caption: 'finish the sentence.' })
    expect(tiles[1].mediaType).toBe('video')
    expect(liveTiles({})).toEqual([])
    expect(liveTiles(null)).toEqual([])
    expect(liveTiles(raw, 1).map(t => t.id)).toEqual(['1791'])
  })

  it('puts a draft with no time first, then the dated ones, then the live grid', () => {
    const planned: PlannedTile[] = [
      { kind: 'planned', id: 'dated', at: '2026-09-26T02:00:00.000Z', status: 'scheduled', title: 'A', thumbnail: 'https://ours/1.jpg' },
      { kind: 'planned', id: 'draft', at: null, status: 'draft', title: 'B', thumbnail: 'https://ours/2.jpg' },
    ]
    const live = liveTiles(raw)
    expect(feedTiles(planned, live).map(t => t.id)).toEqual(['draft', 'dated', '1791', '1810'])
  })

  it('never draws the same picture twice when a planned post is already up', () => {
    const shared = 'https://cdn/a.jpg'
    const planned: PlannedTile[] = [{ kind: 'planned', id: 'p', at: '2026-09-24T05:00:15.000Z', status: 'published', title: null, thumbnail: shared }]
    const out = feedTiles(planned, liveTiles(raw))
    expect(out.map(t => t.id)).toEqual(['p', '1810'])
  })

  it('says in words what the grid is showing, including when the feed could not be read', () => {
    expect(feedWords(3, 12, 'alia_fragrance')).toBe('3 planned posts above @alia_fragrance’s feed as it is now.')
    expect(feedWords(1, 12, 'alia_fragrance')).toContain('1 planned post above')
    expect(feedWords(2, 0, 'alia_fragrance')).toContain('could not be read')
    expect(feedWords(0, 0, null)).toBe('Nothing planned yet, so there is nothing to preview.')
  })

  it('the route reads the account’s feed read-only and never fails the page over it', () => {
    const route = readFileSync('app/api/social/schedule/feed/route.ts', 'utf8')
    expect(route).toContain("const user = await requireRole('scheduler')")
    expect(route).toContain('await assertClientAccess(user, account.client_id)')
    expect(route).toContain('await getPublisher().accountPosts(providerId).catch(e => {')
    expect(route).not.toMatch(/\.(insert|update|claim|remove|delete)\(/)
    const views = readFileSync('app/dashboard/social/schedule/views.tsx', 'utf8')
    expect(views).toContain('/api/social/schedule/feed?account=')
    expect(views).toContain('target="_blank"')
    const publisher = readFileSync('app/lib/publisher.ts', 'utf8')
    expect(publisher).toContain('accountPosts(providerAccountId: string): Promise<unknown>')
    expect(publisher).toContain('return this.getJson(`/accounts/${encodeURIComponent(providerAccountId)}/posts`)')
  })
})
