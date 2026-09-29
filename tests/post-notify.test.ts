import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { planPostTransition, readPostState, type PostState, type StagePatch } from '@/app/lib/post-stage-core'

/**
 * EVERY POSTING EMAIL, THE SERVER HALF (P7), on the in-memory database with
 * the mailer's `notify` recorded, never sent. Nothing here reaches a real
 * address, a real account or the live database.
 */

const h = vi.hoisted(() => ({
  emails: [] as Record<string, unknown>[],
  result: 'sent' as string,
}))
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(async (m: Record<string, unknown>) => { h.emails.push(m); return h.result }),
  renderEmail: (title: string, body: string, cta?: string, url?: string) => `<h2>${title}</h2>${body}<a href="${url}">${cta}</a>`,
  escapeHtml: (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
}))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))

const { notifyPostMove, sendClientRound, sendApprovalReminders, CLIENT_EMAIL_SENDER_ID } = await import('../app/lib/post-notify')
const { notifyManagersBooked } = await import('../app/lib/booked-notify')

const NOW = new Date('2026-09-29T00:00:00.000Z')
const LATER = '2026-10-02T08:00:00.000Z'
const DIVINA = CLIENT_EMAIL_SENDER_ID()

const team = [
  { id: 'joy', role: 'account_manager', quality_reviewer: true, email: 'joy@x.invalid', name: 'Joy' },
  { id: 'manal', role: 'account_manager', quality_reviewer: false, email: 'manal@x.invalid', name: 'Manal' },
  { id: 'cath', role: 'scheduler', quality_reviewer: false, email: 'cath@x.invalid', name: 'Cath' },
  { id: DIVINA, role: 'super_admin', quality_reviewer: false, email: 'divina@x.invalid', name: 'Divina Armuela' },
].map(u => ({ ...u, active_status: true }))

const basePost = {
  id: 'p1', client_id: 'c1', item_id: 'item-1', source_item_id: 'item-1', created_by: 'cath', rev: 4, stage_at: NOW.toISOString(),
  channels: ['acc-ig'], slides: [{ url: 'https://r2/a.jpg', name: 'a.jpg', type: 'image' }],
  caption: 'WORKING COPY — changed after the send', timezone: 'Australia/Melbourne', scheduled_for: LATER, per_channel: {},
}

let fake: ReturnType<typeof seedDb>
const seed = (posts: Record<string, unknown>[], extra: Record<string, Row[]> = {}) => {
  fake = seedDb({
    clients: [{ id: 'c1', name: 'TKBG', email: 'hello@tkbg.invalid', share_token: 'tok123', timezone: 'Australia/Melbourne', default_scheduler_ids: ['cath'] }] as unknown as Row[],
    client_contacts: [{ id: 'cc1', client_id: 'c1', name: 'Jordan Wilson', email: 'jordan@tkbg.invalid', role: 'Owner', is_primary: true }] as unknown as Row[],
    team_users: team as unknown as Row[],
    team_user_clients: ['joy', 'manal', 'cath'].map(id => ({ id: `${id}__c1`, team_user_id: id, client_id: 'c1' })) as unknown as Row[],
    content_items: [{ id: 'item-1', client_id: 'c1', title: 'Spring menu', status: 'approved_for_scheduling' }] as unknown as Row[],
    social_accounts: [{ id: 'acc-ig', client_id: 'c1', platform: 'instagram', active: true }] as unknown as Row[],
    social_posts: posts as unknown as Row[],
    post_versions: [],
    post_events: [],
    notification_log: [],
    ...extra,
  })
}
beforeEach(() => { h.emails = []; h.result = 'sent' })
afterEach(() => fake?.restore())

const state = (row: Record<string, unknown>) => readPostState(row)!
const land = (post: PostState, patch: StagePatch) => ({ ...post, ...patch } as PostState)

