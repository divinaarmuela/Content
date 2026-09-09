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
  // the preview table is only read when Stream is configured, and it is where
  // the clip's measured length comes from
  process.env.CLOUDFLARE_ACCOUNT_ID = 'acct'
  process.env.CLOUDFLARE_STREAM_TOKEN = 'cf-token'
})
afterEach(() => {
  fake?.restore()
  delete process.env.ENCODER_URL
  delete process.env.ENCODER_TOKEN
  delete process.env.CLOUDFLARE_ACCOUNT_ID
  delete process.env.CLOUDFLARE_STREAM_TOKEN
})

/** The Stream preview row, which is where a measured duration comes from. */
const previewRow = (seconds: number | null): Row => ({
  id: 'p1', source_url: MASTER, stream_uid: 'deadbeef', state: 'ready',
  error: null, width: 1080, height: 1920, duration_sec: seconds,
  created_at: '2026-09-03T00:00:00.000Z', updated_at: '2026-09-03T00:00:00.000Z',
} as unknown as Row)

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

/**
 * A copy is budgeted for the clip, not for the channel's whole ceiling.
 *
 * Instagram takes 300 MB over fifteen minutes. Budget for the ceiling and a
 * twenty-second reel gets about 2 Mbps; budget for the clip and it gets the
 * 10 Mbps the ladder is built for. And because the copy is claimed on
 * `source + channel`, whoever asks FIRST fixes that for good — so the
 * automated path measuring nothing would quietly give back most of what this
 * service was built to gain.
 */
