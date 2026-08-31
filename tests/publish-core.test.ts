import { describe, it, expect } from 'vitest'
import {
  validatePost, buildPostBody, classifyResponse, mediaTypeFor, isPlatform, toPlatformData,
  availableKinds, autoKindFor, describeRemoteOutcome, SUPPORTED_PLATFORMS,
} from '../app/lib/publish-core'

const img = (n = 1) => Array.from({ length: n }, (_, i) => ({ url: `https://x/${i}.jpg`, type: 'image' as const }))
const vid = (n = 1) => Array.from({ length: n }, (_, i) => ({ url: `https://x/${i}.mp4`, type: 'video' as const }))

describe('validatePost', () => {
  it('accepts an ordinary Instagram carousel', () => {
    expect(validatePost({ caption: 'hello', media: img(3), platforms: ['instagram'] })).toEqual([])
  })

  it('rejects a caption longer than the platform allows, naming both numbers', () => {
    const [issue] = validatePost({ caption: 'x'.repeat(281), media: [], platforms: ['twitter'] })
    expect(issue.problem).toMatch(/281 characters/)
    expect(issue.problem).toMatch(/280/)
  })

  it('rejects mixing images and video where the platform forbids it', () => {
    const issues = validatePost({ caption: 'a', media: [...img(2), ...vid(1)], platforms: ['instagram'] })
    expect(issues.some(i => /cannot mix/.test(i.problem))).toBe(true)
  })

  it('enforces per-platform image counts', () => {
    expect(validatePost({ caption: 'a', media: img(5), platforms: ['twitter'] })[0].problem)
      .toMatch(/5 images; twitter allows 4/)
    // the same media is fine on TikTok
    expect(validatePost({ caption: 'a', media: img(5), platforms: ['tiktok'] })).toEqual([])
  })

  it('requires media where the platform demands it', () => {
    expect(validatePost({ caption: 'a', media: [], platforms: ['instagram'] })[0].problem)
      .toMatch(/requires at least one/)
    // but not where it does not
    expect(validatePost({ caption: 'a', media: [], platforms: ['twitter'] })).toEqual([])
  })

  it('rejects documents on platforms that do not take them', () => {
    const issues = validatePost({
      caption: 'a', media: [{ url: 'https://x/a.pdf', type: 'document' }], platforms: ['instagram'],
    })
    expect(issues.some(i => /does not accept documents/.test(i.problem))).toBe(true)
  })

  it('reports every platform that fails, not just the first', () => {
    const issues = validatePost({ caption: 'x'.repeat(600), media: img(6), platforms: ['twitter', 'bluesky'] })
    expect(new Set(issues.map(i => i.platform))).toEqual(new Set(['twitter', 'bluesky']))
  })

  it('treats an empty platform list as an error rather than a silent no-op', () => {
    expect(validatePost({ caption: 'a', media: [], platforms: [] })).toHaveLength(1)
  })
})

