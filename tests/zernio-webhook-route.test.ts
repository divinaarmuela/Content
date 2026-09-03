import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signZernioBody } from '../app/lib/zernio-webhook-core'
import { seedDb } from './helpers/fake-db'

/**
 * The webhook route, against an in-memory Realtime Database.
 *
 * The database is the real `@/lib/db` running on a fake of the RTDB REST
 * surface, so every read, filter and write in this feature happens for real —
 * because every idempotency claim here rests on "the second delivery finds the
 * event id already claimed" or "the job is no longer in the state that would
 * let it change". A stub that just returned a row would prove neither.
 */

const SECRET = 'test-webhook-secret'

type Row = Record<string, unknown>

const recordPublishOnItem = vi.fn(async () => {})
const syncSocialAccounts = vi.fn(async () => 1)
const notify = vi.fn(async (_input: Record<string, unknown>) => 'sent' as const)
const send = vi.fn(async () => ({ ids: [] }))

vi.mock('../app/lib/production-publish', () => ({ recordPublishOnItem }))
vi.mock('../app/lib/publish', () => ({ syncSocialAccounts }))
vi.mock('../app/lib/mailer', () => ({ notify }))
vi.mock('@/app/inngest/client', () => ({ inngest: { send } }))

const { POST } = await import('../app/api/zernio/webhook/route')
const { forgetWebhookSecrets } = await import('../app/lib/zernio-webhook')

let seed: Record<string, Row[]>
let fake: ReturnType<typeof seedDb> | null = null

/** Seed the database. Called lazily so a test can adjust the fixture first. */
function start() {
  if (!fake) fake = seedDb(seed as never)
  return fake
}
const rows = (table: string) => start().rows(table as never) as Row[]
const job = () => rows('publish_jobs')[0]

/** A signed delivery, exactly as Zernio would send it. */
async function deliver(payload: unknown, opts: { secret?: string; sign?: boolean } = {}) {
  start()
  const raw = JSON.stringify(payload)
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.sign !== false) {
    headers['x-zernio-signature'] = signZernioBody(raw, opts.secret ?? SECRET)
  }
  const res = await POST(new Request('https://app.mdmmarketing.com.au/api/zernio/webhook', {
    method: 'POST', headers, body: raw,
  }))
  return { res, json: await res.json() as Record<string, unknown> }
}

const published = (postId: string, id = 'evt_1') => ({
  id,
  event: 'post.published',
  data: {
    post: {
      _id: postId,
      status: 'published',
      platforms: [{
        platform: 'instagram', status: 'published',
        platformPostUrl: 'https://instagram.com/p/abc',
      }],
    },
  },
})

beforeEach(() => {
  process.env.ZERNIO_WEBHOOK_SECRET = SECRET
  forgetWebhookSecrets()
  for (const fn of [recordPublishOnItem, syncSocialAccounts, notify, send]) fn.mockClear()
  fake = null
  seed = {
    publish_jobs: [{
      id: 'job-1',
      status: 'scheduled',
      client_id: 'client-1',
      provider_post_id: 'post_1',
      content_item_id: 'item-1',
      targets: [{ platform: 'instagram' }],
      permalink: null,
      published_at: null,
      error: null,
    }],
    provider_webhooks: [],
    social_accounts: [{
      id: 'sa-1', provider_account_id: 'acc_1', client_id: 'client-1',
      platform: 'instagram', active: true,
    }],
    clients: [{ id: 'client-1', name: 'Releeph', social_profile_id: 'prof_1' }],
    schedule_entries: [
      { id: 'se-1', item_id: 'item-1', platform: 'instagram', live_url: null },
      { id: 'se-2', item_id: 'item-1', platform: 'linkedin', live_url: null },
    ],
    post_analytics: [{ id: 'pa-1', provider_post_id: 'post_1', platform_post_url: null }],
    content_assets: [],
    webhook_deliveries: [],
    workflow_activity: [],
    team_user_clients: [],
    team_users: [{ id: 'u-1', email: 'am@example.invalid', name: 'Amy', role: 'super_admin', active_status: true }],
  }
})

afterEach(() => {
  forgetWebhookSecrets()
  fake?.restore()
  fake = null
})

