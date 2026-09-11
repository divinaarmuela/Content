import { describe, expect, it } from 'vitest'
import {
  BRIEF_ITEMS, LATE_WORDS, SHOOT_STAGES, STAGE_LABEL, ackState, briefChecklist, briefIsLate, canSeeShoot,
  bookingPatch, clockWords, daysUntilShoot, goReady, handoverPlan, isOnShoot, lateNudgeTargets, peopleOnShoot, shootStage,
  stageMove, withAck, withoutAck, type SopShoot,
  briefItemSource, canvasSays, lateShareNudgeTargets, overrideWords, shareLeadDays, sharedLate, sharedLateWords,
  STAGE_STRIP, footageAfterWords, footageDueTargets, footageFolderFill, handoverReady, nextStepWords,
} from '../app/lib/shoot-sop-core'
import { planCardId, shootCardId } from '../app/lib/deliverable-group-core'

/* ── the Shoot Brief SOP (Team's Playbook §3), as the rules read it ────── */

const TODAY = '2026-09-11'
const AM = 'a1a1a1a1-0000-4000-8000-000000000001'
const ED = 'e1e1e1e1-0000-4000-8000-000000000001'
const VG = 'c1c1c1c1-0000-4000-8000-000000000001'

/** a brief with all nine parts filled, dated 10 days out */
const complete = (over: Partial<SopShoot> = {}): SopShoot => ({
  id: 'b-1', client_id: 'c-1', title: 'Golf Day', status: 'brief', owner_id: AM,
  shoot_date: '2026-09-21', call_time: '7:30 am', location: 'Royal Melbourne',
  shot_list: [{ id: 's1', text: 'Drone over the 1st', done: false }],
  planned_deliverables: [{ id: 'l1', title: 'Hero reel' }, { id: 'l2', title: 'Photo set' }],
  objective: 'Launch the spring membership drive — Community pillar',
  script: 'Three talking points, approved by the club',
  talent: 'Sam (presenter), confirmed',
  props_wardrobe: 'Club polos — Sam brings; flags — the club',
  client_availability: 'GM on site 8–10 am',
  editor_priorities: 'Hero reel first, 60 s, upbeat', edit_deadline: '2026-09-25',
  editor_id: ED, crew_ids: [VG],
  ...over,
})

describe('the nine things a brief must contain', () => {
  it('lists them in the SOP’s order and words', () => {
    expect(BRIEF_ITEMS.map(i => i.label)).toEqual([
      'Objective', 'Deliverables', 'Shot list', 'Script or talking points', 'Date, call time and location',
      'Talent or presenter', 'Props, wardrobe and setup', 'Client availability', 'Editor priorities and deadline',
    ])
  })
  it('counts what is filled and names what is missing, in plain words', () => {
    const list = briefChecklist(complete({ script: '', call_time: null, edit_deadline: null }))
    expect(list.filled).toBe(6)
    expect(list.words).toBe('6 of 9 filled')
    expect(list.missing.map(m => m.key)).toEqual(['script', 'when_where', 'editor'])
    expect(briefChecklist(complete()).words).toBe('Plan complete')
  })
  it('a deliverable is a line on the plan or a card pointed at the shoot', () => {
    expect(briefChecklist(complete({ planned_deliverables: [] })).missing.map(m => m.key)).toEqual(['deliverables'])
    expect(briefChecklist(complete({ planned_deliverables: [] }), { itemCount: 2 }).complete).toBe(true)
  })
})

