import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import {
  autoHandoverTargets, batchApprovalSteps, batchDraftId, batchMode, groupBatches, handoverNotice,
  planBatch, plannerSaves, readPostBatch, spreadTimes, spreadWords,
} from '../app/lib/post-batch-core'
import { checkPostTransition, postTitle, readPostState } from '../app/lib/post-stage-core'
import { BATCH_CHECK_LINE, windowHeader } from '../app/lib/post-window-core'

/**
 * THE CARD ITSELF, AS A BATCH (the owner, 1 Oct 2026, after a live walk: a card with 8 approved files
 * became a 1-file draft). The pure rules first, then the REAL transition and hand-off routes on the
 * in-memory database: one draft per approved file, a carousel stays one, nothing is made twice, the
 * automatic hand-over happens only when the client has a scheduler set and only once, the scheduler
 * hears once per batch, and the client is not asked to approve the same files twice unless they sign
 * off every post.
 */

const ITEM = 'aaaaaaaa-0000-4000-8000-0000000ba001'
const JOY = { id: 'u-joy', role: 'account_manager', email: 'joy@x.invalid', name: 'Joy', clerk_user_id: null, quality_reviewer: true }
const ED = { id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Eden', clerk_user_id: null }
const CATH = { id: 'u-cath', role: 'scheduler', email: 'cath@x.invalid', name: 'Test Scheduler', clerk_user_id: null }
const KIM = { id: 'u-kim', role: 'scheduler', email: 'kim@x.invalid', name: 'Kim', clerk_user_id: null }

const h = vi.hoisted(() => ({
  user: null as unknown as Record<string, unknown>,
  emails: [] as { recipientId?: string; recipientEmail: string; subject: string; bodyHtml: string }[],
}))

vi.mock('../app/lib/authz', () => ({
  requireSignedIn: async () => h.user,
  requireRole: async () => h.user,
  AuthzError: class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  },
  authzErrorResponse: (e: unknown) => ({
    error: e instanceof Error ? e.message : 'error',
    status: (e as { status?: number })?.status ?? 500,
  }),
}))
vi.mock('../app/lib/production-access', () => ({
  loadItemForUser: async (_u: unknown, id: string) => {
    const { table } = await import('@/lib/db')
    const row = await table('content_items').get(id)
    if (!row) throw Object.assign(new Error('Item not found'), { status: 404 })
    return row
  },
}))
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(async (m: { recipientEmail: string; subject: string; bodyHtml: string }) => { h.emails.push(m); return 'sent' }),
  renderEmail: (_s: string, body: string) => body,
  escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/gdrive-mirror', () => ({
  mirrorLatestVersionSoon: vi.fn(), mirrorVersionSlides: vi.fn(), mirrorRawAssets: vi.fn(), newRawAssets: () => [],
}))
vi.mock('../app/lib/stream', () => ({ previewVideos: vi.fn() }))
vi.mock('../app/lib/production-live', () => ({ announceItemChange: vi.fn(), announceBatchChange: vi.fn() }))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({})) } }))

const { POST: TRANSITION } = await import('../app/api/production/items/[id]/transition/route')
const { POST: HANDOFF } = await import('../app/api/production/items/[id]/handoff/route')
const { createBatchForCard } = await import('../app/lib/post-batch')

const clip = (n: number, mime = 'video/mp4', ext = 'mp4') => ({
  id: `f${n}`, name: `Clip ${n}.${ext}`, url: `https://r2.test/up/clip-${n}.${ext}`, mime, size: 1000 + n,
  version: 1, uploaded_at: `2026-09-30T00:00:0${n % 10}.000Z`, by: ED.id,
})
const EIGHT = Array.from({ length: 8 }, (_, i) => clip(i + 1))
const PICS = Array.from({ length: 3 }, (_, i) => clip(i + 1, 'image/jpeg', 'jpg'))

