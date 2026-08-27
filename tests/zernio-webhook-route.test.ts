import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signZernioBody } from '../app/lib/zernio-webhook-core'

/**
 * The webhook route, against a miniature Postgres.
 *
 * The tables are emulated rather than stubbed — filters, conditional UPDATEs
 * and the unique index on `webhook_deliveries` are all applied for real —
 * because every idempotency claim in this feature rests on "the second
 * delivery matches zero rows" or "the second insert loses the unique index".
 * A stub that just returned a row would prove neither.
 */

const SECRET = 'test-webhook-secret'

type Row = Record<string, unknown>
type Filter =
  | ['eq' | 'is' | 'gt' | 'gte', string, unknown]
  | ['in', string, unknown[]]
type Verb = 'select' | 'update' | 'insert' | 'upsert' | 'delete'
type Op = {
  table: string
  verb: Verb
  patch: Row
  rows: Row[]
  filters: Filter[]
  conflict: string[]
  ignoreDuplicates: boolean
  head: boolean
  wantCount: boolean
  limit: number | null
  order: { column: string; ascending: boolean } | null
}

const tables: Record<string, Row[]> = {}
let nextId = 1

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every(f => {
    if (f[0] === 'eq') return row[f[1]] === f[2]
    if (f[0] === 'is') return row[f[1]] === f[2] || (f[2] === null && row[f[1]] == null)
    if (f[0] === 'gt') return String(row[f[1]] ?? '') > String(f[2])
    if (f[0] === 'gte') return String(row[f[1]] ?? '') >= String(f[2])
    return (f[2] as unknown[]).includes(row[f[1]])
  })
}

type Result = { data: Row[] | Row | null; error: { message: string } | null; count?: number }

function run(op: Op): Result {
  const rows = (tables[op.table] ??= [])

  if (op.verb === 'insert' || op.verb === 'upsert') {
    const written: Row[] = []
    for (const incoming of op.rows) {
      // the unique index, applied for real
      const clash = op.conflict.length > 0
        ? rows.find(r => op.conflict.every(c => r[c] === incoming[c]))
        : undefined
      if (clash) {
        // `ignoreDuplicates` → the conflict returns NO row, which is the whole
        // mechanism the delivery claim relies on
        if (op.ignoreDuplicates) continue
        Object.assign(clash, incoming)
        written.push(clash)
        continue
      }
      const row = { id: `row-${nextId++}`, ...incoming }
      rows.push(row)
      written.push(row)
    }
    return { data: written.map(r => ({ ...r })), error: null }
  }

  const hit = rows.filter(r => matches(r, op.filters))
  if (op.verb === 'update') for (const r of hit) Object.assign(r, op.patch)
  if (op.verb === 'delete') for (const r of hit) rows.splice(rows.indexOf(r), 1)

  let out = hit.map(r => ({ ...r }))
  if (op.order) {
    const { column, ascending } = op.order
    out.sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')))
    if (!ascending) out.reverse()
  }
  if (op.limit !== null) out = out.slice(0, op.limit)
  return { data: op.head ? null : out, error: null, ...(op.wantCount ? { count: hit.length } : {}) }
}

const supabase = {
  from(table: string) {
    const op: Op = {
      table, verb: 'select', patch: {}, rows: [], filters: [], conflict: [],
      ignoreDuplicates: false, head: false, wantCount: false, limit: null, order: null,
    }
    let single: 'one' | 'maybe' | null = null

    const settle = (): Result => {
      const r = run(op)
      if (single && Array.isArray(r.data)) {
        return { ...r, data: r.data[0] ?? null }
      }
      return r
    }

    const chain = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count) op.wantCount = true
        if (opts?.head) op.head = true
        return chain
      },
      insert: (rows: Row | Row[]) => {
        op.verb = 'insert'; op.rows = Array.isArray(rows) ? rows : [rows]; return chain
      },
      upsert: (rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        op.verb = 'upsert'
        op.rows = Array.isArray(rows) ? rows : [rows]
        op.conflict = (opts?.onConflict ?? '').split(',').map(s => s.trim()).filter(Boolean)
        op.ignoreDuplicates = opts?.ignoreDuplicates === true
        return chain
      },
      update: (patch: Row) => { op.verb = 'update'; op.patch = patch; return chain },
      delete: () => { op.verb = 'delete'; return chain },
      eq: (c: string, v: unknown) => { op.filters.push(['eq', c, v]); return chain },
      is: (c: string, v: unknown) => { op.filters.push(['is', c, v]); return chain },
      gt: (c: string, v: unknown) => { op.filters.push(['gt', c, v]); return chain },
      gte: (c: string, v: unknown) => { op.filters.push(['gte', c, v]); return chain },
      in: (c: string, v: unknown[]) => { op.filters.push(['in', c, v]); return chain },
      order: (column: string, opts?: { ascending?: boolean }) => {
        op.order = { column, ascending: opts?.ascending !== false }; return chain
      },
      limit: (n: number) => { op.limit = n; return chain },
      single: () => { single = 'one'; return chain },
      maybeSingle: () => { single = 'maybe'; return chain },
      then: (ok: (r: unknown) => unknown, no?: (e: unknown) => unknown) =>
        Promise.resolve(settle()).then(ok, no),
    }
    return chain
  },
}