describe('POST /api/zernio/webhook — publishing', () => {
  it('marks the job published and walks the item scheduled → published', async () => {
    const { res, json } = await deliver(published('post_1'))

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, published: 'job-1' })

    expect(job().status).toBe('published')
    expect(job().permalink).toBe('https://instagram.com/p/abc')
    expect(job().published_at).toEqual(expect.any(String))

    expect(recordPublishOnItem).toHaveBeenCalledWith(
      'item-1', 'https://instagram.com/p/abc', ['instagram'],
    )
  })

  it('asks for the first analytics read ten minutes later, once', async () => {
    await deliver(published('post_1'))
    expect(send).toHaveBeenCalledWith({
      name: 'app/social.post.published', data: { providerPostId: 'post_1' },
    })
    // the sleep itself lives in the Inngest function; the webhook only asks
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('is idempotent: a redelivery of the same event does nothing', async () => {
    await deliver(published('post_1'))
    expect(recordPublishOnItem).toHaveBeenCalledTimes(1)
    const after = { ...job() }

    // Zernio is at-least-once and retries for ~51 hours — this WILL happen
    const { res, json } = await deliver(published('post_1'))

    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true, duplicate: true })
    expect(recordPublishOnItem).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(job()).toEqual(after)
    // one row, not two — the event id is the claim
    expect(rows('webhook_deliveries')).toHaveLength(1)
  })

  it('records every delivery it acts on, so the card can say when', async () => {
    await deliver(published('post_1'))
    expect(rows('webhook_deliveries')[0]).toMatchObject({
      provider: 'zernio', event: 'post.published', provider_event_id: 'evt_1', handled: true,
    })
  })

  it('does not transition an item for a post it has never heard of', async () => {
    const { res, json } = await deliver(published('post_unknown'))
    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true, duplicate: true })
    expect(recordPublishOnItem).not.toHaveBeenCalled()
    expect(job().status).toBe('scheduled')
  })

  it('records a failure and leaves the content item alone', async () => {
    const { res, json } = await deliver({
      id: 'evt_2',
      event: 'post.failed',
      data: {
        post: {
          _id: 'post_1',
          platforms: [{ platform: 'instagram', status: 'failed', errorMessage: 'Token expired' }],
        },
      },
    })

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, failed: 'job-1' })
    expect(job()).toMatchObject({ status: 'failed', error: 'Token expired' })
    // the item stays Scheduled — it is booked, it just did not go out
    expect(recordPublishOnItem).not.toHaveBeenCalled()

    const again = await deliver({ id: 'evt_2', event: 'post.failed', data: { post: { _id: 'post_1' } } })
    expect(again.json).toEqual({ ok: true, duplicate: true })
  })

  it('never lets a published job be flipped back by a late failure', async () => {
    await deliver(published('post_1'))
    await deliver({ id: 'evt_3', event: 'post.failed', data: { post: { _id: 'post_1' } } })
    expect(job().status).toBe('published')
  })
})

describe('POST /api/zernio/webhook — per-platform results', () => {
  const platformPublished = (id = 'evt_pp', platform = 'instagram') => ({
    id,
    event: 'post.platform.published',
    data: {
      post: { id: 'post_1', status: 'publishing', platforms: [] },
      platform: {
        name: platform, status: 'published',
        platformPostId: '17900', publishedUrl: `https://${platform}/p/abc`,
      },
      account: { accountId: 'acc_1', platform, username: 'client' },
    },
  })

  it('writes the live URL onto the job, the schedule row and the analytics row', async () => {
    const { json } = await deliver(platformPublished())
    expect(json).toMatchObject({ ok: true, platform: 'instagram', linked: true })

    expect(job().permalink).toBe('https://instagram/p/abc')
    expect(rows('post_analytics')[0].platform_post_url).toBe('https://instagram/p/abc')
    // the INSTAGRAM row only — the LinkedIn target has its own link coming
    const entries = rows('schedule_entries')
    expect(entries.find(e => e.id === 'se-1')!.live_url).toBe('https://instagram/p/abc')
    expect(entries.find(e => e.id === 'se-2')!.live_url ?? null).toBeNull()
  })

  it('does not settle the job — the post-level rollup owns that', async () => {
    await deliver(platformPublished())
    expect(job().status).toBe('scheduled')
    expect(recordPublishOnItem).not.toHaveBeenCalled()
  })

  it('never overwrites a link somebody set by hand', async () => {
    seed.publish_jobs[0].permalink = 'https://instagram.com/p/typed-by-a-human'
    seed.schedule_entries[0].live_url = 'https://instagram.com/p/typed-by-a-human'

    await deliver(platformPublished())

    expect(job().permalink).toBe('https://instagram.com/p/typed-by-a-human')
    expect(rows('schedule_entries').find(e => e.id === 'se-1')!.live_url)
      .toBe('https://instagram.com/p/typed-by-a-human')
  })

  it('back-fills a TikTok URL that arrived minutes after the post did', async () => {
    seed.publish_jobs[0].status = 'published'
    const { json } = await deliver({
      id: 'evt_tt',
      event: 'post.tiktok.url_resolved',
      data: {
        post: { id: 'post_1', status: 'published', platforms: [] },
        platform: { name: 'instagram', status: 'published', publishedUrl: 'https://tiktok/v/1' },
        account: { accountId: 'acc_1', platform: 'tiktok', username: 'c' },
      },
    })
    expect(json).toMatchObject({ ok: true, linked: true })
    expect(job().permalink).toBe('https://tiktok/v/1')
    // a back-fill changes no status, ever
    expect(job().status).toBe('published')
  })

  it('fails the job with the platform’s own words', async () => {
    const { json } = await deliver({
      id: 'evt_pf',
      event: 'post.platform.failed',
      data: {
        post: { id: 'post_1', platforms: [] },
        platform: { name: 'linkedin', status: 'failed', error: 'Document too large' },
        account: { accountId: 'acc_1', platform: 'linkedin', username: 'c' },
      },
    })
    expect(json).toMatchObject({ ok: true, failed: true })
    expect(job()).toMatchObject({
      status: 'failed', error: 'linkedin: Document too large',
    })
  })
})