describe('the six columns, read off the stamps and the calendar', () => {
  it('has the SOP timeline in order', () => {
    expect(SHOOT_STAGES.map(s => s.label)).toEqual([
      'Draft', 'Shared with team', 'Confirmed', 'Reminder sent', 'Shoot day', 'Footage handed over',
    ])
    expect(STAGE_LABEL.footage_handed).toBe('Footage handed over')
  })
  it('walks forward one stamp at a time', () => {
    const b = complete()
    expect(shootStage(b, TODAY)).toBe('drafting')
    expect(shootStage({ ...b, brief_shared_at: 'x' }, TODAY)).toBe('shared')
    expect(shootStage({ ...b, brief_shared_at: 'x', go_at: 'x' }, TODAY)).toBe('confirmed')
    expect(shootStage({ ...b, brief_shared_at: 'x', go_at: 'x', reminder_sent_at: 'x' }, TODAY)).toBe('reminder_sent')
    expect(shootStage({ ...b, go_at: 'x', reminder_sent_at: 'x', shoot_date: TODAY }, TODAY)).toBe('shoot_day')
    expect(shootStage({ ...b, footage_handed_at: 'x' }, TODAY)).toBe('footage_handed')
  })
  it('a shoot booked before the stamps existed is at least Shared; a closed one is past everything', () => {
    expect(shootStage(complete({ status: 'locked' }), TODAY)).toBe('shared')
    expect(shootStage(complete({ status: 'wrapped' }), TODAY)).toBe('footage_handed')
  })
  it('the calendar puts a shoot on Shoot day on the day, and keeps it there until the footage is handed over', () => {
    expect(shootStage(complete({ shoot_date: TODAY, go_at: 'x' }), TODAY)).toBe('shoot_day')
    expect(shootStage(complete({ shoot_date: '2026-09-01' }), TODAY)).toBe('shoot_day')
  })
})

describe('the 7-day clock', () => {
  it('counts the days and says when the brief is late', () => {
    expect(daysUntilShoot(complete(), TODAY)).toBe(10)
    expect(clockWords(complete(), TODAY)).toBe('10 days to the shoot')
    expect(briefIsLate(complete({ shoot_date: '2026-09-17' }), TODAY)).toBe(true)
    expect(clockWords(complete({ shoot_date: '2026-09-17' }), TODAY)).toBe(LATE_WORDS)
    // exactly 7 days out is on time
    expect(briefIsLate(complete({ shoot_date: '2026-09-18' }), TODAY)).toBe(false)
    // a shared brief is never late, however close the day
    expect(briefIsLate(complete({ shoot_date: '2026-09-12', brief_shared_at: 'x' }), TODAY)).toBe(false)
    expect(clockWords(complete({ shoot_date: '2026-09-12', brief_shared_at: 'x' }), TODAY)).toBe('Shoot is tomorrow')
    expect(clockWords(complete({ shoot_date: null }), TODAY)).toBe('No shoot date yet')
  })
  it('nudges a late shoot once', () => {
    const late = complete({ id: 'late', shoot_date: '2026-09-15' })
    const told = complete({ id: 'told', shoot_date: '2026-09-15', late_nudged_at: 'x' })
    const fine = complete({ id: 'fine' })
    expect(lateNudgeTargets([late, told, fine], TODAY).map(b => b.id)).toEqual(['late'])
  })
})

describe('acknowledgements', () => {
  it('everyone on the shoot — crew and editor, not the AM — reads the brief', () => {
    expect(peopleOnShoot(complete())).toEqual([VG, ED])
    const none = ackState(complete())
    expect(none.words).toBe('0 of 2 acknowledged')
    expect(none.missing).toEqual([VG, ED])
    const one = ackState(complete({ acknowledgements: withAck(complete(), VG, 'now') }))
    expect(one.words).toBe('1 of 2 acknowledged')
    expect(one.complete).toBe(false)
    expect(ackState(complete({ crew_ids: [], editor_id: null })).words).toBe('Nobody on the shoot yet')
  })
  it('one press, idempotent, and a manager can undo it', () => {
    const once = withAck(complete(), VG, 't1')
    const twice = withAck(complete({ acknowledgements: once }), VG, 't2')
    expect(twice).toEqual([{ user_id: VG, at: 't1' }])
    expect(withoutAck(complete({ acknowledgements: once }), VG)).toEqual([])
  })
})

