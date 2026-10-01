import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * INSTAGRAM THROUGH THE AGENCY'S OWN META APP, at the publish job (1 Oct 2026,
 * branch meta-publish): the real publish.ts / meta-ig-publish.ts on the
 * in-memory database, every Graph call answered by a mock. Nothing here
 * reaches Instagram, and Zernio is a recorder that must stay empty for a
 * Meta job — and be the one called for everything else.
 */

let zernio: { targets: unknown }[] = []
vi.mock('../app/lib/publisher', () => ({
  getPublisher: () => ({
    configured: () => true,
    createPost: async (p: { targets: unknown }) => { zernio.push({ targets: p.targets }); return { kind: 'published' as const, postId: 'zernio-1' } },
    // the relay of a Zernio job: our file handed over, a Zernio URL back
    uploadMedia: async (m: { filename: string }) => ({ url: `https://zernio.com/${m.filename}`, type: 'image' as const }),
  }),
}))
vi.mock('../app/lib/production-publish', () => ({ recordPostOutcome: vi.fn(async () => ({})) }))
vi.mock('../app/lib/comment-automation', () => ({ armPostAutomations: vi.fn(async () => {}) }))
vi.mock('../app/lib/account-health', () => ({ refreshClientAccountsHealth: vi.fn(async () => {}) }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => {}) } }))
vi.mock('../app/lib/storage', async () => {
  const real = await vi.importActual<typeof import('../app/lib/storage')>('../app/lib/storage')
  return { ...real, publicBase: () => 'https://media.example.com', headStoredObject: async () => null }
})

const IG = '17841425316746644'
const CLIENT = '459e2564-1089-45ed-abd7-56d5f53c2cf6'

