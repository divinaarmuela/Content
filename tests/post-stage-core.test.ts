import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  POST_ACTIONS, POST_APPROVAL_LANES, POST_HATS, POST_STAGES, POST_TRANSITIONS, ROW_OF, SCHEDULE_LANES,
  STAGE_LABEL, STAGE_MEANING, STAGE_TONE, MISSED_LABEL, INSTAGRAM_MAX,
  approvalLine, approvalReminderTimes, approvalStepsOf, approveByOf, changesAskedLine, checkPostTransition,
  clientSendLine, commentVisibleTo, compositionProblems, defaultApproveBy, failedNetworks, hatsFor,
  instagramOverflow, laneOf, notesForFile, outcomeAction, outcomeVerdict, pageLaneOf, planPostTransition,
  postActions, postTone, postedWords, readPostState, slotMissed, waitingOn, waitingOnViewer,
  type AccountRef, type PostAction, type PostActor, type PostHat, type PostStage, type PostState,
  type TransitionContext, type TransitionInput,
} from '../app/lib/post-stage-core'
import {
  TEAM_ACT_ACTIONS, parsePostActRequest, postActPath, refusalStatus,
} from '../app/lib/post-act-contract'
import { JSON_ARRAY_COLUMNS, NULLABLE_COLUMNS, TABLE_COLUMNS } from '../lib/db-types'

/* ── fixtures ────────────────────────────────────────────────────────────── */

const NOW_MS = Date.parse('2026-09-29T00:00:00.000Z')
const NOW = new Date(NOW_MS).toISOString()
const at = (hours: number) => new Date(NOW_MS + hours * 3_600_000).toISOString()
const img = (i: number) => ({ url: `https://media.mdmmarketing.com.au/test/${i}.png`, name: `${i}.png`, type: 'image' as const })
const slides = (n: number) => Array.from({ length: n }, (_, i) => img(i + 1))

const ACCOUNTS: AccountRef[] = [
  { id: 'acc-ig', platform: 'instagram', live: true },
  { id: 'acc-li', platform: 'linkedin', live: true },
]
const CTX: TransitionContext = { now: NOW, accounts: ACCOUNTS, clientHasContact: true }

const QC_PASS = { version: 1, by: 'u-qr', at: at(-2) }
const TEAM_APPROVAL = { version: 1, by: 'u-qr', hat: 'quality_reviewer' as const, on_behalf_of_client: false, agreed_via: null, note: null, at: at(-2) }
const CLIENT_SEND = { version: 1, at: at(-1), to: ['jordan@example.invalid'], via: 'email' as const, approve_by: at(70), for_time: at(72) }
const BOOKING = { job_ids: ['job-1'], pending: false, at: at(-1), for_time: at(72) }
const pub = (status: 'published' | 'failed' | 'duplicate' | 'scheduled') => ({ status, url: status === 'published' ? 'https://example.invalid/p' : null, at: at(-1), error: status === 'failed' ? 'refused' : null })

/** A post in `stage` that satisfies every guard of the ordinary moves out of it. */
function post(stage: PostStage, over: Partial<PostState> = {}): PostState {
  const base: PostState = {
    id: 'post-1', client_id: 'client-1', created_by: 'u-maker', stage, rev: 5, stage_at: at(-5),
    draft_version: 2, sent_version: 1,
    scheduled_for: at(72), timezone: 'Australia/Melbourne', channels: ['acc-ig', 'acc-li'],
    slides: slides(3), caption: 'Where it started.', per_channel: {},
    approval_steps: null, approval: null, qc_pass: null, changes_asked: null, client_send: null,
    last_client_send: null, booking: null, outcomes: {}, problem: null, cancelled: null,
    assigned_to: null, source_item_id: 'item-1', source_deleted: false,
  }
  const byStage: Partial<Record<PostStage, Partial<PostState>>> = {
    draft: { sent_version: null, draft_version: 1 },
    quality_check: {},
    with_client: { qc_pass: QC_PASS, client_send: CLIENT_SEND },
    ready: { qc_pass: QC_PASS, approval: TEAM_APPROVAL },
    booked: { qc_pass: QC_PASS, approval: TEAM_APPROVAL, booking: BOOKING },
    posted: { qc_pass: QC_PASS, approval: TEAM_APPROVAL, booking: BOOKING, outcomes: { instagram: pub('published'), linkedin: pub('published') } },
    cancelled: { cancelled: { by: 'u-am', at: at(-1), from_stage: 'ready', reason: null } },
  }
  return { ...base, ...byStage[stage], ...over }
}

const actorFor = (hat: PostHat): PostActor => ({ id: hat === 'creator' ? 'u-maker' : `u-${hat}`, hats: [hat] })

/** The post and input that make `action` legal from `stage`. */
function goodCase(action: PostAction, stage: PostStage): { p: PostState; input: TransitionInput } {
  const input: TransitionInput = { expect_rev: 5, version: 1, confirm: true }
  let p = post(stage)
  switch (action) {
    case 'pass_send_client': case 'send_to_client':
      input.delivered_to = ['jordan@example.invalid']; break
    case 'resend_new_time':
      input.delivered_to = ['jordan@example.invalid']; input.scheduled_for = at(96); break
    case 'remind_client':
      input.delivered_to = ['jordan@example.invalid']; break
    case 'ask_change': case 'client_ask_change':
      input.note = 'Slide 2 has the old logo'; break
    case 'approve_for_client':
      input.agreed_via = 'call'; break
    case 'team_decides':
      input.note = 'The launch cannot wait'; break
    case 'change_time':
      input.scheduled_for = at(96); break
    case 'set_steps':
      // on a Ready post the team already approved, "team then the client" is refused (the way to show
      // the client is Send to client); "team only" is the good case there
      input.steps = stage === 'ready' ? 'team' : 'team_then_client'; break
    case 'cancel':
      if (stage === 'draft') p = post('draft', { sent_version: 1, draft_version: 2 }); break
    case 'missing_networks':
      p = post('posted', { outcomes: { instagram: pub('published'), linkedin: pub('failed') } }); break
    case 'booking_done':
      p = post('booked', { booking: { ...BOOKING, job_ids: [], pending: true } }); input.job_ids = ['job-2']; break
    case 'link_jobs':
      input.job_ids = ['job-2']; break
    case 'booking_failed':
      input.problem = 'The provider refused it'; break
    case 'record_posted':
      if (stage === 'posted') p = post('posted', { outcomes: { instagram: pub('published'), linkedin: pub('failed') } })
      input.outcomes = { instagram: pub('published'), linkedin: pub('published') }; input.platforms = ['instagram', 'linkedin']; break
    case 'record_partial':
      input.outcomes = { instagram: pub('published'), linkedin: pub('failed') }; input.platforms = ['instagram', 'linkedin']; break
    case 'record_failed':
      input.outcomes = { instagram: pub('failed'), linkedin: pub('failed') }; input.platforms = ['instagram', 'linkedin']; break
  }
  return { p, input }
}

const TEAM_ROLES = ['scheduler', 'general', 'account_manager', 'super_admin'] as const
const viewerHats = (role: string, over: { id?: string; quality_reviewer?: boolean } = {}) =>
  hatsFor({ id: over.id ?? 'u-other', role, quality_reviewer: over.quality_reviewer }, { created_by: 'u-maker' })

/* ── the table ───────────────────────────────────────────────────────────── */