const recordPublishOnItem = vi.fn(async () => {})
const syncSocialAccounts = vi.fn(async () => 1)
const notify = vi.fn(async (_input: Record<string, unknown>) => 'sent' as const)
const send = vi.fn(async () => ({ ids: [] }))

vi.mock('@/lib/supabase', () => ({ supabase }))
vi.mock('../app/lib/production-publish', () => ({ recordPublishOnItem }))
vi.mock('../app/lib/publish', () => ({ syncSocialAccounts }))
vi.mock('../app/lib/mailer', () => ({ notify }))
vi.mock('@/app/inngest/client', () => ({ inngest: { send } }))

const { POST } = await import('../app/api/zernio/webhook/route')
const { forgetWebhookSecrets } = await import('../app/lib/zernio-webhook')

/** A signed delivery, exactly as Zernio would send it. */
async function deliver(payload: unknown, opts: { secret?: string; sign?: boolean } = {}) {
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
  nextId = 1
  for (const key of Object.keys(tables)) delete tables[key]
  tables.publish_jobs = [{
    id: 'job-1',
    status: 'scheduled',
    client_id: 'client-1',
    provider_post_id: 'post_1',
    content_item_id: 'item-1',
    targets: [{ platform: 'instagram' }],
    permalink: null,
    published_at: null,
    error: null,
  }]
  tables.provider_webhooks = []
  tables.social_accounts = [{
    id: 'sa-1', provider_account_id: 'acc_1', client_id: 'client-1',
    platform: 'instagram', active: true,
  }]
  tables.clients = [{ id: 'client-1', name: 'Releeph', social_profile_id: 'prof_1' }]
  tables.schedule_entries = [
    { id: 'se-1', item_id: 'item-1', platform: 'instagram', live_url: null },
    { id: 'se-2', item_id: 'item-1', platform: 'linkedin', live_url: null },
  ]
  tables.post_analytics = [{ id: 'pa-1', provider_post_id: 'post_1', platform_post_url: null }]
  tables.content_assets = []
  tables.webhook_deliveries = []
  tables.workflow_activity = []
  tables.team_user_clients = []
  tables.team_users = [{ id: 'u-1', email: 'am@example.invalid', name: 'Amy', role: 'super_admin', active_status: true }]
})

afterEach(() => { forgetWebhookSecrets() })

describe('POST /api/zernio/webhook — publishing', () => {
  it('marks the job published and walks the item scheduled → published', async () => {
    const { res, json } = await deliver(published('post_1'))

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, published: 'job-1' })

    const job = tables.publish_jobs[0]
    expect(job.status).toBe('published')
    expect(job.permalink).toBe('https://instagram.com/p/abc')
    expect(job.published_at).toEqual(expect.any(String))

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
    const after = { ...tables.publish_jobs[0] }

    // Zernio is at-least-once and retries for ~51 hours — this WILL happen
    const { res, json } = await deliver(published('post_1'))

    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true, duplicate: true })
    expect(recordPublishOnItem).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(tables.publish_jobs[0]).toEqual(after)
    // one row, not two — the unique index is the claim
    expect(tables.webhook_deliveries).toHaveLength(1)
  })

  it('records every delivery it acts on, so the card can say when', async () => {
    await deliver(published('post_1'))
    expect(tables.webhook_deliveries[0]).toMatchObject({
      provider: 'zernio', event: 'post.published', provider_event_id: 'evt_1', handled: true,
    })
  })

  it('does not transition an item for a post it has never heard of', async () => {
    const { res, json } = await deliver(published('post_unknown'))
    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true, duplicate: true })
    expect(recordPublishOnItem).not.toHaveBeenCalled()
    expect(tables.publish_jobs[0].status).toBe('scheduled')
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
    expect(tables.publish_jobs[0]).toMatchObject({ status: 'failed', error: 'Token expired' })
    // the item stays Scheduled — it is booked, it just did not go out
    expect(recordPublishOnItem).not.toHaveBeenCalled()

    const again = await deliver({ id: 'evt_2', event: 'post.failed', data: { post: { _id: 'post_1' } } })
    expect(again.json).toEqual({ ok: true, duplicate: true })
  })

  it('never lets a published job be flipped back by a late failure', async () => {
    await deliver(published('post_1'))
    await deliver({ id: 'evt_3', event: 'post.failed', data: { post: { _id: 'post_1' } } })
    expect(tables.publish_jobs[0].status).toBe('published')
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

    expect(tables.publish_jobs[0].permalink).toBe('https://instagram/p/abc')
    expect(tables.post_analytics[0].platform_post_url).toBe('https://instagram/p/abc')
    // the INSTAGRAM row only — the LinkedIn target has its own link coming
    expect(tables.schedule_entries[0].live_url).toBe('https://instagram/p/abc')
    expect(tables.schedule_entries[1].live_url).toBeNull()
  })

  it('does not settle the job — the post-level rollup owns that', async () => {
    await deliver(platformPublished())
    expect(tables.publish_jobs[0].status).toBe('scheduled')
    expect(recordPublishOnItem).not.toHaveBeenCalled()
  })

  it('never overwrites a link somebody set by hand', async () => {
    tables.publish_jobs[0].permalink = 'https://instagram.com/p/typed-by-a-human'
    tables.schedule_entries[0].live_url = 'https://instagram.com/p/typed-by-a-human'

    await deliver(platformPublished())

    expect(tables.publish_jobs[0].permalink).toBe('https://instagram.com/p/typed-by-a-human')
    expect(tables.schedule_entries[0].live_url).toBe('https://instagram.com/p/typed-by-a-human')
  })

  it('back-fills a TikTok URL that arrived minutes after the post did', async () => {
    tables.publish_jobs[0].status = 'published'
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
    expect(tables.publish_jobs[0].permalink).toBe('https://tiktok/v/1')
    // a back-fill changes no status, ever
    expect(tables.publish_jobs[0].status).toBe('published')
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
    expect(tables.publish_jobs[0]).toMatchObject({
      status: 'failed', error: 'linkedin: Document too large',
    })
  })
})

