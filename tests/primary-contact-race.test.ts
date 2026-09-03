import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * One primary contact per client.
 *
 * Postgres held it as a partial unique index. Reading the other contacts and
 * then writing is not the same thing: two people promoting two different
 * people at the same moment both read "nobody is primary" and both write one,
 * and the client ends up with two — which is then invisible until somebody
 * emails the wrong person. The seat is claimed instead.
 */

vi.mock('../app/lib/authz', () => ({ guard: async () => null }))

const { POST, PATCH, DELETE } = await import('../app/api/website/clients/[id]/contacts/route')

const CLIENT = 'c1'
const params = { params: Promise.resolve({ id: CLIENT }) }
const post = async (body: unknown) => {
  const res = await POST(new Request('https://x.test/c', { method: 'POST', body: JSON.stringify(body) }), params)
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}
const patch = async (body: unknown) => {
  const res = await PATCH(new Request('https://x.test/c', { method: 'PATCH', body: JSON.stringify(body) }))
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

let fake: ReturnType<typeof seedDb> | null = null
afterEach(() => { fake?.restore(); fake = null })

const primaries = () =>
  fake!.rows('client_contacts').filter(c => (c as unknown as { is_primary?: boolean }).is_primary === true)

describe('one primary contact per client', () => {
  it('two people adding a primary at the same moment leave exactly one', async () => {
    fake = seedDb({ client_contacts: [] })
    const [a, b] = await Promise.all([
      post({ name: 'Ada', is_primary: true }),
      post({ name: 'Grace', is_primary: true }),
    ])
    expect([a, b].filter(r => r.status === 201)).toHaveLength(1)
    const refused = [a, b].find(r => r.status === 409)
    expect(refused?.json.error).toBe('This client already has a primary contact. Unset it first.')
    expect(primaries()).toHaveLength(1)
  })

  it('promoting a second contact while one is primary is refused', async () => {
    fake = seedDb({
      client_contacts: [
        { id: 'k1', client_id: CLIENT, name: 'Ada', is_primary: true },
        { id: 'k2', client_id: CLIENT, name: 'Grace', is_primary: false },
      ] as unknown as Row[],
    })
    const res = await patch({ id: 'k2', is_primary: true })
    expect(res.status).toBe(409)
    expect(primaries().map(c => c.id)).toEqual(['k1'])
  })

  it('unsetting the primary hands the seat on', async () => {
    fake = seedDb({
      client_contacts: [
        { id: 'k1', client_id: CLIENT, name: 'Ada', is_primary: true },
        { id: 'k2', client_id: CLIENT, name: 'Grace', is_primary: false },
      ] as unknown as Row[],
    })
    // k1 holds the seat as far as the lock is concerned, once it is asked
    expect((await patch({ id: 'k2', is_primary: true })).status).toBe(409)
    expect((await patch({ id: 'k1', is_primary: false })).status).toBe(200)
    expect((await patch({ id: 'k2', is_primary: true })).status).toBe(200)
    expect(primaries().map(c => c.id)).toEqual(['k2'])
  })

  it('deleting the primary hands the seat on too', async () => {
    fake = seedDb({ client_contacts: [] })
    const first = await post({ name: 'Ada', is_primary: true })
    expect(first.status).toBe(201)
    const res = await DELETE(new Request(`https://x.test/c?contactId=${first.json.id}`, { method: 'DELETE' }))
    expect(res.status).toBe(200)
    expect((await post({ name: 'Grace', is_primary: true })).status).toBe(201)
    expect(primaries()).toHaveLength(1)
  })

  it('a contact that is not primary is never blocked', async () => {
    fake = seedDb({ client_contacts: [] })
    expect((await post({ name: 'Ada', is_primary: true })).status).toBe(201)
    expect((await post({ name: 'Grace' })).status).toBe(201)
    expect((await post({ name: 'Hedy' })).status).toBe(201)
    expect(primaries()).toHaveLength(1)
  })
})