describe('the transition table', () => {
  it('has exactly one row per action', () => {
    expect(POST_TRANSITIONS.map(r => r.action).sort()).toEqual([...POST_ACTIONS].sort())
  })

  it('has no way from Draft straight to the client — the quality check is required (owner decision 3)', () => {
    for (const row of POST_TRANSITIONS) {
      if (row.to === 'with_client') expect(row.from).not.toContain('draft')
    }
    const src = readFileSync('app/lib/post-stage-core.ts', 'utf8') + readFileSync('app/lib/post-act-contract.ts', 'utf8')
    expect(src).not.toMatch(/confirm_unchecked/)
  })

  for (const row of POST_TRANSITIONS) {
    for (const stage of row.from) {
      for (const hat of row.who) {
        it(`${row.spec} ${row.action}: ${stage} → ${row.to} as ${hat}`, () => {
          const { p, input } = goodCase(row.action, stage)
          const actor = actorFor(hat)
          const checked = checkPostTransition(p, row.action, actor, input, CTX)
          expect(checked).toMatchObject({ ok: true })
          const plan = planPostTransition(p, row.action, actor, input, CTX)
          if (!plan.ok) throw new Error(`${row.action} refused: ${plan.reason}`)
          const want = row.to === 'same' ? p.stage : row.to
          expect(plan.to).toBe(want)
          expect(plan.patch.rev).toBe(p.rev + 1)
          if (want !== 'deleted' && want !== p.stage) {
            expect(plan.patch.stage).toBe(want)
            expect(plan.patch.stage_at).toBe(NOW)
          } else {
            expect(plan.patch.stage).toBeUndefined()
          }
          expect(plan.event).toMatchObject({ id: `post-1_r${p.rev + 1}`, from: p.stage, to: want, action: row.action, hat })
        })
      }

      for (const hat of POST_HATS.filter(h => !row.who.includes(h))) {
        it(`${row.action} from ${stage} is refused for ${hat}`, () => {
          const { p, input } = goodCase(row.action, stage)
          expect(checkPostTransition(p, row.action, actorFor(hat), input, CTX)).toMatchObject({ ok: false, code: 'not_allowed' })
        })
      }
    }

    for (const stage of POST_STAGES.filter(s => !row.from.includes(s))) {
      it(`${row.action} is refused from ${stage}`, () => {
        const { input } = goodCase(row.action, row.from[0])
        const r = checkPostTransition(post(stage), row.action, actorFor(row.who[0]), input, CTX)
        expect(r).toMatchObject({ ok: false, code: 'wrong_stage' })
        if (!r.ok) expect(r.reason).toContain(STAGE_LABEL[stage])
      })
    }

    it(`${row.action}: a stale page is refused`, () => {
      const { p, input } = goodCase(row.action, row.from[0])
      expect(checkPostTransition(p, row.action, actorFor(row.who[0]), { ...input, expect_rev: 4 }, CTX))
        .toMatchObject({ ok: false, code: 'stale' })
    })

    if (row.versioned) {
      it(`${row.action}: the wrong or a missing version is refused`, () => {
        const { p, input } = goodCase(row.action, row.from[0])
        const actor = actorFor(row.who[0])
        expect(checkPostTransition(p, row.action, actor, { ...input, version: 2 }, CTX)).toMatchObject({ ok: false, code: 'version' })
        expect(checkPostTransition(p, row.action, actor, { ...input, version: null }, CTX)).toMatchObject({ ok: false, code: 'version' })
      })
    }
  }

  it('refuses an action that does not exist', () => {
    expect(checkPostTransition(post('draft'), 'approve', actorFor('sa'), {}, CTX)).toMatchObject({ ok: false, code: 'unknown_action' })
  })
})

/* ── who: the owner's decisions on roles ─────────────────────────────────── */

describe('hats', () => {
  it('maps roles to hats; editors are not in the posting flow', () => {
    expect(hatsFor({ id: 'u1', role: 'super_admin' }, { created_by: 'x' })).toEqual(['sa'])
    expect(hatsFor({ id: 'u1', role: 'account_manager' }, { created_by: 'x' })).toEqual(['am'])
    expect(hatsFor({ id: 'u1', role: 'account_manager', quality_reviewer: true }, { created_by: 'x' })).toEqual(['am', 'qr'])
    expect(hatsFor({ id: 'u1', role: 'general' }, { created_by: 'x' })).toEqual(['scheduler'])
    expect(hatsFor({ id: 'u1', role: 'scheduler' }, { created_by: 'u1' })).toEqual(['creator', 'scheduler'])
    expect(hatsFor({ id: 'u1', role: 'quality_checker' }, { created_by: 'x' })).toEqual(['qr'])
    expect(hatsFor({ id: 'u1', role: 'editor' }, { created_by: 'u1' })).toEqual([])
    expect(hatsFor({ id: null, role: 'client' }, { created_by: 'x' })).toEqual(['client'])
    expect(hatsFor(null, null)).toEqual([])
  })

  it('an account manager who is not the quality checker cannot pass a post (decision 3)', () => {
    const p = post('quality_check')
    const am: PostActor = { id: 'u-am', hats: viewerHats('account_manager') }
    expect(checkPostTransition(p, 'pass', am, { version: 1 }, CTX)).toMatchObject({ ok: false, code: 'not_allowed' })
    expect(checkPostTransition(p, 'pass_send_client', am, { version: 1 }, CTX)).toMatchObject({ ok: false, code: 'not_allowed' })
    const amReviewer: PostActor = { id: 'u-am', hats: viewerHats('account_manager', { quality_reviewer: true }) }
    expect(checkPostTransition(p, 'pass', amReviewer, { version: 1 }, CTX)).toMatchObject({ ok: true })
  })

  it('a scheduler may cancel any post, not only their own (decision 4)', () => {
    const scheduler: PostActor = { id: 'u-someone-else', hats: viewerHats('scheduler', { id: 'u-someone-else' }) }
    for (const stage of ['quality_check', 'with_client', 'ready', 'booked'] as PostStage[]) {
      expect(checkPostTransition(post(stage), 'cancel', scheduler, { confirm: true }, CTX)).toMatchObject({ ok: true })
    }
  })

  it('a scheduler books, moves and takes off the schedule; a quality checker does not', () => {
    const scheduler: PostActor = { id: 'u-s', hats: ['scheduler'] }
    const qr: PostActor = { id: 'u-q', hats: ['qr'] }
    expect(checkPostTransition(post('ready'), 'book', scheduler, {}, CTX)).toMatchObject({ ok: true })
    expect(checkPostTransition(post('booked'), 'change_time', scheduler, { scheduled_for: at(90) }, CTX)).toMatchObject({ ok: true })
    expect(checkPostTransition(post('booked'), 'unbook', scheduler, {}, CTX)).toMatchObject({ ok: true })
    expect(checkPostTransition(post('ready'), 'book', qr, {}, CTX)).toMatchObject({ ok: false, code: 'not_allowed' })
  })
})

/* ── approval ────────────────────────────────────────────────────────────── */

