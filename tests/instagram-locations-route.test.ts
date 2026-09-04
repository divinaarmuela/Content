import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * THE PLACES A CLIENT TAGS POSTS AT.
 *
 * One route, and one rule worth a whole file: the request carries **one
 * place**, never the list. Sending the array the browser is holding is a
 * read-modify-write, and with two managers on the client's Social page — one
 * adding a venue, one removing a closed one — whoever saved second silently
 * erased the other's edit. The change is applied inside a claim against
 * whatever is actually stored (CLAUDE.md trap 11).
 */

const h = vi.hoisted(() => ({
  user: {
    id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada',
    clerk_user_id: null,
  } as Record<string, unknown>,
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
    guard: async () => null,
    roleSatisfies: () => true,
  }
})
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(), renderEmail: () => '', escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/workflow', () => ({
  logActivity: vi.fn(), sanitiseRawAssets: (v: unknown) => (Array.isArray(v) ? v : []),
}))
vi.mock('../app/lib/production-live', () => ({
  announceItemChange: vi.fn(), announceBatchChange: vi.fn(),
}))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({})) } }))

const { GET, POST, DELETE } = await import('../app/api/clients/[id]/instagram-locations/route')

const CLIENT = 'c1'
const OTHER_CLIENT = 'c2'
const AM = { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada', clerk_user_id: null }
const OTHER_AM = { id: 'u-am2', role: 'account_manager', email: 'am2@x.invalid', name: 'Bo', clerk_user_id: null }
const SCHEDULER = { id: 'u-sch', role: 'scheduler', email: 'sch@x.invalid', name: 'Sam', clerk_user_id: null }
const CLIENT_USER = { id: 'u-cl', role: 'client', email: 'buyer@x.invalid', name: 'Robin', clerk_user_id: null }

const as = (who: typeof AM) => { Object.assign(h.user, who) }

const params = { params: Promise.resolve({ id: CLIENT }) }
const otherParams = { params: Promise.resolve({ id: OTHER_CLIENT }) }
const FITZROY = { name: 'Fitzroy', pageId: '102938475610293' }
const CARLTON = { name: 'Carlton', pageId: '102938475610294' }

let fake: ReturnType<typeof seedDb>

const json = async (res: Response | Promise<Response>) => {
  const r = await res
  return { status: r.status, body: await r.json() as any }
}

const list = () => json(GET(new Request('https://x.test/l'), params))
const add = (body: unknown) => json(POST(
  new Request('https://x.test/l', { method: 'POST', body: JSON.stringify(body) }), params))
const drop = (pageId: string) => json(DELETE(
  new Request(`https://x.test/l?pageId=${encodeURIComponent(pageId)}`, { method: 'DELETE' }), params))

const stored = () =>
  (fake.rows('clients')[0] as unknown as { instagram_locations?: unknown }).instagram_locations

beforeEach(() => {
  as(AM)
  fake = seedDb({
    clients: [
      { id: CLIENT, name: 'Acme', timezone: 'Australia/Melbourne', instagram_locations: [] },
      { id: OTHER_CLIENT, name: 'Other', timezone: 'Australia/Melbourne', instagram_locations: [CARLTON] },
    ] as unknown as Row[],
    team_users: [AM, OTHER_AM, SCHEDULER, CLIENT_USER].map(u => ({
      ...u, active_status: true, employment_type: 'employee',
      timezone: 'Australia/Melbourne', client_id: u.role === 'client' ? CLIENT : null,
    })) as unknown as Row[],
    team_user_clients: [
      { id: `${AM.id}__${CLIENT}`, team_user_id: AM.id, client_id: CLIENT },
      { id: `${OTHER_AM.id}__${OTHER_CLIENT}`, team_user_id: OTHER_AM.id, client_id: OTHER_CLIENT },
    ] as unknown as Row[],
    content_items: [],
  })
})
afterEach(() => { fake.restore(); vi.clearAllMocks() })

describe('adding a place', () => {
  it('keeps the name and the Page ID', async () => {
    const { status, body } = await add(FITZROY)
    expect(status).toBe(200)
    expect(body.instagram_locations).toEqual([FITZROY])
    expect(stored()).toEqual([FITZROY])
  })

  it('refuses the @name, which is the mistake everybody makes', async () => {
    const { status, body } = await add({ name: 'Fitzroy', pageId: '@suikitchen' })
    expect(status).toBe(400)
    expect(body.error).toMatch(/not the @name/)
    expect(stored()).toEqual([])
  })

  it('refuses a place with no name anybody would recognise', async () => {
    const { status, body } = await add({ name: '  ', pageId: FITZROY.pageId })
    expect(status).toBe(400)
    expect(body.error).toMatch(/name your team will recognise/)
  })

  it('says so rather than listing the same place twice', async () => {
    await add(FITZROY)
    const { status, body } = await add({ name: 'Fitzroy again', pageId: FITZROY.pageId })
    expect(status).toBe(409)
    expect(body.error).toMatch(/already on the list/)
    expect(stored()).toEqual([FITZROY])
  })
})

describe('removing a place', () => {
  it('takes out the one named and leaves the rest', async () => {
    await add(FITZROY)
    await add(CARLTON)
    const { status, body } = await drop(FITZROY.pageId)
    expect(status).toBe(200)
    expect(body.instagram_locations).toEqual([CARLTON])
  })

  it('removing one that is already gone is what the caller wanted', async () => {
    await add(CARLTON)
    const { status, body } = await drop('999999999999')
    expect(status).toBe(200)
    expect(body.instagram_locations).toEqual([CARLTON])
  })

  it('asks which one', async () => {
    const { status, body } = await json(DELETE(
      new Request('https://x.test/l', { method: 'DELETE' }), params))
    expect(status).toBe(400)
    expect(body.error).toBe('Which place?')
  })
})

describe('two people editing at once', () => {
  it('keeps BOTH edits — the whole reason this is not a list PATCH', async () => {
    await add(FITZROY)
    // one manager adds, the other removes, in the same breath
    const [added, removed] = await Promise.all([add(CARLTON), drop(FITZROY.pageId)])
    expect(added.status).toBe(200)
    expect(removed.status).toBe(200)
    // whichever landed second saw the other's work and built on it
    expect(stored()).toEqual([CARLTON])
  })
})

describe('who may change it', () => {
  it('a scheduler may read the list but not change it', async () => {
    as(SCHEDULER)
    expect((await list()).status).toBe(200)
    expect((await add(FITZROY)).status).toBe(403)
    expect((await drop(FITZROY.pageId)).status).toBe(403)
  })

  it('a client account may not even read it', async () => {
    as(CLIENT_USER)
    expect((await list()).status).toBe(403)
  })
})

describe('a client that is not there', () => {
  it('says so rather than inventing one — to somebody who would be allowed it', async () => {
    // assigned to the id, but the row itself is gone
    fake.restore()
    fake = seedDb({
      clients: [] as unknown as Row[],
      team_users: [{
        ...AM, active_status: true, employment_type: 'employee',
        timezone: 'Australia/Melbourne', client_id: null,
      }] as unknown as Row[],
      team_user_clients: [
        { id: `${AM.id}__${CLIENT}`, team_user_id: AM.id, client_id: CLIENT },
      ] as unknown as Row[],
      content_items: [],
    })
    as(AM)
    expect((await list()).status).toBe(404)
    expect((await add(FITZROY)).status).toBe(404)
  })

  it('an id nobody may touch answers "not yours", never "not found"', async () => {
    // which ids exist is not a thing worth telling somebody who has no
    // business with any of them
    fake.restore()
    fake = seedDb({
      clients: [] as unknown as Row[],
      team_users: [{
        ...AM, active_status: true, employment_type: 'employee',
        timezone: 'Australia/Melbourne', client_id: null,
      }] as unknown as Row[],
      team_user_clients: [] as unknown as Row[],
      content_items: [],
    })
    as(AM)
    expect((await list()).status).toBe(403)
  })
})

/**
 * WHOSE CLIENT IS THIS?
 *
 * The `id` in the path IS the client, and all three handlers used to read and
 * write it without once asking whose it was — `guard()` hands back a response
 * rather than a person, so there was nobody to ask about. An account manager
 * on one client could delete another client's saved venue, or add a
 * plausible-looking Page ID to their list, and that client's next Reel would
 * be tagged at the wrong business. Instagram accepts it happily; nobody finds
 * out until the post is live.
 */
describe('a client that is not this person’s', () => {
  const listOther = () => json(GET(new Request('https://x.test/l'), otherParams))
  const addOther = (body: unknown) => json(POST(
    new Request('https://x.test/l', { method: 'POST', body: JSON.stringify(body) }), otherParams))
  const dropOther = (pageId: string) => json(DELETE(
    new Request(`https://x.test/l?pageId=${encodeURIComponent(pageId)}`, { method: 'DELETE' }),
    otherParams))

  const otherStored = () =>
    ((fake.rows('clients') as unknown as { id: string; instagram_locations?: unknown }[])
      .find(c => c.id === OTHER_CLIENT)?.instagram_locations)

  it('cannot be read by an account manager on another client', async () => {
    as(AM)
    const out = await listOther()
    expect(out.status).toBe(403)
    expect(out.body.error).toBe('That client is not one of yours')
  })

  it('cannot have a place added to it', async () => {
    as(AM)
    const out = await addOther(FITZROY)
    expect(out.status).toBe(403)
    expect(otherStored()).toEqual([CARLTON])
  })

  it('cannot have a place taken off it', async () => {
    as(AM)
    const out = await dropOther(CARLTON.pageId)
    expect(out.status).toBe(403)
    // the venue is still exactly where its own manager left it
    expect(otherStored()).toEqual([CARLTON])
  })

  it('is refused before the Page ID is even looked at', async () => {
    // a bad body on somebody else's client answers "not yours", not "bad id" —
    // the shape of an id is never a reason to tell somebody about a client
    as(AM)
    const out = await addOther({ name: 'Anywhere', pageId: '@notanid' })
    expect(out.status).toBe(403)
  })

  it('is open to the manager it really belongs to', async () => {
    as(OTHER_AM)
    expect((await listOther()).body.instagram_locations).toEqual([CARLTON])
    expect((await addOther(FITZROY)).status).toBe(200)
    expect(otherStored()).toEqual([CARLTON, FITZROY])
  })
})
