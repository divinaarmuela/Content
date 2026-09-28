import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { instagramUrlOf } from '../app/lib/followers-core'

/**
 * A POST TO SEVERAL NETWORKS STILL HAS ITS INSTAGRAM (28 Sep 2026: "Justin's recent post did not show a new follower
 * from there" — "this is for Instagram"). His 25 Sep Reel went to TikTok, Instagram and LinkedIn; the analytics row
 * named TikTok, so its likes and comments were never read and no follower could be traced to it.
 */
const reel = 'https://www.instagram.com/reel/DdtK1-DDGg_/'
const tiktok = 'https://www.tiktok.com/@justinengelke17/video/7689406842262261012'

describe('instagramUrlOf', () => {
  it('an Instagram row is its own address', () => {
    expect(instagramUrlOf({ platform: 'instagram', platform_post_url: reel })).toBe(reel)
  })
  it('Justin\'s row said TikTok — the Reel is in the per-network block', () => {
    expect(instagramUrlOf({
      platform: 'tiktok', platform_post_url: tiktok,
      raw: { platformAnalytics: [
        { platform: 'tiktok', platformPostUrl: tiktok },
        { platform: 'instagram', platformPostUrl: reel },
        { platform: 'linkedin', platformPostUrl: 'https://www.linkedin.com/feed/update/x' },
      ] },
    })).toBe(reel)
  })
  it('failing that, the publish job\'s own results', () => {
    expect(instagramUrlOf({ platform: 'tiktok', platform_post_url: tiktok, raw: { platformAnalytics: [{ platform: 'instagram' }] } }, [
      { platform: 'tiktok', status: 'published', url: tiktok },
      { platform: 'instagram', status: 'published', url: reel },
    ])).toBe(reel)
  })
  it('a failed Instagram, or none at all, is no address', () => {
    expect(instagramUrlOf({ platform: 'tiktok', platform_post_url: tiktok }, [{ platform: 'instagram', status: 'failed', url: reel }])).toBeNull()
    expect(instagramUrlOf({ platform: 'youtube', platform_post_url: 'https://youtube.com/x' })).toBeNull()
  })
})

describe('everything that reads a post\'s people uses it', () => {
  it('the morning read, the Read now button, and Who it brought in', () => {
    const lib = readFileSync('app/lib/post-interactors.ts', 'utf8')
    expect(lib).toContain('const url = await instagramUrlFor(row)')
    expect(lib).not.toContain('function isInstagramPost')
    expect(readFileSync('app/lib/post-page.ts', 'utf8')).toContain('instagram_url: instagramUrlOf(')
    const route = readFileSync('app/api/social/posts/[id]/people/route.ts', 'utf8')
    expect(route).toContain("String(row.platform) !== 'instagram' && !row.instagram_url")
    expect(route).toContain("page.channels.find(c => c.platform === 'instagram')?.account_id")
    expect(readFileSync('app/lib/post-leads.ts', 'utf8')).toContain('|| !!a.instagram_url')
  })
})
