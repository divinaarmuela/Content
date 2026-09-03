import 'server-only'
import { table } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import {
  ALL_DRIVES, ALL_DRIVES_LIST, FILES, accessToken, driveFetch, driveConfigured,
} from './gdrive'
import { putObject, r2Configured } from './storage'
import { slideTypeFromUrl, type Slide } from './version-files-core'

/**
 * THE COMPOSER'S GOOGLE DRIVE TAB.
 *
 * MD Media works out of Drive: the shoot lands there, the editor's cut is
 * mirrored there, and the thing somebody wants in a post at four o'clock on a
 * Friday is very often a file in the client's folder that never went through
 * the version flow. Later has Dropbox for this; we have Drive.
 *
 * Two jobs, and the second is the one with teeth:
 *
 *  LIST — the pictures and video in the item's own Drive folder (and one
 *  level down, which is where `Raw` and `Final` live), read-only.
 *
 *  BRING ACROSS — a chosen file is copied into R2, because that is the only
 *  place the publisher can relay bytes FROM. A Drive link is not a URL a
 *  social network can fetch; handing one to the provider would fail at post
 *  time, hours later, with nobody watching.
 *
 * What it deliberately does NOT do is make the file postable. The bytes land
 * in R2 and the caller saves them as a NEW VERSION that goes back to the
 * client — see `addMediaVersion`. Drive is a place files come from, never a
 * way round the client's approval.
 */

/** One row in the Drive tab. */
export type DriveMedia = {
  id: string
  name: string
  mimeType: string
  bytes: number | null
  type: 'image' | 'video'
}

export type DriveListing =
  | { ok: true; files: DriveMedia[]; folderId: string }
  /** every refusal is a sentence to show, never a reason code */
  | { ok: false; message: string }

/**
 * The bytes we will pull through a serverless function in one go.
 *
 * `putObject` takes a Buffer, so the whole file is in memory for as long as
 * the copy takes. A 4K master is not going to survive that and would fail
 * with a heap error nobody can act on — so it is refused up front, in words,
 * with the path that does work (the item page's upload, which streams).
 */
export const DRIVE_IMPORT_LIMIT_BYTES = 100 * 1024 * 1024

const MEDIA_QUERY = "(mimeType contains 'image/' or mimeType contains 'video/')"

/** The item's folder, as it is recorded — never created here. A read-only
 *  tab must not make folders in somebody's Drive as a side effect of being
 *  looked at. */
async function folderOf(itemId: string): Promise<string | null> {
  const row = await table<ContentItem>('content_items').get(itemId)
  const id = (row as unknown as { drive_folder_id?: string | null } | null)?.drive_folder_id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

/** The item folder plus its immediate subfolders — `Raw`, `Final`, whatever
 *  the shoot made. One level: deeper is a file browser, and this is a picker. */
async function foldersToSearch(token: string, root: string): Promise<string[]> {
  const url = `${FILES}?` + new URLSearchParams({
    q: `'${root}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id)',
    pageSize: '20',
    ...ALL_DRIVES_LIST,
  })
  const res = await driveFetch<{ files?: { id?: string }[] }>(token, url)
  const children = res.ok
    ? (res.data.files ?? []).map(f => f.id).filter((i): i is string => Boolean(i))
    : []
  return [root, ...children]
}

/** The pictures and video a person could put in a post, newest first. */
export async function listDriveMedia(itemId: string): Promise<DriveListing> {
  if (!driveConfigured()) {
    return { ok: false, message: 'Google Drive is not set up for this workspace yet.' }
  }
  const folderId = await folderOf(itemId)
  if (!folderId) {
    return {
      ok: false,
      message: 'This piece does not have a Drive folder yet. Upload the file instead.',
    }
  }
  const auth = await accessToken()
  if (!auth.ok) {
    return { ok: false, message: 'Google Drive needs reconnecting — ask an admin to sign it in again.' }
  }

  const parents = await foldersToSearch(auth.token, folderId)
  const q = `(${parents.map(p => `'${p}' in parents`).join(' or ')}) and ${MEDIA_QUERY} and trashed = false`
  const url = `${FILES}?` + new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,size,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: '100',
    ...ALL_DRIVES_LIST,
  })
  const res = await driveFetch<{
    files?: { id?: string; name?: string; mimeType?: string; size?: string }[]
  }>(auth.token, url)
  if (!res.ok) {
    return { ok: false, message: 'Could not read the Drive folder just now. Try again in a moment.' }
  }

  const files: DriveMedia[] = (res.data.files ?? [])
    .filter(f => f.id && f.name)
    .map(f => ({
      id: String(f.id),
      name: String(f.name),
      mimeType: String(f.mimeType ?? ''),
      bytes: Number.isFinite(Number(f.size)) ? Number(f.size) : null,
      type: String(f.mimeType ?? '').startsWith('video/') ? 'video' as const : 'image' as const,
    }))
  return { ok: true, files, folderId }
}

export type DriveImport =
  | { ok: true; slide: Slide }
  | { ok: false; message: string }

/**
 * Copy one Drive file into R2 and describe it as a slide.
 *
 * `alt=media` on the file endpoint is the download; everything else about
 * this is size discipline. The caller decides what to do with the slide —
 * which, on every path today, is "save it as a new version and send the piece
 * back to the client".
 */
export async function importDriveFile(fileId: string): Promise<DriveImport> {
  if (!r2Configured()) {
    return { ok: false, message: 'File storage is not set up, so files cannot be brought across.' }
  }
  const auth = await accessToken()
  if (!auth.ok) {
    return { ok: false, message: 'Google Drive needs reconnecting — ask an admin to sign it in again.' }
  }

  const metaUrl = `${FILES}/${encodeURIComponent(fileId)}?` + new URLSearchParams({
    fields: 'id,name,mimeType,size', ...ALL_DRIVES,
  })
  const meta = await driveFetch<{ name?: string; mimeType?: string; size?: string }>(
    auth.token, metaUrl)
  if (!meta.ok) return { ok: false, message: 'That file is no longer in Drive.' }

  const name = String(meta.data.name ?? 'file')
  const mime = String(meta.data.mimeType ?? 'application/octet-stream')
  const declared = Number(meta.data.size)
  if (Number.isFinite(declared) && declared > DRIVE_IMPORT_LIMIT_BYTES) {
    return {
      ok: false,
      message: `${name} is too big to bring across here. Add it on the piece's page instead.`,
    }
  }

  const dl = await fetch(
    `${FILES}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${auth.token}` } },
  )
  if (!dl.ok) return { ok: false, message: `Could not download ${name} from Drive.` }

  const bytes = Buffer.from(await dl.arrayBuffer())
  // the declared size can be missing on a Drive file; the real one never is
  if (bytes.byteLength > DRIVE_IMPORT_LIMIT_BYTES) {
    return {
      ok: false,
      message: `${name} is too big to bring across here. Add it on the piece's page instead.`,
    }
  }

  const stored = await putObject(name, bytes, mime)
  return {
    ok: true,
    slide: {
      url: stored.publicUrl,
      name,
      type: mime.startsWith('video/') ? 'video' : slideTypeFromUrl(stored.publicUrl),
      bytes: bytes.byteLength,
    },
  }
}
