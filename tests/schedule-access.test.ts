import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RIGHT_LABEL, accessSummary, accountHealthWords, healthBlocksPosting,
  lastCheckedWords, mayChangeAccess, mayChangeProfile, peopleWithAccess,
  profileMappingWords, readProfiles, rightsForRole, rightsWords,
} from '@/app/lib/social-access-core'
import { channelBlockReason } from '@/app/lib/social-schedule-core'
import { TEAM_ROLES, mayPublish, type Role } from '@/app/lib/identity-core'
import { mayApprovePost, maySendPostApproval } from '@/app/lib/posting-approval-core'
import { actingRoles } from '@/app/lib/workflow-core'

/**
 * THE ACCESS PAGE'S WORDS, AND THE PROVIDER REQUESTS BEHIND ITS ONE WRITE.
 *
 * The page describes a permission model rather than owning one, so the thing
 * worth testing is that the description cannot drift from the model: an
 * editor listed as "Can post" would be a page telling somebody they may do
 * something the server will refuse.
 *
 * The provider requests are pinned by shape because they are unverifiable
 * from here — nothing in this suite may touch the owner's real account — and
 * a silently wrong URL would move somebody's Instagram into the wrong group.
 */

describe('what a person may do, in the words on the chips', () => {
  it('an account manager plans, approves and posts', () => {
    expect(rightsForRole('account_manager')).toEqual(['plan', 'approve', 'post'])
    expect(rightsWords('account_manager')).toEqual(['Can plan', 'Can approve', 'Can post'])
  })

  it('a super admin can do everything', () => {
    expect(rightsForRole('super_admin')).toEqual(['plan', 'approve', 'post'])
  })

  it('a scheduler plans and posts but never approves', () => {
    expect(rightsForRole('scheduler')).toEqual(['plan', 'post'])
    expect(rightsForRole('scheduler')).not.toContain('approve')
  })

  it('an editor drafts and nothing else — the trap this page must not fall into', () => {
    // an editor sits ABOVE a scheduler in the role ladder because they do more
    // of the work, which is exactly why posting is a named set and not a rung
    expect(rightsForRole('editor')).toEqual(['plan'])
    expect(rightsWords('editor')).toEqual([RIGHT_LABEL.plan])
  })

  it('a client has no rights on this page at all', () => {
    expect(rightsForRole('client')).toEqual([])
    expect(rightsForRole('nonsense')).toEqual([])
  })

  it('every role gets a sentence, and none of them is a raw enum', () => {
    for (const role of ['super_admin', 'account_manager', 'scheduler', 'editor', 'client']) {
      const words = accessSummary(role)
      expect(words.length).toBeGreaterThan(20)
      expect(words).not.toContain('_')
    }
  })

  /**
   * THE DRIFT THIS PREVENTS.
   *
   * The chips used to be a hand-written table that happened to agree with the
   * server. Change `MAY_PUBLISH` or `mayApprovePost` tomorrow and the page
   * would carry on telling the team who can post, wrongly, with every test
   * still green. So the page asks the same three functions the server does,
   * and this walks every role to prove it — including roles added later.
   */
  it('says exactly what the rules say, for every role there is', () => {
    for (const role of [...TEAM_ROLES, 'client', 'made_up'] as string[]) {
      const rights = rightsForRole(role)
      if (!(TEAM_ROLES as readonly string[]).includes(role)) {
        expect(rights, role).toEqual([])
        continue
      }
      // the hats this person wears on a piece of this client that nobody has
      // been handed — which is what a page about a CLIENT describes
      const hats = actingRoles(
        { id: 'whoever', role: role as Role },
        { owner_id: null, scheduler_ids: [] },
      )
      expect(rights.includes('plan'), `${role} plan`).toBe(maySendPostApproval(hats))
      expect(rights.includes('approve'), `${role} approve`).toBe(mayApprovePost(hats))
      expect(rights.includes('post'), `${role} post`).toBe(mayPublish(role))
    }
  })

  it('only a super admin changes who is on a client — the same rule the route enforces', () => {
    expect(mayChangeAccess('super_admin')).toBe(true)
    expect(mayChangeAccess('account_manager')).toBe(false)
    expect(mayChangeProfile('account_manager')).toBe(true)
    expect(mayChangeProfile('scheduler')).toBe(false)
  })
})

