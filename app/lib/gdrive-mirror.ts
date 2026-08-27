import 'server-only'
import { supabase } from '@/lib/supabase'
import { inngest } from '../inngest/client'
import {
  FINAL_FOLDER, NO_SHOOT_FINAL_FOLDER, brandChain, dayStamp, fromClientChain,
  intakeFileTarget, scheduledChain,
} from './gdrive-core'
import {
  driveConfigured, ensureChain, ensureChainWithLink, rootFolderId,
} from './gdrive'
import { copyDriveFile, driveFileUrl, moveDriveFile, uploadStreamToFolder } from './gdrive-files'
import { ensureItemFoldersNow, ensureShootFoldersNow, type BatchLike, type ItemLike } from './gdrive-hooks'
import {
  earliestScheduledMonth, fileNameFromUrl, isClientTarget, isMirrorableUrl,
  mirrorProgress, versionFileName, type MirrorTarget, type MirrorProgress,
} from './gdrive-mirror-core'

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

/** Fire-and-forget, for request handlers. */
export function mirrorFiles(files: MirrorRequest[]): void {
  void requestMirror(files).catch(e => console.error('[gdrive] mirror request:', e))
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

/** Job-pack assets → the item's own Drive folder, under their own names. */
export function mirrorRawAssets(itemId: string, assets: RawAsset[]): void {
  mirrorFiles(assets.map(a => ({
    item_id: itemId,
    source_url: a.url,
    name: String(a.name ?? '').trim() || fileNameFromUrl(a.url),
    target: 'item' as const,
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
  const { data } = await supabase
    .from('asset_versions')
    .select('version_number, file_url')
    .eq('item_id', itemId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data || !isMirrorableUrl(data.file_url)) return 0
  return requestMirror([{
    item_id: itemId,
    source_url: data.file_url as string,
    name: versionFileName(data.version_number as number, fileNameFromUrl(data.file_url as string)),
    target,
  }])
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
  const { data } = await supabase
    .from('content_items')
    .select('id, client_id, batch_id, title, content_type, work_kind_id, drive_folder_id, raw_assets_url')
    .eq('id', itemId)
    .maybeSingle()
  return (data as ItemRow) ?? null
}

/** The item's own folder, created now if the create hook never got to it. */
async function itemFolderId(item: ItemRow): Promise<string | null> {
  if (item.drive_folder_id) return item.drive_folder_id
  await ensureItemFoldersNow([item as ItemLike])
  const again = await loadItem(item.id)
  return again?.drive_folder_id ?? null
}

async function clientName(clientId: string): Promise<string | null> {
  const { data } = await supabase
    .from('clients').select('name').eq('id', clientId).maybeSingle()
  return String(data?.name ?? '').trim() || null
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

  if (target === 'final') {
    if (item.batch_id) {
      const { data: batch } = await supabase.from('batches')
        .select('id, client_id, title, shoot_date, created_at, drive_folder_id')
        .eq('id', item.batch_id).maybeSingle()
      const shootId = batch ? await ensureShootFoldersNow(batch as BatchLike) : null
      if (!shootId) return { skip: 'no shoot folder' }
      const made = await ensureChain(shootId, [FINAL_FOLDER])
      return made.ok ? { id: made.id } : { skip: made.message }
    }
    // shoot-less: finals hang off the item's own folder, because with no
    // shoot to group them the deliverable is the only grouping there is
    const id = await itemFolderId(item)
    if (!id) return { skip: 'no item folder' }
    const made = await ensureChain(id, [NO_SHOOT_FINAL_FOLDER])
    return made.ok ? { id: made.id } : { skip: made.message }
  }

  // scheduled — the month the piece FIRST goes out
  const { data: entries } = await supabase
    .from('schedule_entries').select('scheduled_at').eq('item_id', item.id)
  const month = earliestScheduledMonth(entries ?? [])
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

  const { data: existing } = await supabase
    .from('drive_files')
    .select('id, drive_file_id, drive_url, bytes')
    .eq('source_url', req.source_url)
    .eq('target', req.target)
    .maybeSingle()

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
    const { error } = await supabase.from('drive_files').insert({
      item_id: item?.id ?? null,
      client_id: item?.client_id ?? req.client_id ?? null,
      source_url: req.source_url,
      target: req.target,
    })
    if (error) {
      // lost the claim to a concurrent run — which is the claim working
      if (/duplicate key/i.test(error.message)) return { status: 'already' }
      throw new Error(error.message)
    }
  }

  // the same bytes already in Drive for this item are copied server-side
  // rather than dragged across the internet a second time
  const { data: source } = req.target === 'item' ? { data: null } : await supabase
    .from('drive_files')
    .select('drive_file_id')
    .eq('source_url', req.source_url)
    .eq('target', 'item')
    .not('drive_file_id', 'is', null)
    .maybeSingle()

  const result = source?.drive_file_id
    ? await copyDriveFile(source.drive_file_id, req.name, folder.id)
    : await uploadStreamToFolder({
        sourceUrl: req.source_url, name: req.name, parentId: folder.id,
      })
  if (!result.ok) {
    throw new Error(`${result.message}${result.detail ? ` — ${result.detail}` : ''}`)
  }

  await supabase.from('drive_files')
    .update({
      drive_file_id: result.id,
      drive_url: driveFileUrl(result.id),
      bytes: result.bytes || null,
    })
    .eq('source_url', req.source_url)
    .eq('target', req.target)

  return {
    status: 'mirrored',
    drive_file_id: result.id,
    bytes: result.bytes,
    copied: Boolean(source?.drive_file_id),
  }
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
 */
export async function itemMirrorProgress(
  itemId: string, rawAssets: RawAsset[] | null,
): Promise<MirrorProgress> {
  if (!driveConfigured()) return mirrorProgress(0, 0)
  const [versionsRes, mirroredRes] = await Promise.all([
    supabase.from('asset_versions').select('file_url').eq('item_id', itemId),
    supabase.from('drive_files')
      .select('source_url')
      .eq('item_id', itemId)
      .eq('target', 'item')
      .not('drive_file_id', 'is', null),
  ])
  const wanted = new Set<string>()
  for (const a of rawAssets ?? []) if (isMirrorableUrl(a?.url)) wanted.add(a.url)
  for (const v of versionsRes.data ?? []) {
    if (isMirrorableUrl(v.file_url as string)) wanted.add(v.file_url as string)
  }
  const done = (mirroredRes.data ?? [])
    .filter(r => wanted.has(r.source_url as string)).length
  return mirrorProgress(wanted.size, done)
}