describe('notifyPostMove — after the write landed', () => {
  it('booking_done: the managers hear "Booked in", naming who pressed Book, and the booker is not told their own news', async () => {
    const row = { ...basePost, stage: 'booked', sent_version: 1, draft_version: 2, booking: { job_ids: [], pending: true, at: NOW.toISOString(), for_time: LATER } }
    seed([row], { post_events: [{ id: 'p1_r4', post_id: 'p1', client_id: 'c1', rev: 4, from: 'ready', to: 'booked', action: 'book', actor_id: 'manal', at: NOW.toISOString() }] as unknown as Row[] })
    const post = state(row)
    const plan = planPostTransition(post, 'booking_done', { id: null, hats: ['system'] }, { job_ids: ['job-9'] }, { now: NOW })
    if (!plan.ok) throw new Error(plan.reason)
    const report = await notifyPostMove({ plan, post: land(post, plan.patch), actor: null, now: NOW })
    expect(report.told.map(t => t.id)).toEqual(['joy'])
    expect(h.emails).toHaveLength(1)
    expect(h.emails[0]).toMatchObject({
      eventType: 'post_booking_done', entityType: 'social_post', entityId: 'p1#r5', recipientEmail: 'joy@x.invalid', actorName: 'Manal',
    })
    expect(String(h.emails[0].subject)).toMatch(/^Booked in: Spring menu — /)
    expect(String(h.emails[0].bodyHtml)).toContain('on Instagram')
    expect(String(h.emails[0].bodyHtml)).toContain('/dashboard/social/schedule?client=c1&amp;post=p1'.replace('&amp;', '&'))
  })

  it('the same plan against a post whose booking failed sends nothing, and says why (audit V14)', async () => {
    const row = { ...basePost, stage: 'booked', sent_version: 1, draft_version: 2, booking: { job_ids: [], pending: true, at: NOW.toISOString(), for_time: LATER } }
    seed([row])
    const post = state(row)
    const plan = planPostTransition(post, 'booking_done', { id: null, hats: ['system'] }, { job_ids: ['job-9'] }, { now: NOW })
    if (!plan.ok) throw new Error(plan.reason)
    const failed = { ...land(post, plan.patch), stage: 'ready' as const, booking: null, problem: 'Instagram refused it.' }
    const report = await notifyPostMove({ plan, post: failed, actor: null, now: NOW })
    expect(h.emails).toHaveLength(0)
    expect(report.skipped).toMatch(/Ready to post, not Booked in/)
  })

  it('a Book press sends nothing at all — the email waits for booking_done', async () => {
    const row = { ...basePost, stage: 'ready', sent_version: 1, draft_version: 2, approval: { version: 1, by: 'joy', hat: 'quality_reviewer', at: NOW.toISOString() } }
    seed([row])
    const post = state(row)
    const plan = planPostTransition(post, 'book', { id: 'cath', hats: ['scheduler'] }, {}, { now: NOW, accounts: [{ id: 'acc-ig', platform: 'instagram', live: true }] })
    if (!plan.ok) throw new Error(plan.reason)
    await notifyPostMove({ plan, post: land(post, plan.patch), actor: { id: 'cath', name: 'Cath', email: 'cath@x.invalid' }, now: NOW })
    expect(h.emails).toHaveLength(0)
  })

  it('Send for quality check reaches the quality checker only', async () => {
    const row = { ...basePost, stage: 'draft', sent_version: null, draft_version: 1 }
    seed([row])
    const post = state(row)
    const plan = planPostTransition(post, 'send_to_qc', { id: 'cath', hats: ['creator', 'scheduler'] }, {}, { now: NOW, accounts: [{ id: 'acc-ig', platform: 'instagram', live: true }] })
    if (!plan.ok) throw new Error(plan.reason)
    await notifyPostMove({ plan, post: land(post, plan.patch), actor: { id: 'cath', name: 'Cath', email: 'cath@x.invalid' }, now: NOW })
    expect(h.emails.map(e => e.recipientEmail)).toEqual(['joy@x.invalid'])
    expect(h.emails[0]).toMatchObject({ subject: 'Quality check: Spring menu', actorName: 'Cath' })
    expect(h.emails.some(e => e.toClient === true)).toBe(false)
  })
})