describe('the people list, straight from team_user_clients', () => {
  const users = [
    { id: 'u1', name: 'Zoe Editor', email: 'zoe@example.invalid', role: 'editor', active_status: true },
    { id: 'u2', name: 'Al Manager', email: 'al@example.invalid', role: 'account_manager', active_status: true },
    { id: 'u3', name: 'Sam Scheduler', email: 'sam@example.invalid', role: 'scheduler', active_status: true },
    { id: 'u4', name: 'Gone Person', email: 'gone@example.invalid', role: 'editor', active_status: false },
  ]

  it('lists whoever the link rows say, with their rights spelled out', () => {
    const people = peopleWithAccess(
      [{ team_user_id: 'u1' }, { team_user_id: 'u2' }, { team_user_id: 'u3' }], users)
    expect(people.map(p => p.name)).toEqual(['Al Manager', 'Sam Scheduler', 'Zoe Editor'])
    expect(people[0].rights).toContain('Can approve')
    expect(people[2].rights).toEqual(['Can plan'])
    expect(people[0].roleLabel).toBe('Account manager')
  })

  it('drops a link whose person has left or was switched off', () => {
    const people = peopleWithAccess(
      [{ team_user_id: 'u4' }, { team_user_id: 'ghost' }], users)
    expect(people).toEqual([])
  })

  it('a person linked twice appears once', () => {
    const people = peopleWithAccess(
      [{ team_user_id: 'u2' }, { team_user_id: 'u2' }], users)
    expect(people).toHaveLength(1)
  })

  it('carries when they were put on the client, where the row knows', () => {
    const people = peopleWithAccess(
      [{ team_user_id: 'u2', assigned_at: '2026-08-01T00:00:00.000Z' }], users)
    expect(people[0].assignedAt).toBe('2026-08-01T00:00:00.000Z')
  })
})

