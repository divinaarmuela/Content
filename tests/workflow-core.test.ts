import { describe, it, expect } from 'vitest'
import {
  ITEM_STATUSES,
  TRANSITIONS,
  CLIENT_LABELS,
  SCHEDULER_STATUSES,
  STATUS_LABELS,
  STATUS_MEANING,
  STATUS_TURN,
  PRIMARY_ACTION,
  actingRoles,
  checkTransition,
  checkTransitionAs,
  availableTransitions,
  availableTransitionsAs,
  presentTransitions,
  whoseTurn,
  versionSatisfiesSubmission,
  TRANSITION_NOTIFICATIONS,
  type ActingItem,
  type ItemStatus,
} from '../app/lib/workflow-core'
import { BRIEF_KIND_LABELS, BRIEF_TRANSITION_OVERRIDES } from '../app/lib/brief-task-core'
import type { Role } from '../app/lib/identity-core'

describe('funnel shape', () => {
  it('published is terminal', () => {
    expect(TRANSITIONS.published).toBeUndefined()
  })
  it('every client label is defined', () => {
    for (const s of ITEM_STATUSES) expect(CLIENT_LABELS[s]).toBeTruthy()
  })
  it('internal churn reads as one calm client state', () => {
    for (const s of ['draft_uploaded', 'internal_review', 'revision_required', 'revision_complete'] as ItemStatus[]) {
      expect(CLIENT_LABELS[s]).toBe('In production')
    }
  })
})

describe('checkTransition — role gates', () => {
  it('editor submits draft for internal review; scheduler cannot', () => {
    expect(checkTransition('editor', 'draft_uploaded', 'internal_review').ok).toBe(true)
    expect(checkTransition('scheduler', 'draft_uploaded', 'internal_review').ok).toBe(false)
  })
  it('only AM sends to client; editor cannot', () => {
    expect(checkTransition('account_manager', 'internal_review', 'client_review').ok).toBe(true)
    expect(checkTransition('editor', 'internal_review', 'client_review').ok).toBe(false)
  })
  it('client can approve or request changes only from client_review', () => {
    expect(checkTransition('client', 'client_review', 'approved_for_scheduling').ok).toBe(true)
    expect(checkTransition('client', 'client_review', 'client_changes_requested').ok).toBe(true)
    expect(checkTransition('client', 'internal_review', 'client_review').ok).toBe(false)
  })
  it('scheduler gating: cannot touch anything before approved_for_scheduling', () => {
    for (const from of ITEM_STATUSES.filter(s => !SCHEDULER_STATUSES.includes(s))) {
      for (const to of ITEM_STATUSES) {
        const res = checkTransition('scheduler', from, to)
        expect(res.ok).toBe(false)
      }
    }
  })
  it('illegal jumps are rejected for everyone including super_admin', () => {
    expect(checkTransition('super_admin', 'draft_uploaded', 'published').ok).toBe(false)
    expect(checkTransition('super_admin', 'draft_uploaded', 'scheduled').ok).toBe(false)
  })
  it('super_admin can perform any defined transition', () => {
    expect(checkTransition('super_admin', 'internal_review', 'client_review').ok).toBe(true)
    expect(checkTransition('super_admin', 'scheduled', 'published').ok).toBe(true)
  })
})

describe('availableTransitions', () => {
  it('editor sees only the submit action from draft', () => {
    const av = availableTransitions('editor', 'draft_uploaded')
    expect(av).toHaveLength(1)
    expect(av[0].to).toBe('internal_review')
    expect(av[0].requires).toBe('reviewable_asset')
  })
  it('AM sees three choices from internal_review', () => {
    const tos = availableTransitions('account_manager', 'internal_review').map(a => a.to).sort()
    expect(tos).toEqual(['approved_for_scheduling', 'client_review', 'revision_required'])
  })
  it('client sees nothing from internal statuses', () => {
    expect(availableTransitions('client', 'internal_review')).toHaveLength(0)
    expect(availableTransitions('client', 'revision_required')).toHaveLength(0)
  })
})

