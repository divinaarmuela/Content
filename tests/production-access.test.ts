import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The visibility helpers, on the one rule they exist to enforce:
 * ASSIGNMENT IS THE GRANT.
 *
 * An account manager off a client's team was handed that client's shoot brief.
 * He could open the brief and nothing else: the shoot page refused him, the
 * lists left him out, creating items under the shoot was rejected. Every one
 * of those surfaces asked a *different* question about the same fact. These
 * tests pin the shared answers — one filter for the lists, one grant for the
 * detail pages — so the two can never drift apart again.
 *
 * Supabase is stubbed: what is under test is which rows each helper asks for
 * and how it combines them, not Postgres.
 */

type Row = Record<string, unknown>
let tables: Record<string, Row[]> = {}
/** every query this test issued, in order — `[table, [[op, args], …]]` */
let calls: { table: string; ops: [string, unknown[]][] }[] = []

function builder(table: string) {
  const ops: [string, unknown[]][] = []
  calls.push({ table, ops })
  const rows = () => tables[table] ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null })
      }
      if (prop === 'maybeSingle' || prop === 'single') {
        return async () => ({ data: rows()[0] ?? null, error: null })
      }
      return (...args: unknown[]) => { ops.push([prop, args]); return q }
    },
  })
  return q
}

vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => builder(t) } }))

const {
  accessibleClientIds, assignedItemsFilter, heldBatchIds, heldItemIds,
  loadItemForUser, taggedItemIds, visibleClientIds,
} = await import('../app/lib/production-access')

// real uuids: every id interpolated into a PostgREST filter goes through
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

/** the ops of the Nth query against `table` */
const opsFor = (table: string, n = 0) =>
  calls.filter(c => c.table === table)[n]?.ops ?? []
const argOf = (table: string, op: string, n = 0) =>
  opsFor(table, n).find(([o]) => o === op)?.[1]

beforeEach(() => {
  tables = {}
  calls = []
})

describe('heldBatchIds — the shoots assignment opens', () => {
  it('unions shoots you OWN with shoots carrying an item of yours', async () => {
    tables.content_items = [{ batch_id: SHOOT }]
    tables.batches = [{ id: SIBLING }]
    expect((await heldBatchIds(james)).sort()).toEqual([SHOOT, SIBLING].sort())
  })

  it('dedupes the shoot you own AND hold the brief on', async () => {
    tables.content_items = [{ batch_id: SHOOT }, { batch_id: SHOOT }]
    tables.batches = [{ id: SHOOT }]
    expect(await heldBatchIds(james)).toEqual([SHOOT])
  })

  it('drops items filed under no shoot at all', async () => {
    tables.content_items = [{ batch_id: null }]
    tables.batches = []
    expect(await heldBatchIds(james)).toEqual([])
  })

  it('is empty for a client account — a client holds no internal jobs', async () => {
    tables.content_items = [{ batch_id: SHOOT }]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await heldBatchIds({ id: JAMES, role: 'client' } as any)).toEqual([])
    expect(calls).toHaveLength(0) // and it does not even ask
  })
})

describe('taggedItemIds — being asked a question is an assignment', () => {
  it('reads the comments assigned to this person', async () => {
    tables.item_comments = [{ item_id: BRIEF }, { item_id: BRIEF }, { item_id: SIBLING }]
    expect((await taggedItemIds(james)).sort()).toEqual([BRIEF, SIBLING].sort())
    expect(argOf('item_comments', 'eq')).toEqual(['assigned_to', JAMES])
  })
})

