import 'server-only'
import { after } from 'next/server'
import { rtdbFetch } from './db'

/**
 * "Something changed" markers. Every open board listens to /mdm/live/<channel>
 * and refetches through its own authenticated API — the marker is a hint,
 * never data, so role and client scoping is always re-applied server-side.
 * Fire-and-forget: the write that caused it has already committed, and a lost
 * hint costs one refresh, not data.
 */
export type LiveChannel = 'production' | 'leads' | 'brand' | 'intake' | 'monthly' | 'tracker' | 'comments'

export function announce(channel: LiveChannel, hint: Record<string, unknown>): Promise<void> {
  return rtdbFetch(`/mdm/live/${channel}`, { method: 'PUT', body: JSON.stringify({ ...hint, ts: Date.now() }) })
    .then(() => {})
    .catch(e => { console.error(`live announce (${channel}) failed:`, (e as Error).message) })
}

/**
 * The same marker, but scheduled to run AFTER the response is sent.
 *
 * `announce()` is fire-and-forget, which on Vercel means the function can be
 * frozen the instant the response goes out and the pending PUT never lands —
 * an unawaited promise buys nothing there. `after()` is the platform's own
 * answer: the work is kept alive past the response, and the request still
 * returns without waiting for it.
 *
 * Outside a request there is no scope for `after()` to attach to and it
 * throws — Inngest functions, scripts, the test suite — so this falls back to
 * the plain fire-and-forget call, which is correct in exactly those places
 * (nothing freezes them mid-flight). Every publisher goes through here.
 */
export function announceAfter(channel: LiveChannel, hint: Record<string, unknown>): void {
  try {
    after(() => announce(channel, hint))
  } catch {
    void announce(channel, hint)
  }
}
