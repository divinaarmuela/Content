import { describe, expect, it } from 'vitest'
import { planSendBackPatch, reviewAskPatch, reviewWords, reviewersFor, type SopShoot } from '../app/lib/shoot-sop-core'

/**
 * ASK FOR A REVIEW (13 Sep 2026): a general user writes the plan and asks
 * the account managers (or one person) to look at it. The "Aligned with the
 * strategist" tick after the ask is the sign-off.
 */
const AM = 'am', AM2 = 'am2', ME = 'me', ED = 'ed'
const managers = [
  { id: AM, role: 'account_manager', active_status: true },
  { id: AM2, role: 'super_admin', active_status: true },
  { id: ED, role: 'editor', active_status: true },
  { id: 'gone', role: 'account_manager', active_status: false },
]
const nameOf = (id: string | null | undefined) => ({ am: 'Karly', am2: 'Abby', me: 'Raina', ed: 'Sam' } as Record<string, string>)[String(id)] ?? null

describe('who is asked', () => {
  it('defaults to the active account managers and super admins on the client, never the asker', () => {
    expect(reviewersFor(ME, null, managers)).toEqual([AM, AM2])
    expect(reviewersFor(AM, [], managers)).toEqual([AM2])
  })
  it('a picked person wins, and the asker is never asked', () => {
    expect(reviewersFor(ME, [ED], managers)).toEqual([ED])
    expect(reviewersFor(ME, [ME, ED, ED], managers)).toEqual([ED])
  })
})

describe('the stamps and the line', () => {
  const base = { id: 'b', client_id: 'c', title: 'Golf', status: 'brief', owner_id: ME } as unknown as SopShoot
  it('stamps who asked, whom, and when', () => {
    expect(reviewAskPatch('2026-09-13T06:00:00Z', ME, [AM])).toMatchObject({ review_asked_at: '2026-09-13T06:00:00Z', review_asked_by: ME, review_asked_to: [AM], plan_sent_back_note: null })
  })
  it('reads "waiting on their tick" until the tick lands after the ask', () => {
    expect(reviewWords(base, nameOf)).toBeNull()
    const asked = { ...base, ...reviewAskPatch('2026-09-13T06:00:00Z', ME, [AM]) } as SopShoot
    expect(reviewWords(asked, nameOf)).toMatch(/^Review asked from Karly by Raina, .* — waiting on their tick$/)
    const ticked = { ...asked, aligned_at: '2026-09-13T08:00:00Z', aligned_by: AM } as SopShoot
    expect(reviewWords(ticked, nameOf)).toMatch(/^Reviewed and aligned by Karly/)
    // a tick from BEFORE the ask does not count as this review
    const stale = { ...asked, aligned_at: '2026-09-12T08:00:00Z', aligned_by: AM } as SopShoot
    expect(reviewWords(stale, nameOf)).toMatch(/waiting on their tick$/)
  })
})

/* ── THE QUALITY REVIEW GATE (13 Sep 2026) ─────────────────────────────── */

import {
  NO_QUALITY_CHECKER, PLAN_REVIEW_WORDS, goReady, planReviewChip, planReviewPassed, planReviewPatch, planReviewRequired,
  qualityCheckersOf, stampLines,
} from '../app/lib/shoot-sop-core'

const people = [
  { id: 'joy', role: 'quality_checker', active_status: true },
  { id: 'karly', role: 'account_manager', active_status: true, quality_reviewer: true },
  { id: 'abby', role: 'super_admin', active_status: true },
  { id: 'old', role: 'quality_checker', active_status: false },
]

describe('who the gate applies to', () => {
  const b = { created_by: 'x', owner_id: 'y' }
  it('an account manager’s or a general user’s plan needs the pass; a super admin’s does not', () => {
    expect(planReviewRequired(b, { createdByRole: 'account_manager', ownerRole: 'account_manager' })).toBe(true)
    expect(planReviewRequired(b, { createdByRole: 'general', ownerRole: 'super_admin' })).toBe(true)
    expect(planReviewRequired(b, { createdByRole: 'super_admin', ownerRole: 'general' })).toBe(true)
    expect(planReviewRequired(b, { createdByRole: 'super_admin', ownerRole: 'super_admin' })).toBe(false)
    // an old shoot with nobody on record is not held up
    expect(planReviewRequired({ created_by: null, owner_id: null }, {})).toBe(false)
    expect(planReviewRequired(b, {})).toBe(false)
    // "September 18th is created by an admin and didn't assign anyone" — no gate, no review row
    expect(planReviewRequired({ created_by: 'abby', owner_id: null }, { createdByRole: 'super_admin', ownerRole: null })).toBe(false)
    // "plans created by a super admin but assigned to an AM must have the
    // review process": the gate applies if EITHER the creator or the owner
    // is an account manager or a general user
    expect(planReviewRequired({ created_by: 'abby', owner_id: 'karly' }, { createdByRole: 'super_admin', ownerRole: 'account_manager' })).toBe(true)
    expect(planReviewRequired({ created_by: 'karly', owner_id: null }, { createdByRole: 'account_manager', ownerRole: null })).toBe(true)
    expect(planReviewRequired({ created_by: 'karly', owner_id: 'abby' }, { createdByRole: 'account_manager', ownerRole: 'super_admin' })).toBe(true)
    expect(planReviewRequired({ created_by: 'raina', owner_id: 'raina' }, { createdByRole: 'general', ownerRole: 'general' })).toBe(true)
  })
  it('the reviewers default to the active quality checkers, role or flag', () => {
    expect(qualityCheckersOf(people)).toEqual(['joy', 'karly'])
    expect(reviewersFor('karly', [], people, { quality: true })).toEqual(['joy'])
    expect(reviewersFor('me', ['abby'], people, { quality: true })).toEqual(['abby'])
    expect(NO_QUALITY_CHECKER).toMatch(/Team page/)
  })
})

