import { describe, expect, it } from 'vitest'
import {
  availableTaskTransitionsAs, checkTaskTransitionAs, isInternalKind,
  TASK_DONE_STATUSES, TASK_KIND_LABELS, TASK_STATUS_TURN, taskStatusLabel,
} from '../app/lib/task-kind-core'
import { ITEM_STATUSES, presentTransitions } from '../app/lib/workflow-core'

describe('isInternalKind — a task is a kind with nothing to post', () => {
  it('is any no-media kind that is not a brief', () => {
    expect(isInternalKind({ slug: 'strategy', uses_media: false })).toBe(true)
    expect(isInternalKind({ slug: 'copy', uses_media: false })).toBe(true)
    expect(isInternalKind({ slug: 'edit', uses_media: true })).toBe(false)
    expect(isInternalKind({ slug: 'shoot_brief', uses_media: false })).toBe(false)
    expect(isInternalKind(null)).toBe(false)
    expect(isInternalKind({ slug: 'strategy' })).toBe(false)   // unknown media flag: not a task
  })
})

describe('task vocabulary', () => {
  it('names every status, ends at Done, and never says schedule', () => {
    for (const s of ITEM_STATUSES) {
      expect(TASK_KIND_LABELS[s]).toBeTruthy()
      expect(TASK_KIND_LABELS[s]).not.toMatch(/_|schedul|post/i)
    }
    expect(TASK_KIND_LABELS.approved_for_scheduling).toBe('Done')
    expect(TASK_KIND_LABELS.scheduled).toBe('Done')
    expect(TASK_KIND_LABELS.published).toBe('Done')
  })
  it('relabels only tasks', () => {
    expect(taskStatusLabel({ slug: 'strategy', uses_media: false }, 'draft_uploaded', 'Drafting')).toBe('In progress')
    expect(taskStatusLabel({ slug: 'edit', uses_media: true }, 'draft_uploaded', 'Drafting')).toBe('Drafting')
  })
  it('is nobody’s turn once done', () => {
    expect(TASK_STATUS_TURN.approved_for_scheduling).toBeNull()
    expect(TASK_STATUS_TURN.scheduled).toBeNull()
    expect(TASK_STATUS_TURN.internal_review).toBe('account_manager')
    for (const s of TASK_DONE_STATUSES) expect(TASK_STATUS_TURN[s]).toBeNull()
  })
})

describe('task transitions', () => {
  it('approving is the end — nothing to schedule or publish, for anyone', () => {
    expect(checkTaskTransitionAs(['super_admin'], 'approved_for_scheduling', 'scheduled').ok).toBe(false)
    expect(checkTaskTransitionAs(['scheduler'], 'approved_for_scheduling', 'scheduled').ok).toBe(false)
    expect(checkTaskTransitionAs(['super_admin'], 'scheduled', 'published').ok).toBe(false)
    expect(availableTaskTransitionsAs(['super_admin'], 'approved_for_scheduling')).toEqual([])
  })
  it('speaks task words on the approval edges', () => {
    const am = availableTaskTransitionsAs(['account_manager'], 'internal_review')
    expect(am.find(t => t.to === 'approved_for_scheduling')?.label).toBe('Approve — done')
    expect(am.find(t => t.to === 'client_review')?.label).toBe('Send to client')
    // the client's own yes is RECORDED, not given by the manager
    const fromClient = availableTaskTransitionsAs(['account_manager'], 'client_review')
    expect(fromClient.find(t => t.to === 'approved_for_scheduling')?.label).toBe('Client approved — mark done')
    const client = availableTaskTransitionsAs(['client'], 'client_review')
    expect(client.find(t => t.to === 'approved_for_scheduling')?.label).toBe('Client approved — mark done')
  })
  it('the editor hat submits, the AM hat reviews — same as an asset', () => {
    expect(checkTaskTransitionAs(['editor'], 'draft_uploaded', 'internal_review').ok).toBe(true)
    expect(checkTaskTransitionAs(['editor'], 'internal_review', 'approved_for_scheduling').ok).toBe(false)
    expect(checkTaskTransitionAs(['account_manager'], 'internal_review', 'revision_required').ok).toBe(true)
  })
  it('presents with the task turn table: no primary once done', () => {
    const p = presentTransitions(
      ['account_manager'], 'approved_for_scheduling',
      availableTaskTransitionsAs(['account_manager'], 'approved_for_scheduling'),
      { clientApprovalRequired: false }, TASK_STATUS_TURN,
    )
    expect(p.primary).toBeNull()
    expect(p.secondary).toEqual([])
  })
})
