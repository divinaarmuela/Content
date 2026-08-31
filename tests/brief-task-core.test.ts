import { describe, expect, it } from 'vitest'
import {
  availableBriefTaskTransitions, BRIEF_STATUS_MEANING, BRIEF_STATUS_TURN, briefSatisfiesSubmission,
  checkBriefTaskTransition, checkBriefTaskTransitionAs, itemStatusLabel,
} from '../app/lib/brief-task-core'
import {
  checkTransition, ITEM_STATUSES, STATUS_TURN, whoseTurn, type ItemStatus,
} from '../app/lib/workflow-core'
import { canCreateItemsUnder } from '../app/lib/batch-brief-core'

describe('itemStatusLabel', () => {
  it('relabels only the shoot-brief kind', () => {
    expect(itemStatusLabel('shoot_brief', 'draft_uploaded', 'Draft uploaded')).toBe('Plan being written')
    expect(itemStatusLabel('shoot_brief', 'scheduled', 'Scheduled')).toBe('Shoot booked')
    expect(itemStatusLabel('shoot_brief', 'published', 'Published')).toBe('Shoot booked')
    expect(itemStatusLabel('edit', 'draft_uploaded', 'Draft uploaded')).toBe('Draft uploaded')
    expect(itemStatusLabel(null, 'scheduled', 'Scheduled')).toBe('Scheduled')
  })
})

describe('checkBriefTaskTransition', () => {
  it('overrides the submit edge with its own words, AM allowed', () => {
    const r = checkBriefTaskTransition('account_manager', 'draft_uploaded', 'internal_review')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.rule.label).toBe('Send plan for review')
  })

  it('booking requires an account manager and carries the lock requirement', () => {
    const am = checkBriefTaskTransition('account_manager', 'approved_for_scheduling', 'scheduled')
    expect(am).toMatchObject({ ok: true, requires: 'batch_locked' })
    expect(checkBriefTaskTransition('editor', 'approved_for_scheduling', 'scheduled').ok).toBe(false)
    expect(checkBriefTaskTransition('scheduler', 'approved_for_scheduling', 'scheduled').ok).toBe(false)
    expect(checkBriefTaskTransition('super_admin', 'approved_for_scheduling', 'scheduled').ok).toBe(true)
  })

  it('a booked shoot never publishes — even for a super admin', () => {
    expect(checkBriefTaskTransition('super_admin', 'scheduled', 'published').ok).toBe(false)
  })

  it('non-overridden edges behave exactly like the base machine', () => {
    const edges: [ItemStatus, ItemStatus][] = [
      ['internal_review', 'revision_required'],
      ['internal_review', 'client_review'],
      ['client_review', 'approved_for_scheduling'],
      ['client_review', 'client_changes_requested'],
    ]
    const roles = ['scheduler', 'editor', 'account_manager', 'super_admin', 'client'] as const
    for (const [from, to] of edges) {
      for (const role of roles) {
        expect(checkBriefTaskTransition(role, from, to).ok).toBe(checkTransition(role, from, to).ok)
      }
    }
  })

  it('nonexistent edges stay nonexistent', () => {
    expect(checkBriefTaskTransition('super_admin', 'draft_uploaded', 'published').ok).toBe(false)
  })
})

