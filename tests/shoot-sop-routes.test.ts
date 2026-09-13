import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { roleSatisfies, type Role } from '../app/lib/identity-core'
import { planCardId, shootCardId } from '../app/lib/deliverable-group-core'

/**
 * THE SHOOT BRIEF SOP, END TO END THROUGH THE ROUTES.
 *
 * An AM writes the nine parts and shares the brief; the crew and the editor
 * acknowledge it; the AM ticks alignment and the client, and signs it off
 * as go; after the day the footage is handed over and the editor gets the
 * cards. Every refusal is in plain words; every write is idempotent.
 */

// the crew's "I've read the plan" link is signed with a secret the app holds
process.env.CLERK_SECRET_KEY ??= 'test-secret-for-the-acknowledge-link'
const emails: Record<string, unknown>[] = []
const AM = 'a1a1a1a1-0000-4000-8000-000000000001'
const ED = 'e1e1e1e1-0000-4000-8000-000000000001'
const VG = 'c1c1c1c1-0000-4000-8000-000000000001'
const OPS = 'f1f1f1f1-0000-4000-8000-000000000001'
const OUT = 'd1d1d1d1-0000-4000-8000-000000000001'

let who: { id: string; name: string; role: Role; client_id: string | null } =
  { id: AM, name: 'Priya Patel', role: 'account_manager', client_id: null }
const as = (id: string, role: Role, name = 'Someone') => { who = { id, name, role, client_id: null } }

vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(async (m: Record<string, unknown>) => { emails.push(m); return 'sent' }),
  renderEmail: (h: string, b: string, _cta: string, href: string) => `${h}${b}${href}`,
  escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/workflow', () => ({ logActivity: vi.fn(), performTransition: vi.fn(), notifyBatchTransition: vi.fn() }))
vi.mock('../app/lib/production-live', () => ({ announceItemChange: vi.fn(), announceBatchChange: vi.fn() }))
vi.mock('../app/lib/gdrive-hooks', () => ({ onShootDateChanged: vi.fn(), onBatchCreated: vi.fn() }))
vi.mock('../app/lib/authz', () => ({
  roleSatisfies,
  requireRole: async (required: Role) => {
    if (!roleSatisfies(who.role, required)) {
      const e = new Error('Insufficient permissions') as Error & { status: number }
      e.status = 403
      throw e
    }
    return { ...who, email: `${who.id.slice(0, 4)}@x.invalid`, active_status: true, clerk_user_id: null }
  },
  AuthzError: class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  },
  authzErrorResponse: (e: unknown) => ({
    error: e instanceof Error ? e.message : 'error',
    status: (e as { status?: number })?.status ?? 500,
  }),
}))

const detail = await import('../app/api/production/batches/[id]/route')
const shareClient = await import('../app/api/production/batches/[id]/share-client/route')
const portalAct = await import('../app/api/portal/act/route')
const stage = await import('../app/api/production/batches/[id]/stage/route')
const ack = await import('../app/api/production/batches/[id]/acknowledge/route')
const { runBriefLateNudge } = await import('../app/lib/shoot-sop-notify')
const { runFootageDueSweep } = await import('../app/lib/shoot-handover')

const dayShift = (n: number) => new Date(Date.now() + n * 86_400_000)
  .toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })

const brief = (over: Record<string, unknown> = {}) => ({
  id: 'b-1', client_id: 'c-1', title: 'Golf Day', status: 'brief', owner_id: AM,
  shoot_date: dayShift(10), call_time: '7:30 am', location: 'Royal Melbourne',
  shot_list: [{ id: 's1', text: 'Drone over the 1st', done: false }],
  planned_deliverables: [{ id: 'l1', title: 'Hero reel' }, { id: 'l2', title: 'Photo set' }],
  objective: 'Spring membership drive', script: 'Three points', talent: 'Sam', props_wardrobe: 'Polos',
  client_availability: 'GM 8–10', editor_priorities: 'Hero reel first', edit_deadline: dayShift(14),
  editor_id: ED, crew_ids: [VG], acknowledgements: [], canvas_cards: [], reference_media: [],
  created_at: '2026-09-01T00:00:00.000Z',
  ...over,
})

