import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROLE_LABEL, TEAM_ROLES, isQualityReviewer, mayPublish, roleSatisfies } from '../app/lib/identity-core'
import { actingRoles, checkTransitionAs } from '../app/lib/workflow-core'
import { defaultAllows } from '../app/lib/page-access-core'
import { mayFilterPeople } from '../app/lib/people-filter-core'
import { reviewerNameOf } from '../app/lib/editor-sop-core'
import { itemIsVisible } from '../app/lib/scope-client'
import { tutorialFor } from '../app/lib/tutorial-core'

/**
 * THE QUALITY CHECKER IS A ROLE (the owner, 13 Sep 2026: "quality check is
 * a role"). Joy's job title in the role list, with its own pages; the older
 * `quality_reviewer` flag on any other role keeps working; every gate asks
 * the ONE helper.
 */

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('the Quality checker role', () => {
  it('is on the ladder above editor and below general and account manager, and never publishes', () => {
    expect(TEAM_ROLES).toContain('quality_checker')
    expect(ROLE_LABEL.quality_checker).toBe('Quality checker')
    expect(roleSatisfies('quality_checker', 'editor')).toBe(true)
    expect(roleSatisfies('quality_checker', 'scheduler')).toBe(true)
    expect(roleSatisfies('quality_checker', 'general')).toBe(false)
    expect(roleSatisfies('quality_checker', 'account_manager')).toBe(false)
    expect(roleSatisfies('account_manager', 'quality_checker')).toBe(true)
    expect(roleSatisfies('editor', 'quality_checker')).toBe(false)
    expect(mayPublish('quality_checker')).toBe(false)
  })

  it('one helper answers "is this person the quality reviewer": the role, or the flag on another role', () => {
    expect(isQualityReviewer({ role: 'quality_checker' })).toBe(true)
    expect(isQualityReviewer({ role: 'account_manager', quality_reviewer: true })).toBe(true)
    expect(isQualityReviewer({ role: 'account_manager', quality_reviewer: false })).toBe(false)
    expect(isQualityReviewer({ role: 'editor' })).toBe(false)
    expect(isQualityReviewer(null)).toBe(false)
  })

  it('wears the quality hat on every item, so the gate moves are theirs and an editor’s are not', () => {
    const item = { owner_id: 'someone-else' }
    const qc = actingRoles({ id: 'joy', role: 'quality_checker' }, item)
    expect(qc).toContain('quality_reviewer')
    expect(qc).not.toContain('account_manager')
    expect(checkTransitionAs(qc, 'quality_check', 'client_review').ok).toBe(true)
    expect(checkTransitionAs(qc, 'quality_check', 'approved_for_scheduling').ok).toBe(true)
    expect(checkTransitionAs(qc, 'quality_check', 'revision_required').ok).toBe(true)
    // never the manager's moves
    expect(checkTransitionAs(qc, 'approved_for_scheduling', 'revision_required').ok).toBe(true) // the reviewer's way back, by rule
    expect(checkTransitionAs(qc, 'client_changes_requested', 'revision_required').ok).toBe(false)
    const ed = actingRoles({ id: 'ed', role: 'editor' }, item)
    expect(ed).not.toContain('quality_reviewer')
    expect(checkTransitionAs(ed, 'quality_check', 'client_review').ok).toBe(false)
  })

  it('holds Overview, Post approval and Editor by default — not Shoots, Clients, Schedule or Team', () => {
    for (const href of ['/dashboard', '/dashboard/scheduler', '/dashboard/editor', '/dashboard/notifications', '/dashboard/settings']) {
      expect(defaultAllows('quality_checker', href), href).toBe(true)
    }
    for (const href of ['/dashboard/production', '/dashboard/clients', '/dashboard/social/schedule', '/dashboard/team', '/dashboard/leads']) {
      expect(defaultAllows('quality_checker', href), href).toBe(false)
    }
  })

  it('may narrow a board to a person, and is the reviewer the editor’s chip names', () => {
    expect(mayFilterPeople({ role: 'quality_checker' })).toBe(true)
    expect(reviewerNameOf([
      { name: 'Ed', role: 'editor', active_status: true },
      { name: 'Joy', role: 'quality_checker', active_status: true },
    ])).toBe('Joy')
  })

  it('sees every card at Quality check whoever’s client it is, and nothing else of a client it is not on', () => {
    const viewer = { id: 'joy', role: 'quality_checker' as const, client_id: null }
    const gate = { id: 'i1', client_id: 'c-9', status: 'quality_check', owner_id: 'ed' }
    const draft = { id: 'i2', client_id: 'c-9', status: 'draft_uploaded', owner_id: 'ed' }
    expect(itemIsVisible(viewer, gate as never, [])).toBe(true)
    expect(itemIsVisible(viewer, draft as never, [])).toBe(false)
  })

  it('has its own tutorial, home on Post approval', () => {
    const t = tutorialFor('quality_checker')
    expect(t?.home).toBe('/dashboard/scheduler')
    expect(t?.steps[0].title).toBe('You are the quality check')
  })

  it('is in the Team page’s role picker, invite and edit alike', () => {
    const s = src('app/dashboard/team/page.tsx')
    expect(s.match(/<SelectItem value="quality_checker">Quality checker/g)?.length).toBe(2)
  })

  it('nothing reads the flag on its own any more — every gate asks the helper', () => {
    for (const p of [
      'app/lib/workflow-core.ts', 'app/lib/workflow.ts', 'app/lib/production-access.ts', 'app/lib/scope-client.ts',
      'app/lib/people-filter-core.ts', 'app/lib/editor-sop-core.ts', 'app/api/team/me/route.ts',
    ]) {
      const s = src(p)
      expect(s, p).not.toMatch(/\.quality_reviewer === true(?! \})/)
    }
  })
})
