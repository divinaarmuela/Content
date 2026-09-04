import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import { table } from '@/lib/db'
import type { EncodeJob, Row } from '@/lib/db-types'

/**
 * `media/encode`: the body of the Inngest job that asks for one copy.
 *
 * The encoder is a stub — nothing here reaches the network — and so is R2's
 * presigner, because the only thing this code has to get right about an
 * upload URL is that it goes on the row BEFORE the encoder is told anything.
 *
 * The one thing worth testing hardest is the claim. An encode is minutes of a
 * machine's time, so two events for the same copy becoming two encodes is a
 * real bill, not an untidy table.
 */

/** Every job the fake encoder was handed. */
let asked: { jobId: string; target: Record<string, number>; uploadUrl: string }[] = []
/** What the fake encoder answers with. */
let answer: 'accepted' | 'busy' | 'refused' | 'stub' = 'accepted'

vi.mock('../app/lib/encoder', async () => {
  const real = await vi.importActual<typeof import('../app/lib/encoder')>('../app/lib/encoder')
  return {
    ...real,
    encoderConfigured: () => true,
    callbackUrl: () => 'https://app.example.com/api/media/encode/callback',
    requestEncode: async (ask: { jobId: string; target: Record<string, number>; uploadUrl: string }) => {
      asked.push({ jobId: ask.jobId, target: ask.target, uploadUrl: ask.uploadUrl })
      if (answer === 'busy') return { accepted: false, busy: true, reason: 'the encoder is busy' }
      if (answer === 'refused') return { accepted: false, busy: false, reason: 'the encoder refused the job (400)' }
      return { accepted: true, stub: answer === 'stub' }
    },
  }
})

/**
 * R2 without R2.
 *
 * `objectKey` mints a NEW name every call; `signUploadForKey` signs one that
 * was chosen earlier. Keeping them apart here is the point of half this file:
 * a retry must re-sign the key already on the row, never mint another.
 */
let minted = 0
let presigned: string[] = []
vi.mock('../app/lib/storage', async () => {
  const real = await vi.importActual<typeof import('../app/lib/storage')>('../app/lib/storage')
  return {
    ...real,
    publicBase: () => 'https://media.example.com',
    objectKey: (filename: string) => `key-${++minted}-${filename}`,
    signUploadForKey: async (key: string) => {
      presigned.push(key)
      return {
        key,
        signedUrl: `https://r2.example.com/${key}?sig=${presigned.length}`,
        publicUrl: `https://media.example.com/${key}`,
        backend: 'r2' as const,
      }
    },
  }
})

const { runEncodeRequest, sweepStaleEncodes, REASK_GRACE_MS } = await import('../app/lib/encode-run')
const { GAVE_UP_MESSAGE, encodeJobId, staleBeforeFor } = await import('../app/lib/encode-jobs')

const SOURCE = 'https://media.example.com/master.mp4'

let fake: ReturnType<typeof seedDb>
beforeEach(() => {
  asked = []
  presigned = []
  minted = 0
  answer = 'accepted'
  fake = seedDb({ encode_jobs: [] as Row[] })
})
afterEach(() => fake.restore())

const rows = () => fake.rows('encode_jobs') as unknown as EncodeJob[]

describe('asking for one copy', () => {
  it('claims a row, presigns the upload and asks the encoder — in that order', async () => {
    const out = await runEncodeRequest({ sourceUrl: SOURCE, platform: 'instagram', kind: 'reel', seconds: 20 })
    expect(out.at).toBe('asked')

    expect(rows()).toHaveLength(1)
    const row = rows()[0]
    expect(row.status).toBe('running')
    expect(row.source_url).toBe(SOURCE)
    expect(row.platform).toBe('instagram')
    // the key is on the row before the encoder was told where to PUT: the
    // callback carries no key, so this is the only record of it
    expect(row.output_key).toBe('key-1-copy-instagram.mp4')
    expect(row.attempts).toBe(1)
    expect(row.target_source).toBe('measured')

    expect(asked).toHaveLength(1)
    expect(asked[0].jobId).toBe(row.id)
    expect(asked[0].target.maxrateKbps).toBe(10_000)
    expect(asked[0].target.maxSeconds).toBe(20)
  })

  it('is one encode however many times it is asked for', async () => {
    await runEncodeRequest({ sourceUrl: SOURCE, platform: 'instagram', kind: 'reel', seconds: 20 })
    const second = await runEncodeRequest({ sourceUrl: SOURCE, platform: 'instagram', kind: 'reel', seconds: 20 })
    expect(second.at).toBe('existing')
    expect(rows()).toHaveLength(1)
    expect(asked).toHaveLength(1)
  })

  it('but a different channel is a different copy', async () => {
    await runEncodeRequest({ sourceUrl: SOURCE, platform: 'instagram', seconds: 20 })
    await runEncodeRequest({ sourceUrl: SOURCE, platform: 'twitter', seconds: 20 })
    expect(rows()).toHaveLength(2)
    expect(asked.map(a => a.target.maxrateKbps)).toEqual([10_000, 8_000])
  })

  it('does not race itself when two events arrive together', async () => {
    const both = await Promise.all([
      runEncodeRequest({ sourceUrl: SOURCE, platform: 'instagram', seconds: 20 }),
      runEncodeRequest({ sourceUrl: SOURCE, platform: 'instagram', seconds: 20 }),
    ])
    expect(both.filter(r => r.at === 'asked')).toHaveLength(1)
    expect(both.filter(r => r.at === 'existing')).toHaveLength(1)
    expect(rows()).toHaveLength(1)
    expect(asked).toHaveLength(1)
  })

  it('records that a copy was budgeted blind, when nobody measured the clip', async () => {
    await runEncodeRequest({ sourceUrl: SOURCE, platform: 'instagram', kind: 'reel' })
    const row = rows()[0]
    expect(row.target_source).toBe('fallback')
    // budgeting for Instagram's whole fifteen minutes buys far less than the
    // ceiling a measured twenty-second reel would get
    expect(asked[0].target.maxrateKbps).toBeLessThan(3_000)
  })

  it('carries where the video came from, when it came from a piece of work', async () => {
    await runEncodeRequest({
      sourceUrl: SOURCE, platform: 'instagram', seconds: 20,
      assetId: 'item-1', versionId: 'item-1__3', slideIndex: 0,
    })
    const row = rows()[0]
    expect(row.asset_id).toBe('item-1')
    expect(row.version_id).toBe('item-1__3')
    expect(row.slide_index).toBe(0)
  })
})

