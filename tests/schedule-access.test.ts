import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RIGHT_LABEL, accessSummary, accountHealthWords, lastCheckedWords,
  mayChangeAccess, mayChangeProfile, peopleWithAccess, profileMappingWords,
  readProfiles, rightsForRole, rightsWords,
} from '@/app/lib/social-access-core'

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

  it('a token that cannot renew itself needs reconnecting', () => {
    const w = accountHealthWords({ valid: true, needsRefresh: true }, now)
    expect(w.state).toBe('reconnect')
    expect(w.needsReconnect).toBe(true)
  })

  it('a self-renewing token is connected and asks for nothing', () => {
    const w = accountHealthWords(
      { valid: true, expiresIn: 'Auto-refreshes', expiresAt: '2026-09-05T00:00:00.000Z' }, now)
    expect(w.state).toBe('connected')
    expect(w.needsReconnect).toBe(false)
    expect(w.detail).toMatch(/renews itself/i)
  })

  it('one expiring inside the fortnight is flagged before it bites', () => {
    const w = accountHealthWords(
      { valid: true, expiresAt: '2026-09-12T00:00:00.000Z', expiresIn: 'in 8 days' }, now)
    expect(w.state).toBe('reconnect')
    expect(w.detail).toMatch(/8 days left/)
  })

  it('an account we could not check is not reported as broken', () => {
    const w = accountHealthWords(null, now)
    expect(w.state).toBe('connected')
    expect(w.needsReconnect).toBe(false)
    expect(w.detail).toMatch(/could not check/i)
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

  it('refuses to make a group with no name', async () => {
    vi.resetModules()
    process.env.PUBLISH_DRY_RUN = '1'
    const { createProfile } = await import('@/app/lib/zernio-profiles')
    await expect(createProfile('   ')).rejects.toThrow(/name/i)
  })
})
