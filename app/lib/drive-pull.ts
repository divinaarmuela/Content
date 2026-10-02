import 'server-only'
import { table } from '@/lib/db'
import type { DrivePull } from '@/lib/db-types'
import { inngest } from '../inngest/client'
import { listFolder } from './drive-folder-list'
import { driveFileMeta, driveFileSize, openDriveFile } from './drive-stream'
import { kindOf } from './files-core'
import { abortMultipart, closeMultipart, openMultipart, putMultipartPart, r2Configured } from './storage'
import {
  PARTS_PER_STEP, PULL_REPLACED_WORDS, canStartPull, filesOf, nextSlice, pullId, pullInFlight, pullLooksStuck, pullObjectKey, type PullFile,
} from './drive-pull-core'
import { driveTargetOf } from './card-link-core'
import { sameDriveCut } from './drive-handin-core'
import { afterResponse } from './after-response'
import { fileRound } from './edit-round-core'
import { previewVideos } from './stream'
import { kindOf as fileKindOf } from './files-core'

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
const PREVIEW_MAX_BYTES = 800 * 1024 * 1024

type Kind = 'batch' | 'item'
/** what the link is: a folder to work from, or an edit handed in (16 Sep 2026) */
export type PullPurpose = 'folder' | 'finished' | 'handin'

export async function startPull(opts: {
  kind: Kind; scopeId: string; folderUrl: string; version?: number | null; by?: string | null; purpose?: PullPurpose
  /** A VERSION HANDED IN FROM DRIVE (drive-handin-core.ts, 30 Sep 2026): its own row, only the files the editor
   *  picked, and the hand-in on the card it settles when the copy is done */
  handIn?: { pullId: string; onlyIds: string[]; handInId: string }
}): Promise<{ id: string; started: boolean; reason?: string }> {
  // a folder to list, or one file (16 Sep 2026: a single clip's link pasted as the folder)
  const target = driveTargetOf(opts.folderUrl)
  if (!target) return { id: '', started: false, reason: 'Not a Google Drive link' }
  const folderId = target.id
  const scopeKey = opts.kind === 'item' ? opts.scopeId : null
  const id = opts.handIn?.pullId ?? pullId(folderId, scopeKey)
  if (!r2Configured()) return { id, started: false, reason: 'File storage is not configured' }
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
      purpose: opts.purpose ?? (row as { purpose?: string | null } | null)?.purpose ?? null,
      status: 'queued',
      total_files: row?.total_files ?? 0, total_bytes: row?.total_bytes ?? 0,
      done_files: row?.done_files ?? 0, done_bytes: row?.done_bytes ?? 0,
      files: filesOf(row),
      error: null,
      started_at: now, finished_at: null,
      // a fresh start is never a cancelled one
      cancelled_at: null,
      requested_by: opts.by ?? null,
      // a hand-in's picks and its record on the card; a plain pull has neither
      ...(opts.handIn ? { only_ids: opts.handIn.onlyIds, handin_id: opts.handIn.handInId, version: opts.version ?? null } : {}),
      created_at: row?.created_at ?? now, updated_at: now,
    } as unknown as DrivePull
  })
  if (!claim.claimed) {
    // THE SAME LINK AS THE FOLDER TO WORK FROM, HANDED IN AS THE FINISHED EDIT
    // while its first pull is still running (Yusuf's card, 16 Sep 2026: no
    // Version 1 pill appeared): the copy in flight is the finished edit too,
    // so the row is marked as one — the tabs read the mark, not the timing
    if (opts.purpose === 'finished' && (claim.current as { purpose?: string | null } | null)?.purpose !== 'finished') {
      await pulls.update(id, { purpose: 'finished', updated_at: new Date().toISOString() } as never).catch(() => undefined)
    }
    return { id, started: false, reason: 'Already being pulled' }
  }
  await inngest.send({ name: PULL_EVENT, data: { pull_id: id, version: opts.version ?? null } })
  return { id, started: true }
}

/** the folder saved on a card or a shoot: start the pull after the response, never in its way */
export function startPullSoon(opts: Parameters<typeof startPull>[0]): void {
  afterResponse('drive pull start', () => startPull(opts))
}

/**
 * THE LINK WAS REPLACED WHILE ITS FILES WERE STILL COMING (the owner, 16 Sep
 * 2026: "when in the process I change the link, it cancels"): the old
 * link's pull is called off — the row says so, every step of the job reads
 * it and stops, and the open uploads to R2 are abandoned. Only the pull this
 * shoot or card asked for: the same folder pulled for somebody else's card
 * is left alone. The same folder under a differently spelled link is not a
 * replacement at all.
 */
