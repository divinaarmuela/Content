import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { EncodeTarget } from './media-fit-core'

/**
 * How the app talks to the encoder (`services/encoder`).
 *
 * The encoder is one small Fly machine that makes a publish-grade 1080p H.264
 * copy of a video too big for a channel. This file is the whole of our side
 * of that conversation: ask, and verify what comes back.
 *
 * ── Unset means off, everywhere ──
 *
 * `ENCODER_URL`, `ENCODER_TOKEN` and `ENCODER_CALLBACK_SECRET` are read
 * LAZILY, per call, never at module load (CLAUDE.md trap 7). With
 * `ENCODER_URL` unset nothing is asked of anything: `requestEncode` returns a
 * pretend accepted job so the surrounding code can be exercised end to end,
 * and `smallerCopyOf` falls back to the Cloudflare Stream player file exactly
 * as it did before this service existed.
 *
 * ── The callback is signed, and that is not optional ──
 *
 * The encoder reports back with a URL that goes onto a client's real account.
 * An unsigned "your job is done, here is the file" POST is somebody else's
 * video on somebody else's Instagram, so the signature is checked before a
 * word of the body is believed — same shape as the Cloudflare Stream webhook
 * we already verify, so there is one thing to learn rather than two.
 */

export const CALLBACK_SIGNATURE_HEADER = 'x-encoder-signature'

/** How old a delivery may be. Long enough for a retry, short enough that a
 *  captured one is useless tomorrow. */
export const CALLBACK_MAX_AGE_SEC = 15 * 60

const encoderUrl = () => (process.env.ENCODER_URL ?? '').trim().replace(/\/$/, '')
const encoderToken = () => (process.env.ENCODER_TOKEN ?? '').trim()
export const callbackSecret = () => (process.env.ENCODER_CALLBACK_SECRET ?? '').trim()

/** Is there a real encoder to ask? */
export function encoderConfigured(): boolean {
  return Boolean(encoderUrl() && encoderToken())
}

/**
 * Where the encoder should report back to.
 *
 * DELIBERATELY not per-job. The brief asked whether this URL should be
 * unguessable and unique to each encode; it is neither — it is one fixed
 * public path, outside the middleware matcher, the same for every job. What
 * makes that sound is that guessing the URL buys nothing: the body must carry
 * a valid HMAC under a secret only the encoder holds, the timestamp inside
 * that signature stops a captured delivery being replayed, and the settle is
 * a claim, so even a perfectly forged duplicate lands on a row that is
 * already done. The per-job secret in this design is the presigned UPLOAD
 * URL, which is where the bytes actually go.
 */
export function callbackUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'https://app.mdmmarketing.com.au')
    .trim().replace(/\/$/, '')
  return `${base}/api/media/encode/callback`
}

export type EncodeAsk = {
  jobId: string
  sourceUrl: string
  target: EncodeTarget
  /** a presigned R2 PUT the finished copy goes straight into */
  uploadUrl: string
  callbackUrl: string
}

export type EncodeAsked =
  | { accepted: true; stub: boolean }
  | { accepted: false; busy: boolean; reason: string }

/**
 * How long to wait for the encoder to say "yes, I have it".
 *
 * The answer is a 202 that arrives in milliseconds; anything slower is a
 * machine that took the connection and stalled. Without a deadline that holds
 * an Inngest step open until undici's own header timeout, which turns a
 * momentary blip into a stuck step.
 */
export const ASK_TIMEOUT_MS = 30_000

/**
 * Ask for one copy. Never throws: a refusal is a state the job row records,
 * not an exception that loses the post.
 */
export async function requestEncode(ask: EncodeAsk): Promise<EncodeAsked> {
  const base = encoderUrl()
  const token = encoderToken()
  if (!base || !token) {
    // The dry run. Nothing is encoded and nothing will call back — the caller
    // is told so, and the job row it just wrote will sit at 'queued' until a
    // person or a sweep clears it. This exists so every path around the
    // encoder can be walked in a test and on a laptop.
    return { accepted: true, stub: true }
  }

  try {
    const res = await fetch(`${base}/encode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jobId: ask.jobId,
        sourceUrl: ask.sourceUrl,
        uploadUrl: ask.uploadUrl,
        callbackUrl: ask.callbackUrl,
        target: ask.target,
      }),
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (res.status === 503) {
      return { accepted: false, busy: true, reason: 'the encoder is busy; asking again shortly' }
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { accepted: false, busy: false, reason: `the encoder refused the job (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}` }
    }
    return { accepted: true, stub: false }
  } catch (e) {
    return { accepted: false, busy: true, reason: e instanceof Error ? e.message : 'could not reach the encoder' }
  }
}

export type EncodeReport = {
  jobId: string
  ok: boolean
  bytes: number | null
  durationSec: number | null
  width: number | null
  height: number | null
  videoKbps: number | null
  error?: string
}

/** `t=<unix seconds>,v1=<hex>` — the header the encoder signs with. */
export function parseCallbackSignature(header: string | null): { time: number; sig: string } | null {
  if (!header) return null
  let time: number | null = null
  let sig: string | null = null
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=')
    if (key === 't' && value) time = Number(value)
    if (key === 'v1' && value) sig = value
  }
  if (time === null || !Number.isFinite(time) || !sig) return null
  return { time, sig }
}

/** Constant time, so the secret cannot be found a character at a time. */
function sameSignature(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * Should this delivery be believed?
 *
 * Three things have to hold: there is a secret configured at all, the
 * timestamp is recent, and the HMAC over `${t}.${body}` matches. Anything
 * else — no header, a malformed one, an old one — is a no, in plain words,
 * because a verifier that is wrong in the safe direction silently rejects
 * every genuine delivery and the whole live path quietly stops working.
 */
export function verifyCallback(
  rawBody: string, header: string | null, nowMs = Date.now(),
): { ok: true } | { ok: false; why: string } {
  const secret = callbackSecret()
  if (!secret) return { ok: false, why: 'no callback secret is configured' }
  const parsed = parseCallbackSignature(header)
  if (!parsed) return { ok: false, why: 'the signature header is missing or malformed' }

  const ageSec = Math.abs(Math.floor(nowMs / 1000) - parsed.time)
  if (ageSec > CALLBACK_MAX_AGE_SEC) return { ok: false, why: 'the signature is too old' }

  const expected = createHmac('sha256', secret).update(`${parsed.time}.${rawBody}`).digest('hex')
  if (!sameSignature(expected, parsed.sig)) return { ok: false, why: 'the signature does not match' }
  return { ok: true }
}

/** Read a delivery's body into the shape the job row is updated from. */
export function parseReport(raw: unknown): EncodeReport | null {
  const body = (raw ?? {}) as Record<string, unknown>
  const jobId = String(body.jobId ?? '').trim()
  if (!jobId) return null
  const num = (v: unknown): number | null => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return {
    jobId,
    ok: body.ok === true,
    bytes: num(body.bytes),
    durationSec: num(body.durationSec),
    width: num(body.width),
    height: num(body.height),
    videoKbps: num(body.videoKbps),
    ...(typeof body.error === 'string' && body.error ? { error: body.error.slice(0, 500) } : {}),
  }
}
