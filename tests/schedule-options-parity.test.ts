import { describe, expect, it } from 'vitest'
import {
  CHANNEL_EXTRA_KEYS, optionsFromExtras, readChannelExtras, type ChannelExtras,
} from '../app/lib/schedule-compose-core'
import { buildPostBody, type Platform, type Target } from '../app/lib/publish-core'
import { targetsFor } from '../app/lib/social-schedule'
import type { PlannedPost } from '../app/lib/social-schedule'
import type { SocialAccount } from '@/lib/db-types'

/**
 * NOTHING THE WINDOW COLLECTS IS DROPPED ON THE WAY TO ZERNIO.
 *
 * This is the bug this file exists for, and it has already happened once: the
 * composer collected a location, a first comment, collaborators and "also
 * show it in the feed", stored all four, and `targetsFor` forwarded three
 * fields and none of them. Every one of those controls silently did nothing —
 * the worst kind of feature, because the person using it believes it worked
 * and only the client's account disagrees, days later.
 *
 * So the chain is asserted end to end, for EVERY field at once rather than
 * for the fields somebody remembered:
 *
 *   what the window holds  →  what is stored  →  what the job carries
 *   →  what is in the body Zernio receives
 *
 * `CHANNEL_EXTRA_KEYS` is the list, and it is exhaustive by TYPE
 * (`Record<keyof ChannelExtras, true>`), so a new setting cannot be added
 * without appearing here.
 */

/** One of every field, with a value that survives the readers' cleaning. */
const EVERY_EXTRA: Required<Omit<ChannelExtras, 'slides'>> = {
  caption: 'Just for this channel',
  kind: 'reel',
  firstComment: '#hashtags',
  collaborators: ['acme'],
  shareToFeed: true,
  locationId: '12345678',
  trialGraduation: 'MANUAL',
  audioName: 'Our sound',
  thumbOffset: 2500,
  userTags: [{ username: 'ada', x: 0.5, y: 0.5 }],
  isAiGenerated: true,
  commentsEnabled: false,
  muteAudio: true,
  isPaidPartnership: true,
  brandedContentSponsors: ['sponsorco'],
  audio: {
    audioId: '482851939985510', title: 'Summer Nights', artist: 'The Example Band',
    audioVolume: 80, videoVolume: 40,
  },
  geoCountries: ['NZ'],
  title: 'The video title',
  visibility: 'unlisted',
  madeForKids: true,
  tags: ['coffee', 'melbourne'],
  categoryId: '27',
  playlistId: 'PL-abc',
  containsSyntheticMedia: true,
  thumbnailUrl: 'https://media.invalid/cover.jpg',
  organizationUrn: 'urn:li:organization:99',
  disableLinkPreview: true,
  documentTitle: 'The deck',
  poll: { question: 'Which one next?', options: ['Webhooks', 'SDKs'], duration: 'THREE_DAYS' },
  reshareUrl: 'https://www.linkedin.com/posts/someone_a-post-id',
  pageId: '456789',
  facebookDraft: true,
  carouselCards: [
    { link: 'https://example.invalid/one', name: 'The first', description: 'One' },
    { link: 'https://example.invalid/two', name: 'The second', description: 'Two' },
  ],
  carouselLink: 'https://example.invalid/all',
  textFormatPresetId: '123456',
  privacyLevel: 'FOLLOWER_OF_CREATOR',
  allowComment: false,
  allowDuet: false,
  allowStitch: false,
  commercialContentType: 'brand_organic',
  videoMadeWithAi: true,
  tiktokDraft: true,
  autoAddMusic: true,
  videoCoverTimestampMs: 1500,
  videoCoverImageUrl: 'https://media.invalid/cover.jpg',
  photoCoverIndex: 1,
  tiktokDescription: 'Words for the pictures',
  tiktokConsent: true,
}

/** every key the window can set, bar the media set, which is applied with the
 *  platform's own limits rather than forwarded */
const SET_BY_THE_WINDOW = CHANNEL_EXTRA_KEYS.filter(k => k !== 'slides')