let fake: ReturnType<typeof seedDb>
const seed = (over: { client?: Record<string, unknown>; item?: Record<string, unknown> } = {}) => seedDb({
  clients: [{ id: 'c1', name: 'Walk Test Client', timezone: 'Australia/Melbourne', posts_own_content: false, default_scheduler_ids: [CATH.id], ...over.client }] as unknown as Row[],
  team_users: [JOY, ED, CATH, KIM].map(u => ({ ...u, active_status: true })) as unknown as Row[],
  team_user_clients: [{ id: `${JOY.id}__c1`, team_user_id: JOY.id, client_id: 'c1' }] as unknown as Row[],
  content_items: [{
    id: ITEM, client_id: 'c1', title: 'WALK TEST', status: 'quality_check', content_type: 'reel',
    owner_id: ED.id, scheduler_ids: [], current_version_number: 1, edit_round: 1, batch_id: null,
    work_kind_id: null, client_approval_required: true, due_date: null, final_files: EIGHT, ...over.item,
  }] as unknown as Row[],
  asset_versions: [],
  workflow_activity: [],
} as never)

const move = async (to: string) => {
  const res = await TRANSITION(
    new Request(`https://x.test/api/production/items/${ITEM}/transition`, { method: 'POST', body: JSON.stringify({ to }) }),
    { params: Promise.resolve({ id: ITEM }) },
  )
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}
const hand = async (ids: string[], approve = false) => {
  const res = await HANDOFF(
    new Request(`https://x.test/api/production/items/${ITEM}/handoff`, { method: 'POST', body: JSON.stringify({ scheduler_ids: ids, ...(approve ? { approve: true } : {}) }) }),
    { params: Promise.resolve({ id: ITEM }) },
  )
  return { status: res.status, json: await res.json() as { posts?: number; post_ids?: string[]; handed_to?: string; post_problem?: string; error?: string } }
}
const drain = () => new Promise(r => setTimeout(r, 40))
const card = () => fake.rows('content_items').find(r => r.id === ITEM) as Record<string, any>
const posts = () => (fake.rows('social_posts') as Record<string, any>[]).sort((a, b) => a.batch.index - b.batch.index)
const mailsTo = (u: { email: string }) => h.emails.filter(e => e.recipientEmail === u.email)

beforeEach(() => { h.user = JOY; h.emails = [] })
afterEach(() => fake?.restore())

/* ── the pure rules ─────────────────────────────────────────────────────── */

