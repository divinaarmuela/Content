import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import { table } from '@/lib/db'
import type { Row, SocialPost } from '@/lib/db-types'
import {
  bookingJobs, cardBookingLine, fileBooking, LATE_SEND_GRACE_MS, LOST_AT_PROVIDER, networkOfUrl,
  postNetworkOutcomes, providerTiming, sameOutcomes, scheduleRowWrites, TIME_PASSED_UNSENT, unlinkedJobs,
  urlBelongsTo, type BookingJob,
} from '../app/lib/post-outcome-core'
import { BOOK_FROM_THE_POST, publishDoorRefusal } from '../app/lib/publish-core'
import {
  outcomeAction, planPostTransition, readPostState,
  type PostActor, type PostState, type TransitionInput,
} from '../app/lib/post-stage-core'

/**
 * THE PUBLISH RECORDER (package P2 of the posting rebuild, 29 Sep 2026).
 *
 * What went out, per network, written onto the POST through the one writer
 * of its stage — T16 posted, T17 posted in part, T18 back to Ready to post —
 * and each network's schedule row with that network's own link.
 *
 * The audit's findings this pins: S5 (a duplicate is out), S7 (a partial is
 * "posted", not "did not go out"), S15 (per network, not one word), V11
 * (re-sends linked), V16/L1/L2 (one link per network, never on every row),
 * L8 (the booking's own time), and decision 11 (never a past time to the
 * provider).
 *
 * The server half runs the real `@/lib/db` on the in-memory database. P1's
 * writer is stood in for by the P0 rules applied inside a claim — the same
 * rules P1 runs — so this file tests the recorder, not P1.
 */

/* ── the writer, stood in for ───────────────────────────────────────────── */

const SYSTEM: PostActor = { id: null, hats: ['system'], name: 'Publishing service' }
const writes: { postId: string; action: string; input: TransitionInput }[] = []

/** P1's `performSystemTransition`, as far as the rules go: plan inside the claim, write the patch. */
async function performSystemTransition(postId: string, action: string, input: TransitionInput = {}) {
  writes.push({ postId, action, input })
  let refused: { ok: false; code: string; reason: string; post: PostState | null } | null = null
  const r = await table<SocialPost>('social_posts').claim(postId, cur => {
    const post = readPostState(cur as never)
    if (!post) return null
    const plan = planPostTransition(post, action, SYSTEM, { ...input, expect_rev: null }, { now: new Date() })
    if (!plan.ok) { refused = { ok: false, code: plan.code, reason: plan.reason, post }; return null }
    return { ...cur, ...plan.patch } as unknown as SocialPost
  })
  if (r.claimed) return { ok: true as const, post: readPostState(r.row as never)!, stage: readPostState(r.row as never)!.stage, words: '' }
  return refused ?? { ok: false as const, code: 'not_found', reason: 'gone', post: null }
}
vi.mock('../app/lib/post-stage', () => ({ performSystemTransition }))

/* ── the provider, stood in for — never the real one ────────────────────── */

type Created = { scheduledFor: string | null; requestId: string }
const created: Created[] = []
let answer: unknown = { kind: 'published', postId: 'prov-1' }
vi.mock('../app/lib/publisher', () => ({
  getPublisher: () => ({
    configured: () => true,
    createPost: async (p: Created) => { created.push({ scheduledFor: p.scheduledFor, requestId: p.requestId }); return answer },
    uploadMedia: async () => { throw new Error('nothing is relayed in these tests') },
  }),
}))
vi.mock('../app/lib/account-health', () => ({ refreshClientAccountsHealth: vi.fn(async () => {}) }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({ ids: [] })) } }))
vi.mock('../app/lib/production-live', () => ({ announceItemChange: vi.fn() }))
vi.mock('../app/lib/mailer', () => ({ notify: vi.fn(async () => 'sent'), renderEmail: () => '', escapeHtml: (s: string) => s }))

