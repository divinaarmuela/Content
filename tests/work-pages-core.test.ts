import { describe, it, expect } from 'vitest'
import {
  BRIEF_LANES, EDITOR_LANES, TASK_LANES, activeBriefTasks, applyScope, backLinkFor, canClaimEditor,
  canClaimScheduler, defaultScope, editorAssignment, editorScope, editorTail, isBriefTask,
  isManager, productionScope, recentlyDoneTasks, schedulerAssignment, schedulerIdsOf,
  schedulerScope, unassignedCount,
  type ScopeMode, type ScopeSet, type Viewer, type WorkItem,
} from '../app/lib/work-pages-core'
import { ITEM_STATUSES, SCHEDULER_STATUSES, type ItemStatus } from '../app/lib/workflow-core'
import { TASK_DONE_STATUSES, TASK_KIND_LABELS } from '../app/lib/task-kind-core'
import type { Role } from '../app/lib/identity-core'

const ME = 'me'
const THEM = 'them'
const viewer = (role: Role = 'editor', id = ME): Viewer => ({ id, role })
const scope = (...modes: ScopeMode[]): ScopeSet => new Set(modes)

const item = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: 'i1', status: 'draft_uploaded', owner_id: null, ...over,
})
const brief = (over: Partial<WorkItem> = {}) => item({ work_kinds: { slug: 'shoot_brief' }, ...over })

describe('defaultScope — you open on your own work; a manager opens on all of it', () => {
  it('managers see everything', () => {
    for (const role of ['account_manager', 'super_admin'] as Role[]) {
      expect(isManager(role)).toBe(true)
      expect([...defaultScope(role)]).toEqual(['all'])
    }
  })
  it('everyone else sees their own work and the unclaimed pool', () => {
    for (const role of ['editor', 'scheduler', 'client'] as Role[]) {
      expect(isManager(role)).toBe(false)
      expect([...defaultScope(role)].sort()).toEqual(['mine', 'unassigned'])
    }
  })
})

describe('schedulerIdsOf / isBriefTask', () => {
  it('reads a real list and nothing else', () => {
    expect(schedulerIdsOf({ scheduler_ids: [ME, THEM] })).toEqual([ME, THEM])
    for (const junk of [null, undefined, 'me', 7, {}]) {
      expect(schedulerIdsOf({ scheduler_ids: junk })).toEqual([])
    }
  })
  it('recognises a shoot brief by its kind slug only', () => {
    expect(isBriefTask(brief())).toBe(true)
    expect(isBriefTask(item({ work_kinds: { slug: 'edit' } }))).toBe(false)
    expect(isBriefTask(item({ work_kinds: null }))).toBe(false)
    expect(isBriefTask(item())).toBe(false)
  })
})

describe('editorAssignment', () => {
  it('mine when I own it', () => {
    expect(editorAssignment(item({ owner_id: ME }), viewer())).toBe('mine')
  })
  it('mine when I have an open task on it, even though someone else owns it', () => {
    expect(editorAssignment(item({ owner_id: THEM, my_open_task: true }), viewer())).toBe('mine')
  })
  it('unassigned when nobody owns it', () => {
    expect(editorAssignment(item({ owner_id: null }), viewer())).toBe('unassigned')
  })
  it('other when it is plainly somebody else’s', () => {
    expect(editorAssignment(item({ owner_id: THEM }), viewer())).toBe('other')
  })
})

describe('schedulerAssignment', () => {
  it('mine when I am handed it', () => {
    expect(schedulerAssignment(item({ owner_id: THEM, scheduler_ids: [ME] }), viewer('scheduler'))).toBe('mine')
  })
  it('NOT mine merely because I own the item — this page is about scheduling', () => {
    // owning it and holding the scheduling are different seats. Counting the
    // owner put a row badged "Unassigned — any scheduler can take it" under a
    // filter that said "Only what is assigned to you".
    expect(schedulerAssignment(item({ owner_id: ME, scheduler_ids: [THEM] }), viewer())).toBe('other')
    expect(schedulerAssignment(item({ owner_id: ME, scheduler_ids: [] }), viewer())).toBe('unassigned')
    expect(schedulerAssignment(item({ owner_id: ME, scheduler_ids: [ME] }), viewer())).toBe('mine')
  })
  it('unassigned when nobody is handed it', () => {
    expect(schedulerAssignment(item({ owner_id: THEM, scheduler_ids: [] }), viewer('scheduler'))).toBe('unassigned')
    expect(schedulerAssignment(item({ owner_id: THEM, scheduler_ids: 'nonsense' }), viewer('scheduler'))).toBe('unassigned')
  })
  it('other when it is handed to somebody else', () => {
    expect(schedulerAssignment(item({ owner_id: THEM, scheduler_ids: [THEM] }), viewer('scheduler'))).toBe('other')
  })
})

