import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { visibleItems } from '../app/lib/scope-client'

/**
 * THE CLIENT'S YES IS STILL THE EDITING SIDE'S (the owner, 15 Sep 2026:
 * "don't go on Ready to post — go to handover, mentioning client approved.
 * Don't notify the schedulers. This is still the editing part; it's the AM's
 * or super admin's duty to hand it over to a scheduler for posting").
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

describe('an approved card nobody has been handed is not a scheduler’s', () => {
  const sched = { id: 'u-sc', role: 'scheduler', client_id: null }
  const card = (extra: Record<string, unknown> = {}) => ({
    id: 'i1', client_id: 'c1', status: 'approved_for_scheduling', owner_id: 'u-ed', scheduler_ids: [], batch_id: null, ...extra,
  })
  const sees = (c: unknown) => visibleItems(sched as never, [c] as never, [], { schedulerPostFilter: true } as never).length
  it('not on their board until the manager hands it over; then only on the board of the one it went to', () => {
    expect(sees(card())).toBe(0)
    expect(sees(card({ scheduler_ids: ['u-sc'] }))).toBe(1)
    expect(sees(card({ scheduler_ids: ['u-other'] }))).toBe(0)
    expect(sees(card({ owner_id: 'u-sc' }))).toBe(1)
    // a booked or posted card is still theirs to see
    expect(sees(card({ status: 'scheduled', scheduler_ids: ['u-sc'] }))).toBe(1)
  })
})

describe('nobody with the scheduler hat hears until handed (source pins)', () => {
  it('the assigned_schedulers audience is empty when nobody was handed it, and the open-queue broadcast is gone', () => {
    const w = src('app/lib/workflow.ts')
    expect(w).toContain('return own ? [own] : []')
    expect(w).not.toContain("people = await resolveAudience('schedulers', item)")
    expect(w).not.toMatch(/u\.role === 'scheduler' && u\.active_status \}\)\n      \}/)
  })
  it('the history and the managers’ email say the client approved and that a hand-over is due', () => {
    const w = src('app/lib/workflow.ts')
    expect(w).toContain("export const CLIENT_APPROVED_LINE = 'Client approved — to be handed to a scheduler'")
    expect(w).toContain("const clientApproved = !system && actor.role === 'client' && from === 'client_review' && to === 'approved_for_scheduling'")
    expect(w).toContain('clientApproved ? CLIENT_APPROVED_LINE : check.rule.label')
    expect(w).toContain('clientApproved ? `Client approved: ${item.title} — hand it to a scheduler`')
    expect(w).toContain('clientApproved ? CLIENT_APPROVED_NEXT : whatHappensNext(to)')
  })
  it('the portal no longer relays an approval note to every scheduler', () => {
    const p = src('app/api/portal/act/route.ts')
    expect(p).not.toContain('approval-note scheduler notify')
    expect(p).not.toContain('Approved with a note')
  })
  it('the card page gives a manager Hand to… on the approved card, and the hand-over lands it in their Draft whatever kind of card', () => {
    const page = src('app/dashboard/editor/[id]/page.tsx')
    expect(page).toContain("const awaitingHand = String(item.status) === 'approved_for_scheduling' && item.deliver_only !== true")
    expect(page).toContain('Hand to…')
    expect(page).toContain('<HandToDialog card={handOpen ? card : null} viewer={viewer} onClose={() => setHandOpen(false)} />')
    const d = src('app/dashboard/board/BoardDialogs.tsx')
    expect(d).toContain("if (!approve && (card.status === 'approved_for_scheduling' || card.status === 'scheduled')) {")
    expect(d).not.toContain("adhoc_post === true\n        && (card.status === 'approved_for_scheduling'")
  })
})