const { runPublishJob, resendTimedOut } = await import('../app/lib/publish')
const { recordPostOutcome, recordBookedOutcomes, recordPublishOnItem } = await import('../app/lib/production-publish')
const { readPlatformResults } = await import('../app/lib/post-outcome-core')

/* ── fixtures ───────────────────────────────────────────────────────────── */

const ITEM = 'item-1'
const IG = 'https://www.instagram.com/p/ABC123/'
const LI = 'https://www.linkedin.com/feed/update/urn:li:activity:7510303919114362880/'
const TT = 'https://www.tiktok.com/@client/video/7400000000000000000'

const inAnHour = () => new Date(Date.now() + 3600_000).toISOString()

const bookedPost = (over: Record<string, unknown> = {}): Row => ({
  id: 'post-1', client_id: 'client-1', item_id: ITEM, source_item_id: ITEM,
  stage: 'booked', rev: 5, stage_at: '2026-09-29T00:00:00.000Z',
  sent_version: 1, draft_version: 2,
  approval: { version: 1, by: 'qr-1', hat: 'quality_reviewer', at: '2026-09-29T00:00:00.000Z' },
  qc_pass: { version: 1, by: 'qr-1', at: '2026-09-29T00:00:00.000Z' },
  booking: { job_ids: ['j1'], pending: false, at: '2026-09-29T00:00:00.000Z', for_time: '2026-09-29T09:00:00.000Z' },
  slides: [{ url: 'https://zernio.com/a.jpg', type: 'image', name: 'a' }],
  channels: ['acc-ig', 'acc-li'], caption: 'Hello', timezone: 'Australia/Melbourne',
  outcomes: null, problem: null,
  ...over,
}) as unknown as Row

const job = (over: Record<string, unknown> = {}): Row => ({
  id: 'j1', client_id: 'client-1', content_item_id: ITEM, status: 'queued',
  caption: 'Hello', request_id: 'req-j1',
  media: [{ url: 'https://zernio.com/a.jpg', type: 'image' }],
  targets: [{ platform: 'instagram', accountId: 'acc-ig' }, { platform: 'linkedin', accountId: 'acc-li' }],
  timezone: 'Australia/Melbourne', scheduled_for: null, attempts: 0,
  created_at: new Date(Date.now() - 60_000).toISOString(), updated_at: new Date(Date.now() - 60_000).toISOString(),
  ...over,
}) as unknown as Row

const rows = () => [
  { id: 'se-ig', item_id: ITEM, platform: 'instagram', scheduled_at: '2026-09-22T08:34:06.642Z', live_url: null, publish_status: 'scheduled' },
  // the live-data bug of 054e0959 / c8fd52cf: another network's link already sitting on this row
  { id: 'se-li', item_id: ITEM, platform: 'linkedin', scheduled_at: '2026-09-29T09:00:00.000Z', live_url: TT, publish_status: 'scheduled' },
] as unknown as Row[]

let fake: ReturnType<typeof seedDb> | null = null
const post = () => readPostState(fake!.rows('social_posts').find(r => r.id === 'post-1') as never)!
const entry = (id: string) => fake!.rows('schedule_entries').find(r => r.id === id) as unknown as Record<string, unknown>

beforeEach(() => { writes.length = 0; created.length = 0; answer = { kind: 'published', postId: 'prov-1' } })
afterEach(() => { fake?.restore(); fake = null })

/* ═════════════════════════ the pure half ═════════════════════════════════ */

const bj = (over: Partial<BookingJob> & { id: string }): BookingJob => ({
  status: 'published', targets: [{ platform: 'instagram' }], created_at: '2026-09-29T00:00:00.000Z', ...over,
}) as BookingJob

describe('which jobs belong to a booking (audit V11)', () => {
  it('its own ids, and every re-send made of them, found by resend_of', () => {
    const all = [bj({ id: 'a' }), bj({ id: 'b', resend_of: 'a' }), bj({ id: 'c', resend_of: 'zzz' }), bj({ id: 'd' })]
    expect(bookingJobs(['a'], all).map(j => j.id)).toEqual(['a', 'b'])
    expect(unlinkedJobs(['a'], all)).toEqual(['b'])
    expect(unlinkedJobs(['a', 'b'], all)).toEqual([])
  })
})