type MetaCall = { method: string; path: string; body: URLSearchParams }
let calls: MetaCall[] = []
let answer: (c: MetaCall) => unknown = () => ({})
const metaFetch = (async (input: any, init: any = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  // our storage (the Zernio relay reads it); not a Meta call
  if (url.host === 'media.example.com') return new Response('bytes', { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '5' } })
  const c = { method: (init.method ?? 'GET').toUpperCase(), path: url.pathname.replace('/v23.0/', ''), body: new URLSearchParams(typeof init.body === 'string' ? init.body : '') }
  calls.push(c)
  const out = answer(c) as any
  return new Response(JSON.stringify(out), { status: out?.__status ?? 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch

/** Instagram, answering like the docs say: quota, containers, FINISHED, publish, permalink, comment. */
function happyMeta(opts: { publishId?: string } = {}) {
  let n = 0
  return (c: MetaCall) => {
    if (c.path.endsWith('/content_publishing_limit')) return { data: [{ quota_usage: 2, config: { quota_total: 100 } }] }
    if (c.method === 'POST' && c.path === `${IG}/media`) return { id: `container-${++n}` }
    if (c.method === 'POST' && c.path === `${IG}/media_publish`) return { id: opts.publishId ?? 'media-1' }
    if (c.method === 'GET' && c.path.startsWith('container-')) return { status_code: 'FINISHED' }
    if (c.method === 'GET' && c.path === 'media-1') return { permalink: 'https://www.instagram.com/p/ABC/' }
    if (c.method === 'POST' && c.path === 'media-1/comments') return { id: 'comment-1' }
    return { __status: 404, error: { message: `unexpected ${c.method} ${c.path}` } }
  }
}

const JPG = (n: number) => ({ url: `https://media.example.com/c/${n}.jpg`, type: 'image' as const })
const MP4 = { url: 'https://media.example.com/c/clip.mp4', type: 'video' as const }

const metaJob = (over: Record<string, unknown> = {}): Row => ({
  id: 'j1', client_id: CLIENT, content_item_id: null, status: 'queued', caption: 'Hello from 100M',
  media: [JPG(1)], targets: [{ platform: 'instagram', accountId: 'zernio-ig' }],
  scheduled_for: null, timezone: 'Australia/Melbourne', request_id: 'req-1', attempts: 0,
  provider: 'meta_ig', meta_ig: { ig_user_id: IG, username: 'testbusinessaccount2026' },
  created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  ...over,
}) as unknown as Row

let fake: ReturnType<typeof seedDb>
const original = globalThis.fetch
let encryptSecret: (s: string) => string

async function setup(jobs: Row[], clientOver: Record<string, unknown> = {}, acctOver: Record<string, unknown> = {}) {
  globalThis.fetch = metaFetch
  encryptSecret = (await import('../app/lib/secret-box')).encryptSecret
  fake = seedDb({
    clients: [{ id: CLIENT, name: '100M', instagram_via_meta: true, ...clientOver } as unknown as Row],
    meta_ig_accounts: [{ id: IG, client_id: CLIENT, username: 'testbusinessaccount2026', status: 'active', access_token_encrypted: encryptSecret('tok'), ...acctOver } as unknown as Row],
    publish_jobs: jobs,
  })
}
const job = (id = 'j1') => fake.rows('publish_jobs').find(r => r.id === id) as any

beforeEach(() => {
  calls = []; zernio = []; answer = happyMeta()
  vi.stubEnv('CREDENTIALS_KEY', 'test-credentials-key')
  vi.stubEnv('META_IG_APP_SECRET', 'secret')
  vi.stubEnv('META_IG_POLL_MS', '0')
})
afterEach(() => { fake?.restore(); globalThis.fetch = original; vi.unstubAllEnvs() })

const { runPublishJob, dueJobIds } = await import('../app/lib/publish')
const { splitBookingForMeta } = await import('../app/lib/meta-ig-publish')

const flow = () => calls.map(c => `${c.method} ${c.path}`)

describe('a Meta job publishes through Instagram\'s own API, and Zernio is not called', () => {
  it('one picture: quota → container → media_publish → permalink → first comment, recorded like a Zernio outcome', async () => {
    await setup([metaJob({ targets: [{ platform: 'instagram', accountId: 'zernio-ig', options: { firstComment: '#tags' } }] })])
    expect(await runPublishJob('j1')).toBe('published')
    expect(flow()).toEqual([
      `GET ${IG}/content_publishing_limit`, `POST ${IG}/media`, 'GET container-1',
      `POST ${IG}/media_publish`, 'GET media-1', 'POST media-1/comments',
    ])
    expect(calls[1].body.get('image_url')).toBe(JPG(1).url)
    expect(calls[1].body.get('caption')).toBe('Hello from 100M')
    expect(calls[3].body.get('creation_id')).toBe('container-1')
    expect(calls[5].body.get('message')).toBe('#tags')
    const j = job()
    expect(j).toMatchObject({ status: 'published', permalink: 'https://www.instagram.com/p/ABC/', attempts: 1 })
    expect(j.error ?? null).toBeNull()
    expect(j.meta_ig).toMatchObject({ creation_id: 'container-1', media_id: 'media-1', first_comment_id: 'comment-1' })
    expect(j.platform_results).toEqual([expect.objectContaining({ platform: 'instagram', status: 'published', url: 'https://www.instagram.com/p/ABC/' })])
    expect(zernio).toEqual([])
  })

  it('a reel: REELS with share_to_feed off, waits for FINISHED', async () => {
    let polls = 0
    const happy = happyMeta()
    answer = c => (c.method === 'GET' && c.path === 'container-1' && ++polls < 3) ? { status_code: 'IN_PROGRESS' } : happy(c)
    await setup([metaJob({ media: [MP4], targets: [{ platform: 'instagram', accountId: 'zernio-ig', options: { kind: 'reel', shareToFeed: false } }] })])
    expect(await runPublishJob('j1')).toBe('published')
    const create = calls.find(c => c.method === 'POST' && c.path === `${IG}/media`)!
    expect(Object.fromEntries(create.body)).toEqual({ media_type: 'REELS', video_url: MP4.url, caption: 'Hello from 100M', share_to_feed: 'false' })
    expect(polls).toBe(3)
    expect(zernio).toEqual([])
  })

  it('a carousel: one item container per file, in order, then the parent', async () => {
    await setup([metaJob({ media: [JPG(1), MP4, JPG(3)] })])
    expect(await runPublishJob('j1')).toBe('published')
    const posts = calls.filter(c => c.method === 'POST' && c.path === `${IG}/media`).map(c => Object.fromEntries(c.body))
    expect(posts).toEqual([
      { image_url: JPG(1).url, is_carousel_item: 'true' },
      { media_type: 'VIDEO', video_url: MP4.url, is_carousel_item: 'true' },
      { image_url: JPG(3).url, is_carousel_item: 'true' },
      { media_type: 'CAROUSEL', children: 'container-1,container-2,container-3', caption: 'Hello from 100M' },
    ])
    expect(job().meta_ig).toMatchObject({ children: ['container-1', 'container-2', 'container-3'], creation_id: 'container-4' })
  })
})

describe('failures are recorded in plain words', () => {
  it('Meta refuses the file: failed, with the sentence, and the post told', async () => {
    const happy = happyMeta()
    answer = c => (c.method === 'POST' && c.path === `${IG}/media`)
      ? { __status: 400, error: { message: 'Invalid parameter', code: 9004, error_subcode: 2207052 } }
      : happy(c)
    await setup([metaJob()])
    expect(await runPublishJob('j1')).toBe('failed')
    expect(job()).toMatchObject({ status: 'failed', error: 'Instagram (direct, Meta): Instagram could not fetch the file from its link' })
    expect(job().platform_results[0]).toMatchObject({ status: 'failed', reason: 'Instagram (direct, Meta): Instagram could not fetch the file from its link' })
    expect(zernio).toEqual([])
  })

  it('an expired token: failed, "reconnect"', async () => {
    answer = () => ({ __status: 400, error: { message: 'Error validating access token', code: 190 } })
    await setup([metaJob()])
    expect(await runPublishJob('j1')).toBe('failed')
    expect(job().error).toMatch(/connection has expired.*reconnect/)
  })

  it('a full quota refuses before anything is made', async () => {
    answer = () => ({ data: [{ quota_usage: 100, config: { quota_total: 100 } }] })
    await setup([metaJob()])
    expect(await runPublishJob('j1')).toBe('failed')
    expect(flow()).toEqual([`GET ${IG}/content_publishing_limit`])
    expect(job().error).toMatch(/limit of 100 posts in 24 hours/)
  })

  it('a first comment refused does not make a published post look failed', async () => {
    const happy = happyMeta()
    answer = c => c.path === 'media-1/comments' ? { __status: 400, error: { message: 'Comments are off', code: 100 } } : happy(c)
    await setup([metaJob({ targets: [{ platform: 'instagram', accountId: 'zernio-ig', options: { firstComment: '#x' } }] })])
    expect(await runPublishJob('j1')).toBe('published')
    expect(job()).toMatchObject({ status: 'published', error: expect.stringMatching(/first comment did not go up/) })
  })
})

describe('a retry never publishes twice', () => {
  it('Meta down at media_publish: back on the queue; the retry publishes THE SAME container, made once', async () => {
    const happy = happyMeta()
    let down = true
    answer = c => (down && c.path === `${IG}/media_publish`) ? { __status: 503, error: { message: 'Service unavailable', code: 2, is_transient: true } } : happy(c)
    await setup([metaJob()])
    expect(await runPublishJob('j1')).toBe('queued')
    expect(job()).toMatchObject({ status: 'queued', attempts: 1 })
    expect(job().meta_ig.creation_id).toBe('container-1')
    down = false
    calls = []
    expect(await runPublishJob('j1')).toBe('published')
    // no quota read, no second container: straight to the one already made
    expect(flow()).toEqual(['GET container-1', 'GET container-1', `POST ${IG}/media_publish`, 'GET media-1'])
    expect(calls.find(c => c.path.endsWith('media_publish'))!.body.get('creation_id')).toBe('container-1')
  })

  it('a run that died after media_publish (container PUBLISHED, no media id on the row): recorded out, not published again', async () => {
    answer = c => c.path === 'container-9' ? { status_code: 'PUBLISHED' } : { __status: 500, error: { message: 'must not be called' } }
    await setup([metaJob({ meta_ig: { ig_user_id: IG, creation_id: 'container-9' } })])
    expect(await runPublishJob('j1')).toBe('published')
    expect(flow()).toEqual(['GET container-9'])
    expect(job().status).toBe('published')
  })

  it('a second worker on the same job loses the claim and calls nobody', async () => {
    await setup([metaJob({ status: 'publishing' })])
    expect(await runPublishJob('j1')).toBeNull()
    expect(calls).toEqual([])
  })

  it('a published job is never taken again', async () => {
    await setup([metaJob({ status: 'published', meta_ig: { ig_user_id: IG, media_id: 'media-1' } })])
    expect(await runPublishJob('j1')).toBeNull()
    expect(calls).toEqual([])
  })
})

describe('held until its time — Instagram\'s API cannot schedule', () => {
  it('a Meta job ahead of its time is not taken (status held, nothing called), and the dispatcher leaves it until near', async () => {
    const later = new Date(Date.now() + 3 * 3600_000).toISOString()
    const soon = new Date(Date.now() + 5 * 60_000).toISOString()
    await setup([metaJob({ scheduled_for: later }), metaJob({ id: 'j2', scheduled_for: soon }), metaJob({ id: 'z1', provider: null, meta_ig: null, scheduled_for: later })])
    expect(await runPublishJob('j1')).toBe('held')
    expect(job()).toMatchObject({ status: 'queued', attempts: 0 })
    expect(calls).toEqual([])
    expect((await dueJobIds()).sort()).toEqual(['j2', 'z1'])
  })
})

describe('everything else stays on Zernio, unchanged', () => {
  it('an ordinary job (no provider) goes to Zernio and Meta is not called', async () => {
    await setup([metaJob({ provider: null, meta_ig: null })])
    expect(await runPublishJob('j1')).toBe('published')
    expect(zernio).toHaveLength(1)
    expect(calls).toEqual([])
  })

  it('a Meta job whose client was switched off since booking goes through Zernio after all', async () => {
    await setup([metaJob()], { instagram_via_meta: false })
    expect(await runPublishJob('j1')).toBe('published')
    expect(zernio).toHaveLength(1)
    expect(calls).toEqual([])
  })

  it('splitting a booking: switch on → the matching Instagram target alone goes to Meta, the rest to Zernio', async () => {
    await setup([])
    const targets = [
      { platform: 'instagram' as const, accountId: 'zernio-ig' },
      { platform: 'facebook' as const, accountId: 'zernio-fb' },
    ]
    const accounts = [
      { id: 'sa-ig', platform: 'instagram', username: 'testbusinessaccount2026', provider_account_id: 'zernio-ig' },
      { id: 'sa-fb', platform: 'facebook', username: '100m', provider_account_id: 'zernio-fb' },
    ]
    const split = await splitBookingForMeta({ clientId: CLIENT, targets, accounts, media: [JPG(1)] })
    expect(split.meta).toEqual({ target: targets[0], state: { ig_user_id: IG, username: 'testbusinessaccount2026' } })
    expect(split.rest).toEqual([targets[1]])
  })

  it('splitting a booking: another client, the switch off, or a PNG → nothing goes to Meta', async () => {
    await setup([], { instagram_via_meta: false })
    const targets = [{ platform: 'instagram' as const, accountId: 'zernio-ig' }]
    const accounts = [{ id: 'sa-ig', platform: 'instagram', username: 'testbusinessaccount2026', provider_account_id: 'zernio-ig' }]
    expect(await splitBookingForMeta({ clientId: CLIENT, targets, accounts, media: [JPG(1)] })).toMatchObject({ meta: null, rest: targets })
    expect(await splitBookingForMeta({ clientId: 'someone-else', targets, accounts, media: [JPG(1)] })).toMatchObject({ meta: null, rest: targets })
    fake.restore()
    await setup([])
    const png = await splitBookingForMeta({ clientId: CLIENT, targets, accounts, media: [{ url: 'https://media.example.com/a.png', type: 'image' }] })
    expect(png.meta).toBeNull()
    expect(png.rest).toEqual(targets)
    expect(png.routes[0]).toMatchObject({ via: 'zernio', reason: expect.stringMatching(/JPEG/) })
  })
})
