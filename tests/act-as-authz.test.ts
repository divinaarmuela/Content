import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import { ACT_AS_COOKIE } from '@/app/lib/act-as-core'
import type { Row } from '@/lib/db-types'

/**
 * `resolveTeamUser` while somebody is acting as somebody else.
 *
 * This is the whole security model in one function: the cookie names a
 * person, and the REAL email decides whether that name counts. Every guard in
 * the app is built on the row this returns, so if the cookie ever worked for
 * a second address, it would work everywhere at once.
 */

let signedIn = { id: 'clerk-tech', email: 'tech@mdmmarketing.com.au', firstName: 'Tech', lastName: 'MD' }
let cookie: string | null = null

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: signedIn.id }),
  currentUser: async () => ({
    primaryEmailAddress: { emailAddress: signedIn.email },
    firstName: signedIn.firstName,
    lastName: signedIn.lastName,
  }),
}))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === ACT_AS_COOKIE && cookie ? { name, value: cookie } : undefined,
  }),
}))

const { resolveTeamUser, resolveRealTeamUser } = await import('../app/lib/authz')

const TEAM = [
  {
    id: 'tu-tech', clerk_user_id: 'clerk-tech', name: 'Tech MD',
    email: 'tech@mdmmarketing.com.au', role: 'super_admin', employment_type: 'employee',
    timezone: 'Australia/Melbourne', client_id: null, active_status: true,
  },
  {
    id: 'tu-div', clerk_user_id: 'clerk-div', name: 'Divina',
    email: 'divina@example.invalid', role: 'super_admin', employment_type: 'employee',
    timezone: 'Australia/Melbourne', client_id: null, active_status: true,
  },
  {
    id: 'tu-renee', clerk_user_id: 'clerk-renee', name: 'Renee Yap',
    email: 'renee@example.invalid', role: 'account_manager', employment_type: 'employee',
    timezone: 'Australia/Melbourne', client_id: null, active_status: true,
  },
  {
    id: 'tu-gone', clerk_user_id: null, name: 'Gone Person',
    email: 'gone@example.invalid', role: 'editor', employment_type: 'employee',
    timezone: 'Australia/Melbourne', client_id: null, active_status: false,
  },
  {
    id: 'tu-client', clerk_user_id: null, name: 'ZZ TEST Client',
    email: 'client@example.invalid', role: 'client', employment_type: 'employee',
    timezone: 'Australia/Melbourne', client_id: 'client-1', active_status: true,
  },
]

let fake: ReturnType<typeof seedDb> | null = null

beforeEach(() => {
  signedIn = { id: 'clerk-tech', email: 'tech@mdmmarketing.com.au', firstName: 'Tech', lastName: 'MD' }
  cookie = null
  fake = seedDb({ team_users: TEAM as unknown as Row[] })
})
afterEach(() => { fake?.restore(); fake = null; vi.unstubAllEnvs() })

describe('resolveTeamUser while acting as somebody', () => {
  it('returns the person themselves when no cookie is set', async () => {
    const me = await resolveTeamUser()
    expect(me).toMatchObject({ id: 'tu-tech', role: 'super_admin' })
    expect(me.acting_for).toBeUndefined()
  })

  it('becomes the other person, and says who is really there', async () => {
    cookie = 'tu-renee'
    const me = await resolveTeamUser()

    // the ROW is theirs — their role, their id, their name — which is what
    // every guard, scope and page then reads with no special case
    expect(me).toMatchObject({ id: 'tu-renee', name: 'Renee Yap', role: 'account_manager' })
    expect(me.acting_for).toEqual({
      id: 'tu-tech', name: 'Tech MD', email: 'tech@mdmmarketing.com.au',
    })
  })

  it('does nothing at all for another super admin with the same cookie', async () => {
    signedIn = { id: 'clerk-div', email: 'divina@example.invalid', firstName: 'Divina', lastName: '' }
    cookie = 'tu-renee'

    const me = await resolveTeamUser()
    expect(me).toMatchObject({ id: 'tu-div', role: 'super_admin' })
    expect(me.acting_for).toBeUndefined()
  })

  it('ignores a cookie naming a client, a deactivated row, a stranger or junk', async () => {
    for (const value of ['tu-client', 'tu-gone', 'tu-nobody', 'a/b', 'tu-tech']) {
      cookie = value
      const me = await resolveTeamUser()
      expect(me.id, value).toBe('tu-tech')
      expect(me.acting_for, value).toBeUndefined()
    }
  })

  it('resolveRealTeamUser is never the acted-as person — that is how you stop', async () => {
    cookie = 'tu-renee'
    const real = await resolveRealTeamUser()
    expect(real).toMatchObject({ id: 'tu-tech', email: 'tech@mdmmarketing.com.au' })
    expect(real.acting_for).toBeUndefined()
  })
})