describe('sendClientRound — one email per person, from Divina, of the frozen version', () => {
  const frozen = (id: string, n: number, caption: string) => ({
    id: `${id}_v${n}`, post_id: id, client_id: 'c1', n, slides: [], per_channel: {}, channels: ['acc-ig'],
    caption, scheduled_for: LATER, timezone: 'Australia/Melbourne', frozen_for: 'quality_check', frozen_by: 'cath', frozen_at: NOW.toISOString(),
  })
  const two = () => seed([
    { ...basePost, stage: 'quality_check', sent_version: 1, draft_version: 2 },
    { ...basePost, id: 'p2', stage: 'ready', sent_version: 3, draft_version: 4 },
  ], { post_versions: [frozen('p1', 1, 'FROZEN caption one'), frozen('p2', 3, 'FROZEN caption two')] as unknown as Row[] })

  it('two posts to two people: two emails, each listing both posts, marked as a deliberate client send', async () => {
    two()
    const r = await sendClientRound({
      clientId: 'c1', posts: [{ post_id: 'p1', version: 1 }, { post_id: 'p2', version: 3 }],
      emails: ['jordan@tkbg.invalid', 'hello@tkbg.invalid'], note: 'Two for this week', pressedBy: { id: 'manal', name: 'Manal', email: 'manal@x.invalid' }, now: NOW,
    })
    expect(r).toMatchObject({ ok: true, delivered: ['jordan@tkbg.invalid', 'hello@tkbg.invalid'] })
    expect(h.emails).toHaveLength(2)
    for (const e of h.emails) {
      expect(e).toMatchObject({ eventType: 'post_round_to_client', toClient: true, deliberateClientSend: true, actorName: 'Divina Armuela', actorEmail: 'divina@x.invalid' })
      expect(e.subject).toBe('2 posts are ready for you to approve')
      const body = String(e.bodyHtml)
      expect(body).toContain('FROZEN caption one')
      expect(body).toContain('FROZEN caption two')
      expect(body).not.toContain('WORKING COPY')
      expect(body).toContain('/portal/tok123/post/p1')
      expect(body).toContain('Two for this week')
    }
    expect(h.emails[0].entityId).toBe(h.emails[1].entityId)
    expect(String(h.emails[0].bodyHtml)).toContain('Hi Jordan')
  })

  it('B1 — decision 15, the one link: a round of several opens on the page listing everything waiting on the client', async () => {
    two()
    const r = await sendClientRound({
      clientId: 'c1', posts: [{ post_id: 'p1', version: 1 }, { post_id: 'p2', version: 3 }],
      emails: ['jordan@tkbg.invalid'], pressedBy: { id: 'manal', name: 'Manal', email: 'manal@x.invalid' }, now: NOW,
    })
    expect(r.ok && r.link).toBe('https://app.mdmmarketing.com.au/portal/tok123/posts')
    expect(String(h.emails[0].bodyHtml)).toContain('<a href="https://app.mdmmarketing.com.au/portal/tok123/posts">See everything waiting on you</a>')
  })

  it('the same round pressed twice has the same outbox key (sent once); "again" makes a new one', async () => {
    two()
    const args = { clientId: 'c1', posts: [{ post_id: 'p1', version: 1 }], emails: ['jordan@tkbg.invalid'], pressedBy: { id: 'manal', email: 'manal@x.invalid' }, now: NOW }
    await sendClientRound(args)
    await sendClientRound(args)
    await sendClientRound({ ...args, again: true })
    expect(h.emails[0].entityId).toBe(h.emails[1].entityId)
    expect(h.emails[2].entityId).not.toBe(h.emails[0].entityId)
  })

  it('a test goes to the presser only, is not a client send, and links to the team page', async () => {
    two()
    const r = await sendClientRound({ clientId: 'c1', posts: [{ post_id: 'p1', version: 1 }], emails: ['jordan@tkbg.invalid'], pressedBy: { id: 'manal', email: 'manal@x.invalid' }, test: true, now: NOW })
    expect(r).toMatchObject({ ok: true, delivered: ['manal@x.invalid'] })
    expect(h.emails[0]).toMatchObject({ recipientEmail: 'manal@x.invalid', toClient: false, deliberateClientSend: false, eventType: 'post_round_test' })
    expect(String(h.emails[0].bodyHtml)).not.toContain('/portal/')
    expect(String(h.emails[0].subject)).toMatch(/^\[Test — what TKBG gets\]/)
  })

  it('nothing delivered is reported as nothing delivered, so the caller changes nothing (audit P9)', async () => {
    two()
    h.result = 'failed'
    const r = await sendClientRound({ clientId: 'c1', posts: [{ post_id: 'p1', version: 1 }], emails: ['jordan@tkbg.invalid'], pressedBy: { id: 'manal', email: 'manal@x.invalid' }, now: NOW })
    expect(r).toMatchObject({ ok: true, delivered: [] })
    expect(r.ok && r.message).toMatch(/Nothing was sent/)
  })

  it('refuses an address not on the client, a post of another client, a post in Draft, and a version never frozen', async () => {
    two()
    const by = { id: 'manal', email: 'manal@x.invalid' }
    expect(await sendClientRound({ clientId: 'c1', posts: [{ post_id: 'p1', version: 1 }], emails: ['stranger@evil.invalid'], pressedBy: by }))
      .toMatchObject({ ok: false, status: 400 })
    expect(await sendClientRound({ clientId: 'c1', posts: [{ post_id: 'p1', version: 2 }], emails: ['jordan@tkbg.invalid'], pressedBy: by }))
      .toMatchObject({ ok: false, status: 409, error: expect.stringContaining('no frozen version 2') })
    fake.restore()
    seed([{ ...basePost, stage: 'draft', sent_version: 1, draft_version: 2 }, { ...basePost, id: 'px', client_id: 'c2', stage: 'ready', sent_version: 1 }],
      { post_versions: [frozen('p1', 1, 'x')] as unknown as Row[] })
    expect(await sendClientRound({ clientId: 'c1', posts: [{ post_id: 'p1', version: 1 }], emails: ['jordan@tkbg.invalid'], pressedBy: by }))
      .toMatchObject({ ok: false, status: 409, error: expect.stringContaining('not ready to send') })
    expect(await sendClientRound({ clientId: 'c1', posts: [{ post_id: 'px', version: 1 }], emails: ['jordan@tkbg.invalid'], pressedBy: by }))
      .toMatchObject({ ok: false, status: 404 })
    expect(h.emails).toHaveLength(0)
  })
})

