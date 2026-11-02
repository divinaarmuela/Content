import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { instagramProfileGrid } from '../app/lib/portal-core'
import type { PostState } from '../app/lib/post-stage-core'

/**
 * "How it sits on the client's Instagram" in the post window (the owner, 2 Nov 2026: "it doesnt fetch the
 * scheduled one there and also the current instagram posts, like client portal"). It drew this post before the
 * app's own POSTED rows only; now it is the portal's "Your feed": booked Instagram posts, latest top left, with
 * this post in its place, above the account's real feed.
 */
const platform: Record<string, string> = { ig: 'instagram', tt: 'tiktok' }
const platformOf = (id: string) => platform[id] ?? null
const post = (id: string, stage: string, at: string | null, channels = ['ig'], url = `https://x/${id}.jpg`) =>
  ({ id, stage, scheduled_for: at, channels, slides: [{ url, type: 'image' }], per_channel: {}, outcomes: {} }) as unknown as PostState
const live = [
  { id: 'L1', at: '2026-10-30T00:00:00.000Z', thumbnail: 'https://cdn/l1.jpg', permalink: 'https://www.instagram.com/p/1/' },
  { id: 'L2', at: '2026-10-20T00:00:00.000Z', thumbnail: 'https://cdn/l2.jpg', permalink: 'https://www.instagram.com/p/2/' },
  { id: 'nopic', at: '2026-10-10T00:00:00.000Z', thumbnail: null, permalink: null },
]

describe('the post window grid is the portal’s feed', () => {
  it('draws every booked Instagram post with this one, latest first, above the live feed', () => {
    const others = [
      post('b1', 'booked', '2026-11-03T06:30:00.000Z'),
      post('b2', 'booked', '2026-11-17T02:00:00.000Z'),
      post('tiktokOnly', 'booked', '2026-11-20T00:00:00.000Z', ['tt']),
      post('draft', 'draft', '2026-11-21T00:00:00.000Z'),
      post('posted', 'posted', '2026-10-01T00:00:00.000Z'),
    ]
    const grid = instagramProfileGrid(
      { id: 'me', channels: ['ig', 'tt'], slides: [{ url: 'https://x/me.jpg' }], per_channel: {}, scheduled_for: '2026-11-10T00:00:00.000Z' },
      others, platformOf, live)!
    expect(grid.map(t => `${t.kind}:${t.id}`)).toEqual(['booked:b2', 'this:me', 'booked:b1', 'live:L1', 'live:L2'])
    expect(grid[3]).toMatchObject({ url: 'https://cdn/l1.jpg', permalink: 'https://www.instagram.com/p/1/', type: 'image' })
  })

  it('a post with no time leads, where the next post goes; no Instagram channel draws nothing', () => {
    const grid = instagramProfileGrid({ id: 'me', channels: ['ig'], slides: [{ url: 'https://x/me.jpg' }], per_channel: {} },
      [post('b1', 'booked', '2026-11-03T06:30:00.000Z')], platformOf, [])!
    expect(grid.map(t => t.id)).toEqual(['me', 'b1'])
    expect(instagramProfileGrid({ id: 'me', channels: ['tt'], slides: [{ url: 'u' }], per_channel: {} }, [], platformOf, live)).toBeNull()
  })

  it('the post window reads the live feed from the same route as the Preview, and draws the full grid', () => {
    const win = readFileSync('app/dashboard/social/schedule/PostWindow.tsx', 'utf8')
    expect(win).toContain('instagramProfileGrid(')
    expect(win).toContain('/api/social/schedule/feed?account=')
    expect(win).not.toContain('grid.slice(0, 9)')
  })
})