describe('approval', () => {
  it('a manager approving for the client is recorded as theirs, with how the client agreed — never "Client approved"', () => {
    const p = post('with_client')
    const am: PostActor = { id: 'u-akmal', hats: ['am'] }
    expect(checkPostTransition(p, 'approve_for_client', am, { version: 1 }, CTX)).toMatchObject({ ok: false, code: 'agreed_via' })
    expect(checkPostTransition(p, 'approve_for_client', am, { version: 1, agreed_via: 'other' }, CTX)).toMatchObject({ ok: false, code: 'note' })
    const plan = planPostTransition(p, 'approve_for_client', am, { version: 1, agreed_via: 'whatsapp' }, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.patch.approval).toMatchObject({ version: 1, by: 'u-akmal', hat: 'account_manager', on_behalf_of_client: true, agreed_via: 'whatsapp' })
    expect(plan.event.on_behalf_of_client).toBe(true)
    expect(plan.patch.client_send).toBeNull()
    expect(plan.patch.last_client_send).toEqual(CLIENT_SEND)
    const line = approvalLine(plan.patch.approval, id => (id === 'u-akmal' ? 'Akmal' : null))
    expect(line).toBe('Approved by Akmal for the client — on WhatsApp')
    expect(line).not.toMatch(/client approved/i)
  })

  it('the client\'s own yes reads "Approved by the client"; a pass reads as a pass', () => {
    const plan = planPostTransition(post('with_client'), 'client_approve', { id: null, hats: ['client'] }, { version: 1 }, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.patch.approval).toMatchObject({ hat: 'client', on_behalf_of_client: false, version: 1 })
    expect(approvalLine(plan.patch.approval)).toBe('Approved by the client')
    expect(approvalLine(TEAM_APPROVAL, () => 'joy')).toBe('Passed quality check — Joy')
    expect(approvalLine(null)).toBeNull()
  })

  it('a pass records the check and the approval for that version (a Schedule upload\'s pass is its approval)', () => {
    const plan = planPostTransition(post('quality_check'), 'pass', { id: 'u-joy', hats: ['qr'] }, { version: 1 }, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.to).toBe('ready')
    expect(plan.patch.qc_pass).toMatchObject({ version: 1, by: 'u-joy' })
    expect(plan.patch.approval).toMatchObject({ version: 1, hat: 'quality_reviewer' })
    expect(plan.words).toBe('Passed — now in Ready to post')
  })

  it('team then the client: the quality checker cannot pass it past the client; a super admin can', () => {
    const p = post('quality_check', { approval_steps: 'team_then_client' })
    expect(checkPostTransition(p, 'pass', { id: 'u-joy', hats: ['qr'] }, { version: 1 }, CTX)).toMatchObject({ ok: false, code: 'steps' })
    expect(checkPostTransition(p, 'pass', { id: 'u-sa', hats: ['sa'] }, { version: 1 }, CTX)).toMatchObject({ ok: true })
    const offered = postActions(p, ['qr'], NOW, { accounts: ACCOUNTS, clientHasContact: true })
    expect(offered.primary?.action).toBe('pass_send_client')
    expect(offered.secondary.map(a => a.action)).not.toContain('pass')
  })

  it('the client\'s default steps come from its existing flag; a post may override them', () => {
    expect(approvalStepsOf({ approval_steps: null })).toBe('team')
    expect(approvalStepsOf({ approval_steps: null }, { client_approval_required: true })).toBe('team_then_client')
    expect(approvalStepsOf({ approval_steps: 'team' }, { client_approval_required: true })).toBe('team')
    const p = post('quality_check')
    expect(checkPostTransition(p, 'pass', { id: 'u-joy', hats: ['qr'] }, { version: 1 }, { ...CTX, client: { client_approval_required: true } }))
      .toMatchObject({ ok: false, code: 'steps' })
  })

  it('Send to client from Ready needs this version passed, and not already approved by the client', () => {
    const am: PostActor = { id: 'u-am', hats: ['am'] }
    const input = { version: 1, delivered_to: ['jordan@example.invalid'] }
    expect(checkPostTransition(post('ready', { qc_pass: null }), 'send_to_client', am, input, CTX)).toMatchObject({ ok: false, code: 'unchecked' })
    expect(checkPostTransition(post('ready', { approval: { ...TEAM_APPROVAL, hat: 'client' } }), 'send_to_client', am, input, CTX))
      .toMatchObject({ ok: false, code: 'already' })
    const plan = planPostTransition(post('ready'), 'send_to_client', am, input, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.patch.approval).toBeNull()
    expect(plan.patch.client_send).toMatchObject({ version: 1, to: ['jordan@example.invalid'], via: 'email', for_time: at(72), approve_by: at(70) })
  })

  it('a client send is planned only once something reached the client (audit P9)', () => {
    const qr: PostActor = { id: 'u-joy', hats: ['qr'] }
    const p = post('quality_check')
    expect(checkPostTransition(p, 'pass_send_client', qr, { version: 1 }, CTX)).toMatchObject({ ok: true })
    expect(planPostTransition(p, 'pass_send_client', qr, { version: 1 }, CTX)).toMatchObject({ ok: false, code: 'delivery' })
    expect(planPostTransition(p, 'pass_send_client', qr, { version: 1, delivered_to: [] }, CTX)).toMatchObject({ ok: false, code: 'delivery' })
    expect(planPostTransition(p, 'pass_send_client', qr, { version: 1, via: 'link' }, CTX)).toMatchObject({ ok: true })
    expect(checkPostTransition(p, 'pass_send_client', qr, { version: 1 }, { ...CTX, clientHasContact: false })).toMatchObject({ ok: false, code: 'contact' })
  })

  it('a client send needs time for the client to answer', () => {
    const qr: PostActor = { id: 'u-joy', hats: ['qr'] }
    const soon = post('quality_check', { scheduled_for: at(0.1) })
    expect(checkPostTransition(soon, 'pass_send_client', qr, { version: 1 }, CTX)).toMatchObject({ ok: false, code: 'time' })
    expect(checkPostTransition(post('quality_check'), 'pass_send_client', qr, { version: 1, approve_by: at(-1) }, CTX)).toMatchObject({ ok: false, code: 'time' })
    expect(checkPostTransition(post('quality_check'), 'pass_send_client', qr, { version: 1, approve_by: at(80) }, CTX)).toMatchObject({ ok: false, code: 'time' })
  })

  it('asking for a change needs a note and goes to a named person (decision 9)', () => {
    const joy: PostActor = { id: 'u-joy', hats: ['qr'] }
    expect(checkPostTransition(post('quality_check'), 'ask_change', joy, { version: 1 }, CTX)).toMatchObject({ ok: false, code: 'note' })
    expect(checkPostTransition(post('quality_check', { created_by: null }), 'ask_change', joy, { version: 1, note: 'x' }, CTX))
      .toMatchObject({ ok: false, code: 'assignee' })
    const plan = planPostTransition(post('quality_check'), 'ask_change', joy, { version: 1, note: 'Fix slide 2' }, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.patch.changes_asked).toMatchObject({ who: 'team', by: 'u-joy', to: 'u-maker', note: 'Fix slide 2', version: 1 })
    expect(plan.patch.assigned_to).toBe('u-maker')
    expect(plan.effects).toContainEqual({ when: 'after', kind: 'notify', to: 'person', action: 'ask_change', person_id: 'u-maker' })
    expect(changesAskedLine(plan.patch.changes_asked, () => 'Joy')).toBe('Joy asked for a change')
  })

  it('the client asking for a change is recorded as the client\'s (audit B6, P13)', () => {
    const plan = planPostTransition(post('with_client'), 'client_ask_change', { id: null, hats: ['client'] }, { version: 1, note: 'Different photo' }, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.patch.changes_asked).toMatchObject({ who: 'client' })
    expect(changesAskedLine(plan.patch.changes_asked)).toBe('The client asked for a change')
    expect(plan.patch.client_send).toBeNull()
  })
})

/* ── frozen versions ─────────────────────────────────────────────────────── */

describe('versions', () => {
  it('sending for quality check freezes the working copy as the next version', () => {
    const plan = planPostTransition(post('draft'), 'send_to_qc', actorFor('creator'), {}, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.effects[0]).toEqual({ when: 'before', kind: 'freeze', n: 1, frozen_for: 'quality_check' })
    expect(plan.patch).toMatchObject({ sent_version: 1, draft_version: 2, stage: 'quality_check' })
    expect(plan.effects).toContainEqual({ when: 'after', kind: 'notify', to: 'quality_checkers', action: 'send_to_qc' })
  })

  it('an edit clears the approval and takes it off the client; the old version cannot then be approved (audit V6, V7)', () => {
    const plan = planPostTransition(post('with_client'), 'edit', actorFor('am'), {}, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.patch).toMatchObject({ stage: 'draft', approval: null, client_send: null, last_client_send: CLIENT_SEND })
    const after = { ...post('with_client'), ...plan.patch } as PostState
    expect(checkPostTransition(after, 'client_approve', { id: null, hats: ['client'] }, { version: 1 }, CTX))
      .toMatchObject({ ok: false, code: 'wrong_stage' })
  })

  it('a time-only change after approval keeps the approval on the re-timed version (decision 8)', () => {
    const scheduler: PostActor = { id: 'u-s', hats: ['scheduler'] }
    const p = post('ready')
    const plan = planPostTransition(p, 'change_time', scheduler, { scheduled_for: at(100) }, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.effects[0]).toEqual({ when: 'before', kind: 'freeze', n: 2, frozen_for: 'retime' })
    expect(plan.patch).toMatchObject({ sent_version: 2, draft_version: 3, scheduled_for: at(100) })
    expect(plan.patch.approval).toMatchObject({ version: 2, hat: 'quality_reviewer' })
    expect(plan.patch.qc_pass).toMatchObject({ version: 2 })
    expect(plan.event.note).toBe('Time changed after approval')
    const after = { ...p, ...plan.patch } as PostState
    expect(checkPostTransition(after, 'book', scheduler, {}, CTX)).toMatchObject({ ok: true })
  })

  it('a time change on a client-approved post tells the client; on a booked post the provider moves first', () => {
    const scheduler: PostActor = { id: 'u-s', hats: ['scheduler'] }
    const clientApproved = post('ready', { approval: { ...TEAM_APPROVAL, hat: 'client' } })
    const plan = planPostTransition(clientApproved, 'change_time', scheduler, { scheduled_for: at(100) }, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.effects).toContainEqual({ when: 'after', kind: 'notify', to: 'client', action: 'change_time' })
    const booked = planPostTransition(post('booked'), 'change_time', scheduler, { scheduled_for: at(100) }, CTX)
    if (!booked.ok) throw new Error(booked.reason)
    expect(booked.effects[0]).toEqual({ when: 'before', kind: 'reschedule_jobs', job_ids: ['job-1'], for_time: at(100) })
    expect(booked.patch.booking).toMatchObject({ job_ids: ['job-1'], for_time: at(100) })
    expect(booked.to).toBe('booked')
  })

  it('New time and resend freezes a re-timed version and sends it again', () => {
    const plan = planPostTransition(post('with_client'), 'resend_new_time', actorFor('am'),
      { scheduled_for: at(96), delivered_to: ['jordan@example.invalid'] }, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.patch).toMatchObject({ sent_version: 2, draft_version: 3, scheduled_for: at(96) })
    expect(plan.patch.client_send).toMatchObject({ version: 2, for_time: at(96), approve_by: at(94) })
  })
})

/* ── booking and the networks ────────────────────────────────────────────── */

