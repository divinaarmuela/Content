import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import { encodeKey } from '@/lib/db'
import type { Row } from '@/lib/db-types'

/**
 * Inviting someone, at the one seam that can hurt: an address that is already
 * on the team.
 *
 * Postgres held `team_users.email` unique and the invite path wrote with
 * "on conflict do nothing", so a race could never rename or demote a
 * colleague. The Realtime Database helper enforces the same unique key, and
 * this proves the route still LOSES that race rather than winning it.
 */

const createInvitation = vi.fn(async () => ({ id: 'clerk-inv-1' }))
const getUserList = vi.fn(async () => ({ data: [] as { id: string }[] }))
vi.mock('@clerk/nextjs/server', () => ({
  clerkClient: async () => ({
    users: { getUserList },
    invitations: { createInvitation },
  }),
}))

class AuthzError extends Error { constructor(m: string, public status: number) { super(m) } }
vi.mock('../app/lib/authz', () => ({
  requireRole: async () => ({ id: 'admin-1', role: 'super_admin', email: 'admin@example.invalid' }),
  authzErrorResponse: (e: unknown) => e instanceof AuthzError
    ? { error: e.message, status: e.status } : { error: String(e), status: 500 },
  AuthzError,
}))
vi.mock('../app/lib/gdrive-members', () => ({ onTeamChanged: vi.fn() }))

const { POST } = await import('../app/api/team/route')