describe('how an account is doing, in three states and no more', () => {
  const now = Date.parse('2026-09-04T00:00:00.000Z')

  it('a token the provider calls dead is expired, and says what stops working', () => {
    const w = accountHealthWords({ valid: false }, now)
    expect(w.state).toBe('expired')
    expect(w.label).toBe('Expired')
    expect(w.needsReconnect).toBe(true)
    expect(w.detail).toMatch(/will not go out/i)
  })

  it('a token that cannot renew itself, and does not claim to, needs reconnecting', () => {
    // no status word and no "Auto-refreshes": nothing here says anybody is
    // renewing it, so the flat `needsRefresh` is taken at its word
    const w = accountHealthWords({ valid: true, needsRefresh: true }, now)
    expect(w.state).toBe('reconnect')
    expect(w.needsReconnect).toBe(true)
  })

  it('a self-renewing token is connected and asks for nothing', () => {
    const w = accountHealthWords(
      { valid: true, expiresIn: 'Auto-refreshes', expiresAt: '2026-09-05T00:00:00.000Z' }, now)
    expect(w.state).toBe('connected')
    expect(w.needsReconnect).toBe(false)
    expect(w.detail).toMatch(/Renewing its login on its own/i)
  })

  it('one expiring inside the fortnight is flagged before it bites', () => {
    const w = accountHealthWords(
      { valid: true, expiresAt: '2026-09-12T00:00:00.000Z', expiresIn: 'in 8 days' }, now)
    expect(w.state).toBe('reconnect')
    expect(w.detail).toMatch(/8 days left/)
  })

  /**
   * An account we could not reach used to wear the green "Connected" badge
   * with a line of grey small print underneath. So a provider outage sitting
   * on top of a token that expired yesterday read as everything being fine,
   * and a week of posts got queued against a channel that would refuse every
   * one of them. Not knowing is its own answer.
   */
  it('an account we could not check is not reported as fine either', () => {
    const w = accountHealthWords(null, now)
    expect(w.state).toBe('unknown')
    expect(w.label).toBe('Not checked')
    expect(w.state).not.toBe('connected')
    expect(w.needsReconnect).toBe(false)
    expect(w.detail).toMatch(/cannot say whether it is working/i)
    expect(w.detail).toMatch(/Check them/)
  })

  it('only a real answer from the provider earns the green badge', () => {
    for (const status of [null, undefined]) {
      expect(accountHealthWords(status, now).state).not.toBe('connected')
    }
    expect(accountHealthWords({ valid: true, expiresIn: 'Auto-refreshes' }, now).state)
      .toBe('connected')
  })

  /**
   * The neighbouring hole to the one above: a reply that ARRIVED but says
   * nothing we can read. `{}`, a `valid` that is a word rather than a yes or
   * no, an `expiresAt` that is not a date — every one of them used to fall
   * through to the bottom of the function and come out green, which is the
   * same lie by a different road.
   */
  it('a reply we cannot read is not an answer, and is never green', () => {
    const unreadable: unknown[] = [
      {},                                  // arrived, said nothing
      { valid: 'expired' },                // a word where a yes/no belongs
      { valid: 1 },
      { needsRefresh: 'yes' },
      { expiresAt: 'soon' },               // not a date
      { expiresAt: 42 },
      { expiresIn: { days: 3 } },
    ]
    for (const status of unreadable) {
      const w = accountHealthWords(status as never, now)
      expect(w.state, JSON.stringify(status)).toBe('unknown')
      expect(w.label).toBe('Not checked')
      expect(w.needsReconnect).toBe(false)
    }
  })

  it('still reads the answers that ARE readable', () => {
    expect(accountHealthWords({ valid: false }, now).state).toBe('expired')
    expect(accountHealthWords({ needsRefresh: true }, now).state).toBe('reconnect')
    expect(accountHealthWords(
      { valid: true, expiresAt: new Date(now + 400 * 86_400_000).toISOString() }, now,
    ).state).toBe('connected')
  })

  it('says when we last asked, not when the account was connected', () => {
    expect(lastCheckedWords(new Date(now).toISOString(), now)).toBe('Checked just now')
    expect(lastCheckedWords(new Date(now - 4 * 60000).toISOString(), now))
      .toBe('Checked 4 minutes ago')
    expect(lastCheckedWords(new Date(now - 3 * 3600_000).toISOString(), now))
      .toBe('Checked 3 hours ago')
    expect(lastCheckedWords(null, now)).toBe('Not checked yet')
  })
})

describe('the client’s group of accounts at the posting service', () => {
  it('reads the list whichever shape it arrives in', () => {
    const wanted = [{ id: 'p1', name: 'Stretchworks', accountCount: 2 }]
    expect(readProfiles([{ _id: 'p1', name: 'Stretchworks', accounts: [1, 2] }])).toEqual(wanted)
    expect(readProfiles({ profiles: [{ id: 'p1', name: 'Stretchworks', accountCount: 2 }] }))
      .toEqual(wanted)
    expect(readProfiles({ data: [{ _id: 'p1', title: 'Stretchworks', accounts_count: 2 }] }))
      .toEqual(wanted)
  })

  it('drops a row with no id rather than offering an unusable choice', () => {
    expect(readProfiles([{ name: 'Nameless' }])).toEqual([])
  })

  it('a client in no group is told what that risks, in plain words', () => {
    const words = profileMappingWords({ clientName: 'Acme', profile: null, strayCount: 0 })
    expect(words.title).toMatch(/not in a group/i)
    expect(words.detail).toMatch(/somebody else/i)
    expect(words.action).toBe('Choose a group')
  })

  it('accounts left behind in another group are counted and named as a job', () => {
    const words = profileMappingWords({
      clientName: 'Acme',
      profile: { id: 'p1', name: 'Acme', accountCount: 3 },
      strayCount: 2,
    })
    expect(words.detail).toMatch(/2 of this client’s accounts are still in another group/)
    expect(words.action).toBe('Move them across')
  })

  it('a tidy client says so and offers only a change', () => {
    const words = profileMappingWords({
      clientName: 'Acme', profile: { id: 'p1', name: 'Acme', accountCount: 3 }, strayCount: 0,
    })
    expect(words.title).toBe('Acme')
    expect(words.detail).toMatch(/Every account for Acme is in this group/)
  })
})