describe('post kinds — reels, stories, carousels', () => {
  it('accepts a single vertical video as a Reel', () => {
    expect(validatePost({
      caption: 'a', media: vid(1), platforms: ['instagram'], kinds: { instagram: 'reel' },
    })).toEqual([])
  })

  it('rejects a Reel with a still image attached', () => {
    const issues = validatePost({
      caption: 'a', media: img(1), platforms: ['instagram'], kinds: { instagram: 'reel' },
    })
    expect(issues.some(i => /Reel needs exactly one video/.test(i.problem))).toBe(true)
  })

  it('rejects a Story with more than one item', () => {
    const issues = validatePost({
      caption: 'a', media: img(2), platforms: ['instagram'], kinds: { instagram: 'story' },
    })
    expect(issues.some(i => /Story takes exactly one/.test(i.problem))).toBe(true)
  })

  it('rejects a carousel of one', () => {
    const issues = validatePost({
      caption: 'a', media: img(1), platforms: ['instagram'], kinds: { instagram: 'carousel' },
    })
    expect(issues.some(i => /at least two items/.test(i.problem))).toBe(true)
  })

  it('accepts a ten-slide Instagram carousel and refuses an eleventh', () => {
    expect(validatePost({
      caption: 'a', media: img(10), platforms: ['instagram'], kinds: { instagram: 'carousel' },
    })).toEqual([])
    const issues = validatePost({
      caption: 'a', media: img(11), platforms: ['instagram'], kinds: { instagram: 'carousel' },
    })
    expect(issues.some(i => /11 slides; instagram allows 10/.test(i.problem))).toBe(true)
  })

  it('lets an Instagram carousel mix images and video', () => {
    expect(validatePost({
      caption: 'a', media: [...img(4), ...vid(2)], platforms: ['instagram'],
      kinds: { instagram: 'carousel' },
    })).toEqual([])
  })

  it('still refuses that mix in an ordinary post', () => {
    const issues = validatePost({
      caption: 'a', media: [...img(4), ...vid(2)], platforms: ['instagram'],
      kinds: { instagram: 'feed' },
    })
    expect(issues.some(i => /cannot mix/.test(i.problem))).toBe(true)
  })

  it('says so when the platform has no carousel at all', () => {
    const issues = validatePost({
      caption: 'a', media: vid(2), platforms: ['youtube'], kinds: { youtube: 'carousel' },
    })
    expect(issues.some(i => /does not post carousels/.test(i.problem))).toBe(true)
  })

  it('keeps the single-video limit on a carousel that may not mix', () => {
    const issues = validatePost({
      caption: 'a', media: vid(3), platforms: ['linkedin'], kinds: { linkedin: 'carousel' },
    })
    expect(issues.some(i => /3 videos; linkedin allows 1/.test(i.problem))).toBe(true)
  })

  it('leaves ordinary feed posts unaffected', () => {
    expect(validatePost({
      caption: 'a', media: img(1), platforms: ['instagram'], kinds: { instagram: 'feed' },
    })).toEqual([])
  })
})

describe('toPlatformData', () => {
  it('marks a Story explicitly, since the provider cannot infer it', () => {
    expect(toPlatformData({ kind: 'story' })).toEqual({ contentType: 'story' })
  })

  it('does not mark a Reel on Instagram — a lone video already becomes one, and Meta 400s an unknown field', () => {
    expect(toPlatformData({ kind: 'reel' }, 'instagram')).toBeNull()
    expect(toPlatformData({ kind: 'reel', shareToFeed: false }, 'instagram')).toEqual({ shareToFeed: false })
  })

  it('DOES mark a Reel on Facebook, where the default is a feed video', () => {
    // sending nothing here published every Facebook "Reel" as a feed video
    expect(toPlatformData({ kind: 'reel' }, 'facebook')).toEqual({ contentType: 'reel' })
    expect(toPlatformData({ kind: 'feed' }, 'facebook')).toBeNull()
  })

  it('maps the optional extras to their provider field names', () => {
    expect(toPlatformData({
      firstComment: '#hashtags', thumbnailUrl: 'https://x/c.jpg', thumbOffset: 1500, isAiGenerated: true,
    })).toEqual({
      firstComment: '#hashtags',
      instagramThumbnail: 'https://x/c.jpg',
      thumbOffset: 1500,
      isAiGenerated: true,
    })
  })

  it('caps collaborators at the documented three', () => {
    const out = toPlatformData({ collaborators: ['a', 'b', 'c', 'd'] })
    expect(out?.collaborators).toEqual(['a', 'b', 'c'])
  })

  it('returns null when there is nothing to send', () => {
    expect(toPlatformData({})).toBeNull()
    expect(toPlatformData({ kind: 'feed' })).toBeNull()
  })

  describe('user tags — the only positioned element the API offers', () => {
    it('keeps coordinates on feed posts and strips the leading @', () => {
      const out = toPlatformData({ kind: 'feed', userTags: [{ username: '@acme', x: 0.4, y: 0.6 }] })
      expect(out?.userTags).toEqual([{ username: 'acme', x: 0.4, y: 0.6 }])
    })

    it('drops coordinates on Reels, which ignore them', () => {
      const out = toPlatformData({ kind: 'reel', userTags: [{ username: 'acme', x: 0.4, y: 0.6 }] })
      expect(out?.userTags).toEqual([{ username: 'acme' }])
    })

    it('keeps coordinates on Stories, which accept them', () => {
      const out = toPlatformData({ kind: 'story', userTags: [{ username: 'acme', x: 0.1, y: 0.2 }] })
      expect(out?.userTags).toEqual([{ username: 'acme', x: 0.1, y: 0.2 }])
    })

    it('clamps coordinates into the 0–1 range', () => {
      const out = toPlatformData({ kind: 'feed', userTags: [{ username: 'a', x: 5, y: -2 }] })
      expect(out?.userTags).toEqual([{ username: 'a', x: 1, y: 0 }])
    })

    it('ignores blank usernames', () => {
      const out = toPlatformData({ userTags: [{ username: '  ' }, { username: 'ok' }] })
      expect(out?.userTags).toEqual([{ username: 'ok' }])
    })
  })
})