describe('booking', () => {
  const scheduler: PostActor = { id: 'u-s', hats: ['scheduler'] }

  it('refuses to book a post whose current version is not approved (audit B2)', () => {
    expect(checkPostTransition(post('ready', { approval: null }), 'book', scheduler, {}, CTX)).toMatchObject({ ok: false, code: 'unapproved' })
    expect(checkPostTransition(post('ready', { sent_version: 2 }), 'book', scheduler, {}, CTX)).toMatchObject({ ok: false, code: 'unapproved' })
  })

  it('never books a time that has gone or is under 15 minutes away, and says Post now exists', () => {
    const soon = checkPostTransition(post('ready', { scheduled_for: at(0.1) }), 'book', scheduler, {}, CTX)
    expect(soon).toMatchObject({ ok: false, code: 'time' })
    if (!soon.ok) expect(soon.reason).toMatch(/Post now/)
    expect(checkPostTransition(post('ready', { scheduled_for: at(-1) }), 'book', scheduler, {}, CTX)).toMatchObject({ ok: false, code: 'time' })
    expect(checkPostTransition(post('ready', { scheduled_for: at(0.1) }), 'post_now', scheduler, { confirm: true }, CTX)).toMatchObject({ ok: true })
    expect(checkPostTransition(post('ready'), 'post_now', scheduler, {}, CTX)).toMatchObject({ ok: false, code: 'confirm' })
  })

  it('refuses to book onto a channel that is not connected (audit S13)', () => {
    const lost = { ...CTX, accounts: [ACCOUNTS[0], { ...ACCOUNTS[1], live: false }] }
    const r = checkPostTransition(post('ready'), 'book', scheduler, {}, lost)
    expect(r).toMatchObject({ ok: false, code: 'channels' })
    if (!r.ok) expect(r.reason).toMatch(/LinkedIn/)
    expect(checkPostTransition(post('ready'), 'book', scheduler, {}, { now: NOW })).toMatchObject({ ok: false, code: 'context' })
  })

  it('books in the order of SPEC §3.1: claim pending, queue after, then record the job or come back', () => {
    const plan = planPostTransition(post('ready'), 'book', scheduler, {}, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.patch.booking).toEqual({ job_ids: [], pending: true, at: NOW, for_time: at(72) })
    expect(plan.effects).toEqual([{ when: 'after', kind: 'queue_publish', for_time: at(72), now: false }])

    const pending = { ...post('ready'), ...plan.patch } as PostState
    const done = planPostTransition(pending, 'booking_done', { id: null, hats: ['system'] }, { job_ids: ['job-9'] }, CTX)
    if (!done.ok) throw new Error(done.reason)
    expect(done.patch.booking).toMatchObject({ job_ids: ['job-9'], pending: false })
    expect(done.to).toBe('booked')

    const failed = planPostTransition(pending, 'booking_failed', { id: null, hats: ['system'] }, { problem: 'The provider refused it' }, CTX)
    if (!failed.ok) throw new Error(failed.reason)
    expect(failed.to).toBe('ready')
    expect(failed.patch).toMatchObject({ booking: null, problem: 'The provider refused it' })
  })

  it('Post now books at this moment', () => {
    const plan = planPostTransition(post('ready'), 'post_now', scheduler, { confirm: true }, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.patch).toMatchObject({ scheduled_for: NOW, booking: { for_time: NOW, pending: true } })
    expect(plan.effects).toContainEqual({ when: 'after', kind: 'queue_publish', for_time: NOW, now: true })
  })

  it('re-send jobs are linked to their post (audit V11)', () => {
    const plan = planPostTransition(post('booked'), 'link_jobs', { id: null, hats: ['system'] }, { job_ids: ['job-1', 'child-1'] }, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.patch.booking?.job_ids).toEqual(['job-1', 'child-1'])
  })

  it('nothing that already went out can come off the schedule, be edited or be cancelled', () => {
    const partlyLive = post('booked', { outcomes: { instagram: pub('published') } })
    expect(checkPostTransition(partlyLive, 'unbook', scheduler, {}, CTX)).toMatchObject({ ok: false, code: 'live' })
    expect(checkPostTransition(partlyLive, 'edit_booked', scheduler, { confirm: true }, CTX)).toMatchObject({ ok: false, code: 'live' })
    expect(checkPostTransition(partlyLive, 'cancel', scheduler, { confirm: true }, CTX)).toMatchObject({ ok: false, code: 'live' })
    const dup = post('booked', { outcomes: { tiktok: pub('duplicate') } })
    expect(checkPostTransition(dup, 'unbook', scheduler, {}, CTX)).toMatchObject({ ok: false, code: 'live' })
  })

  it('taking a booked post off, editing it or cancelling it cancels its jobs first', () => {
    for (const [action, input] of [['unbook', {}], ['edit_booked', { confirm: true }], ['cancel', { confirm: true }]] as const) {
      const plan = planPostTransition(post('booked'), action, scheduler, input, CTX)
      if (!plan.ok) throw new Error(plan.reason)
      expect(plan.effects[0]).toEqual({ when: 'before', kind: 'cancel_jobs', job_ids: ['job-1'] })
      expect(plan.patch.booking).toBeNull()
    }
    expect(checkPostTransition(post('booked'), 'edit_booked', scheduler, {}, CTX)).toMatchObject({ ok: false, code: 'confirm' })
  })
})

describe('outcomes, per network', () => {
  it('reads the verdict across every targeted network', () => {
    const t = ['instagram', 'linkedin']
    expect(outcomeVerdict({}, t)).toBe('pending')
    expect(outcomeVerdict({ instagram: pub('published') }, t)).toBe('pending')
    expect(outcomeVerdict({ instagram: pub('published'), linkedin: pub('scheduled') }, t)).toBe('pending')
    expect(outcomeVerdict({ instagram: pub('published'), linkedin: pub('duplicate') }, t)).toBe('posted')
    expect(outcomeVerdict({ instagram: pub('published'), linkedin: pub('failed') }, t)).toBe('partial')
    expect(outcomeVerdict({ instagram: pub('failed'), linkedin: pub('failed') }, t)).toBe('failed')
    expect(outcomeAction({ instagram: pub('failed'), linkedin: pub('failed') }, t)).toBe('record_failed')
    expect(outcomeAction({ instagram: pub('published') }, t)).toBeNull()
  })

  it('a partial post is Posted with a problem, and reads "Posted on 1 of 2" (audit S7)', () => {
    const { p, input } = goodCase('record_partial', 'booked')
    const plan = planPostTransition(p, 'record_partial', { id: null, hats: ['system'] }, input, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.to).toBe('posted')
    expect(plan.patch.problem).toBe('Did not go out on LinkedIn.')
    const after = { ...p, ...plan.patch } as PostState
    expect(postedWords(after)).toBe('Posted on 1 of 2 — LinkedIn did not go out')
    expect(postedWords(post('posted'))).toBe('Posted')
    expect(failedNetworks(after)).toEqual(['linkedin'])
  })

  it('every network failing brings the post back to Ready with the reason', () => {
    const { p, input } = goodCase('record_failed', 'booked')
    const plan = planPostTransition(p, 'record_failed', { id: null, hats: ['system'] }, input, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.to).toBe('ready')
    expect(plan.patch).toMatchObject({ booking: null, problem: 'Did not go out on Instagram and LinkedIn.' })
  })

  it('refuses a record that does not match the answers', () => {
    const { p } = goodCase('record_posted', 'booked')
    expect(checkPostTransition(p, 'record_posted', { id: null, hats: ['system'] },
      { outcomes: { instagram: pub('published'), linkedin: pub('failed') }, platforms: ['instagram', 'linkedin'] }, CTX))
      .toMatchObject({ ok: false, code: 'outcome' })
  })

  it('Post the missing networks makes a new Ready post for the failed ones; Duplicate a new draft', () => {
    const { p } = goodCase('missing_networks', 'posted')
    const plan = planPostTransition(p, 'missing_networks', actorFor('scheduler'), {}, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.effects).toEqual([{ when: 'after', kind: 'create_post', stage: 'ready', platforms: ['linkedin'], carry_approval: true }])
    expect(plan.to).toBe('posted')
    expect(checkPostTransition(post('posted'), 'missing_networks', actorFor('scheduler'), {}, CTX)).toMatchObject({ ok: false, code: 'nothing_missing' })
    const dup = planPostTransition(post('cancelled'), 'duplicate', actorFor('scheduler'), {}, CTX)
    if (!dup.ok) throw new Error(dup.reason)
    expect(dup.effects).toEqual([{ when: 'after', kind: 'create_post', stage: 'draft', platforms: null, carry_approval: false }])
  })
})

/* ── delete, cancel, re-book ─────────────────────────────────────────────── */

describe('delete, cancel and re-book', () => {
  it('a draft that was never sent is deleted, not cancelled (audit S1)', () => {
    const fresh = post('draft')
    expect(checkPostTransition(fresh, 'cancel', actorFor('am'), { confirm: true }, CTX)).toMatchObject({ ok: false, code: 'use_delete' })
    const plan = planPostTransition(fresh, 'delete_draft', actorFor('creator'), { confirm: true }, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.to).toBe('deleted')
    expect(plan.effects).toEqual([{ when: 'instead', kind: 'delete_post' }])
    expect(plan.words).toBe('Draft deleted')
    expect(checkPostTransition(fresh, 'delete_draft', actorFor('creator'), {}, CTX)).toMatchObject({ ok: false, code: 'confirm' })
  })

  it('a post that was ever sent is cancelled, not deleted', () => {
    const sent = post('draft', { sent_version: 1, draft_version: 2 })
    expect(checkPostTransition(sent, 'delete_draft', actorFor('creator'), { confirm: true }, CTX)).toMatchObject({ ok: false, code: 'use_cancel' })
    expect(checkPostTransition(sent, 'cancel', actorFor('creator'), { confirm: true }, CTX)).toMatchObject({ ok: true })
    expect(checkPostTransition(sent, 'cancel', actorFor('creator'), {}, CTX)).toMatchObject({ ok: false, code: 'confirm' })
  })

  it('cancelling touches only this post, and records where it was (audit V2, V20)', () => {
    const plan = planPostTransition(post('ready'), 'cancel', actorFor('scheduler'), { confirm: true, reason: 'Client changed their mind' }, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.patch.cancelled).toEqual({ by: 'u-scheduler', at: NOW, from_stage: 'ready', reason: 'Client changed their mind' })
    expect(plan.effects.filter(e => e.kind === 'create_post' || e.kind === 'delete_post')).toEqual([])
  })

  it('a cancelled post is re-booked as a draft with its time cleared (audit W2, V3)', () => {
    const plan = planPostTransition(post('cancelled'), 'rebook', actorFor('scheduler'), {}, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.patch).toMatchObject({ stage: 'draft', cancelled: null, scheduled_for: null, approval: null, booking: null })
  })
})

