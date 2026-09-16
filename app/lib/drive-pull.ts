import 'server-only'
import { table } from '@/lib/db'
import type { DrivePull } from '@/lib/db-types'
import { inngest } from '../inngest/client'
import { listFolder } from './drive-folder-list'
import { driveFileSize, openDriveFile } from './drive-stream'
import { kindOf } from './files-core'
import { abortMultipart, closeMultipart, openMultipart, putMultipartPart, r2Configured } from './storage'
import {
  PARTS_PER_STEP, canStartPull, filesOf, nextSlice, pullId, pullLooksStuck, pullObjectKey, type PullFile,
} from './drive-pull-core'
import { driveFolderIdFromUrl } from './card-link-core'
import { afterResponse } from './after-response'

/**
 * A DRIVE FOLDER, PULLED INTO OUR OWN STORAGE — the server half (the owner,
 * 16 Sep 2026: "I want a Drive link to be uploaded and it downloads it — a
 * proper loading feature so we know how long it would take"; "have Inngest
 * download it"; "version 1, 2 or 3 will have different files but the same
 * Drive link").
 *
 * One row per folder. Starting a pull lists the folder (subfolders too),
 * keeps every copy already landed whose size still matches, queues what is
 * new or changed, and an Inngest job moves the bytes a slice at a time —
 * each slice one short request, the row updated after each, so the bar on
 * the page moves and a closed browser changes nothing. The same link pulled
 * again after a new cut is dropped in copies only the new files, and each
 * file remembers the card version it arrived with.
 *
 * Drive is READ (trap 13); the writes go to R2. Nothing is ever changed,
 * moved or deleted in Drive.
 */
export const PULL_EVENT = 'drive/pull.folder'
const MAX_FILES = 400
const MAX_DEPTH = 3

type Kind = 'batch' | 'item'

export async function startPull(opts: { kind: Kind; scopeId: string; folderUrl: string; version?: number | null; by?: string | null }): Promise<{ id: string; started: boolean; reason?: string }> {
  const folderId = driveFolderIdFromUrl(opts.folderUrl)
  if (!folderId) return { id: '', started: false, reason: 'Not a Google Drive folder link' }
  if (!r2Configured()) return { id: pullId(folderId), started: false, reason: 'File storage is not configured' }
  const id = pullId(folderId)
  const now = new Date().toISOString()
  const pulls = table<DrivePull>('drive_pulls')
  const claim = await pulls.claim(id, current => {
    const row = current as unknown as (DrivePull & { files?: unknown; status: string; updated_at?: string }) | null
    // in flight and moving: leave it be
    if (row && !canStartPull(row as never) && !pullLooksStuck(row as never, Date.now()) && row.status !== 'done') return null
    return {
      ...(row ?? {}),
      id, folder_id: folderId, folder_url: opts.folderUrl,
      kind: opts.kind, scope_id: opts.scopeId,
      status: 'queued',
      total_files: row?.total_files ?? 0, total_bytes: row?.total_bytes ?? 0,
      done_files: row?.done_files ?? 0, done_bytes: row?.done_bytes ?? 0,
      files: filesOf(row),
      error: null,
      started_at: now, finished_at: null,
      requested_by: opts.by ?? null,
      created_at: row?.created_at ?? now, updated_at: now,
    } as unknown as DrivePull
  })
  if (!claim.claimed) return { id, started: false, reason: 'Already being pulled' }
  await inngest.send({ name: PULL_EVENT, data: { pull_id: id, version: opts.version ?? null } })
  return { id, started: true }
}

/** the folder saved on a card or a shoot: start the pull after the response, never in its way */
export function startPullSoon(opts: Parameters<typeof startPull>[0]): void {
  afterResponse('drive pull start', () => startPull(opts))
}

/** step one: what is in the folder now, merged with what is already here */
export async function runPullList(id: string, version: number | null): Promise<{ files: number; bytes: number; note?: string }> {
  const pulls = table<DrivePull>('drive_pulls')
  const row = await pulls.get(id)
  if (!row) return { files: 0, bytes: 0, note: 'no row' }
  // WHAT WENT WRONG, ON THE ROW (16 Sep 2026): a step that throws is retried
  // by Inngest, which keeps no words — the row keeps them, so the bar says why
  try {
    return await listInto(pulls, row, version)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await pulls.update(id, { status: 'failed', error: `Could not read the folder: ${message}`.slice(0, 500), finished_at: new Date().toISOString(), updated_at: new Date().toISOString() } as never).catch(() => undefined)
    throw e
  }
}

