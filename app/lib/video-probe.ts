'use client'

/**
 * The browser side of the fast-start probe.
 *
 * `probeVideoBytes` only wants bytes; these two get them. From R2 that is a
 * single ranged GET of the first 256 KB — which is roughly the cost of a
 * thumbnail, and answers a question that otherwise costs 184 MB. From a file
 * the editor just chose it is a `Blob.slice`, with no network at all.
 *
 * Nothing here throws. A CORS refusal, a server that ignores Range, an
 * aborted navigation — all resolve to "no opinion", and the `<video>` element
 * gets its chance exactly as it did before this file existed.
 */

import {
  PROBE_BYTES, previewBlock, probeVideoBytes,
  type PreviewBlock, type VideoProbe,
} from './video-probe-core'

export type VideoCheck = {
  probe: VideoProbe | null
  /** the file's full length, read out of Content-Range — display and reason */
  bytes: number | null
  /** why it will not play, or null when it will (or when we cannot tell) */
  block: PreviewBlock | null
}

const NO_OPINION: VideoCheck = { probe: null, bytes: null, block: null }

/** One probe per URL per page life. The same cut is on the preview, the
 *  slide strip and the version list; it is one file and one answer. */
const cache = new Map<string, Promise<VideoCheck>>()

/** "bytes 0-262143/193273528" → 193273528 */
function totalFromContentRange(header: string | null): number | null {
  const total = Number(String(header ?? '').split('/')[1])
  return Number.isFinite(total) && total > 0 ? total : null
}

function checkOf(bytes: Uint8Array, total: number | null): VideoCheck {
  const probe = probeVideoBytes(bytes)
  return { probe, bytes: total, block: previewBlock(probe, total) }
}

/** Anything a `<video>` might be asked to play. Docs and decks are not probed. */
const VIDEO_URL = /\.(mp4|mov|m4v|webm|avi|mkv|mpe?g|mts|m2ts)(\?|$)/i
export function looksLikeVideo(url: string): boolean {
  return VIDEO_URL.test(String(url ?? ''))
}

/** Does this file's name/type say .mov or .mp4 — the two we can actually read? */
export function isProbableMp4(file: File): boolean {
  return /^video\//i.test(file.type) || /\.(mp4|mov|m4v)$/i.test(file.name)
}

/**
 * Probe a stored file over the network.
 *
 * A range request, so the answer costs 256 KB whatever the file weighs. If
 * the server hands back the whole thing anyway (200 rather than 206) we still
 * only read the head of it — but we never make that request twice.
 */
export function probeUrl(url: string): Promise<VideoCheck> {
  const key = String(url ?? '')
  if (!key) return Promise.resolve(NO_OPINION)
  const hit = cache.get(key)
  if (hit) return hit

  const run = (async (): Promise<VideoCheck> => {
    try {
      const res = await fetch(key, { headers: { Range: `bytes=0-${PROBE_BYTES - 1}` } })
      if (!res.ok) return NO_OPINION
      const total = totalFromContentRange(res.headers.get('content-range'))
        ?? (res.status === 200 ? Number(res.headers.get('content-length')) || null : null)
      const buf = await res.arrayBuffer()
      const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, PROBE_BYTES))
      return checkOf(head, total)
    } catch {
      // offline, CORS, cancelled — never an accusation against the file
      return NO_OPINION
    }
  })()

  cache.set(key, run)
  return run
}

/** Probe a file the person just chose, before a byte of it leaves the machine. */
export async function probeFile(file: File): Promise<VideoCheck> {
  try {
    const head = await file.slice(0, PROBE_BYTES).arrayBuffer()
    return checkOf(new Uint8Array(head), file.size || null)
  } catch {
    return NO_OPINION
  }
}
