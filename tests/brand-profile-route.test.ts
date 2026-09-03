import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * The brand profile route at its seams: who may write, what a bad body gets
 * told, the first-read seed from the scan, and the revision check that stops
 * two account managers undoing each other.
 *
 * Both halves run against an in-memory Realtime Database — the real `@/lib/db`
 * on a fake of the REST surface — so the revision check is exercised as the
 * route actually performs it: read the live row, compare, then write.
 */

type Json = Record<string, unknown>

let role = 'account_manager'
const RANK: Record<string, number> = { client: 0, editor: 1, scheduler: 2, account_manager: 3, super_admin: 4 }
class AuthzError extends Error { constructor(m: string, public status: number) { super(m) } }

vi.mock('../app/lib/authz', () => ({
  requireRole: async (required: string) => {
    if (RANK[role] < RANK[required]) throw new AuthzError('Insufficient permissions', 403)
    return { role, email: 'am@example.invalid' }
  },
  roleSatisfies: (r: string, required: string) => RANK[r] >= RANK[required],
  authzErrorResponse: (e: unknown) => e instanceof AuthzError
    ? { error: e.message, status: e.status } : { error: String(e), status: 500 },
}))

const { GET, PATCH } = await import('../app/api/clients/[id]/brand/profile/route')

const ctx = { params: Promise.resolve({ id: 'client-1' }) }
const get = async () => {
  const res = await GET(new Request('https://x.test/api/clients/client-1/brand/profile'), ctx)
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}
const patch = async (body: unknown) => {
  const res = await PATCH(new Request('https://x.test/api/clients/client-1/brand/profile', {
    method: 'PATCH', body: JSON.stringify(body),
  }), ctx)
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

/** the scan the profile is seeded from */
const SCAN = {
  colors: [{ name: 'Forest', hex: '#14392B', usage: 'primary' }],
  fonts: [{ family: 'Lora', usage: 'headings' }],
  logo_rules: ['Never stretch the logo'],
}

let fake: ReturnType<typeof seedDb> | null = null
let client: Json

/** Seed the database. Called after a test has adjusted the client row. */
const start = (withScan = true) => {
  fake = seedDb({
    clients: [client] as unknown as Row[],
    ...(withScan ? {
      client_brand: [{
        id: 'client-1', client_id: 'client-1',
        updated_at: '2026-08-20T00:00:00.000Z', scan_status: 'done', docs: [],
        profile: SCAN,
      }] as unknown as Row[],
    } : {}),
  })
}
const savedProfile = () =>
  (fake!.rows('clients')[0] as unknown as Json).brand_profile as Json | null

beforeEach(() => {
  role = 'account_manager'
  fake = null
  client = { id: 'client-1', name: 'ZZ TEST', brand_profile: null }
})
afterEach(() => { fake?.restore(); fake = null })

describe('GET /api/clients/[id]/brand/profile', () => {
  it('seeds the profile from the scan on first read, and writes it once', async () => {
    start()
    const { status, json } = await get()
    expect(status).toBe(200)
    const profile = json.profile as { colours: { hex: string }[]; fonts: { name: string }[]; rev: number }
    expect(profile.colours[0].hex).toBe('#14392B')
    expect(profile.fonts[0].name).toBe('Lora')
    expect(profile.rev).toBe(1)
    expect(json.proposal).toBeNull()
    expect(json.can_edit).toBe(true)
    // the seed landed on the row, so the next read is not a second seed
    expect(savedProfile()).toMatchObject({ rev: 1 })
    const again = await get()
    expect((again.json.profile as { rev: number }).rev).toBe(1)
    expect(savedProfile()).toMatchObject({ rev: 1 })
  })

  it('offers what a newer scan adds, without touching the saved profile', async () => {
    client.brand_profile = {
      rev: 2, colours: [{ name: 'My Forest', hex: '#14392B', role: 'primary' }],
      reviewed_scan_at: '2026-08-01T00:00:00.000Z',
    }
    start()
    const { json } = await get()
    const proposal = json.proposal as { changes: { id: string }[] }
    expect(proposal.changes.map(c => c.id)).toEqual(['font:lora', 'logo_rules:never stretch the logo'])
    expect((json.profile as { colours: { name: string }[] }).colours[0].name).toBe('My Forest')
    // nothing was written: the saved profile is exactly what it was
    expect(savedProfile()).toMatchObject({ rev: 2 })
    expect((savedProfile() as { colours: { name: string }[] }).colours[0].name).toBe('My Forest')
  })

  it('a scheduler can read but not edit', async () => {
    start()
    role = 'scheduler'
    const { status, json } = await get()
    expect(status).toBe(200)
    expect(json.can_edit).toBe(false)
  })

  it('an editor cannot read it', async () => {
    start()
    role = 'editor'
    expect((await get()).status).toBe(403)
  })
})

describe('PATCH /api/clients/[id]/brand/profile', () => {
  it('refuses anyone below account manager', async () => {
    start(false)
    role = 'scheduler'
    const { status } = await patch({ profile: { rev: 0 } })
    expect(status).toBe(403)
    expect(savedProfile() ?? null).toBeNull()
  })

  it('tells the person which colour code is wrong', async () => {
    start(false)
    const { status, json } = await patch({ profile: { rev: 0, colours: [{ name: 'Sky', hex: 'blue' }] } })
    expect(status).toBe(400)
    expect(String(json.error)).toContain('Sky')
    expect(savedProfile() ?? null).toBeNull()
  })

  it('saves a valid profile and bumps the revision', async () => {
    client.brand_profile = { rev: 3, colours: [] }
    start(false)
    const { status, json } = await patch({
      profile: { rev: 3, colours: [{ name: 'Sky', hex: '#abc', role: 'accent' }], hashtags: ['summer'] },
    })
    expect(status).toBe(200)
    const saved = json.profile as { rev: number; colours: { hex: string }[]; hashtags: string[] }
    expect(saved.rev).toBe(4)
    expect(saved.colours[0].hex).toBe('#AABBCC')
    expect(saved.hashtags).toEqual(['#summer'])
    // the row itself moved to rev 4 — the response is not the only witness
    expect(savedProfile()).toMatchObject({ rev: 4 })
  })

  it('writes the first profile when the row has never had one', async () => {
    start(false)
    const { status, json } = await patch({ profile: { rev: 0, colours: [] } })
    expect(status).toBe(200)
    expect((json.profile as { rev: number }).rev).toBe(1)
    expect(savedProfile()).toMatchObject({ rev: 1 })
  })

  it('refuses a first write when somebody has already saved one', async () => {
    client.brand_profile = { rev: 1, colours: [] }
    start(false)
    const { status } = await patch({ profile: { rev: 0, colours: [] } })
    expect(status).toBe(409)
    expect(savedProfile()).toMatchObject({ rev: 1 })
  })

  it('refuses a save whose revision went stale between the read and the write', async () => {
    client.brand_profile = { rev: 5, colours: [] }
    start(false)
    // a colleague saves rev 6 in the gap — this save must not land on top
    const off = fake!.onBeforeWrite('/mdm/tables/clients/client-1', () => {
      off()
      const tree = fake!.tree() as { mdm: { tables: { clients: Record<string, Json> } } }
      tree.mdm.tables.clients['client-1'].brand_profile = { rev: 6, colours: [] }
    })
    const { status, json } = await patch({ profile: { rev: 5, colours: [] } })
    expect(status).toBe(409)
    expect(String(json.error)).toContain('Someone else')
    expect(savedProfile()).toMatchObject({ rev: 6 })
  })

  it('two editors saving from the same revision leave one winner', async () => {
    client.brand_profile = { rev: 5, colours: [] }
    start(false)
    const [x, y] = await Promise.all([
      patch({ profile: { rev: 5, colours: [] } }),
      patch({ profile: { rev: 5, colours: [] } }),
    ])
    expect([x, y].filter(r => r.status === 200)).toHaveLength(1)
    expect([x, y].filter(r => r.status === 409)).toHaveLength(1)
    expect(savedProfile()).toMatchObject({ rev: 6 })
  })

  it('refuses a stale revision so nobody silently overwrites a colleague', async () => {
    client.brand_profile = { rev: 5, colours: [] }
    start(false)
    const { status, json } = await patch({ profile: { rev: 3, colours: [] } })
    expect(status).toBe(409)
    expect(String(json.error)).toContain('Someone else')
    expect(savedProfile()).toMatchObject({ rev: 5 })
  })
})