describe('checkBriefTaskTransitionAs — booking is the account manager hat, wherever it comes from', () => {
  it('an editor who is also handed the scheduling never books a shoot', () => {
    const r = checkBriefTaskTransitionAs(['editor', 'scheduler'], 'approved_for_scheduling', 'scheduled')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('Book the shoot')
  })

  it('an account manager who also owns the brief books it, lock and all', () => {
    expect(checkBriefTaskTransitionAs(['account_manager', 'editor'], 'approved_for_scheduling', 'scheduled'))
      .toMatchObject({ ok: true, requires: 'batch_locked' })
  })

  it('no hats at all can do nothing', () => {
    expect(checkBriefTaskTransitionAs([], 'draft_uploaded', 'internal_review').ok).toBe(false)
  })

  it('the single-role function is the one-hat case of the set form', () => {
    const roles = ['scheduler', 'editor', 'account_manager', 'super_admin', 'client'] as const
    const edges: [ItemStatus, ItemStatus][] = [
      ['draft_uploaded', 'internal_review'],
      ['internal_review', 'revision_required'],
      ['revision_required', 'revision_complete'],
      ['client_review', 'approved_for_scheduling'],
      ['approved_for_scheduling', 'scheduled'],
      ['scheduled', 'published'],
    ]
    for (const role of roles) {
      for (const [from, to] of edges) {
        expect(checkBriefTaskTransition(role, from, to))
          .toEqual(checkBriefTaskTransitionAs([role], from, to))
      }
    }
  })
})

describe('brief wording never speaks about scheduling', () => {
  it('the reject button has the same name here as everywhere else', () => {
    // "Request brief changes" / "Request changes" / "Needs more plan changes"
    // were three labels for one action, and nobody could tell them apart
    const r = checkBriefTaskTransition('account_manager', 'internal_review', 'revision_required')
    expect(r.ok && r.rule.label).toBe('Ask for changes')
    expect(checkBriefTaskTransition('editor', 'internal_review', 'revision_required').ok).toBe(false)
    const again = checkBriefTaskTransition('account_manager', 'revision_complete', 'revision_required')
    expect(again.ok && again.rule.label).toBe('Ask for more changes')
    expect(availableBriefTaskTransitions('account_manager', 'revision_complete')
      .find(t => t.to === 'revision_required')?.label).toBe('Ask for more changes')
  })

  it("the brief's turn ends with the account manager, never a scheduler", () => {
    expect(BRIEF_STATUS_TURN.approved_for_scheduling).toBe('account_manager')
    expect(BRIEF_STATUS_TURN.scheduled).toBeNull()
    expect(BRIEF_STATUS_TURN.published).toBeNull()
    expect(BRIEF_STATUS_TURN.internal_review).toBe(STATUS_TURN.internal_review)
  })

  it('writing and reworking a brief belongs to the account manager', () => {
    // the base pipeline hands both of these to an editor, which on a brief
    // read "Waiting on Unassigned — an account manager will pick it up" while
    // the account manager was the one writing it
    expect(STATUS_TURN.draft_uploaded).toBe('editor')
    expect(STATUS_TURN.revision_required).toBe('editor')
    expect(BRIEF_STATUS_TURN.draft_uploaded).toBe('account_manager')
    expect(BRIEF_STATUS_TURN.revision_required).toBe('account_manager')
  })

  it('so a brief in progress is never reported as an unclaimed seat', () => {
    const brief = { owner_id: null }
    const am = { id: 'am-1', role: 'account_manager' as const }
    for (const s of ['draft_uploaded', 'revision_required'] as ItemStatus[]) {
      const turn = whoseTurn(s, brief, am, BRIEF_STATUS_TURN)
      expect(turn.hat).toBe('account_manager')
      expect(turn.unassigned).toBe(false)
      expect(turn.mine).toBe(true)
    }
    // …and to anyone else it is plainly the account manager's move
    const editor = { id: 'ed-1', role: 'editor' as const }
    expect(whoseTurn('draft_uploaded', brief, editor, BRIEF_STATUS_TURN).mine).toBe(false)
  })

  it('every stage explains itself as a plan', () => {
    for (const s of ITEM_STATUSES) expect(BRIEF_STATUS_MEANING[s]).toBeTruthy()
    expect(BRIEF_STATUS_MEANING.approved_for_scheduling)
      .toBe('The plan is signed off. Book the shoot — pick the date on the shoot page.')
    expect(BRIEF_STATUS_MEANING.scheduled).toBe('The shoot is booked.')
  })
})

