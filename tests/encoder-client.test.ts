import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CALLBACK_MAX_AGE_SEC, callbackUrl, encoderConfigured, parseCallbackSignature,
  parseReport, requestEncode, verifyCallback,
} from '../app/lib/encoder'
import { encodeTargetFor } from '../app/lib/media-fit-core'

/**
 * Our half of the conversation with the encoder.
 *
 * Nothing here reaches the network: `fetch` is stubbed and records what was
 * asked, so "the bearer token was sent" and "a 503 is a wait, not a failure"
 * are assertions rather than hopes.
 *
 * The verifier gets the harder half of the file. A verifier that is wrong in
 * the LAX direction lets a stranger put their video on a client's Instagram;
 * one that is wrong in the strict direction silently rejects every genuine
 * delivery and the whole live path stops working with nobody noticing.
 */

const SECRET = 'encoder-test-secret'
const target = encodeTargetFor('instagram', 'reel', 20)!

let calls: { url: string; init: RequestInit }[] = []
let reply: Response = new Response('{"accepted":true}', { status: 202 })
let throws: Error | null = null

vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
  calls.push({ url: String(input), init: init ?? {} })
  if (throws) throw throws
  return reply
})

const ask = () => requestEncode({
  jobId: 'job-1',
  sourceUrl: 'https://media.example.com/master.mp4',
  target,
  uploadUrl: 'https://r2.example.com/put?sig=1',
  callbackUrl: 'https://app.example.com/api/media/encode/callback',
})

beforeEach(() => {
  calls = []
  throws = null
  reply = new Response('{"accepted":true}', { status: 202 })
  process.env.ENCODER_URL = 'https://encoder.example.com'
  process.env.ENCODER_TOKEN = 'bearer-token'
  process.env.ENCODER_CALLBACK_SECRET = SECRET
})

afterEach(() => {
  delete process.env.ENCODER_URL
  delete process.env.ENCODER_TOKEN
  delete process.env.ENCODER_CALLBACK_SECRET
  delete process.env.NEXT_PUBLIC_APP_URL
})

describe('asking the encoder', () => {
  it('sends the job with the bearer token', async () => {
    expect(await ask()).toEqual({ accepted: true, stub: false })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://encoder.example.com/encode')
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer bearer-token')
    const body = JSON.parse(String(calls[0].init.body))
    expect(body.jobId).toBe('job-1')
    expect(body.target.maxrateKbps).toBe(10_000)
    expect(body.target.bufsizeKbps).toBe(20_000)
    expect(body.uploadUrl).toBe('https://r2.example.com/put?sig=1')
  })

  it('does not mind a trailing slash on the URL', async () => {
    process.env.ENCODER_URL = 'https://encoder.example.com/'
    await ask()
    expect(calls[0].url).toBe('https://encoder.example.com/encode')
  })

  it('reads a 503 as a wait, not a refusal', async () => {
    reply = new Response('{"error":"busy"}', { status: 503 })
    const out = await ask()
    expect(out).toEqual({
      accepted: false, busy: true, permanent: false,
      reason: expect.stringContaining('busy'),
    })
  })

  it('reads an unreachable machine as a wait too', async () => {
    throws = new Error('connect ECONNREFUSED')
    expect(await ask()).toEqual({
      accepted: false, busy: true, permanent: false, reason: 'connect ECONNREFUSED',
    })
  })

  it('reads a 400 as a refusal that will not fix itself', async () => {
    reply = new Response('target.maxrateKbps must be a positive number', { status: 400 })
    const out = await ask()
    // the job description is wrong; the same words next time are refused the
    // same way, so this one does not go round the retry ladder
    expect(out).toEqual({
      accepted: false, busy: false, permanent: true,
      reason: expect.stringContaining('maxrateKbps'),
    })
  })

  it('reads a 500 from the encoder as a bad moment, worth another go', async () => {
    reply = new Response('something went wrong', { status: 500 })
    const out = await ask()
    expect(out).toMatchObject({ accepted: false, busy: false, permanent: false })
  })

  it('pretends, and says it is pretending, with no encoder configured', async () => {
    delete process.env.ENCODER_URL
    expect(encoderConfigured()).toBe(false)
    expect(await ask()).toEqual({ accepted: true, stub: true })
    // and it reached nothing: an unconfigured workspace makes no requests
    expect(calls).toHaveLength(0)
  })

  it('is unconfigured with a URL but no token', async () => {
    delete process.env.ENCODER_TOKEN
    expect(encoderConfigured()).toBe(false)
    expect(await ask()).toEqual({ accepted: true, stub: true })
    expect(calls).toHaveLength(0)
  })
})

