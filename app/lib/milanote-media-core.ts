/**
 * COPYING MILANOTE'S IMAGES AND FILES INTO OUR STORAGE — the pure half (20 Oct 2026, docs/MILANOTE_MERGE.md).
 *
 * Milanote's own links expire, so every image and file a board shows is copied into R2 once. The server half
 * (milanote-media.ts) downloads and stores; this decides what may be fetched and what is next. Pure.
 */

/** Only Milanote's own hosts are ever fetched — the job is not an open "download anything" button. */
export function isMilanoteSrc(src: string | null | undefined): boolean {
  try {
    const u = new URL(String(src ?? ''))
    return u.protocol === 'https:' && (u.hostname === 'app.milanote.com' || u.hostname.endsWith('.milanote.com'))
  } catch {
    return false
  }
}

export const MAX_ATTEMPTS = 3
/** the most one file may be: R2's single-upload ceiling. Anything past STREAM_FROM is streamed through, never held in
 *  memory — four videos of 541 MB to 1.3 GB were refused at the old 500 MB wall (27 Oct 2026) */
export const MAX_BYTES = 4.9 * 1024 * 1024 * 1024
export const STREAM_FROM = 100 * 1024 * 1024
/** a `copying` row older than this was left by a run that died; it is picked up again */
export const STALE_COPYING_MS = 10 * 60 * 1000

export type MediaRow = { id: string; status: string; attempts: number; updated_at: string }

/** The rows to copy next: `todo` first, then any `copying` row a dead run left behind, never a finished one. */
export function nextToCopy<T extends MediaRow>(rows: readonly T[], now: number, limit: number): T[] {
  const stale = (r: T) => r.status === 'copying' && now - Date.parse(r.updated_at) > STALE_COPYING_MS
  return rows.filter(r => r.status === 'todo' || stale(r)).slice(0, Math.max(0, limit))
}

/** "Copied 812 of 1,222 — 3 failed" */
export function copyProgress(rows: readonly { status: string }[]): { done: number; failed: number; left: number; total: number } {
  const done = rows.filter(r => r.status === 'done').length
  const failed = rows.filter(r => r.status === 'failed').length
  return { done, failed, left: rows.length - done - failed, total: rows.length }
}
