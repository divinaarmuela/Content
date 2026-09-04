import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import { table } from '@/lib/db'
import type { PublishJob as PublishJobRow, Row } from '@/lib/db-types'

/**
 * A post waits for its clean copy rather than sending the master anyway.
 *
 * This is the whole point of the encoder, at the last moment it can still go
 * wrong: a 2 GB master handed to Instagram publishes with no error anywhere,
 * having been silently re-compressed, and the client sees the loss on footage
 * they paid to have shot. A post four minutes late is the better trade.
 *
 * The job goes back to 'queued' with the reason on the row and `attempts`
 * untouched — waiting is not a failed try, and an incremented count would
 * walk the job toward the five-attempt cut-off for standing still.
 */

/** Every post handed to the provider. Empty is the assertion that matters. */
let published: { media: unknown; targets: unknown }[] = []
vi.mock('../app/lib/publisher', () => ({
  getPublisher: () => ({
    configured: () => true,
    createPost: async (p: { media: unknown; targets: unknown }) => {
      published.push({ media: p.media, targets: p.targets })
      return { kind: 'published' as const, postId: 'prov-1' }
    },
    // the relay, echoing the file name back so a post can be read as
    // "Instagram got the copy, everyone else got the master"
    uploadMedia: async (m: { filename: string }) =>
      ({ url: `https://zernio.com/${m.filename}`, type: 'video' as const }),
  }),
}))

// the relay reads the bytes before it uploads them; nothing in this suite may
// reach the network, so the master is a fake response with a body
vi.stubGlobal('fetch', async (input: string | URL | Request) =>
  new Response('fake-bytes', {
    status: 200,
    headers: { 'content-type': 'video/mp4', 'content-length': '10' },
    ...(String(input) ? {} : {}),
  }))
vi.mock('../app/lib/production-publish', () => ({ recordPublishOnItem: vi.fn(async () => {}) }))

/** The master, as the storage host describes it: too big for Instagram. */
vi.mock('../app/lib/storage', async () => {
  const real = await vi.importActual<typeof import('../app/lib/storage')>('../app/lib/storage')
  return {
    ...real,
    publicBase: () => 'https://media.example.com',
    headStoredObject: async () => ({ contentType: 'video/mp4', bytes: 2048 * 1024 * 1024 }),
  }
})

let sent: { name: string; data: Record<string, unknown> }[] = []
vi.mock('../app/inngest/client', () => ({
  inngest: { send: async (e: { name: string; data: Record<string, unknown> }) => { sent.push(e) } },
}))

const { runPublishJob, jobsWaitingOnCopy } = await import('../app/lib/publish')
const { encodeJobId } = await import('../app/lib/encode-jobs')

const MASTER = 'https://media.example.com/master.mp4'

const publishJob = (id: string): Row => ({
  id, content_item_id: null, status: 'queued', client_id: 'client-1',
  caption: 'Hello', request_id: `req-${id}`,
  media: [{ url: MASTER, type: 'video' }],
  targets: [
    { platform: 'instagram', accountId: 'acc-1', options: { kind: 'reel' } },
    // TikTok takes the master whole, so it never waits for anything
    { platform: 'tiktok', accountId: 'acc-2' },
  ],
  timezone: 'Australia/Melbourne', scheduled_for: null, attempts: 0,
  created_at: '2026-09-03T00:00:00.000Z', updated_at: '2026-09-03T00:00:00.000Z',
}) as unknown as Row

const encodeJob = (over: Record<string, unknown>): Row => ({
  id: encodeJobId(MASTER, 'instagram'),
  source_url: MASTER, platform: 'instagram',
  status: 'running', output_key: null,
  bytes: null, width: null, height: null, duration_sec: null, video_kbps: null,
  error: null, asset_id: null, version_id: null, slide_index: null,
  created_at: '2026-09-03T00:00:00.000Z', updated_at: '2026-09-03T00:00:00.000Z',
  ...over,
} as unknown as Row)

let fake: ReturnType<typeof seedDb>
beforeEach(() => {
  published = []
  sent = []
  process.env.ENCODER_URL = 'https://encoder.example.com'
  process.env.ENCODER_TOKEN = 'token'
})
afterEach(() => {
  fake?.restore()
  delete process.env.ENCODER_URL
  delete process.env.ENCODER_TOKEN
})

