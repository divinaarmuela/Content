/**
 * A DRIVE FOLDER, PULLED INTO OUR OWN STORAGE (the owner, 16 Sep 2026: "I
 * want a Drive link to be uploaded and it downloads it — a proper loading
 * feature for the shoot brief footage when it's added, so we know how long
 * it would take").
 *
 * Pure: the row's shape, the progress and the time left, the words, and
 * where a copy lands. The server half (drive-pull.ts) lists the folder,
 * moves the bytes a slice at a time, and keeps the row up to date; the page
 * watches the row live and draws the bar from these.
 */
export type PullStatus = 'queued' | 'listing' | 'copying' | 'done' | 'failed' | 'unreadable'

export type PullFile = {
  id: string
  name: string
  mime: string
  /** bytes, when Drive said; null until the first slice tells us */
  size: number | null
  /** bytes landed in our storage so far */
  done: number
  /** the copy, once complete */
  url: string | null
  status: 'waiting' | 'copying' | 'done' | 'failed'
  /** the card's round this file arrived with — version 1, 2, 3 (edit-round-core) */
  version?: number | null
  /** Drive's last-changed time when the copy was made — a file replaced under
   *  the same link is told apart from one merely handed in again */
  modified?: string | null
  /** Drive's MD5 of the bytes when the copy was made (18 Sep 2026) */
  md5?: string | null
  /** R2's multipart upload in flight, and the parts landed so far */
  upload_id?: string | null
  parts?: { n: number; etag: string }[]
  error?: string | null
}

export type PullRow = {
  id: string
  folder_id: string
  folder_url: string
  kind: string
  scope_id: string
  status: string
  total_files: number
  total_bytes: number
  done_files: number
  done_bytes: number
  files?: unknown
  error?: string | null
  started_at?: string | null
  finished_at?: string | null
  updated_at?: string | null
  /** the link was replaced while this pull was running — the job stops (16 Sep 2026) */
  cancelled_at?: string | null
}

/** still queued, listing or copying */
export function pullInFlight(row: PullRow | null | undefined): boolean {
  return !!row && ['queued', 'listing', 'copying'].includes(row.status)
}

/** the words on a pull that was called off because its link was replaced */
export const PULL_REPLACED_WORDS = 'Stopped — the link was replaced'

/**
 * ONE ROW PER FOLDER PER CARD (the owner, 16 Sep 2026: "I created a new card,
 * so it should show that as a new link — why does it have to take into
 * account what another card does?"). A card's pull is its own: the same
 * Drive link on two cards is two rows, each with its own versions and
 * purpose, so nothing one card did shows on another. A shoot's footage
 * folder stays one row, shared by the shoot and the card the shoot made.
 */
export function pullId(folderId: string, scopeId?: string | null): string {
  return scopeId ? `folder-${folderId}@${scopeId}` : `folder-${folderId}`
}

/** a slice of one file moved in one go — small enough to stream well inside a request */
export const PART_BYTES = 128 * 1024 * 1024
/** how many slices one background step moves before handing on to the next step */
export const PARTS_PER_STEP = 6

export function filesOf(row: { files?: unknown } | null | undefined): PullFile[] {
  const raw = row?.files
  if (!Array.isArray(raw)) return []
  return raw.filter((f): f is PullFile => !!f && typeof f === 'object' && typeof (f as PullFile).id === 'string')
}

/** where a copy lands — readable, collision-proof, safe in a URL */
export function pullObjectKey(folderId: string, file: { id: string; name: string; version?: number | null }): string {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  // a later round's copy of a file replaced in Drive sits beside the first,
  // never over it — version 1 stays playable (16 Sep 2026)
  const round = typeof file.version === 'number' && file.version >= 2 ? `-v${file.version}` : ''
  return `pulls/${folderId}/${file.id}${round}-${safe}`
}

/** the next slice of a file to move: [start, end] inclusive, or null when it is all there */
export function nextSlice(file: { size: number | null; done: number }): { start: number; end: number; n: number } | null {
  if (file.size === null || file.done >= file.size) return null
  const start = file.done
  const end = Math.min(file.size - 1, start + PART_BYTES - 1)
  return { start, end, n: Math.floor(start / PART_BYTES) + 1 }
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 MB'
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(n >= 10 * 1024 ** 3 ? 0 : 1)} GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

