import { driveFolderIdFromUrl, driveTargetOf } from './card-link-core'
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

/** the id a Drive link points at — a folder's, or a single file's (16 Sep 2026) */
export function readableDriveId(url: string | null | undefined): string | null {
  return driveTargetOf(url)?.id ?? null
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

export function parsePublicFolderView(html: string, now: Date = new Date()): PublicEntry[] {
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
    const shown = /flip-entry-last-modified"><div>([^<]*)<\/div>/.exec(block)?.[1]
    out.push({
      id, name, mimeType: mime, size: null, modified: null, ownerName: null, ownerEmail: null,
      // the date the page shows ("Oct 12", "10:23 AM") — kept as `created`, never `modified`, so a file's identity
      // (drive-scan-core.contentKey) does not change with it; the Editor's version stacks order by it
      created: shown ? publicDateOf(decodeHtml(shown).trim(), now) : null,
      hasThumbnail: thumb !== null,
      webViewLink: folder ? `https://drive.google.com/drive/folders/${id}` : `https://drive.google.com/file/d/${id}/view`,
      // Drive's own picture, at tile size, public — no proxy needed
      thumbUrl: thumb ? decodeHtml(thumb).replace(/=s\d+$/, `=s${TILE_SIZE}`) : null,
    })
  }
  return out
}

/**
 * THE DATE DRIVE'S PUBLIC FOLDER PAGE SHOWS, as an ISO time: "10:23 AM" is today, "Oct 12" this year (last year when
 * that would be ahead of today), "Oct 12, 2025" that year, "12/10/2025" day first. Anything else: null. A day only —
 * enough to put one cut before another (the owner, 21 Oct 2026: "how about knowing which videos are the latest").
 */
export function publicDateOf(text: string, now: Date): string | null {
  const t = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(text)
  if (t) {
    const h = (Number(t[1]) % 12) + (/p/i.test(t[3]) ? 12 : 0)
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, Number(t[2]))).toISOString()
  }
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const md = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2})(?:, (\d{4}))?$/.exec(text)
  if (md) {
    const m = MONTHS.indexOf(md[1].toLowerCase())
    if (m < 0) return null
    let y = md[3] ? Number(md[3]) : now.getUTCFullYear()
    if (!md[3] && Date.UTC(y, m, Number(md[2])) > now.getTime() + 86_400_000) y -= 1
    return new Date(Date.UTC(y, m, Number(md[2]))).toISOString()
  }
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(text)
  if (dmy) {
    const y = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3])
    return new Date(Date.UTC(y, Number(dmy[2]) - 1, Number(dmy[1]))).toISOString()
  }
  return null
}

function decodeHtml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

/** The words under an empty grid, when the folder could not be read either way. */
export function folderUnreadableWords(accountEmail: string | null): string {
  const who = accountEmail ? `share it with ${accountEmail}` : 'share it with the agency\u2019s Drive account'
  return `The files could not be read — ${who}, or set the folder to anyone with the link, and they show here.`
}

/**
 * THE FOLDERS INSIDE A HANDED-IN LINK (the owner, 19 Oct 2026, Ryan Patumaka's "Travel Vlogs x5": the card had
 * "extracted all the videos from the link including the one in sub folder and grabbed all the videos as one").
 * The pull keeps every file's place in the folder in its name — `SCHEDULED/Video Carousel/1.mov` — but the card
 * drew all 37 as one grid, so twelve clips of one carousel and eight of another could not be told apart. This
 * groups them back into the folders they came from, Drive's way round: a folder's own files, then its
 * subfolders, each holding theirs. A set with no folders in it comes back as one flat level, as before.
 */
export type TileFolder<T> = {
  /** the folder's own name; '' for the top */
  name: string
  /** its place from the top, `SCHEDULED/Video Carousel` */
  path: string
  /** the files directly in it, in the order they came */
  files: T[]
  folders: TileFolder<T>[]
  /** every file in it and below it */
  count: number
}

export function tileTree<T extends { name: string }>(tiles: readonly T[]): TileFolder<T> {
  const top: TileFolder<T> = { name: '', path: '', files: [], folders: [], count: 0 }
  for (const t of tiles) {
    const parts = String(t.name ?? '').split('/').filter(Boolean)
    let at = top
    at.count++
    for (const part of parts.slice(0, -1)) {
      let next = at.folders.find(f => f.name === part)
      if (!next) {
        next = { name: part, path: at.path ? `${at.path}/${part}` : part, files: [], folders: [], count: 0 }
        at.folders.push(next)
      }
      next.count++
      at = next
    }
    at.files.push(t)
  }
  // Drive's order: 1, 2 … 10, not 1, 10, 11, 2 (19 Oct 2026, Ryan's "Video Carousel" on live)
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  const sort = (f: TileFolder<T>) => {
    f.folders.sort((a, b) => byName(a.name, b.name))
    f.files.sort((a, b) => byName(baseName(a.name), baseName(b.name)))
    f.folders.forEach(sort)
  }
  sort(top)
  return top
}

/** A file's own name, without the folders it sits in. */
export function baseName(name: string): string {
  const parts = String(name ?? '').split('/').filter(Boolean)
  return parts[parts.length - 1] ?? String(name ?? '')
}

/**
 * The folders open when the set is first shown: a lone wrapping folder (the `SCHEDULED` that holds everything)
 * opens by itself, all the way down while each level holds nothing but one folder, so the first thing seen is
 * where the files start dividing. Below that, every folder starts closed, as Drive's do.
 */
export function startOpenFolders<T>(top: TileFolder<T>): Set<string> {
  const open = new Set<string>()
  let at = top
  while (at.files.length === 0 && at.folders.length === 1) {
    at = at.folders[0]
    open.add(at.path)
  }
  return open
}

/**
 * The same folders as flat SECTIONS, for the client's portal (19 Oct 2026, the owner: "im worried how this will
 * show on the portal" … "we need the folder names tho"). A client is not handed a tree to open and close: each
 * folder of the link becomes a heading — its whole name, `SCHEDULED / Video Carousel`, as the Drive reads — with
 * its files under it, depth first, in Drive's order. Files loose at the top of the link come first, with a
 * heading only once there are folders to tell them apart from.
 */
export function folderSections<T extends { name: string }>(
  tiles: readonly T[], looseTitle = 'In the main folder',
): { title: string | null; path: string; files: T[] }[] {
  const top = tileTree(tiles)
  const out: { title: string | null; path: string; files: T[] }[] = []
  if (top.files.length > 0) out.push({ title: top.folders.length > 0 ? looseTitle : null, path: '', files: top.files })
  const walk = (f: TileFolder<T>) => {
    if (f.files.length > 0) out.push({ title: f.path.split('/').join(' / '), path: f.path, files: f.files })
    f.folders.forEach(walk)
  }
  top.folders.forEach(walk)
  return out
}
