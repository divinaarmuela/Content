import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { roleSatisfies, type Role } from '../app/lib/identity-core'
import { NO_QUALITY_CHECKER, PLAN_REVIEW_WORDS } from '../app/lib/shoot-sop-core'
import { STAND_IN_MARK } from '../app/lib/card-history-core'

/**
 * THE QUALITY REVIEW GATE ON A PLAN, through the routes (the owner, 13 Sep
 * 2026: "shoot briefs … must go through quality review too … not for super
 * admins"). A plan written or held by an account manager or a general user
 * is passed by the quality checker before Go; a super admin's plan is not
 * held up; a super admin may pass one in the reviewer's place.
 */

process.env.CLERK_SECRET_KEY ??= 'test-secret-for-the-acknowledge-link'
const emails: Record<string, unknown>[] = []
const AM = 'a1a1a1a1-0000-4000-8000-000000000001'
const ED = 'e1e1e1e1-0000-4000-8000-000000000001'
const VG = 'c1c1c1c1-0000-4000-8000-000000000001'
const JOY = 'b2b2b2b2-0000-4000-8000-000000000001'
const ABBY = 'f1f1f1f1-0000-4000-8000-000000000001'
const RAINA = 'd2d2d2d2-0000-4000-8000-000000000001'

let who: { id: string; name: string; role: Role; client_id: string | null; quality_reviewer?: boolean } =
  { id: AM, name: 'Karly', role: 'account_manager', client_id: null }
const as = (id: string, role: Role, name = 'Someone', quality_reviewer = false) => { who = { id, name, role, client_id: null, quality_reviewer } }

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

const review = await import('../app/api/production/batches/[id]/review/route')
const planReview = await import('../app/api/production/batches/[id]/plan-review/route')
const stage = await import('../app/api/production/batches/[id]/stage/route')
const detail = await import('../app/api/production/batches/[id]/route')
const workflow = await import('../app/lib/workflow')

const dayShift = (n: number) => new Date(Date.now() + n * 86_400_000)
  .toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })

/** a complete, shared, acknowledged, ticked plan — everything but the gate */
const readyPlan = (over: Record<string, unknown> = {}) => ({
  id: 'b-1', client_id: 'c-1', title: 'Golf Day', status: 'brief', owner_id: AM, created_by: AM,
  shoot_date: dayShift(10), call_time: '7:30 am', location: 'Royal Melbourne',
  shot_list: [{ id: 's1', text: 'Drone over the 1st', done: false }],
  planned_deliverables: [{ id: 'l1', title: 'Hero reel' }],
  objective: 'Spring drive', script: 'Three points', talent: 'Sam', props_wardrobe: 'Polos',
  client_availability: 'GM 8–10', editor_priorities: 'Hero reel first', edit_deadline: dayShift(14),
  editor_id: ED, crew_ids: [VG],
  brief_shared_at: new Date(Date.now() - 8 * 86_400_000).toISOString(), brief_shared_by: AM,
  acknowledgements: [{ user_id: ED, at: 'x' }, { user_id: VG, at: 'x' }],
  aligned_at: 'x', aligned_by: AM, client_confirmed_at: 'x', client_confirmed_by: AM,
  canvas_cards: [], reference_media: [], created_at: '2026-09-01T00:00:00.000Z',
  ...over,
})

