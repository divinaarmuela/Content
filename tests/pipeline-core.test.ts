import { describe, expect, it } from 'vitest'
import {
  OBJECTIONS, QUALIFIERS, SOURCE_TAGS, STAGES, TOUCHES, daysOver, deadlineOf, exitState, limitWords, moveRefusal, moveStamps,
  nextStage, passesQualifiers, previousStage, sanitisePipelinePatch, scoreboard, stageOf, touchPlan, weekBounds,
} from '../app/lib/pipeline-core'

/* ── the acquisition doc, 17 Sep 2026, as the rules read it ─────────────── */

const DAY = 86_400_000
const T0 = Date.parse('2026-09-21T00:00:00.000Z')

describe('the seven stages', () => {
  it('are the doc’s seven, in order, each with an owner and a time limit', () => {
    expect(STAGES.map(s => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(STAGES.map(s => s.limitDays)).toEqual([1, 3, 1, 1, 3, 7, 14])
    expect(STAGES.find(s => s.key === 'signed')?.owner).toBe('Abby')
    expect(nextStage('new')?.key).toBe('qualified')
    expect(nextStage('delivered')).toBeNull()
    expect(previousStage('new')).toBeNull()
    expect(previousStage('qualified')?.key).toBe('new')
    expect(stageOf({ stage: 'nonsense' }).key).toBe('new')
  })
  it('a deal past its limit is named: the deadline, the days over, the words', () => {
    const entered = new Date(T0).toISOString()
    const lead = { stage: 'qualified', stage_entered_at: entered }
    expect(deadlineOf(lead)).toBe(new Date(T0 + 3 * DAY).toISOString())
    expect(daysOver(lead, T0 + DAY)).toBe(0)
    expect(limitWords(lead, T0 + DAY)).toBe('2 days left')
    expect(limitWords(lead, T0 + 3 * DAY - 1000)).toBe('due today')
    expect(daysOver(lead, T0 + 5 * DAY)).toBe(2)
    expect(limitWords(lead, T0 + 5 * DAY)).toBe('2 days over')
    // a lead that never moved entered New lead when it arrived; a parked one is never late
    expect(daysOver({ stage: null, created_at: entered }, T0 + 3 * DAY)).toBe(2)
    expect(daysOver({ stage: 'new', created_at: entered, not_now_at: entered }, T0 + 30 * DAY)).toBeNull()
    expect(limitWords({ stage: 'new', created_at: entered, not_now_at: entered }, T0)).toBe('Not now')
  })
})

describe('the exit rules', () => {
  it('read the deal’s own fields where the dashboard knows, and the person’s tick otherwise', () => {
    const base = { id: 'l1', stage: 'qualified' }
    expect(exitState(base).map(x => x.met)).toEqual([false, false, false])
    const ready = { ...base, qualifiers: { works_leads: true, budget: true, owner_on_call: true }, call_at: '2026-09-22T01:00:00.000Z', exit_ticks: { qualified: { 'Confirmation text sent': true } } }
    expect(exitState(ready).every(x => x.met)).toBe(true)
    expect(moveRefusal(ready)).toBeNull()
    expect(moveRefusal({ ...ready, call_at: null })).toBe('Not yet — call in divina’s calendar first.')
    expect(passesQualifiers({ qualifiers: { works_leads: true, budget: true } })).toBe(false)
    // stage 6 needs BOTH: signed and deposit — neither alone counts
    expect(moveRefusal({ id: 'l', stage: 'signed', signed_at: '2026-09-22T00:00:00.000Z' })).toBe('Not yet — deposit received first.')
    expect(moveRefusal({ id: 'l', stage: 'signed', signed_at: '2026-09-22T00:00:00.000Z', deposit_at: '2026-09-23T00:00:00.000Z' })).toBeNull()
  })
  it('a move stamps the stage, when it was entered, and the milestone it means', () => {
    expect(moveStamps('proposal', '2026-09-22T00:00:00.000Z')).toMatchObject({ stage: 'proposal', stage_entered_at: '2026-09-22T00:00:00.000Z', proposal_sent_at: '2026-09-22T00:00:00.000Z', not_now_at: null })
    expect(moveStamps('discovery', 'x').proposal_sent_at).toBeUndefined()
  })
})

describe('the follow-up cadence', () => {
  it('is the doc’s six touches, dated from the stage that triggers each, marked sent by the person', () => {
    expect(TOUCHES.map(t => t.day)).toEqual([0, 1, 2, 5, 10, 21])
    const sent = '2026-09-10T00:00:00.000Z'
    const lead = { id: 'l', stage: 'proposal', created_at: '2026-09-01T00:00:00.000Z', stage_entered_at: sent, proposal_sent_at: sent, call_at: '2026-09-05T00:00:00.000Z', touches: [{ day: 0, done_at: '2026-09-01T02:00:00.000Z' }] }
    const plan = touchPlan(lead, Date.parse('2026-09-17T00:00:00.000Z'))
    expect(plan[0].done_at).toBe('2026-09-01T02:00:00.000Z')
    expect(plan[3].due_at).toBe('2026-09-15T00:00:00.000Z')
    expect(plan[3].overdue).toBe(true)
    expect(plan[5].due_at).toBe('2026-10-01T00:00:00.000Z')
    expect(plan[5].overdue).toBe(false)
  })
})

describe('the Monday scoreboard', () => {
  it('counts the six numbers for one week, leads by source', () => {
    const w = { start: T0, end: T0 + 7 * DAY }
    const iso = (d: number) => new Date(T0 + d * DAY).toISOString()
    const leads = [
      { id: 'a', created_at: iso(1), source: 'web_form', stage: 'discovery', call_at: iso(2), proposal_sent_at: iso(3) },
      { id: 'b', created_at: iso(2), source_tag: 'partner', stage: 'signed', call_at: iso(3), proposal_sent_at: iso(4), signed_at: iso(5), deposit_at: iso(6), deal_value: 12000 },
      { id: 'c', created_at: iso(-3), source_tag: 'teardown', stage: 'qualified', call_at: iso(1), signed_at: iso(2), deal_value: 8000 },
      { id: 'd', created_at: iso(9), source_tag: 'referral' },
    ]
    const s = scoreboard(leads, w.start, w.end)
    expect(s.leadsIn).toBe(2)
    expect(s.leadsBySource).toEqual({ web_form: 1, partner: 1 })
    expect(s.callsHeld).toBe(2)
    expect(s.proposalsSent).toBe(2)
    expect(s.signed).toBe(2)
    expect(s.deposits).toBe(1)
    expect(s.averageValue).toBe(10000)
  })
  it('a week starts on Monday, Melbourne time', () => {
    // Wednesday 16 Sep 2026 22:00 Melbourne = 12:00 UTC
    const b = weekBounds(Date.parse('2026-09-16T12:00:00.000Z'))
    expect(new Date(b.start).toISOString()).toBe('2026-09-13T14:00:00.000Z') // Monday 14 Sep 00:00 AEST
    expect(b.end - b.start).toBe(7 * DAY)
  })
})

describe('what a PATCH may carry', () => {
  it('cleans the pipeline fields and refuses bad values by name', () => {
    expect(sanitisePipelinePatch({ tier: '2', source_tag: 'partner', partner: 'See the Label', deal_value: '12000', objection: 'think', qualifiers: { works_leads: true, other: true }, call_at: '2026-09-22T01:00:00Z', fname: 'ignored' }))
      .toEqual({ ok: true, patch: { tier: 2, source_tag: 'partner', partner: 'See the Label', deal_value: 12000, objection: 'think', qualifiers: { works_leads: true, budget: false, owner_on_call: false }, call_at: '2026-09-22T01:00:00.000Z' } })
    expect(sanitisePipelinePatch({ tier: 4 })).toEqual({ ok: false, error: 'Tier is 1, 2 or 3' })
    expect(sanitisePipelinePatch({ source_tag: 'carrier pigeon' })).toMatchObject({ ok: false })
    expect(sanitisePipelinePatch({ signed_at: 'yesterday' })).toEqual({ ok: false, error: 'Agreement signed is not a date' })
    expect(sanitisePipelinePatch({ signed_at: null })).toEqual({ ok: true, patch: { signed_at: null } })
    expect(SOURCE_TAGS.map(s => s.key)).toContain('teardown')
    expect(OBJECTIONS).toHaveLength(6)
    expect(QUALIFIERS).toHaveLength(3)
  })
})