describe('the Go sign-off (§3.4)', () => {
  it('needs all four: brief complete, aligned, client and location confirmed, every acknowledgement', () => {
    const r = goReady(complete())
    expect(r.ok).toBe(false)
    expect(r.reasons).toHaveLength(3)
    expect(r.reasons[0]).toMatch(/Aligned with the strategist/)
    const ready = complete({
      aligned_at: 'x', client_confirmed_at: 'x',
      acknowledgements: [{ user_id: VG, at: 'x' }, { user_id: ED, at: 'x' }],
    })
    expect(goReady(ready).ok).toBe(true)
    expect(goReady({ ...ready, objective: '' }).reasons[0]).toMatch(/not complete — objective/)
    expect(goReady({ ...ready, crew_ids: [], editor_id: null }).reasons[0]).toMatch(/nobody has been asked/)
  })
})

describe('dragging a shoot to a column', () => {
  const am = { role: 'account_manager' as const, today: TODAY }
  const ed = { role: 'editor' as const, today: TODAY }
  const now = '2026-09-11T02:00:00Z'

  it('Drafting → Shared needs the nine parts, and says which are missing', () => {
    const half = complete({ talent: '', props_wardrobe: null })
    const r = stageMove(half, 'shared', ed, now, ED)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/talent or presenter, props, wardrobe and setup still to fill in/)
    const ok = stageMove(complete(), 'shared', ed, now, ED)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.patch).toEqual({ brief_shared_at: now, brief_shared_by: ED })
  })
  it('only an account manager signs off as go, and only once everything is in', () => {
    const shared = complete({ brief_shared_at: 'x', aligned_at: 'x', client_confirmed_at: 'x', acknowledgements: [{ user_id: VG, at: 'x' }, { user_id: ED, at: 'x' }] })
    expect(stageMove(shared, 'confirmed', ed, now, ED)).toMatchObject({ ok: false, reason: expect.stringMatching(/account manager/) })
    expect(stageMove({ ...shared, aligned_at: null }, 'confirmed', am, now, AM)).toMatchObject({ ok: false, reason: expect.stringMatching(/Aligned/) })
    const go = stageMove(shared, 'confirmed', am, now, AM)
    expect(go.ok).toBe(true)
    // one sign-off: go BOOKS an unbooked, dated shoot as well
    if (go.ok) expect(go.patch).toEqual({ go_at: now, go_by: AM, status: 'locked', locked_at: now, locked_by: AM, month: 9, year: 2026 })
    // …and leaves a shoot the AM booked early exactly as booked
    const early = stageMove({ ...shared, status: 'locked' }, 'confirmed', am, now, AM)
    if (early.ok) expect(early.patch).toEqual({ go_at: now, go_by: AM })
    expect(bookingPatch({ status: 'brief', shoot_date: null }, now, AM)).toEqual({})
    expect(bookingPatch({ status: 'wrapped', shoot_date: '2026-09-21' }, now, AM)).toEqual({})
  })
  it('the reminder follows go; Shoot day is the calendar’s, never a drag', () => {
    expect(stageMove(complete({ brief_shared_at: 'x' }), 'reminder_sent', am, now, AM)).toMatchObject({ ok: false })
    expect(stageMove(complete({ brief_shared_at: 'x', go_at: 'x' }), 'reminder_sent', am, now, AM)).toMatchObject({ ok: true, patch: { reminder_sent_at: now } })
    expect(stageMove(complete({ go_at: 'x' }), 'shoot_day', am, now, AM)).toMatchObject({ ok: false, reason: expect.stringMatching(/calendar/) })
  })
  it('footage is handed over only after the day, to a named editor, with priorities and a deadline', () => {
    const shot = complete({ go_at: 'x', shoot_date: '2026-09-10' })
    expect(stageMove(complete({ go_at: 'x' }), 'footage_handed', ed, now, ED)).toMatchObject({ ok: false, reason: 'The shoot has not happened yet' })
    expect(stageMove({ ...shot, editor_id: null }, 'footage_handed', ed, now, ED)).toMatchObject({ ok: false, reason: expect.stringMatching(/Name the editor/) })
    expect(stageMove({ ...shot, edit_deadline: null }, 'footage_handed', ed, now, ED)).toMatchObject({ ok: false, reason: expect.stringMatching(/priorities and the deadline/) })
    expect(stageMove(shot, 'footage_handed', ed, now, ED)).toMatchObject({ ok: true, patch: { footage_handed_at: now, footage_handed_by: ED } })
  })
  it('moving back is a manager’s, clears the stamps past the column, and never crosses the calendar', () => {
    const far = complete({ brief_shared_at: 'x', go_at: 'x', reminder_sent_at: 'x' })
    expect(stageMove(far, 'drafting', ed, now, ED)).toMatchObject({ ok: false, reason: expect.stringMatching(/account manager/) })
    const back = stageMove(far, 'shared', am, now, AM)
    expect(back).toMatchObject({ ok: true, patch: { go_at: null, go_by: null, reminder_sent_at: null, footage_handed_at: null, footage_handed_by: null } })
    if (back.ok) expect(back.patch).not.toHaveProperty('brief_shared_at')
    expect(stageMove(complete({ shoot_date: TODAY }), 'shared', am, now, AM)).toMatchObject({ ok: false, reason: expect.stringMatching(/change the shoot date/) })
    expect(stageMove(complete({ status: 'wrapped' }), 'drafting', am, now, AM)).toMatchObject({ ok: false, reason: 'This shoot is closed' })
  })
  it('a scheduler and a client never move a shoot', () => {
    expect(stageMove(complete(), 'shared', { role: 'scheduler', today: TODAY }, now, 's')).toMatchObject({ ok: false })
    expect(stageMove(complete(), 'shared', { role: 'client', today: TODAY }, now, 'c')).toMatchObject({ ok: false })
  })
})