describe('assignedItemsFilter — one clause every list shares', () => {
  it('names all four ways an assignment reaches an item', async () => {
    tables.content_items = [{ batch_id: SHOOT }]
    tables.batches = []
    tables.item_comments = [{ item_id: SIBLING }]
    const filter = await assignedItemsFilter(james)
    expect(filter).toContain(`owner_id.eq.${JAMES}`)
    expect(filter).toContain(`scheduler_ids.cs.["${JAMES}"]`)
    expect(filter).toContain(`batch_id.in.(${SHOOT})`)
    expect(filter).toContain(`id.in.(${SIBLING})`)
  })

  it('holding nothing still yields a valid clause, never an empty filter', async () => {
    tables.content_items = []
    tables.batches = []
    tables.item_comments = []
    expect(await assignedItemsFilter(james))
      .toBe(`owner_id.eq.${JAMES},scheduler_ids.cs.["${JAMES}"]`)
  })

  it('refuses an id that is not a uuid rather than rewriting the filter around it', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(assignedItemsFilter({ id: 'x,y)', role: 'editor' } as any))
      .rejects.toThrow(/Bad identifier/)
  })
})

describe('visibleClientIds — whose name, brand and agreement may I be shown', () => {
  it('adds the client of a held job to the client team', async () => {
    tables.team_user_clients = [{ client_id: MY_CLIENT }]
    tables.content_items = [{ batch_id: SHOOT, client_id: OTHER_CLIENT }]
    tables.batches = [{ client_id: OTHER_CLIENT }]
    tables.item_comments = []
    expect((await visibleClientIds(james))?.sort()).toEqual([MY_CLIENT, OTHER_CLIENT].sort())
  })

  it('stays unrestricted for a super admin', async () => {
    expect(await visibleClientIds(superAdmin)).toBeNull()
  })

  it('is exactly the client team when nothing is assigned', async () => {
    tables.team_user_clients = [{ client_id: MY_CLIENT }]
    tables.content_items = []
    tables.batches = []
    tables.item_comments = []
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
  it('asks for the rows the shared filter matches', async () => {
    tables.content_items = [{ id: BRIEF }, { id: SIBLING }]
    tables.batches = []
    tables.item_comments = []
    expect(await heldItemIds(james)).toEqual([BRIEF, SIBLING])
    // the LAST content_items query is the one heldItemIds itself ran
    const or = calls.filter(c => c.table === 'content_items').at(-1)!
      .ops.find(([o]) => o === 'or')?.[1]
    expect(String(or)).toContain(`owner_id.eq.${JAMES}`)
  })
})

describe('loadItemForUser — the detail page grants exactly what the lists show', () => {
  it('opens an off-client item because a comment tagged this person on it', async () => {
    tables.content_items = [{ id: BRIEF, client_id: OTHER_CLIENT, owner_id: null, scheduler_ids: [] }]
    tables.team_user_clients = [{ client_id: MY_CLIENT }]
    tables.item_comments = [{ id: 'tag-1' }]
    await expect(loadItemForUser(james, BRIEF)).resolves.toMatchObject({ id: BRIEF })
  })

  it('opens a sibling item because this person holds its SHOOT — the shoot page lists it', async () => {
    tables.content_items = [{ id: SIBLING, client_id: OTHER_CLIENT, batch_id: SHOOT, owner_id: null, scheduler_ids: [] }]
    tables.team_user_clients = [{ client_id: MY_CLIENT }]
    tables.item_comments = []          // not tagged
    tables.batches = [{ id: SHOOT, client_id: OTHER_CLIENT, owner_id: JAMES }]
    await expect(loadItemForUser(james, SIBLING)).resolves.toMatchObject({ id: SIBLING })
  })

  it('404s an off-client item nobody handed them — and does not reveal it exists', async () => {
    tables.content_items = [{ id: SIBLING, client_id: OTHER_CLIENT, batch_id: null, owner_id: null, scheduler_ids: [] }]
    tables.team_user_clients = [{ client_id: MY_CLIENT }]
    tables.item_comments = []
    await expect(loadItemForUser(james, SIBLING)).rejects.toThrow(/not found/i)
  })

  it('still opens the item they own outright', async () => {
    tables.content_items = [{ id: BRIEF, client_id: OTHER_CLIENT, owner_id: JAMES, scheduler_ids: [] }]
    tables.team_user_clients = [{ client_id: MY_CLIENT }]
    await expect(loadItemForUser(james, BRIEF)).resolves.toMatchObject({ id: BRIEF })
    // the cheap path: ownership answers it without touching comments or shoots
    expect(calls.some(c => c.table === 'item_comments')).toBe(false)
  })
})