export async function cancelReplacedPull(opts: { kind: Kind; scopeId: string; oldUrl: string | null | undefined; newUrl: string | null | undefined }): Promise<boolean> {
  const old = driveTargetOf(opts.oldUrl ?? '')
  if (!old) return false
  const next = driveTargetOf(opts.newUrl ?? '')
  if (next && next.id === old.id) return false
  const pulls = table<DrivePull>('drive_pulls')
  const id = pullId(old.id, opts.kind === 'item' ? opts.scopeId : null)
  const now = new Date().toISOString()
  let open: PullFile[] = []
  const claim = await pulls.claim(id, current => {
    const row = current as unknown as (DrivePull & { kind?: string; scope_id?: string }) | null
    if (!row || row.kind !== opts.kind || row.scope_id !== opts.scopeId || !pullInFlight(row as never)) return null
    const files = filesOf(row)
    open = files.filter(f => !!f.upload_id)
    return {
      ...row,
      status: 'failed', error: PULL_REPLACED_WORDS, cancelled_at: now, finished_at: now, updated_at: now,
      // the half-copied files start again if this folder is ever pulled again
      files: files.map(f => f.status === 'done' ? f : { ...f, status: 'waiting' as const, done: 0, upload_id: null, parts: [] }),
    } as unknown as DrivePull
  })
  if (!claim.claimed) return false
  for (const f of open) {
    if (f.upload_id) await abortMultipart(pullObjectKey(old.id, f), f.upload_id).catch(() => undefined)
  }
  return true
}

/** after the response, like the start */
export function cancelReplacedPullSoon(opts: Parameters<typeof cancelReplacedPull>[0]): void {
  afterResponse('drive pull cancel', () => cancelReplacedPull(opts))
}

export type DriveTargetFile = { id: string; name: string; mime: string; size: number | null; modified: string | null; md5?: string | null; revision?: string | null }

/**
 * WHAT A DRIVE LINK HOLDS — read only (trap 13): one file's name, type and size from Drive; or a folder walked
 * (subfolders three deep, 400 files at most, a subfolder's files named "Sub/Name"). The pull reads through here,
 * and so does the Drive hand-in's picker, so the editor picks from exactly what the copy will find.
 */
export async function readDriveTarget(kind: 'folder' | 'file', driveId: string, opts: { cuts?: boolean } = {}): Promise<DriveTargetFile[]> {
  const seen: DriveTargetFile[] = []
  const walk = async (folderId: string, prefix: string, depth: number) => {
    if (seen.length >= MAX_FILES || depth > MAX_DEPTH) return
    const listing = await listFolder(folderId)
    for (const e of listing.entries) {
      if (seen.length >= MAX_FILES) break
      if (kindOf(e.mimeType, e.name) === 'folder') { await walk(e.id, `${prefix}${e.name}/`, depth + 1); continue }
      seen.push({ id: e.id, name: `${prefix}${e.name}`, mime: e.mimeType || 'application/octet-stream', size: typeof e.size === 'number' ? e.size : null, modified: (e as { modified?: string | null }).modified ?? null, md5: e.md5 ?? null, revision: e.revision ?? null })
    }
  }
  if (kind === 'file') {
    // one file: its name, type and size from Drive, nothing to walk
    const meta = await driveFileMeta(driveId)
    if (meta) seen.push({ id: driveId, name: meta.name, mime: meta.mime, size: meta.size, modified: meta.modified, md5: meta.md5 ?? null, revision: meta.revision ?? null })
  } else {
    await walk(driveId, '', 0)
    // WHICH CUT EACH FILE IS (30 Sep 2026): a folder read through Google's public view carries no change time and no
    // checksum (live: four .MOV files came back size null, modified null), so each such file is asked for by id — read
    // only. What Drive still will not say stays unknown, and an unknown cut is treated as a new one (drive-handin-core)
    // (only for a hand-in, which has to tell cuts apart — a footage folder of 400 clips is not asked 400 times)
    for (const f of opts.cuts ? seen : []) {
      if (f.modified || f.md5) continue
      const meta = await driveFileMeta(f.id).catch(() => null)
      if (!meta) continue
      f.size = f.size ?? meta.size
      f.modified = meta.modified ?? null
      f.md5 = meta.md5 ?? null
      f.revision = meta.revision ?? null
    }
  }
  return seen
}