describe('the handover: Production → Editor', () => {
  const shot = complete({ shoot_date: '2026-09-10' })
  it('a shoot with no card yet gets ONE card, titled with the shoot, owned by the editor, briefed with the list and the priorities', () => {
    const plan = handoverPlan(shot, [])
    expect(plan.create.map(c => [c.title, c.owner_id, c.due_date, c.brief])).toEqual([
      ['Golf Day', ED, '2026-09-25', 'Coming out of this shoot:\n\u2022 Hero reel\n\u2022 Photo set\n\nPriorities: Hero reel first, 60 s, upbeat'],
    ])
    expect(plan.create[0].id).toBe(shootCardId('b-1'))
    expect(plan.fill).toEqual([])
    expect(plan.total).toBe(1)
  })
  it('a card that exists keeps what it has — only empty fields are filled — and the plan card is never handed over', () => {
    const items = [
      { id: planCardId('b-1', 'l1'), batch_id: 'b-1', owner_id: 'someone-else', due_date: null, brief: null },
      { id: planCardId('b-1', 'l2'), batch_id: 'b-1', owner_id: null, due_date: '2026-09-20', brief: 'keep me' },
      { id: 'plan', batch_id: 'b-1', owner_id: null, due_date: null, brief: null, work_kinds: { slug: 'shoot_brief' } },
      { id: 'other-shoot', batch_id: 'b-2', owner_id: null, due_date: null, brief: null },
    ]
    const plan = handoverPlan(shot, items)
    // an older shoot with one-per-line cards gets no new card — nothing doubled
    expect(plan.create).toEqual([])
    expect(plan.fill).toEqual([
      { id: planCardId('b-1', 'l1'), patch: { due_date: '2026-09-25', brief: 'Hero reel first, 60 s, upbeat' } },
      { id: planCardId('b-1', 'l2'), patch: { owner_id: ED } },
    ])
    // the editor holds the one card that became theirs; the other stays with someone else
    expect(plan.total).toBe(1)
  })
  it('is idempotent: after the handover, the same input plans nothing', () => {
    const first = handoverPlan(shot, [])
    const after = first.create.map(c => ({ id: c.id, batch_id: 'b-1', owner_id: c.owner_id, due_date: c.due_date, brief: c.brief }))
    expect(handoverPlan(shot, after)).toEqual({ create: [], fill: [], total: 1 })
  })
  it('a shoot with nothing listed makes no card yet', () => {
    expect(handoverPlan(complete({ planned_deliverables: [] }), [])).toEqual({ create: [], fill: [], total: 0 })
  })
})