describe('how long the clip is', () => {
  it('is looked up and carried into the ask', async () => {
    fake = seedDb({
      publish_jobs: [publishJob('j1')],
      encode_jobs: [],
      video_previews: [previewRow(20)],
    })
    expect(await runPublishJob('j1')).toBe('queued')
    expect(sent[0].data).toMatchObject({ platform: 'instagram', kind: 'reel', seconds: 20 })

    // …and 20 seconds is what buys the full ceiling
    const { encodeTargetFor } = await import('../app/lib/media-fit-core')
    expect(encodeTargetFor('instagram', 'reel', 20)!.maxrateKbps).toBe(20_000)
    // where budgeting for the channel's whole 15 minutes would not
    expect(encodeTargetFor('instagram', 'reel')!.maxrateKbps).toBeLessThan(3_000)
  })

  it('is read without needing Cloudflare Stream at all', async () => {
    // `video_previews` is OUR table — Cloudflare filled a column in it, but
    // the number does not stop being true when the Stream keys are removed,
    // and removing them is the POINT of the encoder. Reading the duration
    // through the Stream accessor meant that day would silently return every
    // automated copy to the ~2 Mbps fallback, with only a warning to say so.
    delete process.env.CLOUDFLARE_ACCOUNT_ID
    delete process.env.CLOUDFLARE_STREAM_TOKEN
    fake = seedDb({
      publish_jobs: [publishJob('j1')],
      encode_jobs: [],
      video_previews: [previewRow(20)],
    })
    expect(await runPublishJob('j1')).toBe('queued')
    expect(sent[0].data).toMatchObject({ seconds: 20 })
  })

  it('falls back, and says so, when nothing measured it', async () => {
    fake = seedDb({
      publish_jobs: [publishJob('j1')],
      encode_jobs: [],
      video_previews: [previewRow(null)],
    })
    expect(await runPublishJob('j1')).toBe('queued')
    expect(sent[0].data).toMatchObject({ seconds: null })
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


/**
 * A COPY THAT DOES NOT FIT THE CHANNEL IS NOT A COPY.
 *
 * `ready` used to be enough on its own. But ffmpeg was never told to stop at
 * the channel's length ceiling, so a four-minute master posted as an
 * Instagram Story came out at four minutes and about 305 MB against the
 * 100 MB Stories take — and this path took it at its word.
 */
describe('a copy that came out too big for the channel', () => {
  const storyJob = (id: string): Row => ({
    ...publishJob(id),
    targets: [{ platform: 'instagram', accountId: 'acc-1', options: { kind: 'story' } }],
  }) as unknown as Row

  it('is refused, in words, instead of being sent', async () => {
    fake = seedDb({
      publish_jobs: [storyJob('j1')],
      encode_jobs: [encodeJob({
        kind: 'story', status: 'done', output_key: 'copy-instagram.mp4',
        bytes: 305 * 1024 * 1024, width: 1080, height: 1920, duration_sec: 240,
      })],
    })
    expect(await runPublishJob('j1')).toBe('failed')
    expect(published).toEqual([])
    const after = await row('j1')
    expect(after!.error).toMatch(/only takes 100 MB/)
  })

  it('takes one that fits', async () => {
    fake = seedDb({
      publish_jobs: [storyJob('j1')],
      encode_jobs: [encodeJob({
        kind: 'story', status: 'done', output_key: 'copy-instagram.mp4',
        bytes: 60 * 1024 * 1024, width: 1080, height: 1920, duration_sec: 60,
      })],
    })
    expect(await runPublishJob('j1')).toBe('published')
  })
})

/**
 * THE MASTER STOPS TRAVELLING ONCE EVERY CHANNEL HAS ITS OWN FILE.
 *
 * `job.media` was relayed regardless: a 900 MB master pushed through a
 * function capped at 300 seconds, attached to the post as shared media that
 * no channel was ever going to use. It did not finish, the job never settled,
 * and the reclaim sweep started the identical transfer every fifteen minutes.
 */
describe('when every channel is holding its own copy', () => {
  const soloJob = (id: string): Row => ({
    ...publishJob(id),
    targets: [{ platform: 'instagram', accountId: 'acc-1', options: { kind: 'reel' } }],
  }) as unknown as Row

  it('the master is not sent at all', async () => {
    fake = seedDb({
      publish_jobs: [soloJob('j1')],
      encode_jobs: [encodeJob({
        status: 'done', output_key: 'copy-instagram.mp4', bytes: 120 * 1024 * 1024,
        width: 1080, height: 1920, duration_sec: 20,
      })],
    })
    expect(await runPublishJob('j1')).toBe('published')
    expect(published[0].media).toEqual([])
    const targets = published[0].targets as { options?: { media?: { url: string }[] } }[]
    expect(targets[0].options?.media).toEqual([{ url: 'https://zernio.com/copy-instagram.mp4', type: 'video' }])
    // and the row says so, so a retry does not go and fetch it again
    expect((await row('j1'))!.media).toEqual([])
  })

  it('but a channel taking the master still gets it', async () => {
    fake = seedDb({
      publish_jobs: [publishJob('j1')],           // instagram + tiktok
      encode_jobs: [encodeJob({
        status: 'done', output_key: 'copy-instagram.mp4', bytes: 120 * 1024 * 1024,
        width: 1080, height: 1920, duration_sec: 20,
      })],
    })
    expect(await runPublishJob('j1')).toBe('published')
    expect(published[0].media).toEqual([{ url: 'https://zernio.com/master.mp4', type: 'video' }])
  })
})

/**
 * A FILE TOO BIG TO CARRY IS REFUSED, NOT RETRIED FOR EVER.
 *
 * The relay is one serial transfer inside a 300-second function. A 900 MB
 * master is killed part-way with no error, so the job never settles and the
 * reclaim sweep pushes exactly the same bytes again a quarter of an hour
 * later, for ever.
 */
describe('a master beyond what the function can carry', () => {
  const bigFile = () => vi.stubGlobal('fetch', async () => new Response('fake-bytes', {
    status: 200,
    headers: { 'content-type': 'video/mp4', 'content-length': String(900 * 1024 * 1024) },
  }))

  /**
   * …is handed to the provider BY ITS ADDRESS, not refused. The provider
   * fetches any public URL with the right Content-Type on a fast host — its
   * own docs — and our storage's public host is one. The 8 Sep ceiling
   * refused every master over 350 MB outright, which made "YouTube and
   * TikTok take the master" false: the owner's 1.4 GB TikTok post of 9 Sep
   * failed with "a copy is being made" and no copy was ever coming for
   * TikTok.
   */
  it('goes to the provider by its own public address when it lives on our storage', async () => {
    const smallFile = globalThis.fetch
    bigFile()
    delete process.env.ENCODER_URL
    delete process.env.ENCODER_TOKEN
    fake = seedDb({ publish_jobs: [publishJob('j1')], encode_jobs: [] })

    expect(await runPublishJob('j1')).toBe('published')
    // untouched: the URL the provider got is ours, not a relayed copy
    expect(published[0].media).toEqual([{ url: MASTER, type: 'video' }])
    vi.stubGlobal('fetch', smallFile)
  })

  it('is still refused, in a plain sentence, when it is somewhere the provider cannot be sent', async () => {
    const smallFile = globalThis.fetch
    bigFile()
    delete process.env.ENCODER_URL
    delete process.env.ENCODER_TOKEN
    const elsewhere = { ...publishJob('j1'), media: [{ url: 'https://cdn.somewhere-else.example/master.mp4', type: 'video' }] } as Row
    fake = seedDb({ publish_jobs: [elsewhere], encode_jobs: [] })

    expect(await runPublishJob('j1')).toBe('failed')
    expect(published).toEqual([])
    const after = await row('j1')
    expect(after!.error).toMatch(/too big to send as it is/)
    vi.stubGlobal('fetch', smallFile)
  })
})
