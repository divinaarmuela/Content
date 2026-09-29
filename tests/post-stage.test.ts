import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import type { TeamUser } from '@/app/lib/authz'
import type { NetworkOutcome } from '@/app/lib/post-stage-core'

/**
 * THE ONE WRITER OF A POST'S STAGE, on the real `@/lib/db` over an in-memory Realtime Database that is
 * honest about conditional writes (tests/helpers/fake-rtdb.ts). SPEC §8.2, and the audit's lessons:
 * every move is one claim; a stale page is refused with the fresh post; the booking email never goes
 * before the booking; a cancel touches only its own post; what was sent is frozen and never rewritten.
 *
 * The provider, the mailer and the notices are the engine's dependencies, swapped here for fakes — no
 * test can reach a channel or an inbox.
 */

const engine = await import('../app/lib/post-stage')
const { performPostTransition, teamActorFor, usePostEngineDeps, cascadeItemDelete, insertDraftPost, saveWorkingCopy, actOnPost } = engine
const { outcomeAction } = await import('../app/lib/post-stage-core')

/* ── the cast ───────────────────────────────────────────────────────────── */

const CLIENT = 'c1'
const ITEM = 'item-1'
const person = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
  id, role, email: `${id}@x.invalid`, name: id.replace('u-', '').toUpperCase(), clerk_user_id: null,
  employment_type: 'employee', timezone: 'Australia/Melbourne', client_id: null, active_status: true, ...extra,
}) as unknown as TeamUser
const SCHED = person('u-sch', 'scheduler')
const SCHED2 = person('u-sch2', 'scheduler')
const AM = person('u-am', 'account_manager')
const QR = person('u-qr', 'quality_checker')
const SA = person('u-sa', 'super_admin')
const EDITOR = person('u-ed', 'editor')

const SLIDES = [
  { url: 'https://media.mdmmarketing.com.au/one.jpg', name: 'one.jpg', type: 'image' },
  { url: 'https://media.mdmmarketing.com.au/two.jpg', name: 'two.jpg', type: 'image' },
]
const IN = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString()

let fake: ReturnType<typeof seedDb>
let undo: () => void
let jobSeq = 0

const deps = {
  queuePublish: vi.fn(async (_input: unknown): Promise<{ id: string } | { error: string }> => ({ id: `job-${++jobSeq}` })),
  cancelJob: vi.fn(async (_id: string): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true })),
  deliverToClient: vi.fn(async (input: { emails: string[]; post: { id: string } }) => ({
    delivered: input.emails, failed: [] as string[], link: `https://app.test/portal/tok-1/post/${input.post.id}`,
  })),
  notify: vi.fn(async () => {}),
  announce: vi.fn(),
  mayActOnClient: vi.fn(async () => true),
}

function seed(extra: Partial<Record<string, Row[]>> = {}) {
  return seedDb({
    clients: [{ id: CLIENT, name: 'Acme', timezone: 'Australia/Melbourne', share_token: 'tok-1', email: 'owner@acme.invalid', client_approval_required: false }] as unknown as Row[],
    client_contacts: [{ id: 'cc1', client_id: CLIENT, name: 'Jordan', email: 'jordan@acme.invalid', is_primary: true }] as unknown as Row[],
    social_accounts: [
      { id: 'acc-ig', client_id: CLIENT, platform: 'instagram', provider_account_id: 'p-ig', name: 'Acme IG', active: true },
      { id: 'acc-li', client_id: CLIENT, platform: 'linkedin', provider_account_id: 'p-li', name: 'Acme LinkedIn', active: true },
    ] as unknown as Row[],
    content_items: [{ id: ITEM, client_id: CLIENT, title: 'Launch', status: 'approved_for_scheduling' }] as unknown as Row[],
    team_users: [SCHED, SCHED2, AM, QR, SA, EDITOR] as unknown as Row[],
    social_posts: [],
    post_versions: [],
    post_events: [],
    publish_jobs: [],
    claim_locks: [],
    ...extra,
  } as never)
}

async function newDraft(over: Record<string, unknown> = {}): Promise<string> {
  const row = await insertDraftPost({
    client_id: CLIENT, item_id: ITEM, created_by: SCHED.id, slides: SLIDES as never, caption: 'Hello everyone',
    channels: ['acc-ig'], per_channel: {}, scheduled_for: IN(48), timezone: 'Australia/Melbourne',
    ...over,
  } as never)
  return row.id
}

