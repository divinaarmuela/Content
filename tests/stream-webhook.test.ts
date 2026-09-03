import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedDb } from './helpers/fake-db'
import { table } from '@/lib/db'
import type { Row, VideoPreview } from '@/lib/db-types'

/**
 * The Stream webhook, at its only real job: deciding whether to believe a
 * delivery, and turning one it believes into a row change.
 *
 * The database is a real one in miniature, so "the right patch reached the
 * right uid" is asserted on the row itself. What is worth testing hard is the
 * signature, because a verifier that is wrong in the safe direction rejects
 * every genuine delivery silently and the whole live path degrades to a
 * 30-minute poll with nobody noticing.
 */

const SECRET = 'stream-test-secret'

const { handleStreamWebhook } = await import('../app/lib/stream')
const handle = (body: string, header: string | null) => handleStreamWebhook(body, header)

/** The real clock, because the freshness window is measured against it. */
const nowSec = () => Math.floor(Date.now() / 1000)

function sign(body: string, time: string | number = nowSec(), secret = SECRET): string {
  const sig = createHmac('sha256', secret).update(`${time}.${body}`).digest('hex')
  return `time=${time},sig1=${sig}`
}

const READY = JSON.stringify({
  uid: 'deadbeefcafe',
  readyToStream: true,
  status: { state: 'ready' },
  playback: { hls: 'https://customer-abc123.cloudflarestream.com/deadbeefcafe/manifest/video.m3u8' },
  thumbnail: 'https://customer-abc123.cloudflarestream.com/deadbeefcafe/thumbnails/thumbnail.jpg',
  duration: 12,
  input: { width: 1080, height: 1920 },
})

/** the two encodes a delivery in these tests can be about */
const preview = (id: string, uid: string): Row => ({
  id,
  source_url: `https://media.mdmmarketing.com.au/${id}.mp4`,
  stream_uid: uid,
  state: 'processing',
  error: 'a stale reason from an earlier attempt',
  updated_at: '2026-09-01T00:00:00.000Z',
} as unknown as Row)

let fake: ReturnType<typeof seedDb>
/** read back the way the app reads it, so an absent field is the `null` the
 *  helper normalises it to rather than a missing key */
const rowFor = async (uid: string) =>
  (await table<VideoPreview>('video_previews').list({ where: r => r.stream_uid === uid }))[0]

beforeEach(() => {
  fake = seedDb({
    video_previews: [preview('p1', 'deadbeefcafe'), preview('p2', 'u1')],
  })
})

afterEach(() => {
  fake.restore()
  delete process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET
})

describe('with a secret configured', () => {
  beforeEach(() => { process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET = SECRET })

  it('accepts a correctly signed delivery and records the encode', async () => {
    const res = await handle(READY, sign(READY))
    expect(res.status).toBe(200)
    expect(await rowFor('deadbeefcafe')).toMatchObject({
      state: 'ready',
      playback_hls: 'https://customer-abc123.cloudflarestream.com/deadbeefcafe/manifest/video.m3u8',
      width: 1080,
      height: 1920,
      // a successful encode clears whatever error the row was carrying
      error: null,
    })
    // the other encode is untouched: a delivery names one uid
    expect(await rowFor('u1')).toMatchObject({ state: 'processing' })
  })

  it('refuses a body that was changed after signing', async () => {
    const header = sign(READY)
    const tampered = READY.replace('deadbeefcafe', 'someoneelsesuid')
    const res = await handle(tampered, header)
    expect(res.status).toBe(401)
    expect(await rowFor('deadbeefcafe')).toMatchObject({ state: 'processing' })
  })

  it('refuses a signature made with the wrong secret', async () => {
    const res = await handle(READY, sign(READY, nowSec(), 'not-our-secret'))
    expect(res.status).toBe(401)
    expect(await rowFor('deadbeefcafe')).toMatchObject({ state: 'processing' })
  })

  it('refuses a replay of a delivery from an hour ago', async () => {
    const old = nowSec() - 3600
    const res = await handle(READY, sign(READY, old))
    expect(res.status).toBe(401)
  })

  it('refuses a missing or malformed header instead of throwing', async () => {
    for (const header of [null, '', 'garbage', 'time=1700000000']) {
      const res = await handle(READY, header)
      expect(res.status).toBe(401)
    }
    expect(await rowFor('deadbeefcafe')).toMatchObject({ state: 'processing' })
  })
})

describe('with no secret configured', () => {
  it('accepts an unsigned delivery — the poller reaches the same answer anyway', async () => {
    const res = await handle(READY, null)
    expect(res.status).toBe(200)
    expect(await rowFor('deadbeefcafe')).toMatchObject({ state: 'ready' })
  })

  it('still refuses to invent state from a payload with no video', async () => {
    expect((await handle('{"hello":"world"}', null)).status).toBe(400)
    expect((await handle('not json at all', null)).status).toBe(400)
    expect(await rowFor('deadbeefcafe')).toMatchObject({ state: 'processing' })
  })

  it('records a failed encode with the reason Cloudflare gave', async () => {
    const body = JSON.stringify({
      uid: 'u1', status: { state: 'error', errorReasonText: 'The file is not a video' },
    })
    const res = await handle(body, null)
    expect(res.status).toBe(200)
    expect(await rowFor('u1')).toMatchObject({ state: 'error', error: 'The file is not a video' })
  })
})