/** the object-shaped extras: the one string that proves THIS field is in the
 *  body, since none of them is a bare word to search for */
const NEEDLE: Record<string, string> = {
  audio: '482851939985510',
  poll: 'Which one next?',
  carouselCards: 'https://example.invalid/one',
}

/** what the provider calls the flags, where its name differs from ours */
const SNAKE: Record<string, string> = {
  madeForKids: 'madeForKids',
  containsSyntheticMedia: 'containsSyntheticMedia',
  disableLinkPreview: 'disableLinkPreview',
  shareToFeed: 'shareToFeed',
  facebookDraft: 'draft',
  allowComment: 'allow_comment',
  allowDuet: 'allow_duet',
  allowStitch: 'allow_stitch',
  videoMadeWithAi: 'video_made_with_ai',
  tiktokDraft: 'draft',
  autoAddMusic: 'auto_add_music',
}

const account = (over: Partial<SocialAccount> = {}): SocialAccount => ({
  id: 'acc-1',
  client_id: 'c1',
  platform: 'instagram',
  provider_account_id: 'prov-1',
  name: 'Acme',
  username: 'acme',
  avatar_url: null,
  active: true,
  connected_at: null,
  ...over,
} as unknown as SocialAccount)

const post = (perChannel: Record<string, ChannelExtras>): PlannedPost => ({
  id: 'p1',
  item_id: 'i1',
  client_id: 'c1',
  caption: 'Everyone gets this',
  slides: [],
  channels: Object.keys(perChannel),
  per_channel: perChannel,
  publish_job_ids: [],
  scheduled_for: null,
  timezone: 'Australia/Melbourne',
  status: 'approved',
} as unknown as PlannedPost)

