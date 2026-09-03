import { describe, it, expect } from 'vitest'
import {
  accessibleClientIdsOf, assignedItemsPredicate, heldBatchIdsOf, itemIsVisible,
  visibleBatches, visibleClientIdsOf, visibleGroups, visibleItems,
} from '@/app/lib/scope-client'

/**
 * PARITY WITH THE SERVER, not a second opinion.
 *
 * Every expectation below is the `items` GET predicate in
 * `app/api/production/items/route.ts` read line for line: clients see their
 * own client's rows; every other role sees its accessible clients OR anything
 * assignment hands it; a scheduler is gated by status (or owning the row);
 * and the scheduler post-filter drops shoot briefs and other people's
 * handoffs. If one of these ever has to change, the server changed first.
 */

const items: any[] = [
  { id: 'i1', client_id: 'c1', status: 'draft_uploaded', owner_id: 'u2', scheduler_ids: [] },
  { id: 'i2', client_id: 'c2', status: 'approved_for_scheduling', owner_id: 'u9', scheduler_ids: ['u1'] },
  { id: 'i3', client_id: 'c3', status: 'draft_uploaded', owner_id: 'u9', scheduler_ids: [] },
]
const onC1 = [{ id: 'u1__c1', team_user_id: 'u1', client_id: 'c1' } as any]

describe('visibleItems', () => {
  it('super admin sees everything', () => {
    expect(visibleItems({ id: 'u1', role: 'super_admin' }, items, []).map(i => i.id))
      .toEqual(['i1', 'i2', 'i3'])
  })

  it('an editor sees assigned clients plus items handed to them', () => {
    const out = visibleItems({ id: 'u1', role: 'editor' }, items, onC1)
    expect(out.map(i => i.id)).toEqual(['i1', 'i2'])
  })

  it('an editor holding nothing sees only their clients', () => {
    expect(visibleItems({ id: 'u7', role: 'editor' }, items, []).map(i => i.id)).toEqual([])
  })

  it('an owner sees their own item off their client list', () => {
    expect(visibleItems({ id: 'u9', role: 'editor' }, items, []).map(i => i.id))
      .toEqual(['i2', 'i3'])
  })

  it('a scheduler sees scheduler statuses or their own', () => {
    expect(visibleItems({ id: 'u1', role: 'scheduler' }, items, []).map(i => i.id)).toEqual(['i2'])
    // owning a draft beats the status gate — the scheduler can be given work
    expect(visibleItems({ id: 'u9', role: 'scheduler' }, items, []).map(i => i.id))
      .toEqual(['i2', 'i3'])
  })

  it('a scheduler never sees somebody else’s handoff', () => {
    // i2 is handed to u1; u5 is a scheduler with no seat on it
    expect(visibleItems({ id: 'u5', role: 'scheduler' }, items, []).map(i => i.id)).toEqual([])
  })

  it('a scheduler never sees a shoot plan they do not own', () => {
    const brief = [{
      id: 'b1', client_id: 'c1', status: 'approved_for_scheduling',
      owner_id: 'u9', scheduler_ids: [], work_kinds: { slug: 'shoot_brief' },
    }] as any[]
    expect(visibleItems({ id: 'u1', role: 'scheduler' }, brief, []).map(i => i.id)).toEqual([])
    expect(visibleItems({ id: 'u9', role: 'scheduler' }, brief, []).map(i => i.id)).toEqual(['b1'])
  })

  it('a client sees only their own client’s rows, assignment or not', () => {
    const viewer = { id: 'cu1', role: 'client' as const, client_id: 'c2' }
    expect(visibleItems(viewer, items, []).map(i => i.id)).toEqual(['i2'])
    // a client with no client_id sees nothing at all
    expect(visibleItems({ id: 'cu2', role: 'client' }, items, []).map(i => i.id)).toEqual([])
  })

  it('assignment reaches through a held shoot and a comment tag', () => {
    const rows: any[] = [
      { id: 'x1', client_id: 'cX', status: 'draft_uploaded', owner_id: 'u9', batch_id: 'bA', scheduler_ids: [] },
      { id: 'x2', client_id: 'cX', status: 'draft_uploaded', owner_id: 'u1', batch_id: 'bA', scheduler_ids: [] },
      { id: 'x3', client_id: 'cX', status: 'draft_uploaded', owner_id: 'u9', scheduler_ids: [] },
    ]
    // u1 owns x2 on shoot bA, so the whole shoot opens — x1 rides along
    expect(visibleItems({ id: 'u1', role: 'editor' }, rows, []).map(i => i.id))
      .toEqual(['x1', 'x2'])
    // tagged on x3 by an unresolved comment: that alone opens it
    expect(
      visibleItems({ id: 'u1', role: 'editor' }, rows, [], { taggedItemIds: ['x3'] })
        .map(i => i.id),
    ).toEqual(['x1', 'x2', 'x3'])
  })
})

