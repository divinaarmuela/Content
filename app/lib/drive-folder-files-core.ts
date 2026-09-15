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

export function folderTilesOf(entries: readonly DriveEntry[]): FolderTile[] {
  return entries
    .map(e => ({ e, kind: kindOf(e.mimeType, e.name) }))
    // subfolders are not files to work from; open the folder for those
    .filter(({ kind }) => kind !== 'folder')
    .map(({ e, kind }) => ({
      id: e.id,
      name: e.name,
      kind,
      thumb: e.hasThumbnail ? `/api/drive/thumbnail?id=${encodeURIComponent(e.id)}&size=${TILE_SIZE}` : null,
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