describe('when the encoder will not take it', () => {
  it('leaves the row queued with its key and throws, when the machine is busy', async () => {
    answer = 'busy'
    await expect(runEncodeRequest({ sourceUrl: SOURCE, platform: 'instagram', seconds: 20 }))
      .rejects.toThrow(/busy/)
    // the row STAYS, with the key it was created with. Deleting it meant the
    // retry minted a new key while the first encode — which may well have
    // been accepted before the answer was lost — was PUTting to the old one.
    expect(rows()).toHaveLength(1)
    expect(rows()[0].status).toBe('queued')
    expect(rows()[0].output_key).toBe('key-1-copy-instagram.mp4')
  })

  it('marks the job failed when the refusal will not fix itself', async () => {
    answer = 'refused'
    const out = await runEncodeRequest({ sourceUrl: SOURCE, platform: 'instagram', seconds: 20 })
    expect(out.at).toBe('refused')
    const row = rows()[0]
    expect(row.status).toBe('failed')
    expect(row.error).toMatch(/400/)
  })

  it('says so plainly when there is no encoder at all', async () => {
    answer = 'stub'
    const out = await runEncodeRequest({ sourceUrl: SOURCE, platform: 'instagram', seconds: 20 })
    expect(out).toEqual({ at: 'refused', reason: 'no encoder is configured on this workspace' })
    // …and does not leave a row nobody will ever finish
    expect(rows()[0].status).toBe('failed')
  })
})

/**
 * The key on the row is the key the bytes went to. Always.
 *
 * A row whose `output_key` names an object nothing ever wrote reads back as
 * `ready` with a public URL that 404s — and the publish job then attaches
 * that URL to a client's post.
 */
describe('the key never moves', () => {
  const cold = (over: Record<string, unknown> = {}): Row => ({
    id: encodeJobId(SOURCE, 'instagram'),
    source_url: SOURCE, platform: 'instagram', status: 'queued', attempts: 1,
    output_key: 'key-original-copy-instagram.mp4', target_source: 'measured',
    bytes: null, width: null, height: null, duration_sec: 20, video_kbps: null,
    error: null, asset_id: null, version_id: null, slide_index: null,
    created_at: '2026-09-04T00:00:00.000Z',
    updated_at: new Date(Date.now() - REASK_GRACE_MS - 5_000).toISOString(),
    ...over,
  } as unknown as Row)

  it('re-signs the same key when an earlier ask was lost', async () => {
    fake.restore()
    fake = seedDb({ encode_jobs: [cold()] })
    const out = await runEncodeRequest({ sourceUrl: SOURCE, platform: 'instagram', seconds: 20 })
    expect(out.at).toBe('asked')
    expect(presigned).toEqual(['key-original-copy-instagram.mp4'])
    expect(asked[0].uploadUrl).toContain('key-original-copy-instagram.mp4')
    expect(rows()[0].output_key).toBe('key-original-copy-instagram.mp4')
    expect(rows()[0].attempts).toBe(2)
  })

  it('leaves a row alone that was created moments ago', async () => {
    fake.restore()
    fake = seedDb({ encode_jobs: [cold({ updated_at: new Date().toISOString() })] })
    const out = await runEncodeRequest({ sourceUrl: SOURCE, platform: 'instagram', seconds: 20 })
    expect(out).toMatchObject({ at: 'existing', status: 'queued' })
    expect(asked).toHaveLength(0)
  })

  it('will not re-ask a row that is out of tries', async () => {
    fake.restore()
    fake = seedDb({ encode_jobs: [cold({ attempts: 3 })] })
    const out = await runEncodeRequest({ sourceUrl: SOURCE, platform: 'instagram', seconds: 20 })
    expect(out).toMatchObject({ at: 'existing' })
    expect(asked).toHaveLength(0)
  })
})

