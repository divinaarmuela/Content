import 'server-only'
import { after } from 'next/server'
import { DbError, table } from '@/lib/db'
import type {
  AssetVersion, Batch, Client, ContentItem, DriveFile, ScheduleEntry,
} from '@/lib/db-types'
import { inngest } from '../inngest/client'
import {
  FINAL_FOLDER, NO_SHOOT_FINAL_FOLDER, NO_SHOOT_RAW_FOLDER, RAW_FOLDER,
  brandChain, dayStamp, fromClientChain, intakeFileTarget, scheduledChain,
} from './gdrive-core'
import {
  driveConfigured, ensureChain, ensureChainWithLink, rootFolderId,
} from './gdrive'
import { copyDriveFile, driveFileUrl, moveDriveFile, uploadStreamToFolder } from './gdrive-files'
import { ensureItemFoldersNow, ensureShootFoldersNow, type BatchLike, type ItemLike } from './gdrive-hooks'
import {
  RAW_ASSET_TARGET, earliestScheduledMonth, fileNameFromUrl, isClientTarget,
  isMirrorableUrl, mirrorKey, mirrorProgress, misfiledRawMirrors,
  missingItemMirrors, versionFileName,
  type DriveFileRow, type MirrorTarget, type MirrorProgress, type SweepItem,
  type SweepVersion,
} from './gdrive-mirror-core'
import { slideFileName, slidesOf, type Slide } from './version-files-core'

/**
 * Drive as a copy of the work, not an index of it.
 *
 * The folder tree gave every shoot and every deliverable a folder and put a
 * link on the board. That is an index: the folders were real and empty, and
 * the actual footage stayed in our own storage behind a dashboard login. What
 * the agency asked for is the other thing — "every file uploaded will go
 * there" — so a file that lands on an item is copied INTO that item's folder,
 * the approved cut is copied into the shoot's finals, and a piece with a date
 * on it is copied into the month it goes out. Somebody with nothing but Drive
 * has the whole archive.
 *
 * ── Why this runs in Inngest and not in the request ──
 *
 * A master cut is gigabytes moving from Cloudflare to Google. That cannot ride
 * a request, and `after()` — which is enough for creating a folder — is still
 * bounded by the function's own lifetime. Inngest gives the one thing that
 * actually matters here: retries. A transfer that dies at 80% is retried by
 * the platform rather than lost silently, which is the difference between a
 * mirror and a mirror-shaped intention.
 *
 * ── Why nothing is ever uploaded twice ──
 *
 * `drive_files` has `unique (source_url, target)`, and the row is inserted
 * BEFORE the bytes move. The insert is the claim: a second run — a retry, a
 * duplicated event, two people saving the same item at once — loses the insert
 * and knows immediately that it has nothing to do. A claim whose upload then
 * failed keeps `drive_file_id` null, which is what a retry looks for to know
 * it may take the job back. Drive has no unique-name constraint of its own, so
 * without this a retry would leave two 2 GB files in a folder and no way to
 * tell which was which. Same pattern as `email_ingest_log.gmail_message_id`.
 */

export const MIRROR_EVENT = 'drive/mirror.file'

export type MirrorRequest = {
  /** the piece of work this file belongs to — absent for a client-level file */
  item_id?: string | null
  /** the client, for `from_client` and `brand`, which belong to nobody's item */
  client_id?: string | null
  source_url: string
  /** what it should be CALLED in Drive, already decided by the caller */
  name: string
  target: MirrorTarget
  /** when it ARRIVED, for the folders filed by date. Defaults to now. */
  received_at?: string | null
}

// ── sending the work off ──────────────────────────────────────────────────

/**
 * Ask for files to be mirrored. Never throws, never blocks.
 *
 * Drive not connected is a silent no-op — the whole integration is optional
 * and the board worked before it existed. It is logged ONCE per process
 * rather than per file, because a shoot drop is two hundred files and two
 * hundred identical log lines is how a real error gets buried.
 */
