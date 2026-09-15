import { driveFolderIdFromUrl } from './card-link-core'
import { kindOf, type DriveEntry, type FileKind } from './files-core'

/**
 * THE FILES IN A CARD'S DRIVE FOLDER, AS TILES (the owner, 15 Sep 2026: "in
 * Editor, display files as their thumbnail and play it from there" — "not
 * files, the Drive link").
 *
 * An editor's card carries a folder link, not uploads. So the card reads the
 * folder (read only — trap 13 is about writes) and draws each file as a
 * picture: Drive's own thumbnail, proxied through /api/drive/thumbnail so no
 * signed URL reaches the page. Pressing a tile opens Drive's preview of the
 * file above the grid — Google's player, which plays a 2 GB .mov without
 * the browser downloading it — and Open in Drive is always there.
 *
 * Pure: the tiles are decided here, the fetching is the component's.
 */
export type FolderTile = {
  id: string
  name: string
  kind: FileKind
  /** same-origin picture of the file, or null when Drive has none */
  thumb: string | null
  /** Drive's own preview of the file — plays a clip, shows a still */
  preview: string
  /** the file in Drive, in a new tab */
  open: string
}

/** Drive's thumbnail size for a tile: enough for a 3-up grid on a retina screen. */
export const TILE_SIZE = 400

export function folderTilesOf(entries: readonly (DriveEntry & { thumbUrl?: string | null })[]): FolderTile[] {
  return entries
    .map(e => ({ e, kind: kindOf(e.mimeType, e.name) }))
    // subfolders are not files to work from; open the folder for those
    .filter(({ kind }) => kind !== 'folder')
    .map(({ e, kind }) => ({
      id: e.id,
      name: e.name,
      kind,
      thumb: e.thumbUrl ?? (e.hasThumbnail ? `/api/drive/thumbnail?id=${encodeURIComponent(e.id)}&size=${TILE_SIZE}` : null),
      preview: `https://drive.google.com/file/d/${encodeURIComponent(e.id)}/preview`,
      open: e.webViewLink ?? `https://drive.google.com/file/d/${encodeURIComponent(e.id)}/view`,
    }))
}

/** How many subfolders the listing skipped, for the one line under the grid. */
export function subfolderCount(entries: readonly DriveEntry[]): number {
  return entries.filter(e => kindOf(e.mimeType, e.name) === 'folder').length
}

/** The line under the heading, in plain words. */
export function folderFilesWords(files: number, folders: number): string {
  const f = files === 0 ? 'No files in the folder yet' : `${files} ${files === 1 ? 'file' : 'files'} in the folder`
  if (folders === 0) return f
  return `${f}, and ${folders} ${folders === 1 ? 'subfolder' : 'subfolders'} — open the folder for those`
}

/** Only a Google Drive FOLDER link can be read here; a Dropbox link, a file
 *  link or a Frame.io review cannot, and the card just offers to open it. */
export function readableFolderId(url: string | null | undefined): string | null {
  return driveFolderIdFromUrl(url)
}

/** What a pressed tile says while Drive's preview loads. */
export function tileActionWords(kind: FileKind): 'Play' | 'See' {
  return kind === 'video' || kind === 'audio' ? 'Play' : 'See'
}

/**
 * A FOLDER THE AGENCY ACCOUNT WAS NEVER SHARED ON (the owner, 15 Sep 2026: the
 * card said "No files in the folder yet" over a footage folder holding
 * sixteen clips). Drive's search only returns files the account was given
 * outright; a folder that is merely "anyone with the link" comes back empty.
 * Google's public folder view — the same page the folder link shows a
 * stranger — still lists it: an id, a name, a type and a thumbnail per
 * file. Read from that page, it is the same tiles. Parsed by regex, like
 * the Instagram embed page: a few strings out of a page we do not control.
 */
export const PUBLIC_FOLDER_VIEW = (folderId: string) =>
  `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`

export type PublicEntry = DriveEntry & { thumbUrl: string | null }

export function parsePublicFolderView(html: string): PublicEntry[] {
  const out: PublicEntry[] = []
  const entry = /<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g
  for (const m of html.matchAll(entry)) {
    const [block, id, rawName] = m
    const name = decodeHtml(rawName).trim()
    if (!id || !name) continue
    const folder = /aria-label="Folder"/.test(block) || /drive\.google\.com\/drive\/folders\//.test(block)
    // the list icon carries the mime: …googleusercontent.com/16/type/video/mp4
    const mime = folder
      ? 'application/vnd.google-apps.folder'
      : (/googleusercontent\.com\/\d+\/type\/([\w.+-]+\/[\w.+-]+)/.exec(block)?.[1] ?? '')
    const thumb = /<div class="flip-entry-thumb"><img src="(https:\/\/lh3\.googleusercontent\.com\/[^"]+)"/.exec(block)?.[1] ?? null
    out.push({
      id, name, mimeType: mime, size: null, modified: null, ownerName: null, ownerEmail: null,
      hasThumbnail: thumb !== null,
      webViewLink: folder ? `https://drive.google.com/drive/folders/${id}` : `https://drive.google.com/file/d/${id}/view`,
      // Drive's own picture, at tile size, public — no proxy needed
      thumbUrl: thumb ? decodeHtml(thumb).replace(/=s\d+$/, `=s${TILE_SIZE}`) : null,
    })
  }
  return out
}

function decodeHtml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

/** The words under an empty grid, when the folder could not be read either way. */
export function folderUnreadableWords(accountEmail: string | null): string {
  const who = accountEmail ? `share it with ${accountEmail}` : 'share it with the agency\u2019s Drive account'
  return `The files could not be read — ${who}, or set the folder to anyone with the link, and they show here.`
}