/**
 * The three provider calls, with the network taken out.
 *
 * PUBLISH_DRY_RUN is set for these the way it is for publishing: the thing
 * that must never happen — this suite reaching into the owner's real Zernio
 * account and moving accounts between groups — is prevented from the inside
 * rather than remembered by each test.
 */
describe('the provider requests, pinned by shape', () => {
  const OLD = { ...process.env }
  beforeEach(() => {
    vi.resetModules()
    process.env.ZERNIO_API_URL = 'https://zernio.invalid/api/v1'
    process.env.ZERNIO_API_KEY = 'test-key'
    process.env.PUBLISH_DRY_RUN = '1'
  })
  afterEach(() => {
    process.env = { ...OLD }
    vi.restoreAllMocks()
  })

  it('lists the groups from /profiles', async () => {
    const { profilesListRequest } = await import('@/app/lib/zernio-profiles')
    expect(profilesListRequest()).toEqual({
      url: 'https://zernio.invalid/api/v1/profiles', method: 'GET', body: null,
    })
  })

  it('makes one with a name', async () => {
    const { profileCreateRequest } = await import('@/app/lib/zernio-profiles')
    expect(profileCreateRequest('  Acme  ')).toEqual({
      url: 'https://zernio.invalid/api/v1/profiles',
      method: 'POST',
      body: { name: 'Acme' },
    })
  })

  it('moves an account by PATCHing it with the group it belongs in', async () => {
    const { accountMoveRequest } = await import('@/app/lib/zernio-profiles')
    // Zernio's docs: "PATCH /v1/accounts/{accountId} … moves the social
    // account only", which is exactly what a social account needs
    expect(accountMoveRequest('acct 1', 'p1')).toEqual({
      url: 'https://zernio.invalid/api/v1/accounts/acct%201',
      method: 'PATCH',
      body: { profileId: 'p1' },
    })
  })

  it('the dry run opens no socket at all', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const mod = await import('@/app/lib/zernio-profiles')
    const profiles = await mod.listProfiles()
    expect(profiles.length).toBeGreaterThan(0)
    const made = await mod.createProfile('Acme')
    expect(made.name).toBe('Acme')
    await mod.moveAccountToProfile('a1', 'p1')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a move that half-works says which accounts did not, by name', async () => {
    vi.resetModules()
    process.env.PUBLISH_DRY_RUN = '0'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const ok = String(url).includes('good')
      return new Response(JSON.stringify(ok ? {} : { error: 'It is in another user’s account' }), {
        status: ok ? 200 : 409,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const { moveAccountsToProfile } = await import('@/app/lib/zernio-profiles')
    const out = await moveAccountsToProfile([
      { providerAccountId: 'good1', name: '@acme' },
      { providerAccountId: 'bad1', name: '@acme_shop' },
    ], 'p1')
    expect(out.moved).toEqual(['@acme'])
    expect(out.failed).toEqual([{ name: '@acme_shop', why: 'It is in another user’s account' }])
  })

  /**
   * Group names are unique per workspace. Pressing "Make one called
   * 'Stretchworks'" for a client whose group somebody already made by hand is
   * the same intention arriving twice, not an error, and the right answer is
   * the group that exists.
   */
  it('adopts the group that already has the name instead of failing', async () => {
    vi.resetModules()
    process.env.PUBLISH_DRY_RUN = '0'
    const seen: { key: string | null; body: unknown }[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init: any = {}) => {
      seen.push({
        key: new Headers(init.headers).get('Idempotency-Key'),
        body: JSON.parse(init.body),
      })
      return new Response(JSON.stringify({
        error: 'A profile with that name already exists',
        details: { existingProfileId: 'p-existing' },
      }), { status: 409, headers: { 'Content-Type': 'application/json' } })
    })
    const { createProfile, idempotencyKey } = await import('@/app/lib/zernio-profiles')
    const made = await createProfile('Stretchworks')
    expect(made.id).toBe('p-existing')
    expect(made.name).toBe('Stretchworks')
    // and a retry of the same intention carries the same key, so the provider
    // can replay it rather than race it into that 409 in the first place
    expect(seen[0].key).toBe(idempotencyKey('profile', 'Stretchworks'))
    expect(idempotencyKey('profile', 'Stretchworks'))
      .toBe(idempotencyKey('profile', ' stretchworks '))
    expect(idempotencyKey('profile', 'Stretchworks'))
      .not.toBe(idempotencyKey('profile', 'Acme'))
  })

  it('still surfaces a 409 it cannot make sense of', async () => {
    vi.resetModules()
    process.env.PUBLISH_DRY_RUN = '0'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ error: 'Nope' }), {
        status: 409, headers: { 'Content-Type': 'application/json' },
      }))
    const { createProfile } = await import('@/app/lib/zernio-profiles')
    await expect(createProfile('Acme')).rejects.toThrow('Nope')
  })

  /**
   * The reference page documents the endpoint but not the body key, and a
   * wrong key would answer 200 and move nothing — a card reporting "all in
   * this group now" about accounts that never moved is the exact failure this
   * whole feature exists to prevent. So the 200 is not believed.
   */
  it('does not believe a 200: it reads the group back', async () => {
    vi.resetModules()
    process.env.PUBLISH_DRY_RUN = '0'
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const { moveAccountsToProfile } = await import('@/app/lib/zernio-profiles')

    const out = await moveAccountsToProfile(
      [{ providerAccountId: 'a1', name: '@acme' }, { providerAccountId: 'a2', name: '@acme_shop' }],
      'p1',
      // the provider says yes to both and only one actually moved
      async () => ['a1', 'other-account'],
    )
    expect(out.moved).toEqual(['@acme'])
    expect(out.failed).toEqual([
      { name: '@acme_shop', why: 'the posting service said yes but the account is still in its old group' },
    ])
  })

  it('reports what the calls said when there is nothing to check against', async () => {
    vi.resetModules()
    process.env.PUBLISH_DRY_RUN = '1'
    const { moveAccountsToProfile } = await import('@/app/lib/zernio-profiles')
    const out = await moveAccountsToProfile(
      [{ providerAccountId: 'a1', name: '@acme' }], 'p1', async () => null)
    expect(out.moved).toEqual(['@acme'])
    expect(out.failed).toEqual([])
  })

  it('refuses to make a group with no name', async () => {
    vi.resetModules()
    process.env.PUBLISH_DRY_RUN = '1'
    const { createProfile } = await import('@/app/lib/zernio-profiles')
    await expect(createProfile('   ')).rejects.toThrow(/name/i)
  })
})

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * A RENEWING LOGIN IS CONNECTED, NOT BROKEN.
 *
 * These four payloads are the shape the posting service really answers with.
 * The first two are VERBATIM from a live check of the owner's own accounts
 * (`.superpowers/sdd/2026-09-03-social-schedule/zernio-health-samples.json`,
 * 4 Sep 2026) — a client's TikTok and a YouTube channel, both working, both of
 * which the page badged "Needs reconnecting — the provider can no longer renew
 * this on its own". Every field in them says the opposite: the token is valid,
 * it can post, nothing is missing, and the provider says in writing that it is
 * refreshing the login itself.
 *
 * They are pasted rather than paraphrased on purpose. A paraphrase of a
 * payload is a guess about a payload, and the guess is what got this wrong.
 */
