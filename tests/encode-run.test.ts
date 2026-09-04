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
      if (answer === 'busy') return { accepted: false, busy: true, permanent: false, reason: 'the encoder is busy' }
      if (answer === 'refused') return { accepted: false, busy: false, permanent: true, reason: 'the encoder refused the job (400)' }
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
const {
  GAVE_UP_MESSAGE, encodeFailureIsPermanent, encodeJobId, progressOf,
  settleEncodeJob, staleBeforeFor,
} = await import('../app/lib/encode-jobs')

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
    // and everything a retry needs to rebuild the SAME copy
    expect(row.kind).toBe('reel')
    expect(row.duration_sec).toBe(20)

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
    kind: 'reel',
    output_key: 'key-original-copy-instagram.mp4', target_source: 'measured',
    bytes: null, width: null, height: null, duration_sec: 20, video_kbps: null,
    error: null, asset_id: null, version_id: null, slide_index: null,
    created_at: new Date(Date.now() - REASK_GRACE_MS - 5_000).toISOString(),
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
    // and at the SAME bitrate: the row's own kind and length, not the blind
    // fallback a forgotten kind would have produced
    expect(asked[0].target.maxrateKbps).toBe(10_000)
    expect(rows()[0].target_source).toBe('measured')
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
    source_url: SOURCE, platform: 'instagram', kind: 'reel',
    status: 'running', attempts: 1,
    output_key: 'key-original-copy-instagram.mp4', target_source: 'measured',
    bytes: null, width: null, height: null, duration_sec: 20, video_kbps: null,
    error: null, asset_id: null, version_id: null, slide_index: null,
    // the ladder is measured from when the copy was first ASKED for, so this
    // is the field that decides whether the sweep touches the row
    created_at: new Date(Date.now() - 4 * HOUR).toISOString(),
    updated_at: new Date(Date.now() - 4 * HOUR).toISOString(),
    ...over,
  } as unknown as Row)

  it('leaves a copy that is merely slow alone', async () => {
    fake.restore()
    fake = seedDb({ encode_jobs: [stuck({ created_at: new Date(Date.now() - 20 * 60_000).toISOString() })] })
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
    // the same copy that was asked for the first time — the row carries the
    // kind and the measured length precisely so a retry cannot downgrade it
    expect(asked[0].target.maxrateKbps).toBe(10_000)
    expect(row.target_source).toBe('measured')
  })

  it('waits longer before each retry, measured from the first ask', () => {
    const now = Date.now()
    // A LADDER against created_at: 90 minutes for the first ask, 180 for the
    // second, 270 for the third — so the whole life of a copy that never
    // reports is bounded at 4.5 hours, not the sum of three growing gaps.
    expect(Date.parse(staleBeforeFor(1, now))).toBe(now - 90 * 60_000)
    expect(Date.parse(staleBeforeFor(2, now))).toBe(now - 180 * 60_000)
    expect(Date.parse(staleBeforeFor(3, now))).toBe(now - 270 * 60_000)
    // a legacy row with no attempts gets the first rung, which is what it
    // was promised, and nothing is ever waited on for longer than the last
    expect(Date.parse(staleBeforeFor(0, now))).toBe(now - 90 * 60_000)
    expect(Date.parse(staleBeforeFor(9, now))).toBe(now - 270 * 60_000)
  })

  /**
   * The promise, walked end to end: a copy that never reports is failed in
   * plain words within four and a half hours.
   *
   * Asserting the helper alone let a 2x error through — the lived windows
   * were 180 / 270 / 360 and the give-up took thirteen and a half hours,
   * while `staleBeforeFor(0)` still read 90 and the test still passed. So
   * this walks a REAL row through real sweeps and asserts the clock.
   */
  it('walks a lost copy to a plain sentence inside four and a half hours', async () => {
    // anchored to the real clock: `seedDb` stamps `updated_at` when it writes,
    // and the sweep refuses a row that is still warm — so a fixed date in the
    // past made this test pass before that wall-clock hour and fail after it
    const START = Date.now()
    const at = (minutes: number) => START + minutes * 60_000
    fake.restore()
    fake = seedDb({
      encode_jobs: [stuck({
        status: 'running', attempts: 1,
        created_at: new Date(START).toISOString(),
        updated_at: new Date(START).toISOString(),
      })],
    })

    // an hour in, nothing has happened yet — the encoder is allowed to be slow
    expect(await sweepStaleEncodes(at(60))).toEqual({ retried: 0, gaveUp: 0 })
    expect(rows()[0].status).toBe('running')

    // 90 minutes: the second ask
    expect(await sweepStaleEncodes(at(90))).toEqual({ retried: 1, gaveUp: 0 })
    expect(rows()[0].attempts).toBe(2)

    // …and it is left alone until its own rung comes round
    expect(await sweepStaleEncodes(at(150))).toEqual({ retried: 0, gaveUp: 0 })

    // 180 minutes: the third and last ask
    expect(await sweepStaleEncodes(at(180))).toEqual({ retried: 1, gaveUp: 0 })
    expect(rows()[0].attempts).toBe(3)
    expect(await sweepStaleEncodes(at(240))).toEqual({ retried: 0, gaveUp: 0 })

    // 270 minutes — four and a half hours — the plain sentence
    expect(await sweepStaleEncodes(at(270))).toEqual({ retried: 0, gaveUp: 1 })
    const row = rows()[0]
    expect(row.status).toBe('failed')
    expect(row.error).toBe(GAVE_UP_MESSAGE)

    // three asks, no more
    expect(asked).toHaveLength(2)     // the two the sweep made; the first predates this row
    expect(at(270) - START).toBe(4.5 * 60 * 60_000)
  })

  it('gives up after three, in words a person can act on', async () => {
    fake.restore()
    // three attempts, and stale even against the longest window
    fake = seedDb({ encode_jobs: [stuck({ attempts: 3, created_at: new Date(Date.now() - 12 * HOUR).toISOString() })] })
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
        created_at: new Date(Date.now() - 12 * HOUR).toISOString(),
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

/**
 * A copy that REPORTS a failure gets another go, too.
 *
 * An R2 PUT that 500s or a download that timed out on a slow morning used to
 * be as terminal as "this file has no video in it": the first `ok: false`
 * failed the row for good, and every future post of that clip to that channel
 * failed permanently until somebody deleted it in the database console. The
 * attempts ladder was only ever covering failures the encoder never reported
 * at all — which is the opposite of the scenario it was asked for.
 */
describe('a failure the encoder reports', () => {
  const live = (over: Record<string, unknown> = {}): Row => ({
    id: encodeJobId(SOURCE, 'instagram'),
    source_url: SOURCE, platform: 'instagram', kind: 'reel',
    status: 'running', attempts: 1,
    output_key: 'key-original-copy-instagram.mp4', target_source: 'measured',
    bytes: null, width: null, height: null, duration_sec: 20, video_kbps: null,
    error: null, asset_id: null, version_id: null, slide_index: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    ...over,
  } as unknown as Row)

  const settle = (reason: string) => settleEncodeJob({
    id: encodeJobId(SOURCE, 'instagram'), ok: false, error: reason,
  })

  it('goes back to the queue with the reason kept, and the same key', async () => {
    fake.restore()
    fake = seedDb({ encode_jobs: [live({ attempts: 1 })] })
    const out = await settle('the copy would not upload (500)')
    expect(out.retrying).toBe(true)

    const row = rows()[0]
    expect(row.status).toBe('queued')
    expect(row.error).toBe('the copy would not upload (500)')
    expect(row.output_key).toBe('key-original-copy-instagram.mp4')
    // the attempt is spent by the next ASK, not by the failure — counting it
    // in both places would give a clip one real retry instead of two
    expect(row.attempts).toBe(1)
    // and the person waiting is not shown an error about an attempt the
    // system has already moved past
    expect(progressOf(row)).toEqual({ status: 'encoding' })
  })

  it('is picked up by the very next sweep, not an hour and a half later', async () => {
    fake.restore()
    fake = seedDb({ encode_jobs: [live({ attempts: 1 })] })
    await settle('the source would not download (503)')
    // created seconds ago, so no time-based window has passed at all
    expect(await sweepStaleEncodes()).toEqual({ retried: 1, gaveUp: 0 })
    expect(rows()[0].status).toBe('running')
    expect(rows()[0].attempts).toBe(2)
    expect(presigned).toEqual(['key-original-copy-instagram.mp4'])
  })

  it('gives up on the last attempt, in the same plain words', async () => {
    fake.restore()
    fake = seedDb({ encode_jobs: [live({ attempts: 3 })] })
    const out = await settle('the copy would not upload (500)')
    expect(out.retrying).toBe(false)
    const row = rows()[0]
    expect(row.status).toBe('failed')
    expect(row.error).toBe('the copy would not upload (500)')
    expect(progressOf(row)).toEqual({
      status: 'failed', reason: 'the copy would not upload (500)',
    })
  })

  it('does not retry a reason a second attempt could not improve on', async () => {
    for (const reason of [
      'the source has no video in it',
      'this clip is HDR and this encoder cannot convert it — export a standard (BT.709) version',
      'no encoder is configured on this workspace',
      'sourceUrl is not on this workspace’s file storage',
    ]) {
      fake.restore()
      fake = seedDb({ encode_jobs: [live({ attempts: 1 })] })
      const out = await settle(reason)
      expect(out.retrying, reason).toBe(false)
      expect(rows()[0].status, reason).toBe('failed')
      expect(encodeFailureIsPermanent(reason)).toBe(true)
    }
  })

  it('treats an ordinary bad moment as worth another go', () => {
    for (const reason of [
      'the copy would not upload (500)',
      'the source would not download (502)',
      'the encode failed: Conversion failed!',
      'the encoder stopped unexpectedly: out of memory',
      'timed out after 2700s',
    ]) {
      expect(encodeFailureIsPermanent(reason), reason).toBe(false)
    }
    expect(encodeFailureIsPermanent(null)).toBe(false)
  })

  it('a 4xx from the encoder is permanent; a 5xx is not', async () => {
    answer = 'refused'
    fake.restore()
    fake = seedDb({ encode_jobs: [] })
    await runEncodeRequest({ sourceUrl: SOURCE, platform: 'instagram', seconds: 20 })
    expect(rows()[0].status).toBe('failed')
  })
})
