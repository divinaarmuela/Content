import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import { table } from '@/lib/db'
import type { EncodeJob, Row } from '@/lib/db-types'

/**
 * The encoder's callback: the one public door onto `encode_jobs`.
 *
 * What it writes becomes the video sent to a client's real account, so the
 * two things worth testing hard are the signature (nothing unsigned gets in)
 * and the claim (a late or duplicate delivery cannot overwrite a job somebody
 * already settled).
 *
 * The database is a real one in miniature, so every assertion is made on the
 * row itself rather than on a mock's call log.
 */

const SECRET = 'callback-test-secret'

/** Every event the route announced, so "the waiting posts were woken" is checkable. */
let sent: { name: string; data: Record<string, unknown> }[] = []
vi.mock('../app/inngest/client', () => ({
  inngest: {
    send: async (e: { name: string; data: Record<string, unknown> }) => { sent.push(e) },
  },
}))

const { POST } = await import('../app/api/media/encode/callback/route')

const sign = (body: string, at = Math.floor(Date.now() / 1000), secret = SECRET) =>
  `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`

function deliver(body: string, header: string | null = sign(body)) {
  return POST(new Request('https://app.example.com/api/media/encode/callback', {
    method: 'POST',
    body,
    headers: header ? { 'x-encoder-signature': header } : {},
  }))
}

const JOB_ID = 'abc123__instagram'

const job = (status: string): Row => ({
  id: JOB_ID,
  source_url: 'https://media.example.com/master.mp4',
  platform: 'instagram',
  status,
  output_key: '1725-aa-copy-instagram.mp4',
  bytes: null, width: null, height: null, duration_sec: null, video_kbps: null,
  error: null,
  created_at: '2026-09-03T00:00:00.000Z',
  updated_at: '2026-09-03T00:00:00.000Z',
} as unknown as Row)

let fake: ReturnType<typeof seedDb>
beforeEach(() => {
  sent = []
  process.env.ENCODER_CALLBACK_SECRET = SECRET
  fake = seedDb({ encode_jobs: [job('running')] })
})
afterEach(() => {
  fake.restore()
  delete process.env.ENCODER_CALLBACK_SECRET
})

const row = () => table<EncodeJob>('encode_jobs').get(JOB_ID)

describe('the encode callback', () => {
  it('turns a signed success into a finished job', async () => {
    const body = JSON.stringify({
      jobId: JOB_ID, ok: true, bytes: 24_917_504, durationSec: 19.98,
      width: 1080, height: 1920, videoKbps: 9820,
    })
    const res = await deliver(body)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, changed: true })

    const after = await row()
    expect(after!.status).toBe('done')
    expect(after!.bytes).toBe(24_917_504)
    expect(after!.width).toBe(1080)
    expect(after!.height).toBe(1920)
    expect(after!.video_kbps).toBe(9820)
    // the key was written when the upload was presigned; the callback carries
    // no key and must not clear the only record of where the copy went
    expect(after!.output_key).toBe('1725-aa-copy-instagram.mp4')
    expect(after!.error).toBeNull()
  })

  it('announces the copy so waiting posts are handed back', async () => {
    await deliver(JSON.stringify({ jobId: JOB_ID, ok: true, bytes: 100 }))
    expect(sent).toEqual([{
      name: 'media/encode.finished',
      data: {
        jobId: JOB_ID,
        sourceUrl: 'https://media.example.com/master.mp4',
        platform: 'instagram',
        ok: true,
      },
    }])
  })

  it('records a failure with its reason, and leaves no copy behind', async () => {
    await deliver(JSON.stringify({ jobId: JOB_ID, ok: false, error: 'the source has no video in it' }))
    const after = await row()
    expect(after!.status).toBe('failed')
    expect(after!.error).toBe('the source has no video in it')
  })

  it('refuses an unsigned delivery and changes nothing', async () => {
    const body = JSON.stringify({ jobId: JOB_ID, ok: true, bytes: 100 })
    const res = await deliver(body, null)
    expect(res.status).toBe(401)
    expect((await row())!.status).toBe('running')
    expect(sent).toEqual([])
  })

  it('refuses a body edited after it was signed', async () => {
    const honest = JSON.stringify({ jobId: JOB_ID, ok: true, bytes: 100 })
    const header = sign(honest)
    const swapped = JSON.stringify({ jobId: JOB_ID, ok: true, bytes: 999_999_999 })
    const res = await deliver(swapped, header)
    expect(res.status).toBe(401)
    expect((await row())!.status).toBe('running')
  })

  it('refuses a delivery signed with the wrong secret', async () => {
    const body = JSON.stringify({ jobId: JOB_ID, ok: true })
    const res = await deliver(body, sign(body, undefined, 'wrong'))
    expect(res.status).toBe(401)
    expect((await row())!.status).toBe('running')
  })

  it('refuses an hour-old replay', async () => {
    const body = JSON.stringify({ jobId: JOB_ID, ok: true })
    const res = await deliver(body, sign(body, Math.floor(Date.now() / 1000) - 3600))
    expect(res.status).toBe(401)
    expect((await row())!.status).toBe('running')
  })

  it('lets a duplicate report land harmlessly on a settled job', async () => {
    const body = JSON.stringify({ jobId: JOB_ID, ok: true, bytes: 100 })
    await deliver(body)
    sent = []
    // the encoder retries its report; the second one must not re-announce or
    // re-write, and must NOT be a 4xx, which would make it retry again
    const again = await deliver(JSON.stringify({ jobId: JOB_ID, ok: false, error: 'oh no' }))
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ ok: true, changed: false })
    const after = await row()
    expect(after!.status).toBe('done')
    expect(after!.error).toBeNull()
    expect(sent).toEqual([])
  })

  it('cannot be used to settle a job we have no row for', async () => {
    const res = await deliver(JSON.stringify({ jobId: 'nobody__tiktok', ok: true, bytes: 1 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, changed: false })
    expect(fake.rows('encode_jobs')).toHaveLength(1)
  })

  it('refuses a report that names no job', async () => {
    const body = JSON.stringify({ ok: true })
    const res = await deliver(body)
    expect(res.status).toBe(400)
  })

  it('refuses everything when the secret is not configured', async () => {
    delete process.env.ENCODER_CALLBACK_SECRET
    const body = JSON.stringify({ jobId: JOB_ID, ok: true })
    const res = await deliver(body, sign(body))
    expect(res.status).toBe(401)
    expect((await row())!.status).toBe('running')
  })
})