describe('applyScope — the default never shows another person’s work', () => {
  const items = [
    item({ id: 'mine', owner_id: ME }),
    item({ id: 'free', owner_id: null }),
    item({ id: 'theirs', owner_id: THEM }),
  ]

  it('all shows everything, untouched', () => {
    expect(applyScope(items, viewer(), scope('all'), editorAssignment)).toEqual(items)
  })
  it('{mine,unassigned} hides the item that is plainly someone else’s', () => {
    expect(applyScope(items, viewer(), scope('mine', 'unassigned'), editorAssignment).map(i => i.id))
      .toEqual(['mine', 'free'])
  })
  it('{unassigned} alone shows only the unclaimed pool', () => {
    expect(applyScope(items, viewer(), scope('unassigned'), editorAssignment).map(i => i.id)).toEqual(['free'])
  })
  it('{mine} alone shows only mine', () => {
    expect(applyScope(items, viewer(), scope('mine'), editorAssignment).map(i => i.id)).toEqual(['mine'])
  })
  it('an empty scope shows nothing', () => {
    expect(applyScope(items, viewer(), scope(), editorAssignment)).toEqual([])
  })
})

describe('editorScope', () => {
  const items = [
    item({ id: 'draft', owner_id: ME }),
    item({ id: 'brief', owner_id: ME, work_kinds: { slug: 'shoot_brief' } }),
    item({ id: 'sched', owner_id: ME, status: 'scheduled' }),
    item({ id: 'pub', owner_id: ME, status: 'published' }),
    item({ id: 'approved', owner_id: ME, status: 'approved_for_scheduling' }),
    item({ id: 'theirs', owner_id: THEM, status: 'internal_review' }),
  ]

  it('drops briefs and anything already out of the editors’ hands', () => {
    expect(editorScope(items, viewer(), scope('all')).map(i => i.id)).toEqual(['draft', 'approved', 'theirs'])
  })
  it('a default-scoped editor never sees another person’s item', () => {
    expect(editorScope(items, viewer(), defaultScope('editor')).map(i => i.id)).toEqual(['draft', 'approved'])
  })
})

describe('schedulerScope', () => {
  const items = [
    item({ id: 'early', owner_id: ME, status: 'internal_review' }),
    item({ id: 'approved', owner_id: THEM, status: 'approved_for_scheduling', scheduler_ids: [ME] }),
    item({ id: 'sched', owner_id: THEM, status: 'scheduled', scheduler_ids: [THEM] }),
    item({ id: 'pub', owner_id: THEM, status: 'published', scheduler_ids: [] }),
    item({ id: 'brief', owner_id: THEM, status: 'approved_for_scheduling', work_kinds: { slug: 'shoot_brief' } }),
  ]

  it('keeps only signed-off content items', () => {
    expect(schedulerScope(items, viewer('scheduler'), scope('all')).map(i => i.id))
      .toEqual(['approved', 'sched', 'pub'])
  })
  it('a default-scoped scheduler sees theirs and the pool, not another’s', () => {
    expect(schedulerScope(items, viewer('scheduler'), defaultScope('scheduler')).map(i => i.id))
      .toEqual(['approved', 'pub'])
  })
})

describe('productionScope — a brief belongs to whoever is planning the shoot', () => {
  const tasks = [
    brief({ id: 'mine', owner_id: ME, batch_id: 'b1' }),
    brief({ id: 'by-batch', owner_id: null, batch_id: 'b2' }),
    brief({ id: 'free', owner_id: null, batch_id: 'b3' }),
    brief({ id: 'theirs', owner_id: THEM, batch_id: 'b4' }),
    brief({ id: 'no-batch', owner_id: null }),
  ]
  const owners = { b1: THEM, b2: ME, b3: null, b4: THEM }

  it('the batch owner counts as much as the task owner', () => {
    expect(productionScope(tasks, viewer('account_manager'), scope('mine'), owners).map(i => i.id))
      .toEqual(['mine', 'by-batch'])
  })
  it('unclaimed means neither the task nor its batch has an owner', () => {
    expect(productionScope(tasks, viewer('account_manager'), scope('unassigned'), owners).map(i => i.id))
      .toEqual(['free', 'no-batch'])
  })
  it('all is everything', () => {
    expect(productionScope(tasks, viewer('account_manager'), scope('all'), owners)).toEqual(tasks)
  })
})