const post = async (body: unknown) => {
  const res = await POST(new Request('https://x.test/api/team', {
    method: 'POST', body: JSON.stringify(body),
  }))
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

let fake: ReturnType<typeof seedDb> | null = null
let seed: Record<string, Row[]>

const start = () => { fake = seedDb(seed as never); return fake }
const users = () => fake!.rows('team_users') as unknown as Record<string, unknown>[]

beforeEach(() => {
  fake = null
  createInvitation.mockClear()
  getUserList.mockClear()
  seed = { team_users: [], team_invites: [], team_user_clients: [] }
})
afterEach(() => { fake?.restore(); fake = null })

describe('POST /api/team — an address that is already on the team', () => {
  const MEMBER = {
    id: 'tu-1', email: 'dana@example.invalid', name: 'Dana Reyes',
    role: 'super_admin', employment_type: 'employee',
    timezone: 'Australia/Melbourne', active_status: true, clerk_user_id: null,
  }

  it('refuses, and does not overwrite the member it found', async () => {
    seed.team_users = [{ ...MEMBER }] as unknown as Row[]
    start()

    const { status, json } = await post({
      email: 'Dana@example.invalid', role: 'editor', name: 'Someone Else',
      employment_type: 'contractor', timezone: 'Asia/Manila',
    })

    expect(status).toBe(409)
    expect(json.error).toBe('This person is already on the team, waiting for their first sign-in')
    // the row is exactly as it was: an invite must never demote a colleague
    expect(users()).toHaveLength(1)
    expect(users()[0]).toMatchObject({
      name: 'Dana Reyes', role: 'super_admin',
      employment_type: 'employee', timezone: 'Australia/Melbourne',
    })
    expect(createInvitation).not.toHaveBeenCalled()
  })

  it('loses the race when the member appears after the check, and changes nothing', async () => {
    // The real hazard is not the check above — it is the write that follows
    // it. Somebody signing in (or a second admin) can open the row in the
    // millisecond between. So: let the check see an empty team, then put the
    // member and its unique-key claim in place before the write lands.
    start()
    const inner = globalThis.fetch
    let injected = false
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await inner(input, init)
      const url = String(typeof input === 'string' ? input : (input as Request).url)
      if (!injected && (init?.method ?? 'GET') === 'GET' && url.includes('/mdm/tables/team_users.json')) {
        injected = true
        const t = fake!.tree() as Record<string, any>
        t.mdm.tables.team_users = { [MEMBER.id]: { ...MEMBER } }
        t.mdm.uniq = t.mdm.uniq ?? {}
        t.mdm.uniq.team_users = { email: { [encodeKey(MEMBER.email)]: MEMBER.id } }
      }
      return res
    }) as typeof fetch

    const { status, json } = await post({
      email: 'dana@example.invalid', role: 'editor', name: 'Someone Else',
      employment_type: 'contractor', timezone: 'Asia/Manila',
    })

    expect(status).toBe(409)
    expect(json.error).toBe('This person is already on the team, waiting for their first sign-in')
    // one row, still theirs — an invite that wrote over it would have made
    // Dana a contractor in Manila
    expect(users()).toHaveLength(1)
    expect(users()[0]).toMatchObject({
      name: 'Dana Reyes', role: 'super_admin',
      employment_type: 'employee', timezone: 'Australia/Melbourne',
    })
    // and the invite it had already opened is rolled back
    expect(fake!.rows('team_invites')).toEqual([])
    expect(createInvitation).not.toHaveBeenCalled()
  })

  it('says so differently when they already have a login', async () => {
    seed.team_users = [{ ...MEMBER, clerk_user_id: 'user_abc' }] as unknown as Row[]
    start()
    const { status, json } = await post({ email: 'dana@example.invalid', role: 'editor' })
    expect(status).toBe(409)
    expect(json.error).toBe('This email already has an account')
  })

  it('refuses a second pending invite for the same address', async () => {
    seed.team_invites = [{
      id: 'inv-1', email: 'dana@example.invalid', role: 'editor', status: 'pending',
    }] as unknown as Row[]
    start()
    const { status, json } = await post({ email: 'dana@example.invalid', role: 'editor' })
    expect(status).toBe(409)
    expect(json.error).toBe('A pending invite already exists for this email')
    expect(fake!.rows('team_invites')).toHaveLength(1)
  })

  it('two admins inviting the same person at once send ONE invite', async () => {
    start()
    const [x, y] = await Promise.all([
      post({ email: 'new@example.invalid', role: 'editor', name: 'New Person' }),
      post({ email: 'new@example.invalid', role: 'editor', name: 'New Person' }),
    ])
    expect([x, y].filter(r => r.status === 201)).toHaveLength(1)
    const refused = [x, y].find(r => r.status === 409)
    expect(refused?.json.error).toBe('A pending invite already exists for this email')
    expect(fake!.rows('team_invites')).toHaveLength(1)
    // and only one invitation email went through Clerk
    expect(createInvitation).toHaveBeenCalledTimes(1)
  })

  it('the address is invitable again once the invite is revoked', async () => {
    start()
    expect((await post({ email: 'new@example.invalid', role: 'editor' })).status).toBe(201)
    const invite = fake!.rows('team_invites')[0] as unknown as { id: string }
    const { DELETE } = await import('../app/api/team/[id]/route')
    const revoked = await DELETE(
      new Request('https://x.test/api/team/x?kind=invite', { method: 'DELETE' }),
      { params: Promise.resolve({ id: invite.id }) },
    )
    expect(revoked.status).toBe(200)
    // the address stops being spoken for the moment the invite is not pending
    expect(fake!.rows('claim_locks')[0]).toMatchObject({ holder: '' })
  })

  it('opens the person and the invite when the address is new', async () => {
    start()
    const { status } = await post({
      email: 'new@example.invalid', role: 'editor', name: 'New Person',
    })
    expect(status).toBe(201)
    expect(users()).toHaveLength(1)
    expect(users()[0]).toMatchObject({
      email: 'new@example.invalid', name: 'New Person', role: 'editor', active_status: true,
    })
    const invites = fake!.rows('team_invites') as unknown as Record<string, unknown>[]
    expect(invites).toHaveLength(1)
    // the status the GET filters on is written, not defaulted by the database
    expect(invites[0].status).toBe('pending')
    expect(createInvitation).toHaveBeenCalledTimes(1)
  })
})
