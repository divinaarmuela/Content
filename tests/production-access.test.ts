import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * The visibility helpers, on the one rule they exist to enforce:
 * ASSIGNMENT IS THE GRANT.
 *
 * An account manager off a client's team was handed that client's shoot brief.
 * He could open the brief and nothing else: the shoot page refused him, the
 * lists left him out, creating items under the shoot was rejected. Every one
 * of those surfaces asked a *different* question about the same fact. These
 * tests pin the shared answers — one predicate for the lists, one grant for the
 * detail pages — so the two can never drift apart again.
 *
 * They run the real `@/lib/db` against an in-memory Realtime Database, so what
 * is under test is which rows each helper ends up with and how it combines
 * them.
 */

const {
  accessibleClientIds, assignedItemsFilter, heldBatchIds, heldItemIds,
  loadItemForUser, taggedItemIds, visibleClientIds,
} = await import('../app/lib/production-access')

// real uuids: every id the helpers build a query around goes through
// assertUuid, and a fixture that cannot pass it proves nothing
const JAMES = '3548cc71-5a34-4fe9-9130-11579d1a4137'
const OTHER_CLIENT = 'aaaaaaaa-0000-4000-8000-000000000001'
const MY_CLIENT = 'bbbbbbbb-0000-4000-8000-000000000002'
const SHOOT = 'cccccccc-0000-4000-8000-000000000003'
const BRIEF = 'dddddddd-0000-4000-8000-000000000004'
const SIBLING = 'eeeeeeee-0000-4000-8000-000000000005'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const james = { id: JAMES, role: 'account_manager', email: 'j@x.invalid' } as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const superAdmin = { id: JAMES, role: 'super_admin', email: 's@x.invalid' } as any

let fake: ReturnType<typeof seedDb>
const seed = (tables: Parameters<typeof seedDb>[0]) => { fake = seedDb(tables) }
/** the m2m row shape, with the derived composite id the helper reads back */
const onClient = (client_id: string): Row =>
  ({ id: `${JAMES}__${client_id}`, team_user_id: JAMES, client_id }) as unknown as Row

beforeEach(() => { fake = seedDb({}) })
afterEach(() => fake.restore())

describe('heldBatchIds — the shoots assignment opens', () => {
  it('unions shoots you OWN with shoots carrying an item of yours', async () => {
    seed({
      content_items: [{ id: BRIEF, batch_id: SHOOT, owner_id: JAMES }] as unknown as Row[],
      batches: [{ id: SIBLING, owner_id: JAMES }] as unknown as Row[],
    })
    expect((await heldBatchIds(james)).sort()).toEqual([SHOOT, SIBLING].sort())
  })

  it('dedupes the shoot you own AND hold the brief on', async () => {
    seed({
      content_items: [
        { id: BRIEF, batch_id: SHOOT, owner_id: JAMES },
        { id: SIBLING, batch_id: SHOOT, owner_id: JAMES },
      ] as unknown as Row[],
      batches: [{ id: SHOOT, owner_id: JAMES }] as unknown as Row[],
    })
    expect(await heldBatchIds(james)).toEqual([SHOOT])
  })

  it('drops items filed under no shoot at all', async () => {
    seed({
      content_items: [{ id: BRIEF, batch_id: null, owner_id: JAMES }] as unknown as Row[],
      batches: [],
    })
    expect(await heldBatchIds(james)).toEqual([])
  })

  it('counts the item somebody handed you the SCHEDULING of, not just the one you own', async () => {
    seed({
      content_items: [
        { id: BRIEF, batch_id: SHOOT, owner_id: null, scheduler_ids: [JAMES] },
      ] as unknown as Row[],
      batches: [],
    })
    expect(await heldBatchIds(james)).toEqual([SHOOT])
  })

  it('leaves out a shoot whose items belong to somebody else entirely', async () => {
    seed({
      content_items: [
        { id: BRIEF, batch_id: SHOOT, owner_id: OTHER_CLIENT, scheduler_ids: [] },
      ] as unknown as Row[],
      batches: [],
    })
    expect(await heldBatchIds(james)).toEqual([])
  })

  it('is empty for a client account — a client holds no internal jobs', async () => {
    seed({ content_items: [{ id: BRIEF, batch_id: SHOOT, owner_id: JAMES }] as unknown as Row[] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await heldBatchIds({ id: JAMES, role: 'client' } as any)).toEqual([])
    expect(fake.calls()).toHaveLength(0) // and it does not even ask
  })
})

describe('taggedItemIds — being asked a question is an assignment', () => {
  it('reads the comments assigned to this person', async () => {
    seed({
      item_comments: [
        { id: 'c1', item_id: BRIEF, assigned_to: JAMES },
        { id: 'c2', item_id: BRIEF, assigned_to: JAMES },
        { id: 'c3', item_id: SIBLING, assigned_to: JAMES },
        // somebody else's tag is not this person's assignment
        { id: 'c4', item_id: SHOOT, assigned_to: OTHER_CLIENT },
      ] as unknown as Row[],
    })
    expect((await taggedItemIds(james)).sort()).toEqual([BRIEF, SIBLING].sort())
  })
})

describe('assignedItemsFilter — one predicate every list shares', () => {
  it('names all four ways an assignment reaches an item', async () => {
    seed({
      content_items: [{ id: BRIEF, batch_id: SHOOT, owner_id: JAMES }] as unknown as Row[],
      batches: [],
      item_comments: [{ id: 'c1', item_id: SIBLING, assigned_to: JAMES }] as unknown as Row[],
    })
    const matches = await assignedItemsFilter(james)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = (r: Record<string, unknown>) => matches(r as any)
    expect(item({ id: 'x', owner_id: JAMES })).toBe(true)
    expect(item({ id: 'x', scheduler_ids: [JAMES] })).toBe(true)
    expect(item({ id: 'x', batch_id: SHOOT })).toBe(true)
    expect(item({ id: SIBLING })).toBe(true)
    // …and nothing else
    expect(item({ id: 'x', owner_id: OTHER_CLIENT, batch_id: null })).toBe(false)
  })

  it('holding nothing still answers, and answers no', async () => {
    seed({ content_items: [], batches: [], item_comments: [] })
    const matches = await assignedItemsFilter(james)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = (r: Record<string, unknown>) => matches(r as any)
    expect(item({ id: 'x', owner_id: JAMES })).toBe(true)
    expect(item({ id: 'x', scheduler_ids: [JAMES] })).toBe(true)
    expect(item({ id: 'x', batch_id: SHOOT })).toBe(false)
    expect(item({ id: SIBLING })).toBe(false)
  })

  it('refuses an id that is not a uuid rather than querying around it', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(assignedItemsFilter({ id: 'x,y)', role: 'editor' } as any))
      .rejects.toThrow(/Bad identifier/)
  })
})