describe('buildPostBody', () => {
  it('attaches platformSpecificData only where there is something to attach', () => {
    const body = buildPostBody({
      caption: 'hi', media: vid(1),
      targets: [
        { platform: 'instagram', accountId: 'a1', options: { kind: 'story' } },
        { platform: 'tiktok', accountId: 'a2' },
      ],
    })
    expect(body.platforms[0].platformSpecificData).toEqual({ contentType: 'story' })
    expect(body.platforms[1].platformSpecificData).toBeUndefined()
  })

  const targets = [{ platform: 'instagram' as const, accountId: 'acc_1' }]

  it('schedules with an explicit timezone', () => {
    const body = buildPostBody({
      caption: 'hi', media: img(1), targets, scheduledFor: '2026-08-02T09:00:00',
    })
    expect(body.scheduledFor).toBe('2026-08-02T09:00:00')
    expect(body.timezone).toBe('Australia/Melbourne')
    expect(body.publishNow).toBeUndefined()
  })

  it('publishes immediately when there is no scheduled time', () => {
    const body = buildPostBody({ caption: 'hi', media: img(1), targets, scheduledFor: null })
    expect(body.publishNow).toBe(true)
    expect(body.scheduledFor).toBeUndefined()
  })

  it('omits mediaItems entirely when there is no media', () => {
    expect(buildPostBody({ caption: 'hi', media: [], targets }).mediaItems).toBeUndefined()
  })
})

describe('classifyResponse', () => {
  it('reports a normal creation as published', () => {
    expect(classifyResponse(200, { post: { _id: 'p1' } }))
      .toEqual({ kind: 'published', postId: 'p1', replayed: false })
  })

  it('recognises our own replayed request', () => {
    const out = classifyResponse(200, { existingPost: { _id: 'p1' } })
    expect(out).toEqual({ kind: 'published', postId: 'p1', replayed: true })
  })

  it('treats 409 content-hash as a duplicate, never as a failure', () => {
    // the post already exists on the client's account — retrying would be wrong
    expect(classifyResponse(409, { existingPost: { _id: 'p9' } }))
      .toEqual({ kind: 'duplicate', postId: 'p9' })
  })

  it('marks 429 and 5xx retryable', () => {
    expect(classifyResponse(429, {}).kind).toBe('retryable')
    expect(classifyResponse(503, {}).kind).toBe('retryable')
  })

  it('marks 4xx permanent so a bad payload is not retried forever', () => {
    expect(classifyResponse(400, { error: 'bad caption' }))
      .toEqual({ kind: 'permanent', message: 'bad caption' })
    expect(classifyResponse(401, {}).kind).toBe('permanent')
  })

  it('does not claim success when the provider returns 2xx with no post id', () => {
    expect(classifyResponse(201, {}).kind).toBe('retryable')
  })
})

describe('mediaTypeFor / isPlatform', () => {
  it('maps content types', () => {
    expect(mediaTypeFor('image/jpeg')).toBe('image')
    expect(mediaTypeFor('video/mp4')).toBe('video')
    expect(mediaTypeFor('application/pdf')).toBe('document')
    expect(mediaTypeFor('text/csv')).toBeNull()
  })

  it('guards unknown platforms', () => {
    expect(isPlatform('instagram')).toBe(true)
    expect(isPlatform('myspace')).toBe(false)
  })
})

