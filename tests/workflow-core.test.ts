import { describe, it, expect } from 'vitest'
import {
  ITEM_STATUSES,
  TRANSITIONS,
  CLIENT_LABELS,
  SCHEDULER_STATUSES,
  checkTransition,
  availableTransitions,
  versionSatisfiesSubmission,
  TRANSITION_NOTIFICATIONS,
  type ItemStatus,
} from '../app/lib/workflow-core'

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