describe('what each network came to', () => {
  it('a duplicate is out — the provider says it is already live (audit S5)', () => {
    const { outcomes, platforms } = postNetworkOutcomes([bj({ id: 'a', status: 'duplicate', platform_results: [{ platform: 'instagram', status: 'published', kind: 'Feed post' }] })])
    expect(platforms).toEqual(['instagram'])
    expect(outcomes.instagram.status).toBe('duplicate')
    expect(outcomeAction(outcomes, platforms)).toBe('record_posted')
  })

  it('a partial job is posted in part, not "did not go out" (audit S7, live job e63c744f)', () => {
    const { outcomes, platforms } = postNetworkOutcomes([bj({
      id: 'e63c744f', status: 'failed',
      targets: ['instagram', 'tiktok', 'youtube', 'linkedin'].map(platform => ({ platform })),
      error: 'Went out on instagram, tiktok, youtube. Did not go out on linkedin: The document is too large.',
    })])
    expect(Object.fromEntries(Object.entries(outcomes).map(([p, o]) => [p, o.status]))).toEqual({
      instagram: 'published', tiktok: 'published', youtube: 'published', linkedin: 'failed',
    })
    expect(outcomes.linkedin.error).toContain('too large')
    expect(outcomeAction(outcomes, platforms)).toBe('record_partial')
  })

  it('a published job whose per-network record still says scheduled is out on those networks (audit S15, b73496b1)', () => {
    const { outcomes } = postNetworkOutcomes([bj({
      id: 'b73496b1', status: 'published',
      targets: [{ platform: 'tiktok' }, { platform: 'instagram' }],
      platform_results: [{ platform: 'tiktok', status: 'scheduled', kind: 'Video' }, { platform: 'instagram', status: 'scheduled', kind: 'Reel' }],
    })])
    expect(outcomes.tiktok.status).toBe('published')
    expect(outcomes.instagram.status).toBe('published')
  })

  it('a network still going out keeps the post booked', () => {
    const { outcomes, platforms } = postNetworkOutcomes([bj({
      id: 'a', status: 'scheduled', targets: [{ platform: 'instagram' }, { platform: 'tiktok' }],
      platform_results: [{ platform: 'instagram', status: 'published', url: IG, kind: 'Reel' }, { platform: 'tiktok', status: 'pending', kind: 'Video' }],
    })])
    expect(outcomes.tiktok.status).toBe('scheduled')
    expect(outcomeAction(outcomes, platforms)).toBeNull()
  })

  it('a re-send speaks for its one network over its parent\'s failure; a cancelled re-send says nothing', () => {
    const parent = bj({
      id: 'p', status: 'failed', targets: [{ platform: 'instagram' }, { platform: 'linkedin' }],
      platform_results: [
        { platform: 'instagram', status: 'published', url: IG, kind: 'Feed post' },
        { platform: 'linkedin', status: 'failed', reason: 'Publishing timed out during platform API call', kind: 'Feed post' },
      ],
    })
    const queued = bj({ id: 'c', resend_of: 'p', status: 'queued', targets: [{ platform: 'linkedin' }], created_at: '2026-09-29T00:05:00.000Z' })
    expect(outcomeAction(...args(postNetworkOutcomes([parent, queued])))).toBeNull()
    const out = bj({ ...queued, status: 'published', platform_results: [{ platform: 'linkedin', status: 'published', url: LI, kind: 'Feed post' }] })
    const posted = postNetworkOutcomes([out, parent])
    expect(outcomeAction(...args(posted))).toBe('record_posted')
    expect(posted.outcomes.linkedin.url).toBe(LI)
    const dropped = bj({ ...queued, status: 'cancelled' })
    expect(outcomeAction(...args(postNetworkOutcomes([parent, dropped])))).toBe('record_partial')
  })

  it('a network already live is never taken back by a later word about it (24 Sep 2026)', () => {
    const first = bj({ id: 'a', status: 'published', platform_results: [{ platform: 'instagram', status: 'published', url: IG, kind: 'Reel' }] })
    const later = bj({ id: 'b', status: 'failed', created_at: '2026-09-29T01:00:00.000Z', platform_results: [{ platform: 'instagram', status: 'failed', reason: 'stale', kind: 'Reel' }] })
    expect(postNetworkOutcomes([first, later]).outcomes.instagram).toMatchObject({ status: 'published', url: IG })
  })

  it('a job the provider dropped is lost on every network (T18); one we cancelled says nothing', () => {
    const gone = bj({ id: 'a', status: 'cancelled', targets: [{ platform: 'instagram' }, { platform: 'linkedin' }] })
    const lost = postNetworkOutcomes([gone], { lost: new Set(['a']) })
    expect(lost.outcomes.instagram).toMatchObject({ status: 'failed', error: LOST_AT_PROVIDER })
    expect(outcomeAction(...args(lost))).toBe('record_failed')
    expect(postNetworkOutcomes([gone]).outcomes).toEqual({})
  })

  it('a draft handed to the creator is not live anywhere', () => {
    const { outcomes } = postNetworkOutcomes([bj({ id: 'a', status: 'published', targets: [{ platform: 'tiktok', options: { tiktokDraft: true } }], platform_results: [{ platform: 'tiktok', status: 'published', kind: 'Draft, handed to the creator' }] })])
    expect(outcomes.tiktok.status).toBe('scheduled')
  })

  it('the same news twice is the same', () => {
    const a = postNetworkOutcomes([bj({ id: 'a', platform_results: [{ platform: 'instagram', status: 'published', url: IG, kind: 'Reel' }] })]).outcomes
    expect(sameOutcomes(a, { ...a })).toBe(true)
    expect(sameOutcomes(a, { instagram: { ...a.instagram, url: null } })).toBe(false)
  })
})