let loggedNotConnected = false

export async function requestMirror(files: MirrorRequest[]): Promise<number> {
  const wanted = files.filter(f =>
    (f.item_id || f.client_id) && isMirrorableUrl(f.source_url))
  if (wanted.length === 0) return 0
  if (!driveConfigured()) return 0
  try {
    const root = await rootFolderId()
    if (!root) {
      if (!loggedNotConnected) {
        console.log('[gdrive] not connected — files are not being mirrored to Drive')
        loggedNotConnected = true
      }
      return 0
    }
    loggedNotConnected = false
    // `scope` is the concurrency key the function serialises on: two files
    // racing to create the same missing folder is how a duplicate folder
    // appears, and the thing they'd collide over is the item — or, for a
    // client-level file, the client. One field so the expression is one field.
    await inngest.send(wanted.map(data => ({
      name: MIRROR_EVENT,
      data: { ...data, scope: data.item_id ?? data.client_id ?? '' },
    })))
    return wanted.length
  } catch (e) {
    // a mirror that could not be QUEUED must never fail the upload, the
    // approval or the schedule that triggered it
    console.error('[gdrive] could not queue a mirror:', e)
    return 0
  }
}

/**
 * Fire-and-forget, for request handlers.
 *
 * Through Next's `after()`, not a bare `void`: on Vercel a function that has
 * sent its response can be frozen before a detached promise finishes, and a
 * queue call that never left is a file that never reaches Drive — three raw
 * files were dropped on an item and one arrived. `after()` keeps the function
 * alive until the work is done; outside a request scope (tests, scripts) it
 * throws, and the detached call is the fallback.
 */
export function mirrorFiles(files: MirrorRequest[]): void {
  const job = () => requestMirror(files).catch(e => console.error('[gdrive] mirror request:', e))
  try {
    after(job)
  } catch {
    void job()
  }
}

// ── the callers' shapes ───────────────────────────────────────────────────

export type RawAsset = { url: string; name: string }

/**
 * The job-pack files that are NEW in this save.
 *
 * The items PATCH rewrites the whole `raw_assets` array every time — the
 * upload queue reads it, appends one file and sends it back — so "what was
 * just added" is a set difference, not the payload. Without it, dropping a
 * two-hundredth file would re-queue all two hundred.
 */
export function newRawAssets(before: RawAsset[] | null, after: RawAsset[] | null): RawAsset[] {
  const had = new Set((before ?? []).map(a => String(a?.url ?? '')))
  const seen = new Set<string>()
  return (after ?? []).filter(a => {
    const url = String(a?.url ?? '')
    if (!url || had.has(url) || seen.has(url)) return false
    seen.add(url)
    return true
  })
}

/**
 * Job-pack assets → the SHOOT's `01 Raw`, under their own names.
 *
 * Not the item's own folder, which is where they used to go and which was
 * wrong: `02 Edits/{Item}` holds what the editor MADE, and dropping the source
 * footage in beside the cuts is the complaint that started this — "you added
 * to the wrong files, that's not the edited one". Raw material belongs to the
 * shoot, once, where every item cut from that shoot can find it.
 *
 * The name is kept exactly as it was uploaded, with no version prefix: two
 * items on one shoot attaching the same clip is normal, and the
 * `(source_url, target)` claim already means the second one copies nothing.
 */
export function mirrorRawAssets(itemId: string, assets: RawAsset[]): void {
  mirrorFiles(assets.map(a => ({
    item_id: itemId,
    source_url: a.url,
    name: String(a.name ?? '').trim() || fileNameFromUrl(a.url),
    target: RAW_ASSET_TARGET,
  })))
}

/** A new cut → the item's folder as `v3 - Hook cut.mp4`. */
export function mirrorVersion(
  itemId: string, versionNumber: number, fileUrl: string | null | undefined,
): void {
  if (!isMirrorableUrl(fileUrl)) return
  mirrorFiles([{
    item_id: itemId,
    source_url: String(fileUrl),
    name: versionFileName(versionNumber, fileNameFromUrl(fileUrl)),
    target: 'item',
  }])
}

