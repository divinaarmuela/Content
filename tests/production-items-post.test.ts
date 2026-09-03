import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * Creating work, on the two things the Realtime Database took away.
 *
 * Postgres enforced "one shoot plan per shoot" with a partial unique index,
 * and wrote a many-row insert as ONE statement. Neither exists here: the
 * rule is now the route's own, and a batch upload is n separate writes that
 * can half-succeed. Both are tested against the real `@/lib/db` running on
 * an in-memory Realtime Database — the fake is the database, not the route.
 */

const logActivity = vi.fn()
const notifyJobAssigned = vi.fn()
const announceItemChange = vi.fn()
const announceBatchChange = vi.fn()
const onItemsCreated = vi.fn()

vi.mock('../app/lib/authz', () => ({
  requireRole: async () => ({
    id: 'user-1', role: 'super_admin', email: 'am@x.invalid', name: 'Ada',
  }),
  requireSignedIn: async () => ({
    id: 'user-1', role: 'super_admin', email: 'am@x.invalid', name: 'Ada',
  }),
  authzErrorResponse: (e: unknown) => ({
    error: e instanceof Error ? e.message : 'error', status: 500,
  }),
}))
vi.mock('../app/lib/production-access', () => ({
  accessibleClientIds: async () => null,
  assertUuid: (id: string) => id,
  assignedItemsFilter: async () => () => true,
  canOpenBatch: async () => true,
  openTaggedIds: async () => ({ items: [], batches: [] }),
}))
vi.mock('../app/lib/workflow', () => ({
  logActivity,
  notifyJobAssigned,
  sanitiseRawAssets: (v: unknown) => (Array.isArray(v) ? v : []),
}))
vi.mock('../app/lib/production-live', () => ({ announceItemChange, announceBatchChange }))
vi.mock('../app/lib/gdrive-hooks', () => ({ onItemsCreated, onBatchCreated: vi.fn() }))

const { POST } = await import('../app/api/production/items/route')

const post = async (body: unknown) => {
  const res = await POST(new Request('https://x.test/api/production/items', {
    method: 'POST', body: JSON.stringify(body),
  }))
  return { status: res.status, json: await res.json() as any }
}

const WORK_KINDS = [
  { id: 'wk-brief', slug: 'shoot_brief', name: 'Shoot plan', uses_media: true, active: true, sort_order: 0 },
  { id: 'wk-edit', slug: 'edit', name: 'Edit', uses_media: true, active: true, sort_order: 1 },
]
const BATCH = { id: 'b1', client_id: 'c1', title: 'March shoot', status: 'brief', owner_id: 'user-1' }

let fake: ReturnType<typeof seedDb>

/** Make every write whose payload names `needle` fail the way a dropped
 *  connection does — the only half-failure a batch upload really hits. */
function failWritesNaming(needle: string) {
  const inner = globalThis.fetch
  globalThis.fetch = (async (input: any, init: any = {}) => {
    if ((init?.method ?? 'GET').toUpperCase() !== 'GET'
      && typeof init?.body === 'string' && init.body.includes(needle)) {
      throw new TypeError('fetch failed')
    }
    return inner(input, init)
  }) as typeof globalThis.fetch
}

beforeEach(() => {
  logActivity.mockClear()
  notifyJobAssigned.mockClear()
  announceItemChange.mockClear()
  announceBatchChange.mockClear()
  onItemsCreated.mockClear()
  fake = seedDb({
    work_kinds: WORK_KINDS as unknown as Row[],
    batches: [BATCH] as unknown as Row[],
    content_items: [],
  })
})
afterEach(() => fake.restore())

