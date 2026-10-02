import { describe, expect, it } from 'vitest'
import {
  BOOKED_FIRST, NOT_ON_ONE_PORTAL, approvalStepsOf, checkPostTransition, planPostTransition, readPostState,
  type PostActor, type PostState, type TransitionContext,
} from '../app/lib/post-stage-core'

/* ── the booked-first posting order behind clients.portal_one (docs/ONE_PORTAL_SPEC.md) ── */

const NOW_MS = Date.parse('2026-10-02T03:00:00.000Z')
const NOW = new Date(NOW_MS).toISOString()
const at = (min: number) => new Date(NOW_MS + min * 60_000).toISOString()
const ACCOUNTS = [{ id: 'acc-ig', platform: 'instagram', live: true }]
const OFF: TransitionContext = { now: NOW, accounts: ACCOUNTS, clientHasContact: true, client: { client_approval_required: true } }
const ON: TransitionContext = { ...OFF, client: { client_approval_required: true, portal_one: true }, bumpTo: at(30) }
const APPROVAL = { version: 1, by: 'u-qr', hat: 'quality_reviewer' as const, on_behalf_of_client: false, agreed_via: null, note: null, at: at(-60) }
const QC = { version: 1, by: 'u-qr', at: at(-60) }

function post(over: Partial<PostState> = {}): PostState {
  return {
    id: 'p1', client_id: 'c1', created_by: 'u-maker', stage: 'booked', rev: 3, stage_at: at(-30),
    draft_version: 2, sent_version: 1, scheduled_for: at(24 * 60), timezone: 'Australia/Melbourne',
    channels: ['acc-ig'], slides: [{ url: 'https://x.invalid/1.png', name: '1.png', type: 'image' }], caption: 'Hi', per_channel: {},
    approval_steps: null, approval: APPROVAL, qc_pass: QC, changes_asked: null, client_send: null, last_client_send: null,
    booking: { job_ids: ['job-1'], pending: false, at: at(-30), for_time: at(24 * 60) }, outcomes: {}, problem: null,
    cancelled: null, assigned_to: 'u-holder', source_item_id: 'i1', source_deleted: false, ...over,
  }
}
const CLIENT: PostActor = { id: null, hats: ['client'], name: 'the client' }
const QR: PostActor = { id: 'u-qr', hats: ['qr'] }

describe('the switch keeps every other client exactly as today', () => {
  it('the one portal moves are refused for a client not on it', () => {
    for (const action of ['client_ok', 'client_not_approved', 'set_if_no_answer'] as const) {
      const r = checkPostTransition(post(), action, action === 'set_if_no_answer' ? { id: 'u-am', hats: ['am'] } : CLIENT,
        { version: 1, note: 'x', if_no_answer: 'wait' }, OFF)
      expect(r).toMatchObject({ ok: false, code: 'portal', reason: NOT_ON_ONE_PORTAL })
    }
  })
  it('off: a sign-off client still goes team then client; on: always team, and "send to client" before booking is gone', () => {
    expect(approvalStepsOf({ approval_steps: null }, OFF.client)).toBe('team_then_client')
    expect(approvalStepsOf({ approval_steps: 'team_then_client' }, ON.client)).toBe('team')
    const qc = post({ stage: 'quality_check', approval: null, booking: null })
    expect(checkPostTransition(qc, 'pass_send_client', QR, { version: 1, delivered_to: ['a@b.c'] }, ON)).toMatchObject({ ok: false, code: 'portal', reason: BOOKED_FIRST })
    expect(checkPostTransition(qc, 'pass', QR, { version: 1 }, ON)).toMatchObject({ ok: true })
    expect(checkPostTransition(qc, 'pass', QR, { version: 1 }, OFF)).toMatchObject({ ok: false, code: 'steps' })
  })
  it('a post without the new fields reads exactly as before', () => {
    const p = readPostState({ id: 'p', client_id: 'c', stage: 'draft', channels: [], slides: [] })!
    expect(Object.keys(p)).not.toContain('client_review')
    expect(Object.keys(p)).not.toContain('if_no_answer')
  })
})

