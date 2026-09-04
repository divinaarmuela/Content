import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * How the callback proves it came from here.
 *
 * The app cannot take a POST that says "this job finished, here is the file"
 * on trust: it writes a URL that then goes onto a client's real account. So
 * the body is signed with a shared secret and a timestamp, exactly the way
 * the Cloudflare Stream webhook we already verify is signed — one shape for
 * both, so nobody has to learn a second one.
 *
 *   x-encoder-signature: t=<unix seconds>,v1=<hex hmac of `${t}.${body}`>
 *
 * The timestamp is inside the signed string, which is what stops an old
 * delivery being replayed later.
 */

export const SIGNATURE_HEADER = 'x-encoder-signature'

export function signCallback(body: string, secret: string, atSeconds = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', secret).update(`${atSeconds}.${body}`).digest('hex')
  return `t=${atSeconds},v1=${sig}`
}

/** Constant time, so a wrong secret cannot be found a character at a time. */
export function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