describe('POST /api/production/items — one shoot plan per shoot', () => {
  it('refuses a second plan for a shoot that already has one', async () => {
    fake.restore()
    fake = seedDb({
      work_kinds: WORK_KINDS as unknown as Row[],
      batches: [BATCH] as unknown as Row[],
      content_items: [{
        id: 'i-existing', client_id: 'c1', batch_id: 'b1', title: 'The plan',
        work_kind_id: 'wk-brief', status: 'draft_uploaded', content_type: 'other',
      }] as unknown as Row[],
    })
    const { status, json } = await post({
      client_id: 'c1', title: 'Another plan', work_kind_id: 'wk-brief', batch_id: 'b1',
    })
    expect(status).toBe(409)
    expect(json.error).toBe('This shoot already has a shoot plan')
    expect(fake.rows('content_items')).toHaveLength(1)
  })

  it('refuses TWO plans for one shoot sent in the same request', async () => {
    // nothing is written until the whole body has been validated, so the
    // stored check alone can never see the first of these two
    const { status, json } = await post({
      items: [
        { client_id: 'c1', title: 'Plan A', work_kind_id: 'wk-brief', batch_id: 'b1' },
        { client_id: 'c1', title: 'Plan B', work_kind_id: 'wk-brief', batch_id: 'b1' },
      ],
    })
    expect(status).toBe(409)
    expect(json.error).toBe('This shoot already has a shoot plan')
    // and neither of them landed — the refusal comes before any write
    expect(fake.rows('content_items')).toHaveLength(0)
  })

  it('refuses the second of two plans sent at the SAME moment', async () => {
    // two account managers, one shoot, no ordering between them: the stored
    // check cannot see a row nobody has written yet, so the shoot itself is
    // claimed instead
    const [x, y] = await Promise.all([
      post({ client_id: 'c1', title: 'Plan A', work_kind_id: 'wk-brief', batch_id: 'b1' }),
      post({ client_id: 'c1', title: 'Plan B', work_kind_id: 'wk-brief', batch_id: 'b1' }),
    ])
    expect([x, y].filter(r => r.status === 201)).toHaveLength(1)
    const refused = [x, y].find(r => r.status === 409)
    expect(refused?.json.error).toBe('This shoot already has a shoot plan')
    expect(fake.rows('content_items')).toHaveLength(1)
  })

  it('a body that fails validation later hands the shoot back', async () => {
    // the plan is claimed while the body is still being read; a second item
    // that turns out to be invalid must not leave the shoot unplannable
    const bad = await post({
      items: [
        { client_id: 'c1', title: 'Plan A', work_kind_id: 'wk-brief', batch_id: 'b1' },
        { client_id: 'c1', work_kind_id: 'wk-edit' },      // no title
      ],
    })
    expect(bad.status).toBe(400)
    expect(fake.rows('content_items')).toHaveLength(0)
    // …and the shoot can be planned straight away, not in a minute's time
    const good = await post({
      client_id: 'c1', title: 'Plan A', work_kind_id: 'wk-brief', batch_id: 'b1',
    })
    expect(good.status).toBe(201)
  })

  it('still allows one plan each on two different shoots', async () => {
    fake.restore()
    fake = seedDb({
      work_kinds: WORK_KINDS as unknown as Row[],
      batches: [BATCH, { ...BATCH, id: 'b2', title: 'April shoot' }] as unknown as Row[],
      content_items: [],
    })
    const { status } = await post({
      items: [
        { client_id: 'c1', title: 'Plan A', work_kind_id: 'wk-brief', batch_id: 'b1' },
        { client_id: 'c1', title: 'Plan B', work_kind_id: 'wk-brief', batch_id: 'b2' },
      ],
    })
    expect(status).toBe(201)
    expect(fake.rows('content_items')).toHaveLength(2)
  })
})

describe('POST /api/production/items — a batch upload that half-lands', () => {
  const twoPieces = {
    adhoc_reason: 'the client sent phone footage',
    items: [
      { client_id: 'c1', title: 'First piece', work_kind_id: 'wk-edit' },
      { client_id: 'c1', title: 'Second piece', work_kind_id: 'wk-edit' },
    ],
  }

  it('creates both and answers 201 when nothing goes wrong', async () => {
    const { status, json } = await post(twoPieces)
    expect(status).toBe(201)
    expect(json).toHaveLength(2)
    expect(fake.rows('content_items')).toHaveLength(2)
    expect(announceItemChange).toHaveBeenCalledTimes(2)
  })

  it('names what landed and what did not, rather than answering 500', async () => {
    failWritesNaming('Second piece')
    const { status, json } = await post(twoPieces)
    expect(status).toBe(207)
    expect(json.created).toHaveLength(1)
    expect(json.created[0].title).toBe('First piece')
    expect(json.failed).toHaveLength(1)
    expect(json.failed[0]).toMatchObject({ index: 1, title: 'Second piece' })
    expect(String(json.failed[0].error)).toMatch(/unreachable/i)
    // the piece that WAS created is really there
    expect(fake.rows('content_items')).toHaveLength(1)
  })

  it('runs the follow-up work for the created items only', async () => {
    failWritesNaming('Second piece')
    await post(twoPieces)
    expect(logActivity).toHaveBeenCalledTimes(1)
    expect(announceItemChange).toHaveBeenCalledTimes(1)
    expect(announceItemChange.mock.calls[0][0]).toMatchObject({ client_id: 'c1', kind: 'created' })
    expect(notifyJobAssigned).toHaveBeenCalledTimes(1)
    expect(onItemsCreated).toHaveBeenCalledTimes(1)
    expect(onItemsCreated.mock.calls[0][0]).toHaveLength(1)
  })
})
