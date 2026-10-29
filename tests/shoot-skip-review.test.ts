import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { maySkipPlanReview, planReviewRequired } from '../app/lib/shoot-sop-core'

// 29 Oct 2026, Manal for StretchWorks: "I send to the client I don't send to anyone else to approve"; the owner: "allow
// shoot briefs to skip quality check please and run test end to end"
describe('no quality check needed', () => {
  const amPlan = { created_by: 'am1', owner_id: 'am1' }
  const roles = { createdByRole: 'account_manager', ownerRole: 'account_manager' }
  it('an account manager’s plan has the gate, until a manager says it needs no check', () => {
    expect(planReviewRequired(amPlan, roles)).toBe(true)
    expect(planReviewRequired({ ...amPlan, plan_review_skipped: true }, roles)).toBe(false)
    expect(planReviewRequired({ ...amPlan, plan_review_skipped: false }, roles)).toBe(true)
    expect(planReviewRequired({ ...amPlan, plan_review_skipped: null }, roles)).toBe(true)
  })
  it('only an account manager or a super admin may say so', () => {
    expect(maySkipPlanReview('account_manager')).toBe(true)
    expect(maySkipPlanReview('super_admin')).toBe(true)
    for (const r of ['editor', 'scheduler', 'general', 'client', null]) expect(maySkipPlanReview(r)).toBe(false)
  })
  it('the server refuses anyone else, keeps who and when, and writes it on the shoot’s history', () => {
    const s = readFileSync('app/api/production/batches/[id]/route.ts', 'utf8')
    expect(s).toContain("if (!maySkipPlanReview(user.role)) return NextResponse.json({ error: SKIP_REVIEW_REFUSED }, { status: 403 })")
    expect(s).toContain('patch.plan_review_skipped_by = on ? user.id : null')
    expect(s).toContain("action: patch.plan_review_skipped ? 'plan_review_skipped' : 'plan_review_skip_undone'")
  })
  it('every door that asks reads the one rule — the stage route, the review route, the page and the board', () => {
    for (const p of ['app/api/production/batches/[id]/stage/route.ts', 'app/api/production/batches/[id]/review/route.ts', 'app/api/production/batches/[id]/route.ts', 'app/dashboard/production/ShootStageBoard.tsx']) {
      expect(readFileSync(p, 'utf8')).toMatch(/planReviewRequired\((batch|b|s),/)
    }
  })
  it('the shoot page offers it to a manager, beside the quality review, until Go', () => {
    const s = readFileSync('app/dashboard/production/shoots/[id]/ShootSop.tsx', 'utf8')
    expect(s).toContain("{(gate || batch.plan_review_skipped === true) && !batch.go_at && !planReviewPassed(batch) && (")
    expect(s).toContain("onChange={on => void onPatch('plan_review_skipped', on)}")
  })
})
