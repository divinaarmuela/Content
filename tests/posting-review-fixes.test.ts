import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import { table } from '@/lib/db'
import type { Row } from '@/lib/db-types'
import type { TeamUser } from '@/app/lib/authz'
import {
  checkPostTransition, hatsFor, mayWorkOnPost, postActions, readPostState, waitingOnViewer,
  type PostHat, type PostStage, type PostState,
} from '@/app/lib/post-stage-core'
import { postVisibleTo, postWindowHref, roundCandidates } from '@/app/lib/post-board-core'
import { clientPostView } from '@/app/lib/portal-core'

/**
 * THE REVIEW FIXES OF 29 SEP 2026, pinned on the real one writer over the in-memory database
 * (tests/helpers/fake-rtdb.ts). Each block names the review finding it closes. The provider, the mailer
 * and the notices are fakes — no test reaches a channel or an inbox.
 */

const engine = await import('../app/lib/post-stage')
const {
  performPostTransition, teamActorFor, usePostEngineDeps, insertDraftPost, saveWorkingCopy, actOnPost,
  sendRoundToClient, SENDING_HOLD_MS,
} = engine

const CLIENT = 'c1'
const OTHER = 'c2'
const ITEM = 'item-1'
const person = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
  id, role, email: `${id}@x.invalid`, name: id.replace('u-', '').toUpperCase(), clerk_user_id: null,
  employment_type: 'employee', timezone: 'Australia/Melbourne', client_id: null, active_status: true, ...extra,
}) as unknown as TeamUser
const SCHED = person('u-sch', 'scheduler')
const AM = person('u-am', 'account_manager')
const QR = person('u-qr', 'quality_checker')
const SA = person('u-sa', 'super_admin')

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
  deliverRound: vi.fn(async (input: { emails: string[]; posts: unknown[] }) => ({ delivered: input.emails, message: `Emailed ${input.emails.join(', ')}.` })),
  notify: vi.fn(async () => {}),
  announce: vi.fn(),
  mayActOnClient: vi.fn(async (_user: TeamUser, _clientId: string) => true),
}

beforeEach(() => {
  jobSeq = 0
  fake = seedDb({
    clients: [
      { id: CLIENT, name: 'Acme', timezone: 'Australia/Melbourne', share_token: 'tok-1', email: 'owner@acme.invalid', client_approval_required: false },
      { id: OTHER, name: 'Other', timezone: 'Australia/Melbourne', share_token: 'tok-2', email: 'owner@other.invalid', client_approval_required: false },
    ] as unknown as Row[],
    client_contacts: [{ id: 'cc1', client_id: CLIENT, name: 'Jordan', email: 'jordan@acme.invalid', is_primary: true }] as unknown as Row[],
    social_accounts: [
      { id: 'acc-ig', client_id: CLIENT, platform: 'instagram', provider_account_id: 'p-ig', name: 'Acme IG', active: true },
      { id: 'acc-li', client_id: CLIENT, platform: 'linkedin', provider_account_id: 'p-li', name: 'Acme LinkedIn', active: true },
    ] as unknown as Row[],
    content_items: [{ id: ITEM, client_id: CLIENT, title: 'Launch', status: 'approved_for_scheduling' }] as unknown as Row[],
    team_users: [SCHED, AM, QR, SA] as unknown as Row[],
    social_posts: [], post_versions: [], post_events: [], publish_jobs: [], claim_locks: [],
  } as never)
  for (const f of Object.values(deps)) f.mockClear()
  deps.mayActOnClient.mockImplementation(async (_user: TeamUser, _clientId: string) => true)
  undo = usePostEngineDeps(deps as never)
})
afterEach(() => {
  undo()
  fake.restore()
})

async function newDraft(over: Record<string, unknown> = {}): Promise<string> {
  const row = await insertDraftPost({
    client_id: CLIENT, item_id: ITEM, created_by: SCHED.id, slides: SLIDES as never, caption: 'Hello everyone',
    channels: ['acc-ig', 'acc-li'], per_channel: {}, scheduled_for: IN(48), timezone: 'Australia/Melbourne',
    ...over,
  } as never)
  return row.id
}
const rowOf = (id: string) => fake.rows('social_posts').find(p => p.id === id) as Record<string, any> | undefined
const stateOf = async (id: string) => (await engine.loadPostState(id)).post!
const as = async (who: TeamUser, id: string) => teamActorFor(who, await stateOf(id))