const rowOf = (id: string) => fake.rows('social_posts').find(p => p.id === id) as Record<string, any> | undefined
const stateOf = async (id: string) => (await engine.loadPostState(id)).post!

/**
 * What the publish recorder (production-publish.ts) does with a job's answer: the rules' verdict on the
 * outcomes, moved through the system transition — nothing while a network is still waiting.
 */
async function record(id: string, outcomes: Record<string, NetworkOutcome>, platforms: string[]) {
  const act = outcomeAction({ ...(await stateOf(id)).outcomes, ...outcomes }, platforms)
  if (!act) return { ok: true as const, pending: true as const }
  return engine.performSystemTransition(id, act, { outcomes, platforms })
}
/** A resend's jobs joining the booking, as the recorder links them. */
const linkJobs = (id: string, jobIds: string[]) => engine.performSystemTransition(id, 'link_jobs', { job_ids: jobIds })

async function as(who: TeamUser, postId: string) {
  const post = await stateOf(postId)
  return teamActorFor(who, post)
}

/** Draft → quality check → passed → Ready to post. */
async function toReady(id: string) {
  let p = await stateOf(id)
  const sent = await performPostTransition(id, 'send_to_qc', await as(SCHED, id), { expect_rev: p.rev })
  expect(sent.ok, sent.ok ? '' : sent.reason).toBe(true)
  p = await stateOf(id)
  const passed = await performPostTransition(id, 'pass', await as(QR, id), { expect_rev: p.rev, version: p.sent_version })
  expect(passed.ok, passed.ok ? '' : passed.reason).toBe(true)
  return stateOf(id)
}

/** Draft → quality check → "Passed — send to client" → With client. */
async function toClient(id: string) {
  let p = await stateOf(id)
  await performPostTransition(id, 'send_to_qc', await as(SCHED, id), { expect_rev: p.rev })
  p = await stateOf(id)
  const r = await performPostTransition(id, 'pass_send_client', await as(QR, id), {
    expect_rev: p.rev, version: p.sent_version, send_to: ['jordan@acme.invalid'],
  })
  expect(r.ok, r.ok ? '' : r.reason).toBe(true)
  return stateOf(id)
}

async function toBooked(id: string) {
  const p = await toReady(id)
  const r = await performPostTransition(id, 'book', await as(SCHED, id), { expect_rev: p.rev })
  expect(r.ok, r.ok ? '' : r.reason).toBe(true)
  return stateOf(id)
}

beforeEach(() => {
  jobSeq = 0
  fake = seed()
  for (const f of Object.values(deps)) f.mockClear()
  undo = usePostEngineDeps(deps as never)
})
afterEach(() => {
  undo()
  fake.restore()
})

/* ── the journey ────────────────────────────────────────────────────────── */