describe('accessibleClientIdsOf', () => {
  it('is null (unrestricted) for super admins and schedulers', () => {
    expect(accessibleClientIdsOf({ id: 'u1', role: 'super_admin' }, [])).toBeNull()
    expect(accessibleClientIdsOf({ id: 'u1', role: 'scheduler' }, [])).toBeNull()
  })
  it('is the client’s own id for a client, and [] without one', () => {
    expect(accessibleClientIdsOf({ id: 'c', role: 'client', client_id: 'c9' }, [])).toEqual(['c9'])
    expect(accessibleClientIdsOf({ id: 'c', role: 'client' }, [])).toEqual([])
  })
  it('is the team_user_clients rows for everyone else', () => {
    expect(accessibleClientIdsOf({ id: 'u1', role: 'editor' }, onC1)).toEqual(['c1'])
  })
})

describe('heldBatchIdsOf', () => {
  it('collects shoots held via an item, owned outright, or tagged', () => {
    const rows: any[] = [
      { id: 'i1', client_id: 'c1', status: 'draft_uploaded', owner_id: 'u1', batch_id: 'bA' },
      { id: 'i2', client_id: 'c1', status: 'draft_uploaded', owner_id: 'u2', batch_id: 'bB', scheduler_ids: ['u1'] },
      { id: 'i3', client_id: 'c1', status: 'draft_uploaded', owner_id: 'u2', batch_id: 'bC' },
    ]
    const batches: any[] = [{ id: 'bD', client_id: 'c1', owner_id: 'u1' }]
    const held = heldBatchIdsOf({ id: 'u1', role: 'editor' }, rows, batches, ['bE'])
    expect([...held].sort()).toEqual(['bA', 'bB', 'bD', 'bE'])
  })
  it('is empty for a client', () => {
    expect(heldBatchIdsOf({ id: 'c', role: 'client' }, [], [], []).size).toBe(0)
  })
})

describe('assignedItemsPredicate', () => {
  it('is owner OR handed the scheduling OR a held shoot OR a tag', () => {
    const p = assignedItemsPredicate({ id: 'u1', role: 'editor' }, new Set(['bA']), new Set(['t1']))
    expect(p({ id: 'a', owner_id: 'u1' } as any)).toBe(true)
    expect(p({ id: 'b', owner_id: 'u2', scheduler_ids: ['u1'] } as any)).toBe(true)
    expect(p({ id: 'c', owner_id: 'u2', batch_id: 'bA' } as any)).toBe(true)
    expect(p({ id: 't1', owner_id: 'u2' } as any)).toBe(true)
    expect(p({ id: 'd', owner_id: 'u2', batch_id: 'bZ' } as any)).toBe(false)
  })
})

describe('visibleBatches', () => {
  const batches: any[] = [
    { id: 'bA', client_id: 'c1', owner_id: 'u2' },
    { id: 'bB', client_id: 'c9', owner_id: 'u2' },
  ]
  it('is every shoot for a super admin', () => {
    expect(visibleBatches({ id: 'u1', role: 'super_admin' }, batches, [], [], []).map(b => b.id))
      .toEqual(['bA', 'bB'])
  })
  it('is the client-team shoots plus the ones held', () => {
    const rows: any[] = [{ id: 'i1', client_id: 'c9', owner_id: 'u1', batch_id: 'bB' }]
    expect(visibleBatches({ id: 'u1', role: 'editor' }, batches, rows, onC1, []).map(b => b.id))
      .toEqual(['bA', 'bB'])
    expect(visibleBatches({ id: 'u1', role: 'editor' }, batches, [], onC1, []).map(b => b.id))
      .toEqual(['bA'])
  })
  it('scopes a SCHEDULER by client team, not by status', () => {
    // batchClientIds: only super_admin is unrestricted for shoots
    expect(visibleBatches({ id: 'u1', role: 'scheduler' }, batches, [], onC1, []).map(b => b.id))
      .toEqual(['bA'])
  })
})

