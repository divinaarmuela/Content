import { isDriveId, kindOf, type DriveEntry } from './files-core'
import { isPlayableFile } from './link-preview-core'
import { driveFileIdFromUrl, driveFolderIdFromUrl } from './card-link-core'

/**
 * A DRIVE FILE ON A POST CARD — the pure half (the owner, 22 Sep 2026: "on
 * the board page … the post toolbar, and then I will choose one of the
 * Instagram options. I should be able to add the Drive file and it will
 * read [it and] put it on the post I chose").
 *
 * The board's post card (a `mockup` in batch-brief-core) used to take its
 * picture two ways: a file uploaded into our own storage, or a real post's
 * link. This is the third: a file that stays exactly where it is in Google
 * Drive. The card remembers the file — its id, its name, whether it is a
 * picture or a clip — and draws it through the dashboard's two READ proxies
 * (`/api/drive/thumbnail` for the picture, `/api/drive/stream` for the
 * clip's bytes), the same routes the Files page and the clip review page
 * already use. Nothing is copied, uploaded, moved or renamed: trap 13 —
 * THE DASHBOARD ONLY READS GOOGLE DRIVE — and this module adds a reader,
 * never a writer.
 *
 * No I/O here. The component fetches; this decides what a file on a card
 * is, which entries a person may pick, what a card looks like once the file
 * is on it, and who may pick at all.
 */

/** what a post card keeps about a Drive file it shows — enough to draw it
 *  and to say its name, never a signed URL (those expire and carry a token) */
export type CanvasDriveFile = {
  id: string
  name: string
  kind: 'image' | 'video'
  /** Drive's mime, when known — a `<video>` is told what it is playing */
  mime?: string
  /** Google's resource key (files-core DriveEntry.resourceKey): a link-shared file is fetched by id only with it */
  key?: string
}

/** a carousel's slides are ten at most, the same cap as its uploaded slides */
export const CANVAS_DRIVE_FILES_MAX = 10
const NAME_MAX = 200
const MIME_MAX = 80

/**
 * The Drive files out of an untrusted record. An id that is not a Drive id
 * is dropped — it would end up in a query string to our proxy, and the proxy
 * refuses it anyway, but a card should never hold one. A kind that is not a
 * picture or a clip is dropped — nothing else can be drawn in a post frame.
 * Dedupe by id, keep-first, bounded.
 */
export function sanitiseDriveFiles(raw: unknown): CanvasDriveFile[] {
  if (!Array.isArray(raw)) return []
  const out: CanvasDriveFile[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const id = String(r.id ?? '')
    if (!isDriveId(id) || seen.has(id)) continue
    const kind = String(r.kind ?? '')
    if (kind !== 'image' && kind !== 'video') continue
    const name = String(r.name ?? '').trim().slice(0, NAME_MAX)
    if (!name) continue
    seen.add(id)
    const mime = typeof r.mime === 'string' ? r.mime.trim().slice(0, MIME_MAX) : ''
    const key = typeof r.key === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(r.key) ? r.key : ''
    out.push({ id, name, kind, ...(mime ? { mime } : {}), ...(key ? { key } : {}) })
    if (out.length >= CANVAS_DRIVE_FILES_MAX) break
  }
  return out
}

/** A listing row as the card would keep it — null for anything that is not
 *  a picture or a clip (a folder is walked into, not picked; a PDF has no
 *  place in a post frame). */
export function driveFileFromEntry(e: Pick<DriveEntry, 'id' | 'name' | 'mimeType'> & { resourceKey?: string | null }): CanvasDriveFile | null {
  if (!isDriveId(e.id)) return null
  const kind = kindOf(e.mimeType, e.name)
  if (kind !== 'image' && kind !== 'video') return null
  const name = String(e.name ?? '').trim().slice(0, NAME_MAX)
  if (!name) return null
  const mime = String(e.mimeType ?? '').trim().slice(0, MIME_MAX)
  const key = typeof e.resourceKey === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(e.resourceKey) ? e.resourceKey : ''
  return { id: e.id, name, kind, ...(mime ? { mime } : {}), ...(key ? { key } : {}) }
}

/** What the picker shows of a folder: its subfolders (to walk into) and its
 *  pictures and clips (to pick). Everything else is left out, so a folder
 *  of forty PDFs and two photos shows the two photos. */
export function isPickableEntry(e: Pick<DriveEntry, 'id' | 'name' | 'mimeType'>): boolean {
  const kind = kindOf(e.mimeType, e.name)
  return kind === 'folder' || kind === 'image' || kind === 'video'
}

/** Drive's picture of the file, through our proxy (same origin, no token in
 *  the page). 800px: a post frame is 280px wide, so this is sharp on a
 *  retina screen without asking Drive for a poster-sized render. */
export const DRIVE_PICTURE_SIZE = 800
export function driveThumbnailUrl(id: string, size: number = DRIVE_PICTURE_SIZE, key?: string | null): string {
  return `/api/drive/thumbnail?id=${encodeURIComponent(id)}&size=${size}${key ? `&key=${encodeURIComponent(key)}` : ''}`
}

/** The clip's bytes, through our proxy — the same address the clip review
 *  page plays, with the name so a `application/octet-stream` answer from a
 *  link-shared file is still known to be an .mp4. */
export function driveStreamUrl(file: Pick<CanvasDriveFile, 'id' | 'name' | 'key'>): string {
  return `/api/drive/stream?id=${encodeURIComponent(file.id)}&name=${encodeURIComponent(file.name)}${file.key ? `&key=${encodeURIComponent(file.key)}` : ''}`
}