async function toQc(id: string) {
  const p = await stateOf(id)
  const r = await performPostTransition(id, 'send_to_qc', await as(SCHED, id), { expect_rev: p.rev })
  expect(r.ok, r.ok ? '' : r.reason).toBe(true)
  return stateOf(id)
}
async function toReady(id: string) {
  const p = await toQc(id)
  const r = await performPostTransition(id, 'pass', await as(QR, id), { expect_rev: p.rev, version: p.sent_version })
  expect(r.ok, r.ok ? '' : r.reason).toBe(true)
  return stateOf(id)
}
async function toClient(id: string) {
  const p = await toQc(id)
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

/* ── P9: the post is claimed for the send BEFORE the email goes ─────────── */

describe('a client send holds its post before the email goes (review: P9 reversed)', () => {
  it('while the email is going, the post says so and every other move waits', async () => {
    const id = await newDraft()
    const p = await toQc(id)
    let during: Record<string, any> | undefined
    const seen: { edit: { ok: boolean; reason?: string } | null } = { edit: null }
    deps.deliverToClient.mockImplementationOnce(async (input: { emails: string[]; post: { id: string } }) => {
      during = rowOf(id)
      seen.edit = await performPostTransition(id, 'edit', await as(SCHED, id), { expect_rev: during!.rev })
      return { delivered: input.emails, failed: [], link: 'x' }
    })
    const r = await performPostTransition(id, 'pass_send_client', await as(QR, id), {
      expect_rev: p.rev, version: p.sent_version, send_to: ['jordan@acme.invalid'],
    })
    expect(during?.sending?.action).toBe('pass_send_client')
    expect(during?.stage).toBe('quality_check')
    expect(seen.edit?.ok).toBe(false)
    expect(seen.edit?.reason).toMatch(/being sent to the client right now/)
    expect(r.ok && r.stage).toBe('with_client')
    expect(rowOf(id)?.sending ?? null).toBeNull()
  })

  it('an email that reached nobody lets the post go, unchanged', async () => {
    const id = await newDraft()
    const p = await toQc(id)
    deps.deliverToClient.mockImplementationOnce(async () => ({ delivered: [], failed: ['jordan@acme.invalid'], link: 'x' }))
    const r = await performPostTransition(id, 'pass_send_client', await as(QR, id), {
      expect_rev: p.rev, version: p.sent_version, send_to: ['jordan@acme.invalid'],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('delivery')
    expect(rowOf(id)?.stage).toBe('quality_check')
    expect(rowOf(id)?.sending ?? null).toBeNull()
    // and the next press is not held up
    const again = await performPostTransition(id, 'edit', await as(SCHED, id), { expect_rev: (await stateOf(id)).rev })
    expect(again.ok).toBe(true)
  })

  it('a send that lost its hold after the email went says the email went, and the post did not move', async () => {
    const id = await newDraft()
    const p = await toQc(id)
    deps.deliverToClient.mockImplementationOnce(async (input: { emails: string[] }) => {
      // somebody's stale hold was cleared under the send (a hold older than SENDING_HOLD_MS is ignored)
      await table('social_posts').update(id, { sending: null } as never)
      return { delivered: input.emails, failed: [], link: 'x' }
    })
    const r = await performPostTransition(id, 'pass_send_client', await as(QR, id), {
      expect_rev: p.rev, version: p.sent_version, send_to: ['jordan@acme.invalid'],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/The email went to jordan@acme\.invalid, but the post did not move/)
    expect(rowOf(id)?.stage).toBe('quality_check')
  })

  it('a hold older than the limit does not lock the post', async () => {
    const id = await newDraft()
    await toQc(id)
    const old = new Date(Date.now() - SENDING_HOLD_MS - 60_000).toISOString()
    await table('social_posts').update(id, { sending: { token: 't-old', action: 'pass_send_client', by: 'u-qr', at: old } } as never)
    const r = await performPostTransition(id, 'edit', await as(SCHED, id), { expect_rev: (await stateOf(id)).rev })
    expect(r.ok).toBe(true)
    expect(rowOf(id)?.sending ?? null).toBeNull()
  })
})

/* ── V11/S5: live on the booking's jobs, even before the recorder wrote it ── */

describe('a booked post live on some network cannot come off, be edited or be cancelled (review: V11/S5)', () => {
  it('reads the booking jobs (and their re-sends) before the move', async () => {
    const id = await newDraft()
    const p = await toBooked(id)
    const parent = p.booking!.job_ids[0]
    // the parent partly went out and failed on LinkedIn; a LinkedIn re-send is still queued; the post
    // is still "booked" with no outcomes, because the recorder waits for every network
    await table('publish_jobs').insert({
      id: parent, client_id: CLIENT, content_item_id: ITEM, status: 'failed', caption: 'x', media: [], targets: [],
      timezone: 'Australia/Melbourne', request_id: 'r1', attempts: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      platform_results: [{ platform: 'instagram', status: 'published', url: 'https://www.instagram.com/p/abc' }, { platform: 'linkedin', status: 'failed' }],
    } as never)
    await table('publish_jobs').insert({
      id: 'child-1', resend_of: parent, client_id: CLIENT, content_item_id: ITEM, status: 'queued', caption: 'x', media: [], targets: [],
      timezone: 'Australia/Melbourne', request_id: 'r2', attempts: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    } as never)
    expect(Object.keys((await stateOf(id)).outcomes)).toEqual([])
    const rev = (await stateOf(id)).rev
    for (const action of ['unbook', 'edit_booked', 'cancel'] as const) {
      const r = await performPostTransition(id, action, await as(SCHED, id), { expect_rev: rev, confirm: true })
      expect(r.ok, action).toBe(false)
      if (!r.ok) {
        expect(r.code).toBe('live')
        expect(r.reason).toMatch(/Instagram/)
      }
    }
    expect(deps.cancelJob).not.toHaveBeenCalled()
    expect(rowOf(id)?.stage).toBe('booked')
  })

  it('the rule itself: jobs saying a network went out stop the take-off', () => {
    const post = readPostState({
      id: 'p', client_id: CLIENT, stage: 'booked', rev: 3, sent_version: 1, draft_version: 2,
      approval: { version: 1, by: 'u-qr', hat: 'quality_reviewer', at: 'x' }, booking: { job_ids: ['j1'], pending: false, at: 'x' },
    })!
    const actor = { id: 'u-sch', hats: ['scheduler'] as PostHat[] }
    expect(checkPostTransition(post, 'unbook', actor, {}, { now: new Date() }).ok).toBe(true)
    const r = checkPostTransition(post, 'unbook', actor, {}, { now: new Date(), liveOnJobs: ['instagram'] })
    expect(r.ok).toBe(false)
  })
})

/* ── S10/V10: a new time copies the checked version, never the working copy ── */

describe('a retime freezes the version that was approved (review: S10, V10)', () => {
  it('Change time on a Ready post copies version 1 with only the time changed', async () => {
    const id = await newDraft()
    const p = await toReady(id)
    // something outside the writer changed the working copy (the old crop path did exactly this)
    await table('social_posts').update(id, { slides: [{ url: 'https://media.mdmmarketing.com.au/unchecked.jpg', name: 'u.jpg', type: 'image' }], caption: 'Unchecked words' } as never)
    const when = IN(72)
    const r = await performPostTransition(id, 'change_time', await as(SCHED, id), { expect_rev: (await stateOf(id)).rev, scheduled_for: when })
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    const v2 = fake.rows('post_versions').find(v => v.id === `${id}_v2`) as Record<string, any>
    const v1 = fake.rows('post_versions').find(v => v.id === `${id}_v1`) as Record<string, any>
    expect(v2.caption).toBe(v1.caption)
    expect(v2.slides.map((s: { url: string }) => s.url)).toEqual(v1.slides.map((s: { url: string }) => s.url))
    expect(v2.scheduled_for).toBe(when)
    expect((await stateOf(id)).approval?.version).toBe(p.sent_version! + 1)
  })

  it('New time and resend carries the quality-check pass to the new version', async () => {
    const id = await newDraft()
    const p = await toClient(id)
    expect(p.qc_pass?.version).toBe(1)
    const r = await performPostTransition(id, 'resend_new_time', await as(AM, id), {
      expect_rev: p.rev, scheduled_for: IN(96), send_to: ['jordan@acme.invalid'],
    })
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    const now = await stateOf(id)
    expect(now.sent_version).toBe(2)
    expect(now.qc_pass?.version).toBe(2)
  })

  it('Change time is offered at the quality check, to the people who can book', async () => {
    const id = await newDraft()
    const p = await toQc(id)
    const r = await performPostTransition(id, 'change_time', await as(SCHED, id), { expect_rev: p.rev, scheduled_for: IN(100) })
    expect(r.ok && r.stage, r.ok ? '' : r.reason).toBe('quality_check')
    expect((await stateOf(id)).sent_version).toBe(2)
    const qrActions = postActions(await stateOf(id), ['qr'], new Date())
    expect([qrActions.primary, ...qrActions.secondary].some(a => a?.action === 'change_time')).toBe(false)
  })
})

/* ── decision 13 / set_steps on a Ready post ────────────────────────────── */

describe('"Team, then the client" cannot be chosen on a post the team already approved', () => {
  it('is refused with the way forward', async () => {
    const id = await newDraft()
    const p = await toReady(id)
    const r = await performPostTransition(id, 'set_steps', await as(AM, id), { expect_rev: p.rev, steps: 'team_then_client' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Send to client/)
    const ok = await performPostTransition(id, 'set_steps', await as(AM, id), { expect_rev: p.rev, steps: 'team' })
    expect(ok.ok).toBe(true)
  })
})

/* ── decision 6: the team decides without the client ─────────────────────── */

describe('the team may decide without waiting for the client (decision 6)', () => {
  it('is recorded as the team\'s decision, and the client\'s page says so', async () => {
    const id = await newDraft()
    const p = await toClient(id)
    const refused = await performPostTransition(id, 'team_decides', await as(AM, id), { expect_rev: p.rev, version: p.sent_version })
    expect(refused.ok).toBe(false)
    const r = await performPostTransition(id, 'team_decides', await as(AM, id), {
      expect_rev: p.rev, version: p.sent_version, note: 'Launch cannot wait',
    })
    expect(r.ok && r.stage).toBe('ready')
    const now = await stateOf(id)
    expect(now.approval).toMatchObject({ hat: 'account_manager', on_behalf_of_client: false, note: 'Launch cannot wait' })
    const view = clientPostView(now, new Date())
    expect(view?.headline).toBe('The team decided this one')
    // a scheduler may not
    const sched = postActions(p, hatsFor(SCHED, p), new Date())
    expect([sched.primary, ...sched.secondary].some(a => a?.action === 'team_decides')).toBe(false)
  })
})

/* ── decision 3: the quality checker's desk, on the board AND the server ─── */

describe('the quality checker works every post at the check, whoever\'s client (review: decision 3)', () => {
  it('the act route lets the reviewer pass a post of a client they are not on', async () => {
    deps.mayActOnClient.mockImplementation(async (user: TeamUser) => user.role !== 'quality_checker' && user.role !== 'account_manager')
    const id = await newDraft()
    const p = await toQc(id)
    const r = await actOnPost(QR, id, { action: 'pass', expect_rev: p.rev, version: p.sent_version })
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    // …but an account manager who is not on the client is still refused
    const id2 = await newDraft()
    const p2 = await toQc(id2)
    const am = await actOnPost(AM, id2, { action: 'ask_change', expect_rev: p2.rev, version: p2.sent_version, note: 'x' })
    expect(am.ok).toBe(false)
    if (!am.ok) expect(am.code).toBe('not_allowed')
  })

  it('the board shows exactly what the server lets a person work on, for every role', () => {
    const roles = ['super_admin', 'account_manager', 'scheduler', 'general', 'quality_checker', 'editor']
    const stages: PostStage[] = ['draft', 'quality_check', 'with_client', 'ready', 'booked', 'posted', 'cancelled']
    const assignments = [{ team_user_id: 'me', client_id: 'mine' }]
    for (const role of roles) {
      const ids = ['super_admin', 'scheduler', 'general'].includes(role) ? null : ['mine']
      for (const stage of stages) {
        for (const client_id of ['mine', 'theirs']) {
          const post = { client_id, stage, created_by: 'someone', assigned_to: null, changes_asked: null }
          const me = { id: 'me', role }
          expect(postVisibleTo(post, me, assignments), `${role} ${stage} ${client_id}`).toBe(mayWorkOnPost(me, post, ids))
        }
      }
    }
  })
})

/* ── decision 15: one email per round ───────────────────────────────────── */

describe('several posts to one client in one email (decision 15)', () => {
  it('claims every post, sends ONE round, then moves each', async () => {
    const a = await newDraft()
    const b = await newDraft({ caption: 'Second' })
    const pa = await toQc(a)
    const pb = await toReady(b)
    const r = await sendRoundToClient(QR, {
      client_id: CLIENT,
      posts: [{ post_id: a, expect_rev: pa.rev, version: pa.sent_version }],
      send_to: ['jordan@acme.invalid'],
    })
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    deps.deliverRound.mockClear()
    const r2 = await sendRoundToClient(AM, {
      client_id: CLIENT,
      posts: [{ post_id: b, expect_rev: pb.rev, version: pb.sent_version }, { post_id: (await newDraftAtQc()).id, expect_rev: 0 }],
      send_to: ['jordan@acme.invalid'],
    })
    // the second post's rev was wrong: nothing is sent, and no post is left holding a send
    expect(r2.ok).toBe(false)
    expect(deps.deliverRound).not.toHaveBeenCalled()
    expect(rowOf(b)?.sending ?? null).toBeNull()
    expect(rowOf(b)?.stage).toBe('ready')
  })

  it('two posts, one email, both With client', async () => {
    const a = await newDraft()
    const b = await newDraft({ caption: 'Second' })
    const pa = await toReady(a)
    const pb = await toReady(b)
    const r = await sendRoundToClient(AM, {
      client_id: CLIENT,
      posts: [{ post_id: a, expect_rev: pa.rev, version: pa.sent_version }, { post_id: b, expect_rev: pb.rev, version: pb.sent_version }],
      send_to: ['jordan@acme.invalid'],
    })
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    expect(deps.deliverRound).toHaveBeenCalledTimes(1)
    expect(deps.deliverRound.mock.calls[0][0].posts).toHaveLength(2)
    expect(deps.deliverToClient).not.toHaveBeenCalled()
    expect(rowOf(a)?.stage).toBe('with_client')
    expect(rowOf(b)?.stage).toBe('with_client')
    expect(rowOf(a)?.client_send?.to).toEqual(['jordan@acme.invalid'])
  })

  it('the board offers a round only of posts whose send is open to this person', () => {
    const now = new Date()
    const mk = (id: string, stage: PostStage, client_id = CLIENT): PostState => readPostState({
      id, client_id, stage, rev: 1, sent_version: 1, draft_version: 2, scheduled_for: IN(48), channels: ['acc-ig'],
      slides: SLIDES, qc_pass: stage === 'ready' ? { version: 1, by: 'u-qr', at: 'x' } : null,
      // the round sends: a post at the quality check goes to the client only on that route (30 Sep 2026)
      approval_steps: 'team_then_client',
      approval: stage === 'ready' ? { version: 1, by: 'u-qr', hat: 'quality_reviewer', at: 'x' } : null,
    })!
    const ctx = { clientHasContact: true, accounts: [{ id: 'acc-ig', platform: 'instagram', live: true }] }
    const posts = [mk('q1', 'quality_check'), mk('r1', 'ready'), mk('d1', 'draft')]
      .map(post => ({ post, hats: ['am'] as PostHat[], ctx, face: { client: 'Acme' } }))
    const groups = roundCandidates(posts, now)
    // an account manager cannot pass: only the Ready one can go
    expect(groups[0].posts.map(p => p.bp.post.id)).toEqual(['r1'])
    const qr = roundCandidates(posts.map(p => ({ ...p, hats: ['qr'] as PostHat[] })), now)
    expect(qr[0].posts.map(p => p.bp.post.id)).toEqual(['q1'])
  })
})

async function newDraftAtQc(): Promise<PostState> {
  const id = await newDraft({ caption: 'Third' })
  return toQc(id)
}

/* ── decision 1: the window opens on the page that owns the stage ───────── */

describe('the post window opens on the page that owns the post\'s stage (review: decision 1)', () => {
  it('approval stages on Post approval; booking stages on Schedule', () => {
    const at = (stage: PostStage) => postWindowHref({ id: 'p1', client_id: 'c1', stage }, '/dashboard/social/schedule')
    expect(at('draft')).toBe('/dashboard/scheduler?post=p1')
    expect(at('quality_check')).toBe('/dashboard/scheduler?post=p1')
    expect(at('with_client')).toBe('/dashboard/scheduler?post=p1')
    expect(at('ready')).toBe('/dashboard/social/schedule?client=c1&post=p1')
    expect(at('booked')).toBe('/dashboard/social/schedule?client=c1&post=p1')
    expect(at('posted')).toBe('/dashboard/social/schedule?client=c1&post=p1')
    expect(postWindowHref({ id: 'p1', client_id: 'c1', stage: 'cancelled' }, '/dashboard/social/schedule', 'schedule')).toBe('/dashboard/social/schedule?client=c1&post=p1')
  })
})

/* ── a super admin is waited on too ─────────────────────────────────────── */

describe('a super admin has posts waiting on them', () => {
  it('at the quality check, and a missed time with the client', () => {
    const qc = readPostState({ id: 'p', client_id: CLIENT, stage: 'quality_check', rev: 1, sent_version: 1, scheduled_for: IN(48) })!
    expect(waitingOnViewer(qc, { id: 'u-sa', hats: ['sa'] }, new Date())).toBe(true)
    expect(waitingOnViewer(qc, { id: 'u-sch', hats: ['scheduler'] }, new Date())).toBe(false)
  })
})

/* ── a post whose card was deleted can be re-booked, saved and sent ─────── */

describe('a cancelled post from a deleted card is not a dead end (review: W2 again)', () => {
  it('Re-book, then a new time, then Send for quality check', async () => {
    const id = await newDraft()
    await toQc(id)
    const cascade = await engine.cascadeItemDelete(ITEM, AM.id)
    expect(cascade.ok).toBe(true)
    await table('content_items').remove(ITEM)
    const cancelled = await stateOf(id)
    expect(cancelled.stage).toBe('cancelled')
    const re = await performPostTransition(id, 'rebook', await as(SCHED, id), { expect_rev: cancelled.rev })
    expect(re.ok && re.stage).toBe('draft')
    const { updatePost } = await import('../app/lib/social-schedule')
    const saved = await updatePost(SCHED, id, { scheduled_for: IN(30), expect_rev: (await stateOf(id)).rev } as never)
    expect(saved.scheduled_for).toBeTruthy()
    const sent = await performPostTransition(id, 'send_to_qc', await as(SCHED, id), { expect_rev: (await stateOf(id)).rev })
    expect(sent.ok && sent.stage, sent.ok ? '' : sent.reason).toBe('quality_check')
  })

  it('saving is scoped by the post\'s client, not by the edit card', async () => {
    const id = await newDraft()
    const { loadPostForUser } = await import('../app/lib/social-schedule')
    // the card is at draft_uploaded, which a scheduler's card scope would not show
    await table('content_items').update(ITEM, { status: 'draft_uploaded', owner_id: 'someone-else' } as never)
    const loaded = await loadPostForUser(SCHED, id)
    expect(loaded.post.id).toBe(id)
    expect(loaded.item.id).toBe(ITEM)
  })
})

/* ── a crop follows only a draft, through the one writer ────────────────── */

describe('a crop never rewrites a frozen post (review: S10, V10)', () => {
  it('the source never compares a post\'s old status, and only the writer claims social_posts', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/lib/image-derive.ts', 'utf8')
    expect(src).not.toMatch(/STILL_CHANGEABLE/)
    expect(src).not.toMatch(/row\.status|cur\.status/)
    expect(src).not.toMatch(/table<SocialPost>\('social_posts'\)\.claim/)
    expect(src).toMatch(/saveWorkingCopy/)
  })
})

describe('the time picker saves the time it shows (live test, 29 Sep 2026)', () => {
  it('Done on a post with no time saves the suggested time; re-pressing the ringed day keeps it', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/dashboard/social/schedule/TimePicker.tsx', 'utf8')
    expect(src).toContain('onClick={() => { if (!value) onChange(joinClock(current, tz)); setOpen(false) }}')
    expect(src).toContain('onSelect={d => set({ dayKey: d ? keyOf(d) : current.dayKey })}')
  })
})