describe('itemIsVisible', () => {
  const item: any = {
    id: 'x1', client_id: 'cX', status: 'draft_uploaded',
    owner_id: 'u9', batch_id: 'bA', scheduler_ids: [],
  }

  it('opens for the client team, and for the owner', () => {
    expect(itemIsVisible({ id: 'u1', role: 'editor' }, item,
      [{ id: 'u1__cX', team_user_id: 'u1', client_id: 'cX' } as any])).toBe(true)
    expect(itemIsVisible({ id: 'u9', role: 'editor' }, item, [])).toBe(true)
  })

  it('opens for a viewer TAGGED on it, off the client team', () => {
    // the notification deep-links straight here; a link to "not found" is
    // worse than no link (assignmentOpensItem, the comment-tag leg)
    expect(itemIsVisible({ id: 'u1', role: 'editor' }, item, [])).toBe(false)
    expect(itemIsVisible({ id: 'u1', role: 'editor' }, item, [], { taggedItemIds: ['x1'] }))
      .toBe(true)
  })

  it('opens for a viewer who owns a SIBLING item on the same shoot', () => {
    // canOpenBatch: holding a job on the shoot opens the shoot, and the shoot
    // opens every item on it -- the shoot page lists them all, and a list
    // whose rows 404 on click is the same broken promise facing the other way
    const sibling: any = { id: 'x2', client_id: 'cX', status: 'draft_uploaded', owner_id: 'u1', batch_id: 'bA' }
    expect(itemIsVisible({ id: 'u1', role: 'editor' }, item, [], { items: [item, sibling] }))
      .toBe(true)
    // ...and for one handed the SCHEDULING of a sibling, not just owning it
    const handed: any = { id: 'x3', client_id: 'cX', status: 'draft_uploaded', owner_id: 'u9', batch_id: 'bA', scheduler_ids: ['u1'] }
    expect(itemIsVisible({ id: 'u1', role: 'editor' }, item, [], { items: [item, handed] }))
      .toBe(true)
  })

  it('opens for a viewer who OWNS the shoot, or was tagged in its thread', () => {
    expect(itemIsVisible({ id: 'u1', role: 'editor' }, item, [],
      { batches: [{ id: 'bA', client_id: 'cX', owner_id: 'u1' }] })).toBe(true)
    expect(itemIsVisible({ id: 'u1', role: 'editor' }, item, [], { taggedBatchIds: ['bA'] }))
      .toBe(true)
  })

  it('stays shut for an unrelated viewer, however much context is supplied', () => {
    const otherShoot: any = { id: 'y1', client_id: 'cY', status: 'draft_uploaded', owner_id: 'u1', batch_id: 'bZ' }
    expect(itemIsVisible({ id: 'u1', role: 'editor' }, item, [], {
      items: [item, otherShoot],
      batches: [{ id: 'bA', client_id: 'cX', owner_id: 'u9' }],
      taggedItemIds: ['someone-elses-item'],
      taggedBatchIds: ['bZ'],
    })).toBe(false)
  })

  it('opens a shoot plan for a scheduler that the BOARD would hide', () => {
    // the list drops a brief from a scheduler's board; loadItemForUser has
    // always opened one. itemIsVisible follows the page, not the list.
    const brief: any = {
      id: 'b1', client_id: 'c1', status: 'approved_for_scheduling',
      owner_id: 'u9', scheduler_ids: [], work_kinds: { slug: 'shoot_brief' },
    }
    expect(visibleItems({ id: 'u1', role: 'scheduler' }, [brief], []).length).toBe(0)
    expect(itemIsVisible({ id: 'u1', role: 'scheduler' }, brief, [])).toBe(true)
  })

  it('keeps the scheduler status gate and the taken seat', () => {
    const draft: any = { id: 'd', client_id: 'c1', status: 'draft_uploaded', owner_id: 'u9', scheduler_ids: [] }
    expect(itemIsVisible({ id: 'u1', role: 'scheduler' }, draft, [])).toBe(false)
    const handed: any = { id: 'h', client_id: 'c1', status: 'scheduled', owner_id: 'u9', scheduler_ids: ['u2'] }
    expect(itemIsVisible({ id: 'u1', role: 'scheduler' }, handed, [])).toBe(false)
    expect(itemIsVisible({ id: 'u2', role: 'scheduler' }, handed, [])).toBe(true)
  })

  it('is false for no row at all', () => {
    expect(itemIsVisible({ id: 'u1', role: 'super_admin' }, null)).toBe(false)
  })
})

