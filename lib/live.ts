import 'server-only'
import { rtdbFetch } from './db'

/**
 * "Something changed" markers. Every open board listens to /mdm/live/<channel>
 * and refetches through its own authenticated API — the marker is a hint,
 * never data, so role and client scoping is always re-applied server-side.
 * Fire-and-forget: the write that caused it has already committed, and a lost
 * hint costs one refresh, not data.
 */
export type LiveChannel = 'production' | 'leads' | 'brand' | 'intake' | 'monthly' | 'tracker' | 'comments'

export function announce(channel: LiveChannel, hint: Record<string, unknown>): void {
  void rtdbFetch(`/mdm/live/${channel}`, { method: 'PUT', body: JSON.stringify({ ...hint, ts: Date.now() }) })
    .catch(e => console.error(`live announce (${channel}) failed:`, (e as Error).message))
}
