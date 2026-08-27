'use client'

import { UploadCancelled, uploadMedia } from './uploadMedia'
import {
  advanceProgress, isSettled, startProgress,
  type ProgressState, type UploadStatus,
} from '../lib/upload-progress-core'
import { probeFile } from '../lib/video-probe'
import { previewOf, PREVIEW_POLL_MS, PREVIEW_POLL_LIMIT } from '../lib/stream-client'
import { isVideoUrl, previewStateFor } from '../lib/stream-core'

/**
 * Every upload in the dashboard, in one place, with bytes.
 *
 * Two things live here. The first is the original job: background uploads
 * that outlive the page that started them. The queue is at MODULE scope, not
 * component scope, so navigating anywhere inside the dashboard leaves the
 * transfers running; the tray in the layout shows them and the finished file
 * PATCHes itself onto the item's job pack. The browser tab is the real
 * boundary — closing it kills any web upload, which no site can escape.
 *
 * The second is progress. "Uploading 6 files…" was the whole of what an
 * editor saw while a gigabyte of footage moved, and that word is
 * indistinguishable from a hung tab: no way to tell moving from dead, which
 * file is slow, or how long is left — and the only available action, reload,
 * is the one that destroys the upload. So every row now carries bytes, a
 * smoothed rate, an ETA, a cancel and a retry, and the arithmetic behind them
 * is pure and tested in `app/lib/upload-progress-core.ts`.
 *
 * The three upload surfaces — the tray, the new-item dialog's Files box, and
 * the item page's Files and NEW VERSION zones — all read this one store, so
 * they cannot disagree about what is happening.
 */

export type UploadPreviewState = 'pending' | 'ready' | null

export type QueuedUpload = {
  id: string
  name: string
  /** which surface owns this row, so a zone shows its own files and not the
   *  whole dashboard's. `item:<id>` for a job pack, an ad-hoc key otherwise. */
  group: string
  itemId: string | null
  status: UploadStatus
  loaded: number
  total: number
  startedAt: number
  rateBps: number | null
  etaSec: number | null
  error?: string
  /** where the bytes landed, once they have */
  url?: string
  /** for a video that would not play natively: is a browser-playable copy ready? */
  preview: UploadPreviewState
  /** stop this transfer and forget the row. Null once there is nothing to stop. */
  abort: (() => void) | null
  /** try the same file again. Null unless this row failed. */
  retry: (() => void) | null
}

let queue: QueuedUpload[] = []
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }

/** The File behind each row, kept so Retry has something to retry. */
const sources = new Map<string, File>()