describe('sendApprovalReminders — to the managers, once per version and time, never the client', () => {
  it('sends the 1-hour reminder to the client\'s managers with a stable key', async () => {
    const BY = '2026-10-02T06:00:00.000Z'
    seed([
      { ...basePost, stage: 'with_client', sent_version: 1, draft_version: 2, client_send: { version: 1, at: NOW.toISOString(), to: ['jordan@tkbg.invalid'], via: 'email', approve_by: BY, for_time: LATER } },
      { ...basePost, id: 'p2', stage: 'ready', sent_version: 1, draft_version: 2 },
    ])
    const at = new Date('2026-10-02T05:30:00.000Z')
    const r = await sendApprovalReminders(at)
    expect(r).toEqual({ checked: 1, sent: 2 })
    expect(h.emails.map(e => e.recipientEmail)).toEqual(['joy@x.invalid', 'manal@x.invalid'])
    expect(h.emails[0]).toMatchObject({ eventType: 'post_approve_reminder_1h', entityId: `p1#v1#${BY}` })
    expect(h.emails.some(e => e.toClient === true || String(e.recipientEmail).includes('tkbg'))).toBe(false)
    await sendApprovalReminders(at)
    expect(h.emails[2].entityId).toBe(h.emails[0].entityId)
  })
})

describe('the older booked email refuses to report a booking it cannot see (booked-notify.ts)', () => {
  const actor = { id: 'cath', name: 'Cath', email: 'cath@x.invalid', role: 'scheduler', clerk_user_id: null } as never
  const item = { id: 'item-1', title: 'Spring menu', client_id: 'c1' }
  it('called before the job exists (as schedulePost did): no email', async () => {
    seed([{ ...basePost, status: 'scheduled', publish_job_ids: [] }])
    await notifyManagersBooked(actor, item, { id: 'p1', scheduled_for: LATER }, ['instagram'])
    expect(h.emails).toHaveLength(0)
  })
  it('with a job on the row: the managers hear', async () => {
    seed([{ ...basePost, status: 'scheduled', publish_job_ids: ['job-1'] }])
    await notifyManagersBooked(actor, item, { id: 'p1', scheduled_for: LATER }, ['instagram'])
    expect(h.emails.map(e => e.recipientEmail).sort()).toEqual(['joy@x.invalid', 'manal@x.invalid'])
  })
  it('without a post id there is nothing to prove: no email', async () => {
    seed([])
    await notifyManagersBooked(actor, item, { scheduled_for: LATER }, ['instagram'])
    expect(h.emails).toHaveLength(0)
  })
})