describe('unassignedCount / editorTail / activeBriefTasks', () => {
  it('counts what is waiting to be picked up', () => {
    const items = [item({ owner_id: null }), item({ owner_id: null }), item({ owner_id: ME }), item({ owner_id: THEM })]
    expect(unassignedCount(items, viewer(), editorAssignment)).toBe(2)
  })
  it('the tail counts finished content only, never briefs', () => {
    const items = [
      item({ status: 'scheduled' }), item({ status: 'published' }), item({ status: 'published' }),
      brief({ status: 'scheduled' }), brief({ status: 'published' }), item({ status: 'draft_uploaded' }),
    ]
    expect(editorTail(items)).toEqual({ scheduled: 1, published: 2 })
  })
  it('a booked shoot is not an active brief', () => {
    const items = [
      brief({ id: 'a', status: 'internal_review' }),
      brief({ id: 'b', status: 'scheduled' }),
      brief({ id: 'c', status: 'published' }),
      item({ id: 'd', status: 'internal_review' }),
    ]
    expect(activeBriefTasks(items).map(i => i.id)).toEqual(['a'])
  })
})

describe('claiming', () => {
  it('an editor claims an unowned item that is still in production', () => {
    expect(canClaimEditor(item({ owner_id: null }), viewer('editor'))).toBe(true)
    expect(canClaimEditor(item({ owner_id: null }), viewer('account_manager'))).toBe(true)
  })
  it('nobody claims what is owned, a brief, or something already approved', () => {
    expect(canClaimEditor(item({ owner_id: THEM }), viewer('editor'))).toBe(false)
    expect(canClaimEditor(brief({ owner_id: null }), viewer('editor'))).toBe(false)
    expect(canClaimEditor(item({ owner_id: null, status: 'approved_for_scheduling' }), viewer('editor'))).toBe(false)
    expect(canClaimEditor(item({ owner_id: null, status: 'scheduled' }), viewer('editor'))).toBe(false)
  })
  it('a client and a scheduler never claim editing work', () => {
    expect(canClaimEditor(item({ owner_id: null }), viewer('client'))).toBe(false)
    expect(canClaimEditor(item({ owner_id: null }), viewer('scheduler'))).toBe(false)
  })

  it('a scheduler claims an unhanded, signed-off item that is not live yet', () => {
    expect(canClaimScheduler(item({ owner_id: THEM, status: 'approved_for_scheduling' }), viewer('scheduler'))).toBe(true)
    expect(canClaimScheduler(item({ owner_id: THEM, status: 'scheduled' }), viewer('super_admin'))).toBe(true)
  })
  it('not when it is handed out, published, a brief, or too early', () => {
    expect(canClaimScheduler(item({ status: 'approved_for_scheduling', scheduler_ids: [THEM] }), viewer('scheduler'))).toBe(false)
    expect(canClaimScheduler(item({ status: 'published' }), viewer('scheduler'))).toBe(false)
    expect(canClaimScheduler(brief({ status: 'approved_for_scheduling' }), viewer('scheduler'))).toBe(false)
    expect(canClaimScheduler(item({ status: 'internal_review' }), viewer('scheduler'))).toBe(false)
  })
  it('an editor, an account manager or a client never claims the posting', () => {
    for (const role of ['editor', 'account_manager', 'client'] as Role[]) {
      expect(canClaimScheduler(item({ status: 'approved_for_scheduling' }), viewer(role))).toBe(false)
    }
  })
})

describe('backLinkFor — back goes where you came from', () => {
  it('a brief always goes back to Production, approved or not', () => {
    expect(backLinkFor(brief({ status: 'approved_for_scheduling' })))
      .toEqual({ href: '/dashboard/production', label: 'Production' })
    expect(backLinkFor(brief({ status: 'draft_uploaded' })).label).toBe('Production')
  })
  it('a signed-off content item goes back to the scheduler queue', () => {
    for (const status of SCHEDULER_STATUSES) {
      expect(backLinkFor({ status })).toEqual({ href: '/dashboard/scheduler', label: 'Scheduler' })
    }
  })
  it('everything else goes back to the editor board', () => {
    expect(backLinkFor({ status: 'internal_review' })).toEqual({ href: '/dashboard/editor', label: 'Editor' })
  })
})

describe('EDITOR_LANES', () => {
  it('cover exactly these seven statuses, each once, in board order', () => {
    expect(EDITOR_LANES.flatMap(l => l.statuses)).toEqual([
      'draft_uploaded',
      'internal_review',
      'revision_required',
      'revision_complete',
      'client_review',
      'client_changes_requested',
      'approved_for_scheduling',
    ])
  })
  it('never shows a scheduled or published item', () => {
    const covered = EDITOR_LANES.flatMap(l => l.statuses) as ItemStatus[]
    expect(covered).not.toContain('scheduled')
    expect(covered).not.toContain('published')
  })
})