describe('POST /api/zernio/webhook — cancellation and scheduling', () => {
  it('cancels the job, leaves the item scheduled, and notes why', async () => {
    const { json } = await deliver({ id: 'evt_x', event: 'post.cancelled', data: { post: { id: 'post_1' } } })

    expect(json).toMatchObject({ ok: true, cancelled: true })
    expect(job().status).toBe('cancelled')
    expect(String(job().error)).toContain('nothing was posted')
    // the item itself is untouched: it is still booked
    expect(recordPublishOnItem).not.toHaveBeenCalled()
    expect(rows('workflow_activity')[0]).toMatchObject({
      entity_type: 'content_item', entity_id: 'item-1', action: 'publish_cancelled',
    })
  })

  it('will not cancel a post that already went out', async () => {
    seed.publish_jobs[0].status = 'published'
    const { json } = await deliver({ id: 'evt_x', event: 'post.cancelled', data: { post: { id: 'post_1' } } })
    expect(json).toMatchObject({ cancelled: false })
    expect(job().status).toBe('published')
  })

  it('treats post.scheduled as confirmation and changes nothing', async () => {
    start()
    // a Realtime Database stores no nulls, so an untouched row loses its
    // null-valued fields the moment any write prunes the tree; the fields that
    // carry meaning are what must not move
    const drop = (r: Row) => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null))
    const before = drop(job())
    const { json } = await deliver({
      id: 'evt_s', event: 'post.scheduled',
      data: { post: { id: 'post_1', scheduledFor: '2026-08-28T09:00:00Z' } },
    })
    expect(json).toMatchObject({ ok: true, known: true })
    expect(drop(job())).toEqual(before)
  })
})

describe('POST /api/zernio/webhook — accounts', () => {
  it('re-syncs the client’s channels the moment an account connects', async () => {
    const { json } = await deliver({
      id: 'evt_ac',
      event: 'account.connected',
      data: { account: { accountId: 'acc_new', profileId: 'prof_1', platform: 'instagram', username: 'c' } },
    })
    expect(json).toMatchObject({ ok: true, resynced: true })
    expect(syncSocialAccounts).toHaveBeenCalledWith('client-1', 'prof_1')
  })

  it('acknowledges a connect for a profile no client holds, without failing', async () => {
    const { res, json } = await deliver({
      id: 'evt_ac2',
      event: 'account.connected',
      data: { account: { accountId: 'acc_other', profileId: 'prof_unknown' } },
    })
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ resynced: false })
    expect(syncSocialAccounts).not.toHaveBeenCalled()
  })

  it('still deactivates a disconnected account', async () => {
    const { json } = await deliver({ event: 'account.disconnected', data: { accountId: 'acc_1' } })
    expect(json).toMatchObject({ ok: true, marked: 'acc_1' })
    expect(rows('social_accounts')[0].active).toBe(false)
  })
})

