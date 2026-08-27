'use client'

import type { PreviewRow } from './stream-core'

/**
 * The browser side of the preview lookup.
 *
 * One question, asked of `/api/stream/preview`: "is there a playable copy of
 * this file yet?". Nothing here throws — an offline tab, a 500, a route that
 * does not exist because the migration has not been run all resolve to "no
 * preview", and the player falls back to exactly what it did before Cloudflare
 * Stream was wired up.
 */

export type PreviewLookup = { configured: boolean; row: PreviewRow | null }

const NONE: PreviewLookup = { configured: false, row: null }

/**
 * Settled answers only.
 *
 * `ready` and `error` are final and worth remembering for the life of the
 * page — the same cut appears on the item page, the version list and the
 * slide strip, and it is one file with one answer. A `queued`/`processing`
 * answer is the opposite of final: caching it would freeze "preparing
 * preview" on screen for as long as the tab stayed open, which is the exact
 * spinner-that-lies this whole feature exists to remove.
 */
const settled = new Map<string, PreviewLookup>()
/** In-flight requests, so ten cards asking at once make one request. */
const inflight = new Map<string, Promise<PreviewLookup>>()

/**
 * @param claim pass true ONLY when the probe has already established that the
 *   original will not play in this browser. It is what permits the server to
 *   start an encode, and an encode of a file that plays perfectly well is a
 *   bill for nothing — Cloudflare charges per minute of video stored. A
 *   thumbnail asking "is there a still for this?" must never claim.
 */
export function previewOf(url: string, claim = false): Promise<PreviewLookup> {
  const key = String(url ?? '')
  if (!key) return Promise.resolve(NONE)
  const done = settled.get(key)
  if (done) return Promise.resolve(done)
  // keyed on the claim flag too: a thumbnail's read-only lookup must not
  // satisfy a player's claiming one and quietly swallow the encode request
  const lane = `${key}|${claim ? 'claim' : 'read'}`
  const running = inflight.get(lane)
  if (running) return running

  const run = (async (): Promise<PreviewLookup> => {
    try {
      const res = await fetch(
        `/api/stream/preview?url=${encodeURIComponent(key)}${claim ? '&claim=1' : ''}`)
      if (!res.ok) return NONE
      const json = await res.json() as PreviewLookup
      const out: PreviewLookup = {
        configured: Boolean(json?.configured),
        row: json?.row ?? null,
      }
      const state = out.row?.state
      if (state === 'ready' || state === 'error') settled.set(key, out)
      return out
    } catch {
      return NONE
    } finally {
      inflight.delete(lane)
    }
  })()

  inflight.set(lane, run)
  return run
}

/** How often a player waiting on an encode asks again. */
export const PREVIEW_POLL_MS = 15_000
/** …and for how long before it stops asking. Ten minutes is twice the promise. */
export const PREVIEW_POLL_LIMIT = 40
