import { describe, expect, it } from 'vitest'
import {
  NOT_YOUR_PAGE, canManageShoot, clientDecisionOpen, clientDecisionPatch, clientPlanWords, clientSharePatch, clientShareReady,
  createdWords, footageOnlyPatch, isFootageOnly, nextStepWords, planAsText, shootStage, stampLines, stampWords, type SopShoot,
} from '../app/lib/shoot-sop-core'
import { ACK_TOKEN_DAYS, ackLink, signAckToken, verifyAckToken } from '../app/lib/shoot-ack-token'
import { planReadState } from '../app/lib/editor-sop-core'

/**
 * THE SHOOT PAGE REVAMP (13 Sep 2026), as pure rules:
 *
 *   who may work the page      canManageShoot
 *   the client's sign-off      clientShareReady · clientSharePatch ·
 *                              clientDecisionPatch · clientPlanWords
 *   who did what, and when     createdWords · stampLines
 *   the plan as text           planAsText (the email)
 *   the crew's one press       signAckToken · verifyAckToken · ackLink
 *   the editor's card          planReadState
 */

const AM = 'am-1', ED = 'ed-1', VG = 'vg-1', SUP = 'sup-1', GEN = 'gen-1'
const names: Record<string, string> = { [AM]: 'Ada', [ED]: 'Martin', [VG]: 'Yusuf', [SUP]: 'Divina', [GEN]: 'Vik' }
const nameOf = (id: string | null | undefined) => (id ? names[id] ?? null : null)

const shoot = (over: Partial<SopShoot> = {}): SopShoot => ({
  id: 'b-1', client_id: 'c-1', title: 'Golf Day', status: 'brief', owner_id: AM, created_by: AM, created_at: '2026-09-11T23:05:00Z',
  shoot_date: '2026-09-21', call_time: '7:30 am', location: 'Royal Melbourne',
  shot_list: [{ id: 's1', text: 'Drone over the 1st', done: false }, { id: 's2', text: 'Interview', done: false }],
  planned_deliverables: [{ id: 'l1', title: '5 reels' }, { id: 'l2', title: '1 photo set' }],
  objective: 'Spring membership drive', script: 'Three points', talent: 'Sam', props_wardrobe: 'Polos',
  client_availability: 'GM 8–10', editor_priorities: 'Hero reel first', edit_deadline: '2026-09-25',
  editor_id: ED, crew_ids: [VG], acknowledgements: [],
  ...over,
})

describe('who may work the shoot page', () => {
  it('the AM on the client, the creator, a super admin and a general user — nobody else', () => {
    const b = shoot()
    expect(canManageShoot({ id: AM, role: 'account_manager', clientIds: ['c-1'] }, b)).toBe(true)
    expect(canManageShoot({ id: 'other-am', role: 'account_manager', clientIds: ['c-2'] }, b)).toBe(false)
    expect(canManageShoot({ id: 'other-am', role: 'account_manager' }, b)).toBe(true) // clients unknown: the role is trusted (the board)
    expect(canManageShoot({ id: SUP, role: 'super_admin', clientIds: [] }, b)).toBe(true)
    expect(canManageShoot({ id: GEN, role: 'general', clientIds: [] }, b)).toBe(true)
    expect(canManageShoot({ id: ED, role: 'editor', clientIds: [] }, b)).toBe(false)
    expect(canManageShoot({ id: VG, role: 'scheduler', clientIds: [] }, b)).toBe(false)
    expect(canManageShoot({ id: 'cl', role: 'client', clientIds: ['c-1'] }, b)).toBe(false)
    // the creator, whatever their role
    expect(canManageShoot({ id: ED, role: 'editor', clientIds: [] }, shoot({ created_by: ED }))).toBe(true)
    expect(canManageShoot({ id: VG, role: 'scheduler', clientIds: [] }, shoot({ owner_id: VG }))).toBe(true)
  })
  it('sends the editor to their Editor page', () => {
    expect(NOT_YOUR_PAGE.redirect).toBe('/dashboard/editor')
    expect(NOT_YOUR_PAGE.error).toMatch(/Your shoots are cards on the Editor page/)
  })
})

