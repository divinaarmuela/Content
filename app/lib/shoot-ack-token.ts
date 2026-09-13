import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * "I'VE READ THE PLAN" WITHOUT THE PAGE (13 Sep 2026).
 *
 * A crew member who is not an editor has no card and does not open the
 * shoot page. Their email carries the plan as text and one link; pressing
 * it records their acknowledgement. The link is a signed, per-person,
 * 30-day token: HMAC-SHA256 over `shoot.person.expiry` with a secret the app
 * already holds, so nothing is stored and nobody can forge another
 * person's press. Pure apart from the clock — the secret is a parameter, so
 * the tests sign and check with their own.
 */

export const ACK_TOKEN_DAYS = 30

const DAY_MS = 86_400_000

/** the secret the app already has — never a new one to manage */
export function ackSecret(): string {
  const s = (process.env.CLERK_SECRET_KEY ?? process.env.INNGEST_SIGNING_KEY ?? '').trim()
  if (!s) throw new Error('No secret to sign the acknowledgement link with (CLERK_SECRET_KEY)')
  return s
}

const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload, 'utf8').digest('base64url')

export function signAckToken(shootId: string, userId: string, secret: string, now = Date.now()): string {
  const exp = now + ACK_TOKEN_DAYS * DAY_MS
  const payload = `${shootId}.${userId}.${exp}`
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(payload, secret)}`
}

export type AckTokenCheck =
  | { ok: true; shootId: string; userId: string }
  | { ok: false; reason: 'malformed' | 'expired' | 'bad_signature' }

export function verifyAckToken(token: string, secret: string, now = Date.now()): AckTokenCheck {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return { ok: false, reason: 'malformed' }
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  let payload: string
  try { payload = Buffer.from(body, 'base64url').toString('utf8') } catch { return { ok: false, reason: 'malformed' } }
  const parts = payload.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'malformed' }
  const [shootId, userId, expRaw] = parts
  const exp = Number(expRaw)
  if (!shootId || !userId || !Number.isFinite(exp)) return { ok: false, reason: 'malformed' }
  const want = Buffer.from(sign(payload, secret))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: 'bad_signature' }
  if (exp < now) return { ok: false, reason: 'expired' }
  return { ok: true, shootId, userId }
}

/** The one-press link in a crew member's email. */
export function ackLink(appUrl: string, shootId: string, userId: string, secret: string, now = Date.now()): string {
  return `${appUrl}/api/production/batches/${shootId}/acknowledge?token=${encodeURIComponent(signAckToken(shootId, userId, secret, now))}`
}