describe('the seams P1\'s engine calls', () => {
  it('a failed booking is told to the person who pressed Book first — they think it is booked', async () => {
    const row = { ...basePost, stage: 'booked', sent_version: 1, draft_version: 2, booking: { job_ids: [], pending: true, at: NOW.toISOString(), for_time: LATER } }
    seed([row], { post_events: [{ id: 'p1_r4', post_id: 'p1', client_id: 'c1', rev: 4, from: 'ready', to: 'booked', action: 'book', actor_id: 'manal', at: NOW.toISOString() }] as unknown as Row[] })
    const post = state(row)
    const plan = planPostTransition(post, 'booking_failed', { id: null, hats: ['system'] }, { problem: 'Instagram refused the video.' }, { now: NOW })
    if (!plan.ok) throw new Error(plan.reason)
    await notifyPostMove({ plan, post: land(post, plan.patch), actor: null, now: NOW })
    expect(h.emails.map(e => e.recipientEmail)).toEqual(['manal@x.invalid', 'cath@x.invalid'])
    expect(h.emails[0]).toMatchObject({ subject: 'Not booked: Spring menu', actorName: 'MD Media' })
  })

  it('sendPostNotice turns one engine notice into the same emails, and fills in the actor\'s address', async () => {
    const row = { ...basePost, stage: 'draft', sent_version: null, draft_version: 1 }
    seed([row])
    const post = state(row)
    const plan = planPostTransition(post, 'send_to_qc', { id: 'cath', hats: ['creator', 'scheduler'] }, {}, { now: NOW, accounts: [{ id: 'acc-ig', platform: 'instagram', live: true }] })
    if (!plan.ok) throw new Error(plan.reason)
    const { sendPostNotice } = await import('../app/lib/post-notify')
    await sendPostNotice({ to: 'quality_checkers', action: 'send_to_qc', person_id: null, post: land(post, plan.patch), actor: { id: 'cath', name: 'Cath' }, event: plan.event })
    expect(h.emails).toHaveLength(1)
    expect(h.emails[0]).toMatchObject({ recipientEmail: 'joy@x.invalid', actorName: 'Cath', actorEmail: 'cath@x.invalid', entityId: 'p1#r5' })
  })

  it('one post sent from the engine is a round of one: from Divina, of the frozen version, only the client list; a link emails nobody', async () => {
    const seedQc = () => seed([{ ...basePost, stage: 'quality_check', sent_version: 1, draft_version: 1 }], {
      post_versions: [{ id: 'p1_v1', post_id: 'p1', client_id: 'c1', n: 1, slides: [], per_channel: {}, channels: ['acc-ig'], caption: 'FROZEN words', scheduled_for: LATER, timezone: 'Australia/Melbourne', frozen_for: 'quality_check', frozen_at: NOW.toISOString() }] as unknown as Row[],
    })
    const engine = await import('../app/lib/post-stage')
    // the engine's own client send (deps.deliverToClient left as it ships); the team notices are not what this pins
    const undo = engine.usePostEngineDeps({ now: () => NOW, notify: async () => {}, announce: () => {} })
    try {
      const joy = { ...team[0], clerk_user_id: null } as never
      const press = (input: Record<string, unknown>) =>
        engine.performPostTransition('p1', 'pass_send_client', engine.teamActorFor(joy, { created_by: 'cath' }), { expect_rev: 4, version: 1, ...input })

      seedQc()
      const link = await press({ via: 'link' })
      expect(link).toMatchObject({ ok: true, link: 'https://app.mdmmarketing.com.au/portal/tok123/post/p1' })
      expect(h.emails).toHaveLength(0)

      fake.restore(); seedQc()
      const sent = await press({ send_to: ['jordan@tkbg.invalid'] })
      expect(sent.ok, sent.ok ? '' : sent.reason).toBe(true)
      expect(h.emails).toHaveLength(1)
      expect(h.emails[0]).toMatchObject({
        eventType: 'post_round_to_client', recipientEmail: 'jordan@tkbg.invalid', toClient: true, deliberateClientSend: true,
        actorName: 'Divina Armuela', actorEmail: 'divina@x.invalid',
      })
      expect(String(h.emails[0].bodyHtml)).toContain('FROZEN words')
      expect(String(h.emails[0].bodyHtml)).not.toContain('WORKING COPY')

      fake.restore(); seedQc(); h.emails = []
      const refused = await press({ send_to: ['stranger@evil.invalid'] })
      expect(refused).toMatchObject({ ok: false, code: 'contact' })
      expect(h.emails).toHaveLength(0)
    } finally {
      undo()
    }
  })
})

