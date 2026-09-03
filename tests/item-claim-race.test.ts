import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * "I'll take this one", clicked by two people at the same moment.
 *
 * The seat is not read and then filled — that is two writes' worth of window,
 * and the second click would quietly overwrite the first person's name while
 * telling them both they got it. It is one conditional write on the item row,
 * so exactly one person gets the seat and the other is told who has it.
 */

const ITEM = 'item-1'
const ME = 'user-me'
const RIVAL = 'user-rival'

let viewer = { id: ME, role: 'editor', name: 'Me', email: 'me@x.invalid' }
vi.mock('../app/lib/authz', () => ({
  requireSignedIn: async () => viewer,
  AuthzError: class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  },
  authzErrorResponse: (e: unknown) => ({
    error: e instanceof Error ? e.message : 'error',
    status: (e as { status?: number })?.status ?? 500,
  }),
}))
vi.mock('../app/lib/production-access', () => ({
  loadItemForUser: async (_u: unknown, id: string) => {
    const { table } = await import('@/lib/db')
    return table('content_items').get(id)
  },
}))
vi.mock('../app/lib/workflow', () => ({ logActivity: vi.fn(async () => {}) }))
vi.mock('../app/lib/production-live', () => ({ announceItemChange: vi.fn() }))

const { POST } = await import('../app/api/production/items/[id]/claim/route')

const rows = () => ({
  work_kinds: [{ id: 'wk-1', slug: 'reel', name: 'Reel', uses_media: true }] as unknown as Row[],
  team_users: [
    { id: ME, name: 'Me', email: 'me@x.invalid', role: 'editor' },
    { id: RIVAL, name: 'Rani', email: 'rani@x.invalid', role: 'editor' },
  ] as unknown as Row[],
  content_items: [{
    id: ITEM, client_id: 'c1', title: 'Reel', status: 'draft_uploaded',
    work_kind_id: 'wk-1', owner_id: null, scheduler_ids: [],
  }] as unknown as Row[],
})

const call = () => POST(
  new Request('http://x/api/production/items/item-1/claim', {
    method: 'POST', body: JSON.stringify({ hat: 'editor' }),
  }),
  { params: Promise.resolve({ id: ITEM }) },
)

let fake: ReturnType<typeof seedDb> | null = null
afterEach(() => { fake?.restore(); fake = null; viewer = { id: ME, role: 'editor', name: 'Me', email: 'me@x.invalid' } })

describe('taking the editing seat', () => {
  it('an open seat is taken', async () => {
    fake = seedDb(rows())
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(fake.rows('content_items')[0]).toMatchObject({ owner_id: ME, assigned_by: ME })
  })

  it('a rival taking it between the read and the write wins, and is named', async () => {
    fake = seedDb(rows())
    const off = fake.onBeforeWrite(`/mdm/tables/content_items/${ITEM}`, () => {
      off()
      fake!.tree().mdm.tables.content_items[ITEM].owner_id = RIVAL
    })
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Rani took this a moment ago', taken_by: 'Rani' })
    // and the rival still holds it — the loser wrote nothing
    expect(fake.rows('content_items')[0]).toMatchObject({ owner_id: RIVAL })
  })

  it('an item that moved past editing between read and write is refused', async () => {
    fake = seedDb(rows())
    const off = fake.onBeforeWrite(`/mdm/tables/content_items/${ITEM}`, () => {
      off()
      fake!.tree().mdm.tables.content_items[ITEM].status = 'approved_for_scheduling'
    })
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: 'This one moved on while you were looking — refresh and try again',
    })
    expect(fake.rows('content_items')[0]).toMatchObject({ owner_id: null })
  })

  it('clicking twice is not a conflict', async () => {
    fake = seedDb(rows())
    expect((await call()).status).toBe(200)
    const second = await call()
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({ ok: true, already: true })
  })
})