describe('the client’s sign-off, on the shoot', () => {
  it('can be shared once the nine parts are in, at any stage; a closed shoot cannot', () => {
    expect(clientShareReady(shoot())).toEqual({ ok: true })
    expect(clientShareReady(shoot({ go_at: 'x', reminder_sent_at: 'x' }))).toEqual({ ok: true })
    expect(clientShareReady(shoot({ script: null, talent: '' }))).toEqual({ ok: false, reason: 'Fill in the plan first — script or talking points, talent or presenter still to go' })
    expect(clientShareReady(shoot({ status: 'wrapped' }))).toEqual({ ok: false, reason: 'This shoot is closed' })
  })
  it('sharing stamps who and when and clears the last answer; the answer stamps the decision and the note', () => {
    expect(clientSharePatch('now', AM)).toEqual({
      shared_with_client: true, client_shared_at: 'now', client_shared_by: AM,
      client_decision: null, client_decided_at: null, client_decision_note: null,
    })
    expect(clientDecisionPatch('approved', null, 'then')).toEqual({ client_decision: 'approved', client_decided_at: 'then', client_decision_note: null })
    expect(clientDecisionPatch('changes', '  Swap the opener ', 'then')).toEqual({ client_decision: 'changes', client_decided_at: 'then', client_decision_note: 'Swap the opener' })
  })
  it('is open to an answer while shared and not yet approved', () => {
    expect(clientDecisionOpen(shoot())).toBe(false)
    expect(clientDecisionOpen(shoot({ shared_with_client: true }))).toBe(true)
    expect(clientDecisionOpen(shoot({ shared_with_client: true, client_decision: 'changes' }))).toBe(true)
    expect(clientDecisionOpen(shoot({ shared_with_client: true, client_decision: 'approved' }))).toBe(false)
  })
  it('says where the plan is with the client, in one line', () => {
    expect(clientPlanWords(shoot())).toBeNull()
    expect(clientPlanWords(shoot({ shared_with_client: true }))).toBe('On the client portal')
    expect(clientPlanWords(shoot({ shared_with_client: true, client_shared_at: '2026-09-13T23:10:00Z' }))).toBe('With the client since Mon 14 Sept, 9:10 am')
    expect(clientPlanWords(shoot({ shared_with_client: true, client_shared_at: 'x', client_decision: 'approved', client_decided_at: '2026-09-15T00:00:00Z' }))).toBe('Client approved Tue 15 Sept, 10:00 am')
    expect(clientPlanWords(shoot({ shared_with_client: true, client_shared_at: 'x', client_decision: 'changes', client_decided_at: '2026-09-15T00:00:00Z', client_decision_note: 'Swap the opener' }))).toBe('Client asked for changes Tue 15 Sept, 10:00 am: Swap the opener')
  })
})

describe('who did what, and when', () => {
  it('reads an instant in Melbourne, and a bare day as a day', () => {
    expect(stampWords('2026-09-13T23:10:00Z')).toBe('Mon 14 Sept, 9:10 am')
    expect(stampWords('2026-09-21')).toBe('Mon 21 Sept')
    expect(stampWords(null)).toBeNull()
    expect(stampWords('nonsense')).toBeNull()
  })
  it('"Created by Ada, Fri 11 Sept" — and "by the team" on a row from before the column', () => {
    expect(createdWords(shoot(), nameOf)).toBe('Created by Ada, Sat 12 Sept, 9:05 am')
    expect(createdWords(shoot({ created_by: null, created_at: null }), nameOf)).toBe('Created by Ada')
    expect(createdWords(shoot({ created_by: null, owner_id: null, created_at: null }), nameOf)).toBe('Created by the team')
  })
  it('one line per step, each with its person and time, and the steps not taken yet', () => {
    const b = shoot({
      brief_shared_at: '2026-09-13T23:10:00Z', brief_shared_by: AM,
      acknowledgements: [{ user_id: ED, at: '2026-09-14T00:00:00Z' }],
      aligned_at: '2026-09-14T01:00:00Z', aligned_by: AM,
      shared_with_client: true, client_shared_at: '2026-09-14T02:00:00Z', client_shared_by: AM,
      client_decision: 'approved', client_decided_at: '2026-09-15T00:00:00Z',
      go_at: '2026-09-15T01:00:00Z', go_by: AM,
      footage_handed_at: '2026-09-21T21:00:00Z', footage_handed_by: null,
    })
    expect(stampLines(b, nameOf).map(l => `${l.done ? '✓' : '·'} ${l.text}`)).toEqual([
      '✓ Created by Ada, Sat 12 Sept, 9:05 am',
      '✓ Shared with the team by Ada, Mon 14 Sept, 9:10 am',
      '· Read by Martin, Mon 14 Sept, 10:00 am · not yet: Yusuf',
      '✓ Aligned with the strategist — ticked by Ada, Mon 14 Sept, 11:00 am',
      '· Client availability and location — not ticked yet',
      '✓ Shared with the client by Ada, Mon 14 Sept, 12:00 pm',
      '✓ Client approved Tue 15 Sept, 10:00 am',
      '✓ Go by Ada, Tue 15 Sept, 11:00 am',
      '· Reminder not sent yet',
      '✓ Footage in — by itself, the morning after, Tue 22 Sept, 7:00 am',
    ])
  })
  it('an old row with stamps but no people reads "by the team"', () => {
    const b = shoot({ brief_shared_at: '2026-09-13T23:10:00Z', brief_shared_by: null, reminder_sent_at: '2026-09-20T00:00:00Z', crew_ids: [], editor_id: null })
    const lines = stampLines(b, nameOf)
    expect(lines.find(l => l.key === 'shared')?.text).toBe('Shared with the team by the team, Mon 14 Sept, 9:10 am')
    expect(lines.find(l => l.key === 'reminder')?.text).toBe('Reminder sent by the team, Sun 20 Sept, 10:00 am')
    expect(lines.find(l => l.key === 'read')).toBeUndefined()
    expect(lines.find(l => l.key === 'client_shared')).toBeUndefined()
  })
})