describe('which drafts a hand-over makes (planBatch)', () => {
  const slides = (files: ReturnType<typeof clip>[]) => files.map(f => ({ url: f.url, name: f.name, type: (f.mime.startsWith('video') ? 'video' : 'image') as 'video' | 'image' }))

  it('N video files → N drafts, titled from the card, each with its own stable id', () => {
    const plan = planBatch({ itemId: ITEM, title: 'WALK TEST', round: 2, contentType: 'reel', slides: slides(EIGHT), filesCard: true })
    expect(plan).toHaveLength(8)
    expect(plan.map(p => p.batch.title)).toEqual(Array.from({ length: 8 }, (_, i) => `WALK TEST · ${i + 1} of 8`))
    expect(plan.every(p => p.slides.length === 1)).toBe(true)
    expect(plan.map(p => p.slides[0].url)).toEqual(EIGHT.map(f => f.url))
    expect(new Set(plan.map(p => p.id)).size).toBe(8)
    expect(plan.every(p => p.batch.key === `${ITEM}_v2` && p.batch.total === 8)).toBe(true)
    // the same card, version and files → the same ids (the duplicate guard)
    expect(planBatch({ itemId: ITEM, title: 'WALK TEST', round: 2, contentType: 'reel', slides: slides(EIGHT), filesCard: true }).map(p => p.id))
      .toEqual(plan.map(p => p.id))
    expect(plan[0].id).not.toMatch(/[.#$[\]/]/)
  })

  it('a carousel (or graphics, or pictures only) → ONE draft with every picture in order', () => {
    for (const contentType of ['carousel', 'graphic', 'static', 'reel']) {
      const plan = planBatch({ itemId: ITEM, title: 'Menu', round: 1, contentType, slides: slides(PICS), filesCard: true })
      expect(plan, contentType).toHaveLength(1)
      expect(plan[0].slides.map(s => s.url)).toEqual(PICS.map(f => f.url))
      expect(plan[0].batch).toMatchObject({ index: 1, total: 1, title: 'Menu' })
      expect(plan[0].id).toBe(batchDraftId(ITEM, 1, 'all'))
    }
    // a carousel of clips is still one post
    expect(planBatch({ itemId: ITEM, title: 'X', round: 1, contentType: 'carousel', slides: slides(EIGHT), filesCard: true })).toHaveLength(1)
    expect(batchMode('reel', slides(EIGHT))).toBe('each')
  })

  it('an older media-version card keeps its one post (a Reel version’s cover still is not a second Reel)', () => {
    const plan = planBatch({ itemId: ITEM, title: 'Old', round: 1, contentType: 'reel', slides: slides(EIGHT), filesCard: false })
    expect(plan).toHaveLength(1)
    expect(plan[0].slides).toHaveLength(1)
  })

  it('no files → nothing; the same file twice is one draft', () => {
    expect(planBatch({ itemId: ITEM, title: 'X', round: 1, contentType: 'reel', slides: [], filesCard: true })).toEqual([])
    const two = slides([EIGHT[0], EIGHT[0], EIGHT[1]])
    expect(planBatch({ itemId: ITEM, title: 'X', round: 1, contentType: 'reel', slides: two, filesCard: true })).toHaveLength(2)
  })

  it('reads back off the row, and names the post', () => {
    const b = readPostBatch({ key: 'k', item_id: ITEM, round: 1, index: 3, total: 8, title: 'WALK TEST · 3 of 8' })
    expect(b).toMatchObject({ index: 3, total: 8 })
    expect(readPostBatch({ key: 'k' })).toBeNull()
    expect(postTitle({ caption: 'hello', batch: b }, 'WALK TEST')).toBe('WALK TEST · 3 of 8')
    expect(postTitle({ caption: 'hello' }, 'WALK TEST')).toBe('WALK TEST')
  })
})

describe('approve once — the client’s switch decides (batchApprovalSteps)', () => {
  it('switch off (or unset): team only; switch on: team, then the client', () => {
    expect(batchApprovalSteps({ client_approval_required: false })).toBe('team')
    expect(batchApprovalSteps({})).toBe('team')
    expect(batchApprovalSteps(null)).toBe('team')
    expect(batchApprovalSteps({ client_approval_required: true })).toBe('team_then_client')
  })
})

describe('the planner spreads the times (spreadTimes)', () => {
  it('one a day at 9:00 am, in the client’s zone — across the daylight-saving change', () => {
    // Melbourne moves to AEDT on Sunday 4 Oct 2026: 9:00 am stays 9:00 am
    expect(spreadTimes({ start: '2026-10-03', time: '09:00', count: 3, zone: 'Australia/Melbourne' })).toEqual([
      '2026-10-02T23:00:00.000Z', '2026-10-03T22:00:00.000Z', '2026-10-04T22:00:00.000Z',
    ])
  })
  it('every N days, and nothing for a date or time it cannot read', () => {
    expect(spreadTimes({ start: '2026-10-05', time: '18:30', count: 2, everyDays: 7, zone: 'UTC' }))
      .toEqual(['2026-10-05T18:30:00.000Z', '2026-10-12T18:30:00.000Z'])
    expect(spreadTimes({ start: '', time: '09:00', count: 2, zone: 'UTC' })).toEqual([null, null])
    expect(spreadTimes({ start: '2026-10-05', time: '25:00', count: 1, zone: 'UTC' })).toEqual([null])
    expect(spreadTimes({ start: '2026-10-30', time: '09:00', count: 3, zone: 'UTC' })[2]).toBe('2026-11-01T09:00:00.000Z')
  })
  it('says what it will do before it is done', () => {
    expect(spreadWords({ start: '2026-10-05', time: '09:00', count: 8, zone: 'Australia/Melbourne' })).toBe('One a day at 9:00 am from Mon 5 Oct')
    expect(spreadWords({ start: '2026-10-05', time: '09:00', count: 8, everyDays: 7, zone: 'Australia/Melbourne' })).toMatch(/^One a week at 9:00 am/)
  })
  it('the saves: drafts only, the channels once for all, each post its own time and caption', () => {
    const saves = plannerSaves(
      [{ id: 'a', stage: 'draft' }, { id: 'b', stage: 'quality_check' }, { id: 'c', stage: 'draft' }],
      { channels: ['ig', 'li'], times: ['t1', 't2', 't3'], captions: ['one', 'two', 'three'] },
    )
    expect(saves).toEqual([
      { postId: 'a', channels: ['ig', 'li'], scheduled_for: 't1', caption: 'one' },
      { postId: 'c', channels: ['ig', 'li'], scheduled_for: 't3', caption: 'three' },
    ])
    // nothing chosen leaves each post's own
    expect(plannerSaves([{ id: 'a', stage: 'draft' }], { channels: [], times: null, captions: [] })).toEqual([{ postId: 'a' }])
  })
})

describe('Post approval draws a batch together (groupBatches)', () => {
  it('"WALK TEST · 8 posts" where the first stood, in batch order; a lone post of a batch is an ordinary card', () => {
    const b = (i: number, total = 3) => ({ key: 'K', item_id: ITEM, round: 1, index: i, total, title: `WALK TEST · ${i} of ${total}` })
    const list = [{ id: 'x', batch: null }, { id: 'p3', batch: b(3) }, { id: 'y', batch: null }, { id: 'p1', batch: b(1) }, { id: 'p2', batch: b(2) }]
    const g = groupBatches(list, t => t.batch)
    expect(g.map(x => x.kind)).toEqual(['post', 'batch', 'post'])
    const batch = g[1] as Extract<typeof g[number], { kind: 'batch' }>
    expect(batch.title).toBe('WALK TEST · 3 posts')
    expect(batch.items.map(t => t.id)).toEqual(['p1', 'p2', 'p3'])
    expect(groupBatches([{ id: 'p1', batch: b(1) }], t => t.batch)[0].kind).toBe('post')
  })
  it('the notice after a hand-over', () => {
    expect(handoverNotice('Test Scheduler', 8)).toBe('Handed to Test Scheduler — 8 draft posts on Post approval')
    expect(handoverNotice('Kim', 1)).toBe('Handed to Kim — 1 draft post on Post approval')
  })
})

describe('who the automatic hand-over goes to (autoHandoverTargets)', () => {
  const base = { to: 'approved_for_scheduling', workCard: true, selfPosts: false, adhoc: false, callerHandsOver: false, clientSchedulers: ['cath'] }
  it('only when the client has a scheduler set, only for approved work, never past the caller', () => {
    expect(autoHandoverTargets(base)).toEqual(['cath'])
    expect(autoHandoverTargets({ ...base, clientSchedulers: [] })).toEqual([])
    expect(autoHandoverTargets({ ...base, to: 'client_review' })).toEqual([])
    expect(autoHandoverTargets({ ...base, selfPosts: true })).toEqual([])
    expect(autoHandoverTargets({ ...base, adhoc: true })).toEqual([])
    expect(autoHandoverTargets({ ...base, callerHandsOver: true })).toEqual([])
    expect(autoHandoverTargets({ ...base, workCard: false })).toEqual([])
  })
  it('the people picked with the approval, else the ones on the card, else the client’s', () => {
    expect(autoHandoverTargets({ ...base, picked: ['kim'], onCard: ['zed'] })).toEqual(['kim'])
    expect(autoHandoverTargets({ ...base, onCard: ['zed'] })).toEqual(['zed'])
  })
})

/* ── the real routes ────────────────────────────────────────────────────── */

describe('approved with a scheduler set: the batch is made and handed over by itself', () => {
  it('8 approved clips → 8 drafts for the scheduler, the card in their Draft, ONE notice', async () => {
    fake = seed()
    const r = await move('approved_for_scheduling')
    await drain()
    expect(r.status).toBe(200)
    const made = posts()
    expect(made).toHaveLength(8)
    expect(made.map(p => p.batch.title)).toEqual(Array.from({ length: 8 }, (_, i) => `WALK TEST · ${i + 1} of 8`))
    expect(made.every(p => p.stage === 'draft' && p.assigned_to === CATH.id && p.created_by === CATH.id && p.client_id === 'c1')).toBe(true)
    expect(made.map(p => p.slides[0].url)).toEqual(EIGHT.map(f => f.url))
    // the card: the scheduler's Draft, handed to them — never "In Progress" for the editor
    expect(card().status).toBe('draft_uploaded')
    expect(card().scheduler_ids).toEqual([CATH.id])
    // told ONCE for the batch — not eight times, and never "needs a posting date"
    const toCath = mailsTo(CATH)
    expect(toCath).toHaveLength(1)
    expect(toCath[0].subject).toBe('WALK TEST is yours to work on')
    expect(toCath[0].bodyHtml).toContain('8 draft posts are waiting for you on Post approval')
    expect(h.emails.some(e => /posting date/.test(e.subject))).toBe(false)
    expect(mailsTo(KIM)).toHaveLength(0)
    const acts = fake.rows('workflow_activity').map(a => String((a as { detail?: unknown }).detail ?? ''))
    expect(acts.some(d => /handed automatically .* 8 draft posts/.test(d))).toBe(true)
  })

  it('only once: two approvals pressed together make one batch, one move, one notice', async () => {
    fake = seed()
    const [a, b] = await Promise.all([move('approved_for_scheduling'), move('approved_for_scheduling')])
    await drain()
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(posts()).toHaveLength(8)
    expect(mailsTo(CATH)).toHaveLength(1)
  })

  it('with nobody set under "Who schedules for this client", nothing changes: the card waits for Hand to…', async () => {
    fake = seed({ client: { default_scheduler_ids: [] } })
    const r = await move('approved_for_scheduling')
    await drain()
    expect(r.status).toBe(200)
    expect(fake.rows('social_posts')).toHaveLength(0)
    expect(card().status).toBe('approved_for_scheduling')
    expect(mailsTo(CATH)).toHaveLength(0)
    // …and the manual Hand to… makes the same batch
    const handed = await hand([KIM.id])
    await drain()
    expect(handed.status).toBe(200)
    expect(handed.json.posts).toBe(8)
    expect(handed.json.handed_to).toBe('Kim')
    expect(posts()).toHaveLength(8)
    expect(posts().every(p => p.assigned_to === KIM.id)).toBe(true)
    expect(card().status).toBe('draft_uploaded')
    expect(mailsTo(KIM)).toHaveLength(1)
  })

  it('a client who posts their own content is never handed a batch', async () => {
    fake = seed({ client: { posts_own_content: true } })
    await move('approved_for_scheduling')
    await drain()
    expect(fake.rows('social_posts')).toHaveLength(0)
    expect(card().status).toBe('approved_for_scheduling')
  })
})

describe('the manual hand-over makes the batch, and never twice', () => {
  it('a retried hand-over (the card still approved) finds the drafts it made — no duplicates', async () => {
    fake = seed({ client: { default_scheduler_ids: [] }, item: { status: 'approved_for_scheduling' } })
    expect((await hand([CATH.id])).json.posts).toBe(8)
    // the card back at approved, as a hand-over that failed after making its posts would leave it
    fake.tree().mdm.tables.content_items[ITEM].status = 'approved_for_scheduling'
    const again = await hand([CATH.id])
    expect(again.status).toBe(200)
    expect(again.json.posts).toBe(8)
    expect(fake.rows('social_posts')).toHaveLength(8)
    // and the server half on its own, called again: still eight
    fake.tree().mdm.tables.content_items[ITEM].status = 'approved_for_scheduling'
    const r = await createBatchForCard(card() as never, { scheduler: CATH.id })
    expect(r).toMatchObject({ ok: true, made: 0, total: 8 })
    expect(fake.rows('social_posts')).toHaveLength(8)
  })

  it('a carousel card is ONE draft with all its pictures in order', async () => {
    fake = seed({ client: { default_scheduler_ids: [] }, item: { status: 'approved_for_scheduling', content_type: 'carousel', final_files: PICS } })
    const r = await hand([CATH.id])
    expect(r.json.posts).toBe(1)
    const [p] = posts()
    expect(p.slides.map((s: { url: string }) => s.url)).toEqual(PICS.map(f => f.url))
    expect(p.batch.title).toBe('WALK TEST')
  })

  it('"approve and hand" goes to the person picked — never also to the client’s default scheduler', async () => {
    fake = seed({ item: { status: 'client_review', client_round: 1, client_rounds: [1] } })
    const r = await hand([KIM.id], true)
    await drain()
    expect(r.status).toBe(200)
    expect(posts()).toHaveLength(8)
    expect(posts().every(p => p.assigned_to === KIM.id)).toBe(true)
    expect(card().scheduler_ids).toEqual([KIM.id])
    expect(mailsTo(KIM)).toHaveLength(1)
    expect(mailsTo(CATH)).toHaveLength(0)
  })
})

describe('approve once: the client is not asked about the same files twice unless they sign off every post', () => {
  const atCheck = (row: Record<string, unknown>) => readPostState({ ...row, stage: 'quality_check', sent_version: 1, draft_version: 2 })!
  const qr = { id: JOY.id, hats: ['qr'] as const }
  const now = '2026-10-01T00:00:00.000Z'

  it('switch off: the quality checker passes it straight to Ready to post', async () => {
    fake = seed({ client: { client_approval_required: false } })
    await move('approved_for_scheduling')
    await drain()
    const p = posts()[0]
    expect(p.approval_steps).toBe('team')
    const check = checkPostTransition(atCheck(p), 'pass', qr as never, { version: 1 }, { now, client: { client_approval_required: false } })
    expect(check.ok).toBe(true)
  })

  it('switch on: the post goes to the client after the check, as every post of theirs does', async () => {
    fake = seed({ client: { client_approval_required: true } })
    await move('approved_for_scheduling')
    await drain()
    const p = posts()[0]
    expect(p.approval_steps).toBe('team_then_client')
    const check = checkPostTransition(atCheck(p), 'pass', qr as never, { version: 1 }, { now, client: { client_approval_required: true } })
    expect(check.ok).toBe(false)
    expect((check as { code: string }).code).toBe('steps')
  })

  it('the quality check says what it checks — caption, channels and time', async () => {
    fake = seed()
    await move('approved_for_scheduling')
    await drain()
    const state = atCheck(posts()[0])
    expect(windowHeader(state, now).checkLine).toBe(BATCH_CHECK_LINE)
    expect(BATCH_CHECK_LINE).toMatch(/caption, the channels and the time/)
    // a post that is not one of a card's batch says nothing extra
    expect(windowHeader(readPostState({ ...posts()[0], batch: null, stage: 'quality_check', sent_version: 1 })!, now).checkLine).toBeNull()
  })
})