describe('POST /api/zernio/webhook — inbox, reviews and leads', () => {
  it('logs a comment so the Inbox can refresh, and runs no automation of its own', async () => {
    const { res, json } = await deliver({
      id: 'evt_c',
      event: 'comment.received',
      data: {
        comment: { id: 'cmt_1', platformPostId: '1790', platform: 'instagram', text: 'LINK' },
        post: { id: 'post_1', platformPostId: '1790' },
        account: { id: 'acc_1', accountId: 'acc_1', platform: 'instagram', username: 'c' },
      },
    })
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, comment: 'cmt_1' })
    expect(rows('webhook_deliveries')[0]).toMatchObject({ event: 'comment.received', handled: true })
    // the comment→DM automation runs inside Zernio; we must not send a second DM
    expect(notify).not.toHaveBeenCalled()
  })

  it('logs every inbox event under its own name', async () => {
    await deliver({
      id: 'evt_m', event: 'message.received',
      data: {
        message: { id: 'm', conversationId: 'conv_1', platform: 'instagram' },
        conversation: { id: 'conv_1', status: 'active' },
        account: { id: 'acc_1', accountId: 'acc_1', platform: 'instagram', username: 'c' },
      },
    })
    expect(rows('webhook_deliveries')[0]).toMatchObject({ event: 'message.received', handled: true })
  })

  it('tells the client’s account manager about a review, in-app only', async () => {
    seed.team_user_clients = [{ id: 'u-1__client-1', team_user_id: 'u-1', client_id: 'client-1' }]
    const { json } = await deliver({
      id: 'evt_r',
      event: 'review.new',
      data: {
        review: { id: 'rev_1', platform: 'googlebusiness', rating: 5, text: 'Great work' },
        account: { id: 'acc_1', accountId: 'acc_1', platform: 'googlebusiness', username: 'c' },
      },
    })
    expect(json).toMatchObject({ ok: true, notified: true })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify.mock.calls[0][0]).toMatchObject({
      eventType: 'social.review.new',
      entityId: 'rev_1',
      recipientEmail: 'am@example.invalid',
      bellOnly: true,
    })
  })

  it('tells the account manager about a lead without touching the leads pipeline', async () => {
    seed.team_user_clients = [{ id: 'u-1__client-1', team_user_id: 'u-1', client_id: 'client-1' }]
    const { json } = await deliver({
      id: 'evt_l',
      event: 'lead.received',
      data: {
        lead: { id: 'lead_1', formName: 'Book a call', fields: { email: 'jane@example.invalid' } },
        account: { id: 'acc_1', accountId: 'acc_1', platform: 'facebook' },
      },
    })
    expect(json).toMatchObject({ ok: true, notified: true })
    expect(notify.mock.calls[0][0]).toMatchObject({
      eventType: 'social.lead.received', entityId: 'lead_1', bellOnly: true,
    })
    // the agency's OWN lead table is not a dumping ground for a client's ads
    expect(rows('leads')).toHaveLength(0)
  })
})

describe('POST /api/zernio/webhook — authentication and unknown events', () => {
  it('acknowledges an event it does not act on, so it is not redelivered for days', async () => {
    const { res, json } = await deliver({ id: 'evt_t', event: 'webhook.test', data: {} })
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true })
    expect(recordPublishOnItem).not.toHaveBeenCalled()
    // logged as arrived but NOT handled — which is the honest record of it
    expect(rows('webhook_deliveries')[0]).toMatchObject({ event: 'webhook.test', handled: false })
  })

  it('refuses a delivery signed with the wrong secret, and changes nothing', async () => {
    const { res } = await deliver(published('post_1'), { secret: 'not-our-secret' })
    expect(res.status).toBe(401)
    expect(job().status).toBe('scheduled')
    expect(recordPublishOnItem).not.toHaveBeenCalled()
    // an unauthorised delivery must not consume the event id either
    expect(rows('webhook_deliveries')).toHaveLength(0)
  })

  it('refuses an unsigned delivery', async () => {
    const { res } = await deliver(published('post_1'), { sign: false })
    expect(res.status).toBe(401)
    expect(job().status).toBe('scheduled')
  })

  it('refuses everything when no secret is configured at all', async () => {
    delete process.env.ZERNIO_WEBHOOK_SECRET
    forgetWebhookSecrets()
    const { res } = await deliver(published('post_1'))
    expect(res.status).toBe(503)
    expect(job().status).toBe('scheduled')
  })

  it('rejects a body that is not JSON', async () => {
    start()
    const raw = 'not json'
    const res = await POST(new Request('https://app.mdmmarketing.com.au/api/zernio/webhook', {
      method: 'POST',
      headers: { 'x-zernio-signature': signZernioBody(raw, SECRET) },
      body: raw,
    }))
    expect(res.status).toBe(400)
  })
})