describe('a post type that does not exist on the platform', () => {
  // "Reel" is Instagram's word; YouTube calls the same upload a Short and
  // TikTok just calls it a video. Stories are the case where the difference is
  // not naming but existence — most platforms have none at all.
  it('refuses a Story on a platform that has none', () => {
    const issues = validatePost({
      caption: '',
      media: [{ url: 'https://x.invalid/a.mp4', type: 'video' }],
      platforms: ['youtube', 'linkedin', 'tiktok'],
      kinds: { youtube: 'story', linkedin: 'story', tiktok: 'story' },
    })
    for (const p of ['youtube', 'linkedin', 'tiktok']) {
      expect(issues.some(i => i.platform === p && /has no Stories/.test(i.problem)), p).toBe(true)
    }
  })

  it('allows one where it does exist', () => {
    const issues = validatePost({
      caption: '',
      media: [{ url: 'https://x.invalid/a.mp4', type: 'video' }],
      platforms: ['instagram', 'facebook'],
      kinds: { instagram: 'story', facebook: 'story' },
    })
    expect(issues).toEqual([])
  })

  it('says the platform has no Stories rather than counting the media', () => {
    // two items AND no Stories: the count is not the useful half
    const issues = validatePost({
      caption: '',
      media: [
        { url: 'https://x.invalid/a.jpg', type: 'image' },
        { url: 'https://x.invalid/b.jpg', type: 'image' },
      ],
      platforms: ['youtube'],
      kinds: { youtube: 'story' },
    })
    expect(issues.filter(i => /Story|Stories/.test(i.problem))).toHaveLength(1)
    expect(issues.some(i => /has no Stories/.test(i.problem))).toBe(true)
  })
})

describe('each channel offers only the post types it has', () => {
  it('does not offer a Story where there are none, or a carousel where there is none', () => {
    expect(availableKinds('youtube')).toEqual(['feed', 'reel'])
    expect(availableKinds('instagram')).toEqual(['feed', 'reel', 'story', 'carousel'])
    expect(availableKinds('linkedin')).toEqual(['feed', 'carousel'])
    expect(availableKinds('pinterest')).toEqual(['feed'])
  })

  it('always offers at least a plain post', () => {
    for (const p of SUPPORTED_PLATFORMS) {
      expect(availableKinds(p), p).toContain('feed')
    }
  })

  it('never offers a type that validation would then refuse', () => {
    const one = [{ url: 'https://x.invalid/a.mp4', type: 'video' as const }]
    const two = [
      { url: 'https://x.invalid/a.jpg', type: 'image' as const },
      { url: 'https://x.invalid/b.jpg', type: 'image' as const },
    ]
    for (const p of SUPPORTED_PLATFORMS) {
      for (const kind of availableKinds(p)) {
        // give each type the media it is entitled to
        const media = kind === 'carousel' ? two : one
        const issues = validatePost({ caption: '', media, platforms: [p], kinds: { [p]: kind } })
        const aboutTheType = issues.filter(i =>
          /has no Stories|does not post carousels|needs at least two/.test(i.problem))
        expect(aboutTheType, `${p} offers ${kind} but refuses it`).toEqual([])
      }
    }
  })
})

describe('what Automatic resolves to, per platform', () => {
  const two = [
    { url: 'https://x.invalid/a.jpg', type: 'image' as const },
    { url: 'https://x.invalid/b.jpg', type: 'image' as const },
  ]

  it('reads the media the way the provider does', () => {
    expect(autoKindFor('instagram', [{ url: 'https://x.invalid/a.mp4', type: 'video' }])).toBe('reel')
    expect(autoKindFor('instagram', two)).toBe('carousel')
    expect(autoKindFor('instagram', [{ url: 'https://x.invalid/a.jpg', type: 'image' }])).toBe('feed')
    expect(autoKindFor('instagram', [])).toBe('feed')
  })

  // the bug this closes: one global guess sent "carousel" to YouTube, which
  // has none, failing validation on a choice nobody made
  it('falls back rather than guessing a type the platform lacks', () => {
    expect(autoKindFor('youtube', two)).toBe('feed')
    expect(autoKindFor('pinterest', two)).toBe('feed')
    expect(autoKindFor('linkedin', [{ url: 'https://x.invalid/a.mp4', type: 'video' }])).toBe('feed')
  })

  it('never resolves to something the platform does not offer', () => {
    for (const p of SUPPORTED_PLATFORMS) {
      for (const media of [[], two, [{ url: 'https://x.invalid/a.mp4', type: 'video' as const }]]) {
        expect(availableKinds(p), p).toContain(autoKindFor(p, media))
      }
    }
  })
})

