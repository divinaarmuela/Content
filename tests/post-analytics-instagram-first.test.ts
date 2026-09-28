import { describe, expect, it } from 'vitest'
import { shapePostAnalytics } from '../app/lib/post-analytics-core'

/** 28 Sep 2026: Justin's Reel — 12 comments on Instagram, the post page showed TikTok's 1 */
describe('a post to several networks reads as its Instagram', () => {
  it('Instagram\'s numbers and link win over the network listed first', () => {
    const row = shapePostAnalytics('p1', {
      publishedAt: '2026-09-25T09:47:20Z',
      platformAnalytics: [
        { platform: 'tiktok', platformPostUrl: 'https://www.tiktok.com/@j/video/1', analytics: { likes: 16, comments: 1, views: 1107 } },
        { platform: 'instagram', platformPostUrl: 'https://www.instagram.com/reel/DdtK1-DDGg_/', analytics: { likes: 110, comments: 12, views: 13182 } },
      ],
    })!
    expect(row.platform).toBe('instagram')
    expect(row.platform_post_url).toBe('https://www.instagram.com/reel/DdtK1-DDGg_/')
    expect(row.comments).toBe(12)
  })
  it('a post with no Instagram keeps the first network with a link', () => {
    const row = shapePostAnalytics('p2', {
      platformAnalytics: [
        { platform: 'linkedin', analytics: { likes: 1 } },
        { platform: 'tiktok', platformPostUrl: 'https://www.tiktok.com/@j/video/2', analytics: { likes: 5 } },
      ],
    })!
    expect(row.platform).toBe('tiktok')
  })
})
