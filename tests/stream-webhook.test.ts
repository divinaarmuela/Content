import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The Stream webhook, at its only real job: deciding whether to believe a
 * delivery, and turning one it believes into a row change.
 *
 * The database is a spy rather than an emulation — there is no claim and no
 * conditional update to prove here, only "the right patch reached the right
 * uid". What is worth testing hard is the signature, because a verifier that
 * is wrong in the safe direction rejects every genuine delivery silently and
 * the whole live path degrades to a 30-minute poll with nobody noticing.
 */

const SECRET = 'stream-test-secret'

type Update = { patch: Record<string, unknown>; column: string; value: unknown }
const updates: Update[] = []

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: (column: string, value: unknown) => {
          updates.push({ patch, column, value })
          return Promise.resolve({ error: null })
        },
      }),
    }),
  },
}))

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

// statically, after the mock above — the module reads its secret from the
// environment per call, so the tests can set it without re-importing
const { handleStreamWebhook } = await import('../app/lib/stream')
const handle = (body: string, header: string | null) => handleStreamWebhook(body, header)

beforeEach(() => { updates.length = 0 })

afterEach(() => { delete process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET })

describe('with a secret configured', () => {
  beforeEach(() => { process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET = SECRET })

  it('accepts a correctly signed delivery and records the encode', async () => {
    const res = await handle(READY, sign(READY))
    expect(res.status).toBe(200)
    expect(updates).toHaveLength(1)
    expect(updates[0].column).toBe('stream_uid')
    expect(updates[0].value).toBe('deadbeefcafe')
    expect(updates[0].patch).toMatchObject({
      state: 'ready',
      playback_hls: 'https://customer-abc123.cloudflarestream.com/deadbeefcafe/manifest/video.m3u8',
      width: 1080,
      height: 1920,
      error: null,
    })
  })

  it('refuses a body that was changed after signing', async () => {
    const header = sign(READY)
    const tampered = READY.replace('deadbeefcafe', 'someoneelsesuid')
    const res = await handle(tampered, header)
    expect(res.status).toBe(401)
    expect(updates).toHaveLength(0)
  })

  it('refuses a signature made with the wrong secret', async () => {
    const res = await handle(READY, sign(READY, nowSec(), 'not-our-secret'))
    expect(res.status).toBe(401)
    expect(updates).toHaveLength(0)
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
    expect(updates).toHaveLength(0)
  })
})

describe('with no secret configured', () => {
  it('accepts an unsigned delivery — the poller reaches the same answer anyway', async () => {
    const res = await handle(READY, null)
    expect(res.status).toBe(200)
    expect(updates).toHaveLength(1)
  })

  it('still refuses to invent state from a payload with no video', async () => {
    expect((await handle('{"hello":"world"}', null)).status).toBe(400)
    expect((await handle('not json at all', null)).status).toBe(400)
    expect(updates).toHaveLength(0)
  })

  it('records a failed encode with the reason Cloudflare gave', async () => {
    const body = JSON.stringify({
      uid: 'u1', status: { state: 'error', errorReasonText: 'The file is not a video' },
    })
    const res = await handle(body, null)
    expect(res.status).toBe(200)
    expect(updates[0].patch).toMatchObject({ state: 'error', error: 'The file is not a video' })
  })
})
