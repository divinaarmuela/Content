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

const h = vi.hoisted(() => ({ role: 'account_manager' }))

vi.mock('../app/lib/authz', () => ({
  guard: async (required: string) => {
    const ORDER = ['scheduler', 'editor', 'account_manager', 'super_admin']
    const ok = h.role === 'super_admin'
      || (h.role !== 'client' && ORDER.indexOf(h.role) >= ORDER.indexOf(required))
    return ok ? null : new Response(JSON.stringify({ error: 'Insufficient permissions' }), { status: 403 })
  },
}))

const { GET, POST, DELETE } = await import('../app/api/clients/[id]/instagram-locations/route')

const CLIENT = 'c1'
const params = { params: Promise.resolve({ id: CLIENT }) }
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
  h.role = 'account_manager'
  fake = seedDb({
    clients: [{
      id: CLIENT, name: 'Acme', timezone: 'Australia/Melbourne', instagram_locations: [],
    }] as unknown as Row[],
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
    h.role = 'scheduler'
    expect((await list()).status).toBe(200)
    expect((await add(FITZROY)).status).toBe(403)
    expect((await drop(FITZROY.pageId)).status).toBe(403)
  })

  it('a client account may not even read it', async () => {
    h.role = 'client'
    expect((await list()).status).toBe(403)
  })
})

describe('a client that is not there', () => {
  it('says so rather than inventing one', async () => {
    fake.restore()
    fake = seedDb({ clients: [] })
    expect((await list()).status).toBe(404)
    expect((await add(FITZROY)).status).toBe(404)
  })
})
