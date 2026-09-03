import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * "This month across clients". The behaviour under test is the one the page
 * depends on and no other test covers: a read that fails leaves the table
 * empty rather than erroring the whole page, the same as the Overview.
 */

vi.mock('../app/lib/authz', () => ({
  requireRole: async () => ({ id: 'u-1', email: 'am@x.invalid', name: 'AM', role: 'account_manager' }),
  authzErrorResponse: (e: unknown) => ({
    error: e instanceof Error ? e.message : 'error', status: 500,
  }),
}))
vi.mock('../app/lib/production-access', () => ({ accessibleClientIds: async () => null }))

let fake: ReturnType<typeof seedDb> | null = null
const realFetch = globalThis.fetch
afterEach(() => { fake?.restore(); fake = null; globalThis.fetch = realFetch })

const req = () => new Request('http://x/api/overview/month?month=9&year=2026')

describe('GET /api/overview/month', () => {
  it('answers with the active clients it can see', async () => {
    fake = seedDb({
      clients: [
        { id: 'c-1', name: 'Acme', status: 'active', timezone: 'Australia/Melbourne' },
        { id: 'c-2', name: 'Archived Co', status: 'archived' },
      ] as unknown as Row[],
    })
    const { GET } = await import('../app/api/overview/month/route')
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.clients).toHaveLength(1)
    expect(body.clients[0].name).toBe('Acme')
  })

  it('degrades to an empty month when the database is unreachable', async () => {
    fake = seedDb({ clients: [{ id: 'c-1', name: 'Acme', status: 'active' }] as unknown as Row[] })
    // the transport falls over mid-request, the way a cold function sometimes does
    globalThis.fetch = (async () => { throw new Error('socket hang up') }) as typeof fetch

    const { GET } = await import('../app/api/overview/month/route')
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ month: 9, year: 2026, clients: [] })
  })

  it('still refuses a month that is not a month', async () => {
    fake = seedDb({})
    const { GET } = await import('../app/api/overview/month/route')
    const res = await GET(new Request('http://x/api/overview/month?month=13&year=2026'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Bad month' })
  })
})