/** One thing a post frame draws: a picture, and for a clip the address
 *  that plays it. `picture` is null only for a Drive clip Drive has no
 *  still of — the frame then shows the play badge on black. */
export type PostMedia = {
  key: string
  picture: string | null
  video: string | null
  /** the file's name, for a Drive file — an upload has no name on a post */
  name: string | null
  from: 'upload' | 'drive'
}

type PostCardLike = {
  platform?: string
  url?: string
  urls?: string[]
  drive_files?: CanvasDriveFile[]
}

/**
 * Everything the frame has to show, in order. A carousel is its uploaded
 * slides then its Drive files (each a slide); any other post is one thing —
 * its Drive file when it has one, else its upload. A Drive file on a
 * single-media post replaces the upload rather than sitting beside it,
 * because the post has one picture and the person just chose it.
 */
export function postMediaOf(card: PostCardLike): PostMedia[] {
  const drive = (card.drive_files ?? []).map(f => ({
    key: `drive:${f.id}`,
    picture: driveThumbnailUrl(f.id, undefined, f.key),
    video: f.kind === 'video' ? driveStreamUrl(f) : null,
    name: f.name,
    from: 'drive' as const,
  }))
  const uploads = (card.urls?.length ? card.urls : card.url ? [card.url] : []).map(u => ({
    key: `upload:${u}`,
    picture: isPlayableFile(u) ? null : u,
    video: isPlayableFile(u) ? u : null,
    name: null,
    from: 'upload' as const,
  }))
  if (card.platform === 'ig_carousel') return [...uploads, ...drive].slice(0, CANVAS_DRIVE_FILES_MAX)
  return drive.length ? [drive[0]] : uploads.slice(0, 1)
}

/**
 * The card with Drive files put on it. A single-media post takes the first
 * pick and lets go of its upload — "put it on the post I chose" is a
 * replacement, not an addition. A carousel appends every pick as a slide,
 * skipping a file already on it, ten slides at most. The card's id, place,
 * frame, caption and link are untouched.
 */
export function withDriveFiles<T extends PostCardLike>(card: T, picks: readonly CanvasDriveFile[]): T {
  const clean = sanitiseDriveFiles(picks)
  if (clean.length === 0) return card
  if (card.platform === 'ig_carousel') {
    const have = new Set((card.drive_files ?? []).map(f => f.id))
    const merged = [...(card.drive_files ?? []), ...clean.filter(f => !have.has(f.id))].slice(0, CANVAS_DRIVE_FILES_MAX)
    return { ...card, drive_files: merged }
  }
  const { url: _url, urls: _urls, ...rest } = card
  void _url; void _urls
  return { ...rest, drive_files: [clean[0]] } as T
}

/** The card without one Drive file (or without all of them, when no id is
 *  given). The frame goes back to empty — the file itself is exactly where
 *  it was in Drive, because it never left. */
export function withoutDriveFile<T extends PostCardLike>(card: T, id?: string): T {
  const left = id ? (card.drive_files ?? []).filter(f => f.id !== id) : []
  const { drive_files: _old, ...rest } = card
  void _old
  return (left.length ? { ...rest, drive_files: left } : rest) as T
}

/**
 * Who may put a Drive file on a card: whoever may work on the board, which
 * is every team role and never a client. This is the same line the Drive
 * read routes hold (`FILES_ROLE` in drive-page.ts is the lowest team role,
 * and `roleSatisfies` refuses `client` against it), so a button drawn here
 * is never a button the route would refuse.
 */
export function mayPickDriveFile(viewer: { role: string } | null | undefined): boolean {
  return !!viewer && viewer.role !== 'client'
}

/** The words on the post card's toolbar button. */
export function driveButtonWords(card: PostCardLike): string {
  if (card.platform === 'ig_carousel') return 'Add Drive files'
  return card.drive_files?.length ? 'Swap Drive file' : 'Add a Drive file'
}

/**
 * A DRIVE LINK PASTED INTO THE POST'S LINK BOX (the owner, 22 Sep 2026, from
 * the first walk: the Drive link went into the box meant for a post's link,
 * and the card showed a globe). A link to one Drive file is the file: its id
 * is read out of the link, the file's name and kind are asked of the read
 * proxy, and it goes on the post exactly as a pick would. A folder link is
 * not a file — the picker opens on it instead.
 */
export function driveFileIdFromLink(url: string | null | undefined): string | null {
  const id = driveFileIdFromUrl(url)
  return id && isDriveId(id) ? id : null
}
/** the `resourcekey=` a Drive link carries for a link-shared file, when it does */
export function driveResourceKeyFromLink(url: string | null | undefined): string | null {
  try { const k = new URL(String(url ?? '')).searchParams.get('resourcekey'); return k && /^[A-Za-z0-9_-]{1,128}$/.test(k) ? k : null } catch { return null }
}
export function driveFolderIdFromLink(url: string | null | undefined): string | null {
  const id = driveFolderIdFromUrl(url)
  return id && isDriveId(id) ? id : null
}

/** The line that names what is on the card, for the toolbar and the tooltip. */
export function driveFilesWords(files: readonly CanvasDriveFile[] | undefined): string | null {
  if (!files?.length) return null
  if (files.length === 1) return `From Drive: ${files[0].name}`
  return `${files.length} files from Drive`
}