const args = (r: ReturnType<typeof postNetworkOutcomes>) => [r.outcomes, r.platforms] as const

describe('a link belongs to one network (audit L1)', () => {
  it('reads the network off the host', () => {
    expect(networkOfUrl(IG)).toBe('instagram')
    expect(networkOfUrl(LI)).toBe('linkedin')
    expect(networkOfUrl('https://youtu.be/abc')).toBe('youtube')
    expect(networkOfUrl('https://x.com/a/status/1')).toBe('twitter')
    expect(networkOfUrl('https://example.com/x')).toBeNull()
  })

  it('never lets one network\'s link stand for another', () => {
    expect(urlBelongsTo('linkedin', IG)).toBe(false)
    expect(urlBelongsTo('instagram', IG)).toBe(true)
    // an unknown host is kept only when the job went to that one network
    expect(urlBelongsTo('instagram', 'https://short.example/1')).toBe(false)
    expect(urlBelongsTo('instagram', 'https://short.example/1', true)).toBe(true)
  })

  it('a job\'s one permalink lands only on its own network (the 054e0959 case)', () => {
    const { outcomes } = postNetworkOutcomes([bj({ id: 'a', status: 'published', permalink: LI, targets: [{ platform: 'linkedin' }, { platform: 'instagram' }] })])
    expect(outcomes.linkedin.url).toBe(LI)
    expect(outcomes.instagram.url).toBeNull()
  })
})

