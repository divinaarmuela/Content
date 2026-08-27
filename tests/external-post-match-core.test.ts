import { describe, expect, it } from 'vitest'
import {
  canonicalPostKey, externalPostId, externalPostUrls, externalPostsOf,
  matchExternalPost, onlyExternal, platformOfUrl, sameProviderPost,
} from '../app/lib/external-post-match-core'

/**
 * The join between a link a human pasted and a post the platform knows about.
 *
 * Every case here is a real shape of link: what Instagram's "Copy link" button
 * produces, what the mobile app produces, what someone types from memory. The
 * feature is worth nothing if a perfectly good link is reported as unfindable,
 * and worse than nothing if the wrong post's numbers are attached to a
 * client's item — so the two halves tested hardest are "these are the same
 * post" and "two candidates means silence".
 */

describe('canonicalPostKey — Instagram', () => {
  it('reads the shortcode as the identity', () => {
    expect(canonicalPostKey('https://www.instagram.com/p/ABC123/')).toBe('instagram:ABC123')
  })

  it('treats /p/ and /reel/ as the same post', () => {
    // Instagram serves a Reel under both paths; the button you pressed decides
    // which one you copied
    expect(sameProviderPost(
      'https://www.instagram.com/p/ABC123/',
      'https://www.instagram.com/reel/ABC123/',
    )).toBe(true)
    expect(canonicalPostKey('https://instagram.com/tv/ABC123')).toBe('instagram:ABC123')
    expect(canonicalPostKey('https://instagram.com/reels/ABC123')).toBe('instagram:ABC123')
  })

  it('drops the tracking query the copy button appends', () => {
    expect(canonicalPostKey(
      'https://www.instagram.com/p/ABC123/?utm_source=ig_web_copy_link&igsh=xyz',
    )).toBe('instagram:ABC123')
  })

  it('drops the fragment and the trailing slash', () => {
    expect(canonicalPostKey('https://instagram.com/p/ABC123/#comments')).toBe('instagram:ABC123')
  })

  it('accepts the mobile host and bare http', () => {
    expect(canonicalPostKey('http://m.instagram.com/p/ABC123')).toBe('instagram:ABC123')
    expect(canonicalPostKey('https://web.instagram.com/p/ABC123')).toBe('instagram:ABC123')
  })

  it('accepts a link pasted without its scheme', () => {
    expect(canonicalPostKey('instagram.com/p/ABC123')).toBe('instagram:ABC123')
  })

  it('keeps the shortcode case — it is base64, not a word', () => {
    expect(canonicalPostKey('https://instagram.com/p/AbC')).not.toBe(
      canonicalPostKey('https://instagram.com/p/abc'),
    )
  })

  it('reads a shortcode under a username path', () => {
    expect(canonicalPostKey('https://www.instagram.com/mdmedia/reel/ABC123/'))
      .toBe('instagram:ABC123')
  })

  it('refuses to turn a profile URL into a post', () => {
    // otherwise every post by that account would look like the same post
    expect(canonicalPostKey('https://instagram.com/')).toBeNull()
    expect(canonicalPostKey('https://instagram.com/mdmedia')).toBe('instagram.com/mdmedia')
  })

  it('is null for anything that is not a URL', () => {
    for (const bad of ['', '   ', null, undefined, 42, 'not a url at all !!']) {
      expect(canonicalPostKey(bad as unknown)).not.toBe('instagram:ABC123')
    }
    expect(canonicalPostKey(null)).toBeNull()
    expect(canonicalPostKey('')).toBeNull()
  })
})