/* ── missed times ────────────────────────────────────────────────────────── */

describe('missed times (decision 11)', () => {
  const missedWithClient = post('with_client', { client_send: { ...CLIENT_SEND, approve_by: at(-0.5) } })

  it('slotMissed, stage by stage', () => {
    expect(slotMissed(post('with_client'), NOW)).toBe(false)
    expect(slotMissed(missedWithClient, NOW)).toBe(true)
    expect(slotMissed(post('with_client', { client_send: { ...CLIENT_SEND, approve_by: null, for_time: at(0.2) } }), NOW)).toBe(true)
    expect(slotMissed(post('ready', { scheduled_for: at(0.2) }), NOW)).toBe(true)
    expect(slotMissed(post('ready'), NOW)).toBe(false)
    expect(slotMissed(post('quality_check', { scheduled_for: at(-1) }), NOW)).toBe(true)
    expect(slotMissed(post('draft', { scheduled_for: at(-1) }), NOW)).toBe(false)
    expect(slotMissed(post('booked', { scheduled_for: at(-1) }), NOW)).toBe(false)
    expect(slotMissed(post('posted', { scheduled_for: at(-1) }), NOW)).toBe(false)
  })

  it('the client can no longer answer; the team still can, and New time and resend becomes the main button', () => {
    const client: PostActor = { id: null, hats: ['client'] }
    expect(checkPostTransition(missedWithClient, 'client_approve', client, { version: 1 }, CTX)).toMatchObject({ ok: false, code: 'missed' })
    expect(checkPostTransition(missedWithClient, 'client_ask_change', client, { version: 1, note: 'x' }, CTX)).toMatchObject({ ok: false, code: 'missed' })
    expect(checkPostTransition(missedWithClient, 'approve_for_client', actorFor('am'), { version: 1, agreed_via: 'call' }, CTX)).toMatchObject({ ok: true })
    const forClient = postActions(missedWithClient, ['client'], NOW, CTX)
    expect(forClient).toEqual({ primary: null, secondary: [], danger: null })
    const forAm = postActions(missedWithClient, ['am'], NOW, CTX)
    expect(forAm.primary?.action).toBe('resend_new_time')
    const wait = waitingOn(missedWithClient, NOW)
    expect(wait).toMatchObject({ who: 'account_manager', missed: true })
    expect(wait.line).toContain(MISSED_LABEL)
    expect(postTone(missedWithClient, NOW)).toBe('red')
  })

  it('nothing moves by itself: the stage is unchanged however late it is', () => {
    expect(laneOf(missedWithClient)).toBe('with_client')
  })

  it('the default approve-by is two hours before, or the last bookable moment', () => {
    expect(defaultApproveBy(at(72), NOW)).toBe(at(70))
    expect(defaultApproveBy(at(1), NOW)).toBe(at(0.75))
    expect(defaultApproveBy(null, NOW)).toBeNull()
    expect(approveByOf(post('with_client'))).toBe(at(70))
    // the reminder moments, latest first — the sweep (post-notify-core dueApprovalReminder) picks the one that is due
    expect(approvalReminderTimes(at(70))).toEqual([{ kind: '1h', at: at(69) }, { kind: '24h', at: at(46) }])
    expect(approvalReminderTimes(null)).toEqual([])
  })
})

/* ── composition: Instagram's ten ────────────────────────────────────────── */

describe('composition (decision 10)', () => {
  const creator = actorFor('creator')

  it('Instagram with 11 is refused, and says how many to take out', () => {
    const p = post('draft', { slides: slides(11) })
    const r = checkPostTransition(p, 'send_to_qc', creator, {}, CTX)
    expect(r).toMatchObject({ ok: false, code: 'invalid' })
    if (!r.ok) expect(r.problems).toContain('Instagram takes 10 media files — take 1 out')
    expect(INSTAGRAM_MAX).toBe(10)
  })

  it('LinkedIn with its own 11 is allowed beside Instagram\'s shared 10', () => {
    const p = post('draft', { slides: slides(10), per_channel: { 'acc-li': { slides: slides(11) } } })
    expect(compositionProblems(p, ACCOUNTS, NOW)).toEqual([])
    expect(checkPostTransition(p, 'send_to_qc', creator, {}, CTX)).toMatchObject({ ok: true })
  })

  it('Instagram given its own 10 lets the others keep all 11', () => {
    const p = post('draft', { slides: slides(11), per_channel: { 'acc-ig': { slides: slides(10) } } })
    expect(compositionProblems(p, ACCOUNTS, NOW)).toEqual([])
  })

  it('LinkedIn alone takes 11', () => {
    const p = post('draft', { slides: slides(11), channels: ['acc-li'] })
    expect(compositionProblems(p, ACCOUNTS, NOW)).toEqual([])
  })

  it('offers drop, split, or Instagram\'s own ten instead of the eleventh', () => {
    const over = instagramOverflow(post('draft', { slides: slides(11) }), ACCOUNTS)
    expect(over).toMatchObject({ count: 11, max: 10, over: 1 })
    expect(over?.choices.map(c => c.key)).toEqual(['drop', 'split', 'own'])
    expect(instagramOverflow(post('draft', { slides: slides(11), channels: ['acc-ig'] }), ACCOUNTS)?.choices.map(c => c.key)).toEqual(['drop', 'split'])
    expect(instagramOverflow(post('draft', { slides: slides(10) }), ACCOUNTS)).toBeNull()
    expect(instagramOverflow(post('draft', { slides: slides(11), channels: ['acc-li'] }), ACCOUNTS)).toBeNull()
  })

  it('a send needs a time ahead; saving a draft never asks for one', () => {
    expect(checkPostTransition(post('draft', { scheduled_for: null }), 'send_to_qc', creator, {}, CTX)).toMatchObject({ ok: false, code: 'time' })
    expect(checkPostTransition(post('draft', { scheduled_for: at(-1) }), 'send_to_qc', creator, {}, CTX)).toMatchObject({ ok: false, code: 'time' })
    expect(checkPostTransition(post('draft', { scheduled_for: null, slides: [] }), 'save', creator, {}, CTX)).toMatchObject({ ok: true })
  })

  it('a channel that is gone is named, and the edit card is never read', () => {
    const p = post('draft', { channels: ['acc-ig', 'acc-gone'] })
    expect(compositionProblems(p, ACCOUNTS, NOW)[0]).toMatch(/not connected/)
  })
})

/* ── the buttons ─────────────────────────────────────────────────────────── */

/** The states a post is found in, one or more per stage. */
function representativePosts(): { name: string; p: PostState }[] {
  return [
    { name: 'draft, never sent', p: post('draft') },
    { name: 'draft, changes asked', p: post('draft', { sent_version: 1, draft_version: 2, changes_asked: { version: 1, by: 'u-joy', who: 'team', to: 'u-maker', note: 'x', at: at(-1) } }) },
    { name: 'draft, nothing in it yet', p: post('draft', { slides: [], scheduled_for: null }) },
    { name: 'quality check', p: post('quality_check') },
    { name: 'quality check, time passed', p: post('quality_check', { scheduled_for: at(-1) }) },
    { name: 'with client', p: post('with_client') },
    { name: 'with client, missed', p: post('with_client', { client_send: { ...CLIENT_SEND, approve_by: at(-1) } }) },
    { name: 'ready', p: post('ready') },
    { name: 'ready, missed', p: post('ready', { scheduled_for: at(-1) }) },
    { name: 'ready, came back failed', p: post('ready', { problem: 'Did not go out on LinkedIn.' }) },
    { name: 'booked', p: post('booked') },
    { name: 'posted', p: post('posted') },
    { name: 'posted in part', p: post('posted', { outcomes: { instagram: pub('published'), linkedin: pub('failed') } }) },
    { name: 'cancelled', p: post('cancelled') },
  ]
}

