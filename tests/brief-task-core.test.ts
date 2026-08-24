import { describe, expect, it } from 'vitest'
import {
  availableBriefTaskTransitions, briefSatisfiesSubmission, checkBriefTaskTransition, itemStatusLabel,
} from '../app/lib/brief-task-core'
import { checkTransition, type ItemStatus } from '../app/lib/workflow-core'
import { canCreateItemsUnder } from '../app/lib/batch-brief-core'

describe('itemStatusLabel', () => {
  it('relabels only the shoot-brief kind', () => {
    expect(itemStatusLabel('shoot_brief', 'draft_uploaded', 'Draft uploaded')).toBe('Shoot brief')
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
    if (r.ok) expect(r.rule.label).toBe('Submit brief for review')
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

describe('briefSatisfiesSubmission', () => {
  it('a link, a concept, or a shot list — any one is enough', () => {
    expect(briefSatisfiesSubmission({ brief_url: 'https://milanote.com/b' }, null).ok).toBe(true)
    expect(briefSatisfiesSubmission({}, { concept: 'Garden shoot, golden hour' }).ok).toBe(true)
    expect(briefSatisfiesSubmission({}, { shot_list: [{ id: 's1' }] }).ok).toBe(true)
    expect(briefSatisfiesSubmission({ brief_url: '  ' }, { concept: ' ', shot_list: [] }))
      .toMatchObject({ ok: false, missing: expect.stringContaining('brief link') })
  })
})

describe('canCreateItemsUnder with the shoot_brief kind', () => {
  it('AMs start a brief from nothing or attach to a planning shoot; never to a locked one', () => {
    expect(canCreateItemsUnder(null, 'account_manager', undefined, 'shoot_brief')).toBe(true)
    expect(canCreateItemsUnder('brief', 'super_admin', undefined, 'shoot_brief')).toBe(true)
    expect(canCreateItemsUnder('locked', 'account_manager', undefined, 'shoot_brief')).toBe(false)
    expect(canCreateItemsUnder(null, 'editor', undefined, 'shoot_brief')).toBe(false)
    expect(canCreateItemsUnder(null, 'scheduler', undefined, 'shoot_brief')).toBe(false)
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
    expect(share.ok && share.rule.label).toBe('Share the plan with the client')
    const approve = checkBriefTaskTransition('client', 'client_review', 'approved_for_scheduling')
    expect(approve.ok && approve.rule.label).toBe('Plan approved — ready to book')
    const bypass = checkBriefTaskTransition('account_manager', 'internal_review', 'approved_for_scheduling')
    expect(bypass.ok && bypass.rule.label).toBe('Approve the plan')
  })
  it('override edges keep their base role gates', () => {
    expect(checkBriefTaskTransition('editor', 'internal_review', 'client_review').ok).toBe(false)
    expect(checkBriefTaskTransition('scheduler', 'client_review', 'approved_for_scheduling').ok).toBe(false)
  })
})

describe('availableBriefTaskTransitions — buttons come from brief rules, not base roles', () => {
  it('an account manager sees "Mark revisions done" on a brief', () => {
    const ts = availableBriefTaskTransitions('account_manager', 'revision_required')
    expect(ts.map(t => t.to)).toContain('revision_complete')
    expect(ts.find(t => t.to === 'revision_complete')?.label).toBe('Mark revisions done')
  })
  it('a scheduler still sees nothing on a brief in revisions', () => {
    expect(availableBriefTaskTransitions('scheduler', 'revision_required')).toEqual([])
  })
  it('a booked brief never offers "publish"', () => {
    expect(availableBriefTaskTransitions('super_admin', 'scheduled').map(t => t.to)).not.toContain('published')
  })
})