describe('where the encoder reports back to', () => {
  it('is this app’s callback route', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com/'
    expect(callbackUrl()).toBe('https://app.example.com/api/media/encode/callback')
  })
})

describe('believing what comes back', () => {
  const body = JSON.stringify({ jobId: 'job-1', ok: true, bytes: 24_917_504 })
  const sign = (payload: string, at = Math.floor(Date.now() / 1000), secret = SECRET) =>
    `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${payload}`).digest('hex')}`

  it('accepts a fresh, correctly signed delivery', () => {
    expect(verifyCallback(body, sign(body))).toEqual({ ok: true })
  })

  it('refuses a body that was changed after it was signed', () => {
    const header = sign(body)
    const tampered = body.replace('job-1', 'job-2')
    expect(verifyCallback(tampered, header)).toEqual({ ok: false, why: 'the signature does not match' })
  })

  it('refuses a delivery signed with the wrong secret', () => {
    expect(verifyCallback(body, sign(body, undefined, 'not-the-secret')))
      .toEqual({ ok: false, why: 'the signature does not match' })
  })

  it('refuses a replay from an hour ago', () => {
    const old = Math.floor(Date.now() / 1000) - CALLBACK_MAX_AGE_SEC - 60
    expect(verifyCallback(body, sign(body, old))).toEqual({ ok: false, why: 'the signature is too old' })
  })

  it('refuses a timestamp from the future for the same reason', () => {
    const ahead = Math.floor(Date.now() / 1000) + CALLBACK_MAX_AGE_SEC + 60
    expect(verifyCallback(body, sign(body, ahead))).toEqual({ ok: false, why: 'the signature is too old' })
  })

  it('refuses a missing or malformed header rather than guessing', () => {
    expect(verifyCallback(body, null).ok).toBe(false)
    expect(verifyCallback(body, 'v1=abc').ok).toBe(false)
    expect(verifyCallback(body, 't=nope,v1=abc').ok).toBe(false)
    expect(verifyCallback(body, '').ok).toBe(false)
  })

  it('refuses everything when no secret is configured', () => {
    delete process.env.ENCODER_CALLBACK_SECRET
    expect(verifyCallback(body, sign(body)))
      .toEqual({ ok: false, why: 'no callback secret is configured' })
  })

  it('reads the header apart', () => {
    expect(parseCallbackSignature('t=123,v1=abc')).toEqual({ time: 123, sig: 'abc' })
    expect(parseCallbackSignature(' t=123 , v1=abc ')).toEqual({ time: 123, sig: 'abc' })
    expect(parseCallbackSignature('t=123')).toBeNull()
  })
})

describe('reading a report', () => {
  it('keeps the numbers that are real numbers', () => {
    expect(parseReport({
      jobId: 'job-1', ok: true, bytes: 100, durationSec: 20,
      width: 1080, height: 1920, videoKbps: 9820,
    })).toEqual({
      jobId: 'job-1', ok: true, bytes: 100, durationSec: 20,
      width: 1080, height: 1920, videoKbps: 9820,
    })
  })

  it('reads a failure, with its reason', () => {
    const out = parseReport({ jobId: 'job-1', ok: false, error: 'the source has no video in it' })!
    expect(out.ok).toBe(false)
    expect(out.error).toBe('the source has no video in it')
    expect(out.bytes).toBeNull()
  })

  it('treats anything that is not `true` as not ok', () => {
    expect(parseReport({ jobId: 'j', ok: 'true' })!.ok).toBe(false)
    expect(parseReport({ jobId: 'j' })!.ok).toBe(false)
  })

  it('says no to a report about no job at all', () => {
    expect(parseReport({ ok: true })).toBeNull()
    expect(parseReport(null)).toBeNull()
  })
})