describe('postActions', () => {
  it('no-dead-ends: every stage has a way forward for every team role that owns it', () => {
    const dead: string[] = []
    for (const { name, p } of representativePosts()) {
      for (const role of TEAM_ROLES) {
        const list = postActions(p, viewerHats(role), NOW, { accounts: ACCOUNTS, clientHasContact: true })
        const forward = [list.primary, ...list.secondary].filter(a => a && !a.blocked)
        if (forward.length === 0) dead.push(`${name} × ${role}`)
      }
    }
    // the quality checker owns the quality check; the client owns an open review
    for (const p of [post('quality_check'), post('quality_check', { approval_steps: 'team_then_client' })]) {
      const list = postActions(p, viewerHats('quality_checker'), NOW, { accounts: ACCOUNTS, clientHasContact: true })
      if (!list.primary || list.primary.blocked) dead.push(`quality check × quality_checker (${p.approval_steps ?? 'team'})`)
    }
    const client = postActions(post('with_client'), ['client'], NOW, CTX)
    if (client.primary?.action !== 'client_approve') dead.push('with client × client')
    expect(dead).toEqual([])
  })

  it('every button offered unblocked is a move the server accepts', () => {
    for (const { p } of representativePosts()) {
      for (const role of [...TEAM_ROLES, 'quality_checker'] as const) {
        const hats = viewerHats(role)
        const list = postActions(p, hats, NOW, { accounts: ACCOUNTS, clientHasContact: true })
        for (const a of [list.primary, ...list.secondary, list.danger]) {
          if (!a || a.blocked) continue
          const input: TransitionInput = {
            expect_rev: p.rev, version: p.sent_version, note: 'x', agreed_via: 'call', confirm: true,
            steps: 'team', scheduled_for: at(96), assign_to: 'u-maker',
          }
          expect(checkPostTransition(p, a.action, { id: 'u-other', hats }, input, CTX), `${p.stage} ${a.action} ${role}`).toMatchObject({ ok: true })
        }
      }
    }
  })

  it('never offers the app\'s own steps, or the client\'s, to the team', () => {
    for (const { p } of representativePosts()) {
      const list = postActions(p, ['sa', 'am', 'scheduler', 'qr', 'creator'], NOW, CTX)
      for (const a of [list.primary, ...list.secondary, list.danger]) {
        if (!a) continue
        expect(ROW_OF[a.action].who.includes('system')).toBe(false)
        expect(['client_approve', 'client_ask_change']).not.toContain(a.action)
      }
    }
  })

  it('the draft footer: Send for quality check, never Send to client (decision 3)', () => {
    const list = postActions(post('draft'), viewerHats('account_manager'), NOW, CTX)
    expect(list.primary?.action).toBe('send_to_qc')
    expect([list.primary, ...list.secondary].map(a => a?.action)).not.toContain('send_to_client')
    expect(list.danger?.action).toBe('delete_draft')
  })

  it('with the client, a manager never gets Approve as the main button (audit B7)', () => {
    const list = postActions(post('with_client'), viewerHats('account_manager'), NOW, CTX)
    expect(list.primary).toBeNull()
    expect(list.secondary.map(a => a.action)).toEqual(['remind_client', 'resend_new_time', 'approve_for_client', 'team_decides', 'take_back'])
    expect(list.secondary.find(a => a.action === 'approve_for_client')?.needs).toEqual(['agreed_via', 'note'])
    expect(list.danger?.action).toBe('cancel')
  })

  it('a guard that stops a button shows its reason instead of hiding it', () => {
    const list = postActions(post('draft', { slides: slides(11) }), viewerHats('scheduler'), NOW, { accounts: ACCOUNTS })
    expect(list.primary).toBeNull()
    const send = list.secondary.find(a => a.action === 'send_to_qc')
    expect(send?.blocked).toBe('Instagram takes 10 media files — take 1 out')
  })

  it('the Edit label names the version it makes', () => {
    const list = postActions(post('ready'), viewerHats('scheduler'), NOW, CTX)
    expect(list.primary?.action).toBe('book')
    expect(list.secondary.find(a => a.action === 'edit')?.label).toBe('Edit — makes version 2')
  })

  it('a missed Ready post leads with Change time', () => {
    const list = postActions(post('ready', { scheduled_for: at(-1) }), viewerHats('scheduler'), NOW, CTX)
    expect(list.primary?.action).toBe('change_time')
    expect(list.secondary.find(a => a.action === 'book')?.blocked).toBeTruthy()
  })
})

/* ── lanes and words ─────────────────────────────────────────────────────── */

describe('lanes and words', () => {
  it('laneOf is the stage, for every stage', () => {
    for (const stage of POST_STAGES) expect(laneOf(post(stage))).toBe(stage)
  })

  it('every stage has one label, one meaning and one tone', () => {
    for (const stage of POST_STAGES) {
      expect(STAGE_LABEL[stage]).toBeTruthy()
      expect(STAGE_MEANING[stage]).toBeTruthy()
      expect(STAGE_TONE[stage]).toBeTruthy()
    }
    expect(new Set(Object.values(STAGE_LABEL)).size).toBe(POST_STAGES.length)
  })

  it('each page shows a stage in one lane at most, and the two pages split the road (decision 1)', () => {
    for (const lanes of [POST_APPROVAL_LANES, SCHEDULE_LANES]) {
      const seen = lanes.flatMap(l => l.stages)
      expect(new Set(seen).size).toBe(seen.length)
    }
    expect(pageLaneOf(POST_APPROVAL_LANES, 'quality_check')).toBe('quality_check')
    expect(pageLaneOf(POST_APPROVAL_LANES, 'booked')).toBe('approved')
    expect(pageLaneOf(SCHEDULE_LANES, 'with_client')).toBeNull()
    expect(pageLaneOf(SCHEDULE_LANES, 'ready')).toBe('ready')
  })

  it('a card is red when its time is missed or it came back with a problem', () => {
    // approved but NOT booked reads as waiting, never as done (30 Sep 2026)
    expect(postTone(post('ready'), NOW)).toBe('amber')
    expect(postTone(post('ready', { problem: 'Did not go out on LinkedIn.' }), NOW)).toBe('red')
    expect(postTone(post('booked'), NOW)).toBe('blue')
  })

  it('"Emailed to …" comes only from a send that happened', () => {
    expect(clientSendLine(null)).toBeNull()
    expect(clientSendLine(CLIENT_SEND)).toBe('Emailed to jordan@example.invalid')
    expect(clientSendLine({ ...CLIENT_SEND, via: 'link', to: [] })).toBe('Link shared with the client')
  })
})

describe('waitingOn', () => {
  it('says who has it and since when (audit B8, B11, B14)', () => {
    expect(waitingOn(post('draft'), NOW)).toMatchObject({ who: 'maker', person_id: 'u-maker', since: at(-5) })
    const changes = post('draft', { sent_version: 1, changes_asked: { version: 1, by: null, who: 'client', to: 'u-maker', note: 'x', at: at(-1) } })
    expect(waitingOn(changes, NOW, id => (id === 'u-maker' ? 'Divina' : null)).line).toBe('The client asked for a change — Divina to make it')
    expect(waitingOn(post('quality_check'), NOW)).toMatchObject({ who: 'quality_check', line: 'Waiting on the quality check' })
    expect(waitingOn(post('with_client'), NOW)).toMatchObject({ who: 'client', line: 'Waiting on the client' })
    expect(waitingOn(post('ready'), NOW)).toMatchObject({ who: 'scheduler', line: 'Approved — not booked yet' })
    expect(waitingOn(post('ready', { problem: 'Did not go out on LinkedIn.' }), NOW).line).toBe('Did not go out on LinkedIn. Pick a time and book it again.')
    expect(waitingOn(post('booked'), NOW).who).toBe('nobody')
    expect(waitingOn(post('posted', { outcomes: { instagram: pub('published'), linkedin: pub('failed') } }), NOW).who).toBe('scheduler')
    expect(waitingOn(post('cancelled'), NOW).line).toMatch(/Re-book/)
  })

  it('Waiting on you: a named person, else the hat that owns the stage', () => {
    const changes = post('draft', { sent_version: 1, changes_asked: { version: 1, by: 'u-joy', who: 'team', to: 'u-divina', note: 'x', at: at(-1) } })
    expect(waitingOnViewer(changes, { id: 'u-divina', hats: ['scheduler'] }, NOW)).toBe(true)
    expect(waitingOnViewer(changes, { id: 'u-other', hats: ['scheduler'] }, NOW)).toBe(false)
    expect(waitingOnViewer(post('quality_check'), { id: 'u-joy', hats: ['qr'] }, NOW)).toBe(true)
    expect(waitingOnViewer(post('quality_check'), { id: 'u-am', hats: ['am'] }, NOW)).toBe(false)
    expect(waitingOnViewer(post('with_client'), { id: 'u-am', hats: ['am'] }, NOW)).toBe(false)
    expect(waitingOnViewer(post('ready'), { id: 'u-s', hats: ['scheduler'] }, NOW)).toBe(true)
  })
})

/* ── notes ───────────────────────────────────────────────────────────────── */

describe('notes (decision 9)', () => {
  it('the client sees only the client thread; the team sees both', () => {
    expect(commentVisibleTo({ visibility: 'team' }, 'client')).toBe(false)
    expect(commentVisibleTo({ visibility: null }, 'client')).toBe(false)
    expect(commentVisibleTo({ visibility: 'client' }, 'client')).toBe(true)
    expect(commentVisibleTo({ visibility: 'team' }, 'team')).toBe(true)
  })

  it('notes stay on their file, whatever its place, and on their version', () => {
    const notes = [
      { id: 'a', file_url: img(1).url, version: 1 },
      { id: 'b', file_url: img(2).url, version: 1 },
      { id: 'c', file_url: img(1).url, version: 2 },
      { id: 'd', file_url: null, version: 1 },
    ]
    expect(notesForFile(notes, img(1).url, { version: 1 }).map(n => n.id)).toEqual(['a'])
    expect(notesForFile(notes, img(1).url).map(n => n.id)).toEqual(['a', 'c'])
    // null is the whole post; a thread keeps one thread
    expect(notesForFile(notes, null).map(n => n.id)).toEqual(['d'])
    const threads = [{ id: 't', file_url: null, visibility: 'team' }, { id: 'c', file_url: null, visibility: 'client' }]
    expect(notesForFile(threads, null, { thread: 'client' }).map(n => n.id)).toEqual(['c'])
  })
})