/**
 * Every slide of a version → the item's folder, numbered in posting order.
 *
 * A carousel is six files that only mean anything in sequence, so the name
 * carries the sequence: `v2 - 01 - card-a.jpg`. Mirroring only slide one — the
 * old behaviour, because only slide one existed — put a third of a carousel
 * in Drive and called it the deliverable. A one-slide version keeps the plain
 * `v2 - name`, so nothing already mirrored is copied again under a new name.
 */
export function mirrorVersionSlides(
  itemId: string, versionNumber: number, slides: readonly Slide[],
): void {
  const wanted = slides.filter(s => isMirrorableUrl(s.url))
  if (wanted.length === 0) return
  mirrorFiles(wanted.map((s, i) => ({
    item_id: itemId,
    source_url: s.url,
    name: slideFileName(versionNumber, i, s.name || fileNameFromUrl(s.url), slides.length),
    target: 'item' as const,
  })))
}

/**
 * The latest version of an item → `03 Final` or `_Scheduled/{month}`.
 *
 * The LATEST rather than a remembered one: approval is approval of whatever
 * is currently on top of the stack, and the stack is the only record of that.
 * A version that is only a pasted link has no bytes of ours to copy, so
 * nothing is queued and nothing is claimed to have been.
 */
export async function mirrorLatestVersion(
  itemId: string, target: 'final' | 'scheduled',
): Promise<number> {
  if (!driveConfigured()) return 0
  const data = (await table<AssetVersion>('asset_versions').list({
    by: { item_id: itemId },
    orderBy: [['version_number', 'desc']],
    limit: 1,
  }))[0]
  if (!data) return 0
  // the whole carousel, not its cover: what was approved is the set of slides
  const slides = slidesOf(data).filter(s => isMirrorableUrl(s.url))
  if (slides.length === 0) return 0
  const n = data.version_number as number
  return requestMirror(slides.map((s, i) => ({
    item_id: itemId,
    source_url: s.url,
    name: slideFileName(n, i, s.name || fileNameFromUrl(s.url), slides.length),
    target,
  })))
}

/** Fire-and-forget version of the above, for transition and schedule paths. */
export function mirrorLatestVersionSoon(itemId: string, target: 'final' | 'scheduled'): void {
  void mirrorLatestVersion(itemId, target)
    .catch(e => console.error('[gdrive] mirror latest version:', e))
}

/**
 * A client's intake uploads → `_From client/{day}`, or `_Brand` for the ones
 * that are brand material.
 *
 * Fired on SUBMIT rather than on upload, and that is not laziness. The upload
 * route only SIGNS a URL — the browser PUTs the bytes afterwards, so a mirror
 * queued there would race the file into existence and spend three retries
 * fetching a 404. Submit is the first moment every file is certainly there.
 */
export function mirrorIntakeFiles(
  clientId: string,
  files: { block_id?: string | null; label?: string | null; filename?: string | null; url?: string | null }[],
  receivedAt?: string | null,
): void {
  if (!clientId) return
  mirrorFiles(files
    .filter(f => isMirrorableUrl(f.url))
    .map(f => ({
      client_id: clientId,
      source_url: String(f.url),
      name: String(f.filename ?? '').trim() || fileNameFromUrl(f.url),
      target: intakeFileTarget(f.block_id, f.label),
      received_at: receivedAt ?? null,
    })))
}

/**
 * A brand guidelines document → `_Brand`.
 *
 * Fired where the SCAN is requested, which is the point the server first
 * learns the document exists and is uploaded — the sign step before it knows
 * only a name and a size.
 */
export function mirrorBrandDoc(
  clientId: string, url: string, filename: string,
): void {
  if (!clientId || !isMirrorableUrl(url)) return
  mirrorFiles([{
    client_id: clientId,
    source_url: url,
    name: String(filename ?? '').trim() || fileNameFromUrl(url),
    target: 'brand',
  }])
}