describe('TASK_LANES', () => {
  it('cover every one of the nine statuses, each exactly once', () => {
    const covered = TASK_LANES.flatMap(l => l.statuses)
    expect([...covered].sort()).toEqual([...ITEM_STATUSES].sort())
    expect(new Set(covered).size).toBe(covered.length)
  })

  it('read in the task vocabulary — To do, never "Drafting"', () => {
    expect(TASK_LANES.map(l => l.title)).toEqual([
      'To do', 'Ready for review', 'Being revised', 'With client', 'Done',
    ])
  })

  it('ends in one Done column holding all three finished statuses', () => {
    const done = TASK_LANES[TASK_LANES.length - 1]
    expect(done.key).toBe('done')
    expect(done.statuses).toEqual([...TASK_DONE_STATUSES])
  })

  it('names each lane the same way the task labels do', () => {
    for (const lane of TASK_LANES) {
      for (const s of lane.statuses) {
        // the column title is the status label, or the shared name of the
        // pair the column merges — never a word from the asset pipeline
        expect(TASK_KIND_LABELS[s]).toBeTruthy()
      }
    }
    // the CARD says Not started or In progress; the LANE has to hold both
    expect(TASK_KIND_LABELS.draft_uploaded).toBe('In progress')
    expect(TASK_LANES[0].title).toBe('To do')
    expect(TASK_KIND_LABELS.approved_for_scheduling).toBe('Done')
  })
})

describe('recentlyDoneTasks', () => {
  const now = new Date('2026-08-26T00:00:00Z')
  const task = (id: string, status: ItemStatus, daysAgo: number) => ({
    id, status, owner_id: null,
    work_kinds: { slug: 'research', uses_media: false },
    updated_at: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
  })

  it('keeps only tasks finished inside the window', () => {
    const rows = recentlyDoneTasks([
      task('fresh', 'approved_for_scheduling', 2),
      task('stale', 'approved_for_scheduling', 30),
      task('open', 'internal_review', 1),
    ], now)
    expect(rows.map(r => r.id)).toEqual(['fresh'])
  })

  it('is newest first', () => {
    const rows = recentlyDoneTasks([
      task('older', 'published', 10),
      task('newer', 'scheduled', 1),
    ], now)
    expect(rows.map(r => r.id)).toEqual(['newer', 'older'])
  })

  it('never returns an asset or a brief', () => {
    const rows = recentlyDoneTasks([
      { id: 'asset', status: 'approved_for_scheduling' as ItemStatus, owner_id: null,
        work_kinds: { slug: 'edit', uses_media: true }, updated_at: now.toISOString() },
      { id: 'brief', status: 'published' as ItemStatus, owner_id: null,
        work_kinds: { slug: 'shoot_brief', uses_media: false }, updated_at: now.toISOString() },
    ], now)
    expect(rows).toEqual([])
  })

  it('drops a row with no usable timestamp rather than guessing', () => {
    const rows = recentlyDoneTasks([
      { id: 'x', status: 'approved_for_scheduling' as ItemStatus, owner_id: null,
        work_kinds: { slug: 'copy', uses_media: false }, updated_at: null },
    ], now)
    expect(rows).toEqual([])
  })
})

describe('BRIEF_LANES — the shoot plan as a board', () => {
  it('covers every stage a live brief can be at, exactly once', () => {
    const seen = BRIEF_LANES.flatMap(l => l.statuses)
    expect(new Set(seen).size).toBe(seen.length)
    // a booked brief is a SHOOT and leaves the board — activeBriefTasks drops
    // it before it reaches a column, so it needs no lane
    const live = ITEM_STATUSES.filter(s => s !== 'scheduled' && s !== 'published')
    expect([...seen].sort()).toEqual([...live].sort())
  })

  it('reads in the plan’s own words, in the order the work moves', () => {
    expect(BRIEF_LANES.map(l => l.title)).toEqual([
      'Writing', 'Ready for review', 'Being revised', 'With client', 'Approved — book the shoot',
    ])
  })

  it('a plan the client sent back sits with the team, not with the client', () => {
    const lane = (s: ItemStatus) => BRIEF_LANES.find(l => l.statuses.includes(s))?.key
    expect(lane('client_review')).toBe('client')
    expect(lane('client_changes_requested')).toBe('revising')
    expect(lane('revision_complete')).toBe('review')
  })

  it('shares its lane keys with the task board, so the colours agree', () => {
    for (const key of ['doing', 'review', 'revising', 'client']) {
      expect(BRIEF_LANES.some(l => l.key === key)).toBe(true)
      expect(TASK_LANES.some(l => l.key === key)).toBe(true)
    }
  })

  it('a booked brief never reaches a column', () => {
    const rows = [
      { id: 'a', status: 'draft_uploaded' as ItemStatus, owner_id: null, work_kinds: { slug: 'shoot_brief' } },
      { id: 'b', status: 'scheduled' as ItemStatus, owner_id: null, work_kinds: { slug: 'shoot_brief' } },
    ]
    expect(activeBriefTasks(rows).map(r => r.id)).toEqual(['a'])
  })
})
