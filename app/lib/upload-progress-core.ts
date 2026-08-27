import { formatFileSize } from './video-probe-core'

/**
 * "Uploading…" is not progress.
 *
 * An editor assigning a job drags in six clips, two of them a gigabyte, and
 * the dashboard said `Uploading 6 files…` and nothing else for eleven
 * minutes. That word is indistinguishable from a hung tab: no way to tell a
 * transfer that is moving from one that died, no way to tell which file is
 * the slow one, and nothing to do but wait or reload — and reloading kills
 * the upload, so the honest-looking action is the destructive one.
 *
 * The fix is bytes. `XMLHttpRequest.upload.onprogress` reports them (`fetch`
 * does not — a request body stream has no progress event in any shipping
 * browser, which is the whole reason the PUT moved back to XHR), and this
 * module turns a stream of byte counts into the four things a person reads:
 * how far, how fast, how long left, and — across a batch — how much of the
 * whole drop is done.
 *
 * Pure. Numbers in, numbers and words out: no DOM, no File, no clock of its
 * own. Every `at` is passed in, so the smoothing is testable to the
 * millisecond instead of by waiting for one.
 */

export type UploadStatus =
  /** waiting for one of the four upload slots */
  | 'queued'
  /** bytes are moving */
  | 'uploading'
  /** the bytes have landed; the row that records them has not been written yet */
  | 'processing'
  | 'done'
  | 'failed'

/** A transfer is finished, one way or the other. */
export function isSettled(status: UploadStatus): boolean {
  return status === 'done' || status === 'failed'
}

export type ProgressState = {
  loaded: number
  total: number
  startedAt: number
  /** smoothed bytes per second, null until there are two samples to compare */
  rateBps: number | null
  /** seconds remaining at the smoothed rate, null while the rate is unknown */
  etaSec: number | null
  /** the last sample the rate was computed from */
  lastAt: number
  lastLoaded: number
}

/**
 * How much of a sample is believed over the running average.
 *
 * 0.25 rather than a plain instantaneous rate because a raw XHR rate is
 * violently noisy — a chunk flushed from a buffer reads as 400 MB/s and the
 * next tick reads as zero, so an unsmoothed "time left" swings between four
 * seconds and nine minutes and is worse than showing nothing. Low enough to
 * be steady, high enough that a genuine slowdown shows within a few seconds.
 */
export const RATE_ALPHA = 0.25

/**
 * The shortest gap worth computing a rate from.
 *
 * Progress events can arrive several to the millisecond. Dividing by a
 * near-zero interval produces an enormous rate and, one tick later, an ETA of
 * zero on a file with 900 MB to go.
 */
export const MIN_SAMPLE_MS = 300

export function startProgress(total: number, at: number): ProgressState {
  return {
    loaded: 0,
    total: Math.max(0, Number(total) || 0),
    startedAt: at,
    rateBps: null,
    etaSec: null,
    lastAt: at,
    lastLoaded: 0,
  }
}

/**
 * Fold one progress event into the running state.
 *
 * `loaded` always advances — the bar must track every event, however close
 * together — while the rate is only recomputed on samples far enough apart to
 * mean anything. A sample that goes backwards (a retried chunk) is taken at
 * face value for the bar and ignored for the rate: a negative speed is not a
 * thing to show anyone.
 */
export function advanceProgress(
  prev: ProgressState, sample: { loaded: number; total?: number; at: number },
): ProgressState {
  const loaded = Math.max(0, Number(sample.loaded) || 0)
  const total = sample.total && sample.total > 0 ? sample.total : prev.total
  const next: ProgressState = { ...prev, loaded, total }

  const dt = sample.at - prev.lastAt
  const dBytes = loaded - prev.lastLoaded
  if (dt < MIN_SAMPLE_MS || dBytes <= 0) return next

  const instant = (dBytes * 1000) / dt
  const rate = prev.rateBps === null
    ? instant
    : prev.rateBps + RATE_ALPHA * (instant - prev.rateBps)

  next.rateBps = rate
  next.etaSec = etaSeconds(loaded, total, rate)
  next.lastAt = sample.at
  next.lastLoaded = loaded
  return next
}

/** Seconds left at this rate, or null when that cannot be said honestly. */
export function etaSeconds(
  loaded: number, total: number, rateBps: number | null,
): number | null {
  if (!rateBps || rateBps <= 0 || !total || total <= 0) return null
  const left = total - loaded
  if (left <= 0) return 0
  return left / rateBps
}