// ── where each target actually lands ──────────────────────────────────────

type ItemRow = {
  id: string
  client_id: string
  batch_id: string | null
  title: string
  content_type: string | null
  work_kind_id: string | null
  drive_folder_id: string | null
  raw_assets_url: string | null
}

async function loadItem(itemId: string): Promise<ItemRow | null> {
  const row = await table<ContentItem>('content_items').get(itemId)
  return (row as unknown as ItemRow) ?? null
}

/** The item's own folder, created now if the create hook never got to it. */
async function itemFolderId(item: ItemRow): Promise<string | null> {
  if (item.drive_folder_id) return item.drive_folder_id
  await ensureItemFoldersNow([item as ItemLike])
  const again = await loadItem(item.id)
  return again?.drive_folder_id ?? null
}

async function clientName(clientId: string): Promise<string | null> {
  const row = await table<Client>('clients').get(clientId)
  return String(row?.name ?? '').trim() || null
}

/**
 * `_From client/{day}` and `_Brand` — the folders that belong to a CLIENT.
 *
 * Resolved without an item on purpose: a client sends a logo before there is
 * any work to attach it to, and making the mirror wait for one would mean the
 * files that arrive earliest are the ones Drive never gets.
 */
async function clientTargetFolder(
  clientId: string, target: MirrorTarget, receivedAt: string | null,
): Promise<{ id: string } | { skip: string }> {
  const name = await clientName(clientId)
  if (!name) return { skip: 'no client name' }
  if (target === 'brand') {
    const made = await ensureChainWithLink(brandChain(name))
    return made ? { id: made.id } : { skip: 'could not make the brand folder' }
  }
  const day = dayStamp(receivedAt) ?? dayStamp(new Date().toISOString())!
  const made = await ensureChainWithLink(fromClientChain(name, day))
  return made ? { id: made.id } : { skip: 'could not make the delivery folder' }
}

/**
 * Where a copy of this file belongs.
 *
 * `final` is resolved through folder IDs rather than by walking names from the
 * root: the shoot folder may have been renamed in Drive since it was made, and
 * the id is what is still true. `scheduled` is the opposite — it is a folder
 * per month that nothing has created yet, so it is built from a name chain.
 */
async function targetFolder(
  item: ItemRow, target: MirrorTarget,
): Promise<{ id: string } | { skip: string }> {
  if (target === 'item') {
    const id = await itemFolderId(item)
    return id ? { id } : { skip: 'no item folder' }
  }

  // `raw` and `final` are the same shape: a folder of the SHOOT's, reached
  // through the shoot's id, with the item's own folder as the fallback for a
  // deliverable that has no shoot behind it
  if (target === 'raw' || target === 'final') {
    const sub = target === 'raw' ? RAW_FOLDER : FINAL_FOLDER
    if (item.batch_id) {
      const batch = await table<Batch>('batches').get(item.batch_id)
      const shootId = batch ? await ensureShootFoldersNow(batch as unknown as BatchLike) : null
      if (!shootId) return { skip: 'no shoot folder' }
      const made = await ensureChain(shootId, [sub])
      return made.ok ? { id: made.id } : { skip: made.message }
    }
    // shoot-less: both hang off the item's own folder, because with no shoot
    // to group them the deliverable is the only grouping there is — and
    // `Raw`/`Final` rather than `01 Raw`/`03 Final`, since there are no
    // stages here for the numbers to order
    const id = await itemFolderId(item)
    if (!id) return { skip: 'no item folder' }
    const made = await ensureChain(
      id, [target === 'raw' ? NO_SHOOT_RAW_FOLDER : NO_SHOOT_FINAL_FOLDER],
    )
    return made.ok ? { id: made.id } : { skip: made.message }
  }

  // scheduled — the month the piece FIRST goes out
  const entries = await table<ScheduleEntry>('schedule_entries').list({ by: { item_id: item.id } })
  const month = earliestScheduledMonth(entries)
  if (!month) return { skip: 'nothing scheduled yet' }
  const name = await clientName(item.client_id)
  if (!name) return { skip: 'no client name' }
  const made = await ensureChainWithLink(scheduledChain(name, month))
  return made ? { id: made.id } : { skip: 'could not make the month folder' }
}