let fake: ReturnType<typeof seedDb>
const seed = (over: Record<string, unknown> = {}) => seedDb({
  clients: [{ id: 'c-1', name: 'ZZ TEST', timezone: 'Australia/Melbourne' }] as unknown as Row[],
  batches: [brief(over)] as unknown as Row[],
  team_users: [
    { id: AM, name: 'Priya Patel', email: 'am@zz.invalid', role: 'account_manager', active_status: true },
    { id: ED, name: 'Sam Editor', email: 'sam@zz.invalid', role: 'editor', active_status: true },
    { id: VG, name: 'Vik Camera', email: 'vik@zz.invalid', role: 'general', active_status: true },
    { id: OPS, name: 'Abby Ops', email: 'abby@zz.invalid', role: 'super_admin', active_status: true, ops_contact: true },
    { id: OUT, name: 'Kit Outsider', email: 'kit@zz.invalid', role: 'editor', active_status: true },
  ] as unknown as Row[],
  team_user_clients: [{ id: 'l1', team_user_id: AM, client_id: 'c-1' }] as unknown as Row[],
  work_kinds: [], content_items: [], workflow_activity: [], batch_comments: [], item_comments: [],
  shoot_proposals: [],
})

beforeEach(() => { emails.length = 0; as(AM, 'account_manager', 'Priya Patel'); fake = seed() })
afterEach(() => fake.restore())

const P = (id: string) => ({ params: Promise.resolve({ id }) })
const json = async (r: Response | Promise<Response | undefined>) => { const res = (await r)!; return { status: res.status, body: await res.json() as any } }
const move = (to: string, id = 'b-1') => json(stage.POST(new Request('https://x.test/stage', { method: 'POST', body: JSON.stringify({ to }) }), P(id)))
const edit = (body: Record<string, unknown>, id = 'b-1') => json(detail.PATCH(new Request('https://x.test/b', { method: 'PATCH', body: JSON.stringify(body) }), P(id)))
const open = (id = 'b-1') => json(detail.GET(new Request('https://x.test/b'), P(id)))
const acknowledge = (id = 'b-1') => json(ack.POST(new Request('https://x.test/ack', { method: 'POST' }), P(id)))
const batch = () => fake.rows('batches').find(b => b.id === 'b-1') as any
const cards = () => fake.rows('content_items') as any[]