describe('each network\'s own schedule row (audit V16, L1, L2, L8)', () => {
  const r = [
    { id: 'ig', platform: 'instagram', scheduled_at: '2026-09-22T08:34:06.642Z', live_url: null, publish_status: 'scheduled' },
    { id: 'li', platform: 'linkedin', scheduled_at: null, live_url: TT, publish_status: 'scheduled' },
  ]
  it('marks only the network that went out, with its own link, and never the one that failed', () => {
    const w = scheduleRowWrites(ITEM, {
      instagram: { status: 'published', url: IG, at: '2026-09-29T09:01:00.000Z', error: null },
      linkedin: { status: 'failed', url: null, at: null, error: 'too large' },
    }, r, '2026-09-29T09:00:00.000Z')
    expect(w).toEqual([{ kind: 'update', id: 'ig', patch: { publish_status: 'published', published_at: '2026-09-29T09:01:00.000Z', live_url: IG } }])
  })

  it('replaces another network\'s link, and fills a row that has none', () => {
    const w = scheduleRowWrites(ITEM, { linkedin: { status: 'published', url: LI, at: 'T', error: null } }, r, 'B')
    expect(w).toEqual([{ kind: 'update', id: 'li', patch: { publish_status: 'published', published_at: 'T', live_url: LI, scheduled_at: 'B' } }])
    const gone = scheduleRowWrites(ITEM, { linkedin: { status: 'published', url: null, at: 'T', error: null } }, r, null)
    expect(gone[0]).toMatchObject({ patch: { live_url: null } })
  })

  it('a booked network carries THIS booking\'s time, not a cancelled job\'s (48f70493)', () => {
    const w = scheduleRowWrites(ITEM, { instagram: { status: 'scheduled', url: null, at: null, error: null } }, r, '2026-09-22T09:45:00.000Z')
    expect(w).toEqual([{ kind: 'update', id: 'ig', patch: { scheduled_at: '2026-09-22T09:45:00.000Z' } }])
  })

  it('makes the row a network never had', () => {
    const w = scheduleRowWrites(ITEM, { tiktok: { status: 'published', url: TT, at: 'T', error: null } }, r, 'B')
    expect(w).toEqual([{ kind: 'insert', row: { item_id: ITEM, platform: 'tiktok', publish_status: 'published', published_at: 'T', live_url: TT, scheduled_at: 'B' } }])
  })

  it('writes nothing when nothing changed', () => {
    const done = [{ id: 'ig', platform: 'instagram', scheduled_at: 'B', live_url: IG, publish_status: 'published', published_at: 'T' }]
    expect(scheduleRowWrites(ITEM, { instagram: { status: 'published', url: IG, at: 'T', error: null } }, done, 'B')).toEqual([])
  })
})

describe('the time handed to the provider (decision 11)', () => {
  const now = new Date('2026-09-29T09:00:00.000Z')
  it('a time ahead is held by the provider until then', () => {
    expect(providerTiming({ scheduled_for: '2026-09-29T10:00:00.000Z' }, now)).toEqual({ send: 'at', at: '2026-09-29T10:00:00.000Z' })
  })
  it('no time is Post now', () => {
    expect(providerTiming({ scheduled_for: null }, now)).toEqual({ send: 'now' })
  })
  it('a few minutes gone (a copy was being made) goes now — never the past time itself', () => {
    expect(providerTiming({ scheduled_for: new Date(now.getTime() - LATE_SEND_GRACE_MS + 1000).toISOString() }, now)).toEqual({ send: 'now' })
  })
  it('long gone is not sent at all', () => {
    expect(providerTiming({ scheduled_for: '2026-09-29T07:00:00.000Z' }, now)).toEqual({ send: 'refuse', reason: TIME_PASSED_UNSENT })
  })
  it('a re-send is the app\'s own prompt retry and goes now', () => {
    expect(providerTiming({ scheduled_for: '2026-09-29T07:00:00.000Z', resend_of: 'p' }, now)).toEqual({ send: 'now' })
  })
})

describe('the door asks the post', () => {
  const ok = { stage: 'booked', client_id: 'c', sent_version: 2, approval: { version: 2 } }
  it('lets a booked post approved at its version through', () => {
    expect(publishDoorRefusal({ contentItemId: 'i', postId: 'p', clientId: 'c' }, ok)).toBeNull()
  })
  it('refuses the card alone, and every post that is not booked and approved', () => {
    expect(publishDoorRefusal({ contentItemId: 'i' }, null)).toBe(BOOK_FROM_THE_POST)
    expect(publishDoorRefusal({ postId: 'p' }, { ...ok, stage: 'ready' })).toMatch(/not booked/)
    expect(publishDoorRefusal({ postId: 'p' }, { ...ok, approval: { version: 1 } })).toMatch(/not approved/)
    expect(publishDoorRefusal({ postId: 'p', clientId: 'x' }, ok)).toMatch(/another client/)
  })
})