describe('schedulerPostFilter: false', () => {
  // the Overview counts a scheduler's whole scoped list and lets each card
  // decide; turning the board's post-filter on there would change every number
  const rows: any[] = [
    { id: 'brief', client_id: 'c1', status: 'approved_for_scheduling', owner_id: 'u9', scheduler_ids: [], work_kinds: { slug: 'shoot_brief' } },
    { id: 'handed', client_id: 'c1', status: 'approved_for_scheduling', owner_id: 'u9', scheduler_ids: ['u2'] },
    { id: 'free', client_id: 'c1', status: 'approved_for_scheduling', owner_id: 'u9', scheduler_ids: [] },
  ]
  it('keeps the status gate but drops the board-only post-filter', () => {
    expect(visibleItems({ id: 'u1', role: 'scheduler' }, rows, []).map(i => i.id)).toEqual(['free'])
    expect(visibleItems({ id: 'u1', role: 'scheduler' }, rows, [], { schedulerPostFilter: false })
      .map(i => i.id)).toEqual(['brief', 'handed', 'free'])
  })
  it('still hides a pre-approval row the scheduler does not own', () => {
    const draft: any = [{ id: 'd', client_id: 'c1', status: 'draft_uploaded', owner_id: 'u9' }]
    expect(visibleItems({ id: 'u1', role: 'scheduler' }, draft, [], { schedulerPostFilter: false }))
      .toEqual([])
  })
})

describe('visibleGroups', () => {
  const groups: any[] = [{ id: 'g1', client_id: 'c1' }, { id: 'g2', client_id: 'c9' }]
  it('is everything for the unrestricted roles', () => {
    expect(visibleGroups({ id: 'u1', role: 'super_admin' }, groups, []).map(g => g.id))
      .toEqual(['g1', 'g2'])
    // a scheduler is gated by status on items, not by client
    expect(visibleGroups({ id: 'u1', role: 'scheduler' }, groups, []).map(g => g.id))
      .toEqual(['g1', 'g2'])
  })
  it('is the client team groups for everyone else, and none without a team', () => {
    expect(visibleGroups({ id: 'u1', role: 'editor' }, groups, onC1).map(g => g.id)).toEqual(['g1'])
    expect(visibleGroups({ id: 'u1', role: 'editor' }, groups, [])).toEqual([])
  })
})

describe('visibleClientIdsOf', () => {
  const batches: any[] = [{ id: 'bA', client_id: 'cX', owner_id: 'u1' }]
  const rows: any[] = [
    { id: 'i1', client_id: 'cY', status: 'draft_uploaded', owner_id: 'u1' },
    { id: 'i2', client_id: 'cZ', status: 'draft_uploaded', owner_id: 'u9' },
  ]
  it('stays null for the unrestricted roles', () => {
    expect(visibleClientIdsOf({ id: 'u1', role: 'super_admin' }, rows, batches, [])).toBeNull()
    expect(visibleClientIdsOf({ id: 'u1', role: 'scheduler' }, rows, batches, [])).toBeNull()
  })
  it('is the client own id for a client -- assignment never widens it', () => {
    expect(visibleClientIdsOf({ id: 'c', role: 'client', client_id: 'c9' }, rows, batches, []))
      .toEqual(['c9'])
  })
  it('adds the clients of everything assignment already opens', () => {
    // on c1; owns an item for cY and the shoot for cX -- all three are context
    const out = visibleClientIdsOf({ id: 'u1', role: 'editor' }, rows, batches, onC1)
    expect([...(out ?? [])].sort()).toEqual(['c1', 'cX', 'cY'])
  })
})