describe('POST /api/zernio/webhook — cancellation and scheduling', () => {
  it('cancels the job, leaves the item scheduled, and notes why', async () => {
    const { json } = await deliver({ id: 'evt_x', event: 'post.cancelled', data: { post: { id: 'post_1' } } })

    expect(json).toMatchObject({ ok: true, cancelled: true })
    expect(tables.publish_jobs[0].status).toBe('cancelled')
    expect(String(tables.publish_jobs[0].error)).toContain('nothing was posted')
    // the item itself is untouched: it is still booked
    expect(recordPublishOnItem).not.toHaveBeenCalled()
    expect(tables.workflow_activity[0]).toMatchObject({
      entity_type: 'content_item', entity_id: 'item-1', action: 'publish_cancelled',
    })
  })

  it('will not cancel a post that already went out', async () => {
    tables.publish_jobs[0].status = 'published'
    const { json } = await deliver({ id: 'evt_x', event: 'post.cancelled', data: { post: { id: 'post_1' } } })
    expect(json).toMatchObject({ cancelled: false })
    expect(tables.publish_jobs[0].status).toBe('published')
  })

  it('treats post.scheduled as confirmation and changes nothing', async () => {
    const before = { ...tables.publish_jobs[0] }
    const { json } = await deliver({
      id: 'evt_s', event: 'post.scheduled',
      data: { post: { id: 'post_1', scheduledFor: '2026-08-28T09:00:00Z' } },
    })
    expect(json).toMatchObject({ ok: true, known: true })
    expect(tables.publish_jobs[0]).toEqual(before)
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
    expect(tables.social_accounts[0].active).toBe(false)
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
    expect(tables.webhook_deliveries[0]).toMatchObject({ event: 'comment.received', handled: true })
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
    expect(tables.webhook_deliveries[0]).toMatchObject({ event: 'message.received', handled: true })
  })

  it('tells the client’s account manager about a review, in-app only', async () => {
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
    expect(tables.leads ?? []).toHaveLength(0)
  })
})

describe('POST /api/zernio/webhook — authentication and unknown events', () => {
  it('acknowledges an event it does not act on, so it is not redelivered for days', async () => {
    const { res, json } = await deliver({ id: 'evt_t', event: 'webhook.test', data: {} })
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true })
    expect(recordPublishOnItem).not.toHaveBeenCalled()
    // logged as arrived but NOT handled — which is the honest record of it
    expect(tables.webhook_deliveries[0]).toMatchObject({ event: 'webhook.test', handled: false })
  })

  it('refuses a delivery signed with the wrong secret, and changes nothing', async () => {
    const { res } = await deliver(published('post_1'), { secret: 'not-our-secret' })
    expect(res.status).toBe(401)
    expect(tables.publish_jobs[0].status).toBe('scheduled')
    expect(recordPublishOnItem).not.toHaveBeenCalled()
    // an unauthorised delivery must not consume the event id either
    expect(tables.webhook_deliveries).toHaveLength(0)
  })

  it('refuses an unsigned delivery', async () => {
    const { res } = await deliver(published('post_1'), { sign: false })
    expect(res.status).toBe(401)
    expect(tables.publish_jobs[0].status).toBe('scheduled')
  })

  it('refuses everything when no secret is configured at all', async () => {
    delete process.env.ZERNIO_WEBHOOK_SECRET
    forgetWebhookSecrets()
    const { res } = await deliver(published('post_1'))
    expect(res.status).toBe(503)
    expect(tables.publish_jobs[0].status).toBe('scheduled')
  })

  it('rejects a body that is not JSON', async () => {
    const raw = 'not json'
    const res = await POST(new Request('https://app.mdmmarketing.com.au/api/zernio/webhook', {
      method: 'POST',
      headers: { 'x-zernio-signature': signZernioBody(raw, SECRET) },
      body: raw,
    }))
    expect(res.status).toBe(400)
  })
})