export function formatLeft(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds)) return null
  if (seconds < 45) return 'under a minute left'
  if (seconds < 90) return 'about a minute left'
  if (seconds < 3600) return `about ${Math.round(seconds / 60)} min left`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return `about ${h} h${m ? ` ${m} min` : ''} left`
}

export type PullProgress = {
  status: PullStatus
  pct: number
  doneFiles: number
  totalFiles: number
  doneBytes: number
  totalBytes: number
  /** bytes per second since the copying began, or null before there is anything to measure */
  rate: number | null
  /** seconds, or null when it cannot be told yet */
  left: number | null
  /** the one line under the bar */
  words: string
}

/** the bar and the words, from the row and the clock */
export function pullProgress(row: PullRow | null | undefined, nowMs: number): PullProgress | null {
  if (!row) return null
  const status = row.status as PullStatus
  const total = Math.max(0, row.total_bytes || 0)
  const done = Math.min(total || Number.MAX_SAFE_INTEGER, Math.max(0, row.done_bytes || 0))
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : status === 'done' ? 100 : 0
  const started = row.started_at ? Date.parse(row.started_at) : NaN
  const elapsed = Number.isFinite(started) ? Math.max(1, (nowMs - started) / 1000) : null
  const rate = elapsed !== null && done > 0 ? done / elapsed : null
  const left = status === 'copying' && rate && total > done ? (total - done) / rate : null
  const files = `${row.done_files} of ${row.total_files} ${row.total_files === 1 ? 'file' : 'files'}`
  const bytes = total > 0 ? `${formatBytes(done)} of ${formatBytes(total)}` : null
  let words: string
  switch (status) {
    case 'queued': words = 'Waiting to start…'; break
    case 'listing': words = 'Reading the folder…'; break
    case 'copying': words = [files, bytes, formatLeft(left) ?? 'working out the time left…'].filter(Boolean).join(' · '); break
    case 'done': words = `All ${row.total_files} ${row.total_files === 1 ? 'file is' : 'files are'} here${total > 0 ? ` · ${formatBytes(total)}` : ''}`; break
    case 'unreadable': words = row.error ?? 'The folder could not be read'; break
    default: words = row.error ? `Stopped: ${row.error}` : 'Stopped — press Pull the files in to try again'
  }
  return { status, pct, doneFiles: row.done_files, totalFiles: row.total_files, doneBytes: done, totalBytes: total, rate, left, words }
}

/** may a pull be started (again) for this row? */
export function canStartPull(row: PullRow | null | undefined): boolean {
  if (!row) return true
  return row.status === 'failed' || row.status === 'unreadable'
}

/** a stale in-flight row — nothing has moved for a long while — may be restarted too */
export function pullLooksStuck(row: PullRow | null | undefined, nowMs: number): boolean {
  if (!row || !['queued', 'listing', 'copying'].includes(row.status)) return false
  const at = row.updated_at ? Date.parse(row.updated_at) : NaN
  return Number.isFinite(at) && nowMs - at > 20 * 60 * 1000
}

/**
 * THE SAME BYTES ARE THE SAME CLIP (the owner, 18 Sep 2026: "how does our
 * system know that is the same video — they might just re-upload the same
 * Drive"). Drive keeps an MD5 of every uploaded file's bytes. When both sides
 * carry one, that alone decides: the same checksum is the same video whatever
 * its id, name or date; a different checksum is a replacement. Without a
 * checksum (a Google-native file, an old copy from before we kept them) the
 * size and the last-changed time stand in.
 */
export function sameBytes(
  a: { md5?: string | null; size: number | null; modified?: string | null },
  b: { md5?: string | null; size: number | null; modified?: string | null },
): boolean {
  if (a.md5 && b.md5) return a.md5 === b.md5
  return a.size === b.size && (!a.modified || !b.modified || a.modified === b.modified)
}

/** the finished copies already held for a listed file: by Drive id — or, for a
 *  file re-uploaded under a NEW id, by the checksum of its bytes, so the copy,
 *  its approval and its comments carry across the re-upload */
export function copiesFor<F extends { id: string; md5?: string | null; status: string; url: string | null }>(
  seen: { id: string; md5?: string | null },
  before: readonly F[],
): F[] {
  const done = before.filter(b => b.status === 'done' && !!b.url)
  const byId = done.filter(b => b.id === seen.id)
  if (byId.length > 0) return byId
  if (!seen.md5) return []
  return done.filter(b => !!b.md5 && b.md5 === seen.md5)
}