describe('Schedule it (a super admin, without the quality check, 29 Sep 2026)', () => {
  const approval = { version: 1, by: DIVINA, hat: 'super_admin', on_behalf_of_client: false, skipped_check: true, at: NOW.toISOString() }

  it('the press sends nothing — the email waits for the booking', async () => {
    const row = { ...basePost, stage: 'draft', sent_version: null, draft_version: 1 }
    seed([row])
    const post = state(row)
    const plan = planPostTransition(post, 'schedule_direct', { id: DIVINA, hats: ['sa'] }, {}, { now: NOW, accounts: [{ id: 'acc-ig', platform: 'instagram', live: true }] })
    if (!plan.ok) throw new Error(plan.reason)
    const report = await notifyPostMove({ plan, post: land(post, plan.patch), actor: { id: DIVINA, name: 'Divina Armuela', email: 'divina@x.invalid' }, now: NOW })
    expect(h.emails).toHaveLength(0)
    expect(report.told).toEqual([])
  })

  it('once booked: the maker is told, with the line that says the check was skipped; the super admin is not told their own news', async () => {
    const row = { ...basePost, stage: 'booked', sent_version: 1, draft_version: 2, approval, booking: { job_ids: [], pending: true, at: NOW.toISOString(), for_time: LATER } }
    seed([row], { post_events: [{ id: 'p1_r1', post_id: 'p1', client_id: 'c1', rev: 1, from: 'draft', to: 'booked', action: 'schedule_direct', actor_id: DIVINA, at: NOW.toISOString() }] as unknown as Row[] })
    const post = state(row)
    const plan = planPostTransition(post, 'booking_done', { id: null, hats: ['system'] }, { job_ids: ['job-9'] }, { now: NOW })
    if (!plan.ok) throw new Error(plan.reason)
    const report = await notifyPostMove({ plan, post: land(post, plan.patch), actor: null, now: NOW })
    const told = report.told.map(t => t.id)
    expect(told).toContain('cath')
    expect(told).not.toContain(DIVINA)
    const toCath = h.emails.find(e => e.recipientId === 'cath')!
    expect(toCath).toMatchObject({ eventType: 'post_booking_done', actorName: 'Divina Armuela' })
    expect(String(toCath.bodyHtml)).toContain('Scheduled without the quality check by Divina Armuela')
    expect(String(toCath.bodyHtml)).not.toContain('Passed quality check')
  })

  it('a super admin who made the post themselves is not emailed about it', async () => {
    const row = { ...basePost, created_by: DIVINA, stage: 'booked', sent_version: 1, draft_version: 2, approval, booking: { job_ids: [], pending: true, at: NOW.toISOString(), for_time: LATER } }
    seed([row], { post_events: [{ id: 'p1_r1', post_id: 'p1', client_id: 'c1', rev: 1, from: 'draft', to: 'booked', action: 'schedule_direct', actor_id: DIVINA, at: NOW.toISOString() }] as unknown as Row[] })
    const post = state(row)
    const plan = planPostTransition(post, 'booking_done', { id: null, hats: ['system'] }, { job_ids: ['job-9'] }, { now: NOW })
    if (!plan.ok) throw new Error(plan.reason)
    const report = await notifyPostMove({ plan, post: land(post, plan.patch), actor: null, now: NOW })
    expect(report.told.map(t => t.id)).not.toContain(DIVINA)
  })
})