/**
 * The sweep: the promise that a copy always ends, one way or the other.
 *
 * Without it a machine killed mid-encode leaves the row `running` for ever,
 * the publish job cycles queued -> queued -> queued every ten minutes, and no
 * row anywhere says "failed".
 */
describe('settling copies nobody is going to finish', () => {
  const HOUR = 60 * 60 * 1000
  const stuck = (over: Record<string, unknown>): Row => ({
    id: encodeJobId(SOURCE, 'instagram'),
    source_url: SOURCE, platform: 'instagram', status: 'running', attempts: 1,
    output_key: 'key-original-copy-instagram.mp4', target_source: 'measured',
    bytes: null, width: null, height: null, duration_sec: 20, video_kbps: null,
    error: null, asset_id: null, version_id: null, slide_index: null,
    created_at: '2026-09-04T00:00:00.000Z',
    updated_at: new Date(Date.now() - 4 * HOUR).toISOString(),
    ...over,
  } as unknown as Row)

  it('leaves a copy that is merely slow alone', async () => {
    fake.restore()
    fake = seedDb({ encode_jobs: [stuck({ updated_at: new Date(Date.now() - 20 * 60_000).toISOString() })] })
    expect(await sweepStaleEncodes()).toEqual({ retried: 0, gaveUp: 0 })
    expect(rows()[0].status).toBe('running')
    expect(asked).toHaveLength(0)
  })

  it('asks again — with the same key — while there are tries left', async () => {
    fake.restore()
    fake = seedDb({ encode_jobs: [stuck({ attempts: 1 })] })
    expect(await sweepStaleEncodes()).toEqual({ retried: 1, gaveUp: 0 })
    expect(asked).toHaveLength(1)
    expect(presigned).toEqual(['key-original-copy-instagram.mp4'])
    const row = rows()[0]
    expect(row.status).toBe('running')
    expect(row.attempts).toBe(2)
    expect(row.output_key).toBe('key-original-copy-instagram.mp4')
  })

  it('waits longer before each retry', () => {
    const now = Date.now()
    // 90 minutes, then 180, then 270 — a transient blip is retried soon, a
    // machine that keeps swallowing jobs is not hammered
    expect(Date.parse(staleBeforeFor(0, now))).toBe(now - 90 * 60_000)
    expect(Date.parse(staleBeforeFor(1, now))).toBe(now - 180 * 60_000)
    expect(Date.parse(staleBeforeFor(2, now))).toBe(now - 270 * 60_000)
  })

  it('gives up after three, in words a person can act on', async () => {
    fake.restore()
    // three attempts, and stale even against the longest window
    fake = seedDb({ encode_jobs: [stuck({ attempts: 3, updated_at: new Date(Date.now() - 12 * HOUR).toISOString() })] })
    expect(await sweepStaleEncodes()).toEqual({ retried: 0, gaveUp: 1 })
    const row = rows()[0]
    expect(row.status).toBe('failed')
    expect(row.error).toBe(GAVE_UP_MESSAGE)
    expect(GAVE_UP_MESSAGE).toBe('The clean copy did not finish — try again or post a smaller export')
    expect(asked).toHaveLength(0)
  })

  it('never touches a copy that already finished', async () => {
    fake.restore()
    fake = seedDb({
      encode_jobs: [stuck({
        status: 'done', attempts: 1,
        updated_at: new Date(Date.now() - 12 * HOUR).toISOString(),
      })],
    })
    expect(await sweepStaleEncodes()).toEqual({ retried: 0, gaveUp: 0 })
    expect(rows()[0].status).toBe('done')
  })
})

describe('what it will not even try', () => {
  it('refuses a URL that is not one of ours', async () => {
    expect(await runEncodeRequest({ sourceUrl: 'ftp://x/y.mp4', platform: 'instagram' }))
      .toEqual({ at: 'refused', reason: 'that is not a file we hold' })
    expect(rows()).toHaveLength(0)
  })

  it('refuses a channel that is not a channel', async () => {
    const out = await runEncodeRequest({ sourceUrl: SOURCE, platform: 'myspace' })
    expect(out).toEqual({ at: 'refused', reason: 'myspace is not a channel' })
    expect(asked).toHaveLength(0)
  })
})

describe('the finished row', () => {
  it('reads back as a copy the composer can use', async () => {
    await runEncodeRequest({ sourceUrl: SOURCE, platform: 'instagram', seconds: 20 })
    const id = rows()[0].id
    const { settleEncodeJob, progressOf } = await import('../app/lib/encode-jobs')
    await settleEncodeJob({ id, ok: true, bytes: 24_917_504, width: 1080, height: 1920, durationSec: 20 })

    const after = await table<EncodeJob>('encode_jobs').get(id)
    expect(progressOf(after)).toEqual({
      status: 'ready',
      url: 'https://media.example.com/key-1-copy-instagram.mp4',
      bytes: 24_917_504,
      width: 1080,
      height: 1920,
      seconds: 20,
    })
  })
})