async function listInto(pulls: ReturnType<typeof table<DrivePull>>, row: DrivePull, version: number | null): Promise<{ files: number; bytes: number; note?: string }> {
  const id = row.id
  await pulls.update(id, { status: 'listing', updated_at: new Date().toISOString() } as never)

  const seen: { id: string; name: string; mime: string; size: number | null }[] = []
  const walk = async (folderId: string, prefix: string, depth: number) => {
    if (seen.length >= MAX_FILES || depth > MAX_DEPTH) return
    const listing = await listFolder(folderId)
    for (const e of listing.entries) {
      if (seen.length >= MAX_FILES) break
      if (kindOf(e.mimeType, e.name) === 'folder') { await walk(e.id, `${prefix}${e.name}/`, depth + 1); continue }
      seen.push({ id: e.id, name: `${prefix}${e.name}`, mime: e.mimeType || 'application/octet-stream', size: typeof e.size === 'number' ? e.size : null })
    }
  }
  await walk(row.folder_id, '', 0)
  // where the step has got to, on the row — so a stall says where it stalled
  await pulls.update(id, { total_files: seen.length, error: `Read the folder: ${seen.length} files`, updated_at: new Date().toISOString() } as never)

  if (seen.length === 0) {
    await pulls.update(id, {
      status: 'unreadable', finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      error: 'The folder could not be read — share it with the agency’s Drive account, or set it to anyone with the link, then pull again.',
    } as never)
    return { files: 0, bytes: 0, note: 'unreadable' }
  }

  // sizes the listing did not carry: Drive's metadata, never the bytes
  let probed = 0
  for (const f of seen) {
    if (f.size !== null) continue
    await pulls.update(id, { error: `Reading sizes: ${++probed} (${f.name})`, updated_at: new Date().toISOString() } as never)
    f.size = await driveFileSize(f.id)
  }

  const before = filesOf(row)
  const files: PullFile[] = seen.map(f => {
    const had = before.find(b => b.id === f.id)
    // the same file, the same size: the copy stands
    if (had && had.status === 'done' && had.url && had.size === f.size) return { ...had, name: f.name }
    return { id: f.id, name: f.name, mime: f.mime, size: f.size, done: 0, url: null, status: 'waiting', upload_id: null, parts: [], version: version ?? null }
  })
  const total_bytes = files.reduce((n, f) => n + (f.size ?? 0), 0)
  const done_bytes = files.reduce((n, f) => n + (f.status === 'done' ? (f.size ?? 0) : 0), 0)
  const done_files = files.filter(f => f.status === 'done').length
  const allDone = done_files === files.length
  await pulls.update(id, {
    status: allDone ? 'done' : 'copying', files, total_files: files.length, total_bytes, done_files, done_bytes,
    started_at: new Date().toISOString(), finished_at: allDone ? new Date().toISOString() : null,
    error: null, updated_at: new Date().toISOString(),
  } as never)
  return { files: files.length, bytes: total_bytes }
}

/** a few slices of one file — returns whether the file is complete */
export async function runPullSlices(id: string, fileId: string): Promise<{ done: boolean; error?: string }> {
  const pulls = table<DrivePull>('drive_pulls')
  const row = await pulls.get(id)
  if (!row) return { done: true, error: 'no row' }
  const files = filesOf(row)
  const file = files.find(f => f.id === fileId)
  if (!file) return { done: true, error: 'no such file' }
  if (file.status === 'done') return { done: true }
  const key = pullObjectKey(row.folder_id, file)

  const save = async (patch: Partial<PullFile>, rowPatch: Record<string, unknown> = {}) => {
    Object.assign(file, patch)
    const done_bytes = files.reduce((n, f) => n + Math.min(f.done, f.size ?? f.done), 0)
    const done_files = files.filter(f => f.status === 'done').length
    await pulls.update(id, { files, done_bytes, done_files, updated_at: new Date().toISOString(), ...rowPatch } as never)
  }

  try {
    if (file.size === null) {
      const size = await driveFileSize(file.id)
      if (size === null) throw new Error('Drive would not say how big the file is')
      await save({ size }, { total_bytes: files.reduce((n, f) => n + (f.size ?? 0), 0) })
    }
    if (!file.upload_id) {
      const uploadId = await openMultipart(key, file.mime || 'application/octet-stream')
      await save({ upload_id: uploadId, parts: [], status: 'copying', done: 0 })
    }
    for (let i = 0; i < PARTS_PER_STEP; i++) {
      const slice = nextSlice(file)
      if (!slice) break
      // one slice, one request, abandoned if it overruns — never the whole file
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 240_000)
      let bytes: Buffer
      try {
        const res = await openDriveFile(file.id, `bytes=${slice.start}-${slice.end}`, ctrl.signal)
        if (!res || !res.body) throw new Error('Drive stopped handing the file out')
        bytes = Buffer.from(await res.arrayBuffer())
      } finally { clearTimeout(timer) }
      const want = slice.end - slice.start + 1
      if (bytes.length !== want) throw new Error(`Drive sent ${bytes.length} bytes for a slice of ${want}`)
      const etag = await putMultipartPart(key, file.upload_id!, slice.n, bytes)
      await save({ done: file.done + bytes.length, parts: [...(file.parts ?? []), { n: slice.n, etag }] })
    }
    if (nextSlice(file) === null) {
      const url = await closeMultipart(key, file.upload_id!, file.parts ?? [])
      await save({ status: 'done', url, upload_id: null })
      return { done: true }
    }
    return { done: false }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'copy failed'
    if (file.upload_id) await abortMultipart(key, file.upload_id)
    await save({ status: 'failed', error: message, upload_id: null, parts: [], done: 0 })
    return { done: true, error: message }
  }
}

/** the end of a run: the row's state from its files */
export async function finishPull(id: string): Promise<'done' | 'failed'> {
  const pulls = table<DrivePull>('drive_pulls')
  const row = await pulls.get(id)
  if (!row) return 'failed'
  const files = filesOf(row)
  const failed = files.filter(f => f.status === 'failed')
  const status = failed.length === 0 ? 'done' : 'failed'
  await pulls.update(id, {
    status, finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    error: failed.length ? `${failed.length} ${failed.length === 1 ? 'file' : 'files'} could not be copied (${failed[0].name}${failed[0].error ? `: ${failed[0].error}` : ''})` : null,
  } as never)
  return status
}