describe('the card lines read the post\'s stage and booking', () => {
  const jobs = new Map([['j1', { status: 'scheduled', scheduled_for: '2026-09-29T09:00:00.000Z', targets: [{ platform: 'instagram' }] }]])
  it('a booked post is "Booked on …" from its booking\'s jobs', () => {
    const line = cardBookingLine([{ stage: 'booked', booking: { job_ids: ['j1'] } }], jobs as never, null, () => 'Tue 9:00')
    expect(line).toBe('Booked on Instagram · Tue 9:00')
  })
  it('a draft or a cancelled post says nothing, whatever its legacy status', () => {
    expect(cardBookingLine([{ stage: 'cancelled', status: 'scheduled', publish_job_ids: ['j1'] }], jobs as never, null, () => '')).toBeNull()
  })
  it('a file of a posted post is out', () => {
    const b = fileBooking('u', [{ stage: 'posted', slides: [{ url: 'u' }], booking: { job_ids: [] } }], new Map())
    expect(b?.status).toBe('published')
  })
})

/* ═════════════════════════ the server half ═══════════════════════════════ */

describe('a partial job (SPEC §8.2): posted, with a problem naming the network', () => {
  it('Instagram out, LinkedIn refused → Posted, "Did not go out on LinkedIn.", each row its own', async () => {
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job()], schedule_entries: rows() })
    answer = {
      kind: 'published', postId: 'prov-1',
      platforms: [
        { platform: 'instagram', status: 'published', platformPostUrl: IG },
        { platform: 'linkedin', status: 'failed', errorMessage: 'The document is too large' },
      ],
    }
    expect(await runPublishJob('j1')).toBe('failed')

    const p = post()
    expect(p.stage).toBe('posted')
    expect(p.problem).toBe('Did not go out on LinkedIn.')
    expect(p.outcomes.instagram).toMatchObject({ status: 'published', url: IG })
    expect(p.outcomes.linkedin).toMatchObject({ status: 'failed', url: null })
    expect(writes.map(w => w.action)).toEqual(['record_partial'])
    // the Instagram row: published, Instagram's link, never the booked-over time's leftovers
    expect(entry('se-ig')).toMatchObject({ publish_status: 'published', live_url: IG })
    // the LinkedIn row: not published, and not holding anyone else's link
    expect(entry('se-li').publish_status).toBe('scheduled')
    expect(entry('se-li').live_url).toBe(TT) // left as it was — it is not marked published; P8 clears the old wrong link
  })

  it('T21 then offers a new post limited to the network that did not go out', () => {
    const p: PostState = readPostState(bookedPost({
      stage: 'posted',
      outcomes: {
        instagram: { status: 'published', url: IG, at: 'T', error: null },
        linkedin: { status: 'failed', url: null, at: 'T', error: 'too large' },
      },
    }) as never)!
    const plan = planPostTransition(p, 'missing_networks', { id: 's-1', hats: ['scheduler'] }, {}, { now: new Date() })
    expect(plan.ok && plan.effects).toEqual([{ when: 'after', kind: 'create_post', stage: 'ready', platforms: ['linkedin'], carry_approval: true }])
  })
})

