import 'server-only'
import { table } from '@/lib/db'
import type {
  AssetVersion, Client, ContentItem, DriveFile, DriveUpload,
} from '@/lib/db-types'
import { requireRole, type TeamUser } from './authz'
import { pickedRoot, rootFolderId } from './gdrive'

/**
 * What the Files page needs from OUR side of the world: who may look, where
 * the filing cabinet starts, and what the app already knows about a file it
 * can see in Drive.
 *
 * Kept out of `gdrive-files.ts` on purpose. That file talks to Google; this
 * one talks to the database and to Clerk, and mixing them would mean a route
 * test could not stub Drive without also stubbing the team table.
 *
 * ── The rule this file is built around ──
 *
 * The owner's instruction, in their words: the app must never rename, move or
 * delete anything in their Drive on its own. Nothing here initiates a change.
 * `recordMove` and `recordRename` only write down what a PERSON did a moment
 * ago, so the mirror's idea of where a file lives matches the page's; they
 * never touch Google, and there is no delete of any kind.
 */

/**
 * The lowest team role, which is every team role.
 *
 * Files is the agency's filing cabinet: an editor looking for last month's
 * raws and a scheduler looking for an approved graphic are both doing their
 * job. `roleSatisfies` refuses `client` against any team requirement, so this
 * is also the line that keeps a client portal login out — server side, in the
 * route, not by hiding a link.
 */
export const FILES_ROLE = 'scheduler' as const

export async function requireFilesAccess(): Promise<TeamUser> {
  return requireRole(FILES_ROLE)
}

export type FilesRoot = {
  id: string
  name: string
  /** the "Clients" folder inside it, when a person has pointed us at one */
  clientsFolderId: string | null
  /** false when nobody has chosen the HQ folder yet */
  picked: boolean
}

/**
 * Where the tree starts.
 *
 * The picked folder if a super admin has chosen one in Settings, and the
 * app-made root otherwise — the same order `rootFolderId()` uses, so the page
 * and the mirror can never be looking at two different cabinets.
 */
export async function filesRoot(): Promise<FilesRoot | null> {
  const picked = await pickedRoot()
  if (picked) {
    return {
      id: picked.id,
      name: picked.name || 'MD Media HQ',
      clientsFolderId: picked.clients_folder_id ?? null,
      picked: true,
    }
  }
  const fallback = await rootFolderId()
  if (!fallback) return null
  return { id: fallback, name: 'Clients', clientsFolderId: fallback, picked: false }
}

/* ── what the app knows about a Drive file ─────────────────────────────── */

export type MirrorFacts = {
  drive_file_id: string
  client_id: string | null
  client_name: string | null
  item_id: string | null
  item_title: string | null
  version_number: number | null
  /** is this the version the item is on right now? */
  version_is_current: boolean
  /** which copy this is: 'raw', 'final', 'scheduled', 'files' … */
  target: string | null
  uploaded_by: string | null
}

/**
 * The `drive_files` join, for a page of Drive ids.
 *
 * Drive knows a file's name and size; only we know it is version 2 of Pure
 * Allure's spring reel. A file with no row here is simply a file — the panel
 * says nothing rather than guessing, because most of what is in the owner's
 * Drive was put there by a person years before this app existed.
 *
 * One pass over each table, not one lookup per file: a 100-tile folder would
 * otherwise be three hundred reads.
 */
export async function mirrorFactsFor(
  driveFileIds: readonly string[],
): Promise<Map<string, MirrorFacts>> {
  const out = new Map<string, MirrorFacts>()
  const wanted = new Set(driveFileIds.filter(Boolean))
  if (wanted.size === 0) return out

  const rows = await table<DriveFile>('drive_files').list({
    where: r => !!r.drive_file_id && wanted.has(r.drive_file_id),
  })
  if (!rows.length) return out

  const itemIds = new Set(rows.map(r => r.item_id).filter((v): v is string => !!v))
  const clientIds = new Set(rows.map(r => r.client_id).filter((v): v is string => !!v))

  const items = itemIds.size
    ? await table<ContentItem>('content_items').list({ where: r => itemIds.has(r.id) })
    : []
  const itemById = new Map(items.map(i => [i.id, i]))
  for (const item of items) if (item.client_id) clientIds.add(item.client_id)

  const clients = clientIds.size
    ? await table<Client>('clients').list({ where: r => clientIds.has(r.id) })
    : []
  const clientById = new Map(clients.map(c => [c.id, c]))

  // the version a file belongs to is matched on the SOURCE url, which is the
  // only thing the two rows share — `drive_files` records where the bytes came
  // from, and an asset version records the same URL as one of its slides
  const versions = itemIds.size
    ? await table<AssetVersion>('asset_versions').list({ where: r => itemIds.has(r.item_id) })
    : []

  for (const row of rows) {
    const id = String(row.drive_file_id)
    const item = row.item_id ? itemById.get(row.item_id) ?? null : null
    const clientId = row.client_id ?? item?.client_id ?? null
    const version = versions.find(v =>
      v.item_id === item?.id && versionMentions(v, row.source_url)) ?? null
    const number = version ? Number(version.version_number ?? 0) || null : null
    out.set(id, {
      drive_file_id: id,
      client_id: clientId,
      client_name: clientId ? clientById.get(clientId)?.name ?? null : null,
      item_id: item?.id ?? null,
      item_title: item?.title ?? null,
      version_number: number,
      version_is_current: number !== null && number === Number(item?.current_version_number ?? -1),
      target: row.target ?? null,
      uploaded_by: row.uploaded_by ?? null,
    })
  }
  return out
}

