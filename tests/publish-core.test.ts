import { describe, it, expect } from 'vitest'
import {
  validatePost, buildPostBody, classifyResponse, mediaTypeFor, isPlatform, toPlatformData,
  availableKinds, autoKindFor, describeRemoteOutcome, isStillProcessing, SUPPORTED_PLATFORMS,
  cleanTags, optionProblems, tagsLength, tiktokSettingsFor, youtubeDefaults,
  asOrganizationUrn, isOrganizationUrn,
  TIKTOK_DEFAULTS, YOUTUBE_TITLE_MAX,
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
    expect(issues.some(i => /at least two slides/.test(i.problem))).toBe(true)
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

describe('a channel with its own media and words', () => {
  // a twelve-minute cut for YouTube and a ninety-second one for Instagram used
  // to be two posts; Zernio takes customMedia / customContent per platform
  it('puts the override on that platform entry only, and leaves the shared set as the default', () => {
    const body = buildPostBody({
      caption: 'long caption for everyone', media: vid(1), scheduledFor: null,
      targets: [
        { platform: 'youtube', accountId: 'y' },
        { platform: 'instagram', accountId: 'i', options: { media: [{ url: 'https://x/short.mp4', type: 'video' }] } },
        { platform: 'twitter', accountId: 't', options: { caption: 'short one', longVideo: true } },
      ],
    })
    expect(body.mediaItems).toEqual(vid(1))
    // YouTube alone is never bare: it will not take a video without a title,
    // a category and an answer about children, so a post nobody opened the
    // options for still carries all three
    expect(body.platforms[0]).toEqual({
      platform: 'youtube',
      accountId: 'y',
      platformSpecificData: {
        title: 'long caption for everyone',
        categoryId: '22',
        madeForKids: false,
        // WHO CAN WATCH is not in here: a channel that publishes privately by
        // default must not start publishing to the world because of a default
        // we invented
      },
    })
    expect(body.platforms[1].customMedia).toEqual([{ url: 'https://x/short.mp4', type: 'video' }])
    expect(body.platforms[1].customContent).toBeUndefined()
    expect(body.platforms[2].customContent).toBe('short one')
    expect(body.platforms[2].platformSpecificData).toEqual({ longVideo: true })
  })

  it('never sends longVideo anywhere but X — Meta 400s an unknown field', () => {
    expect(toPlatformData({ longVideo: true }, 'instagram')).toBeNull()
    expect(toPlatformData({ longVideo: true }, 'twitter')).toEqual({ longVideo: true })
  })

  it('validates each channel on what IT receives', () => {
    // 500 characters breaks X's 280 — unless X has its own shorter caption
    const long = 'x'.repeat(500)
    expect(validatePost({ caption: long, media: [], platforms: ['twitter', 'linkedin'] })
      .map(i => i.platform)).toEqual(['twitter'])
    expect(validatePost({
      caption: long, media: [], platforms: ['twitter', 'linkedin'],
      captionByPlatform: { twitter: 'short' },
    })).toEqual([])
    // five images break X's four — unless X gets its own single image
    expect(validatePost({
      caption: 'a', media: img(5), platforms: ['twitter'],
      mediaByPlatform: { twitter: img(1) },
    })).toEqual([])
    // and an override that is itself wrong is caught, on that channel
    expect(validatePost({
      caption: 'a', media: img(1), platforms: ['twitter'],
      mediaByPlatform: { twitter: img(5) },
    })[0].problem).toMatch(/5 images/)
  })
})

describe('a TikTok upload the platform is still processing is a wait, not a failure', () => {
  // Zernio reports it as status "failed" with this message and keeps checking;
  // the 3:26 pm 2 GB master went live on TikTok 63 minutes later. Reading it
  // as failed offered a retry that would have posted the video twice — which
  // the message itself warns against.
  const still = {
    platform: 'tiktok', status: 'failed',
    errorMessage: 'TikTok is still processing this upload. We keep checking and will update this post automatically. Please do not repost it: that would upload a duplicate to TikTok.',
  }
  it('is recognised by its message, not its status word', () => {
    expect(isStillProcessing(still)).toBe(true)
    expect(isStillProcessing({ platform: 'tiktok', status: 'failed', errorMessage: 'video too long' })).toBe(false)
  })

  it('is reported as pending, and never as a failure to retry', () => {
    const o = describeRemoteOutcome('partial', [
      { platform: 'youtube', status: 'published', platformPostUrl: 'https://youtu.be/x' },
      still,
    ])
    expect(o.failedPlatforms).toEqual([])
    expect(o.pendingPlatforms).toEqual(['tiktok'])
    expect(o.error).toBe('Went out on youtube. Still going out on tiktok — the platform is processing it; do not resend.')
  })

  it('still names a real failure beside it', () => {
    const o = describeRemoteOutcome('partial', [
      { platform: 'linkedin', status: 'failed', errorMessage: 'Publishing timed out during platform API call.' },
      still,
    ])
    expect(o.failedPlatforms).toEqual(['linkedin'])
    expect(o.pendingPlatforms).toEqual(['tiktok'])
    expect(o.error).toMatch(/^Did not go out — linkedin: Publishing timed out/)
    expect(o.error).toMatch(/Still going out on tiktok/)
  })
})


/**
 * THE PER-NETWORK POSTING OPTIONS.
 *
 * Two failures are being guarded against, and they fail in opposite ways.
 * A field sent to a network that does not have it is a 400 from Meta naming
 * it — a post that never happens, hours after anybody was watching. A field
 * NOT sent is a control in the window that silently does nothing. So each one
 * is asserted both ways: it lands where it belongs, and nowhere else.
 */
describe('per-network options land where the network takes them', () => {
  it('sends Instagram its own settings and nobody else theirs', () => {
    const out = toPlatformData({
      kind: 'reel', trialGraduation: 'SS_PERFORMANCE', audioName: 'Our sound',
      collaborators: ['acme'], title: 'nope', organizationUrn: 'urn:li:organization:1',
    }, 'instagram')
    expect(out).toEqual({
      trialParams: { graduationStrategy: 'SS_PERFORMANCE' },
      audioName: 'Our sound',
      collaborators: ['acme'],
    })
  })

  it('keeps a trial Reel off anything that is not a Reel', () => {
    for (const kind of ['story', 'carousel', 'feed'] as const) {
      const out = toPlatformData({ kind, trialGraduation: 'MANUAL', audioName: 'x' }, 'instagram')
      expect(out?.trialParams).toBeUndefined()
      expect(out?.audioName).toBeUndefined()
    }
  })

  it('sends YouTube its title, visibility, tags, category and playlist', () => {
    expect(toPlatformData({
      title: 'A morning in the roastery', visibility: 'unlisted', madeForKids: false,
      tags: ['#coffee', 'coffee', ' melbourne '], categoryId: '27', playlistId: 'PL1',
      containsSyntheticMedia: true, firstComment: 'first!',
    }, 'youtube')).toEqual({
      title: 'A morning in the roastery',
      visibility: 'unlisted',
      madeForKids: false,
      // no duplicates, no leading hash, no stray spaces
      tags: ['coffee', 'melbourne'],
      categoryId: '27',
      playlistId: 'PL1',
      containsSyntheticMedia: true,
      firstComment: 'first!',
    })
  })

  it('never sends a YouTube setting to Instagram or a LinkedIn one to YouTube', () => {
    expect(toPlatformData({ visibility: 'private', tags: ['a'] }, 'instagram')).toBeNull()
    expect(toPlatformData({ organizationUrn: 'urn:li:organization:1' }, 'youtube')).toBeNull()
    expect(toPlatformData({ collaborators: ['acme'] }, 'linkedin')).toBeNull()
  })

  it('gives LinkedIn its company page, link preview and document name', () => {
    expect(toPlatformData({
      organizationUrn: 'urn:li:organization:9', disableLinkPreview: true, documentTitle: 'Deck',
    }, 'linkedin')).toEqual({
      organizationUrn: 'urn:li:organization:9',
      disableLinkPreview: true,
      documentTitle: 'Deck',
    })
  })

  it("nests Facebook's draft flag where Zernio wants it, and titles Reels only", () => {
    expect(toPlatformData({ kind: 'reel', pageId: '123', title: 'Reel one', facebookDraft: true }, 'facebook'))
      .toEqual({
        contentType: 'reel', pageId: '123', title: 'Reel one', facebookSettings: { draft: true },
      })
    // a feed post has no title on Facebook — sending one is a field Facebook
    // does not know on that surface
    expect(toPlatformData({ kind: 'feed', title: 'Reel one' }, 'facebook')).toBeNull()
  })

  it('keeps collaborators off a Story, which cannot have any', () => {
    // Meta answers the field with a 400 and the post never goes out — the
    // same class of failure as a location on a Story
    expect(toPlatformData({ kind: 'story', collaborators: ['acme'] }, 'instagram'))
      .toEqual({ contentType: 'story' })
    expect(toPlatformData({ kind: 'feed', collaborators: ['acme'] }, 'instagram'))
      .toEqual({ collaborators: ['acme'] })
  })

  it('refuses a company page that is not one, and takes a bare id as one', () => {
    expect(isOrganizationUrn('urn:li:organization:99')).toBe(true)
    expect(isOrganizationUrn('99')).toBe(false)
    expect(isOrganizationUrn('urn:li:person:99')).toBe(false)
    expect(asOrganizationUrn('99')).toBe('urn:li:organization:99')
    expect(asOrganizationUrn('Acme Pty Ltd')).toBeNull()
    // …and a bare id that reached the options anyway is not sent: posting as
    // "99" posts as the person, quietly
    expect(toPlatformData({ organizationUrn: '99' }, 'linkedin')).toBeNull()
    expect(toPlatformData({ organizationUrn: 'urn:li:organization:99' }, 'linkedin'))
      .toEqual({ organizationUrn: 'urn:li:organization:99' })
  })

  it('keeps a first comment off a Story, which has no comments to put it under', () => {
    expect(toPlatformData({ kind: 'story', firstComment: '#tags' }, 'instagram'))
      .toEqual({ contentType: 'story' })
    expect(toPlatformData({ kind: 'story', firstComment: '#tags' }, 'facebook'))
      .toEqual({ contentType: 'story' })
  })

  it('trims a title to what YouTube takes rather than sending one it refuses', () => {
    const long = 'x'.repeat(140)
    expect((toPlatformData({ title: long }, 'youtube') ?? {}).title)
      .toHaveLength(YOUTUBE_TITLE_MAX)
  })

  it('counts tags the way YouTube does — all of them together', () => {
    expect(cleanTags(['#one', 'one', ' two '])).toEqual(['one', 'two'])
    expect(tagsLength(['one', 'two'])).toBe('one,two'.length)
    expect(tagsLength([])).toBe(0)
  })
})

describe('one channel per network in one post', () => {
  // everything per-channel in the body is keyed by network — the options, the
  // media override, the words, and TikTok's settings block, which is top
  // level and singular. Two accounts on one network share one set of answers,
  // so the second one's choices would be neither checked nor sent.
  it('refuses a second channel on the same network, in a sentence', () => {
    const issues = validatePost({
      caption: 'hello', media: img(1), platforms: ['instagram', 'instagram'],
    })
    expect(issues.map(i => i.problem).join(' '))
      .toMatch(/Two Instagram channels in one post is not something this can send yet/)
  })

  it('says it once, however many there are, and leaves one channel alone', () => {
    const many = validatePost({
      caption: 'hello', media: img(1), platforms: ['tiktok', 'tiktok', 'tiktok'],
    }).filter(i => i.problem.startsWith('Two '))
    expect(many).toHaveLength(1)
    expect(validatePost({ caption: 'hello', media: img(1), platforms: ['instagram'] }))
      .toEqual([])
  })
})

describe('TikTok settings — top level, and never half sent', () => {
  it('posts publicly, with comments, duets and stitches, when nobody touches anything', () => {
    expect(tiktokSettingsFor(undefined)).toEqual(TIKTOK_DEFAULTS)
    expect(tiktokSettingsFor({}).express_consent_given).toBe(true)
    expect(tiktokSettingsFor({}).content_preview_confirmed).toBe(true)
  })

  it('carries every choice somebody made', () => {
    expect(tiktokSettingsFor({
      privacyLevel: 'SELF_ONLY', allowComment: false, allowDuet: false, allowStitch: false,
      commercialContentType: 'brand_content', videoMadeWithAi: true, tiktokDraft: true,
      autoAddMusic: false, photoCoverIndex: 2, tiktokDescription: '  words  ',
    })).toEqual({
      privacy_level: 'SELF_ONLY',
      allow_comment: false,
      allow_duet: false,
      allow_stitch: false,
      content_preview_confirmed: true,
      express_consent_given: true,
      commercial_content_type: 'brand_content',
      video_made_with_ai: true,
      draft: true,
      auto_add_music: false,
      photo_cover_index: 2,
      description: 'words',
    })
  })

  it('takes a cover PICTURE over a cover MOMENT, never both', () => {
    const both = tiktokSettingsFor({
      videoCoverImageUrl: 'https://x/c.jpg', videoCoverTimestampMs: 2000,
    })
    expect(both.video_cover_image_url).toBe('https://x/c.jpg')
    expect(both.video_cover_timestamp_ms).toBeUndefined()
    expect(tiktokSettingsFor({ videoCoverTimestampMs: 2000 }).video_cover_timestamp_ms).toBe(2000)
    // a negative or unreadable moment is no moment at all
    expect(tiktokSettingsFor({ videoCoverTimestampMs: -5 }).video_cover_timestamp_ms).toBeUndefined()
  })

  it('puts the block at the TOP LEVEL of the body, from the TikTok target', () => {
    const body = buildPostBody({
      caption: 'hi', media: vid(1), scheduledFor: null,
      targets: [
        { platform: 'instagram', accountId: 'i' },
        { platform: 'tiktok', accountId: 't', options: { privacyLevel: 'SELF_ONLY', tiktokConsent: true } },
      ],
    })
    expect(body.tiktokSettings?.privacy_level).toBe('SELF_ONLY')
    // the tick is ours, not TikTok's field name: it never travels as itself
    expect(JSON.stringify(body)).not.toContain('tiktokConsent')
    expect(body.platforms[1].platformSpecificData).toBeUndefined()
  })

  it('sends no TikTok block at all when no TikTok account is in the post', () => {
    const body = buildPostBody({
      caption: 'hi', media: img(1), scheduledFor: null,
      targets: [{ platform: 'instagram', accountId: 'i' }],
    })
    expect(body.tiktokSettings).toBeUndefined()
  })
})

describe('a YouTube cover picture rides on the media', () => {
  it('gives YouTube its own copy of the media with the thumbnail on it', () => {
    const body = buildPostBody({
      caption: 'hello', media: vid(1), scheduledFor: null,
      targets: [
        { platform: 'youtube', accountId: 'y', options: { thumbnailUrl: 'https://x/cover.jpg' } },
        { platform: 'instagram', accountId: 'i' },
      ],
    })
    expect(body.platforms[0].customMedia)
      .toEqual([{ ...vid(1)[0], thumbnail: 'https://x/cover.jpg' }])
    // everybody else keeps the shared set, untouched
    expect(body.mediaItems).toEqual(vid(1))
    expect(body.platforms[1].customMedia).toBeUndefined()
    // and it is never a setting: Zernio takes it on the media item
    expect(body.platforms[0].platformSpecificData?.thumbnailUrl).toBeUndefined()
    expect(body.platforms[0].platformSpecificData?.instagramThumbnail).toBeUndefined()
  })

  it('does not put one on a Short, which has none', () => {
    const body = buildPostBody({
      caption: 'hello', media: vid(1), scheduledFor: null,
      targets: [{
        platform: 'youtube', accountId: 'y',
        options: { kind: 'reel', thumbnailUrl: 'https://x/cover.jpg' },
      }],
    })
    expect(body.platforms[0].customMedia).toBeUndefined()
  })
})

describe('YouTube never goes out half-addressed', () => {
  it('titles the video with the first line of the caption', () => {
    expect(youtubeDefaults('A morning in the roastery\nsecond line')).toEqual({
      title: 'A morning in the roastery',
      categoryId: '22',
      madeForKids: false,
    })
  })

  it('lets a chosen title, category or visibility win over the default', () => {
    const body = buildPostBody({
      caption: 'the caption', media: vid(1), scheduledFor: null,
      targets: [{
        platform: 'youtube', accountId: 'y',
        options: { title: 'Chosen', visibility: 'private', categoryId: '10' },
      }],
    })
    expect(body.platforms[0].platformSpecificData).toEqual({
      title: 'Chosen', visibility: 'private', categoryId: '10', madeForKids: false,
    })
    // and nothing decides "who can watch" on a post where nobody did
    expect(youtubeDefaults('the caption').visibility).toBeUndefined()
  })

  it('leaves the title out rather than inventing one when there are no words', () => {
    expect(youtubeDefaults('   ').title).toBeUndefined()
  })
})

describe('what the options themselves get wrong, in plain words', () => {
  const problems = (platform: Parameters<typeof optionProblems>[0], o: Parameters<typeof optionProblems>[1],
    media?: Parameters<typeof optionProblems>[2], caption?: string) =>
    optionProblems(platform, o, media, caption ?? 'some words')

  it('refuses a Story carrying a place — Instagram refuses the post, not the field', () => {
    expect(problems('instagram', { kind: 'story', locationId: '12345678' }).join(' '))
      .toMatch(/Story with a place/)
    expect(problems('instagram', { kind: 'feed', locationId: '12345678' })).toEqual([])
  })

  it('says a Story cannot have a first comment', () => {
    expect(problems('instagram', { kind: 'story', firstComment: '#tags' }).join(' '))
      .toMatch(/no comments/)
  })

  it('names both numbers when a YouTube title is too long', () => {
    const out = problems('youtube', { title: 'x'.repeat(120) })
    expect(out.join(' ')).toContain('120')
    expect(out.join(' ')).toContain('100')
  })

  it('counts YouTube tags together, the way YouTube does', () => {
    const many = Array.from({ length: 60 }, (_, i) => `tag-number-${i}`)
    expect(problems('youtube', { title: 'ok', tags: many }).join(' '))
      .toMatch(/500 for the lot/)
    expect(problems('youtube', { title: 'ok', tags: ['coffee'] })).toEqual([])
  })

  it('asks for a YouTube title when there are no words to take one from', () => {
    expect(optionProblems('youtube', {}, [], '').join(' ')).toMatch(/needs a title/)
    expect(optionProblems('youtube', {}, [], 'some words')).toEqual([])
  })

  it('will not let a paid partnership be posted where only the account can see it', () => {
    expect(problems('tiktok', {
      tiktokConsent: true, commercialContentType: 'brand_content', privacyLevel: 'SELF_ONLY',
    }).join(' ')).toMatch(/paid partnership/)
    // …and is happy the moment either half changes
    expect(problems('tiktok', {
      tiktokConsent: true, commercialContentType: 'brand_content', privacyLevel: 'PUBLIC_TO_EVERYONE',
    })).toEqual([])
    expect(problems('tiktok', {
      tiktokConsent: true, commercialContentType: 'none', privacyLevel: 'SELF_ONLY',
    })).toEqual([])
  })

  it('holds a TikTok post until somebody has ticked the box', () => {
    expect(problems('tiktok', {}).join(' ')).toMatch(/Tick the TikTok box/)
    expect(problems('tiktok', { tiktokConsent: true })).toEqual([])
  })

  it('says when the TikTok cover is a picture the post does not have', () => {
    const three = img(3)
    expect(problems('tiktok', { tiktokConsent: true, photoCoverIndex: 4 }, three).join(' '))
      .toMatch(/cover is picture 5, and this post has 3/)
    expect(problems('tiktok', { tiktokConsent: true, photoCoverIndex: 2 }, three)).toEqual([])
  })

  it('says a Story cannot have collaborators, rather than sending them', () => {
    expect(problems('instagram', { kind: 'story', collaborators: ['acme'] }).join(' '))
      .toMatch(/Story cannot have collaborators/)
    expect(problems('instagram', { kind: 'reel', collaborators: ['acme'] })).toEqual([])
  })

  it('says when a company page is not one', () => {
    expect(problems('linkedin', { organizationUrn: '99' }).join(' '))
      .toMatch(/does not look like a company page/)
    expect(problems('linkedin', { organizationUrn: 'urn:li:organization:99' })).toEqual([])
  })

  it('mentions a LinkedIn document name only when there is no document', () => {
    expect(problems('linkedin', { documentTitle: 'Deck' }, img(1)).join(' '))
      .toMatch(/no PDF/)
    expect(problems('linkedin', { documentTitle: 'Deck' },
      [{ url: 'https://x/a.pdf', type: 'document' }])).toEqual([])
  })

  it('judges an options-blind caller on the media and the words alone', () => {
    // the ad-hoc publish endpoint knows nothing about per-network options; it
    // must not start refusing every TikTok post for a tick it never collects
    expect(validatePost({ caption: 'a', media: vid(1), platforms: ['tiktok'] })).toEqual([])
    // …while the composer's path, which DOES collect them, answers for the tick
    expect(validatePost({
      caption: 'a', media: vid(1), platforms: ['tiktok'], optionsByPlatform: {},
    }).map(i => i.problem).join(' ')).toMatch(/Tick the TikTok box/)
  })

  it('reports them through validatePost, named by channel', () => {
    const issues = validatePost({
      caption: 'hello', media: vid(1), platforms: ['tiktok'],
      optionsByPlatform: { tiktok: {} },
    })
    expect(issues.some(i => i.platform === 'tiktok' && /Tick the TikTok box/.test(i.problem)))
      .toBe(true)
  })
})