/** step one: what is in the folder now, merged with what is already here */
export async function runPullList(id: string, version: number | null): Promise<{ files: number; bytes: number; note?: string }> {
  const pulls = table<DrivePull>('drive_pulls')
  const row = await pulls.get(id)
  if (!row) return { files: 0, bytes: 0, note: 'no row' }
  // called off before it began (the link was replaced) — nothing to read
  if ((row as { cancelled_at?: string | null }).cancelled_at) return { files: 0, bytes: 0, note: 'cancelled' }
  // WHAT WENT WRONG, ON THE ROW (16 Sep 2026): a step that throws is retried
  // by Inngest, which keeps no words — the row keeps them, so the bar says why
  const handIn = (row as { purpose?: string | null }).purpose === 'handin'
  try {
    const listed = await listInto(pulls, row, version)
    // a hand-in whose link could not be read says so on the card (drive-handin.ts)
    if (handIn && listed.note === 'unreadable') {
      const { failDriveHandIn } = await import('./drive-handin')
      const { NOT_SHARED_WORDS } = await import('./drive-handin-core')
      await failDriveHandIn(id, NOT_SHARED_WORDS).catch(() => undefined)
    }
    return listed
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await pulls.update(id, { status: 'failed', error: `Could not read the folder: ${message}`.slice(0, 500), finished_at: new Date().toISOString(), updated_at: new Date().toISOString() } as never).catch(() => undefined)
    // (a hand-in is NOT failed here: Inngest retries this step, and the card reads the row's words meanwhile)
    throw e
  }
}

