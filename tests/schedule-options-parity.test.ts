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
  pageId: '456789',
  facebookDraft: true,
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
      const needle = Array.isArray(value) ? String(value[0]) : String(value)
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
    })
    expect(dataFor('instagram').title).toBeUndefined()
    expect(dataFor('instagram').organizationUrn).toBeUndefined()

    // YouTube
    expect(dataFor('youtube')).toMatchObject({
      title: 'The video title',
      visibility: 'unlisted',
      madeForKids: true,
      tags: ['coffee', 'melbourne'],
      categoryId: '27',
      playlistId: 'PL-abc',
      containsSyntheticMedia: true,
      firstComment: '#hashtags',
    })
    expect(dataFor('youtube').collaborators).toBeUndefined()

    // LinkedIn
    expect(dataFor('linkedin')).toMatchObject({
      organizationUrn: 'urn:li:organization:99',
      disableLinkPreview: true,
      documentTitle: 'The deck',
      firstComment: '#hashtags',
    })

    // Facebook — including the Reel title and the draft flag, which Zernio
    // nests one level down under its own key
    expect(dataFor('facebook')).toMatchObject({
      contentType: 'reel',
      pageId: '456789',
      title: 'The video title',
      facebookSettings: { draft: true },
      firstComment: '#hashtags',
      shareToFeed: true,
    })

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

  it('a channel nobody opened the options for still posts', () => {
    const targets = targetsFor(post({}), [account()])
    expect(targets[0].options).toBeUndefined()
    const body = buildPostBody({ caption: 'hello', media: [], targets, scheduledFor: null })
    expect(body.platforms[0].platformSpecificData).toBeUndefined()
  })
})