describe('every network out → Posted (T16), each with its own link (audit L1)', () => {
  it('two networks, two links, two rows', async () => {
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job()], schedule_entries: rows() })
    answer = {
      kind: 'published', postId: 'prov-1',
      platforms: [{ platform: 'instagram', status: 'published', platformPostUrl: IG }, { platform: 'linkedin', status: 'published', platformPostUrl: LI }],
    }
    expect(await runPublishJob('j1')).toBe('published')
    expect(post()).toMatchObject({ stage: 'posted', problem: null })
    expect(entry('se-ig')).toMatchObject({ publish_status: 'published', live_url: IG })
    expect(entry('se-li')).toMatchObject({ publish_status: 'published', live_url: LI })
  })

  it('a duplicate answer is Posted too (audit S5)', async () => {
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job({ targets: [{ platform: 'instagram', accountId: 'acc-ig' }] })] })
    answer = { kind: 'duplicate', postId: 'prov-1' }
    expect(await runPublishJob('j1')).toBe('duplicate')
    expect(post().stage).toBe('posted')
    expect(post().outcomes.instagram.status).toBe('duplicate')
  })

  it('the same news twice writes once', async () => {
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job({ targets: [{ platform: 'instagram', accountId: 'acc-ig' }] })] })
    await runPublishJob('j1')
    const rev = post().rev
    const again = await recordPostOutcome('j1')
    expect(again.posts[0]).toMatchObject({ wrote: false, stage: 'posted', note: 'nothing new' })
    expect(post().rev).toBe(rev)
  })
})

describe('nothing out → back to Ready to post (T18)', () => {
  it('a refusal on every network clears the booking and says why', async () => {
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job()] })
    answer = { kind: 'permanent', message: 'Token expired' }
    expect(await runPublishJob('j1')).toBe('failed')
    expect(post()).toMatchObject({ stage: 'ready', booking: null, problem: 'Did not go out on Instagram and LinkedIn.' })
  })

  it('a job the provider dropped is lost (the webhook passes lost)', async () => {
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job({ status: 'cancelled' })] })
    await recordPostOutcome('j1', { lost: true })
    expect(post().stage).toBe('ready')
    expect(post().outcomes.instagram.error).toBe(LOST_AT_PROVIDER)
  })

  it('a job we cancelled ourselves is not a loss: the post is left alone', async () => {
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job({ status: 'cancelled' })] })
    const r = await recordPostOutcome('j1')
    expect(r.posts[0]).toMatchObject({ action: null, wrote: false })
    expect(post().stage).toBe('booked')
  })
})

describe('never a past time to the provider (decision 11)', () => {
  it('a booking whose time is long gone is not sent, and the post comes back to be re-timed', async () => {
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job({ scheduled_for: new Date(Date.now() - 2 * 3600_000).toISOString() })] })
    expect(await runPublishJob('j1')).toBe('failed')
    expect(created).toEqual([])                                   // the provider never heard of it
    expect(post().stage).toBe('ready')
    expect(post().outcomes.instagram.error).toBe(TIME_PASSED_UNSENT)
  })

  it('a few minutes late goes as "now", never with the passed time', async () => {
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job({ scheduled_for: new Date(Date.now() - 5 * 60_000).toISOString() })] })
    await runPublishJob('j1')
    expect(created).toEqual([{ scheduledFor: null, requestId: 'req-j1' }])
  })

  it('a time ahead is handed over, and the post stays Booked in', async () => {
    const when = inAnHour()
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job({ scheduled_for: when })] })
    expect(await runPublishJob('j1')).toBe('scheduled')
    expect(created[0].scheduledFor).toBe(new Date(when).toISOString())
    expect(post().stage).toBe('booked')
  })

  it('five failed tries are written down as not posted, not left queued for ever', async () => {
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job({ attempts: 4 })] })
    answer = { kind: 'retryable', message: 'Gateway timeout' }
    expect(await runPublishJob('j1')).toBe('failed')
    expect(post().stage).toBe('ready')
  })
})