async function listInto(pulls: ReturnType<typeof table<DrivePull>>, row: DrivePull, version: number | null): Promise<{ files: number; bytes: number; note?: string }> {
  const id = row.id
  await pulls.update(id, { status: 'listing', updated_at: new Date().toISOString() } as never)

  const target = driveTargetOf(row.folder_url)
  const handIn = (row as { purpose?: string | null }).purpose === 'handin'
  const listed = await readDriveTarget(target?.kind === 'file' ? 'file' : 'folder', target?.kind === 'file' ? target.id : row.folder_id, { cuts: handIn })
  // A HAND-IN copies only what the editor picked (drive-handin-core.ts)
  const only = Array.isArray((row as { only_ids?: unknown }).only_ids) ? new Set(((row as unknown as { only_ids: unknown[] }).only_ids).map(String)) : null
  const seen = only ? listed.filter(f => only.has(f.id)) : listed
  // where the step has got to, on the row — so a stall says where it stalled
  await pulls.update(id, { total_files: seen.length, error: `Read the folder: ${seen.length} files`, updated_at: new Date().toISOString() } as never)

  if (seen.length === 0) {
    await pulls.update(id, {
      status: 'unreadable', finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      error: `The ${target?.kind === 'file' ? 'file' : 'folder'} could not be read — share it with the agency’s Drive account, or set it to anyone with the link, then pull again.`,
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

  // EVERY ROUND KEEPS ITS FILES (the owner, 16 Sep 2026: "he uploaded two files
  // already — it should be version 2"). A file already copied stands when
  // it is the same file (same size, same last-changed time); handed in
  // again in a later round it is listed under that round too, one copy
  // serving both. A file replaced in Drive under the same link is copied
  // again for the new round, beside the old copy, so version 1 still plays.
  const before = filesOf(row)
  const files: PullFile[] = []
  for (const f of seen) {
    const olds = before.filter(b => b.id === f.id && b.status === 'done' && !!b.url)
    const latest = [...olds].sort((a, b) => fileRound(b) - fileRound(a))[0]
    const round = version ?? null
    // A HAND-IN copies again unless Drive PROVES it is the same cut — the same checksum, revision or change time
    // (30 Sep 2026: a clip re-exported over itself keeps its id and, on a public folder, its size is all we had). Any
    // other pull keeps its old rule.
    const same = handIn
      ? !!latest && sameDriveCut(latest, f)
      : !!latest && latest.size === f.size && (!f.modified || !latest.modified || latest.modified === f.modified)
    // earlier rounds' copies stay as they are, one per round
    const kept = new Map<number, PullFile>()
    for (const o of olds) if (round === null || fileRound(o) !== round) kept.set(fileRound(o), o)
    if (same && latest) {
      if (round === null || fileRound(latest) === round) kept.set(fileRound(latest), { ...latest, name: f.name })
      else kept.set(round, { ...latest, name: f.name, version: round })
    }
    files.push(...[...kept.values()].sort((a, b) => fileRound(a) - fileRound(b)))
    if (!same) files.push({ id: f.id, name: f.name, mime: f.mime, size: f.size, done: 0, url: null, status: 'waiting', upload_id: null, parts: [], version: round, modified: f.modified, ...(handIn ? { md5: f.md5 ?? null, revision: f.revision ?? null, key_tag: Date.now().toString(36) } : {}) })
  }
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

/**
 * ONE SLICE FROM DRIVE, ASKED AGAIN WHEN DRIVE REFUSES IT (2 Oct 2026, Justin's September Videos: one refused slice
 * of one 700 MB file failed the whole 8-file hand-in, and the same press 13 minutes later copied everything). A
 * refusal or a short read is asked again after a pause, up to SLICE_TRIES times; a slice that overran its four
 * minutes is not, so a stuck Drive still ends the step in time.
 */
export const SLICE_TRIES = 3
const SLICE_PAUSE_MS = [3_000, 10_000]
async function readSlice(fileId: string, start: number, end: number, want: number): Promise<Buffer> {
  let last: unknown = null
  for (let attempt = 0; attempt < SLICE_TRIES; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, SLICE_PAUSE_MS[attempt - 1] ?? 10_000))
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 240_000)
    try {
      const res = await openDriveFile(fileId, `bytes=${start}-${end}`, ctrl.signal)
      if (!res || !res.body) throw new Error('Drive stopped handing the file out')
      const bytes = Buffer.from(await res.arrayBuffer())
      if (bytes.length !== want) throw new Error(`Drive sent ${bytes.length} bytes for a slice of ${want}`)
      return bytes
    } catch (e) {
      last = e
      if (ctrl.signal.aborted) break
    } finally { clearTimeout(timer) }
  }
  throw last instanceof Error ? last : new Error('Drive stopped handing the file out')
}

/** a few slices of one file — returns whether the file is complete */
export async function runPullSlices(id: string, fileId: string): Promise<{ done: boolean; error?: string; cancelled?: boolean }> {
  const pulls = table<DrivePull>('drive_pulls')
  const row = await pulls.get(id)
  if (!row) return { done: true, error: 'no row' }
  // called off (the link was replaced): nothing more is moved, nothing written
  if ((row as { cancelled_at?: string | null }).cancelled_at) return { done: true, cancelled: true }
  const files = filesOf(row)
  // the copy still to make: a file changed in Drive has its new-round copy listed beside its earlier one (same id),
  // and it is the new one this step is for — the earlier copy is done and stays as it is (30 Sep 2026)
  const file = files.find(f => f.id === fileId && f.status !== 'done') ?? files.find(f => f.id === fileId)
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
      // the row, fresh, between slices: a replaced link stops the copy here,
      // not 700 MB later (16 Sep 2026)
      if (i > 0) {
        const fresh = await pulls.get(id) as (DrivePull & { cancelled_at?: string | null }) | null
        if (fresh?.cancelled_at) {
          if (file.upload_id) await abortMultipart(key, file.upload_id).catch(() => undefined)
          return { done: true, cancelled: true }
        }
      }
      // one slice, one request, abandoned if it overruns — never the whole file
      const want = slice.end - slice.start + 1
      const bytes = await readSlice(file.id, slice.start, slice.end, want)
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
  // a cancelled pull keeps its own words — never settled over
  if ((row as { cancelled_at?: string | null }).cancelled_at) return 'failed'
  const files = filesOf(row)
  const failed = files.filter(f => f.status === 'failed')
  const status = failed.length === 0 ? 'done' : 'failed'
  // A PREVIEW OF EVERY VIDEO COPY (16 Sep 2026: "hover over the clip and it
  // shows the frames"): Cloudflare Stream's small copy gives the tile its
  // still and its hover frames, whatever the master is — a 4K .mov included.
  // Only clips a person will scrub: a camera master past 800 MB is left as
  // the copy alone (Stream is billed by the minute stored).
  previewVideos(files.filter(f => f.status === 'done' && !!f.url && fileKindOf(f.mime, f.name) === 'video' && (f.size ?? 0) <= PREVIEW_MAX_BYTES).map(f => f.url))
  await pulls.update(id, {
    status, finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    error: failed.length ? `${failed.length} ${failed.length === 1 ? 'file' : 'files'} could not be copied (${failed[0].name}${failed[0].error ? `: ${failed[0].error}` : ''})` : null,
  } as never)
  // A VERSION HANDED IN FROM DRIVE (30 Sep 2026): the picked files, once all copied, go onto the card as its
  // files through the same rules an upload follows — or, if any did not copy, nothing does and the card says which
  if (row.kind === 'item' && (row as { purpose?: string | null }).purpose === 'handin') {
    try {
      const { settleDriveHandIn } = await import('./drive-handin')
      await settleDriveHandIn(id)
    } catch (e) {
      console.error('[drive-pull] the Drive hand-in could not be put on the card:', e instanceof Error ? e.message : e)
    }
    return status
  }
  // EVERY DRIVE HAND-IN BECOMES FILES (24 Sep 2026): a card's finished edit, once copied, is merged into its
  // files on the server — nobody has to open the card for it. Best effort: the copy is kept either way.
  if (row.kind === 'item' && (row as { purpose?: string | null }).purpose === 'finished') {
    try {
      const { adoptClips } = await import('./adopt-clips')
      const item = await table('content_items').get(row.scope_id)
      if (item) await adoptClips(item as never, (row as { by?: string | null }).by ?? null)
    } catch (e) {
      console.error('[drive-pull] the hand-in could not be turned into files:', e instanceof Error ? e.message : e)
    }
  }
  return status
}