describe('Go waits on the pass', () => {
  const plan = {
    id: 'b', client_id: 'c', title: 'Golf', status: 'brief', owner_id: 'karly', created_by: 'karly',
    shoot_date: '2026-09-30', call_time: '7:30 am', location: 'Royal', objective: 'x', script: 'x', talent: 'x',
    props_wardrobe: 'x', client_availability: 'x', editor_priorities: 'x', edit_deadline: '2026-10-02',
    shot_list: [{ id: 's', text: 'x', done: false }], planned_deliverables: [{ id: 'l', title: 'x' }],
    editor_id: 'sam', crew_ids: [], acknowledgements: [{ user_id: 'sam', at: 'x' }],
    aligned_at: 'x', client_confirmed_at: 'x', brief_shared_at: '2026-09-01T00:00:00Z',
  } as unknown as SopShoot
  it('refuses with one sentence until passed, and not at all when the gate does not apply', () => {
    expect(goReady(plan, { itemCount: 1, planReview: { required: true } }).reasons).toEqual([PLAN_REVIEW_WORDS])
    expect(goReady(plan, { itemCount: 1, planReview: { required: false } }).ok).toBe(true)
    // a super admin's own plan is never asked for the pass, asked or not
    const adminPlan = { ...plan, ...reviewAskPatch('t', 'abby', ['joy']) } as SopShoot
    expect(goReady(adminPlan, { itemCount: 1, planReview: { required: false } }).reasons).toEqual([])
    expect(goReady(plan, { itemCount: 1 }).ok).toBe(true)
    const passed = { ...plan, ...planReviewPatch('2026-09-13T06:00:00Z', 'joy', true) } as SopShoot
    expect(goReady(passed, { itemCount: 1, planReview: { required: true } }).ok).toBe(true)
  })
  it('the stamps, the chip and the words', () => {
    expect(planReviewPatch('t', 'joy', true)).toEqual({ plan_reviewed_at: 't', plan_reviewed_by: 'joy' })
    expect(planReviewPatch('t', 'joy', false)).toEqual({ plan_reviewed_at: null, plan_reviewed_by: null })
    expect(planReviewPassed(plan)).toBe(false)
    // no chip before anyone asks (13 Sep 2026: "Needs quality review … is wrong")
    expect(planReviewChip(plan, true)).toBeNull()
    expect(planReviewChip({ ...plan, review_asked_at: '2026-09-13T05:00:00Z' } as SopShoot, true)).toEqual({ tone: 'amber', text: 'Waiting on the quality checker' })
    expect(planReviewChip(plan, false)).toBeNull()
    const passed = { ...plan, plan_reviewed_at: '2026-09-13T06:00:00Z', plan_reviewed_by: 'joy' } as SopShoot
    expect(planReviewChip(passed, true)).toEqual({ tone: 'green', text: 'Passed quality review' })
    const n = (id: string | null | undefined) => (id === 'joy' ? 'Joy' : id === 'karly' ? 'Karly' : null)
    expect(reviewWords(plan, n, { planReview: true })).toBeNull()
    const asked = { ...plan, ...reviewAskPatch('2026-09-13T05:00:00Z', 'karly', ['joy']) } as SopShoot
    expect(reviewWords(asked, n, { planReview: true })).toMatch(/^Waiting on Joy since .* — asked by Karly$/)
    expect(reviewWords(passed, n, { planReview: true })).toMatch(/^Passed quality review by Joy, /)
    expect(stampLines(asked, n, { planReview: true }).find(l => l.key === 'plan_review')).toMatchObject({ done: false, text: expect.stringMatching(/^Waiting on the quality checker since/) })
    expect(stampLines(passed, n, { planReview: true }).find(l => l.key === 'plan_review')).toMatchObject({ done: true, text: expect.stringMatching(/^Passed quality review by Joy/) })
    expect(stampLines(plan, n).find(l => l.key === 'plan_review')).toBeUndefined()
  })
})

describe('sent back (13 Sep 2026)', () => {
  it('closes the ask, clears the pass and keeps the note; the next ask clears the note', () => {
    const back = planSendBackPatch('t', 'joy', '  The objective is missing  ')
    expect(back).toEqual({
      plan_reviewed_at: null, plan_reviewed_by: null,
      review_asked_at: null, review_asked_by: null, review_asked_to: null,
      plan_sent_back_at: 't', plan_sent_back_by: 'joy', plan_sent_back_note: 'The objective is missing',
    })
    expect(reviewAskPatch('u', 'am', ['joy'])).toMatchObject({ plan_sent_back_at: null, plan_sent_back_note: null })
  })
})
