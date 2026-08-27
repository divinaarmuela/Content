import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signZernioBody } from '../app/lib/zernio-webhook-core'

/**
 * The webhook route, against a miniature publish_jobs table.
 *
 * The table is emulated rather than stubbed — filters and the conditional
 * UPDATE are applied for real — because the whole idempotency claim rests on
 * "the second delivery matches zero rows". A stub that just returned a row
 * would prove nothing about that.
 */

const SECRET = 'test-webhook-secret'

type Row = Record<string, unknown>
type Filter = ['eq' | 'is', string, unknown] | ['in', string, unknown[]]
type Op = { table: string; verb: 'select' | 'update'; patch: Row; filters: Filter[] }

const tables: Record<string, Row[]> = {}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every(f => {
    if (f[0] === 'eq') return row[f[1]] === f[2]
    if (f[0] === 'is') return row[f[1]] === f[2] || (f[2] === null && row[f[1]] == null)
    return (f[2] as unknown[]).includes(row[f[1]])
  })
}

function run(op: Op): { data: Row[] | null; error: { message: string } | null } {
  const rows = tables[op.table] ?? []
  const hit = rows.filter(r => matches(r, op.filters))
  if (op.verb === 'update') for (const r of hit) Object.assign(r, op.patch)
  return { data: hit.map(r => ({ ...r })), error: null }
}

const supabase = {
  from(table: string) {
    const op: Op = { table, verb: 'select', patch: {}, filters: [] }
    const chain = {
      select: () => chain,
      update: (patch: Row) => { op.verb = 'update'; op.patch = patch; return chain },
      eq: (c: string, v: unknown) => { op.filters.push(['eq', c, v]); return chain },
      is: (c: string, v: unknown) => { op.filters.push(['is', c, v]); return chain },
      in: (c: string, v: unknown[]) => { op.filters.push(['in', c, v]); return chain },
      then: (ok: (r: unknown) => unknown, no?: (e: unknown) => unknown) =>
        Promise.resolve(run(op)).then(ok, no),
    }
    return chain
  },
}

const recordPublishOnItem = vi.fn(async () => {})

vi.mock('@/lib/supabase', () => ({ supabase }))
vi.mock('../app/lib/production-publish', () => ({ recordPublishOnItem }))

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

const published = (postId: string) => ({
  id: 'evt_1',
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
  recordPublishOnItem.mockClear()
  tables.publish_jobs = [{
    id: 'job-1',
    status: 'scheduled',
    provider_post_id: 'post_1',
    content_item_id: 'item-1',
    targets: [{ platform: 'instagram' }],
    permalink: null,
    published_at: null,
    error: null,
  }]
  tables.provider_webhooks = []
  tables.social_accounts = [{ provider_account_id: 'acc_1', active: true }]
})

afterEach(() => { forgetWebhookSecrets() })

describe('POST /api/zernio/webhook', () => {
  it('marks the job published and walks the item scheduled → published', async () => {
    const { res, json } = await deliver(published('post_1'))

    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, published: 'job-1' })

    const job = tables.publish_jobs[0]
    expect(job.status).toBe('published')
    expect(job.permalink).toBe('https://instagram.com/p/abc')
    expect(job.published_at).toEqual(expect.any(String))

    expect(recordPublishOnItem).toHaveBeenCalledTimes(1)
    expect(recordPublishOnItem).toHaveBeenCalledWith(
      'item-1', 'https://instagram.com/p/abc', ['instagram'],
    )
  })

  it('is idempotent: a redelivery of the same event does nothing', async () => {
    await deliver(published('post_1'))
    expect(recordPublishOnItem).toHaveBeenCalledTimes(1)
    const after = { ...tables.publish_jobs[0] }

    // Zernio is at-least-once and retries for ~51 hours — this WILL happen
    const { res, json } = await deliver(published('post_1'))

    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true, duplicate: true })
    // no second transition, and nothing about the job changed
    expect(recordPublishOnItem).toHaveBeenCalledTimes(1)
    expect(tables.publish_jobs[0]).toEqual(after)
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

    // and the retry of the failure is a no-op too
    const again = await deliver({ id: 'evt_2', event: 'post.failed', data: { post: { _id: 'post_1' } } })
    expect(again.json).toEqual({ ok: true, duplicate: true })
  })

  it('never lets a published job be flipped back by a late failure', async () => {
    await deliver(published('post_1'))
    await deliver({ id: 'evt_3', event: 'post.failed', data: { post: { _id: 'post_1' } } })
    expect(tables.publish_jobs[0].status).toBe('published')
  })

  it('still deactivates a disconnected account', async () => {
    const { json } = await deliver({ event: 'account.disconnected', data: { accountId: 'acc_1' } })
    expect(json).toMatchObject({ ok: true, marked: 'acc_1' })
    expect(tables.social_accounts[0].active).toBe(false)
  })

  it('acknowledges an event it does not act on, so it is not redelivered for days', async () => {
    const { res, json } = await deliver({ event: 'webhook.test', data: {} })
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true })
    expect(recordPublishOnItem).not.toHaveBeenCalled()
  })

  it('refuses a delivery signed with the wrong secret, and changes nothing', async () => {
    const { res } = await deliver(published('post_1'), { secret: 'not-our-secret' })
    expect(res.status).toBe(401)
    expect(tables.publish_jobs[0].status).toBe('scheduled')
    expect(recordPublishOnItem).not.toHaveBeenCalled()
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
