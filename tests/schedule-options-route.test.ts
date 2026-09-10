import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { readAudioTracks, readCreatorInfo } from '../app/lib/publisher'

/**
 * WHAT EACH CHANNEL ITSELF ALLOWS.
 *
 * The four lists behind the composer's per-network options, and the one of
 * them that had been read from the wrong place: TikTok decides PER ACCOUNT
 * which privacy levels a creator may use, whether their posts take comments,
 * duets and stitches, and which disclosures they may make. Offering a
 * creator something their account forbids is a post refused hours later, on
 * the one network that also demands a consent tick — so the parsing of that
 * answer is pinned here, and the route is proved to be scoped like the rest
 * of Schedule.
 */

const h = vi.hoisted(() => ({
  user: { id: '', role: '', email: '', name: '', clerk_user_id: null } as Record<string, unknown>,
}))

vi.mock('../app/lib/authz', () => {
  class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  }
  const ORDER = ['scheduler', 'editor', 'account_manager', 'super_admin']
  const ok = (actual: string, required: string) => {
    if (actual === 'super_admin') return true
    if (required === 'client') return actual === 'client'
    if (actual === 'client') return false
    return ORDER.indexOf(actual) >= ORDER.indexOf(required)
  }
  return {
    AuthzError,
    authzErrorResponse: (e: unknown) => (e instanceof AuthzError
      ? { error: e.message, status: e.status }
      : { error: e instanceof Error ? e.message : 'error', status: 500 }),
    requireRole: async (required: string) => {
      if (!ok(String(h.user.role), required)) throw new AuthzError('Insufficient permissions', 403)
      return h.user
    },
    requireSignedIn: async () => h.user,
  }
})

const options = await import('../app/api/social/schedule/options/route')
const audio = await import('../app/api/social/schedule/audio/route')