describe('a re-send is linked to its post and speaks for its network (audit V11)', () => {
  it('the timed-out network is re-sent, linked, the post waits for it, then Posted', async () => {
    const parent = job({
      status: 'failed', scheduled_for: new Date(Date.now() - 60_000).toISOString(),
      platform_results: [
        { platform: 'instagram', status: 'published', url: IG, kind: 'Feed post' },
        { platform: 'linkedin', status: 'failed', reason: 'Publishing timed out during platform API call', kind: 'Feed post' },
      ],
    })
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [parent], schedule_entries: rows() })
    const made = await resendTimedOut(parent as never, readPlatformResults((parent as unknown as { platform_results: unknown }).platform_results)!)
    expect(made).toHaveLength(1)
    await recordPostOutcome('j1')
    // linked into the booking, so a cancel sees it — and still booked while it goes
    expect(post().booking?.job_ids).toEqual(['j1', made[0]])
    expect(post().stage).toBe('booked')
    expect(entry('se-ig')).toMatchObject({ publish_status: 'published', live_url: IG })

    answer = { kind: 'published', postId: 'prov-2', platforms: [{ platform: 'linkedin', status: 'published', platformPostUrl: LI }] }
    expect(await runPublishJob(made[0])).toBe('published')
    expect(post()).toMatchObject({ stage: 'posted', problem: null })
    expect(post().outcomes.linkedin).toMatchObject({ status: 'published', url: LI })
    expect(entry('se-li')).toMatchObject({ publish_status: 'published', live_url: LI })
  })
})

describe('the ten-minute backstop', () => {
  it('a booked post whose job settled with nobody telling it is recorded by the sweep', async () => {
    fake = seedDb({
      social_posts: [bookedPost()],
      publish_jobs: [job({ status: 'published', platform_results: [
        { platform: 'instagram', status: 'published', url: IG, kind: 'Feed post' },
        { platform: 'linkedin', status: 'published', url: LI, kind: 'Feed post' },
      ] })],
    })
    expect(await recordBookedOutcomes()).toBe(1)
    expect(post().stage).toBe('posted')
    expect(await recordBookedOutcomes()).toBe(0)
  })
})

describe('a post the migration has not reached (no stage)', () => {
  it('is not moved, but each network\'s row gets its own link — not one link on all', async () => {
    fake = seedDb({
      social_posts: [bookedPost({ stage: null, status: 'scheduled', publish_job_ids: ['j1'], booking: null })],
      publish_jobs: [job({ status: 'published', permalink: LI, targets: [{ platform: 'linkedin' }, { platform: 'instagram' }] })],
      schedule_entries: rows(),
    })
    const r = await recordPostOutcome('j1')
    expect(writes).toEqual([])
    expect(r.posts).toEqual([])
    expect(entry('se-li')).toMatchObject({ publish_status: 'published', live_url: LI })
    // Instagram's row: published by the job, but never LinkedIn's link (054e0959 / c8fd52cf)
    expect(entry('se-ig').live_url ?? null).toBeNull()
  })
})

describe('posted by hand', () => {
  it('only the named network\'s row, only its own link', async () => {
    fake = seedDb({ schedule_entries: rows() })
    await recordPublishOnItem(ITEM, IG, ['instagram'])
    expect(entry('se-ig')).toMatchObject({ publish_status: 'published', live_url: IG })
    expect(entry('se-li')).toMatchObject({ publish_status: 'scheduled' })
  })
})

describe('source pins', () => {
  const owned = ['app/lib/publish.ts', 'app/lib/production-publish.ts', 'app/lib/zernio-webhook.ts', 'app/lib/post-analytics.ts']
  it('the recorder never writes a post itself — only through the one writer (SPEC §8.3)', () => {
    for (const f of owned) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/table(<[^>]*>)?\('social_posts'\)\s*\.\s*(update|insert|upsert|claim|remove|compareAndSet)/)
      expect(src, f).not.toMatch(/postsTable\(\)\s*\.\s*(update|insert|upsert|claim|remove)/)
    }
  })
  it('no provider hand-over passes the job\'s own stored time straight through', () => {
    expect(readFileSync('app/lib/publish.ts', 'utf8')).not.toContain('scheduledFor: job.scheduled_for,')
  })
  it('the item-wide approval gate is gone from the publisher', () => {
    for (const f of ['app/lib/publish.ts', 'app/lib/production-publish.ts']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/posting-approval|posting_approval_state/)
    }
  })
})