describe('canonicalPostKey — the other platforms', () => {
  it('reads a TikTok video id', () => {
    expect(canonicalPostKey(
      'https://www.tiktok.com/@mdmedia/video/7312345678901234567?is_from_webapp=1&sender_device=pc',
    )).toBe('tiktok:7312345678901234567')
  })

  it('keeps a TikTok short link comparable to itself', () => {
    expect(sameProviderPost('https://vm.tiktok.com/ZMabc123/', 'https://vm.tiktok.com/ZMabc123'))
      .toBe(true)
  })

  it('reads a LinkedIn activity id from both spellings', () => {
    expect(sameProviderPost(
      'https://www.linkedin.com/feed/update/urn:li:activity:7231234567890123456/',
      'https://www.linkedin.com/posts/md-media_some-slug-activity-7231234567890123456-AbCd?utm_source=share',
    )).toBe(true)
  })

  it('reads a Facebook post id, including from the query string', () => {
    expect(canonicalPostKey('https://www.facebook.com/MDMedia/posts/pfbid02xyz'))
      .toBe('facebook:pfbid02xyz')
    // Facebook is the one platform that puts the identity in the query
    expect(canonicalPostKey('https://m.facebook.com/story.php?story_fbid=123&id=456'))
      .toBe('facebook:123')
  })

  it('names the platform a link belongs to', () => {
    expect(platformOfUrl('https://instagram.com/p/A')).toBe('instagram')
    expect(platformOfUrl('https://www.tiktok.com/@a/video/1')).toBe('tiktok')
    expect(platformOfUrl('https://fb.watch/abc/')).toBe('facebook')
    expect(platformOfUrl('https://lnkd.in/abc')).toBe('linkedin')
    expect(platformOfUrl('https://example.com/blog/post')).toBeNull()
  })

  it('falls back to host and path for a platform it does not know', () => {
    expect(canonicalPostKey('https://www.threads.net/@a/post/XYZ/?x=1'))
      .toBe('threads.net/@a/post/XYZ')
  })
})

describe('externalPostsOf / onlyExternal', () => {
  it('unwraps whichever key the provider used', () => {
    expect(externalPostsOf([{ _id: 'a' }])).toHaveLength(1)
    expect(externalPostsOf({ posts: [{ _id: 'a' }] })).toHaveLength(1)
    expect(externalPostsOf({ data: [{ _id: 'a' }, { _id: 'b' }] })).toHaveLength(2)
    expect(externalPostsOf({ analytics: [{ _id: 'a' }] })).toHaveLength(1)
    expect(externalPostsOf(null)).toEqual([])
    expect(externalPostsOf('nope')).toEqual([])
  })

  it('keeps only the posts the platform made', () => {
    const posts = [{ _id: 'a', isExternal: true }, { _id: 'b' }, { _id: 'c', isExternal: false }]
    expect(onlyExternal(posts).map(p => p._id)).toEqual(['a'])
  })

  it('finds a URL wherever the row carries it', () => {
    expect(externalPostUrls({ platformPostUrl: 'https://x/1' })).toEqual(['https://x/1'])
    expect(externalPostUrls({ platforms: [{ platformPostUrl: 'https://x/2' }] })).toEqual(['https://x/2'])
    expect(externalPostId({ _id: 'post_1' })).toBe('post_1')
    expect(externalPostId({})).toBeNull()
  })
})

/* ── the match ─────────────────────────────────────────────────────────── */

const AT = '2026-08-26T09:00:00.000Z'
const post = (over: Record<string, unknown> = {}) => ({
  _id: 'post_1',
  isExternal: true,
  platform: 'instagram',
  profileId: 'profile_1',
  publishedAt: AT,
  platformPostUrl: 'https://www.instagram.com/reel/ABC123/',
  ...over,
})

describe('matchExternalPost — by URL', () => {
  it('matches a pasted /p/ link to the provider’s /reel/ link', () => {
    const match = matchExternalPost('https://instagram.com/p/ABC123/?utm_source=ig_web_copy_link', [post()])
    expect(match?.providerPostId).toBe('post_1')
    expect(match?.matchedBy).toBe('url')
  })

  it('matches a URL carried on the per-platform block', () => {
    const row = post({
      platformPostUrl: undefined,
      platforms: [{ platform: 'instagram', platformPostUrl: 'https://instagram.com/p/ABC123' }],
    })
    expect(matchExternalPost('https://instagram.com/reel/ABC123', [row])?.providerPostId).toBe('post_1')
  })

  it('does not match a different post by the same account', () => {
    expect(matchExternalPost('https://instagram.com/p/ZZZ999', [post()])).toBeNull()
  })

  it('ignores a post row with no provider id — there is nothing to key on', () => {
    expect(matchExternalPost('https://instagram.com/p/ABC123', [post({ _id: undefined })])).toBeNull()
  })

  it('answers null for an empty list', () => {
    expect(matchExternalPost('https://instagram.com/p/ABC123', [])).toBeNull()
    expect(matchExternalPost('https://instagram.com/p/ABC123', null)).toBeNull()
  })
})