// ── the job itself ────────────────────────────────────────────────────────

export type MirrorOutcome =
  | { status: 'mirrored'; drive_file_id: string; bytes: number; copied: boolean }
  | { status: 'already' | 'moved' | 'skipped'; detail?: string }

/**
 * Copy one file into one folder. The body of the Inngest function.
 *
 * Order matters and is deliberate:
 *
 *  1. an existing COMPLETE row ends it — the file is there, nothing to do
 *  2. the folder is resolved before anything is claimed, so a scheduled piece
 *     whose month cannot be worked out yet leaves no half-claim behind
 *  3. for a `scheduled` row that already exists, a resolved folder that is not
 *     the one it is in means the date moved months — the file MOVES rather
 *     than being copied, or the old month would go on claiming a post that is
 *     not happening then
 *  4. the claim is inserted, then the bytes move, then the row is completed
 *
 * Throwing is how a transient failure is reported: Inngest retries the step,
 * and the claim it left behind is what tells the retry it may take the job
 * back rather than skip it as already done.
 */
export async function mirrorFileNow(req: MirrorRequest): Promise<MirrorOutcome> {
  const clientScoped = isClientTarget(req.target)
  if (!isMirrorableUrl(req.source_url)) {
    return { status: 'skipped', detail: 'not a file of ours' }
  }
  if (clientScoped ? !req.client_id : !req.item_id) {
    return { status: 'skipped', detail: 'nothing to file it under' }
  }
  if (!driveConfigured()) return { status: 'skipped', detail: 'Drive not configured' }
  if (!(await rootFolderId())) return { status: 'skipped', detail: 'Drive not connected' }

  // (source_url, target) was a composite unique key; it is checked here
  const files = table<DriveFile>('drive_files')
  const existing = (await files.list({
    where: f => f.source_url === req.source_url && f.target === req.target,
    limit: 1,
  }))[0] ?? null

  const item = clientScoped ? null : await loadItem(String(req.item_id))
  if (!clientScoped && !item) return { status: 'skipped', detail: 'item is gone' }

  const folder = item
    ? await targetFolder(item, req.target)
    : await clientTargetFolder(String(req.client_id), req.target, req.received_at ?? null)
  if ('skip' in folder) return { status: 'skipped', detail: folder.skip }

  // an already-mirrored scheduled file whose month has changed is re-parented,
  // not re-copied
  if (existing?.drive_file_id) {
    if (req.target !== 'scheduled') return { status: 'already' }
    const moved = await moveDriveFile(existing.drive_file_id, folder.id)
    if (!moved.ok) throw new Error(`${moved.message}${moved.detail ? ` — ${moved.detail}` : ''}`)
    return moved.moved ? { status: 'moved' } : { status: 'already' }
  }

  // claim it, unless a row is already ours to complete
  if (!existing) {
    try {
      await table('drive_files').insert({
        item_id: item?.id ?? null,
        client_id: item?.client_id ?? req.client_id ?? null,
        source_url: req.source_url,
        target: req.target,
      })
    } catch (e) {
      // lost the claim to a concurrent run — which is the claim working
      if (e instanceof DbError && e.code === 'unique') return { status: 'already' }
      throw e
    }
  }

  // the same bytes already in Drive under ANY other target are copied
  // server-side rather than dragged across the internet a second time. Any,
  // not `item`: since raw split off, a job-pack asset's first copy lives under
  // `raw`, and a lookup fixed on `item` would re-upload a 2 GB clip to file it
  // in the finals.
  const source = (await files.list({
    where: f => f.source_url === req.source_url
      && f.target !== req.target
      && f.drive_file_id != null,
    limit: 1,
  }))[0] ?? null

  const result = source?.drive_file_id
    ? await copyDriveFile(source.drive_file_id, req.name, folder.id)
    : await uploadStreamToFolder({
        sourceUrl: req.source_url, name: req.name, parentId: folder.id,
      })
  if (!result.ok) {
    throw new Error(`${result.message}${result.detail ? ` — ${result.detail}` : ''}`)
  }

  const claimed = await files.list({
    where: f => f.source_url === req.source_url && f.target === req.target,
  })
  await Promise.all(claimed.map(f => files.update(f.id, {
    drive_file_id: result.id,
    drive_url: driveFileUrl(result.id),
    bytes: result.bytes || null,
  })))

  return {
    status: 'mirrored',
    drive_file_id: result.id,
    bytes: result.bytes,
    copied: Boolean(source?.drive_file_id),
  }
}