const row = (id: string) => table<PublishJobRow>('publish_jobs').get(id)

describe('a post whose channel is still having a copy made', () => {
  it('goes back to the queue and says why, without sending anything', async () => {
    fake = seedDb({ publish_jobs: [publishJob('j1')], encode_jobs: [encodeJob({ status: 'running' })] })
    expect(await runPublishJob('j1')).toBe('queued')
    expect(published).toEqual([])

    const after = await row('j1')
    expect(after!.status).toBe('queued')
    expect(after!.error).toBe('Making a clean copy for Instagram — usually a few minutes')
    // waiting is not a failed attempt
    expect(after!.attempts).toBe(0)
  })

  it('asks for the copy the first time it looks, if nobody has yet', async () => {
    fake = seedDb({ publish_jobs: [publishJob('j1')], encode_jobs: [] })
    expect(await runPublishJob('j1')).toBe('queued')
    expect(sent.map(e => e.name)).toEqual(['media/encode'])
    expect(sent[0].data).toMatchObject({ sourceUrl: MASTER, platform: 'instagram', kind: 'reel' })
    expect(published).toEqual([])
  })
})

describe('once the copy has landed', () => {
  it('sends it as that channel’s own file and the master to everyone else', async () => {
    fake = seedDb({
      publish_jobs: [publishJob('j1')],
      encode_jobs: [encodeJob({
        status: 'done', output_key: 'copy-instagram.mp4', bytes: 120 * 1024 * 1024,
        width: 1080, height: 1920, duration_sec: 20,
      })],
    })
    expect(await runPublishJob('j1')).toBe('published')
    expect(published).toHaveLength(1)

    // What went out: `copy-instagram.mp4` is the file the encoder made, and
    // it reached the provider as INSTAGRAM'S OWN file — the shared media is
    // still the master. (The relay renames both onto the provider's host on
    // the way, which is why the names rather than the hosts are the tell.)
    const targets = published[0].targets as { platform: string; options?: { media?: { url: string }[] } }[]
    expect(targets.find(t => t.platform === 'instagram')!.options?.media)
      .toEqual([{ url: 'https://zernio.com/copy-instagram.mp4', type: 'video' }])
    // TikTok takes a 2 GB master end to end; giving it a copy would be a
    // worse video for no reason
    expect(targets.find(t => t.platform === 'tiktok')!.options?.media).toBeUndefined()
    expect(published[0].media).toEqual([{ url: 'https://zernio.com/master.mp4', type: 'video' }])
  })
})

describe('when no copy can be made', () => {
  it('fails the post rather than sending a master the channel will mangle', async () => {
    fake = seedDb({
      publish_jobs: [publishJob('j1')],
      encode_jobs: [encodeJob({ status: 'failed', error: 'the source has no video in it' })],
    })
    expect(await runPublishJob('j1')).toBe('failed')
    expect(published).toEqual([])
    const after = await row('j1')
    expect(after!.error).toMatch(/Could not prepare a copy for Instagram — try a smaller export/)
  })
})

describe('when no encoder is configured', () => {
  it('behaves exactly as it did before the encoder existed', async () => {
    delete process.env.ENCODER_URL
    delete process.env.ENCODER_TOKEN
    fake = seedDb({ publish_jobs: [publishJob('j1')], encode_jobs: [] })
    expect(await runPublishJob('j1')).toBe('published')
    expect(published).toHaveLength(1)
    expect(sent).toEqual([])
  })
})

describe('handing waiting posts back when a copy lands', () => {
  it('names every queued post that was waiting on that file, and no others', async () => {
    fake = seedDb({
      publish_jobs: [
        publishJob('j1'),
        { ...publishJob('j2'), status: 'published' } as Row,
        { ...publishJob('j3'), media: [{ url: 'https://media.example.com/other.mp4', type: 'video' }] } as Row,
      ],
      encode_jobs: [],
    })
    expect(await jobsWaitingOnCopy(MASTER)).toEqual(['j1'])
    expect(await jobsWaitingOnCopy('https://media.example.com/nothing.mp4')).toEqual([])
    expect(await jobsWaitingOnCopy('')).toEqual([])
  })
})