describe('matchExternalPost — the ±6h fallback', () => {
  const hint = { platform: 'instagram', profileId: 'profile_1', at: AT }

  it('finds the one post in the window when there is no link at all', () => {
    // "Mark as posted" — a Story, or a post whose link nobody pasted
    const match = matchExternalPost(null, [post({ publishedAt: '2026-08-26T13:30:00.000Z' })], hint)
    expect(match?.providerPostId).toBe('post_1')
    expect(match?.matchedBy).toBe('window')
  })

  it('takes the near edge of the window and refuses the far side of it', () => {
    const inside = post({ publishedAt: '2026-08-26T14:59:00.000Z' })
    const outside = post({ publishedAt: '2026-08-26T15:30:00.000Z' })
    expect(matchExternalPost(null, [inside], hint)?.providerPostId).toBe('post_1')
    expect(matchExternalPost(null, [outside], hint)).toBeNull()
    // and the same distance before the entry's own time
    expect(matchExternalPost(null, [post({ publishedAt: '2026-08-26T03:30:00.000Z' })], hint)?.providerPostId)
      .toBe('post_1')
    expect(matchExternalPost(null, [post({ publishedAt: '2026-08-26T02:00:00.000Z' })], hint)).toBeNull()
  })

  it('is silent when TWO posts could be meant', () => {
    // the whole point: a wrong attribution is worse than no numbers
    const two = [post({ _id: 'post_1' }), post({ _id: 'post_2', publishedAt: '2026-08-26T11:00:00.000Z' })]
    expect(matchExternalPost(null, two, hint)).toBeNull()
  })

  it('is silent when none are in the window', () => {
    expect(matchExternalPost(null, [post({ publishedAt: '2026-08-01T09:00:00.000Z' })], hint)).toBeNull()
  })

  it('ignores another platform and another client’s profile', () => {
    expect(matchExternalPost(null, [post({ platform: 'facebook' })], hint)).toBeNull()
    expect(matchExternalPost(null, [post({ profileId: 'profile_2' })], hint)).toBeNull()
    // a row that names no profile is still ours to consider — the provider's
    // list is already scoped to our own API key
    expect(matchExternalPost(null, [post({ profileId: undefined })], hint)?.providerPostId)
      .toBe('post_1')
  })

  it('will not run at all without a date to measure from', () => {
    expect(matchExternalPost(null, [post()], { platform: 'instagram' })).toBeNull()
    expect(matchExternalPost(null, [post()], { ...hint, at: 'not a date' })).toBeNull()
  })

  it('prefers the URL when one matches, even though another sits in the window', () => {
    const posts = [
      post({ _id: 'window_only', platformPostUrl: 'https://instagram.com/p/OTHER' }),
      post({ _id: 'the_link', platformPostUrl: 'https://instagram.com/reel/ABC123/' }),
    ]
    const match = matchExternalPost('https://instagram.com/p/ABC123', posts, hint)
    expect(match?.providerPostId).toBe('the_link')
    expect(match?.matchedBy).toBe('url')
  })

  it('falls back when the pasted link matches nothing', () => {
    const match = matchExternalPost('https://instagram.com/p/TYPO', [post()], hint)
    expect(match?.matchedBy).toBe('window')
  })

  it('honours a wider window when one is asked for', () => {
    const far = post({ publishedAt: '2026-08-26T20:00:00.000Z' })
    expect(matchExternalPost(null, [far], hint)).toBeNull()
    expect(matchExternalPost(null, [far], { ...hint, windowHours: 12 })?.providerPostId).toBe('post_1')
  })
})
