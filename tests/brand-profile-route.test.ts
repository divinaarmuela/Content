import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The brand profile route at its seams: who may write, what a bad body gets
 * told, the first-read seed from the scan, and the revision check that stops
 * two account managers undoing each other.
 */

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}
const updates: { table: string; patch: Row; filters: [string, string, unknown][] }[] = []

const supabase = {
  from(table: string) {
    const filters: [string, string, unknown][] = []
    let single = false
    let patch: Row | null = null
    const matching = () => (tables[table] ?? []).filter(r => filters.every(([op, c, v]) => {
      if (op === 'is') return r[c] === v
      if (c.includes('->>')) {
        const [col, key] = c.split('->>')
        const obj = r[col] as Row | null
        return String(obj?.[key]) === String(v)
      }
      return r[c] === v
    }))
    const chain = {
      select: () => chain,
      eq: (c: string, v: unknown) => { filters.push(['eq', c, v]); return chain },
      is: (c: string, v: unknown) => { filters.push(['is', c, v]); return chain },
      maybeSingle: () => { single = true; return chain },
      update: (p: Row) => { patch = p; return chain },
      then: (ok: (r: unknown) => unknown, no?: (e: unknown) => unknown) => {
        const rows = matching()
        if (patch) {
          updates.push({ table, patch, filters })
          for (const r of rows) Object.assign(r, patch)
          return Promise.resolve({ data: rows.map(r => ({ id: r.id })), error: null }).then(ok, no)
        }
        const out = rows.map(r => ({ ...r }))
        return Promise.resolve({ data: single ? out[0] ?? null : out, error: null }).then(ok, no)
      },
    }
    return chain
  },
}

let role = 'account_manager'
const RANK: Record<string, number> = { client: 0, editor: 1, scheduler: 2, account_manager: 3, super_admin: 4 }
class AuthzError extends Error { constructor(m: string, public status: number) { super(m) } }

vi.mock('@/lib/supabase', () => ({ supabase }))
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

beforeEach(() => {
  role = 'account_manager'
  updates.length = 0
  tables.clients = [{ id: 'client-1', name: 'ZZ TEST', brand_profile: null }]
  tables.client_brand = [{
    client_id: 'client-1', updated_at: '2026-08-20T00:00:00.000Z', scan_status: 'done', docs: [],
    profile: {
      colors: [{ name: 'Forest', hex: '#14392B', usage: 'primary' }],
      fonts: [{ family: 'Lora', usage: 'headings' }],
      logo_rules: ['Never stretch the logo'],
    },
  }]
})

describe('GET /api/clients/[id]/brand/profile', () => {
  it('seeds the profile from the scan on first read, and writes it once', async () => {
    const { status, json } = await get()
    expect(status).toBe(200)
    const profile = json.profile as { colours: { hex: string }[]; fonts: { name: string }[]; rev: number }
    expect(profile.colours[0].hex).toBe('#14392B')
    expect(profile.fonts[0].name).toBe('Lora')
    expect(profile.rev).toBe(1)
    expect(json.proposal).toBeNull()
    expect(json.can_edit).toBe(true)
    const seed = updates.find(u => u.table === 'clients')
    expect(seed).toBeTruthy()
    expect(seed!.filters).toContainEqual(['is', 'brand_profile', null])
  })

  it('offers what a newer scan adds, without touching the saved profile', async () => {
    tables.clients[0].brand_profile = {
      rev: 2, colours: [{ name: 'My Forest', hex: '#14392B', role: 'primary' }],
      reviewed_scan_at: '2026-08-01T00:00:00.000Z',
    }
    const { json } = await get()
    const proposal = json.proposal as { changes: { id: string }[] }
    expect(proposal.changes.map(c => c.id)).toEqual(['font:lora', 'logo_rules:never stretch the logo'])
    expect((json.profile as { colours: { name: string }[] }).colours[0].name).toBe('My Forest')
    expect(updates).toEqual([])
  })

  it('a scheduler can read but not edit', async () => {
    role = 'scheduler'
    const { status, json } = await get()
    expect(status).toBe(200)
    expect(json.can_edit).toBe(false)
  })

  it('an editor cannot read it', async () => {
    role = 'editor'
    expect((await get()).status).toBe(403)
  })
})

describe('PATCH /api/clients/[id]/brand/profile', () => {
  it('refuses anyone below account manager', async () => {
    role = 'scheduler'
    const { status } = await patch({ profile: { rev: 0 } })
    expect(status).toBe(403)
    expect(updates).toEqual([])
  })

  it('tells the person which colour code is wrong', async () => {
    const { status, json } = await patch({ profile: { rev: 0, colours: [{ name: 'Sky', hex: 'blue' }] } })
    expect(status).toBe(400)
    expect(String(json.error)).toContain('Sky')
    expect(updates).toEqual([])
  })

  it('saves a valid profile and bumps the revision', async () => {
    tables.clients[0].brand_profile = { rev: 3, colours: [] }
    const { status, json } = await patch({
      profile: { rev: 3, colours: [{ name: 'Sky', hex: '#abc', role: 'accent' }], hashtags: ['summer'] },
    })
    expect(status).toBe(200)
    const saved = json.profile as { rev: number; colours: { hex: string }[]; hashtags: string[] }
    expect(saved.rev).toBe(4)
    expect(saved.colours[0].hex).toBe('#AABBCC')
    expect(saved.hashtags).toEqual(['#summer'])
    expect(updates[0].filters).toContainEqual(['eq', 'brand_profile->>rev', '3'])
  })

  it('refuses a stale revision so nobody silently overwrites a colleague', async () => {
    tables.clients[0].brand_profile = { rev: 5, colours: [] }
    const { status, json } = await patch({ profile: { rev: 3, colours: [] } })
    expect(status).toBe(409)
    expect(String(json.error)).toContain('Someone else')
    expect((tables.clients[0].brand_profile as { rev: number }).rev).toBe(5)
  })
})