describe('the plan as text — what the email carries', () => {
  it('the nine parts in the SOP’s order, with the empty ones said so', () => {
    const text = planAsText(shoot({ script: null }))
    expect(text.map(t => t.label)).toEqual([
      'Objective', 'Deliverables', 'Shot list', 'Script or talking points', 'Date, call time and location',
      'Talent or presenter', 'Props, wardrobe and setup', 'Client availability', 'Editor priorities and deadline',
    ])
    expect(text[1].value).toBe('5 reels, 1 photo set')
    expect(text[2].value).toBe('1. Drone over the 1st\n2. Interview')
    expect(text[3].value).toBe('Not filled in yet')
    expect(text[4].value).toBe('21 Sept · call time 7:30 am · Royal Melbourne')
    expect(text[8].value).toBe('Hero reel first · due 25 Sept')
  })
})

describe('the crew member’s one press', () => {
  const secret = 'a-secret-the-app-already-has'
  it('signs a per-person, per-shoot link that lasts 30 days, and refuses anything else', () => {
    const now = Date.parse('2026-09-13T00:00:00Z')
    const t = signAckToken('b-1', VG, secret, now)
    expect(verifyAckToken(t, secret, now)).toEqual({ ok: true, shootId: 'b-1', userId: VG })
    expect(verifyAckToken(t, secret, now + (ACK_TOKEN_DAYS - 1) * 86_400_000)).toMatchObject({ ok: true })
    expect(verifyAckToken(t, secret, now + (ACK_TOKEN_DAYS + 1) * 86_400_000)).toEqual({ ok: false, reason: 'expired' })
    expect(verifyAckToken(t, 'another-secret', now)).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyAckToken(t.slice(0, -2) + 'zz', secret, now)).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyAckToken('not.a.token', secret, now)).toMatchObject({ ok: false })
    expect(verifyAckToken('', secret, now)).toEqual({ ok: false, reason: 'malformed' })
    // two people on the same shoot never share a link
    expect(signAckToken('b-1', ED, secret, now)).not.toBe(t)
  })
  it('the link goes to the acknowledge route, with the token in the address', () => {
    const link = ackLink('https://app.test', 'b-1', VG, secret, 0)
    expect(link).toMatch(/^https:\/\/app\.test\/api\/production\/batches\/b-1\/acknowledge\?token=/)
    const token = decodeURIComponent(link.split('token=')[1])
    expect(verifyAckToken(token, secret, 0)).toMatchObject({ ok: true, userId: VG })
  })
})

describe('the editor’s card: I’ve read the plan', () => {
  it('is offered to the editor and the crew on the shoot, once, then says when', () => {
    const s = { editor_id: ED, crew_ids: [VG], acknowledgements: [{ user_id: VG, at: '2026-09-14T00:00:00Z' }] }
    expect(planReadState(s, ED)).toEqual({ on: true, read: false })
    expect(planReadState(s, VG)).toEqual({ on: true, read: true, at: '2026-09-14T00:00:00Z' })
    expect(planReadState(s, AM)).toEqual({ on: false })
    expect(planReadState(null, ED)).toEqual({ on: false })
    expect(planReadState(s, null)).toEqual({ on: false })
  })
})

describe('a shoot typed by name on the Editor page — footage only', () => {
  it('is made already shot, footage in, owned and created by the maker, and never needs Go', () => {
    const patch = footageOnlyPatch('2026-09-13T01:00:00Z', ED, '2026-09-10')
    expect(patch).toEqual({ status: 'shot', shoot_date: '2026-09-10', footage_handed_at: '2026-09-13T01:00:00Z', footage_handed_by: ED, owner_id: ED, created_by: ED })
    const b: SopShoot = { id: 'b-9', client_id: 'c-1', title: 'Clinic open day', ...patch } as SopShoot
    expect(isFootageOnly(b)).toBe(true)
    expect(shootStage(b, '2026-09-13')).toBe('footage_handed')
    expect(nextStepWords(b, '2026-09-13')).toBe('Footage only — this shoot was never planned here. Its cards are on the Editor page; nothing to press.')
    // a planned shoot whose footage came in is not footage-only
    expect(isFootageOnly(shoot({ footage_handed_at: 'x', go_at: 'x' }))).toBe(false)
    expect(isFootageOnly(shoot({ footage_handed_at: 'x', brief_shared_at: null, go_at: null }))).toBe(false)
    expect(isFootageOnly(shoot({ footage_handed_at: null }))).toBe(false)
  })
})