// ── the self-healing pass ─────────────────────────────────────────────────

/** How far back a sweep looks. Long enough to cover a frozen weekend and the
 *  Monday nobody noticed; short enough that the query stays small. */
export const MIRROR_SWEEP_DAYS = 14
/** Files queued per run. A bound on spend, not on eventual completeness — the
 *  remainder is still missing next time, and the run after that. */
export const MIRROR_SWEEP_CAP = 100
/** Items examined per run. */
const SWEEP_ITEM_LIMIT = 500

/** Misfiled raw files moved per run. Every one is a Drive PATCH, and the rest
 *  are still misfiled on the next pass — which is the point of a cap. */
export const RAW_MIGRATION_CAP = 50

export type MirrorSweepResult = {
  /** items examined */
  items: number
  /** files that should be in Drive and were not */
  missing: number
  /** …of those, how many were actually queued */
  queued: number
  /** raw files moved out of `02 Edits` into `01 Raw` */
  moved: number
}

/**
 * Move the raw footage that is already in the wrong folder.
 *
 * A one-off correction that rides the sweep instead of being a script anybody
 * has to remember to run, and instead of an Inngest function of its own —
 * which would do nothing at all until the app was re-synced (CLAUDE.md trap
 * 5b). It moves the Drive file with `addParents`/`removeParents` rather than
 * copying it: the bytes are already in Drive and already correct, and a copy
 * would leave the wrong one behind for somebody to open by mistake.
 *
 * Idempotent twice over. `misfiledRawMirrors` only picks rows still marked
 * `target: 'item'`, so a row already rewritten is never looked at again; and if
 * the process dies between the move and the rewrite, the next run asks Drive to
 * move a file that is already there, which answers `moved: false` and falls
 * straight through to the rewrite that was missed.
 *
 * A file that cannot be moved — deleted in Drive, permission revoked — is
 * logged and skipped, never retried into a loop and never allowed to take the
 * rest of the sweep down with it.
 */
async function migrateMisfiledRaw(
  items: SweepItem[], rows: DriveFileRow[],
): Promise<number> {
  const misfiled = misfiledRawMirrors(items, rows, RAW_MIGRATION_CAP)
  if (misfiled.length === 0) return 0

  // one full read per ITEM, not per file: three misfiled clips on one item is
  // the normal shape of this, and each needs the same folder resolved
  const loaded = new Map<string, ItemRow | null>()
  const itemRow = async (id: string): Promise<ItemRow | null> => {
    if (!loaded.has(id)) loaded.set(id, await loadItem(id))
    return loaded.get(id) ?? null
  }

  let moved = 0
  for (const row of misfiled) {
    const item = await itemRow(row.item_id)
    if (!item) continue
    try {
      const folder = await targetFolder(item, 'raw')
      if ('skip' in folder) {
        console.error(`[gdrive] raw migration: ${row.source_url} — ${folder.skip}`)
        continue
      }
      const res = await moveDriveFile(row.drive_file_id, folder.id)
      if (!res.ok) {
        console.error(`[gdrive] raw migration: ${row.source_url} — ${res.message}`)
        continue
      }
      // the row IS the claim, so it is rewritten rather than re-inserted: a
      // second row would hold the same drive_file_id under two targets and the
      // next sweep would try to mirror the file again
      try {
        const driveFiles = table<DriveFile>('drive_files')
        const live = await driveFiles.get(row.id)
        if (live?.target !== 'item') continue
        await driveFiles.update(row.id, { target: 'raw' })
      } catch (e) {
        console.error(`[gdrive] raw migration: ${row.source_url} —`, e)
        continue
      }
      // and in the caller's copy of the row, so the sweep that follows counts
      // this file where it now lives instead of asking for it all over again
      const live = rows.find(r => String(r?.id ?? '') === row.id)
      if (live) live.target = 'raw'
      moved++
    } catch (e) {
      console.error(`[gdrive] raw migration: ${row.source_url} —`, e)
    }
  }
  if (moved > 0) {
    console.log(`[gdrive] raw migration: moved ${moved} file(s) from 02 Edits into 01 Raw`)
  }
  return moved
}

