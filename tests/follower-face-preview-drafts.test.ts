import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { previewOrder } from '../app/lib/schedule-drag-core'

/**
 * DRAFTS IN THE FEED PREVIEW (Divina and the owner's manager, 24 Sep 2026:
 * "allow drafts on schedule still appear on preview"). The follower-picture
 * half of this file went with the follower list (1 Oct 2026).
 */
describe('drafts in the feed preview', () => {
  it('a post with no time yet sits at the front, and the dated ones keep the feed’s order', () => {
    const posts = [
      { id: 'a', scheduled_for: '2026-09-25T02:00:00.000Z' },
      { id: 'b', scheduled_for: null },
      { id: 'c', scheduled_for: '2026-09-27T02:00:00.000Z' },
      { id: 'd', scheduled_for: '' },
    ]
    expect(previewOrder(posts).map(p => p.id)).toEqual(['b', 'd', 'c', 'a'])
    expect(previewOrder([] as typeof posts).map(p => p.id)).toEqual([])
  })

  // THE POSTING REBUILD (29 Sep 2026, the owner's decision 1): Schedule is for getting APPROVED posts out, so the
  // preview is Instagram posts that are going out — Ready to post and Booked in — and drafts live on Post approval.
  // The preview also stopped drawing cancelled posts, other networks, and posted ones twice (audit S8).
  it('the Preview is given the channel’s posts and keeps only what is going out on Instagram', () => {
    const page = readFileSync('app/dashboard/social/schedule/page.tsx', 'utf8')
    // a tile opens on the page that owns its stage (`openPost`, review fix 29 Sep 2026)
    expect(page).toContain('<PreviewGrid posts={channelPosts} tz={tz} onOpen={openPost}')
    expect(page).toContain('const planned = useMemo(() => channelPosts.filter(p => showsOnSchedule(p.stage)), [channelPosts])')
    const views = readFileSync('app/dashboard/social/schedule/views.tsx', 'utf8')
    expect(views).toContain('previewOrder(previewPosts(posts, instagramIds, feedShown))')
    expect(views).not.toContain('live_status')
  })
})