/** 0–100, clamped. A total of zero is 0%, never NaN and never a full bar. */
export function percent(loaded: number, total: number): number {
  if (!total || total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((loaded / total) * 100)))
}

// ── the words ─────────────────────────────────────────────────────────────

/** "12 MB/s". Null when no rate is known yet — say nothing rather than "0 B/s". */
export function formatRate(rateBps: number | null | undefined): string | null {
  if (!rateBps || rateBps <= 0) return null
  const size = formatFileSize(rateBps)
  return size ? `${size}/s` : null
}

/**
 * "40 s left", "3 min left", "1 h 12 min left".
 *
 * Rounded coarsely on purpose: an ETA to the second on a ten-minute upload
 * implies a precision the number does not have, and a counter ticking 512,
 * 511, 510 draws the eye to the one thing the person cannot influence.
 */
export function formatEta(etaSec: number | null | undefined): string | null {
  if (etaSec === null || etaSec === undefined || !Number.isFinite(etaSec)) return null
  if (etaSec < 2) return 'almost done'
  if (etaSec < 60) return `${Math.round(etaSec)} s left`
  const mins = Math.round(etaSec / 60)
  if (mins < 60) return `${mins} min left`
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  return rest === 0 ? `${hours} h left` : `${hours} h ${rest} min left`
}

/** "12 MB/s · 40 s left" — whichever halves are actually known. */
export function progressLine(state: {
  rateBps?: number | null; etaSec?: number | null; status?: UploadStatus
}): string | null {
  if (state.status && state.status !== 'uploading') return null
  return [formatRate(state.rateBps), formatEta(state.etaSec)].filter(Boolean).join(' · ') || null
}

/** "184 MB" beside a file's name. */
export function formatSize(bytes: number | null | undefined): string | null {
  return formatFileSize(bytes)
}

// ── the batch ─────────────────────────────────────────────────────────────

export type OverallRow = { loaded: number; total: number; status: UploadStatus }

export type Overall = {
  /** files that reached `done` */
  done: number
  files: number
  percent: number
  /** "3 of 6 files · 62%" */
  label: string
  active: boolean
}

/**
 * One bar for the whole drop.
 *
 * Weighted by BYTES, not by file count: six clips where one is a gigabyte and
 * five are 3 MB would otherwise show 83% while five sixths of the waiting was
 * still ahead. A file that failed still counts its bytes as accounted for —
 * the batch is not going to get any further, and a bar that can never reach
 * 100% is its own small lie.
 */
export function overallProgress(rows: readonly OverallRow[]): Overall {
  const files = rows.length
  const done = rows.filter(r => r.status === 'done').length
  const totalBytes = rows.reduce((n, r) => n + (r.total > 0 ? r.total : 0), 0)
  const loadedBytes = rows.reduce((n, r) => {
    if (r.status === 'done' || r.status === 'failed') return n + (r.total > 0 ? r.total : 0)
    return n + Math.min(r.loaded, r.total > 0 ? r.total : r.loaded)
  }, 0)

  // no byte totals at all (a store that never reported a size) — fall back to
  // counting files, which is coarse but never wrong
  const pct = totalBytes > 0
    ? percent(loadedBytes, totalBytes)
    : percent(rows.filter(r => isSettled(r.status)).length, files)

  const settled = rows.filter(r => isSettled(r.status)).length
  return {
    done,
    files,
    percent: pct,
    label: `${done} of ${files} file${files === 1 ? '' : 's'} · ${pct}%`,
    active: settled < files,
  }
}

/**
 * The status word under a file's name.
 *
 * `processing` exists because the PUT finishing is not the job finishing: the
 * bytes are in R2 but the item PATCH or the version POST that records them
 * has not returned, and a green tick at that moment would be a claim that the
 * file is attached when a refresh would show it missing.
 */
export function statusWords(status: UploadStatus, videoPreview?: 'pending' | 'ready' | null): string {
  if (status === 'queued') return 'Waiting'
  if (status === 'uploading') return 'Uploading'
  if (status === 'processing') return 'Saving'
  if (status === 'failed') return 'Failed'
  // done — but a video that will not play in a browser is not yet usable to
  // whoever opens this next, and Cloudflare is still making one that will
  if (videoPreview === 'pending') return 'Preparing preview'
  return 'Done'
}
