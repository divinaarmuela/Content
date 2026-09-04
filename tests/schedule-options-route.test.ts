import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { readCreatorInfo } from '../app/lib/publisher'

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

const get = (query: string) => options.GET(
  new Request(`https://x.test/api/social/schedule/options${query}`))
  .then(async r => ({ status: r.status, body: await r.json() as Record<string, never> }))

describe('reading TikTok’s creator info', () => {
  const real = {
    creator: { nickname: 'Acme', avatarUrl: 'https://x/a.jpg' },
    privacyLevels: ['FOLLOWER_OF_CREATOR', 'SELF_ONLY'],
    postingLimits: {
      comment_disabled: false,
      duet_disabled: true,
      stitch_disabled: true,
      max_video_post_duration_sec: 600,
    },
    commercialContentTypes: ['none', 'brand_organic'],
  }

  it('offers only the privacy levels THIS creator may use, in plain words', () => {
    const info = readCreatorInfo(real)
    expect(info.privacy).toEqual([
      { value: 'FOLLOWER_OF_CREATOR', label: 'Followers' },
      { value: 'SELF_ONLY', label: 'Only the account itself' },
    ])
    // the level a restricted account may NOT use is not offered at all —
    // offering it is a post refused hours after anybody was watching
    expect(info.privacy.map(p => p.value)).not.toContain('PUBLIC_TO_EVERYONE')
  })

  it('reads the limits as what is TURNED OFF, which is how TikTok words them', () => {
    expect(readCreatorInfo(real).interactions)
      .toEqual({ allowComment: true, allowDuet: false, allowStitch: false })
  })

  it('offers only the disclosures this creator may make', () => {
    expect(readCreatorInfo(real).commercial).toEqual([
      { value: 'none', label: 'Not a promotion' },
      { value: 'brand_organic', label: 'Promoting our own brand' },
    ])
  })

  it('says nothing rather than guessing when the answer is empty', () => {
    const nothing = readCreatorInfo({})
    expect(nothing.privacy).toEqual([])
    expect(nothing.commercial).toEqual([])
    // no limits is not "everything off": it is no answer, and the window
    // keeps the network's own defaults
    expect(nothing.interactions).toBeNull()
  })

  it('reads it through a wrapper, and reads the other spelling', () => {
    const wrapped = readCreatorInfo({
      creator_info: {
        privacy_levels: ['PUBLIC_TO_EVERYONE'],
        posting_limits: { commentDisabled: true },
        commercial_content_types: ['brand_content'],
      },
    })
    expect(wrapped.privacy).toEqual([{ value: 'PUBLIC_TO_EVERYONE', label: 'Everyone' }])
    expect(wrapped.interactions?.allowComment).toBe(false)
    expect(wrapped.commercial).toEqual([{ value: 'brand_content', label: 'Paid partnership' }])
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
    // the dry-run creator has duets turned off, which is what the window
    // seeds its tick boxes from
    expect(res.body.interactions).toEqual({
      allowComment: true, allowDuet: false, allowStitch: true,
    })
  })

  it('answers a channel with nothing of its own with empty lists, not an error', async () => {
    const res = await get('?accountId=acc-yt')
    expect(res.status).toBe(200)
    expect(res.body.privacy).toEqual([])
    expect(res.body.interactions).toBeNull()
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