describe('one post, draft to booked', () => {
  it('freezes version 1 at the send, passes, books, and tells the team only after the booking exists', async () => {
    const id = await newDraft()
    let p = await stateOf(id)
    expect(p.stage).toBe('draft')

    const sent = await performPostTransition(id, 'send_to_qc', await as(SCHED, id), { expect_rev: p.rev })
    expect(sent.ok).toBe(true)
    if (!sent.ok) return
    expect(sent.stage).toBe('quality_check')
    expect(sent.words).toBe('Send for quality check — now in Quality check')
    expect(sent.post.sent_version).toBe(1)
    expect(sent.post.draft_version).toBe(2)
    const v1 = fake.rows('post_versions').find(v => v.id === `${id}_v1`) as Record<string, any>
    expect(v1).toBeTruthy()
    expect(v1.caption).toBe('Hello everyone')
    expect(v1.frozen_for).toBe('quality_check')
    expect(fake.rows('post_events').map(e => e.id)).toContain(`${id}_r1`)
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ to: 'quality_checkers', action: 'send_to_qc' }))

    p = await stateOf(id)
    const passed = await performPostTransition(id, 'pass', await as(QR, id), { expect_rev: p.rev, version: 1 })
    expect(passed.ok && passed.stage).toBe('ready')
    p = await stateOf(id)
    expect(p.qc_pass?.version).toBe(1)
    expect(p.approval).toMatchObject({ version: 1, hat: 'quality_reviewer', on_behalf_of_client: false })

    deps.notify.mockClear()
    const booked = await performPostTransition(id, 'book', await as(SCHED, id), { expect_rev: p.rev })
    expect(booked.ok).toBe(true)
    if (!booked.ok) return
    expect(booked.post.stage).toBe('booked')
    expect(booked.post.booking).toMatchObject({ job_ids: ['job-1'], pending: false })
    // the provider was handed the FROZEN version, at the post's time
    const q = deps.queuePublish.mock.calls[0][0] as { copy: { n: number; caption: string }; forTime: string; now: boolean }
    expect(q.copy.n).toBe(1)
    expect(q.forTime).toBe(p.scheduled_for)
    expect(q.now).toBe(false)
    // the booking email is the booking_done notice — after the job exists
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ to: 'team', action: 'booking_done' }))
  })

  it('an edit after the send works on version 2; version 1 is never rewritten', async () => {
    const id = await newDraft()
    const p = await toReady(id)
    const before = JSON.stringify(fake.rows('post_versions').find(v => v.id === `${id}_v1`))
    const edited = await performPostTransition(id, 'edit', await as(SCHED, id), { expect_rev: p.rev })
    expect(edited.ok && edited.stage).toBe('draft')
    const now = await stateOf(id)
    expect(now.approval).toBeNull()
    expect(now.draft_version).toBe(2)
    const saved = await saveWorkingCopy(id, await as(SCHED, id), { caption: 'New words' }, now.rev)
    expect(saved.ok).toBe(true)
    expect(JSON.stringify(fake.rows('post_versions').find(v => v.id === `${id}_v1`))).toBe(before)
    const resent = await performPostTransition(id, 'send_to_qc', await as(SCHED, id), { expect_rev: (await stateOf(id)).rev })
    expect(resent.ok).toBe(true)
    const v2 = fake.rows('post_versions').find(v => v.id === `${id}_v2`) as Record<string, any>
    expect(v2.caption).toBe('New words')
  })
})

/* ── races and stale pages (audit V4) ───────────────────────────────────── */

