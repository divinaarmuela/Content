import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  accountIdentity, canonicalAccount, onePerIdentity, preferredAccount, type AccountForPick,
} from '@/app/lib/inbox-people-core'

/**
 * 29 Sep 2026 live test: testbusinessaccount2026 was connected in Zernio twice (6aa7e25a…, 6aa8a054…)
 * under two clients, and one comment became two inbox_touches rows. Accounts sharing platform + handle
 * are one account; the touch goes to the best client among them.
 */
const acct = (over: Partial<AccountForPick> & { id: string }): AccountForPick => ({
  provider_account_id: over.id, platform: 'instagram', username: 'testbusinessaccount2026', client_id: null, active: true, ...over,
})
const clients: Record<string, { name: string; status?: string }> = {
  real: { name: 'Bakery Co' },
  zz: { name: 'ZZ Test client' },
  zzlower: { name: 'zz sandbox' },
  gone: { name: 'Old client', status: 'archived' },
}
const clientOf = (id: string) => clients[id]

describe('preferredAccount — one home per handle', () => {
  it('prefers the real client over a ZZ test client, whichever order they come in', () => {
    const a = acct({ id: '6aa7e25a', client_id: 'zz' })
    const b = acct({ id: '6aa8a054', client_id: 'real' })
    expect(preferredAccount([a, b], clientOf)).toBe(b)
    expect(preferredAccount([b, a], clientOf)).toBe(b)
  })

  it('treats a lower-case "zz" name as a test client too', () => {
    const a = acct({ id: 'a', client_id: 'zzlower' })
    const b = acct({ id: 'b', client_id: 'real' })
    expect(preferredAccount([a, b], clientOf)).toBe(b)
  })

  it('prefers any linked client over no client, a missing client or an archived one', () => {
    const none = acct({ id: 'a', client_id: null })
    const missing = acct({ id: 'b', client_id: 'nope' })
    const archived = acct({ id: 'c', client_id: 'gone' })
    const zz = acct({ id: 'd', client_id: 'zz' })
    expect(preferredAccount([none, missing, archived, zz], clientOf)).toBe(zz)
  })

  it('never drops the only match — even a ZZ or unlinked one', () => {
    const only = acct({ id: 'a', client_id: 'zz' })
    expect(preferredAccount([only], clientOf)).toBe(only)
    const lone = acct({ id: 'b', client_id: null })
    expect(preferredAccount([lone], clientOf)).toBe(lone)
    expect(preferredAccount([], clientOf)).toBeNull()
  })

  it('breaks a tie the same way every time (provider account id)', () => {
    const a = acct({ id: 'x2', provider_account_id: '6aa8a054', client_id: 'real' })
    const b = acct({ id: 'x1', provider_account_id: '6aa7e25a', client_id: 'real' })
    expect(preferredAccount([a, b], clientOf)).toBe(b)
    expect(preferredAccount([b, a], clientOf)).toBe(b)
  })
})

describe('canonicalAccount — both deliveries of one comment land on the same account', () => {
  const zz = acct({ id: 'r1', provider_account_id: '6aa7e25a', client_id: 'zz', username: '@TestBusinessAccount2026' })
  const real = acct({ id: 'r2', provider_account_id: '6aa8a054', client_id: 'real' })
  const other = acct({ id: 'r3', provider_account_id: 'ffff', client_id: 'zz', username: 'someone_else' })
  const fb = acct({ id: 'r4', provider_account_id: 'fb1', client_id: 'zz', platform: 'facebook' })
  const all = [zz, real, other, fb]

  it('maps each connection of the handle to the real client\'s account', () => {
    expect(canonicalAccount(all, '6aa7e25a', clientOf)).toBe(real)
    expect(canonicalAccount(all, '6aa8a054', clientOf)).toBe(real)
  })
  it('leaves a different handle, and the same handle on another platform, alone', () => {
    expect(canonicalAccount(all, 'ffff', clientOf)).toBe(other)
    expect(canonicalAccount(all, 'fb1', clientOf)).toBe(fb)
  })
  it('an unknown account is null, so the caller keeps the id it was given', () => {
    expect(canonicalAccount(all, 'unknown', clientOf)).toBeNull()
  })
  it('identity ignores case and a leading @; no handle is no identity', () => {
    expect(accountIdentity(zz)).toBe(accountIdentity(real))
    expect(accountIdentity({ platform: 'instagram', username: null })).toBeNull()
  })
})

describe('onePerIdentity — the follower look reads a doubled account once', () => {
  it('keeps the preferred connection, every other account, and accounts with no handle', () => {
    const zz = acct({ id: 'a', client_id: 'zz' })
    const real = acct({ id: 'b', client_id: 'real' })
    const other = acct({ id: 'c', client_id: 'zz', username: 'another' })
    const noHandle1 = acct({ id: 'd', client_id: 'zz', username: null })
    const noHandle2 = acct({ id: 'e', client_id: 'real', username: null })
    expect(onePerIdentity([zz, real, other, noHandle1, noHandle2], clientOf)).toEqual([real, other, noHandle1, noHandle2])
  })
})

describe('wiring', () => {
  it('the touch writer records under the canonical account and its client', () => {
    const src = readFileSync('app/lib/inbox-people.ts', 'utf8')
    expect(src).toMatch(/canonicalAccount\(accounts, a\.provider_account_id/)
    expect(src).toMatch(/const accountId = home\?\.account_id \?\? t\.account_id/)
    expect(src).toMatch(/client_id: home\?\.client_id/)
  })
})
