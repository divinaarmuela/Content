import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * A RECONNECT KEEPS ITS ROW, AND EVERYTHING KEYED TO IT (the owner, 26 Sep 2026: "make sure it doesn't override data
 * we have — like the followers data"). Jordan Wilson's Instagram was cut by Meta; reconnecting may give it a new id at
 * the provider. The account's row — the one the followers history, the posts and the channel choices point at — must
 * be the same row afterwards, not a second one beside it.
 */
const listAccounts = vi.fn()
vi.mock('../app/lib/publisher', () => ({ getPublisher: () => ({ listAccounts }) }))
vi.mock('../app/lib/account-health', () => ({ refreshClientAccountsHealth: vi.fn(async () => ({ updated: 0, act: 0, told: 0 })) }))
vi.mock('../app/lib/followers', () => ({ followersEnabled: () => false, snapshotsOf: async () => [] }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn() } }))

let fake: ReturnType<typeof seedDb>
afterEach(() => fake?.restore())

describe('reconnecting an account', () => {
  it('a new provider id for the same handle takes over the old row — followers stay attached', async () => {
    fake = seedDb({
      social_accounts: [{ id: 'row-ig', client_id: 'c1', platform: 'instagram', provider_account_id: 'old-id', username: 'jordanwilson._', name: 'jordanwilson._', active: false }] as unknown as Row[],
      follower_snapshots: [{ id: 'snap-1', account_id: 'row-ig', taken_at: '2026-09-20T00:00:00Z' }] as unknown as Row[],
    })
    listAccounts.mockResolvedValueOnce([{ platform: 'instagram', providerAccountId: 'new-id', username: 'JordanWilson._', name: 'jordanwilson._', avatarUrl: null }])
    const { syncSocialAccounts } = await import('../app/lib/publish')
    await syncSocialAccounts('c1', 'profile-1')
    const accounts = fake.rows('social_accounts') as unknown as { id: string; provider_account_id: string; active: boolean }[]
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({ id: 'row-ig', provider_account_id: 'new-id', active: true })
    expect((fake.rows('follower_snapshots')[0] as unknown as { account_id: string }).account_id).toBe('row-ig')
  })

  it('the same provider id reconnecting is simply the same row, made active again', async () => {
    fake = seedDb({
      social_accounts: [{ id: 'row-ig', client_id: 'c1', platform: 'instagram', provider_account_id: 'same-id', username: 'jordanwilson._', active: false, contact_id: 'person-1' }] as unknown as Row[],
    })
    listAccounts.mockResolvedValueOnce([{ platform: 'instagram', providerAccountId: 'same-id', username: 'jordanwilson._', name: 'jordanwilson._', avatarUrl: null }])
    const { syncSocialAccounts } = await import('../app/lib/publish')
    await syncSocialAccounts('c1', 'profile-1')
    const accounts = fake.rows('social_accounts') as unknown as { id: string; active: boolean; contact_id: string }[]
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({ id: 'row-ig', active: true, contact_id: 'person-1' })
  })

  it('a different handle on the same network is a different account — never merged', async () => {
    fake = seedDb({
      social_accounts: [{ id: 'row-a', client_id: 'c1', platform: 'instagram', provider_account_id: 'a-id', username: 'brand_one', active: false }] as unknown as Row[],
    })
    listAccounts.mockResolvedValueOnce([{ platform: 'instagram', providerAccountId: 'b-id', username: 'brand_two', name: 'brand_two', avatarUrl: null }])
    const { syncSocialAccounts } = await import('../app/lib/publish')
    await syncSocialAccounts('c1', 'profile-1')
    const ids = (fake.rows('social_accounts') as unknown as { provider_account_id: string }[]).map(r => r.provider_account_id).sort()
    expect(ids).toEqual(['a-id', 'b-id'])
  })
})