/**
 * Find files that never made it to Drive and ask for them again.
 *
 * Not a retry queue: there is nothing to retry FROM. A mirror that was never
 * queued left no trace anywhere — no event, no `drive_files` row, no error —
 * so the only way to find it is to recompute what should be there and compare.
 * `missingItemMirrors` does that arithmetic; this does the four reads it needs
 * and hands the difference to the same `requestMirror` every upload path uses.
 *
 * Runs inside the existing half-hourly cron rather than as a function of its
 * own, because a NEW Inngest function does nothing at all until the app is
 * re-synced (see CLAUDE.md) — a self-healing job that itself silently does
 * nothing would be the joke writing itself.
 *
 * `itemIds` narrows it to one item, which is the "Retry Drive copy" button.
 */
export async function sweepMissingMirrors(opts?: {
  itemIds?: string[]
  days?: number
  cap?: number
}): Promise<MirrorSweepResult> {
  const empty: MirrorSweepResult = { items: 0, missing: 0, queued: 0, moved: 0 }
  if (!driveConfigured()) return empty

  const one = (opts?.itemIds ?? []).filter(Boolean).slice(0, 50)
  const since = new Date(
    Date.now() - (opts?.days ?? MIRROR_SWEEP_DAYS) * 24 * 60 * 60 * 1000,
  ).toISOString()
  let itemRows: ContentItem[]
  try {
    itemRows = one.length > 0
      ? await table<ContentItem>('content_items').list({ where: r => one.includes(r.id) })
      // recently touched, not everything ever made: a file that was going to be
      // mirrored was going to be mirrored because somebody just saved something
      : await table<ContentItem>('content_items').list({
          where: r => r.updated_at >= since,
          orderBy: [['updated_at', 'desc']],
          limit: SWEEP_ITEM_LIMIT,
        })
  } catch (e) {
    console.error('[gdrive] mirror sweep could not read items:', e instanceof Error ? e.message : e)
    return empty
  }
  const ids = itemRows.map(r => String(r.id))
  if (ids.length === 0) return empty

  const [versions, mirroredRows] = await Promise.all([
    table<AssetVersion>('asset_versions').list({ where: v => ids.includes(v.item_id) }),
    // a claim with no drive_file_id is an upload that DIED, and asking for it
    // again is exactly what the claim was left behind for — so only completed
    // rows count as "already there". Both item-scoped targets, because a file
    // in `01 Raw` and a file in `02 Edits` are different questions now.
    table<DriveFile>('drive_files').list({
      where: f => f.item_id != null
        && ids.includes(f.item_id)
        && ['item', 'raw'].includes(f.target)
        && f.drive_file_id != null,
    }),
  ])

  const versionsByItem = new Map<string, SweepVersion[]>()
  for (const v of versions) {
    const key = String(v.item_id)
    const list = versionsByItem.get(key) ?? []
    list.push(v as unknown as SweepVersion)
    versionsByItem.set(key, list)
  }
  const items: SweepItem[] = itemRows.map(r => ({
    id: String(r.id),
    raw_assets: Array.isArray(r.raw_assets) ? r.raw_assets : [],
    versions: versionsByItem.get(String(r.id)) ?? [],
  }))
  const rows = mirroredRows as unknown as DriveFileRow[]

  // FIRST, put right what is in the wrong folder — before working out what is
  // missing. A raw file sitting in `02 Edits` is already a completed row, so
  // the arithmetic below would call it done and leave it there forever; moving
  // it makes it a `raw` row, and the same pass then sees `01 Raw` as satisfied
  // rather than queueing a second copy of a file Drive already holds.
  const moved = await migrateMisfiledRaw(items, rows)

  // `rows` is re-targeted in place by the migration, so a file moved a moment
  // ago is counted where it now is rather than being queued for `01 Raw` again
  const mirrored = rows.map(r => mirrorKey(String(r.target), String(r.source_url)))

  const missing = missingItemMirrors(items, mirrored, opts?.cap ?? MIRROR_SWEEP_CAP)
  if (missing.length === 0) return { items: ids.length, missing: 0, queued: 0, moved }

  const queued = await requestMirror(missing)
  // one line per run, and only when it found something — a sweep that finds
  // nothing is the normal case and must not fill the log with proof of it
  console.log(
    `[gdrive] mirror sweep: ${missing.length} file(s) missing across ${ids.length} item(s), queued ${queued}`,
  )
  return { items: ids.length, missing: missing.length, queued, moved }
}

