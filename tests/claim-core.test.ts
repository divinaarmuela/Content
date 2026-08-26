import { describe, expect, it } from 'vitest'
import { claimDecision, needsNewVersion, type ClaimItem } from '../app/lib/claim-core'
import type { ItemStatus } from '../app/lib/workflow-core'

const item = (status: ItemStatus, is_brief = false): ClaimItem => ({ status, is_brief })
const who = (role: 'super_admin' | 'account_manager' | 'editor' | 'scheduler' | 'client') =>
  ({ id: 'u1', role } as const)

describe('claimDecision — the editor seat', () => {
  it('lets an editor take an unstarted draft', () => {
    expect(claimDecision(item('draft_uploaded'), who('editor'), 'editor')).toEqual({ ok: true })
  })

  it('lets an account manager and a super admin take one too', () => {
    expect(claimDecision(item('revision_required'), who('account_manager'), 'editor').ok).toBe(true)
    expect(claimDecision(item('internal_review'), who('super_admin'), 'editor').ok).toBe(true)
  })

  it('refuses a scheduler — editing is handed out, not picked up', () => {
    const r = claimDecision(item('draft_uploaded'), who('scheduler'), 'editor')
    expect(r).toEqual({ ok: false, status: 403, error: 'Editing work is handed to you, not picked up' })
  })

  it('refuses anything already past editing', () => {
    for (const s of ['approved_for_scheduling', 'scheduled', 'published'] as ItemStatus[]) {
      expect(claimDecision(item(s), who('editor'), 'editor'))
        .toEqual({ ok: false, status: 400, error: 'This one is past editing' })
    }
  })
})

describe('claimDecision — the scheduler seat', () => {
  it('lets a scheduler take an approved or scheduled item', () => {
    expect(claimDecision(item('approved_for_scheduling'), who('scheduler'), 'scheduler').ok).toBe(true)
    expect(claimDecision(item('scheduled'), who('scheduler'), 'scheduler').ok).toBe(true)
    expect(claimDecision(item('approved_for_scheduling'), who('super_admin'), 'scheduler').ok).toBe(true)
  })

  it('refuses a published item — there is nothing left to schedule', () => {
    expect(claimDecision(item('published'), who('scheduler'), 'scheduler'))
      .toEqual({ ok: false, status: 400, error: 'This one is not ready for scheduling yet' })
  })

  it('refuses anything pre-approval', () => {
    for (const s of ['draft_uploaded', 'internal_review', 'client_review'] as ItemStatus[]) {
      expect(claimDecision(item(s), who('scheduler'), 'scheduler').ok).toBe(false)
    }
  })

  it('refuses an editor or a manager — they are handed scheduling, never take it', () => {
    expect(claimDecision(item('approved_for_scheduling'), who('editor'), 'scheduler'))
      .toEqual({ ok: false, status: 403, error: 'Scheduling is handed to you, not picked up' })
    expect(claimDecision(item('approved_for_scheduling'), who('account_manager'), 'scheduler').ok).toBe(false)
  })

  it('checks the status before the role, so the message names the real problem', () => {
    const r = claimDecision(item('draft_uploaded'), who('account_manager'), 'scheduler')
    expect(r).toEqual({ ok: false, status: 400, error: 'This one is not ready for scheduling yet' })
  })
})

describe('claimDecision — the refusals that apply to both seats', () => {
  it('refuses every client account', () => {
    expect(claimDecision(item('draft_uploaded'), who('client'), 'editor'))
      .toEqual({ ok: false, status: 403, error: 'Client accounts cannot pick up work' })
    expect(claimDecision(item('approved_for_scheduling'), who('client'), 'scheduler').ok).toBe(false)
  })

  it('refuses a shoot brief — it belongs to the manager who wrote it', () => {
    expect(claimDecision(item('draft_uploaded', true), who('editor'), 'editor'))
      .toEqual({ ok: false, status: 400, error: 'A shoot brief is owned by its account manager' })
    expect(claimDecision(item('approved_for_scheduling', true), who('scheduler'), 'scheduler').ok).toBe(false)
  })
})

describe('needsNewVersion', () => {
  const requested = '2026-08-20T10:00:00.000Z'

  it('is satisfied by a version uploaded after the request', () => {
    expect(needsNewVersion('2026-08-20T10:00:01.000Z', requested)).toBe(false)
  })

  it('blocks when the newest version predates the request', () => {
    expect(needsNewVersion('2026-08-19T23:59:59.000Z', requested)).toBe(true)
  })

  it('blocks on an exact tie — same instant is not "since"', () => {
    expect(needsNewVersion(requested, requested)).toBe(true)
  })

  it('blocks when there is no version at all', () => {
    expect(needsNewVersion(null, requested)).toBe(true)
  })

  it('allows a legacy item with no recorded request', () => {
    expect(needsNewVersion(null, null)).toBe(false)
    expect(needsNewVersion('2020-01-01T00:00:00.000Z', null)).toBe(false)
  })
})