/** Does this version carry that file? A version's `files` is JSON of a shape
 *  the type generator cannot see, so the URL is looked for as text — a miss
 *  costs a missing line on a panel, never a wrong one. */
function versionMentions(version: AssetVersion, sourceUrl: string | null): boolean {
  if (!sourceUrl) return false
  if (version.file_url === sourceUrl) return true
  try {
    return JSON.stringify(version.files ?? null).includes(sourceUrl)
  } catch {
    return false
  }
}

/* ── writing down what a person did ────────────────────────────────────── */

/** The `drive_files` target for a file a person put there through this page.
 *  Distinct from the mirror's targets on purpose: this copy answers to nobody
 *  else's rules, and the sweep must never think it owes it a source. */
export const PAGE_TARGET = 'files'

/** A source URL for a file that has no source: it came off a laptop. Unique
 *  per Drive file, so `drive_files`'s (source_url, target) key still holds,
 *  and deliberately not an http URL so `isMirrorableUrl` leaves it alone. */
export function pageSourceUrl(driveFileId: string): string {
  return `drive://${driveFileId}`
}

/**
 * Record a file a person uploaded here.
 *
 * Written AFTER Drive has the bytes and has given us an id, which is the
 * opposite order from the mirror. The mirror claims first because it retries;
 * this cannot be retried by anything but the person, and a row claimed for an
 * upload that then failed would be a file the page swears exists.
 */
export async function recordPageUpload(row: {
  driveFileId: string
  name: string
  parentId: string
  clientId: string | null
  bytes: number | null
  driveUrl: string
  by: string | null
}): Promise<void> {
  await table<DriveFile>('drive_files').upsert(
    {
      source_url: pageSourceUrl(row.driveFileId),
      target: PAGE_TARGET,
      drive_file_id: row.driveFileId,
      drive_url: row.driveUrl,
      client_id: row.clientId,
      item_id: null,
      bytes: row.bytes,
      name: row.name,
      parent_id: row.parentId,
      uploaded_by: row.by,
      created_at: new Date().toISOString(),
    } as unknown as Partial<DriveFile>,
    { onConflict: 'source_url' },
  )
}

/**
 * Note that a file we know about now lives somewhere else.
 *
 * Only ever called after a person confirmed a move and Drive agreed to it.
 * Every row pointing at that Drive file is updated, because the same file can
 * legitimately be several rows (the item's copy, the finals copy, the
 * scheduled copy) and leaving one behind is how the mirror and the page start
 * disagreeing.
 */
export async function recordMove(driveFileId: string, parentId: string): Promise<void> {
  const rows = await table<DriveFile>('drive_files')
    .list({ where: r => r.drive_file_id === driveFileId })
  const moved_at = new Date().toISOString()
  for (const row of rows) {
    await table<DriveFile>('drive_files')
      .update(row.id, { parent_id: parentId, moved_at } as unknown as Partial<DriveFile>)
  }
}

/** The same, for a rename. */
export async function recordRename(driveFileId: string, name: string): Promise<void> {
  const rows = await table<DriveFile>('drive_files')
    .list({ where: r => r.drive_file_id === driveFileId })
  for (const row of rows) {
    await table<DriveFile>('drive_files')
      .update(row.id, { name } as unknown as Partial<DriveFile>)
  }
}

/* ── in-flight uploads ─────────────────────────────────────────────────── */

export type OpenUpload = DriveUpload

/** Open a row for an upload that has just been given a session by Drive. */
export async function openUploadRow(row: {
  uri: string
  name: string
  parentId: string
  mimeType: string | null
  size: number | null
  clientId: string | null
  by: string | null
}): Promise<DriveUpload> {
  const now = new Date().toISOString()
  return table<DriveUpload>('drive_uploads').insert({
    upload_uri: row.uri,
    name: row.name,
    parent_id: row.parentId,
    mime_type: row.mimeType,
    size: row.size,
    received: 0,
    client_id: row.clientId,
    status: 'open',
    drive_file_id: null,
    created_by: row.by,
    created_at: now,
    updated_at: now,
  } as unknown as Omit<DriveUpload, 'id'>)
}

/** The row, but only while it is still open and still this person's. Anything
 *  else is "that upload is no longer going", which is the honest answer to a
 *  stale tab pushing chunks at a finished session. */
export async function liveUploadRow(id: string, by: string | null): Promise<DriveUpload | null> {
  const row = await table<DriveUpload>('drive_uploads').get(id)
  if (!row || row.status !== 'open') return null
  if (row.created_by && by && row.created_by !== by) return null
  return row
}

export async function noteUploadProgress(id: string, received: number): Promise<void> {
  await table<DriveUpload>('drive_uploads')
    .update(id, { received, updated_at: new Date().toISOString() } as Partial<DriveUpload>)
}

export async function closeUploadRow(
  id: string, status: 'done' | 'failed', driveFileId: string | null,
): Promise<void> {
  await table<DriveUpload>('drive_uploads').update(id, {
    status, drive_file_id: driveFileId, updated_at: new Date().toISOString(),
  } as Partial<DriveUpload>)
}

/**
 * Which client, if any, a folder belongs to.
 *
 * Read from `clients.drive_folder_id` — the column a person confirmed in
 * Settings — and never guessed from a folder's name. That is the whole point
 * of the adopt-by-name review: the match was decided once, by a human, and
 * everything downstream reads the decision rather than repeating the guess.
 */
export async function clientForFolder(folderId: string): Promise<string | null> {
  const rows = await table<Client>('clients').list({
    where: r => String(r.drive_folder_id ?? '') === folderId,
    limit: 1,
  })
  return rows[0]?.id ?? null
}