/* ── reading a row ───────────────────────────────────────────────────────── */

describe('readPostState', () => {
  it('returns null for a row with no stage (not migrated yet)', () => {
    expect(readPostState({ id: 'x', status: 'scheduled' })).toBeNull()
    expect(readPostState(null)).toBeNull()
  })

  it('reads the stage records and ignores junk', () => {
    const p = readPostState({
      id: 'post-9', client_id: 'c', created_by: 'u', stage: 'ready', rev: 7, draft_version: 3, sent_version: 2,
      item_id: 'item-legacy', channels: ['acc-ig'], slides: [img(1), { nope: true }], caption: 'Hi',
      per_channel: { 'acc-ig': { kind: 'carousel', slides: [img(2)] } },
      approval: { version: 2, by: 'u', hat: 'client', at: at(-1) },
      qc_pass: { version: 2, by: 'q', at: at(-2) },
      client_send: { version: 2, at: at(-3), to: ['a@example.invalid'], via: 'email' },
      outcomes: { instagram: { status: 'published', url: 'u' }, linkedin: { status: 'weird' } },
      booking: { job_ids: ['j'], pending: false },
      approval_steps: 'nonsense',
    })
    expect(p).toMatchObject({
      id: 'post-9', stage: 'ready', rev: 7, draft_version: 3, sent_version: 2,
      source_item_id: 'item-legacy', approval_steps: null, source_deleted: false,
      approval: { version: 2, hat: 'client', on_behalf_of_client: false },
      qc_pass: { version: 2 },
      client_send: { version: 2, via: 'email', approve_by: null },
      booking: { job_ids: ['j'], pending: false },
    })
    expect(p?.slides).toHaveLength(1)
    expect(Object.keys(p!.outcomes)).toEqual(['instagram'])
    expect(p?.per_channel['acc-ig'].slides).toHaveLength(1)
  })

  it('a missing rev reads as 0 and a missing draft version as 1', () => {
    expect(readPostState({ id: 'p', client_id: 'c', stage: 'draft' })).toMatchObject({ rev: 0, draft_version: 1, sent_version: null })
  })
})

/* ── the ghost tables ────────────────────────────────────────────────────── */

describe('ghost tables (scripts/gen-db-types.mjs → lib/db-types.ts)', () => {
  it('social_posts carries the stage fields; the three new tables exist', () => {
    for (const c of ['stage', 'rev', 'stage_at', 'draft_version', 'sent_version', 'approval_steps', 'approval', 'qc_pass',
      'changes_asked', 'client_send', 'last_client_send', 'booking', 'outcomes', 'problem', 'cancelled',
      'assigned_to', 'source_item_id', 'source_deleted']) {
      expect(TABLE_COLUMNS.social_posts).toContain(c)
    }
    expect(TABLE_COLUMNS.post_versions).toEqual(expect.arrayContaining(
      ['id', 'post_id', 'client_id', 'n', 'slides', 'per_channel', 'channels', 'caption', 'scheduled_for', 'frozen_for', 'frozen_by', 'frozen_at', 'from_migration']))
    expect(TABLE_COLUMNS.post_events).toEqual(expect.arrayContaining(
      ['id', 'post_id', 'rev', 'from', 'to', 'action', 'actor_id', 'hat', 'on_behalf_of_client', 'version', 'note', 'at']))
    expect(TABLE_COLUMNS.post_comments).toEqual(expect.arrayContaining(
      ['id', 'post_id', 'version', 'file_url', 'slide_index', 'visibility', 'author_id', 'body', 'assigned_to', 'resolved_at']))
    expect(NULLABLE_COLUMNS.post_comments).not.toContain('visibility')
    expect(NULLABLE_COLUMNS.post_comments).toContain('file_url')
    expect(JSON_ARRAY_COLUMNS.post_versions).toEqual(['slides', 'channels'])
  })
})

/* ── the act contract ────────────────────────────────────────────────────── */

describe('post-act-contract', () => {
  it('names the route and the path', () => {
    expect(postActPath('abc/1')).toBe('/api/posts/abc%2F1/act')
  })

  it('takes only the team\'s moves; the client and the app come in elsewhere', () => {
    expect(TEAM_ACT_ACTIONS).not.toContain('client_approve')
    expect(TEAM_ACT_ACTIONS).not.toContain('record_posted')
    expect(TEAM_ACT_ACTIONS).toContain('send_to_qc')
    expect(parsePostActRequest({ action: 'client_approve', expect_rev: 1 })).toMatchObject({ ok: false })
    expect(parsePostActRequest({ action: 'booking_done', expect_rev: 1 })).toMatchObject({ ok: false })
  })

  it('reads a good body and refuses a bad one', () => {
    expect(parsePostActRequest({ action: 'change_time', expect_rev: 3, scheduled_for: '2026-10-01T08:00:00+10:00' }))
      .toEqual({ ok: true, request: { action: 'change_time', expect_rev: 3, scheduled_for: '2026-09-30T22:00:00.000Z' } })
    expect(parsePostActRequest({ action: 'approve_for_client', expect_rev: 3, version: 2, agreed_via: 'call', note: 'Phoned Jordan' }))
      .toMatchObject({ ok: true, request: { version: 2, agreed_via: 'call', note: 'Phoned Jordan' } })
    expect(parsePostActRequest({ action: 'pass_send_client', expect_rev: 1, version: 1, send_to: [' a@example.invalid ', 'a@example.invalid'] }))
      .toMatchObject({ ok: true, request: { send_to: ['a@example.invalid'] } })
    expect(parsePostActRequest(null)).toMatchObject({ ok: false })
    expect(parsePostActRequest({ action: 'book' })).toMatchObject({ ok: false })
    expect(parsePostActRequest({ action: 'book', expect_rev: 1.5 })).toMatchObject({ ok: false })
    expect(parsePostActRequest({ action: 'change_time', expect_rev: 1, scheduled_for: 'tomorrow' })).toMatchObject({ ok: false })
    expect(parsePostActRequest({ action: 'approve_for_client', expect_rev: 1, agreed_via: 'pigeon' })).toMatchObject({ ok: false })
    expect(parsePostActRequest({ action: 'set_steps', expect_rev: 1, steps: 'client_only' })).toMatchObject({ ok: false })
  })

  it('maps refusals to statuses', () => {
    expect(refusalStatus('not_allowed')).toBe(403)
    expect(refusalStatus('not_found')).toBe(404)
    expect(refusalStatus('bad_request')).toBe(400)
    expect(refusalStatus('stale')).toBe(409)
    expect(refusalStatus('wrong_stage')).toBe(409)
  })
})

/* ── Schedule it: a super admin books without the quality check (the owner, 29 Sep 2026) ── */