const CLIENT = 'c1'
const AM = { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada', clerk_user_id: null }
const SCHEDULER = { id: 'u-sch', role: 'scheduler', email: 'sch@x.invalid', name: 'Sam', clerk_user_id: null }

const as = (who: typeof AM) => { Object.assign(h.user, who) }

let fake: ReturnType<typeof seedDb>

beforeEach(() => {
  process.env.PUBLISH_DRY_RUN = '1'
  fake = seedDb({
    clients: [{ id: CLIENT, name: 'Acme', timezone: 'Australia/Melbourne' }] as unknown as Row[],
    social_accounts: [
      {
        id: 'acc-tt', client_id: CLIENT, platform: 'tiktok', provider_account_id: 'prov-tt',
        name: 'Acme on TikTok', username: 'acme', avatar_url: null, active: true,
      },
      {
        id: 'acc-yt', client_id: CLIENT, platform: 'youtube', provider_account_id: 'prov-yt',
        name: 'Acme on YouTube', username: 'acme', avatar_url: null, active: true,
      },
      {
        id: 'acc-ig', client_id: CLIENT, platform: 'instagram', provider_account_id: 'prov-ig',
        name: 'Acme on Instagram', username: 'acme', avatar_url: null, active: true,
      },
    ] as unknown as Row[],
    team_users: [AM, SCHEDULER].map(u => ({
      ...u, active_status: true, employment_type: 'employee',
      timezone: 'Australia/Melbourne', client_id: null,
    })) as unknown as Row[],
    team_user_clients: [{ id: `${AM.id}__${CLIENT}`, team_user_id: AM.id, client_id: CLIENT }] as unknown as Row[],
  })
  as(SCHEDULER)
})

afterEach(() => {
  delete process.env.PUBLISH_DRY_RUN
  fake.restore()
  vi.restoreAllMocks()
})

const getAudio = (query: string) => audio.GET(
  new Request(`https://x.test/api/social/schedule/audio${query}`))
  .then(async r => ({ status: r.status, body: await r.json() as Record<string, never> }))

const get = (query: string) => options.GET(
  new Request(`https://x.test/api/social/schedule/options${query}`))
  .then(async r => ({ status: r.status, body: await r.json() as Record<string, never> }))

/**
 * THE REAL RESPONSE, VERBATIM.
 *
 * Captured live from Zernio for the owner's own TikTok account
 * (`.superpowers/…/zernio-creator-info-sample.json`, which is not in the
 * repository — so it is pasted here rather than loaded, and this file is the
 * copy the suite defends).
 *
 * The first cut of the parser read flat keys on `postingLimits` and found
 * none of them, so all three interactions came out ON for an account whose
 * own answer to every one of them is OFF. The fixture it was tested against
 * had been invented to match the parser instead of the provider, which is why
 * the suite stayed green while the parser was wrong. This is the provider's.
 */
const LIVE_CREATOR_INFO = {
  creator: {
    nickname: 'Yusuf',
    avatarUrl: 'https://p16-common-sign.tiktokcdn.com/...webp',
    isVerified: false,
    canPostMore: true,
  },
  privacyLevels: [
    { value: 'PUBLIC_TO_EVERYONE', label: 'Public To Everyone' },
    { value: 'MUTUAL_FOLLOW_FRIENDS', label: 'Mutual Follow Friends' },
    { value: 'SELF_ONLY', label: 'Self Only' },
  ],
  postingLimits: {
    maxVideoDurationSec: 3600,
    interactionSettings: {
      allow_comment: { enabled: true, required: true, default: false, label: 'Allow Comment' },
      allow_duet: { enabled: true, required: true, default: false, label: 'Allow Duet' },
      allow_stitch: { enabled: true, required: true, default: false, label: 'Allow Stitch' },
    },
  },
  commercialContentTypes: [
    { value: 'none', label: 'No Commercial Content' },
    { value: 'brand_organic', label: 'Your Brand', requires: ['is_brand_organic_post'] },
    { value: 'brand_content', label: 'Branded Content', requires: ['brand_partner_promote'] },
  ],
}

describe('reading TikTok’s creator info', () => {
  it('takes the interaction defaults from where they actually live', () => {
    // `postingLimits.interactionSettings.<field>.default`, one level deeper
    // than the first parser looked. This account says no to all three, and
    // seeding them ON would offer a creator what their own account refuses.
    expect(readCreatorInfo(LIVE_CREATOR_INFO).interactions)
      .toEqual({ allowComment: false, allowDuet: false, allowStitch: false })
  })

  it('offers only the privacy levels THIS creator may use, in plain words', () => {
    const info = readCreatorInfo(LIVE_CREATOR_INFO)
    expect(info.privacy).toEqual([
      { value: 'PUBLIC_TO_EVERYONE', label: 'Everyone' },
      { value: 'MUTUAL_FOLLOW_FRIENDS', label: 'Friends — people they follow back' },
      { value: 'SELF_ONLY', label: 'Only the account itself' },
    ])
    // the one this account is not offered is not in the menu at all —
    // offering it is a post refused hours after anybody was watching
    expect(info.privacy.map(p => p.value)).not.toContain('FOLLOWER_OF_CREATOR')
  })

  it('says which of the three may be changed at all, in TikTok’s own words', () => {
    expect(readCreatorInfo(LIVE_CREATOR_INFO).interactionRules).toEqual({
      allowComment: { enabled: true, required: true, label: 'Allow Comment' },
      allowDuet: { enabled: true, required: true, label: 'Allow Duet' },
      allowStitch: { enabled: true, required: true, label: 'Allow Stitch' },
    })
  })

  it('a setting the account has switched off is off, and stays off', () => {
    const locked = readCreatorInfo({
      ...LIVE_CREATOR_INFO,
      postingLimits: {
        maxVideoDurationSec: 60,
        interactionSettings: {
          allow_comment: { enabled: false, required: true, default: true, label: 'Allow Comment' },
          allow_duet: { enabled: true, required: true, default: true, label: 'Allow Duet' },
          allow_stitch: { enabled: true, required: false, default: true, label: 'Allow Stitch' },
        },
      },
    })
    expect(locked.interactionRules?.allowComment.enabled).toBe(false)
    expect(locked.interactions?.allowDuet).toBe(true)
    expect(locked.maxVideoDurationSec).toBe(60)
  })

  it('carries the longest video this account may post, and who it is', () => {
    const info = readCreatorInfo(LIVE_CREATOR_INFO)
    expect(info.maxVideoDurationSec).toBe(3600)
    expect(info.creator).toEqual({
      name: 'Yusuf',
      avatarUrl: 'https://p16-common-sign.tiktokcdn.com/...webp',
    })
  })

  it('offers only the disclosures this creator may make', () => {
    // `requires` (is_brand_organic_post / brand_partner_promote) is dropped on
    // purpose: the disclosure implies them, and Zernio infers them from it
    expect(readCreatorInfo(LIVE_CREATOR_INFO).commercial).toEqual([
      { value: 'none', label: 'Not a promotion' },
      { value: 'brand_organic', label: 'Promoting our own brand' },
      { value: 'brand_content', label: 'Paid partnership' },
    ])
  })

  it('says nothing rather than guessing when the answer is empty', () => {
    const nothing = readCreatorInfo({})
    expect(nothing.privacy).toEqual([])
    expect(nothing.commercial).toEqual([])
    // no limits is not "everything allowed": it is no answer, and the window
    // keeps the network's own defaults
    expect(nothing.interactions).toBeNull()
    expect(nothing.interactionRules).toBeNull()
    expect(nothing.maxVideoDurationSec).toBeNull()
    expect(nothing.creator).toBeNull()
  })

  it('still reads an older, flatter answer rather than ignoring it', () => {
    const flat = readCreatorInfo({
      creator_info: {
        privacy_levels: ['PUBLIC_TO_EVERYONE'],
        posting_limits: { comment_disabled: true, max_video_post_duration_sec: 180 },
        commercial_content_types: ['brand_content'],
      },
    })
    expect(flat.privacy).toEqual([{ value: 'PUBLIC_TO_EVERYONE', label: 'Everyone' }])
    expect(flat.interactions?.allowComment).toBe(false)
    expect(flat.maxVideoDurationSec).toBe(180)
    expect(flat.commercial).toEqual([{ value: 'brand_content', label: 'Paid partnership' }])
  })

  it('reads TikTok’s own answer to "may this account post again today"', () => {
    // the live capture says yes; an answer that is missing is NOT a yes
    expect(readCreatorInfo(LIVE_CREATOR_INFO).canPostMore).toBe(true)
    expect(readCreatorInfo({ creator: { nickname: 'x', canPostMore: false } }).canPostMore)
      .toBe(false)
    expect(readCreatorInfo({}).canPostMore).toBeNull()
  })
})

/**
 * INSTAGRAM'S AUDIO CATALOGUE.
 *
 * The id is Meta's own and cannot be invented, so what the search hands back
 * is the whole of what the window may offer. `downloadUrl` is dropped on
 * purpose: it is a preview Meta expires after about a day and a half, and a
 * post scheduled for next week would hold a dead link.
 */
describe('reading the audio catalogue', () => {
  it('reads the documented shape, music and original sounds alike', () => {
    expect(readAudioTracks({
      audio: [
        {
          audioId: '482851939985510', title: 'Summer Nights', audioType: 'music',
          durationInMs: 182000, displayArtist: 'The Example Band',
          downloadUrl: 'https://scontent.invalid/o1/v.mp4',
        },
        {
          audioId: '99', title: 'Original audio', audioType: 'original',
          durationInMs: 15000, igUsername: 'acme',
        },
      ],
    })).toEqual([
      {
        audioId: '482851939985510', title: 'Summer Nights', audioType: 'music',
        durationMs: 182000, artist: 'The Example Band',
      },
      { audioId: '99', title: 'Original audio', audioType: 'original', durationMs: 15000, artist: 'acme' },
    ])
  })

  it('drops a row with no id, and never repeats one', () => {
    expect(readAudioTracks({ audio: [{ title: 'No id' }, { audioId: 'a' }, { audioId: 'a' }] }))
      .toEqual([{ audioId: 'a', title: 'Untitled sound', audioType: 'music', durationMs: null, artist: null }])
    expect(readAudioTracks(null)).toEqual([])
  })
})

describe('the audio route', () => {
  it('hands a scheduler the catalogue for this client’s Instagram channel', async () => {
    const res = await getAudio('?accountId=acc-ig&q=summer')
    expect(res.status).toBe(200)
    expect((res.body.tracks as unknown as { audioId: string }[])[0].audioId).toBe('dry-run-audio')
    expect(res.body.needsFacebookLogin).toBe(false)
  })

  it('answers a channel that is not Instagram with an empty list, not an error', async () => {
    const res = await getAudio('?accountId=acc-yt')
    expect(res.status).toBe(200)
    expect(res.body.tracks).toEqual([])
  })

  it('is scoped exactly like the options route beside it', async () => {
    as({ id: 'u-cl', role: 'client', email: 'cl@x.invalid', name: 'Cass', clerk_user_id: null })
    expect((await getAudio('?accountId=acc-ig')).status).toBe(403)
    as({ id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Ash', clerk_user_id: null })
    expect((await getAudio('?accountId=acc-ig')).status).toBe(404)
    as(SCHEDULER)
    expect((await getAudio('')).status).toBe(400)
  })
})

describe('the options route', () => {
  it('hands an account manager of THIS client the channel’s own lists', async () => {
    as(AM)
    const res = await get('?accountId=acc-tt&mediaType=video')
    expect(res.status).toBe(200)
    expect((res.body.privacy as unknown as { value: string }[]).length).toBeGreaterThan(0)
    expect((res.body.commercial as unknown as { value: string }[]).map(c => c.value))
      .toContain('none')
    // the dry-run creator answers in the real shape — all three off, which
    // is what the window seeds its tick boxes from
    expect(res.body.interactions).toEqual({
      allowComment: false, allowDuet: false, allowStitch: false,
    })
    expect(res.body.maxVideoDurationSec).toBe(3600)
    expect((res.body.creator as unknown as { name: string }).name).toBe('Dry run creator')
    // TikTok's own yes-or-no about the rest of its 24 hours
    expect(res.body.canPostMore).toBe(true)
  })

  it('tells the window how much of the day an Instagram account has left', async () => {
    // the total is the NETWORK's, never one of ours: Meta's prose and Meta's
    // API disagree about the cap and the API is the one that refuses the post
    const res = await get('?accountId=acc-ig')
    expect(res.status).toBe(200)
    expect(res.body.quota).toEqual({ used: 1, total: 100 })
  })

  it('answers a channel with nothing of its own with empty lists, not an error', async () => {
    const res = await get('?accountId=acc-yt')
    expect(res.status).toBe(200)
    expect(res.body.privacy).toEqual([])
    expect(res.body.interactions).toBeNull()
    expect(res.body.maxVideoDurationSec).toBeNull()
    expect((res.body.playlists as unknown as unknown[]).length).toBe(1)
  })

  it('is closed to a client account, and 404s a channel that is not this person’s', async () => {
    as({ id: 'u-cl', role: 'client', email: 'cl@x.invalid', name: 'Cass', clerk_user_id: null })
    expect((await get('?accountId=acc-tt')).status).toBe(403)

    // an editor with no client of their own: the channel exists, and it is
    // not theirs to look at
    as({ id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Ash', clerk_user_id: null })
    expect((await get('?accountId=acc-tt')).status).toBe(404)
  })
})