describe('one winner', () => {
  it('a stale page is refused, and the answer carries the post as it is now', async () => {
    const id = await newDraft()
    const r = await performPostTransition(id, 'send_to_qc', await as(SCHED, id), { expect_rev: 7 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('stale')
    expect(r.post?.stage).toBe('draft')
    expect(rowOf(id)?.stage).toBe('draft')
    expect(fake.rows('post_versions')).toHaveLength(0)
  })

  it('the manager’s take-back lands between the client’s read and write: the client is refused', async () => {
    const id = await newDraft()
    const p = await toClient(id)
    const am = await as(AM, id)
    let rival: Awaited<ReturnType<typeof performPostTransition>> | null = null
    // the client's claim has read the post; just before its write lands, the manager's whole move runs
    const off = fake.onBeforeWrite(`/mdm/tables/social_posts/${id}`, async () => {
      off()
      rival = await performPostTransition(id, 'take_back', am, { expect_rev: p.rev })
    })
    const client = await engine.clientActOnPost(CLIENT, id, { action: 'client_approve', version: p.sent_version! })
    expect(rival!.ok).toBe(true)
    expect(client.ok).toBe(false)
    if (client.ok) return
    expect(client.code).toBe('wrong_stage')
    expect(client.post?.stage).toBe('draft')
    const final = await stateOf(id)
    expect(final.approval).toBeNull()
    expect(final.rev).toBe(p.rev + 1)
  })

  it('the client approving while a manager takes it back at the same time: exactly one lands', async () => {
    const id = await newDraft()
    const p = await toClient(id)
    const am = await as(AM, id)
    const [a, b] = await Promise.all([
      engine.clientActOnPost(CLIENT, id, { action: 'client_approve', version: p.sent_version! }),
      performPostTransition(id, 'take_back', am, { expect_rev: p.rev }),
    ])
    const wins = [a, b].filter(r => r.ok)
    expect(wins).toHaveLength(1)
    const lost = [a, b].find(r => !r.ok)!
    expect(lost.ok).toBe(false)
    if (lost.ok) return
    expect(['stale', 'wrong_stage']).toContain(lost.code)
    expect(lost.post).not.toBeNull()
    const final = await stateOf(id)
    expect(['ready', 'draft']).toContain(final.stage)
    expect(final.rev).toBe(p.rev + 1)
  })

  it('two people booking the same post: one set of jobs', async () => {
    const id = await newDraft()
    const p = await toReady(id)
    const [sch, am] = [await as(SCHED, id), await as(AM, id)]
    const [a, b] = await Promise.all([
      performPostTransition(id, 'book', sch, { expect_rev: p.rev }),
      performPostTransition(id, 'book', am, { expect_rev: p.rev }),
    ])
    expect([a, b].filter(r => r.ok)).toHaveLength(1)
    expect(deps.queuePublish).toHaveBeenCalledTimes(1)
  })
})

/* ── the booking order (SPEC §3.1, audit V14, V15, W4) ──────────────────── */

describe('booking', () => {
  it('a queue that throws leaves the post Ready to post with the reason, and emails nobody', async () => {
    const id = await newDraft()
    const p = await toReady(id)
    deps.queuePublish.mockImplementationOnce(async () => { throw new Error('network down') })
    deps.notify.mockClear()
    const r = await performPostTransition(id, 'book', await as(SCHED, id), { expect_rev: p.rev })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('jobs')
    expect(r.reason).toContain('network down')
    expect(r.post?.stage).toBe('ready')
    expect(r.post?.booking).toBeNull()
    expect(r.post?.problem).toContain('network down')
    // still approved — it can be booked again
    expect(r.post?.approval?.version).toBe(r.post?.sent_version)
    expect(deps.notify).not.toHaveBeenCalled()
  })

  it('a refusal from the provider is the same: back to Ready to post, reason kept', async () => {
    const id = await newDraft()
    const p = await toReady(id)
    deps.queuePublish.mockImplementationOnce(async () => ({ error: 'Instagram refused the carousel' }))
    const r = await performPostTransition(id, 'book', await as(SCHED, id), { expect_rev: p.rev })
    expect(!r.ok && r.post?.stage).toBe('ready')
    expect(rowOf(id)?.problem).toContain('Instagram refused the carousel')
  })

  it('a post cancelled while its job was being queued does not go out: the new job is pulled back', async () => {
    const id = await newDraft()
    const p = await toReady(id)
    deps.queuePublish.mockImplementationOnce(async () => {
      const mid = await stateOf(id)
      const c = await performPostTransition(id, 'cancel', await as(SCHED2, id), { expect_rev: mid.rev, confirm: true })
      expect(c.ok).toBe(true)
      return { id: 'job-late' }
    })
    const r = await performPostTransition(id, 'book', await as(SCHED, id), { expect_rev: p.rev })
    expect(r.ok).toBe(false)
    expect(deps.cancelJob).toHaveBeenCalledWith('job-late')
    expect((await stateOf(id)).stage).toBe('cancelled')
  })

  it('Post now goes with no time, so the provider publishes it straight away', async () => {
    const id = await newDraft()
    const p = await toReady(id)
    const r = await performPostTransition(id, 'post_now', await as(SCHED, id), { expect_rev: p.rev, confirm: true })
    expect(r.ok).toBe(true)
    const q = deps.queuePublish.mock.calls[0][0] as { forTime: string | null; now: boolean }
    expect(q.forTime).toBeNull()
    expect(q.now).toBe(true)
  })

  it('a new time on a booked post pulls the old job, books the new one, and keeps the approval', async () => {
    const id = await newDraft()
    const p = await toBooked(id)
    const when = IN(72)
    const r = await performPostTransition(id, 'change_time', await as(SCHED, id), { expect_rev: p.rev, scheduled_for: when })
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    if (!r.ok) return
    expect(deps.cancelJob).toHaveBeenCalledWith('job-1')
    expect(r.post.stage).toBe('booked')
    expect(r.post.booking?.job_ids).toEqual(['job-2'])
    expect(r.post.scheduled_for).toBe(when)
    // the re-timed version carries the approval forward
    expect(r.post.sent_version).toBe(2)
    expect(r.post.approval?.version).toBe(2)
    expect((fake.rows('post_versions').find(v => v.id === `${id}_v2`) as any).scheduled_for).toBe(when)
  })

  it('the channel refusing to let go stops a take-off, and the post stays booked', async () => {
    const id = await newDraft()
    const p = await toBooked(id)
    deps.cancelJob.mockImplementationOnce(async () => ({ ok: false, error: 'The channel would not let go' }))
    const r = await performPostTransition(id, 'unbook', await as(SCHED, id), { expect_rev: p.rev })
    expect(r.ok).toBe(false)
    expect((await stateOf(id)).stage).toBe('booked')
  })

  it('one job pulled and the next refused: the post comes back to Ready to post, never "booked" over half a booking', async () => {
    const id = await newDraft()
    await toBooked(id)
    await linkJobs(id, ['job-child'])
    const p = await stateOf(id)
    deps.cancelJob.mockImplementation(async (jobId: string) => jobId === 'job-child'
      ? { ok: false, error: 'It is being sent right now' }
      : { ok: true })
    const r = await performPostTransition(id, 'cancel', await as(SCHED, id), { expect_rev: p.rev, confirm: true })
    deps.cancelJob.mockImplementation(async () => ({ ok: true }))
    expect(r.ok).toBe(false)
    const now = await stateOf(id)
    expect(now.stage).toBe('ready')
    expect(now.booking).toBeNull()
    expect(now.problem).toContain('It is being sent right now')
  })

  it('a post is never booked without an approval of the version it holds (audit B2)', async () => {
    const id = await newDraft()
    const p = await stateOf(id)
    const r = await performPostTransition(id, 'book', await as(SCHED, id), { expect_rev: p.rev })
    expect(r.ok).toBe(false)
    expect(deps.queuePublish).not.toHaveBeenCalled()
  })
})

/* ── per post, never per card (audit V1, V2) ────────────────────────────── */

describe('siblings', () => {
  it('cancelling post A leaves post B — its stage, its approval and its job — exactly as it was', async () => {
    const a = await newDraft()
    const b = await newDraft({ channels: ['acc-li'] })
    await toBooked(a)
    await toBooked(b)
    const bBefore = JSON.stringify(rowOf(b))
    const pa = await stateOf(a)
    deps.cancelJob.mockClear()
    const r = await performPostTransition(a, 'cancel', await as(SCHED, a), { expect_rev: pa.rev, confirm: true })
    expect(r.ok && r.stage).toBe('cancelled')
    expect(deps.cancelJob.mock.calls.map(c => c[0])).toEqual(pa.booking!.job_ids)
    expect(JSON.stringify(rowOf(b))).toBe(bBefore)
  })

  it('a second post on the same card can be sent, passed and booked after the first posted', async () => {
    const first = await newDraft()
    await toBooked(first)
    const done = await record(first, { instagram: { status: 'published', url: 'https://instagram.com/p/1', at: IN(0), error: null } }, ['instagram'])
    expect(done && done.ok).toBe(true)
    expect((await stateOf(first)).stage).toBe('posted')

    const second = await newDraft({ slides: [SLIDES[1]] })
    const p = await toBooked(second)
    expect(p.stage).toBe('booked')
  })

  it('a scheduler may cancel a post somebody else made (the owner, decision 4)', async () => {
    const id = await newDraft()
    const p = await toReady(id)
    const r = await performPostTransition(id, 'cancel', await as(SCHED2, id), { expect_rev: p.rev, confirm: true })
    expect(r.ok && r.stage).toBe('cancelled')
  })
})

/* ── the client (audit V5, V6, V7, P2, P3, P9) ──────────────────────────── */

describe('the client', () => {
  it('nothing moves when the email reached nobody', async () => {
    const id = await newDraft()
    let p = await stateOf(id)
    await performPostTransition(id, 'send_to_qc', await as(SCHED, id), { expect_rev: p.rev })
    p = await stateOf(id)
    deps.deliverToClient.mockImplementationOnce(async (input: { emails: string[]; post: { id: string } }) => ({ delivered: [], failed: input.emails, link: '' }))
    const r = await performPostTransition(id, 'pass_send_client', await as(QR, id), { expect_rev: p.rev, version: 1, send_to: ['jordan@acme.invalid'] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('delivery')
    const now = await stateOf(id)
    expect(now.stage).toBe('quality_check')
    expect(now.client_send).toBeNull()
    expect(now.qc_pass).toBeNull()
  })

  it('only addresses on the client’s own list', async () => {
    const id = await newDraft()
    let p = await stateOf(id)
    await performPostTransition(id, 'send_to_qc', await as(SCHED, id), { expect_rev: p.rev })
    p = await stateOf(id)
    const r = await performPostTransition(id, 'pass_send_client', await as(QR, id), { expect_rev: p.rev, version: 1, send_to: ['stranger@evil.invalid'] })
    expect(!r.ok && r.code).toBe('contact')
    expect(deps.deliverToClient).not.toHaveBeenCalled()
  })

  it('records who it went to, for which version — only after it went', async () => {
    const id = await newDraft()
    const p = await toClient(id)
    expect(p.stage).toBe('with_client')
    expect(p.client_send).toMatchObject({ version: 1, to: ['jordan@acme.invalid'], via: 'email' })
    expect(p.client_send?.approve_by).toBeTruthy()
  })

  it('the client cannot approve a post that is not with them (audit V5, P3)', async () => {
    const id = await newDraft()
    const p = await toReady(id)
    const r = await engine.clientActOnPost(CLIENT, id, { action: 'client_approve', version: p.sent_version! })
    expect(!r.ok && r.code).toBe('wrong_stage')
    expect((await stateOf(id)).approval?.hat).toBe('quality_reviewer')
  })

  it('…nor another client’s post', async () => {
    const id = await newDraft()
    const p = await toClient(id)
    const r = await engine.clientActOnPost('someone-else', id, { action: 'client_approve', version: p.sent_version! })
    expect(!r.ok && r.code).toBe('not_found')
  })

  it('after the team edits it, the client’s old version is refused; version 1 still reads as sent', async () => {
    const id = await newDraft()
    const p = await toClient(id)
    const edited = await performPostTransition(id, 'edit', await as(AM, id), { expect_rev: p.rev })
    expect(edited.ok).toBe(true)
    const now = await stateOf(id)
    expect(now.stage).toBe('draft')
    expect(now.client_send).toBeNull()
    expect(now.last_client_send?.version).toBe(1)
    expect(now.sent_version).toBe(1)
    const r = await engine.clientActOnPost(CLIENT, id, { action: 'client_approve', version: 1 })
    expect(r.ok).toBe(false)
  })

  it('the client’s yes is theirs; a manager’s yes for them says so', async () => {
    const a = await newDraft()
    const pa = await toClient(a)
    const yes = await engine.clientActOnPost(CLIENT, a, { action: 'client_approve', version: pa.sent_version! })
    expect(yes.ok && yes.post.approval).toMatchObject({ hat: 'client', on_behalf_of_client: false })

    const b = await newDraft({ slides: [SLIDES[1]] })
    const pb = await toClient(b)
    const forThem = await performPostTransition(b, 'approve_for_client', await as(AM, b), {
      expect_rev: pb.rev, version: pb.sent_version, agreed_via: 'whatsapp',
    })
    expect(forThem.ok && forThem.post.approval).toMatchObject({ hat: 'account_manager', on_behalf_of_client: true, agreed_via: 'whatsapp' })
  })

  it('a copied link moves the post without an email, and hands the link back', async () => {
    const id = await newDraft()
    let p = await stateOf(id)
    await performPostTransition(id, 'send_to_qc', await as(SCHED, id), { expect_rev: p.rev })
    p = await stateOf(id)
    const r = await performPostTransition(id, 'pass_send_client', await as(QR, id), { expect_rev: p.rev, version: 1, via: 'link' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.link).toContain(`/post/${id}`)
    expect(r.post.client_send).toMatchObject({ via: 'link', to: [] })
  })
})

/* ── frozen versions are never rewritten ────────────────────────────────── */

describe('freezing', () => {
  it('a leftover version with other content is skipped, never overwritten', async () => {
    const id = await newDraft()
    // an earlier send that never landed left v1 behind, and the caption has changed since
    fake.tree().mdm.tables.post_versions = {
      [`${id}_v1`]: { id: `${id}_v1`, post_id: id, client_id: CLIENT, n: 1, slides: SLIDES, channels: ['acc-ig'], caption: 'OLD words', timezone: 'Australia/Melbourne', frozen_for: 'quality_check', frozen_at: IN(-1) },
    }
    const p = await stateOf(id)
    const r = await performPostTransition(id, 'send_to_qc', await as(SCHED, id), { expect_rev: p.rev })
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    if (!r.ok) return
    expect(r.post.sent_version).toBe(2)
    expect((fake.rows('post_versions').find(v => v.id === `${id}_v1`) as any).caption).toBe('OLD words')
    expect((fake.rows('post_versions').find(v => v.id === `${id}_v2`) as any).caption).toBe('Hello everyone')
  })
})

/* ── the way back (audit W2, V3, S1) ────────────────────────────────────── */

describe('cancel, re-book, delete', () => {
  it('a cancelled post can be re-booked: a draft with the same files and words, no time', async () => {
    const id = await newDraft()
    const p = await toReady(id)
    await performPostTransition(id, 'cancel', await as(SCHED, id), { expect_rev: p.rev, confirm: true })
    const c = await stateOf(id)
    const r = await performPostTransition(id, 'rebook', await as(SCHED, id), { expect_rev: c.rev })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.post.stage).toBe('draft')
    expect(r.post.scheduled_for).toBeNull()
    expect(r.post.caption).toBe('Hello everyone')
    expect(r.post.slides).toHaveLength(2)
  })

  it('a draft that was never sent is deleted for good; a sent one can only be cancelled', async () => {
    const id = await newDraft()
    const p = await stateOf(id)
    const r = await performPostTransition(id, 'delete_draft', await as(SCHED, id), { expect_rev: p.rev, confirm: true })
    expect(r.ok && r.stage).toBe('deleted')
    expect(rowOf(id)).toBeUndefined()
    expect(fake.rows('post_events').find(e => e.id === `${id}_r1`)).toMatchObject({ to: 'deleted', action: 'delete_draft' })

    const sent = await newDraft({ slides: [SLIDES[1]] })
    await toReady(sent)
    const s = await stateOf(sent)
    const edit = await performPostTransition(sent, 'edit', await as(SCHED, sent), { expect_rev: s.rev })
    expect(edit.ok).toBe(true)
    const d = await performPostTransition(sent, 'delete_draft', await as(SCHED, sent), { expect_rev: (await stateOf(sent)).rev, confirm: true })
    expect(!d.ok && d.code).toBe('use_cancel')
    expect(rowOf(sent)).toBeTruthy()
  })
})

/* ── outcomes and the missing networks (T16–T18, T21) ───────────────────── */

describe('what went out', () => {
  it('posted on one of two: Posted with the problem, and the missing network becomes its own post', async () => {
    const id = await newDraft({ channels: ['acc-ig', 'acc-li'] })
    await toBooked(id)
    const r = await record(id, {
      instagram: { status: 'published', url: 'https://instagram.com/p/1', at: IN(0), error: null },
      linkedin: { status: 'failed', url: null, at: IN(0), error: 'token expired' },
    }, ['instagram', 'linkedin'])
    expect(r && r.ok).toBe(true)
    const p = await stateOf(id)
    expect(p.stage).toBe('posted')
    expect(p.problem).toContain('LinkedIn')
    expect(p.outcomes.instagram.url).toBe('https://instagram.com/p/1')

    const m = await performPostTransition(id, 'missing_networks', await as(SCHED, id), { expect_rev: p.rev })
    expect(m.ok).toBe(true)
    if (!m.ok) return
    const created = await stateOf(m.created_post_id!)
    expect(created.stage).toBe('ready')
    expect(created.channels).toEqual(['acc-li'])
    expect(created.approval?.version).toBe(1)
    expect(created.sent_version).toBe(1)
    expect(fake.rows('post_versions').find(v => v.id === `${created.id}_v1`)).toBeTruthy()
    // the original is untouched but for its rev
    expect((await stateOf(id)).stage).toBe('posted')
  })

  it('nothing is recorded while a network is still waiting', async () => {
    const id = await newDraft({ channels: ['acc-ig', 'acc-li'] })
    await toBooked(id)
    const r = await record(id, { instagram: { status: 'published', url: null, at: IN(0), error: null } }, ['instagram', 'linkedin'])
    expect(r).toMatchObject({ ok: true, pending: true })
    expect((await stateOf(id)).stage).toBe('booked')
  })

  it('every network failed: back to Ready to post with the reason, the booking cleared', async () => {
    const id = await newDraft()
    await toBooked(id)
    await record(id, { instagram: { status: 'failed', url: null, at: IN(0), error: 'nope' } }, ['instagram'])
    const p = await stateOf(id)
    expect(p.stage).toBe('ready')
    expect(p.booking).toBeNull()
    expect(p.problem).toContain('Instagram')
  })

  it('a resend’s jobs join the booking, so a cancel would see them (audit V11)', async () => {
    const id = await newDraft()
    await toBooked(id)
    const r = await linkJobs(id, ['job-child'])
    expect(r && r.ok).toBe(true)
    expect((await stateOf(id)).booking?.job_ids).toEqual(['job-1', 'job-child'])
  })
})

/* ── the card is deleted (audit V8, L6) ─────────────────────────────────── */

describe('deleting the card', () => {
  it('is refused while one of its posts is booked', async () => {
    const id = await newDraft()
    await toBooked(id)
    const r = await cascadeItemDelete(ITEM, AM.id)
    expect(r.ok).toBe(false)
    expect((await stateOf(id)).stage).toBe('booked')
  })

  it('cancels the posts not yet out, marks every post, and leaves posted history', async () => {
    const draft = await newDraft()
    const ready = await newDraft({ slides: [SLIDES[1]] })
    await toReady(ready)
    const posted = await newDraft({ channels: ['acc-li'] })
    await toBooked(posted)
    await record(posted, { linkedin: { status: 'published', url: 'https://linkedin.com/1', at: IN(0), error: null } }, ['linkedin'])
    const r = await cascadeItemDelete(ITEM, AM.id)
    expect(r.ok).toBe(true)
    for (const id of [draft, ready]) {
      const p = await stateOf(id)
      expect(p.stage).toBe('cancelled')
      expect(p.cancelled?.reason).toBe('card deleted')
      expect(p.source_deleted).toBe(true)
    }
    const h = await stateOf(posted)
    expect(h.stage).toBe('posted')
    expect(h.source_deleted).toBe(true)
  })
})

/* ── who may (decisions 3, 4, 7) ────────────────────────────────────────── */

describe('who may', () => {
  it('an account manager who is not the quality checker cannot pass', async () => {
    const id = await newDraft()
    let p = await stateOf(id)
    await performPostTransition(id, 'send_to_qc', await as(SCHED, id), { expect_rev: p.rev })
    p = await stateOf(id)
    const r = await performPostTransition(id, 'pass', await as(AM, id), { expect_rev: p.rev, version: 1 })
    expect(!r.ok && r.code).toBe('not_allowed')
  })

  it('an editor moves nothing', async () => {
    const id = await newDraft()
    const p = await stateOf(id)
    const r = await performPostTransition(id, 'send_to_qc', await as(EDITOR, id), { expect_rev: p.rev })
    expect(!r.ok && r.code).toBe('not_allowed')
  })

  it('the act entry refuses a client account, the app’s own steps and a client it is not on', async () => {
    const id = await newDraft()
    const p = await stateOf(id)
    const client = person('u-cl', 'client')
    expect(await actOnPost(client, id, { action: 'send_to_qc', expect_rev: p.rev })).toMatchObject({ ok: false, code: 'not_allowed' })
    expect(await actOnPost(SA, id, { action: 'booking_done' as never, expect_rev: p.rev })).toMatchObject({ ok: false, code: 'not_allowed' })
    deps.mayActOnClient.mockImplementationOnce(async () => false)
    expect(await actOnPost(AM, id, { action: 'send_to_qc', expect_rev: p.rev })).toMatchObject({ ok: false, code: 'not_allowed' })
    expect(await actOnPost(AM, 'no-such-post', { action: 'send_to_qc', expect_rev: 0 })).toMatchObject({ ok: false, code: 'not_found' })
  })
})

/* ── the source pin: one writer of a stage ──────────────────────────────── */

describe('the only writer of social_posts.stage is app/lib/post-stage.ts', () => {
  const root = join(__dirname, '..')
  const files = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { if (name !== 'node_modules') files(p, out) }
      else if (/\.(ts|tsx)$/.test(name)) out.push(p)
    }
    return out
  }
  it('no other file under app/ writes a stage onto a post row', () => {
    const STAGE_WRITE = /\bstage\s*:\s*['"](draft|quality_check|with_client|ready|booked|posted|cancelled)['"]/
    const writers = files(join(root, 'app'))
      .filter(f => {
        // the code, not its comments
        const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
        // a file that opens the table (the pure rules name stages but never touch a row)
        const opens = /\btable\s*(<[^>]*>)?\s*\(\s*['"]social_posts['"]/.test(src)
        return opens && /\.(insert|update|upsert|claim|compareAndSet)\(/.test(src) && STAGE_WRITE.test(src)
      })
      .map(f => relative(root, f).replace(/\\/g, '/'))
    expect(writers).toEqual(['app/lib/post-stage.ts'])
  })
})