describe('what a partial result actually says', () => {
  // the reconcile used to store "Provider reported the post as partial after
  // creation" and throw the per-platform rows away — so a post that was LIVE
  // on YouTube read as a failure with no reason anyone could act on
  const rows = [
    { platform: 'youtube', status: 'published', platformPostUrl: 'https://www.youtube.com/watch?v=abc' },
    { platform: 'instagram', status: 'failed', errorMessage: 'Media must be 9:16 for Reels' },
    { platform: 'tiktok', status: 'failed', error: 'video exceeds 10 minutes' },
    { platform: 'linkedin', status: 'failed' },
  ]

  it('names where it went out and, per channel, why it did not', () => {
    const o = describeRemoteOutcome('partial', rows)
    expect(o.error).toBe(
      'Went out on youtube. Did not go out on instagram: Media must be 9:16 for Reels; '
      + 'tiktok: video exceeds 10 minutes; linkedin: no reason given.',
    )
    expect(o.livePlatforms).toEqual(['youtube'])
    expect(o.failedPlatforms).toEqual(['instagram', 'tiktok', 'linkedin'])
  })

  it('keeps the permalink of the channel that DID post', () => {
    expect(describeRemoteOutcome('partial', rows).permalink).toBe('https://www.youtube.com/watch?v=abc')
  })

  it('reads a total failure as reasons, not a status word', () => {
    const o = describeRemoteOutcome('failed', rows.slice(1))
    expect(o.error).toMatch(/^Did not go out — instagram: /)
    expect(o.permalink).toBeNull()
  })

  it('falls back to the status word only when the provider said nothing else', () => {
    expect(describeRemoteOutcome('failed', []).error).toBe('Provider reported the post as failed after creation')
    expect(describeRemoteOutcome('partial', undefined).error).toBe('Provider reported the post as partial after creation')
  })
})

describe('what Zernio requires that we were not sending', () => {
  it('carries TikTok settings at the top level whenever TikTok is a target', () => {
    // all six fields are REQUIRED in Zernio's guide, and the block goes at the
    // top of the body, not in platformSpecificData — their one special case
    const body = buildPostBody({
      caption: 'hi', media: vid(1), scheduledFor: null,
      targets: [{ platform: 'tiktok', accountId: 't' }, { platform: 'instagram', accountId: 'i' }],
    })
    expect(body.tiktokSettings).toEqual({
      privacy_level: 'PUBLIC_TO_EVERYONE',
      allow_comment: true, allow_duet: true, allow_stitch: true,
      content_preview_confirmed: true, express_consent_given: true,
    })
    expect(body.platforms.find(p => p.platform === 'tiktok')?.platformSpecificData).toBeUndefined()
  })

  it('sends none when TikTok is not a target', () => {
    const body = buildPostBody({
      caption: 'hi', media: vid(1), scheduledFor: null,
      targets: [{ platform: 'instagram', accountId: 'i' }],
    })
    expect(body.tiktokSettings).toBeUndefined()
  })

  it('passes the platform through so Facebook Reels are marked in the body', () => {
    const body = buildPostBody({
      caption: 'hi', media: vid(1), scheduledFor: null,
      targets: [
        { platform: 'facebook', accountId: 'f', options: { kind: 'reel' } },
        { platform: 'instagram', accountId: 'i', options: { kind: 'reel' } },
      ],
    })
    expect(body.platforms[0].platformSpecificData).toEqual({ contentType: 'reel' })
    expect(body.platforms[1].platformSpecificData).toBeUndefined()
  })
})

describe('Instagram has no feed video, so the menu does not offer one', () => {
  const one = vid(1)
  it('drops "Feed post" for a lone video on Instagram only', () => {
    expect(availableKinds('instagram', one)).toEqual(['reel', 'story', 'carousel'])
    expect(availableKinds('instagram', img(1))).toEqual(['feed', 'reel', 'story', 'carousel'])
    expect(availableKinds('instagram')).toEqual(['feed', 'reel', 'story', 'carousel'])
    expect(availableKinds('facebook', one)).toContain('feed')
    expect(availableKinds('tiktok', one)).toContain('feed')
  })

  it('so a "feed" choice resolves to Reel there — the row says what will happen', () => {
    expect(autoKindFor('instagram', one)).toBe('reel')
    // and the clamp the composer applies: feed is not available, auto is reel
    expect(availableKinds('instagram', one).includes('feed')).toBe(false)
  })
})
