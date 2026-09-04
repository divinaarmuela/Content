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
let asked: { jobId: string; target: Record<string, number> }[] = []
/** What the fake encoder answers with. */
let answer: 'accepted' | 'busy' | 'refused' | 'stub' = 'accepted'

vi.mock('../app/lib/encoder', async () => {
  const real = await vi.importActual<typeof import('../app/lib/encoder')>('../app/lib/encoder')
  return {
    ...real,
    encoderConfigured: () => true,
    callbackUrl: () => 'https://app.example.com/api/media/encode/callback',
    requestEncode: async (ask: { jobId: string; target: Record<string, number> }) => {
      asked.push({ jobId: ask.jobId, target: ask.target })
      if (answer === 'busy') return { accepted: false, busy: true, reason: 'the encoder is busy' }
      if (answer === 'refused') return { accepted: false, busy: false, reason: 'the encoder refused the job (400)' }
      return { accepted: true, stub: answer === 'stub' }
    },
  }
})

/** R2 without R2: a key and a URL, minted the way the real one does. */
let signed = 0
vi.mock('../app/lib/storage', async () => {
  const real = await vi.importActual<typeof import('../app/lib/storage')>('../app/lib/storage')
  return {
    ...real,
    publicBase: () => 'https://media.example.com',
    signUpload: async (filename: string) => {
      signed++
      const key = `key-${signed}-${filename}`
      return {
        key,
        signedUrl: `https://r2.example.com/${key}?sig=1`,
        publicUrl: `https://media.example.com/${key}`,
        backend: 'r2' as const,
      }
    },
  }
})

const { runEncodeRequest } = await import('../app/lib/encode-run')

const SOURCE = 'https://media.example.com/master.mp4'

let fake: ReturnType<typeof seedDb>
beforeEach(() => {
  asked = []
  signed = 0
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
  it('puts the row back and throws so Inngest retries, when the machine is busy', async () => {
    answer = 'busy'
    await expect(runEncodeRequest({ sourceUrl: SOURCE, platform: 'instagram', seconds: 20 }))
      .rejects.toThrow(/busy/)
    // no row left behind: a queued encode job nothing is working on is a row
    // that waits forever
    expect(rows()).toHaveLength(0)
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