describe('versionSatisfiesSubmission — doc §11 validation', () => {
  it('passes with file upload + dropbox master', () => {
    expect(versionSatisfiesSubmission({ file_url: 'https://x/y.mp4', dropbox_url: 'https://dropbox/z' }).ok).toBe(true)
  })
  it('passes with drive link + dropbox master (no upload)', () => {
    expect(versionSatisfiesSubmission({ drive_url: 'https://drive/x', dropbox_url: 'https://dropbox/z' }).ok).toBe(true)
  })
  it('fails without any reviewable asset, naming what is missing', () => {
    const res = versionSatisfiesSubmission({ dropbox_url: 'https://dropbox/z' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.missing[0]).toMatch(/uploaded file or a Drive/)
  })
  it('fails without the dropbox master', () => {
    const res = versionSatisfiesSubmission({ file_url: 'https://x/y.mp4' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.missing[0]).toMatch(/Dropbox master/)
  })
  it('whitespace-only links do not count', () => {
    expect(versionSatisfiesSubmission({ file_url: '  ', dropbox_url: ' ' }).ok).toBe(false)
  })
})

describe('notification routing — the gatekeeper rule', () => {
  it('client change requests notify AMs, never the editor', () => {
    const audiences = TRANSITION_NOTIFICATIONS['client_review>client_changes_requested']
    expect(audiences).toContain('account_managers')
    expect(audiences).not.toContain('owner_editor')
  })
  it('schedulers are notified only at approval', () => {
    for (const [key, audiences] of Object.entries(TRANSITION_NOTIFICATIONS)) {
      if (audiences?.includes('schedulers')) {
        expect(key.endsWith('>approved_for_scheduling')).toBe(true)
      }
    }
  })
  it('the whole scheduling team is never blasted — only assigned schedulers', () => {
    for (const audiences of Object.values(TRANSITION_NOTIFICATIONS)) {
      expect(audiences).not.toContain('schedulers')
    }
  })
  it('every notified transition exists in the funnel', () => {
    for (const key of Object.keys(TRANSITION_NOTIFICATIONS)) {
      const [from, to] = key.split('>') as [ItemStatus, ItemStatus]
      expect(TRANSITIONS[from]?.[to], `${key} notifies but is not a legal transition`).toBeDefined()
    }
  })
  it('a manager can fix small client changes and resend directly', () => {
    expect(checkTransition('account_manager', 'client_changes_requested', 'client_review').ok).toBe(true)
    expect(checkTransition('editor', 'client_changes_requested', 'client_review').ok).toBe(false)
    expect(checkTransition('client', 'client_changes_requested', 'client_review').ok).toBe(false)
  })
  it("the owner hears about their item's client-facing moments", () => {
    expect(TRANSITION_NOTIFICATIONS['internal_review>client_review']).toContain('owner_editor')
    expect(TRANSITION_NOTIFICATIONS['client_review>approved_for_scheduling']).toContain('owner_editor')
    expect(TRANSITION_NOTIFICATIONS['scheduled>published']).toContain('owner_editor')
  })
})

describe('status dictionaries', () => {
  it('every status has a label, a meaning, and a defined turn', () => {
    for (const s of ITEM_STATUSES) {
      expect(STATUS_LABELS[s]).toBeTruthy()
      expect(STATUS_MEANING[s]).toBeTruthy()
      expect(s in STATUS_TURN).toBe(true)
    }
  })
  it('published is nobody’s turn — there is nothing left to do', () => {
    expect(STATUS_TURN.published).toBeNull()
  })
})

const ME = 'me'
const THEM = 'them'
const me = (role: Role) => ({ id: ME, role })

describe('actingRoles — hats are per item, not per job title', () => {
  const cases: [Role, string | null, string[], Role[]][] = [
    // editor
    ['editor', ME, [ME], ['editor', 'scheduler']],
    ['editor', ME, [THEM], ['editor']],
    ['editor', ME, [], ['editor']],
    ['editor', THEM, [ME], ['scheduler']],
    ['editor', THEM, [THEM], []],
    ['editor', THEM, [], []],
    ['editor', null, [ME], ['editor', 'scheduler']],
    ['editor', null, [THEM], ['editor']],
    ['editor', null, [], ['editor']],
    // account manager — the review hat is the job, and never per item
    ['account_manager', ME, [ME], ['account_manager', 'editor', 'scheduler']],
    ['account_manager', ME, [THEM], ['account_manager', 'editor']],
    ['account_manager', ME, [], ['account_manager', 'editor']],
    ['account_manager', THEM, [ME], ['account_manager', 'scheduler']],
    ['account_manager', THEM, [THEM], ['account_manager']],
    ['account_manager', THEM, [], ['account_manager']],
    ['account_manager', null, [ME], ['account_manager', 'editor', 'scheduler']],
    ['account_manager', null, [THEM], ['account_manager', 'editor']],
    ['account_manager', null, [], ['account_manager', 'editor']],
    // scheduler — the open editing pool is editors and AMs, never them
    ['scheduler', ME, [ME], ['editor', 'scheduler']],
    ['scheduler', ME, [THEM], ['editor']],
    ['scheduler', ME, [], ['editor', 'scheduler']],
    ['scheduler', THEM, [ME], ['scheduler']],
    ['scheduler', THEM, [THEM], []],
    ['scheduler', THEM, [], ['scheduler']],
    ['scheduler', null, [ME], ['scheduler']],
    ['scheduler', null, [THEM], []],
    ['scheduler', null, [], ['scheduler']],
  ]

  it.each(cases)('%s, owner=%s, scheduler_ids=%j → %j', (role, owner, ids, expected) => {
    expect(actingRoles(me(role), { owner_id: owner, scheduler_ids: ids })).toEqual(expected)
  })

  it('a client and a super admin are exactly themselves, whatever the item says', () => {
    const item = { owner_id: ME, scheduler_ids: [ME] }
    expect(actingRoles(me('client'), item)).toEqual(['client'])
    expect(actingRoles(me('super_admin'), item)).toEqual(['super_admin'])
  })

  it('a missing or malformed scheduler_ids is the same as nobody assigned', () => {
    for (const ids of [null, undefined, 'x', 42, {}]) {
      expect(actingRoles(me('scheduler'), { owner_id: THEM, scheduler_ids: ids }))
        .toEqual(actingRoles(me('scheduler'), { owner_id: THEM, scheduler_ids: [] }))
    }
  })

  it('an empty owner string counts as unowned', () => {
    expect(actingRoles(me('editor'), { owner_id: '', scheduler_ids: [] })).toEqual(['editor'])
  })
})

describe('checkTransitionAs — the assignment decides, not the title', () => {
  const hats = (role: Role, item: ActingItem) => actingRoles(me(role), item)

  it('an account manager who owns the item may do the editor move on it', () => {
    const roles = hats('account_manager', { owner_id: ME })
    expect(checkTransitionAs(roles, 'revision_required', 'revision_complete').ok).toBe(true)
  })

  it("an editor cannot submit another person's draft, but may submit an unowned one", () => {
    expect(hats('editor', { owner_id: THEM })).toEqual([])
    expect(checkTransitionAs(hats('editor', { owner_id: THEM }), 'draft_uploaded', 'internal_review').ok).toBe(false)
    expect(checkTransitionAs(hats('editor', { owner_id: null }), 'draft_uploaded', 'internal_review').ok).toBe(true)
  })

  it('an editor handed the scheduling schedules and publishes it', () => {
    const roles = hats('editor', { owner_id: THEM, scheduler_ids: [ME] })
    expect(checkTransitionAs(roles, 'approved_for_scheduling', 'scheduled').ok).toBe(true)
    expect(checkTransitionAs(roles, 'scheduled', 'published').ok).toBe(true)
  })

  it('a scheduler who was NOT handed it cannot act; one from the open pool can', () => {
    const handedElsewhere = hats('scheduler', { owner_id: THEM, scheduler_ids: [THEM] })
    expect(checkTransitionAs(handedElsewhere, 'approved_for_scheduling', 'scheduled').ok).toBe(false)
    const openPool = hats('scheduler', { owner_id: THEM, scheduler_ids: [] })
    expect(checkTransitionAs(openPool, 'approved_for_scheduling', 'scheduled').ok).toBe(true)
  })

  it('an account manager never gets the scheduling hat by default', () => {
    const roles = hats('account_manager', { owner_id: null, scheduler_ids: [] })
    expect(roles).not.toContain('scheduler')
    expect(checkTransitionAs(roles, 'approved_for_scheduling', 'scheduled').ok).toBe(false)
  })

  it('no hats at all can do nothing, and says so', () => {
    const r = checkTransitionAs([], 'draft_uploaded', 'internal_review')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('nobody may not perform "Submit for review"')
    for (const from of ITEM_STATUSES) {
      for (const to of ITEM_STATUSES) expect(checkTransitionAs([], from, to).ok).toBe(false)
    }
  })

  it('a super admin passes every defined edge and no undefined one', () => {
    for (const from of ITEM_STATUSES) {
      for (const to of ITEM_STATUSES) {
        expect(checkTransitionAs(['super_admin'], from, to).ok).toBe(Boolean(TRANSITIONS[from]?.[to]))
      }
    }
  })

  it('the single-role functions are the one-hat case of the set form', () => {
    const roles: Role[] = ['scheduler', 'editor', 'account_manager', 'super_admin', 'client']
    for (const role of roles) {
      for (const from of ITEM_STATUSES) {
        expect(availableTransitions(role, from)).toEqual(availableTransitionsAs([role], from))
        for (const to of ITEM_STATUSES) {
          expect(checkTransition(role, from, to)).toEqual(checkTransitionAs([role], from, to))
        }
      }
    }
  })
})

describe('availableTransitionsAs — the words follow the hat', () => {
  it("an account manager on a client review is LOGGING the client's decision", () => {
    const av = availableTransitionsAs(['account_manager'], 'client_review')
    expect(av.find(t => t.to === 'approved_for_scheduling')?.label).toBe("Log client's approval")
    expect(av.find(t => t.to === 'client_changes_requested')?.label).toBe("Log client's changes")
  })
  it('the client sees the plain words — it is their own decision', () => {
    const av = availableTransitionsAs(['client'], 'client_review')
    expect(av.find(t => t.to === 'approved_for_scheduling')?.label).toBe('Approve')
    expect(av.find(t => t.to === 'client_changes_requested')?.label).toBe('Request changes')
  })
})

describe('presentTransitions — one obvious button, or none', () => {
  const present = (role: Role, item: ActingItem, from: ItemStatus, ctx = { clientApprovalRequired: true, viewerIsOwner: false }) => {
    const roles = actingRoles(me(role), item)
    return presentTransitions(roles, from, availableTransitionsAs(roles, from), ctx)
  }

  it('never offers more than one primary, for any role in any state', () => {
    const roles: Role[] = ['scheduler', 'editor', 'account_manager', 'super_admin', 'client']
    for (const role of roles) {
      for (const from of ITEM_STATUSES) {
        for (const owner of [ME, THEM, null]) {
          const p = present(role, { owner_id: owner, scheduler_ids: [] }, from)
          expect(p.primary === null || typeof p.primary.to === 'string').toBe(true)
          if (p.primary) expect(p.secondary).not.toContain(p.primary)
        }
      }
    }
  })

  it('an account manager holding their own item in revisions gets one button', () => {
    const p = present('account_manager', { owner_id: ME }, 'revision_required')
    expect(p.primary).toEqual({ to: 'revision_complete', label: 'Revisions done', requires: 'reviewable_asset' })
    expect(p.secondary).toEqual([])
  })

  it('sending your own item back to yourself is named honestly', () => {
    const p = present('account_manager', { owner_id: ME }, 'revision_complete', { clientApprovalRequired: true, viewerIsOwner: true })
    expect(p.primary?.label).toBe('Looks good — send to client')
    expect(p.secondary.map(s => s.label)).toEqual(['Send back to myself'])
  })

  it('the client-bypass approval is hidden when the client must approve', () => {
    const strict = present('account_manager', { owner_id: THEM }, 'internal_review')
    expect(strict.secondary.concat(strict.primary ? [strict.primary] : []).map(t => t.to))
      .not.toContain('approved_for_scheduling')
    const relaxed = present('account_manager', { owner_id: THEM }, 'internal_review', { clientApprovalRequired: false, viewerIsOwner: false })
    expect(relaxed.secondary.map(t => t.to)).toContain('approved_for_scheduling')
  })

  it('a client review is the client’s move: they get the primary, the manager does not', () => {
    const client = present('client', { owner_id: THEM }, 'client_review')
    expect(client.primary?.label).toBe('Approve')
    const am = present('account_manager', { owner_id: THEM }, 'client_review')
    expect(am.primary).toBeNull()
    expect(am.secondary.map(t => t.label).sort())
      .toEqual(["Log client's approval", "Log client's changes"])
  })

  it('someone who does not hold the turn is urged to do nothing', () => {
    const p = present('account_manager', { owner_id: THEM }, 'draft_uploaded')
    expect(STATUS_TURN.draft_uploaded).toBe('editor')
    expect(p.primary).toBeNull()
    expect(p.secondary.map(t => t.to)).toEqual(['internal_review'])
  })

  it('every primary is the state’s point, not merely a legal move', () => {
    const p = present('scheduler', { owner_id: THEM, scheduler_ids: [ME] }, 'approved_for_scheduling')
    expect(p.primary?.to).toBe(PRIMARY_ACTION.approved_for_scheduling)
  })
})

describe('whoseTurn', () => {
  it('names the hat, whether it is mine, and whether the seat is empty', () => {
    expect(whoseTurn('internal_review', { owner_id: THEM }, me('account_manager')))
      .toEqual({ hat: 'account_manager', mine: true, unassigned: false })
    expect(whoseTurn('draft_uploaded', { owner_id: THEM }, me('editor')))
      .toEqual({ hat: 'editor', mine: false, unassigned: false })
    expect(whoseTurn('draft_uploaded', { owner_id: null }, me('editor')))
      .toEqual({ hat: 'editor', mine: true, unassigned: true })
    expect(whoseTurn('approved_for_scheduling', { owner_id: THEM, scheduler_ids: [] }, me('editor')))
      .toEqual({ hat: 'scheduler', mine: false, unassigned: true })
    expect(whoseTurn('approved_for_scheduling', { owner_id: THEM, scheduler_ids: [ME] }, me('editor')))
      .toEqual({ hat: 'scheduler', mine: true, unassigned: false })
    expect(whoseTurn('published', { owner_id: ME }, me('super_admin')))
      .toEqual({ hat: null, mine: false, unassigned: false })
  })

  it('a super admin can always take the turn', () => {
    expect(whoseTurn('client_review', { owner_id: THEM }, me('super_admin')).mine).toBe(true)
  })
})

describe('the vocabulary guard — no database words, no jargon on screen', () => {
  const labels = [
    ...Object.values(STATUS_LABELS),
    ...Object.values(BRIEF_KIND_LABELS),
    ...Object.values(TRANSITIONS).flatMap(outs => Object.values(outs ?? {}).flatMap(rule => [
      rule.label, ...Object.values(rule.labelFor ?? {}),
    ])),
    ...Object.values(BRIEF_TRANSITION_OVERRIDES).flatMap(o => ('blocked' in o ? [] : [o.label])),
  ]

  it.each(labels)('%s reads as English', label => {
    expect(label).not.toContain('_')
    expect(label.toLowerCase()).not.toContain('bypass')
  })

  it('a brief never talks about scheduling — it books a shoot', () => {
    for (const label of Object.values(BRIEF_KIND_LABELS)) {
      expect(label.toLowerCase()).not.toContain('schedul')
    }
  })
})