describe('the client approves a booked post (R3)', () => {
  it('records the answer, keeps the booking, tells the account managers', () => {
    const plan = planPostTransition(post(), 'client_ok', CLIENT, { version: 1, answered_by: 'Jordan' }, ON)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.to).toBe('booked')
    expect(plan.patch.client_review).toMatchObject({ version: 1, verdict: 'approved', by: 'Jordan' })
    expect(plan.patch.client_reviews).toHaveLength(1)
    expect(plan.patch.booking).toBeUndefined()
    expect(plan.effects).toContainEqual({ when: 'after', kind: 'notify', to: 'account_managers', action: 'client_ok' })
  })
  it('inside the last 15 minutes it moves to the next free slot first (R8)', () => {
    const late = post({ scheduled_for: at(10), booking: { job_ids: ['job-1'], pending: false, at: at(-30), for_time: at(10) } })
    const plan = planPostTransition(late, 'client_ok', CLIENT, { version: 1 }, ON)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.patch.scheduled_for).toBe(at(30))
    expect(plan.patch.approval?.version).toBe(2)
    expect(plan.effects[0]).toMatchObject({ kind: 'reschedule_jobs', job_ids: ['job-1'], for_time: at(30) })
    expect(plan.effects).toContainEqual(expect.objectContaining({ kind: 'freeze', frozen_for: 'retime', time: at(30) }))
    expect(checkPostTransition(late, 'client_ok', CLIENT, { version: 1 }, { ...ON, bumpTo: null })).toMatchObject({ ok: false, code: 'time' })
  })
  it('a stale version and a live post are refused', () => {
    expect(checkPostTransition(post(), 'client_ok', CLIENT, { version: 0 }, ON)).toMatchObject({ ok: false, code: 'version' })
    expect(checkPostTransition(post(), 'client_ok', CLIENT, { version: 1 }, { ...ON, liveOnJobs: ['instagram'] })).toMatchObject({ ok: false, code: 'live' })
  })
  it('a manager recording it says how the client answered', () => {
    const am: PostActor = { id: 'u-am', hats: ['am'], name: 'Renée' }
    expect(checkPostTransition(post(), 'client_ok', am, { version: 1 }, ON)).toMatchObject({ ok: false, code: 'agreed_via' })
    expect(checkPostTransition(post(), 'client_ok', am, { version: 1, agreed_via: 'whatsapp' }, ON)).toMatchObject({ ok: true })
  })
})

describe('Not approved (R4)', () => {
  it('takes it off, back to Draft for the quality check again, and tells the maker and the holder', () => {
    const plan = planPostTransition(post(), 'client_not_approved', CLIENT, { version: 1, note: 'Old logo' }, ON)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.to).toBe('draft')
    expect(plan.effects).toContainEqual({ when: 'before', kind: 'cancel_jobs', job_ids: ['job-1'] })
    expect(plan.patch).toMatchObject({ booking: null, approval: null, assigned_to: 'u-holder' })
    expect(plan.patch.changes_asked).toMatchObject({ who: 'client', to: 'u-holder', note: 'Old logo' })
    expect(plan.patch.client_review).toMatchObject({ verdict: 'not_approved', note: 'Old logo' })
    const people = plan.effects.filter(e => e.kind === 'notify' && e.to === 'person').map(e => (e as { person_id?: string }).person_id)
    expect(people).toEqual(['u-maker', 'u-holder'])
  })
  it('needs a note', () => {
    expect(checkPostTransition(post(), 'client_not_approved', CLIENT, { version: 1, note: ' ' }, ON)).toMatchObject({ ok: false, code: 'note' })
  })
})

describe('Wait for the client (R5, R7, R8)', () => {
  it('the team sets the choice', () => {
    const plan = planPostTransition(post({ stage: 'draft', sent_version: null, approval: null, booking: null }), 'set_if_no_answer',
      { id: 'u-maker', hats: ['creator'] }, { if_no_answer: 'wait' }, ON)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.patch.if_no_answer).toBe('wait')
  })
  it('15 minutes out with no approval it comes off, still approved by the team, and the maker and holder are told', () => {
    const due = post({ if_no_answer: 'wait', scheduled_for: at(10) })
    const plan = planPostTransition(due, 'hold_for_client', { id: null, hats: ['system'] }, {}, ON)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.to).toBe('ready')
    expect(plan.patch.booking).toBeNull()
    expect(plan.patch.approval).toBeUndefined()
    expect(checkPostTransition(post({ if_no_answer: 'wait', scheduled_for: at(40) }), 'hold_for_client', { id: null, hats: ['system'] }, {}, ON))
      .toMatchObject({ ok: false, code: 'time' })
  })
  it('approved late, it is booked for the next free slot', () => {
    const held = post({ stage: 'ready', if_no_answer: 'wait', booking: null, scheduled_for: at(-5) })
    const plan = planPostTransition(held, 'client_ok_book', CLIENT, { version: 1 }, ON)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.to).toBe('booked')
    expect(plan.patch.scheduled_for).toBe(at(30))
    expect(plan.effects).toContainEqual({ when: 'after', kind: 'queue_publish', for_time: at(30), now: false })
  })
})

describe('the pass books, bumping inside the last 15 minutes (R8)', () => {
  it('auto_book of a ready post due in 10 minutes books the next free slot', () => {
    const ready = post({ stage: 'ready', booking: null, scheduled_for: at(10) })
    const plan = planPostTransition(ready, 'auto_book', { id: null, hats: ['system'] }, {}, ON)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.patch.scheduled_for).toBe(at(30))
    expect(plan.effects).toContainEqual({ when: 'after', kind: 'queue_publish', for_time: at(30), now: false })
    // today's order: refused as too soon, exactly as before
    expect(checkPostTransition(ready, 'auto_book', { id: null, hats: ['system'] }, {}, OFF)).toMatchObject({ ok: false, code: 'time' })
  })
})
