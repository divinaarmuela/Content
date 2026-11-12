import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { feedClientMark, networkFeedPreview } from '../app/lib/portal-core'

/** THE CLIENT'S WORD ON THE TEAM'S FEED PREVIEW (the owner, 12 Nov 2026: "like the client's one — scheduled, approved, not approved"). */
describe('Feed preview: what the client said, on the tile', () => {
  it('reads the answer off the post', () => {
    expect(feedClientMark({ client_review: { verdict: 'approved' }, if_no_answer: 'wait' })).toBe('approved')
    expect(feedClientMark({ client_review: { verdict: 'not_approved' } })).toBe('not_approved')
    expect(feedClientMark({ client_review: null, if_no_answer: 'wait' })).toBe('waiting')
    expect(feedClientMark({ client_review: null, if_no_answer: 'post' })).toBeNull()
    expect(feedClientMark({})).toBeNull()
  })
  it('booked tiles and this post carry it; live ones never do', () => {
    const post = { id: 'a', channels: ['ig'], slides: [{ url: 'x.jpg', type: 'image' }], caption: 'A', per_channel: {}, scheduled_for: '2026-11-20T07:30:00Z', client_review: { verdict: 'approved' } }
    const other = { id: 'b', stage: 'booked', channels: ['ig'], slides: [{ url: 'y.jpg', type: 'image' }], caption: 'B', per_channel: {}, scheduled_for: '2026-11-22T07:30:00Z', if_no_answer: 'wait' }
    const tiles = networkFeedPreview(post as never, [other] as never, 'ig', [{ id: 'L', at: '2026-11-01T00:00:00Z', thumbnail: 't.jpg', permalink: null }])
    expect(tiles.map(t => [t.kind, t.client ?? null])).toEqual([['booked', 'waiting'], ['this', 'approved'], ['live', null]])
  })
  it('the card caption is clamped inside a padded wrapper, so no fourth line shows half cut', () => {
    const src = readFileSync('app/dashboard/social/schedule/PostFeedPreview.tsx', 'utf8')
    expect(src).toContain('<div className="px-3 pb-2"><p className="line-clamp-3 whitespace-pre-line break-words text-[13px]">')
    expect(src).not.toContain('line-clamp-3 overflow-hidden whitespace-pre-line break-words px-3 pb-2')
  })
})