describe('briefSatisfiesSubmission', () => {
  it('a link, a concept, or a shot list — any one is enough', () => {
    expect(briefSatisfiesSubmission({ brief_url: 'https://milanote.com/b' }, null).ok).toBe(true)
    expect(briefSatisfiesSubmission({}, { concept: 'Garden shoot, golden hour' }).ok).toBe(true)
    expect(briefSatisfiesSubmission({}, { shot_list: [{ id: 's1' }] }).ok).toBe(true)
    expect(briefSatisfiesSubmission({ brief_url: '  ' }, { concept: ' ', shot_list: [] }))
      .toMatchObject({ ok: false, missing: expect.stringContaining('plan link') })
  })
})

describe('canCreateItemsUnder with the shoot_brief kind', () => {
  it('the team raises a brief against any shoot that is not finished', () => {
    expect(canCreateItemsUnder(null, 'account_manager', undefined, 'shoot_brief')).toBe(true)
    expect(canCreateItemsUnder('brief', 'super_admin', undefined, 'shoot_brief')).toBe(true)
    // a locked shoot with no brief used to be unreachable, and "New brief
    // task" quietly built a second shoot beside it
    expect(canCreateItemsUnder('locked', 'account_manager', undefined, 'shoot_brief')).toBe(true)
    expect(canCreateItemsUnder('shot', 'account_manager', undefined, 'shoot_brief')).toBe(true)
    expect(canCreateItemsUnder('wrapped', 'account_manager', undefined, 'shoot_brief')).toBe(false)
    // an editor who knows a shoot is needed writes it down themselves; whose
    // work it becomes is settled by assignment, not by the create gate
    expect(canCreateItemsUnder(null, 'editor', undefined, 'shoot_brief')).toBe(true)
    expect(canCreateItemsUnder(null, 'scheduler', undefined, 'shoot_brief')).toBe(true)
    expect(canCreateItemsUnder(null, 'client', undefined, 'shoot_brief')).toBe(false)
  })

  it('other kinds keep the original gate exactly', () => {
    expect(canCreateItemsUnder('locked', 'editor')).toBe(true)
    expect(canCreateItemsUnder('brief', 'editor')).toBe(false)
    expect(canCreateItemsUnder(null, 'account_manager', { reason: 'urgent' })).toBe(true)
    expect(canCreateItemsUnder(null, 'account_manager')).toBe(false)
  })
})

describe('plan-shaped wording on client-facing edges', () => {
  it('sharing and approving speak about the PLAN, not scheduling', () => {
    const share = checkBriefTaskTransition('account_manager', 'internal_review', 'client_review')
    expect(share.ok && share.rule.label).toBe('Share plan with client for approval')
    const approve = checkBriefTaskTransition('client', 'client_review', 'approved_for_scheduling')
    expect(approve.ok && approve.rule.label).toBe("Log the client's approval")
    const withoutClient = checkBriefTaskTransition('account_manager', 'internal_review', 'approved_for_scheduling')
    expect(withoutClient.ok && withoutClient.rule.label).toBe('Approve plan without client')
  })
  it('override edges keep their base role gates', () => {
    expect(checkBriefTaskTransition('editor', 'internal_review', 'client_review').ok).toBe(false)
    expect(checkBriefTaskTransition('scheduler', 'client_review', 'approved_for_scheduling').ok).toBe(false)
  })
})

describe('availableBriefTaskTransitions — buttons come from brief rules, not base roles', () => {
  it('an account manager sees "Plan changes done" on a shoot plan', () => {
    const ts = availableBriefTaskTransitions('account_manager', 'revision_required')
    expect(ts.map(t => t.to)).toContain('revision_complete')
    expect(ts.find(t => t.to === 'revision_complete')?.label).toBe('Plan changes done')
  })
  it('a scheduler still sees nothing on a brief in revisions', () => {
    expect(availableBriefTaskTransitions('scheduler', 'revision_required')).toEqual([])
  })
  it('a booked brief never offers "publish"', () => {
    expect(availableBriefTaskTransitions('super_admin', 'scheduled').map(t => t.to)).not.toContain('published')
  })
})
