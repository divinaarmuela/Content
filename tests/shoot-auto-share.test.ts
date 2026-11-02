import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { autoShareReady, type SopShoot } from '../app/lib/shoot-sop-core'

/* ── the plan goes to the team by itself (the owner, 2 Nov 2026: "an automatic move to share to team involved
 *    after all steps are done and names of teams are added (and if no need for client approval)") ── */

const TODAY = '2026-09-11'
const complete = (over: Partial<SopShoot> = {}): SopShoot => ({
  id: 'b-1', client_id: 'c-1', title: 'Golf Day', status: 'brief', owner_id: 'am',
  shoot_date: '2026-09-21', call_time: '7:30 am', location: 'Royal Melbourne',
  shot_list: [{ id: 's1', text: 'Drone over the 1st', done: false }],
  planned_deliverables: [{ id: 'l1', title: 'Hero reel' }],
  objective: 'Launch the spring drive', script: 'Three talking points', talent: 'Sam',
  props_wardrobe: 'Club polos', editor_priorities: 'Hero reel first', edit_deadline: '2026-09-25',
  editor_id: 'ed', crew_ids: ['vg'],
  ...over,
})
const ready = (b: SopShoot, planReview = false) => autoShareReady(b, { today: TODAY, itemCount: 0, planReview })

describe('autoShareReady', () => {
  it('a finished plan with its people named goes', () => {
    expect(ready(complete())).toBe(true)
  })
  it('waits for a part still empty, and for the people', () => {
    expect(ready(complete({ objective: '' }))).toBe(false)
    expect(ready(complete({ editor_id: null, crew_ids: [] }))).toBe(false)
  })
  it('waits for the quality pass where the gate applies', () => {
    expect(ready(complete(), true)).toBe(false)
    expect(ready(complete({ plan_reviewed_at: '2026-09-10T00:00:00Z' }), true)).toBe(true)
  })
  it('waits for the client when they approve it first, or when it is out with them', () => {
    expect(ready(complete({ client_approval_needed: true }))).toBe(false)
    expect(ready(complete({ shared_with_client: true }))).toBe(false)
    expect(ready(complete({ shared_with_client: true, client_decision: 'changes' }))).toBe(false)
    expect(ready(complete({ client_approval_needed: true, shared_with_client: true, client_decision: 'approved' }))).toBe(true)
  })
  it('never shares twice, nor a closed shoot', () => {
    expect(ready(complete({ brief_shared_at: '2026-09-10T00:00:00Z' }))).toBe(false)
    expect(ready(complete({ status: 'wrapped' }))).toBe(false)
  })
  it('every door that can finish a plan asks: the shoot page save, the quality pass, the client approval', () => {
    for (const f of ['app/api/production/batches/[id]/route.ts', 'app/api/production/batches/[id]/plan-review/route.ts', 'app/api/portal/act/route.ts']) {
      expect(readFileSync(f, 'utf8')).toContain('autoShareIfReady(')
    }
  })
})