describe('who sees a shoot', () => {
  const b = complete()
  it('a super admin sees everything; a general user any client', () => {
    expect(canSeeShoot({ id: 'x', role: 'super_admin' }, b, [])).toBe(true)
    expect(canSeeShoot({ id: 'x', role: 'general' }, b, [])).toBe(true)
  })
  it('the client’s team by assignment, and anyone on the shoot whichever client it is for', () => {
    expect(canSeeShoot({ id: 'x', role: 'account_manager' }, b, ['c-1'])).toBe(true)
    expect(canSeeShoot({ id: 'x', role: 'account_manager' }, b, ['c-9'])).toBe(false)
    expect(canSeeShoot({ id: AM, role: 'account_manager' }, b, [])).toBe(true)   // created it
    expect(canSeeShoot({ id: ED, role: 'editor' }, b, [])).toBe(true)            // the editor
    expect(canSeeShoot({ id: VG, role: 'scheduler' }, b, [])).toBe(true)         // on the crew
    expect(canSeeShoot({ id: 'nobody', role: 'editor' }, b, [])).toBe(false)
    expect(isOnShoot(b, VG)).toBe(true)
  })
  it('a client sees only their own shoots', () => {
    expect(canSeeShoot({ id: 'x', role: 'client', client_id: 'c-1' }, b, [])).toBe(true)
    expect(canSeeShoot({ id: 'x', role: 'client', client_id: 'c-2' }, b, [])).toBe(false)
  })
})

/* ── the plan built on the canvas counts (11 Sep 2026) ── */

describe('the checklist reads the canvas', () => {
  const card = (kind: string, text: string) => ({ id: text, kind, x: 0, y: 0, w: 200, z: 1, text })
  it('a heading or a card that names the shot list or the script ticks the item, and says where from', () => {
    const b = complete({ shot_list: [], script: '', canvas_cards: [card('label', 'Shot list'), card('note', 'Talking points: three, approved')] })
    expect(canvasSays(b)).toEqual({ shotList: true, script: true })
    expect(briefChecklist(b).complete).toBe(true)
    expect(briefItemSource(b, 'shot_list')).toBe('canvas')
    expect(briefItemSource(b, 'script')).toBe('canvas')
    // the fields still win the credit when they are filled
    expect(briefItemSource(complete(), 'shot_list')).toBe('field')
    expect(briefItemSource(complete({ shot_list: [], script: '', canvas_cards: [] }), 'shot_list')).toBeNull()
  })
  it('a picture, a link or an unrelated note is not a shot list', () => {
    const b = complete({ shot_list: [], script: '', canvas_cards: [card('image', 'shot list'), card('note', 'Mood: warm, golden hour'), { kind: 'note' }, null] })
    expect(canvasSays(b)).toEqual({ shotList: false, script: false })
    expect(briefChecklist(b).missing.map(m => m.key)).toEqual(['shot_list', 'script'])
    expect(canvasSays({ canvas_cards: 'nope' })).toEqual({ shotList: false, script: false })
  })
})

/* ── no brief, no shoot — enforced (11 Sep 2026) ── */