describe('every posting option the window collects reaches the job', () => {
  it('the stored blob keeps every field — nothing is read back as absent', () => {
    // what a reader drops, the window sends back as absent; the server reads
    // that as a content change and takes the client's approval with it
    const read = readChannelExtras({ ...EVERY_EXTRA, slides: [] })
    for (const key of SET_BY_THE_WINDOW) {
      expect(read[key], `dropped on the way back in: ${key}`).toEqual(EVERY_EXTRA[key])
    }
  })

  it('the options handed to the publisher carry every field', () => {
    const options = optionsFromExtras(EVERY_EXTRA) as Record<string, unknown>
    for (const key of SET_BY_THE_WINDOW) {
      expect(options[key], `dropped between the window and the publisher: ${key}`)
        .toEqual(EVERY_EXTRA[key])
    }
    // the media set is applied by whoever knows the platform's limits
    expect('slides' in options).toBe(false)
  })

  it('THE STEP THAT LOST FOUR SETTINGS: targetsFor forwards all of them', () => {
    const targets = targetsFor(post({ 'acc-1': { ...EVERY_EXTRA } }), [account()])
    expect(targets).toHaveLength(1)
    const options = (targets[0].options ?? {}) as Record<string, unknown>
    for (const key of SET_BY_THE_WINDOW) {
      expect(options[key], `dropped on the way to the provider: ${key}`)
        .toEqual(EVERY_EXTRA[key])
    }
  })

  /**
   * Where each field is allowed to end up, and the three that end up nowhere.
   *
   * The allowlist is the point: a field added to `ChannelExtras` and
   * forwarded by `targetsFor` but never given a line in `toPlatformData` or
   * `tiktokSettingsFor` would otherwise pass every test above and reach
   * Zernio as nothing — the failure this file exists to prevent, moved one
   * step later. Anything not named here has to appear in the body somewhere.
   */
  const NEVER_IN_THE_BODY: Record<string, string> = {
    // the post type is not a field; it becomes `contentType`, or the media
    // itself decides
    kind: 'becomes contentType, or nothing the provider needs to be told',
    // this channel's own words travel as `customContent`, checked separately
    caption: 'travels as customContent',
    // the tick is what the two consent flags ASSERT; it never travels itself
    tiktokConsent: 'asserted by content_preview_confirmed / express_consent_given',
    // a cover PICTURE and a cover MOMENT are mutually exclusive, so this run
    // sends the moment; the picture has its own test above
    videoCoverImageUrl: 'the picture beats the moment — one of the two travels',
    // …and the five that CANNOT travel with media on the post. This body has
    // a video in it, so each of them is dropped on purpose — the network
    // refuses the combination rather than ignoring the field. The two tests
    // below build the bodies where they do travel.
    poll: 'LinkedIn refuses a poll with media — proved on the no-media body below',
    reshareUrl: 'LinkedIn refuses a repost with media — proved on the no-media body below',
    carouselCards: 'one card per PICTURE, and this body is a video — proved below',
    carouselLink: 'only travels with the cards',
    textFormatPresetId: 'text-only posts — proved on the text-only body below',
  }

  it('every field ends up in the body somewhere, or is named as one that does not', () => {
    const targets: Target[] = ['instagram', 'youtube', 'linkedin', 'facebook', 'tiktok']
      .map((platform, i) => targetsFor(
        post({
          [`acc-${i}`]: {
            ...EVERY_EXTRA,
            kind: platform === 'youtube' ? 'feed' : 'reel',
            videoCoverImageUrl: undefined,
          },
        }),
        [account({ id: `acc-${i}`, platform, provider_account_id: `prov-${i}` })],
      )[0])
    const body = buildPostBody({
      caption: 'Everyone gets this', media: [{ url: 'https://media.invalid/a.mp4', type: 'video' }],
      targets, scheduledFor: null,
    })
    const wire = JSON.stringify(body)

    for (const key of SET_BY_THE_WINDOW) {
      if (NEVER_IN_THE_BODY[key]) continue
      const value = EVERY_EXTRA[key]
      const first = Array.isArray(value) ? value[0] : value
      const needle = NEEDLE[key]
        ?? (first && typeof first === 'object'
          ? String((first as { username: string }).username)
          : String(first))
      // a boolean's own word is too common to search for, so those are found
      // by the provider's name for them instead
      const found = typeof value === 'boolean'
        ? new RegExp(`"(${key}|${SNAKE[key] ?? key})"`).test(wire)
        : wire.includes(needle)
      expect(found, `${key} reaches Zernio as nothing`).toBe(true)
    }
  })

  it('and each one lands where that network takes it, or nowhere', () => {
    const targets: Target[] = ['instagram', 'youtube', 'linkedin', 'facebook', 'tiktok']
      .map((platform, i) => targetsFor(
        post({ [`acc-${i}`]: { ...EVERY_EXTRA } }),
        [account({ id: `acc-${i}`, platform, provider_account_id: `prov-${i}` }) ],
      )[0])
    const body = buildPostBody({
      caption: 'Everyone gets this', media: [], targets, scheduledFor: null,
    })
    const dataFor = (p: Platform) =>
      (body.platforms.find(x => x.platform === p)?.platformSpecificData ?? {}) as Record<string, unknown>

    // Instagram: its own four, and none of YouTube's or LinkedIn's
    expect(dataFor('instagram')).toMatchObject({
      shareToFeed: true,
      firstComment: '#hashtags',
      collaborators: ['acme'],
      locationId: '12345678',
      trialParams: { graduationStrategy: 'MANUAL' },
      audioName: 'Our sound',
      thumbOffset: 2500,
      userTags: [{ username: 'ada' }],
      isAiGenerated: true,
      commentsEnabled: false,
      muteAudio: true,
      isPaidPartnership: true,
      brandedContentSponsors: ['sponsorco'],
      // the catalogue track, which only Instagram has and only on a Reel
      audioConfiguration: { audioId: '482851939985510', audioVolume: 80, videoVolume: 40 },
    })
    expect(dataFor('instagram').title).toBeUndefined()
    expect(dataFor('instagram').organizationUrn).toBeUndefined()

    // YouTube
    expect(dataFor('youtube')).toMatchObject({
      title: 'The video title',
      visibility: 'unlisted',
      madeForKids: true,
      categoryId: '27',
      playlistId: 'PL-abc',
      containsSyntheticMedia: true,
      firstComment: '#hashtags',
    })
    expect(dataFor('youtube').collaborators).toBeUndefined()

    // LinkedIn — the poll and the repost, both of which this body can carry
    // because it has no media on it
    expect(dataFor('linkedin')).toMatchObject({
      organizationUrn: 'urn:li:organization:99',
      disableLinkPreview: true,
      documentTitle: 'The deck',
      firstComment: '#hashtags',
      geoRestriction: { countries: ['NZ'] },
      poll: {
        question: 'Which one next?', options: ['Webhooks', 'SDKs'], duration: 'THREE_DAYS',
      },
      reshareUrl: 'https://www.linkedin.com/posts/someone_a-post-id',
    })
    // …and neither of them anywhere else
    expect(dataFor('instagram').poll).toBeUndefined()
    expect(dataFor('facebook').reshareUrl).toBeUndefined()

    // Facebook — including the Reel title and the draft flag, which Zernio
    // nests one level down under its own key
    expect(dataFor('facebook')).toMatchObject({
      contentType: 'reel',
      pageId: '456789',
      title: 'The video title',
      // ONE `facebookSettings` OBJECT, not three that overwrite each other
      facebookSettings: {
        draft: true,
        carouselCards: [
          { link: 'https://example.invalid/one', name: 'The first', description: 'One' },
          { link: 'https://example.invalid/two', name: 'The second', description: 'Two' },
        ],
        carouselLink: 'https://example.invalid/all',
      },
      firstComment: '#hashtags',
      geoRestriction: { countries: ['NZ'] },
    })
    // the background and the cards cannot both be on one post; the cards win
    // because they are the ones with pictures behind them
    expect((dataFor('facebook').facebookSettings as Record<string, unknown>).textFormatPresetId)
      .toBeUndefined()
    // Facebook's guide has no shareToFeed and no thumbOffset (10 Sep 2026)
    expect(dataFor('facebook').shareToFeed).toBeUndefined()
    expect(dataFor('facebook').thumbOffset).toBeUndefined()

    // TikTok: nothing in platformSpecificData at all — every one of its
    // settings is TOP LEVEL, which is Zernio's one special case
    expect(body.platforms.find(x => x.platform === 'tiktok')?.platformSpecificData)
      .toBeUndefined()
    expect(body.tiktokSettings).toEqual({
      privacy_level: 'FOLLOWER_OF_CREATOR',
      allow_comment: false,
      allow_duet: false,
      allow_stitch: false,
      content_preview_confirmed: true,
      express_consent_given: true,
      commercial_content_type: 'brand_organic',
      video_made_with_ai: true,
      draft: true,
      auto_add_music: true,
      // a cover PICTURE beats a cover MOMENT; sending both is ambiguous
      video_cover_image_url: 'https://media.invalid/cover.jpg',
      photo_cover_index: 1,
      description: 'Words for the pictures',
    })
  })

  it('the big-text background travels on a post with no media and no cards', () => {
    // the one combination Facebook takes it in: words, and nothing else
    const target = targetsFor(
      post({ 'acc-fb': { textFormatPresetId: '123456' } }),
      [account({ id: 'acc-fb', platform: 'facebook', provider_account_id: 'prov-fb' })],
    )[0]
    const body = buildPostBody({
      caption: 'Words on a colour', media: [], targets: [target], scheduledFor: null,
    })
    expect(body.platforms[0].platformSpecificData)
      .toMatchObject({ facebookSettings: { textFormatPresetId: '123456' } })
  })

  it('none of the three survives media being attached', () => {
    // a poll, a repost and a background are all refused OUTRIGHT by the
    // network once there is a file on the post — so they are dropped rather
    // than sent to fail hours later
    const targets = [
      targetsFor(
        post({ 'acc-li': { poll: { question: 'Which?', options: ['A', 'B'] }, reshareUrl: 'https://www.linkedin.com/posts/x_y' } }),
        [account({ id: 'acc-li', platform: 'linkedin', provider_account_id: 'prov-li' })],
      )[0],
      targetsFor(
        post({ 'acc-fb': { textFormatPresetId: '123456' } }),
        [account({ id: 'acc-fb', platform: 'facebook', provider_account_id: 'prov-fb' })],
      )[0],
    ]
    const body = buildPostBody({
      caption: 'With a picture on it',
      media: [{ url: 'https://media.invalid/a.jpg', type: 'image' }],
      targets, scheduledFor: null,
    })
    expect(JSON.stringify(body)).not.toContain('poll')
    expect(JSON.stringify(body)).not.toContain('reshareUrl')
    expect(JSON.stringify(body)).not.toContain('textFormatPresetId')
  })

  it('a carousel card set that no longer matches the pictures is not sent', () => {
    const cards = [
      { link: 'https://example.invalid/one' },
      { link: 'https://example.invalid/two' },
    ]
    const target = (media: { url: string; type: 'image' | 'video' }[]) => buildPostBody({
      caption: 'Two links',
      media,
      targets: targetsFor(
        post({ 'acc-fb': { carouselCards: cards } }),
        [account({ id: 'acc-fb', platform: 'facebook', provider_account_id: 'prov-fb' })],
      ),
      scheduledFor: null,
    }).platforms[0].platformSpecificData as Record<string, unknown> | undefined
    // two pictures, two cards
    expect(target([
      { url: 'https://media.invalid/1.jpg', type: 'image' },
      { url: 'https://media.invalid/2.jpg', type: 'image' },
    ])?.facebookSettings).toMatchObject({ carouselCards: cards })
    // one picture, two cards — Facebook answers that with a 400
    expect(JSON.stringify(target([{ url: 'https://media.invalid/1.jpg', type: 'image' }]) ?? {}))
      .not.toContain('carouselCards')
  })

  // 9 Sep 2026: the editor's cover reached Instagram and YouTube as
  // `thumbnailUrl` and TikTok, which takes it under another name, got none
  it('the editor cover reaches TikTok as its own cover field, unless TikTok was given one', () => {
    const VIDEO = 'https://media.invalid/a.mp4'
    const COVER = 'https://media.invalid/cover.jpg'
    const withSlides = { ...post({}), slides: [{ url: VIDEO, type: 'video' }], channels: ['acc-tt'], per_channel: {} } as unknown as PlannedPost
    const versions = [{ id: 'v1', version_number: 1, file_url: VIDEO, cover_url: COVER, files: null }] as unknown as Parameters<typeof targetsFor>[2]
    const tt = targetsFor(withSlides, [account({ id: 'acc-tt', platform: 'tiktok', provider_account_id: 'prov-tt' })], versions)[0]
    expect(tt.options).toMatchObject({ thumbnailUrl: COVER, videoCoverImageUrl: COVER })
    const own = { ...withSlides, per_channel: { 'acc-tt': { videoCoverImageUrl: 'https://media.invalid/mine.jpg' } } } as unknown as PlannedPost
    const ttOwn = targetsFor(own, [account({ id: 'acc-tt', platform: 'tiktok', provider_account_id: 'prov-tt' })], versions)[0]
    expect(ttOwn.options?.videoCoverImageUrl).toBe('https://media.invalid/mine.jpg')
    // and the body carries it where TikTok reads it
    const body = buildPostBody({ caption: 'x', media: [{ url: VIDEO, type: 'video' }], targets: [tt], scheduledFor: null })
    expect((body as { tiktokSettings?: { video_cover_image_url?: string } }).tiktokSettings?.video_cover_image_url).toBe(COVER)
  })

  it('a channel nobody opened the options for still posts', () => {
    const targets = targetsFor(post({}), [account()])
    expect(targets[0].options).toBeUndefined()
    const body = buildPostBody({ caption: 'hello', media: [], targets, scheduledFor: null })
    expect(body.platforms[0].platformSpecificData).toBeUndefined()
  })
})
