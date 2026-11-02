import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { feedPreviewNote, networkFeedPreview } from '../app/lib/portal-core'
import type { PostState } from '../app/lib/post-stage-core'

/**
 * The post window's Feed preview tab (the owner, 2 Nov 2026: "make sure it shows how it sits on instagram facebook
 * tiktok or linkedin feed preview tab … include scheduled ones too current updated"): for one account, the other
 * booked posts on THAT account with this post in its place, latest first, above what is live there now.
 */
const post = (id: string, stage: string, at: string | null, channels: string[], extra: Partial<PostState> = {}) =>
  ({ id, stage, scheduled_for: at, channels, slides: [{ url: `https://x/${id}.jpg`, type: 'image' }], caption: `words ${id}`, per_channel: {}, outcomes: {}, ...extra }) as unknown as PostState
const live = [
  { id: 'L2', at: '2026-10-20T00:00:00.000Z', thumbnail: null, permalink: 'https://li/2', caption: 'text only' },
  { id: 'L1', at: '2026-10-30T00:00:00.000Z', thumbnail: 'https://cdn/l1.jpg', permalink: 'https://li/1', caption: 'with picture' },
]

describe('the Feed preview is one account’s feed', () => {
  it('booked posts on that account, this one in its place, latest first, then live newest first', () => {
    const others = [
      post('b1', 'booked', '2026-11-03T06:30:00.000Z', ['li']),
      post('b2', 'booked', '2026-11-17T02:00:00.000Z', ['li', 'ig']),
      post('igOnly', 'booked', '2026-11-20T00:00:00.000Z', ['ig']),
      post('draft', 'draft', '2026-11-21T00:00:00.000Z', ['li']),
      post('posted', 'posted', '2026-10-01T00:00:00.000Z', ['li']),
    ]
    const me = { id: 'me', channels: ['ig', 'li'], slides: [{ url: 'https://x/me.jpg' }], caption: 'mine',
      per_channel: { li: { caption: 'mine on LinkedIn' } }, scheduled_for: '2026-11-10T00:00:00.000Z' }
    const tiles = networkFeedPreview(me, others, 'li', live)
    expect(tiles.map(t => `${t.kind}:${t.id}`)).toEqual(['booked:b2', 'this:me', 'booked:b1', 'live:L1', 'live:L2'])
    expect(tiles[1].caption).toBe('mine on LinkedIn')
    // a text-only live post is still a card, with no picture
    expect(tiles[4]).toMatchObject({ cover: null, caption: 'text only', permalink: 'https://li/2' })
  })

  it('a post with no time leads; an account the post is not going to draws only that account’s booked and live', () => {
    const me = { id: 'me', channels: ['tt'], slides: [{ url: 'https://x/me.mp4', type: 'video' }], per_channel: {} }
    expect(networkFeedPreview(me, [post('b1', 'booked', '2026-11-03T06:30:00.000Z', ['tt'])], 'tt', [])
      .map(t => `${t.kind}:${t.id}:${t.cover?.type}`)).toEqual(['this:me:video', 'booked:b1:image'])
    expect(networkFeedPreview(me, [], 'ig', []).length).toBe(0)
  })

  it('says why live posts are missing instead of an empty box', () => {
    expect(feedPreviewNote('linkedin', 0, 'read')).toMatch(/LinkedIn’s recent posts can’t be read — showing only the booked ones/)
    expect(feedPreviewNote('tiktok', 0, 'unreadable')).toMatch(/could not be read just now/)
    expect(feedPreviewNote('instagram', 3, 'read')).toBeNull()
  })

  it('the post window has the tab, before Notes, and the feed route reads all four networks', () => {
    const win = readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8')
    expect(win.indexOf("key: 'feed', label: 'Feed preview'")).toBeGreaterThan(0)
    expect(win.indexOf("key: 'feed'")).toBeLessThan(win.indexOf("key: 'notes'"))
    const route = readFileSync('app/api/social/schedule/feed/route.ts', 'utf8')
    expect(route).toContain("'instagram', 'facebook', 'tiktok', 'linkedin'")
    expect(route).not.toContain('not_instagram')
  })
})