describe('a plan shared late', () => {
  const ready = (over: Partial<SopShoot> = {}) => complete({
    aligned_at: 'x', client_confirmed_at: 'x',
    acknowledgements: [{ user_id: VG, at: 'x' }, { user_id: ED, at: 'x' }],
    ...over,
  })
  it('counts the lead days and says the SOP sentence', () => {
    expect(shareLeadDays(complete({ brief_shared_at: '2026-09-17T09:00:00Z' }))).toBe(4)
    expect(sharedLate(complete({ brief_shared_at: '2026-09-17T09:00:00Z' }))).toBe(true)
    expect(sharedLate(complete({ brief_shared_at: '2026-09-14T09:00:00Z' }))).toBe(false)
    expect(sharedLate(complete())).toBe(false)
    expect(sharedLateWords(complete({ brief_shared_at: '2026-09-17T09:00:00Z' })))
      .toBe('The plan was shared 4 days before the shoot — the playbook needs 7. A super admin can override with a reason.')
  })
  it('an account manager cannot confirm it as go; a super admin can, with a reason, and it is kept', () => {
    const late = ready({ brief_shared_at: '2026-09-17T09:00:00Z' })
    const am = goReady(late, { role: 'account_manager' })
    expect(am.ok).toBe(false)
    expect(am.needsOverride).toBe(true)
    expect(am.reasons).toEqual([sharedLateWords(late)])
    expect(goReady(late, { role: 'super_admin' }).ok).toBe(false)
    expect(goReady(late, { role: 'super_admin', overrideReason: '  ' }).needsOverride).toBe(true)
    expect(goReady(late, { role: 'super_admin', overrideReason: 'Client moved the date' }).ok).toBe(true)
    // the override is only the last thing in the way — with more missing it is not offered
    expect(goReady({ ...late, aligned_at: null }, { role: 'account_manager' }).needsOverride).toBe(false)
    const refused = stageMove(late, 'confirmed', { role: 'super_admin', today: TODAY }, 'now', AM)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.needsOverride).toBe(true)
    const went = stageMove(late, 'confirmed', { role: 'super_admin', today: TODAY, overrideReason: 'Client moved the date' }, 'now', AM)
    expect(went.ok).toBe(true)
    if (went.ok) {
      expect(went.patch.go_override_reason).toBe('Client moved the date')
      expect(went.patch.go_override_by).toBe(AM)
      expect(went.label).toMatch(/went ahead late/)
    }
    expect(overrideWords({ go_override_reason: 'Client moved the date' })).toBe('Went ahead late — Client moved the date')
    expect(overrideWords({ go_override_reason: null })).toBeNull()
    // a plan shared on time carries no reason
    const onTime = stageMove(ready({ brief_shared_at: '2026-09-12T09:00:00Z' }), 'confirmed', { role: 'account_manager', today: TODAY }, 'now', AM)
    expect(onTime.ok).toBe(true)
    if (onTime.ok) expect(onTime.patch.go_override_reason).toBeUndefined()
  })
  it('a shoot already go is never re-judged, and Ops is nudged once about a late share', () => {
    const done = ready({ brief_shared_at: '2026-09-17T09:00:00Z', go_at: 'x' })
    expect(goReady(done, { role: 'account_manager' }).ok).toBe(true)
    const late = complete({ id: 'late', brief_shared_at: '2026-09-17T09:00:00Z' })
    const told = complete({ id: 'told', brief_shared_at: '2026-09-17T09:00:00Z', late_share_nudged_at: 'x' })
    const fine = complete({ id: 'fine', brief_shared_at: '2026-09-12T09:00:00Z' })
    const closed = complete({ id: 'closed', brief_shared_at: '2026-09-17T09:00:00Z', status: 'wrapped' })
    expect(lateShareNudgeTargets([late, told, fine, closed]).map(b => b.id)).toEqual(['late'])
  })
})

/* ── the flow, on the page: six stages and the one next move (11 Sep 2026) ── */