let fake: ReturnType<typeof seedDb>
const seed = (over: Record<string, unknown> = {}, people: Row[] = []) => seedDb({
  clients: [{ id: 'c-1', name: 'ZZ TEST', timezone: 'Australia/Melbourne' }] as unknown as Row[],
  batches: [readyPlan(over)] as unknown as Row[],
  team_users: [
    { id: AM, name: 'Karly', email: 'karly@zz.invalid', role: 'account_manager', active_status: true },
    { id: ED, name: 'Sam Editor', email: 'sam@zz.invalid', role: 'editor', active_status: true },
    { id: VG, name: 'Vik Camera', email: 'vik@zz.invalid', role: 'general', active_status: true },
    { id: ABBY, name: 'Abby', email: 'abby@zz.invalid', role: 'super_admin', active_status: true },
    { id: RAINA, name: 'Raina', email: 'raina@zz.invalid', role: 'general', active_status: true },
    ...people,
  ] as unknown as Row[],
  team_user_clients: [{ id: 'l1', team_user_id: AM, client_id: 'c-1' }] as unknown as Row[],
  work_kinds: [], content_items: [], workflow_activity: [], batch_comments: [], item_comments: [], shoot_proposals: [],
})
const joy = { id: JOY, name: 'Joy', email: 'joy@zz.invalid', role: 'quality_checker', active_status: true } as unknown as Row

beforeEach(() => { emails.length = 0; vi.mocked(workflow.logActivity).mockClear(); as(AM, 'account_manager', 'Karly'); fake = seed({}, [joy]) })
afterEach(() => fake.restore())

const P = (id: string) => ({ params: Promise.resolve({ id }) })
const json = async (r: Response | Promise<Response | undefined>) => { const res = (await r)!; return { status: res.status, body: await res.json() as any } }
const ask = (to: string[] = []) => json(review.POST(new Request('https://x.test/r', { method: 'POST', body: JSON.stringify({ to }) }), P('b-1')))
const answer = (body: Record<string, unknown>) => json(planReview.POST(new Request('https://x.test/pr', { method: 'POST', body: JSON.stringify(body) }), P('b-1')))
const move = (to: string) => json(stage.POST(new Request('https://x.test/stage', { method: 'POST', body: JSON.stringify({ to }) }), P('b-1')))
const open = () => json(detail.GET(new Request('https://x.test/b'), P('b-1')))
const batch = () => fake.rows('batches').find(b => b.id === 'b-1') as any

describe('the gate', () => {
  it('an account manager’s plan cannot go until the quality checker passed it', async () => {
    const no = await move('confirmed')
    expect(no.status).toBe(422)
    expect(no.body.error).toContain(PLAN_REVIEW_WORDS)
    expect((await open()).body.plan_review_required).toBe(true)
  })
  it('a super admin’s plan is not held up', async () => {
    fake.restore(); fake = seed({ owner_id: ABBY, created_by: ABBY }, [joy])
    as(ABBY, 'super_admin', 'Abby')
    expect((await open()).body.plan_review_required).toBe(false)
    expect((await move('confirmed')).status).toBe(200)
  })
  it('a general user’s plan, even one a super admin holds, needs the pass', async () => {
    fake.restore(); fake = seed({ owner_id: ABBY, created_by: RAINA }, [joy])
    as(ABBY, 'super_admin', 'Abby')
    expect((await open()).body.plan_review_required).toBe(true)
  })
})

describe('asking', () => {
  it('goes to the quality checker, not the account managers, and says so', async () => {
    const r = await ask()
    expect(r.status).toBe(200)
    expect(r.body.asked).toEqual([JOY])
    expect(emails.map(e => e.recipientEmail)).toEqual(['joy@zz.invalid'])
    expect(String(emails[0].subject)).toBe('Quality review the plan: Golf Day')
    expect(String(emails[0].bodyHtml)).toContain('Pass the plan')
  })
  it('with no quality checker on the team it refuses in plain words', async () => {
    fake.restore(); fake = seed()
    const r = await ask()
    expect(r.status).toBe(422)
    expect(r.body.error).toBe(NO_QUALITY_CHECKER)
  })
})

