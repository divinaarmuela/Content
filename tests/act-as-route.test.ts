import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import { ACT_AS_COOKIE } from '@/app/lib/act-as-core'
import type { Row } from '@/lib/db-types'

/**
 * /api/act-as, at the seam that matters: WHO is asking.
 *
 * The route resolves the REAL signed-in row and asks `mayActAs` about that
 * email on every method, so another super admin is refused exactly as a
 * scheduler is. The mock below stands in for Clerk + the team_users lookup
 * and returns whatever `real` is set to.
 */

class AuthzError extends Error { constructor(m: string, public status: number) { super(m) } }

let real: { id: string; name: string; email: string; role: string }

vi.mock('../app/lib/authz', () => ({
  resolveRealTeamUser: async () => real,
  AuthzError,
  authzErrorResponse: (e: unknown) => e instanceof AuthzError
    ? { error: e.message, status: e.status } : { error: String(e), status: 500 },
}))

const { GET, POST, DELETE } = await import('../app/api/act-as/route')

const TECH = { id: 'tu-tech', name: 'Tech MD', email: 'tech@mdmmarketing.com.au', role: 'super_admin' }
const OTHER_ADMIN = { id: 'tu-div', name: 'Divina', email: 'divina@example.invalid', role: 'super_admin' }

const TEAM = [
  { id: 'tu-tech', name: 'Tech MD', email: 'tech@mdmmarketing.com.au', role: 'super_admin', active_status: true },
  { id: 'tu-renee', name: 'Renee Yap', email: 'renee@example.invalid', role: 'account_manager', active_status: true },
  { id: 'tu-ed', name: 'Eddie Ng', email: 'eddie@example.invalid', role: 'editor', active_status: true },
  { id: 'tu-gone', name: 'Gone Person', email: 'gone@example.invalid', role: 'editor', active_status: false },
  { id: 'tu-client', name: 'ZZ TEST Client', email: 'client@example.invalid', role: 'client', active_status: true },
]

const get = async (cookie?: string) => {
  const res = await GET(new Request('https://x.test/api/act-as', {
    headers: cookie ? { cookie } : {},
  }))
  return { status: res.status, json: await res.json() as Record<string, unknown>, res }
}
const post = async (body: unknown) => {
  const res = await POST(new Request('https://x.test/api/act-as', {
    method: 'POST', body: JSON.stringify(body),
  }))
  return { status: res.status, json: await res.json() as Record<string, unknown>, res }
}
/** the Set-Cookie the response carries for our cookie, if any */
const cookieOf = (res: Response) =>
  (res.headers.get('set-cookie') ?? '').split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .find(c => c.trim().startsWith(`${ACT_AS_COOKIE}=`)) ?? null

let fake: ReturnType<typeof seedDb> | null = null

beforeEach(() => {
  real = { ...TECH }
  fake = seedDb({ team_users: TEAM as unknown as Row[] })
})
afterEach(() => { fake?.restore(); fake = null })

describe('who may act as another person', () => {
  it('refuses another super admin, on every method', async () => {
    real = { ...OTHER_ADMIN }

    expect((await get()).status).toBe(403)
    expect((await post({ team_user_id: 'tu-renee' })).status).toBe(403)

    const del = await DELETE()
    expect(del.status).toBe(403)
    // and nothing was handed back that would let them try again
    expect(cookieOf(del)).toBeNull()
  })

  it('gives tech@ the cookie for the person they picked', async () => {
    const { status, json, res } = await post({ team_user_id: 'tu-renee' })

    expect(status).toBe(200)
    expect(json.acting).toMatchObject({ id: 'tu-renee', name: 'Renee Yap', role: 'account_manager' })

    const cookie = cookieOf(res) ?? ''
    expect(cookie).toContain(`${ACT_AS_COOKIE}=tu-renee`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie.toLowerCase()).toContain('samesite=lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('Max-Age=43200')
  })

  it('refuses a client row, a deactivated row, a stranger, and yourself', async () => {
    for (const id of ['tu-client', 'tu-gone', 'tu-nobody', 'tu-tech']) {
      const { status, res } = await post({ team_user_id: id })
      expect(status, id).toBe(400)
      expect(cookieOf(res), id).toBeNull()
    }
  })

  it('refuses a body that is not an id at all', async () => {
    expect((await post({ team_user_id: '../../tables' })).status).toBe(400)
    expect((await post({ team_user_id: 42 })).status).toBe(400)
    expect((await post({})).status).toBe(400)
  })

  it('clears the cookie on DELETE', async () => {
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(cookieOf(res) ?? '').toContain('Max-Age=0')
  })
})

describe('GET /api/act-as — the picker', () => {
  it('lists active team people only, never clients and never yourself', async () => {
    const { status, json } = await get()
    expect(status).toBe(200)
    const people = json.people as { id: string }[]
    expect(people.map(p => p.id).sort()).toEqual(['tu-ed', 'tu-renee'])
    expect(json.real).toMatchObject({ id: 'tu-tech', name: 'Tech MD' })
    expect(json.acting).toBeNull()
  })

  it('reads back who is being acted as from the cookie', async () => {
    const { json } = await get(`${ACT_AS_COOKIE}=tu-renee`)
    expect(json.acting).toMatchObject({ id: 'tu-renee', name: 'Renee Yap' })
  })

  it('says nobody when the cookie names a client, a deactivated row or junk', async () => {
    for (const value of ['tu-client', 'tu-gone', 'tu-nobody', 'a/b']) {
      const { json } = await get(`${ACT_AS_COOKIE}=${value}`)
      expect(json.acting, value).toBeNull()
    }
  })

  it('lists nobody for anybody but tech@', async () => {
    real = { ...OTHER_ADMIN }
    const { status, json } = await get()
    expect(status).toBe(403)
    expect(json.people).toBeUndefined()
  })
})