export function subscribeUploads(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
export function getUploads(): QueuedUpload[] {
  return queue
}
export function clearFinishedUploads(): void {
  const keep = new Set<string>()
  queue = queue.filter(u => {
    if (!isSettled(u.status)) { keep.add(u.id); return true }
    return false
  })
  for (const id of [...sources.keys()]) if (!keep.has(id)) sources.delete(id)
  emit()
}

const patch = (id: string, p: Partial<QueuedUpload>) => {
  queue = queue.map(u => (u.id === id ? { ...u, ...p } : u))
  emit()
}

const remove = (id: string) => {
  queue = queue.filter(u => u.id !== id)
  sources.delete(id)
  emit()
}

// two files finishing together must not lose each other's PATCH — serialise
// the read-modify-write per item
const chains = new Map<string, Promise<void>>()
function serialise(itemId: string, work: () => Promise<void>): Promise<void> {
  const next = (chains.get(itemId) ?? Promise.resolve()).then(work, work)
  chains.set(itemId, next)
  return next
}

async function attachToItem(itemId: string, file: { url: string; name: string }): Promise<void> {
  const res = await fetch(`/api/production/items/${itemId}`)
  if (!res.ok) throw new Error('Could not load the item to attach the file')
  const detail = await res.json() as { raw_assets?: { url: string; name: string }[] }
  const save = await fetch(`/api/production/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_assets: [...(detail.raw_assets ?? []), file] }),
  })
  if (!save.ok) throw new Error((await save.json()).error ?? 'Could not attach the file')
}

/** How many files travel at once. One at a time made a hundred-file drop
 *  take an afternoon; more than a handful just fights the same connection. */
const PARALLEL_UPLOADS = 4
let inFlight = 0
const waiting: (() => void)[] = []
const acquire = () => new Promise<void>(resolve => {
  if (inFlight < PARALLEL_UPLOADS) { inFlight += 1; resolve() }
  else waiting.push(() => { inFlight += 1; resolve() })
})
const release = () => { inFlight -= 1; waiting.shift()?.() }

/**
 * Watch a finished video until it can actually be played.
 *
 * A file whose bytes are safely in R2 is not yet a file the next person can
 * watch: a camera .mov needs the Cloudflare encode first (see
 * `app/lib/stream-core.ts`). So the row stays quietly on "Preparing preview"
 * rather than showing a tick that promises more than it can deliver.
 *
 * Only for files the probe says will NOT play — the first 256 KB of the file
 * the person already chose, never a re-read of the whole thing — so an
 * ordinary mp4 ticks green immediately, as it should.
 */
async function trackPreview(id: string, url: string, file: File): Promise<void> {
  if (!isVideoUrl(url)) return
  const check = await probeFile(file)
  if (!check.block) return
  patch(id, { preview: 'pending' })

  for (let asked = 0; asked < PREVIEW_POLL_LIMIT; asked++) {
    const { row } = await previewOf(url, asked === 0)
    const decision = previewStateFor(row, check)
    if (decision.at === 'play-stream') { patch(id, { preview: 'ready' }); return }
    if (decision.at === 'failed') { patch(id, { preview: null }); return }
    // the row may have been dismissed or cancelled under us
    if (!queue.some(u => u.id === id)) return
    await new Promise(r => setTimeout(r, PREVIEW_POLL_MS))
  }
  // still not ready after ten minutes: stop claiming it is coming
  patch(id, { preview: null })
}

/**
 * Run one file all the way through, reporting every stage.
 *
 * `processing` is a real state and not decoration: between the PUT finishing
 * and the item PATCH returning, the bytes exist and nothing references them.
 * A tick at that moment would be a promise that a refresh would break.
 */
function run(row: QueuedUpload, file: File, onDone?: (url: string) => Promise<void> | void): void {
  const controller = new AbortController()
  patch(row.id, {
    status: 'queued',
    error: undefined,
    loaded: 0,
    preview: null,
    retry: null,
    abort: () => { controller.abort(); remove(row.id) },
  })

  void (async () => {
    await acquire()
    if (controller.signal.aborted) { release(); return }

    let progress: ProgressState = startProgress(file.size, Date.now())
    patch(row.id, { status: 'uploading', ...progressFields(progress) })

    try {
      const { url } = await uploadMedia(file, {
        purpose: 'production',
        signal: controller.signal,
        onProgress: p => {
          progress = advanceProgress(progress, { ...p, at: Date.now() })
          patch(row.id, progressFields(progress))
        },
      })

      // bytes are in; the record of them is not
      patch(row.id, { status: 'processing', url, abort: null, loaded: file.size, etaSec: null })
      if (row.itemId) {
        await serialise(row.itemId, () => attachToItem(row.itemId!, { url, name: row.name }))
      }
      await onDone?.(url)

      patch(row.id, { status: 'done', abort: null, retry: null })
      void trackPreview(row.id, url, file)
    } catch (e) {
      // a cancelled upload is not a failure; its row is already gone
      if (e instanceof UploadCancelled || controller.signal.aborted) return
      patch(row.id, {
        status: 'failed',
        error: e instanceof Error ? e.message : 'Upload failed',
        abort: null,
        // the File is still in hand, so trying again costs one click
        retry: () => { const f = sources.get(row.id); if (f) run(row, f, onDone) },
      })
    } finally {
      release()
    }
  })()
}

function progressFields(p: ProgressState): Partial<QueuedUpload> {
  return { loaded: p.loaded, total: p.total, startedAt: p.startedAt, rateBps: p.rateBps, etaSec: p.etaSec }
}

function newRow(file: File, group: string, itemId: string | null): QueuedUpload {
  return {
    id: `${group}:${file.name}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
    name: file.name,
    group,
    itemId,
    status: 'queued',
    loaded: 0,
    total: file.size,
    startedAt: Date.now(),
    rateBps: null,
    etaSec: null,
    preview: null,
    abort: null,
    retry: null,
  }
}

/** Start background uploads of source files for one item's job pack. */
export function enqueueJobAssets(itemId: string, files: File[]): string {
  const group = `item:${itemId}`
  for (const file of files) {
    const row = newRow(file, group, itemId)
    sources.set(row.id, file)
    queue = [...queue, row]
    emit()
    run(row, file)
  }
  return group
}

/**
 * Upload files and hand back where they landed — for the callers that need
 * the URLs themselves (a new item's job pack, a new version's slides) rather
 * than an automatic attach.
 *
 * They get the same rows in the same store, so they get the same bar, speed,
 * ETA, cancel and retry for free. A cancelled file simply does not appear in
 * the result; a failed one rejects, because a version saved with four of its
 * five slides is worse than a version not saved.
 */
export function uploadFiles(
  files: File[], opts: { group?: string } = {},
): { group: string; done: Promise<{ file: File; url: string }[]> } {
  const group = opts.group ?? `batch:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`
  const jobs = files.map(file => {
    const row = newRow(file, group, null)
    sources.set(row.id, file)
    queue = [...queue, row]
    return { row, file }
  })
  emit()

  const done = Promise.all(jobs.map(({ row, file }) => new Promise<{ file: File; url: string } | null>(
    (resolve, reject) => {
      let stop = () => {}
      const settle = (fn: () => void) => { stop(); fn() }
      // a row that VANISHES was cancelled, and a row that fails has an error
      // worth surfacing — without watching for both, a cancelled file would
      // leave the caller's Promise.all hanging forever
      stop = subscribeUploads(() => {
        const live = queue.find(u => u.id === row.id)
        if (!live) settle(() => resolve(null))
        else if (live.status === 'failed') settle(() => reject(new Error(live.error ?? 'Upload failed')))
      })
      run(row, file, url => { settle(() => resolve({ file, url })) })
    },
  ))).then(rows => rows.filter((r): r is { file: File; url: string } => r !== null))

  return { group, done }
}

/** The rows one surface owns. */
export function uploadsIn(group: string): QueuedUpload[] {
  return queue.filter(u => u.group === group)
}

/**
 * The files of a batch that actually landed, in the order they were dropped.
 *
 * Read at SAVE time rather than taken from the batch promise, so that a file
 * which failed and was then retried counts. Without this, Retry would move
 * the row to a green tick and the save would still go out without it — a
 * button that lies more quietly than the one it replaced.
 */
export function completedIn(group: string): { name: string; url: string; bytes: number }[] {
  return queue
    .filter(u => u.group === group && u.status === 'done' && u.url)
    .map(u => ({ name: u.name, url: u.url!, bytes: u.total }))
}

/** Is this batch still working? A save must not go out mid-transfer. */
export function batchBusy(group: string): boolean {
  return queue.some(u => u.group === group && !isSettled(u.status))
}

/** Drop every row of a finished batch — a zone closing, or a save completing. */
export function clearGroup(group: string): void {
  for (const u of queue.filter(x => x.group === group)) sources.delete(u.id)
  queue = queue.filter(u => u.group !== group)
  emit()
}

/** Forget a settled row — used when a zone's own list is dismissed. */
export function dismissUpload(id: string): void {
  remove(id)
}