describe('passing and sending back', () => {
  it('the quality checker can OPEN the shoot page to review it, and still cannot edit the plan (13 Sep 2026)', async () => {
    fake.restore(); fake = seed({}, [joy])
    as(JOY, 'quality_checker', 'Joy')
    const r = await open()
    expect(r.status).toBe(200)
    expect(Object.keys(r.body)).toContain('plan_review_required')
    // reading is not working: the plan's fields are still the manager's
    const edit = await json(detail.PATCH(new Request('https://x.test/b', { method: 'PATCH', body: JSON.stringify({ objective: 'Joy wrote this' }) }), P('b-1')))
    expect(edit.status).toBe(403)
    expect(batch().objective).not.toBe('Joy wrote this')
  })
  it('the editor and the crew on the shoot can OPEN the plan to read it — read-only, no edits (13 Sep 2026)', async () => {
    fake.restore(); fake = seed({ editor_id: 'u-ed', crew_ids: ['u-vik'] }, [joy,
      { id: 'u-ed', name: 'Eden', email: 'ed@zz.invalid', role: 'editor', active_status: true } as unknown as Row,
      { id: 'u-vik', name: 'Vik', email: 'vik@zz.invalid', role: 'scheduler', active_status: true } as unknown as Row])
    as('u-ed', 'editor', 'Eden')
    const r = await open()
    expect(r.status).toBe(200)
    expect(r.body.read_only).toBe(true)
    as('u-vik', 'scheduler', 'Vik')
    expect((await open()).body.read_only).toBe(true)
    const edit = await json(detail.PATCH(new Request('https://x.test/b', { method: 'PATCH', body: JSON.stringify({ objective: 'Vik wrote this' }) }), P('b-1')))
    expect(edit.status).toBe(403)
    // the manager's answer says the page is theirs to work
    as(AM, 'account_manager', 'Karly')
    expect((await open()).body.read_only).toBe(false)
  })
  it('an account manager may not pass a plan', async () => {
    expect((await answer({ pass: true })).status).toBe(403)
    expect(batch().plan_reviewed_at ?? null).toBeNull()
  })
  it('the quality checker passes it: stamped, the asker and the owner told, and Go opens', async () => {
    await ask()
    emails.length = 0
    as(JOY, 'quality_checker', 'Joy')
    const r = await answer({ pass: true })
    expect(r.status).toBe(200)
    expect(batch().plan_reviewed_by).toBe(JOY)
    expect(batch().plan_reviewed_at).toBeTruthy()
    expect(emails.map(e => e.recipientEmail).sort()).toEqual(['karly@zz.invalid'])
    expect(String(emails[0].subject)).toBe('Plan passed quality review: Golf Day')
    const log = vi.mocked(workflow.logActivity).mock.calls.at(-1)?.[0] as { action: string; detail: string }
    expect(log.action).toBe('sop_plan_reviewed')
    expect(log.detail).not.toContain(STAND_IN_MARK)
    as(AM, 'account_manager', 'Karly')
    expect((await move('confirmed')).status).toBe(200)
  })
  it('a super admin without the hat passes it in the reviewer’s place, and the history says so', async () => {
    as(ABBY, 'super_admin', 'Abby')
    expect((await answer({ pass: true })).status).toBe(200)
    const log = vi.mocked(workflow.logActivity).mock.calls.at(-1)?.[0] as { detail: string }
    expect(log.detail).toContain(STAND_IN_MARK)
  })
  it('sent back with a note: no pass, a comment tagged to the asker, and an email with the note', async () => {
    await ask()
    emails.length = 0
    as(JOY, 'quality_checker', 'Joy')
    expect((await answer({ pass: false })).status).toBe(400)
    const r = await answer({ pass: false, note: 'The objective names no pillar' })
    expect(r.status).toBe(200)
    expect(batch().plan_reviewed_at ?? null).toBeNull()
    // the note is NOT a shoot comment — those are read by the client on
    // their portal (13 Sep 2026); it is on the shoot itself, for the panel
    expect(fake.rows('batch_comments')).toHaveLength(0)
    expect(batch().plan_sent_back_note).toBe('The objective names no pillar')
    expect(batch().plan_sent_back_by).toBe(JOY)
    expect(String(emails[0].subject)).toBe('Plan sent back: Golf Day')
    expect(String(emails[0].bodyHtml)).toContain('The objective names no pillar')
    as(AM, 'account_manager', 'Karly')
    expect((await move('confirmed')).status).toBe(422)
  })
})