describe('sharing the brief', () => {
  it('refuses a half-written brief in the SOP’s words, and shares a complete one', async () => {
    fake.restore(); fake = seed({ talent: null, script: '' })
    const no = await move('shared')
    expect(no.status).toBe(422)
    expect(no.body.error).toMatch(/script or talking points, talent or presenter still to fill in/)
    expect(batch().brief_shared_at).toBeUndefined()

    await edit({ talent: 'Sam', script: 'Three points' })
    const yes = await move('shared')
    expect(yes.status).toBe(200)
    expect(yes.body.stage).toBe('shared')
    expect(batch().brief_shared_by).toBe(AM)
    // everyone on the shoot is asked to read it — never the AM who wrote it
    expect(emails.map(e => e.recipientEmail).sort()).toEqual(['sam@zz.invalid', 'vik@zz.invalid'])
    expect(emails[0].subject).toBe('Read the plan: Golf Day')
    // THE PLAN TRAVELS IN THE EMAIL, and nobody is sent to the shoot page:
    // the editor's link is their card, the crew's is a one-press acknowledge
    const toEditor = emails.find(e => e.recipientEmail === 'sam@zz.invalid')!
    const toCrew = emails.find(e => e.recipientEmail === 'vik@zz.invalid')!
    expect(String(toEditor.bodyHtml)).toMatch(/Objective<\/td><td[^>]*>Spring membership drive/)
    expect(String(toEditor.bodyHtml)).toMatch(/\/dashboard\/editor\?card=/)
    expect(String(toEditor.bodyHtml)).not.toMatch(/\/dashboard\/production\/shoots\//)
    expect(String(toCrew.bodyHtml)).toMatch(/\/api\/production\/batches\/b-1\/acknowledge\?token=/)
    expect(String(toCrew.bodyHtml)).not.toMatch(/\/dashboard\//)
    // the editor's card exists from the share, so the button has somewhere to be
    expect(cards().map(c => [c.title, c.owner_id])).toEqual([['Golf Day', ED]])
  })
  it('the editor and the crew cannot move a shoot — the page and its buttons are the manager’s', async () => {
    as(VG, 'scheduler')
    const r = await move('shared')
    expect(r.status).toBe(403)
    expect(r.body.error).toMatch(/The shoot page is the account manager’s/)
    expect(r.body.redirect).toBe('/dashboard/editor')
    as(ED, 'editor')
    expect((await move('shared')).status).toBe(403)
    // a general user manages any shoot; the creator manages theirs whatever their role
    as(VG, 'general')
    expect((await move('shared')).status).toBe(200)
  })
  it('the creator of a shoot works its page whatever their role', async () => {
    fake.restore(); fake = seed({ owner_id: OUT, created_by: ED })
    as(ED, 'editor', 'Sam Editor')
    expect((await open()).status).toBe(200)
    expect((await edit({ objective: 'Changed by the creator' })).status).toBe(200)
    expect((await move('shared')).status).toBe(200)
  })
})

describe('acknowledging', () => {
  it('one press by somebody on the shoot, idempotent; an outsider is refused', async () => {
    as(VG, 'general', 'Vik Camera')
    expect((await acknowledge()).status).toBe(200)
    expect((await acknowledge()).status).toBe(200)
    expect(batch().acknowledgements).toHaveLength(1)
    expect(batch().acknowledgements[0].user_id).toBe(VG)
    as(OUT, 'editor', 'Kit Outsider')
    const r = await acknowledge()
    expect(r.status).toBe(403)
  })
  it('the editor on the shoot is sent to their Editor page; the manager opens it with who has read it, and every name', async () => {
    as(VG, 'general', 'Vik Camera')
    await acknowledge()
    as(ED, 'editor', 'Sam Editor')
    const r = await open()
    expect(r.status).toBe(403)
    expect(r.body.redirect).toBe('/dashboard/editor')
    as(OUT, 'editor', 'Kit Outsider')
    expect((await open()).status).toBe(403)
    expect((await open()).body.redirect).toBeUndefined()
    as(AM, 'account_manager')
    const mine = await open()
    expect(mine.status).toBe(200)
    expect(mine.body.crew.map((c: any) => [c.name, !!c.acknowledged_at])).toEqual([['Vik Camera', true], ['Sam Editor', false]])
    expect(mine.body.editor_name).toBe('Sam Editor')
    expect(mine.body.team.map((t: any) => t.name)).toContain('Sam Editor')
    expect(mine.body.names.owner_id).toBe('Priya Patel')
    expect(mine.body.names[VG]).toBe('Vik Camera')
  })
  it('the crew member’s one press from the email records it — once, and only with a good link', async () => {
    const { signAckToken } = await import('../app/lib/shoot-ack-token')
    const secret = process.env.CLERK_SECRET_KEY!
    const get = (token: string) => ack.GET(new Request(`https://x.test/ack?token=${encodeURIComponent(token)}`), P('b-1'))
    const good = await get(signAckToken('b-1', VG, secret))
    expect(good.status).toBe(200)
    expect(await good.text()).toMatch(/Thanks — you’ve read the plan/)
    expect(batch().acknowledgements.map((a: any) => a.user_id)).toEqual([VG])
    // pressed twice: still once
    await get(signAckToken('b-1', VG, secret))
    expect(batch().acknowledgements).toHaveLength(1)
    // a forged, expired or foreign link records nothing
    expect((await get(signAckToken('b-1', ED, 'wrong-secret'))).status).toBe(400)
    expect((await get(signAckToken('b-1', ED, secret, Date.now() - 40 * 86_400_000))).status).toBe(400)
    expect((await get(signAckToken('b-2', ED, secret))).status).toBe(400)
    expect((await get(signAckToken('b-1', OUT, secret))).status).toBe(403)
    expect(batch().acknowledgements).toHaveLength(1)
  })
  it('a manager can take an acknowledgement back', async () => {
    as(ED, 'editor'); await acknowledge()
    as(AM, 'account_manager')
    const r = await json(ack.DELETE(new Request('https://x.test/ack', { method: 'DELETE', body: JSON.stringify({ user_id: ED }) }), P('b-1')))
    expect(r.status).toBe(200)
    // the database keeps no empty arrays — absent reads as nobody
    expect(batch().acknowledgements ?? []).toEqual([])
  })
})

describe('go', () => {
  it('only an AM, and only once the brief is shared, the ticks are in and everyone has acknowledged', async () => {
    as(ED, 'editor')
    expect((await move('confirmed')).body.error).toMatch(/account manager/)
    as(AM, 'account_manager')
    expect((await move('confirmed')).body.error).toBe('Share the plan with the team first')
    await move('shared')
    expect((await move('confirmed')).body.error).toMatch(/Aligned with the strategist/)
    await edit({ aligned: true, client_confirmed: true })
    expect((await move('confirmed')).body.error).toMatch(/2 of 2 on the shoot have not acknowledged/)
    as(VG, 'general'); await acknowledge()
    as(ED, 'editor'); await acknowledge()
    as(AM, 'account_manager')
    const go = await move('confirmed')
    expect(go.status).toBe(200)
    expect(batch().go_by).toBe(AM)
    // one press: the shoot is booked by go, its plan's lines are cards now —
    // AND THEY ARE THE EDITOR'S ALREADY (11 Sep 2026): owner, deadline and
    // priorities from the plan, the editor told the footage follows the shoot
    expect(batch().status).toBe('locked')
    expect(batch().locked_by).toBe(AM)
    // ONE SHOOT, ONE CARD (11 Sep 2026): the shoot's card, briefed with the list
    expect(cards().map(c => [c.title, c.owner_id, c.due_date, c.brief])).toEqual([
      ['Golf Day', ED, dayShift(14), 'Coming out of this shoot:\n\u2022 Hero reel\n\u2022 Photo set\n\nPriorities: Hero reel first'],
    ])
    expect(go.body.handed).toEqual({ total: 1 })
    const onIt = emails.filter(e => e.eventType === 'shoot_editor_on')
    expect(onIt).toHaveLength(1)
    expect(onIt[0].recipientEmail).toBe('sam@zz.invalid')
    expect(String(onIt[0].subject)).toMatch(/You\u2019re on Golf Day — your card is ready, shoot on/)
    // the reminder follows — and it IS the reminder: call time and location
    // to everyone on the shoot, not a stamp
    emails.length = 0
    expect((await move('reminder_sent')).status).toBe(200)
    expect(batch().reminder_sent_at).toBeTruthy()
    const reminders = emails.filter(e => e.eventType === 'shoot_reminder')
    expect(reminders.map(e => e.recipientEmail).sort()).toEqual(['sam@zz.invalid', 'vik@zz.invalid'])
    expect(String(reminders[0].bodyHtml)).toMatch(/Call time:<\/strong> 7:30 am/)
    expect(String(reminders[0].bodyHtml)).toMatch(/Location:<\/strong> Royal Melbourne/)
  })
  it('the ticks and the people are the manager’s — the AM, the creator, a super admin, a general user; and each tick says who', async () => {
    as(ED, 'editor')
    expect((await edit({ aligned: true })).status).toBe(403)
    expect((await edit({ crew_ids: [OUT] })).status).toBe(403)
    // a general user raises shoots for any client and must be able to work them
    as(VG, 'general')
    expect((await edit({ aligned: true })).status).toBe(200)
    expect(batch().aligned_by).toBe(VG)
    expect((await edit({ aligned: false })).status).toBe(200)
    expect(batch().aligned_by ?? null).toBeNull()
    expect((await edit({ crew_ids: [OUT] })).status).toBe(200)
    expect((await edit({ editor_id: ED })).status).toBe(200)
    as(AM, 'account_manager')
    expect((await edit({ editor_id: VG })).body.error).toMatch(/one of the editors/)
    expect((await edit({ crew_ids: [VG, OUT, 'nobody'] })).status).toBe(200)
    expect(batch().crew_ids).toEqual([VG, OUT])
    expect((await edit({ client_confirmed: true })).status).toBe(200)
    expect(batch().client_confirmed_by).toBe(AM)
  })
})

describe('the handover: Production → Editor', () => {
  it('waits for the day, needs the editor, then makes the cards the editor’s — once', async () => {
    fake.restore(); fake = seed({ go_at: 'x', brief_shared_at: 'x' })
    expect((await move('footage_handed')).body.error).toBe('The shoot has not happened yet')

    fake.restore(); fake = seed({ go_at: 'x', brief_shared_at: 'x', shoot_date: dayShift(-1), editor_id: null })
    expect((await move('footage_handed')).body.error).toMatch(/Name the editor/)

    fake.restore(); fake = seed({ go_at: 'x', brief_shared_at: 'x', shoot_date: dayShift(-1) })
    as(VG, 'general', 'Vik Camera')
    const r = await move('footage_handed')
    expect(r.status).toBe(200)
    // ONE SHOOT, ONE CARD (11 Sep 2026): titled with the shoot, briefed with the list
    expect(r.body.handed).toEqual({ total: 1 })
    const made = cards()
    expect(made).toHaveLength(1)
    expect(made.map(c => [c.title, c.owner_id, c.due_date, c.brief, c.status, c.batch_id])).toEqual([
      ['Golf Day', ED, dayShift(14), 'Coming out of this shoot:\n\u2022 Hero reel\n\u2022 Photo set\n\nPriorities: Hero reel first', 'draft_uploaded', 'b-1'],
    ])
    expect(made.map(c => c.id)).toEqual([shootCardId('b-1')])
    // the editor is told, once, with the count and the date
    const told = emails.filter(e => e.eventType === 'shoot_footage_in')
    expect(told).toHaveLength(1)
    expect(told[0].recipientEmail).toBe('sam@zz.invalid')
    expect(String(told[0].subject)).toMatch(/Footage is in: Golf Day — your card is ready, due/)

    // dragging again: already there, and nothing is made twice
    const again = await move('footage_handed')
    expect(again.status).toBe(422)
    expect(cards()).toHaveLength(1)
  })
  it('a card that already exists keeps its owner; only its empty fields are filled', async () => {
    fake.restore(); fake = seed({ go_at: 'x', brief_shared_at: 'x', shoot_date: dayShift(-1) })
    const t = fake.tree().mdm!.tables! as Record<string, Record<string, unknown>>
    ;(t.content_items ??= {})[planCardId('b-1', 'l1')] = {
      id: planCardId('b-1', 'l1'), client_id: 'c-1', batch_id: 'b-1', title: 'Hero reel', status: 'draft_uploaded',
      owner_id: OUT, due_date: null, brief: null, created_at: 'x', updated_at: 'x',
    }
    const r = await move('footage_handed')
    expect(r.status).toBe(200)
    const hero = cards().find(c => c.id === planCardId('b-1', 'l1'))
    expect(hero.owner_id).toBe(OUT)
    expect(hero.due_date).toBe(dayShift(14))
    expect(hero.brief).toBe('Hero reel first')
    // a shoot that already has a card gets no second one; that card is somebody else's
    expect(cards()).toHaveLength(1)
    expect(r.body.handed).toEqual({ total: 0 })
  })
})

describe('the 7-day rule', () => {
  it('tells the AM and Ops once about a late brief, and nobody about a shared one', async () => {
    fake.restore(); fake = seed({ shoot_date: dayShift(3) })
    const first = await runBriefLateNudge()
    expect(first).toEqual({ late: 1, told: 2 })
    expect(emails.map(e => e.recipientEmail).sort()).toEqual(['abby@zz.invalid', 'am@zz.invalid'])
    expect(String(emails[0].subject)).toMatch(/Plan is late — needed 7 days before the shoot: Golf Day/)
    expect(batch().late_nudged_at).toBeTruthy()
    emails.length = 0
    expect(await runBriefLateNudge()).toEqual({ late: 0, told: 0 })
    expect(emails).toHaveLength(0)

    fake.restore(); fake = seed({ shoot_date: dayShift(3), brief_shared_at: 'x' })
    expect(await runBriefLateNudge()).toEqual({ late: 0, told: 0 })
  })
})

/* ── no brief, no shoot — enforced on the route (11 Sep 2026) ── */

describe('a plan shared late', () => {
  const SUPER = 'a5a5a5a5-0000-4000-8000-000000000001'
  const sharedLateReady = () => {
    fake.restore()
    fake = seed({
      shoot_date: dayShift(4), brief_shared_at: new Date().toISOString(), aligned_at: 'x', client_confirmed_at: 'x',
      acknowledgements: [{ user_id: VG, at: 'x' }, { user_id: ED, at: 'x' }],
    })
  }
  it('an account manager is refused in the SOP\u2019s words; a super admin without a reason gets a 400', async () => {
    sharedLateReady()
    const am = await move('confirmed')
    expect(am.status).toBe(400)
    expect(am.body.error).toBe('The plan was shared 4 days before the shoot — the playbook needs 7. A super admin can override with a reason.')
    expect(am.body.needsOverride).toBe(true)
    as(SUPER, 'super_admin', 'Divina')
    expect((await move('confirmed')).status).toBe(400)
    expect(batch().go_at).toBeFalsy()
  })
  it('a super admin goes ahead with a reason: kept on the shoot, logged, Ops told once', async () => {
    sharedLateReady()
    as(SUPER, 'super_admin', 'Divina')
    emails.length = 0
    const went = await json(stage.POST(new Request('https://x.test/stage', {
      method: 'POST', body: JSON.stringify({ to: 'confirmed', reason: 'Client moved the date' }),
    }), P('b-1')))
    expect(went.status).toBe(200)
    expect(went.body.moved).toMatch(/went ahead late/)
    expect(batch().go_by).toBe(SUPER)
    expect(batch().go_override_reason).toBe('Client moved the date')
    expect(batch().go_override_by).toBe(SUPER)
    const told = emails.filter(e => e.eventType === 'shoot_go_override')
    expect(told.map(e => e.recipientEmail).sort()).toEqual(['abby@zz.invalid', 'am@zz.invalid'])
    expect(String(told[0].bodyHtml)).toMatch(/Reason:<\/strong> Client moved the date/)
    expect(String(told[0].bodyHtml)).toMatch(/4 days/)
  })
  it('the morning nudge tells the AM and Ops once that a plan was shared late', async () => {
    fake.restore(); fake = seed({ shoot_date: dayShift(3), brief_shared_at: new Date().toISOString() })
    emails.length = 0
    expect(await runBriefLateNudge()).toEqual({ late: 1, told: 2 })
    expect(emails.map(e => e.recipientEmail).sort()).toEqual(['abby@zz.invalid', 'am@zz.invalid'])
    expect(String(emails[0].subject)).toBe('\u26a0\ufe0f Plan shared late: Golf Day')
    expect(String(emails[0].bodyHtml)).toMatch(/3 days<\/strong> before the shoot/)
    expect(batch().late_share_nudged_at).toBeTruthy()
    emails.length = 0
    expect(await runBriefLateNudge()).toEqual({ late: 0, told: 0 })
  })
})

/* ── the handover needs no press (11 Sep 2026) ── */

describe('the handover without a press', () => {
  it('naming the editor after go hands them the cards at once, and tells them', async () => {
    fake.restore(); fake = seed({ go_at: 'x', brief_shared_at: 'x', status: 'locked', editor_id: null })
    const t = fake.tree().mdm!.tables! as Record<string, Record<string, unknown>>
    ;(t.content_items ??= {})[planCardId('b-1', 'l1')] = {
      id: planCardId('b-1', 'l1'), client_id: 'c-1', batch_id: 'b-1', title: 'Hero reel', status: 'draft_uploaded',
      owner_id: null, due_date: null, brief: null, created_at: 'x', updated_at: 'x',
    }
    expect((await edit({ editor_id: ED })).status).toBe(200)
    // the card that exists is filled; no second card is made
    expect(cards().map(c => [c.title, c.owner_id, c.due_date])).toEqual([
      ['Hero reel', ED, dayShift(14)],
    ])
    const onIt = emails.filter(e => e.eventType === 'shoot_editor_on')
    expect(onIt.map(e => e.recipientEmail)).toEqual(['sam@zz.invalid'])
    // one key per shoot and editor, so the mailer can never tell them twice
    expect(String(onIt[0].entityId)).toBe(`b-1#editor#${ED}`)
    // naming the same editor again changes nothing
    expect((await edit({ editor_id: ED })).status).toBe(200)
    expect(cards()).toHaveLength(1)
  })
  it('the morning after the shoot, the footage is handed over by itself and the editor told to start', async () => {
    fake.restore(); fake = seed({ go_at: 'x', brief_shared_at: 'x', status: 'locked', shoot_date: dayShift(-1) })
    expect(await runFootageDueSweep()).toEqual({ handed: 1, askedForEditor: 0 })
    expect(batch().footage_handed_at).toBeTruthy()
    expect(batch().footage_due_nudged_at).toBeTruthy()
    expect(cards().map(c => [c.title, c.owner_id])).toEqual([['Golf Day', ED]])
    const told = emails.filter(e => e.eventType === 'shoot_footage_in')
    expect(told).toHaveLength(1)
    expect(told[0].recipientEmail).toBe('sam@zz.invalid')
    expect(String(told[0].subject)).toMatch(/^Footage should be in: Golf Day — start the edit, due /)
    // once: a second morning does nothing
    emails.length = 0
    expect(await runFootageDueSweep()).toEqual({ handed: 0, askedForEditor: 0 })
    expect(emails).toHaveLength(0)
    // a person who already pressed "Footage is in" is left alone by the sweep
    fake.restore(); fake = seed({ go_at: 'x', brief_shared_at: 'x', status: 'locked', shoot_date: dayShift(-1), footage_handed_at: 'x' })
    expect(await runFootageDueSweep()).toEqual({ handed: 0, askedForEditor: 0 })
    // and on the day itself, nothing yet
    fake.restore(); fake = seed({ go_at: 'x', brief_shared_at: 'x', status: 'locked', shoot_date: dayShift(0) })
    expect(await runFootageDueSweep()).toEqual({ handed: 0, askedForEditor: 0 })
  })
  it('a shoot shot with no editor named asks its account manager for one, once', async () => {
    fake.restore(); fake = seed({ go_at: 'x', brief_shared_at: 'x', status: 'locked', shoot_date: dayShift(-1), editor_id: null })
    expect(await runFootageDueSweep()).toEqual({ handed: 0, askedForEditor: 1 })
    expect(emails.map(e => e.recipientEmail)).toEqual(['am@zz.invalid'])
    expect(String(emails[0].subject)).toMatch(/^Name the editor: Golf Day was shot/)
    expect(batch().footage_handed_at).toBeFalsy()
    emails.length = 0
    expect(await runFootageDueSweep()).toEqual({ handed: 0, askedForEditor: 0 })
  })
})

/* ── where the footage lives (11 Sep 2026: "how do they get the dropbox link") ── */

describe('the footage folder', () => {
  const SC = 'b2b2b2b2-0000-4000-8000-000000000001'
  const withCrewScheduler = (over: Record<string, unknown> = {}) => {
    fake.restore(); fake = seed({ crew_ids: [VG, SC], ...over })
    const t = fake.tree().mdm!.tables! as Record<string, Record<string, unknown>>
    t.team_users[SC] = { id: SC, name: 'Cath Crew', email: 'cath@zz.invalid', role: 'scheduler', active_status: true }
  }
  it('is checked as a link, and pasted by the manager — the crew and the editor do nothing on the shoot page', async () => {
    withCrewScheduler()
    as(AM, 'account_manager')
    expect((await edit({ footage_url: 'not a link' })).status).toBe(422)
    expect((await edit({ footage_url: 'https://www.dropbox.com/scl/fo/golf-day' })).status).toBe(200)
    expect(batch().footage_url).toBe('https://www.dropbox.com/scl/fo/golf-day')
    as(SC, 'scheduler', 'Cath Crew')
    expect((await edit({ footage_url: 'https://drive.google.com/drive/folders/abc' })).status).toBe(403)
    expect(batch().footage_url).toBe('https://www.dropbox.com/scl/fo/golf-day')
    as(OUT, 'editor')
    expect((await edit({ footage_url: 'https://drive.google.com/x' })).status).toBe(403)
  })
  it('reaches every card as Files to work from when the footage is handed over, and the editor\u2019s email carries it', async () => {
    fake.restore(); fake = seed({ go_at: 'x', brief_shared_at: 'x', status: 'locked', shoot_date: dayShift(-1), footage_url: 'https://www.dropbox.com/scl/fo/golf-day' })
    const t = fake.tree().mdm!.tables! as Record<string, Record<string, unknown>>
    ;(t.content_items ??= {})[planCardId('b-1', 'l1')] = {
      id: planCardId('b-1', 'l1'), client_id: 'c-1', batch_id: 'b-1', title: 'Hero reel', status: 'draft_uploaded',
      owner_id: ED, due_date: null, brief: null, raw_assets_url: 'https://drive.google.com/chosen', created_at: 'x', updated_at: 'x',
    }
    expect((await move('footage_handed')).status).toBe(200)
    // the card somebody already pointed at a folder keeps it; no second card is made
    const byTitle = Object.fromEntries(cards().map(c => [c.title, c.raw_assets_url]))
    expect(byTitle).toEqual({ 'Hero reel': 'https://drive.google.com/chosen' })
    const told = emails.filter(e => e.eventType === 'shoot_footage_in')
    expect(String(told[0].bodyHtml)).toMatch(/Footage folder:<\/strong> <a href="https:\/\/www\.dropbox\.com\/scl\/fo\/golf-day"/)
  })
  it('the morning sweep fills it too, and a folder pasted after the handover reaches the cards then', async () => {
    fake.restore(); fake = seed({ go_at: 'x', brief_shared_at: 'x', status: 'locked', shoot_date: dayShift(-1), footage_url: 'https://www.dropbox.com/scl/fo/golf-day' })
    expect(await runFootageDueSweep()).toEqual({ handed: 1, askedForEditor: 0 })
    expect(cards().every(c => c.raw_assets_url === 'https://www.dropbox.com/scl/fo/golf-day')).toBe(true)

    fake.restore(); fake = seed({ go_at: 'x', brief_shared_at: 'x', status: 'locked', shoot_date: dayShift(-1) })
    expect((await move('footage_handed')).status).toBe(200)
    expect(cards().every(c => !c.raw_assets_url)).toBe(true)
    as(VG, 'general')
    expect((await edit({ footage_url: 'https://www.dropbox.com/scl/fo/late' })).status).toBe(200)
    expect(cards().every(c => c.raw_assets_url === 'https://www.dropbox.com/scl/fo/late')).toBe(true)
  })
})

/* ── the client, from the shoot page and back from the portal (13 Sep 2026) ── */

describe('sharing the plan with the client', () => {
  const share = (id = 'b-1') => json(shareClient.POST(new Request('https://x.test/share', { method: 'POST' }), P(id)))
  const answer = (body: Record<string, unknown>) => json(portalAct.POST(new Request('https://x.test/act', { method: 'POST', body: JSON.stringify(body) })))
  const withClientEmail = (over: Record<string, unknown> = {}) => {
    fake.restore(); fake = seed(over)
    const t = fake.tree().mdm!.tables! as Record<string, Record<string, Record<string, unknown>>>
    t.clients['c-1'] = { ...t.clients['c-1'], email: 'client@zz.invalid', share_token: '11111111-2222-4333-8444-555555555555' }
  }
  it('needs the nine parts, then puts the plan on the portal, emails the client, and stamps who and when', async () => {
    withClientEmail({ talent: null })
    const no = await share()
    expect(no.status).toBe(422)
    expect(no.body.error).toMatch(/Fill in the plan first — talent or presenter still to go/)
    await edit({ talent: 'Sam' })
    emails.length = 0
    const yes = await share()
    expect(yes.status).toBe(200)
    expect(yes.body.emailed).toBe(true)
    expect(batch().shared_with_client).toBe(true)
    expect(batch().client_shared_by).toBe(AM)
    expect(batch().client_shared_at).toBeTruthy()
    const toClient = emails.find(e => e.recipientEmail === 'client@zz.invalid')!
    expect(toClient.toClient).toBe(true)
    expect(String(toClient.subject)).toMatch(/^Your shoot plan: Golf Day/)
    expect(String(toClient.bodyHtml)).toMatch(/\/portal\/11111111-2222-4333-8444-555555555555/)
    expect(String(toClient.bodyHtml)).toMatch(/Shot list<\/td>/)
    // an editor cannot send the plan to the client
    as(ED, 'editor')
    expect((await share()).status).toBe(403)
  })
  it('the client’s answer lands on the shoot, the managers are told, and a second answer is refused until it is shared again', async () => {
    withClientEmail()
    await share()
    emails.length = 0
    // approve, from the share link — no plan document anywhere
    const ok = await answer({ token: '11111111-2222-4333-8444-555555555555', shoot_id: 'b-1', action: 'approve', author_name: 'Dee' })
    expect(ok.status).toBe(200)
    expect(batch().client_decision).toBe('approved')
    expect(batch().client_decided_at).toBeTruthy()
    const told = emails.filter(e => e.eventType === 'shoot_plan_client_answer')
    expect(told.map(e => e.recipientEmail).sort()).toEqual(['abby@zz.invalid', 'am@zz.invalid'])
    expect(String(told[0].subject)).toMatch(/^Dee · ZZ TEST approved the plan: Golf Day/)
    // approved is final until the plan is shared again
    expect((await answer({ token: '11111111-2222-4333-8444-555555555555', shoot_id: 'b-1', action: 'request_changes', comment: 'Later' })).status).toBe(403)
    // shared again: the answer is cleared, and changes can be asked for, with the note kept
    as(AM, 'account_manager')
    await share()
    expect(batch().client_decision ?? null).toBeNull()
    const changes = await answer({ token: '11111111-2222-4333-8444-555555555555', shoot_id: 'b-1', action: 'request_changes', comment: 'Swap the opening shot' })
    expect(changes.status).toBe(200)
    expect(batch().client_decision).toBe('changes')
    expect(batch().client_decision_note).toBe('Swap the opening shot')
    expect(fake.rows('batch_comments').map((c: any) => c.body)).toEqual(['Swap the opening shot'])
    // a bad token, another client's shoot, and a shoot never shared: refused
    expect((await answer({ token: 'nope', shoot_id: 'b-1', action: 'approve' })).status).toBe(401)
    fake.restore(); fake = seed({ shared_with_client: false })
    expect((await answer({ token: '11111111-2222-4333-8444-555555555555', shoot_id: 'b-1', action: 'approve' })).status).toBe(401)
  })
})