describe('the posting service’s own health payload', () => {
  const now = Date.parse('2026-09-04T02:00:00.000Z')

  const YOUTUBE_WARNING = {
    accountId: '6a94d2ba77555aae0127560e',
    platform: 'youtube',
    username: 'akmalashwin',
    displayName: 'lxuuryy',
    status: 'warning',
    tokenStatus: {
      valid: true,
      expiresAt: '2026-09-04T03:50:03.155Z',
      expiresIn: 'Auto-refreshes',
      needsRefresh: true,
    },
    permissions: {
      canPost: true, canFetchAnalytics: true, analyticsSupported: true,
      missingRequired: [],
    },
    issues: ['Token expired or expiring soon (auto-refresh pending)'],
    recommendations: ['Token is being auto-refreshed. API calls may briefly fail until refresh completes.'],
  }

  const TIKTOK_WARNING = {
    accountId: '6a94d22f77555aae01271b2c',
    platform: 'tiktok',
    username: 'yusufuryurr',
    displayName: 'Yusuf',
    status: 'warning',
    tokenStatus: {
      valid: true,
      expiresAt: '2026-09-04T06:29:19.791Z',
      expiresIn: 'Auto-refreshes',
      needsRefresh: true,
    },
    permissions: {
      canPost: true, canFetchAnalytics: true, analyticsSupported: true,
      missingRequired: [],
    },
    issues: ['Token expired or expiring soon (auto-refresh pending)'],
    recommendations: ['Token is being auto-refreshed. API calls may briefly fail until refresh completes.'],
  }

  /** the same shape, but genuinely broken */
  const ERROR_PAYLOAD = {
    accountId: '6a94d22f77555aae01271b2d',
    platform: 'instagram',
    username: 'acme',
    status: 'error',
    tokenStatus: {
      valid: false,
      expiresAt: '2026-08-20T00:00:00.000Z',
      expiresIn: 'expired',
      needsRefresh: true,
    },
    permissions: {
      canPost: false, canFetchAnalytics: false, analyticsSupported: true,
      missingRequired: [],
    },
    issues: ['Token is invalid or has been revoked'],
  }

  /** valid, live, and still unable to do the job */
  const MISSING_PERMISSION = {
    accountId: '6a94d22f77555aae01271b2e',
    platform: 'facebook',
    username: 'acme',
    status: 'error',
    tokenStatus: {
      valid: true,
      expiresAt: '2026-12-01T00:00:00.000Z',
      expiresIn: 'in 88 days',
      needsRefresh: false,
    },
    permissions: {
      canPost: true, canFetchAnalytics: true, analyticsSupported: true,
      missingRequired: ['pages_manage_posts', 'made_up_scope'],
    },
    issues: ['Missing required permissions'],
  }

  const HEALTHY = {
    accountId: '6a94d22f77555aae01271b2f',
    platform: 'linkedin',
    status: 'healthy',
    tokenStatus: {
      valid: true,
      expiresAt: '2027-01-01T00:00:00.000Z',
      expiresIn: 'in 119 days',
      needsRefresh: false,
    },
    permissions: {
      canPost: true, canFetchAnalytics: true, analyticsSupported: true,
      missingRequired: [],
    },
    issues: [],
  }

  it('reads the two real "warning" accounts as CONNECTED, and says why', () => {
    for (const sample of [YOUTUBE_WARNING, TIKTOK_WARNING]) {
      const w = accountHealthWords(sample, now)
      expect(w.state, sample.platform).toBe('connected')
      expect(w.label).toBe('Connected')
      expect(w.needsReconnect).toBe(false)
      expect(w.detail).toBe('Renewing its login on its own — nothing to do.')
      // the words a person must NOT be shown about a working account
      expect(w.detail).not.toMatch(/can no longer renew/i)
      expect(w.label).not.toMatch(/reconnect/i)
    }
  })

  it('a warning is not a block, on either side of the app', () => {
    for (const sample of [YOUTUBE_WARNING, TIKTOK_WARNING]) {
      expect(healthBlocksPosting(sample).blocked, sample.platform).toBe(false)
    }
  })

  it('an error with a dead token is Expired', () => {
    const w = accountHealthWords(ERROR_PAYLOAD, now)
    expect(w.state).toBe('expired')
    expect(w.label).toBe('Expired')
    expect(w.needsReconnect).toBe(true)
    expect(w.detail).toMatch(/will not go out/i)
    expect(healthBlocksPosting(ERROR_PAYLOAD).blocked).toBe(true)
  })

  it('an error with no token trouble at all is still an error', () => {
    const onlyTheWord = { ...HEALTHY, status: 'error', issues: ['Something went wrong'] }
    const w = accountHealthWords(onlyTheWord, now)
    expect(w.needsReconnect).toBe(true)
    expect(w.detail).toMatch(/cannot use this account/i)
  })

  it('a missing permission names it in words somebody can act on', () => {
    const w = accountHealthWords(MISSING_PERMISSION, now)
    expect(w.state).toBe('reconnect')
    expect(w.label).toBe('Needs reconnecting')
    expect(w.needsReconnect).toBe(true)
    // the plain name, not the API's
    expect(w.detail).toMatch(/posting to the Page/)
    expect(w.detail).not.toMatch(/pages_manage_posts/)
    // one we have no plain name for is still shown, not swallowed
    expect(w.detail).toMatch(/made_up_scope/)
    expect(w.detail).toMatch(/say yes to everything it asks for/)
  })

  it('an account the service may not post to is stopped, valid token or not', () => {
    const cannotPost = {
      ...HEALTHY,
      status: 'warning',
      permissions: { ...HEALTHY.permissions, canPost: false },
    }
    expect(healthBlocksPosting(cannotPost).blocked).toBe(true)
    expect(accountHealthWords(cannotPost, now).needsReconnect).toBe(true)
  })

  it('healthy is connected, plainly', () => {
    const w = accountHealthWords(HEALTHY, now)
    expect(w.state).toBe('connected')
    expect(w.needsReconnect).toBe(false)
    expect(healthBlocksPosting(HEALTHY).blocked).toBe(false)
  })

  it('an unreadable full payload is Not checked, never green', () => {
    for (const sample of [
      { status: 'who knows', tokenStatus: null, permissions: null },
      { tokenStatus: {} },
      { tokenStatus: { valid: 'expired' } },
      null,
    ]) {
      const w = accountHealthWords(sample as never, now)
      expect(w.state, JSON.stringify(sample)).toBe('unknown')
      expect(w.label).toBe('Not checked')
    }
  })

  /**
   * THE PARITY THAT MATTERS. The badge, the calendar tile and the "your
   * account dropped" email must never disagree about whether an account is
   * working. The tile and the email both key off `social_accounts.active`,
   * which ONLY the provider's disconnected/revoked/expired webhook sets — so a
   * `warning` cannot reach either of them, and this proves it rather than
   * asserting it in a comment.
   */
  it('a warning never puts "needs reconnecting" on a post’s tile', () => {
    const account = { id: 'acc-1', platform: 'tiktok', name: 'Yusuf', active: true }
    expect(accountHealthWords(TIKTOK_WARNING, now).needsReconnect).toBe(false)
    expect(channelBlockReason(['acc-1'], [account])).toBeNull()

    // …and when the WEBHOOK really does drop it, both sides say so
    const dropped = { ...account, active: false }
    expect(channelBlockReason(['acc-1'], [dropped])).toMatch(/needs reconnecting/)
    expect(accountHealthWords(ERROR_PAYLOAD, now).needsReconnect).toBe(true)
  })

  it('the badge and the block rule cannot disagree', () => {
    const every = [
      YOUTUBE_WARNING, TIKTOK_WARNING, ERROR_PAYLOAD, MISSING_PERMISSION, HEALTHY,
    ]
    for (const sample of every) {
      const words = accountHealthWords(sample, now)
      expect(words.needsReconnect, sample.accountId)
        .toBe(healthBlocksPosting(sample).blocked)
    }
  })
})
