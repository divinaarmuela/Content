import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * META'S SIGNED REQUEST — the pure half of the Data Deletion Request Callback
 * (POST /api/meta/data-deletion). No I/O: the route does the database work.
 *
 * What Meta sends (https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback):
 * a form POST with one field, `signed_request`, shaped
 *
 *     <base64url(signature)>.<base64url(JSON payload)>
 *
 * where the signature is HMAC-SHA256 of the ENCODED payload (the text after
 * the dot, exactly as sent) keyed with the app secret, and the payload is
 * `{ algorithm: 'HMAC-SHA256', issued_at, user_id }`. `user_id` is the
 * app-scoped id of the person who asked Meta to delete their data.
 *
 * Every refusal is a value, never a throw, so the route can answer each one
 * with the right status.
 */

export type SignedRequestPayload = {
  algorithm: string
  user_id: string
  issued_at?: number
  [k: string]: unknown
}

export type ParseResult =
  | { ok: true; payload: SignedRequestPayload }
  | { ok: false; reason: 'missing_secret' | 'malformed' | 'bad_signature' | 'wrong_algorithm' | 'no_user' }

/** base64url → bytes; null when the text is not base64url at all */
export function base64UrlDecode(s: string): Buffer | null {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(s)) return null
  // Node's own base64url codec: tolerates missing padding, no alphabet swapping by hand
  try { return Buffer.from(s.replace(/=+$/, ''), 'base64url') } catch { return null }
}

export function base64UrlEncode(b: Buffer | string): string {
  return Buffer.from(b).toString('base64url')
}

/**
 * Split, verify and decode a signed request. The signature is checked BEFORE
 * the payload is trusted for anything, and compared in constant time.
 */
export function parseSignedRequest(signedRequest: unknown, secret: string | undefined | null): ParseResult {
  if (!secret) return { ok: false, reason: 'missing_secret' }
  if (typeof signedRequest !== 'string' || signedRequest.length > 8192) return { ok: false, reason: 'malformed' }
  const parts = signedRequest.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' }
  const [encodedSig, encodedPayload] = parts

  const sig = base64UrlDecode(encodedSig)
  const payloadBytes = base64UrlDecode(encodedPayload)
  if (!sig || !payloadBytes || sig.length === 0) return { ok: false, reason: 'malformed' }

  let payload: unknown
  try { payload = JSON.parse(payloadBytes.toString('utf8')) } catch { return { ok: false, reason: 'malformed' } }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'malformed' }
  const p = payload as Record<string, unknown>

  // Meta's own samples compare the algorithm upper-cased
  if (typeof p.algorithm !== 'string' || p.algorithm.toUpperCase() !== 'HMAC-SHA256') {
    return { ok: false, reason: 'wrong_algorithm' }
  }

  const expected = createHmac('sha256', secret).update(encodedPayload).digest()
  // timingSafeEqual throws on unequal lengths — a short signature is simply wrong
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
    return { ok: false, reason: 'bad_signature' }
  }

  const userId = typeof p.user_id === 'string' ? p.user_id.trim()
    : typeof p.user_id === 'number' ? String(p.user_id) : ''
  if (!userId) return { ok: false, reason: 'no_user' }

  return { ok: true, payload: { ...p, algorithm: p.algorithm, user_id: userId } as SignedRequestPayload }
}

/**
 * The confirmation code for a request: derived from the signed request
 * itself, so a callback Meta delivers twice names the SAME row and the claim
 * records it once. 16 lowercase hex characters — safe as an RTDB key as it
 * stands, and short enough for a person to read out over the phone.
 */
export function confirmationCodeFor(signedRequest: string): string {
  return createHash('sha256').update(signedRequest).digest('hex').slice(0, 16)
}

/** what a code typed into the status page must look like before it goes near a path */
export function isConfirmationCode(code: unknown): code is string {
  return typeof code === 'string' && /^[a-f0-9]{16}$/.test(code)
}

/** the status page link Meta hands back to the person */
export function statusUrl(code: string, base = 'https://app.mdmmarketing.com.au'): string {
  return `${base.replace(/\/+$/, '')}/data-deletion/status?code=${encodeURIComponent(code)}`
}

export type DeletionStatus = 'received' | 'in_progress' | 'completed' | 'nothing_held'

/** plain words for each status, for the public status page */
export function statusWords(status: string): { label: string; detail: string } {
  switch (status) {
    case 'received':
      return { label: 'Received', detail: 'We have your request. A person on our team will work through it; nothing has been deleted yet.' }
    case 'in_progress':
      return { label: 'In progress', detail: 'We are finding and deleting the data we hold about you.' }
    case 'completed':
      return { label: 'Completed', detail: 'The data we held about you has been deleted.' }
    case 'nothing_held':
      return { label: 'Completed — nothing held', detail: 'We checked and held no data linked to you.' }
    default:
      return { label: 'Received', detail: 'We have your request and it is being handled.' }
  }
}