describe('the strip and the next step', () => {
  it('names the six stages in the SOP order, the last one short', () => {
    expect(STAGE_STRIP.map(s => s.label)).toEqual(['Draft', 'Shared with team', 'Confirmed', 'Reminder sent', 'Shoot day', 'Footage in'])
  })
  it('says what to do next, and who, at every stage', () => {
    const half = complete({ objective: null, script: null })
    expect(nextStepWords(half, TODAY)).toMatch(/^Next: fill in the plan — objective, script or talking points still to go/)
    expect(nextStepWords(half, TODAY)).toMatch(/Refused until all nine parts are filled/)
    expect(nextStepWords(complete(), TODAY)).toBe('Next: share the plan with the team. Everyone on it is emailed and asked to read it.')
    const shared = complete({ brief_shared_at: '2026-09-11T00:00:00Z' })
    expect(nextStepWords(shared, TODAY)).toMatch(/everyone on the shoot presses \u201cI\u2019ve read the plan\u201d — waiting on 2 of 2/)
    const acked = complete({ ...shared, acknowledgements: [{ user_id: ED, at: 'x' }, { user_id: VG, at: 'x' }] })
    expect(nextStepWords(acked, TODAY)).toMatch(/account manager ticks \u201cAligned with the strategist\u201d/)
    const ready = complete({ ...acked, aligned_at: 'x', client_confirmed_at: 'x' })
    expect(nextStepWords(ready, TODAY)).toMatch(/^Next: the account manager presses Go\. That books the shoot and puts the editor\u2019s card on the Editor page/)
    const late = complete({ ...ready, brief_shared_at: '2026-09-18T00:00:00Z' })
    expect(nextStepWords(late, TODAY)).toMatch(/shared 3 days before the shoot — the playbook needs 7/)
    const go = complete({ ...ready, go_at: 'x' })
    expect(nextStepWords(go, TODAY)).toMatch(/^Confirmed for 21 Sept\. The editor\u2019s card is on the Editor page, due 25 Sept\. Next: Ops presses Reminder sent/)
    expect(nextStepWords(complete({ ...go, reminder_sent_at: 'x' }), TODAY)).toMatch(/^Reminder sent\. Next: the shoot on 21 Sept/)
    expect(nextStepWords(complete({ ...go, reminder_sent_at: 'x' }), '2026-09-21')).toMatch(/^Shooting today\. The footage is handed to the editor tomorrow morning by itself/)
    expect(nextStepWords(complete({ ...go, reminder_sent_at: 'x' }), '2026-09-22')).toMatch(/^Shot\. The footage is handed to the editor this morning by itself/)
    expect(nextStepWords(complete({ ...go, footage_handed_at: 'x' }), '2026-09-22')).toMatch(/^Footage should be in — the editor has been told/)
  })
  it('the handover is ready once the editor, the priorities and the deadline are named', () => {
    expect(handoverReady(complete())).toBe(true)
    expect(handoverReady(complete({ editor_id: null }))).toBe(false)
    expect(handoverReady(complete({ edit_deadline: '' }))).toBe(false)
    expect(footageAfterWords(complete(), TODAY)).toBe('Shoot on 21 Sept — footage after that')
    expect(footageAfterWords(complete(), '2026-09-21')).toBe('Shooting today — footage after that')
    expect(footageAfterWords(complete(), '2026-09-22')).toBeNull()
  })
  it('the morning after a shoot, a confirmed shoot with an editor is handed over by itself; one without is asked for one', () => {
    const shot = complete({ go_at: 'x', brief_shared_at: 'x' })
    expect(footageDueTargets([shot], '2026-09-22').hand.map(b => b.id)).toEqual(['b-1'])
    // not before the day is gone, not twice, not once a person did it, not a closed shoot
    expect(footageDueTargets([shot], '2026-09-21').hand).toEqual([])
    expect(footageDueTargets([complete({ ...shot, footage_due_nudged_at: 'x' })], '2026-09-22').hand).toEqual([])
    expect(footageDueTargets([complete({ ...shot, footage_handed_at: 'x' })], '2026-09-22').hand).toEqual([])
    expect(footageDueTargets([complete({ ...shot, status: 'wrapped' })], '2026-09-22').hand).toEqual([])
    // a plan never confirmed is not handed to anyone by itself
    expect(footageDueTargets([complete()], '2026-09-22')).toEqual({ hand: [], askEditor: [] })
    const noEditor = complete({ ...shot, editor_id: null })
    expect(footageDueTargets([noEditor], '2026-09-22').askEditor.map(b => b.id)).toEqual(['b-1'])
  })
})

/* ── the footage folder reaches the cards (11 Sep 2026) ── */

describe('the footage folder', () => {
  it('goes onto every card from the shoot that has no folder yet, never the plan, never over a chosen one', () => {
    const b = complete({ footage_url: 'https://www.dropbox.com/scl/fo/golf' })
    const items = [
      { id: 'k1', batch_id: 'b-1', raw_assets_url: null },
      { id: 'k2', batch_id: 'b-1', raw_assets_url: 'https://drive.google.com/mine' },
      { id: 'plan', batch_id: 'b-1', raw_assets_url: null, work_kinds: { slug: 'shoot_brief' } },
      { id: 'other', batch_id: 'b-2', raw_assets_url: null },
    ]
    expect(footageFolderFill(b, items)).toEqual([{ id: 'k1', raw_assets_url: 'https://www.dropbox.com/scl/fo/golf' }])
    expect(footageFolderFill(complete(), items)).toEqual([])
  })
})