describe('visibleClientIds — whose name, brand and agreement may I be shown', () => {
  it('adds the client of a held job to the client team', async () => {
    seed({
      team_user_clients: [onClient(MY_CLIENT)],
      content_items: [
        { id: BRIEF, batch_id: SHOOT, client_id: OTHER_CLIENT, owner_id: JAMES },
      ] as unknown as Row[],
      batches: [{ id: SHOOT, client_id: OTHER_CLIENT }] as unknown as Row[],
      item_comments: [],
    })
    expect((await visibleClientIds(james))?.sort()).toEqual([MY_CLIENT, OTHER_CLIENT].sort())
  })

  it('stays unrestricted for a super admin', async () => {
    expect(await visibleClientIds(superAdmin)).toBeNull()
  })

  it('is exactly the client team when nothing is assigned', async () => {
    seed({
      team_user_clients: [onClient(MY_CLIENT)],
      content_items: [],
      batches: [],
      item_comments: [],
    })
    expect(await visibleClientIds(james)).toEqual([MY_CLIENT])
  })

  it('never widens a client account past its own client', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = { id: JAMES, role: 'client', client_id: MY_CLIENT } as any
    expect(await visibleClientIds(c)).toEqual([MY_CLIENT])
    expect(await accessibleClientIds(c)).toEqual([MY_CLIENT])
  })
})

describe('heldItemIds — the same set, for the surfaces that filter in memory', () => {
  it('returns the rows the shared predicate matches, and no others', async () => {
    seed({
      content_items: [
        { id: BRIEF, owner_id: JAMES, batch_id: null },
        { id: SIBLING, owner_id: null, scheduler_ids: [JAMES], batch_id: null },
        { id: SHOOT, owner_id: OTHER_CLIENT, scheduler_ids: [], batch_id: null },
      ] as unknown as Row[],
      batches: [],
      item_comments: [],
    })
    expect((await heldItemIds(james)).sort()).toEqual([BRIEF, SIBLING].sort())
  })
})

describe('loadItemForUser — the detail page grants exactly what the lists show', () => {
  it('opens an off-client item because a comment tagged this person on it', async () => {
    seed({
      content_items: [
        { id: BRIEF, client_id: OTHER_CLIENT, owner_id: null, scheduler_ids: [], batch_id: null },
      ] as unknown as Row[],
      team_user_clients: [onClient(MY_CLIENT)],
      item_comments: [{ id: 'tag-1', item_id: BRIEF, assigned_to: JAMES }] as unknown as Row[],
    })
    await expect(loadItemForUser(james, BRIEF)).resolves.toMatchObject({ id: BRIEF })
  })

  it('opens a sibling item because this person holds its SHOOT — the shoot page lists it', async () => {
    seed({
      content_items: [
        { id: SIBLING, client_id: OTHER_CLIENT, batch_id: SHOOT, owner_id: null, scheduler_ids: [] },
      ] as unknown as Row[],
      team_user_clients: [onClient(MY_CLIENT)],
      item_comments: [],          // not tagged
      batches: [{ id: SHOOT, client_id: OTHER_CLIENT, owner_id: JAMES }] as unknown as Row[],
    })
    await expect(loadItemForUser(james, SIBLING)).resolves.toMatchObject({ id: SIBLING })
  })

  it('404s an off-client item nobody handed them — and does not reveal it exists', async () => {
    seed({
      content_items: [
        { id: SIBLING, client_id: OTHER_CLIENT, batch_id: null, owner_id: null, scheduler_ids: [] },
      ] as unknown as Row[],
      team_user_clients: [onClient(MY_CLIENT)],
      item_comments: [],
    })
    await expect(loadItemForUser(james, SIBLING)).rejects.toThrow(/not found/i)
  })

  it('still opens the item they own outright', async () => {
    seed({
      content_items: [
        { id: BRIEF, client_id: OTHER_CLIENT, owner_id: JAMES, scheduler_ids: [], batch_id: null },
      ] as unknown as Row[],
      team_user_clients: [onClient(MY_CLIENT)],
    })
    await expect(loadItemForUser(james, BRIEF)).resolves.toMatchObject({ id: BRIEF })
    // the cheap path: ownership answers it without touching comments or shoots
    expect(fake.calls().some(c => /item_comments|batches/.test(c.path))).toBe(false)
  })
})