// ── what the item page says ───────────────────────────────────────────────

/**
 * "Mirrored to Drive · 7 files" — counted from what is recorded, not from
 * what was asked for.
 *
 * The denominator is every mirrorable file on the item: its job-pack assets
 * and every version that is an upload rather than a pasted link. Anything not
 * yet in `drive_files` reads as still copying, which is the honest word
 * whether the job is running, queued, or has quietly failed — including the
 * case where a new Inngest function has not been re-synced and the events are
 * being dropped on the floor.
 *
 * Counted by (target, url) pair, not by url, because the item's files are in
 * two folders now: the job pack in the shoot's `01 Raw` and the cuts in the
 * item's own. The line says so, and names the folder the raw ones went to —
 * `01 Raw` for a shoot, `Raw` for a deliverable that has no shoot behind it.
 */
export async function itemMirrorProgress(
  itemId: string, rawAssets: RawAsset[] | null,
): Promise<MirrorProgress> {
  if (!driveConfigured()) return mirrorProgress(0, 0)
  const [versions, mirrored, itemRow] = await Promise.all([
    table<AssetVersion>('asset_versions').list({ by: { item_id: itemId } }),
    table<DriveFile>('drive_files').list({
      where: f => f.item_id === itemId
        && ['item', 'raw'].includes(f.target)
        && f.drive_file_id != null,
    }),
    table<ContentItem>('content_items').get(itemId),
  ])
  // keyed by target: the same clip can be both raw footage and a version, and
  // one copy arriving says nothing about the other
  const wanted = new Set<string>()
  for (const a of rawAssets ?? []) {
    if (isMirrorableUrl(a?.url)) wanted.add(mirrorKey(RAW_ASSET_TARGET, a.url))
  }
  // every SLIDE counts: a six-card carousel with one card copied is not
  // "mirrored", and the line on the item page must not say it is
  for (const v of versions) {
    for (const s of slidesOf(v)) {
      if (isMirrorableUrl(s.url)) wanted.add(mirrorKey('item', s.url))
    }
  }
  const have = mirrored
    .map(r => mirrorKey(String(r.target), String(r.source_url)))
    .filter(k => wanted.has(k))
  const rawDone = have.filter(k => k.startsWith(`${RAW_ASSET_TARGET} `)).length
  return mirrorProgress(
    wanted.size, have.length, rawDone,
    itemRow?.batch_id ? RAW_FOLDER : NO_SHOOT_RAW_FOLDER,
  )
}