describe('Schedule it — a super admin books a Draft or a post at the quality check, without the check', () => {
  const sa: PostActor = { id: 'u-akmal', hats: ['sa'] }
  const nameOf = (id: string | null | undefined) => (id === 'u-akmal' ? 'Akmal' : null)

  it('is one row: Draft or Quality check → Booked in, super admin only, asks for the time, never Post now', () => {
    const row = ROW_OF.schedule_direct
    expect([...row.from].sort()).toEqual(['draft', 'quality_check'])
    expect(row.to).toBe('booked')
    expect(row.who).toEqual(['sa'])
    expect(row.label).toBe('Schedule it')
    expect(row.needs).toEqual(['time'])
    // Post now is still only from Ready to post
    expect(ROW_OF.post_now.from).toEqual(['ready'])
  })

  it('from Draft: the working copy is frozen as version N, recorded as a super admin\'s, the check marked skipped, booked for its time', () => {
    const p = post('draft', { draft_version: 1, sent_version: null })
    const plan = planPostTransition(p, 'schedule_direct', sa, { expect_rev: 5 }, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.to).toBe('booked')
    expect(plan.patch.stage).toBe('booked')
    expect(plan.effects[0]).toEqual({ when: 'before', kind: 'freeze', n: 1, frozen_for: 'schedule', time: p.scheduled_for })
    expect(plan.patch.sent_version).toBe(1)
    expect(plan.patch.draft_version).toBe(2)
    expect(plan.patch.approval).toMatchObject({ version: 1, by: 'u-akmal', hat: 'super_admin', on_behalf_of_client: false, skipped_check: true })
    expect(plan.patch.approval?.without_client).toBeUndefined()
    expect(plan.patch.qc_pass).toBeUndefined()
    expect(plan.patch.booking).toEqual({ job_ids: [], pending: true, at: NOW, for_time: p.scheduled_for })
    // at its time, never now — the same booking steps as Book in
    expect(plan.effects).toContainEqual({ when: 'after', kind: 'queue_publish', for_time: p.scheduled_for, now: false })
    expect(plan.effects.some(e => e.kind === 'notify')).toBe(false)
    expect(plan.event).toMatchObject({ action: 'schedule_direct', hat: 'sa', from: 'draft', to: 'booked', version: 1, note: 'Scheduled by a super admin without the quality check' })
    expect(approvalLine(plan.patch.approval, nameOf)).toBe('Scheduled without the quality check by Akmal')
    expect(approvalLine(plan.patch.approval, nameOf)).not.toMatch(/Passed/)
  })

  it('from Quality check: the version already sent is the one booked (no new freeze at its own time)', () => {
    const p = post('quality_check')
    const plan = planPostTransition(p, 'schedule_direct', sa, { expect_rev: 5, version: 1 }, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.to).toBe('booked')
    expect(plan.effects.some(e => e.kind === 'freeze')).toBe(false)
    expect(plan.patch.sent_version).toBeUndefined()
    expect(plan.patch.approval).toMatchObject({ version: 1, hat: 'super_admin', skipped_check: true })
    expect(plan.effects).toContainEqual({ when: 'after', kind: 'queue_publish', for_time: p.scheduled_for, now: false })
    // a stale page (the wrong version) is refused like every versioned move
    expect(checkPostTransition(p, 'schedule_direct', sa, { expect_rev: 5, version: 2 }, CTX)).toMatchObject({ ok: false, code: 'version' })
  })

  it('a time picked in the question is the booked time; from Quality check it re-freezes with only the time replaced', () => {
    const when = at(96)
    const plan = planPostTransition(post('quality_check'), 'schedule_direct', sa, { expect_rev: 5, version: 1, scheduled_for: when }, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.effects[0]).toEqual({ when: 'before', kind: 'freeze', n: 2, frozen_for: 'retime', time: when })
    expect(plan.patch.scheduled_for).toBe(when)
    expect(plan.patch.approval?.version).toBe(2)
    expect(plan.patch.booking?.for_time).toBe(when)
    expect(plan.effects).toContainEqual({ when: 'after', kind: 'queue_publish', for_time: when, now: false })
  })

  it('team, then the client: allowed, and the record says the client did not see it either', () => {
    const p = post('draft', { approval_steps: 'team_then_client' })
    const plan = planPostTransition(p, 'schedule_direct', sa, {}, CTX)
    if (!plan.ok) throw new Error(plan.reason)
    expect(plan.patch.approval).toMatchObject({ skipped_check: true, without_client: true })
    expect(approvalLine(plan.patch.approval, nameOf)).toBe('Scheduled without the quality check and without the client by Akmal')
    expect(plan.event.note).toBe('Scheduled by a super admin without the quality check and without the client')
    // the client's own default counts the same
    const byDefault = planPostTransition(post('draft'), 'schedule_direct', sa, {}, { ...CTX, client: { client_approval_required: true } })
    if (!byDefault.ok) throw new Error(byDefault.reason)
    expect(byDefault.patch.approval?.without_client).toBe(true)
  })

  it('nobody else may: scheduler, account manager, quality checker, the maker, the client', () => {
    for (const hats of [['scheduler'], ['am'], ['qr'], ['creator'], ['am', 'qr'], ['creator', 'scheduler'], ['client']] as PostHat[][]) {
      for (const stage of ['draft', 'quality_check'] as PostStage[]) {
        expect(checkPostTransition(post(stage), 'schedule_direct', { id: 'u-x', hats }, { version: 1 }, CTX), `${hats} ${stage}`)
          .toMatchObject({ ok: false, code: 'not_allowed' })
      }
    }
  })

  it('refuses what Book in refuses: a past time, too soon, a channel not connected — with the same words', () => {
    for (const stage of ['draft', 'quality_check'] as PostStage[]) {
      const past = post(stage, { scheduled_for: at(-1) })
      const bookPast = checkPostTransition(post('ready', { scheduled_for: at(-1) }), 'book', { id: 'u-s', hats: ['scheduler'] }, {}, CTX)
      const direct = checkPostTransition(past, 'schedule_direct', sa, { version: 1 }, CTX)
      expect(direct).toMatchObject({ ok: false, code: 'time' })
      if (!direct.ok && !bookPast.ok) expect(direct.reason).toBe(bookPast.reason)
      // a past time picked in the question is refused too
      expect(checkPostTransition(post(stage), 'schedule_direct', sa, { version: 1, scheduled_for: at(-2) }, CTX)).toMatchObject({ ok: false, code: 'time' })
      // inside the 15-minute lead — and it never offers "post now"
      const soon = checkPostTransition(post(stage, { scheduled_for: at(0.1) }), 'schedule_direct', sa, { version: 1 }, CTX)
      expect(soon).toMatchObject({ ok: false, code: 'time' })
      if (!soon.ok) expect(soon.reason).not.toMatch(/now/i)
      const lost = { ...CTX, accounts: [{ id: 'acc-ig', platform: 'instagram', live: false }, ACCOUNTS[1]] }
      const bookLost = checkPostTransition(post('ready'), 'book', { id: 'u-s', hats: ['scheduler'] }, {}, lost)
      const directLost = checkPostTransition(post(stage), 'schedule_direct', sa, { version: 1 }, lost)
      expect(directLost).toMatchObject({ ok: false, code: 'channels' })
      if (!directLost.ok && !bookLost.ok) expect(directLost.reason).toBe(bookLost.reason)
      // the channels were not loaded: no guess
      expect(checkPostTransition(post(stage), 'schedule_direct', sa, { version: 1 }, { now: NOW })).toMatchObject({ ok: false, code: 'context' })
    }
  })

  it('refuses what the check would have caught: no channel, more than ten for Instagram', () => {
    const none = checkPostTransition(post('draft', { channels: [] }), 'schedule_direct', sa, {}, CTX)
    expect(none).toMatchObject({ ok: false, code: 'invalid' })
    const sendNone = checkPostTransition(post('draft', { channels: [] }), 'send_to_qc', { id: 'u-maker', hats: ['creator'] }, {}, CTX)
    if (!none.ok && !sendNone.ok) expect(none.reason).toBe(sendNone.reason)
    const eleven = checkPostTransition(post('draft', { slides: slides(11) }), 'schedule_direct', sa, {}, CTX)
    expect(eleven).toMatchObject({ ok: false, code: 'invalid' })
    if (!eleven.ok) expect(eleven.problems?.join(' ')).toMatch(/Instagram/)
    expect(checkPostTransition(post('draft', { slides: slides(10) }), 'schedule_direct', sa, {}, CTX)).toMatchObject({ ok: true })
  })

  it('is offered only to a super admin, only on Draft and Quality check, never as the main button', () => {
    for (const stage of POST_STAGES) {
      for (const role of [...TEAM_ROLES, 'quality_checker'] as const) {
        const list = postActions(post(stage), viewerHats(role), NOW, { accounts: ACCOUNTS, clientHasContact: true })
        const all = [list.primary, ...list.secondary, list.danger].filter(Boolean).map(a => a!.action)
        const want = role === 'super_admin' && (stage === 'draft' || stage === 'quality_check')
        expect(all.includes('schedule_direct'), `${stage} × ${role}`).toBe(want)
        expect(list.primary?.action).not.toBe('schedule_direct')
      }
    }
    const draft = postActions(post('draft'), viewerHats('super_admin'), NOW, { accounts: ACCOUNTS, clientHasContact: true })
    expect(draft.primary?.action).toBe('send_to_qc')
    expect(draft.secondary[0]).toMatchObject({ action: 'schedule_direct', label: 'Schedule it', blocked: null, needs: ['time'] })
    const qc = postActions(post('quality_check'), viewerHats('super_admin'), NOW, { accounts: ACCOUNTS, clientHasContact: true })
    expect(qc.primary?.action).toBe('pass')
    expect(qc.secondary.map(a => a.action)).toContain('schedule_direct')
  })

  it('the act route takes it (TEAM_ACT_ACTIONS derives from the table)', () => {
    expect(TEAM_ACT_ACTIONS).toContain('schedule_direct')
    expect(parsePostActRequest({ action: 'schedule_direct', expect_rev: 2, version: 1, scheduled_for: '2026-10-01T08:00:00+10:00' }))
      .toEqual({ ok: true, request: { action: 'schedule_direct', expect_rev: 2, version: 1, scheduled_for: '2026-09-30T22:00:00.000Z' } })
  })

  it('reads its marks back from a row, and only when they are there', () => {
    const base = { id: 'p', client_id: 'c', stage: 'booked', rev: 1 }
    const marked = readPostState({ ...base, approval: { version: 1, by: 'u-akmal', hat: 'super_admin', skipped_check: true, without_client: true, at: NOW } })
    expect(marked?.approval).toMatchObject({ skipped_check: true, without_client: true })
    const plain = readPostState({ ...base, approval: TEAM_APPROVAL })
    expect(plain?.approval).toEqual({ ...TEAM_APPROVAL })
    expect(approvalLine(plain?.approval, () => 'joy')).toBe('Passed quality check — Joy')
  })
})
