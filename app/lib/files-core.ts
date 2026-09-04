/**
 * The Files page's thinking, with no I/O in it.
 *
 * Everything here is a pure function over plain data: what kind of thing a
 * file is, how a list is sorted and filtered, what the breadcrumb reads, the
 * `q` string Drive is asked, and how far an upload has got. The routes and the
 * page are wrappers around this, which is the same split `workflow-core.ts`
 * and `gdrive-core.ts` already use — and the reason a search query that
 * quietly finds the wrong folder is a unit test failure rather than a
 * afternoon of clicking.
 */

/* ── ids ───────────────────────────────────────────────────────────────── */

/**
 * A Drive id, as Drive actually spells them: letters, digits, `-` and `_`.
 *
 * Checked on the way IN to every route. A Drive id is pasted straight into a
 * `q` string and into a URL path, so an id carrying an apostrophe or a slash
 * is the one input on this page that could reach somewhere it was not meant
 * to. Nothing here ever escapes an id, because nothing here ever accepts one
 * that would need escaping.
 */
const ID_RE = /^[A-Za-z0-9_-]{1,256}$/

export function isDriveId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value)
}

/**
 * An id of OUR OWN — a `drive_uploads` row key.
 *
 * Same shape, same reason, different owner. `encodePath` in `lib/db.ts` splits
 * a path on `/`, so an id carrying a slash reads a different node of the
 * database entirely. Every Drive id on this page is checked at the edge; a row
 * id that arrives in a query string deserves exactly the same.
 */
export function isRowId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value)
}

/**
 * A URI it is safe to send Google's bearer token to.
 *
 * A resumable session URI only ever comes from Drive's own `Location` header —
 * but it is then STORED, and the database has open read/write rules by the
 * owner's decision (CLAUDE.md trap 10). Nothing in code stopped a row's
 * `upload_uri` from pointing somewhere else, and the very next thing that row
 * does is put an access token in an Authorization header. One host check
 * closes that for free.
 */
export function isGoogleUploadUri(uri: unknown): uri is string {
  if (typeof uri !== 'string') return false
  try {
    const url = new URL(uri)
    if (url.protocol !== 'https:') return false
    return url.host === 'googleapis.com' || url.host.endsWith('.googleapis.com')
  } catch {
    return false
  }
}

/** The same rule for a thumbnail: Drive serves them from Google's own image
 *  hosts, and a link we did not recognise is not worth a token. */
export function isGoogleContentUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return ['googleapis.com', 'googleusercontent.com', 'google.com', 'gstatic.com']
      .some(host => parsed.host === host || parsed.host.endsWith(`.${host}`))
  } catch {
    return false
  }
}

/* ── what kind of thing is this ────────────────────────────────────────── */

export const FOLDER_MIME = 'application/vnd.google-apps.folder'

export type FileKind =
  | 'folder' | 'image' | 'video' | 'audio' | 'pdf' | 'doc' | 'sheet' | 'slides' | 'other'

/** What a person would call this kind of file, in one word. */
export const KIND_LABEL: Record<FileKind, string> = {
  folder: 'Folders',
  image: 'Photos',
  video: 'Videos',
  audio: 'Audio',
  pdf: 'PDFs',
  doc: 'Documents',
  sheet: 'Spreadsheets',
  slides: 'Slide decks',
  other: 'Everything else',
}

/** The Type filter's menu, in the order it is drawn. */
export const TYPE_FILTERS: { value: FileKind | 'all'; label: string }[] = [
  { value: 'all', label: 'Any type' },
  ...(['folder', 'image', 'video', 'audio', 'pdf', 'doc', 'sheet', 'slides', 'other'] as const)
    .map(k => ({ value: k, label: KIND_LABEL[k] })),
]

const EXT: Record<string, FileKind> = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', heic: 'image',
  svg: 'image', avif: 'image', tif: 'image', tiff: 'image',
  mp4: 'video', mov: 'video', m4v: 'video', webm: 'video', avi: 'video', mkv: 'video',
  mp3: 'audio', wav: 'audio', aac: 'audio', m4a: 'audio', flac: 'audio',
  pdf: 'pdf',
  doc: 'doc', docx: 'doc', txt: 'doc', rtf: 'doc', md: 'doc', pages: 'doc',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', numbers: 'sheet',
  ppt: 'slides', pptx: 'slides', key: 'slides',
}

/**
 * The kind of a file, from its mime type and — only when that gives nothing
 * away — from its name.
 *
 * Drive is honest about its own types and vague about everybody else's: a
 * ProRes master comes back as `application/octet-stream` often enough that a
 * mime-only rule files half the agency's video under "Everything else". The
 * extension is the fallback, never the first answer, because a name is
 * something a person typed.
 */
export function kindOf(mimeType: string | null | undefined, name?: string | null): FileKind {
  const mime = String(mimeType ?? '').toLowerCase()
  if (mime === FOLDER_MIME) return 'folder'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'application/vnd.google-apps.document') return 'doc'
  if (mime === 'application/vnd.google-apps.spreadsheet') return 'sheet'
  if (mime === 'application/vnd.google-apps.presentation') return 'slides'
  if (mime.startsWith('text/')) return 'doc'
  if (mime.includes('wordprocessingml') || mime === 'application/msword') return 'doc'
  if (mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel') return 'sheet'
  if (mime.includes('presentationml') || mime === 'application/vnd.ms-powerpoint') return 'slides'
  const ext = String(name ?? '').toLowerCase().split('.').pop() ?? ''
  return EXT[ext] ?? 'other'
}

/** The short badge drawn on a tile: `MP4`, `PDF`, `JPG`. */
export function extensionBadge(name: string | null | undefined, kind: FileKind): string {
  const ext = String(name ?? '').toLowerCase().split('.').pop() ?? ''
  if (ext && ext.length <= 5 && /^[a-z0-9]+$/.test(ext) && ext !== String(name).toLowerCase()) {
    return ext.toUpperCase()
  }
  return kind === 'other' ? 'FILE' : kind.toUpperCase()
}

/* ── one row of a listing ──────────────────────────────────────────────── */

export type DriveEntry = {
  id: string
  name: string
  mimeType: string
  /** bytes, or null for a Google Doc — Google's own formats have no size */
  size: number | null
  modified: string | null
  ownerName: string | null
  ownerEmail: string | null
  hasThumbnail: boolean
  webViewLink: string | null
}

export function isFolder(entry: { mimeType: string }): boolean {
  return entry.mimeType === FOLDER_MIME
}

/* ── sorting ───────────────────────────────────────────────────────────── */

export type SortBy = 'name' | 'modified' | 'size'
export type SortDir = 'asc' | 'desc'
export type Sort = { by: SortBy; dir: SortDir }

export const SORT_LABEL: Record<SortBy, string> = {
  name: 'Name',
  modified: 'Last changed',
  size: 'Size',
}

/**
 * Sort a listing. Stable, and blanks always sink.
 *
 * A folder has no size and a Google Doc has no size either; sorting them to
 * the top of "largest first" would put the empty things where the big things
 * belong. So a missing value sorts last in BOTH directions — it is not small,
 * it is unknown.
 */
export function sortEntries<T extends DriveEntry>(entries: readonly T[], sort: Sort): T[] {
  const dir = sort.dir === 'desc' ? -1 : 1
  const keyed = entries.map((entry, index) => ({ entry, index }))
  keyed.sort((a, b) => {
    const cmp = compare(a.entry, b.entry, sort.by)
    if (cmp === null) return a.index - b.index          // both blank: leave them be
    if (cmp === 'a-blank') return 1
    if (cmp === 'b-blank') return -1
    return cmp === 0 ? a.index - b.index : cmp * dir
  })
  return keyed.map(k => k.entry)
}

function compare(
  a: DriveEntry, b: DriveEntry, by: SortBy,
): number | null | 'a-blank' | 'b-blank' {
  if (by === 'name') {
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  }
  const av = by === 'size' ? a.size : a.modified
  const bv = by === 'size' ? b.size : b.modified
  const aBlank = av === null || av === undefined || av === ''
  const bBlank = bv === null || bv === undefined || bv === ''
  if (aBlank && bBlank) return null
  if (aBlank) return 'a-blank'
  if (bBlank) return 'b-blank'
  if (by === 'size') return Number(av) - Number(bv)
  return String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0
}

/* ── filtering ─────────────────────────────────────────────────────────── */

export type ModifiedWindow = 'any' | 'today' | 'week' | 'month' | 'year'

export const MODIFIED_FILTERS: { value: ModifiedWindow; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
  { value: 'year', label: 'This past year' },
]

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_DAYS: Record<Exclude<ModifiedWindow, 'any'>, number> = {
  today: 1, week: 7, month: 30, year: 365,
}

/** The earliest moment a file may have changed and still pass the filter. */
export function modifiedSince(window: ModifiedWindow, now: Date): string | null {
  if (window === 'any') return null
  return new Date(now.getTime() - WINDOW_DAYS[window] * DAY_MS).toISOString()
}

export type Filters = {
  type: FileKind | 'all'
  /** an owner's email, exactly as Drive spells it */
  person: string | null
  modified: ModifiedWindow
  /** a client id — only files the app itself mirrored can answer this */
  client: string | null
}

export const NO_FILTERS: Filters = { type: 'all', person: null, modified: 'any', client: null }

export function anyFilterOn(filters: Filters): boolean {
  return filters.type !== 'all' || !!filters.person || filters.modified !== 'any' || !!filters.client
}

/**
 * Apply the four filters to one listing.
 *
 * `clientOf` is the `drive_files` join: a Drive file id to the client whose
 * work it is. It answers for the files THIS APP put in Drive and for nothing
 * else, which is why choosing a client hides everything the app has never
 * touched rather than pretending it belongs to nobody.
 */
export function filterEntries<T extends DriveEntry>(
  entries: readonly T[],
  filters: Filters,
  clientOf: (driveFileId: string) => string | null,
  now: Date,
): T[] {
  const since = modifiedSince(filters.modified, now)
  const person = filters.person?.trim().toLowerCase() || null
  return entries.filter(entry => {
    if (filters.type !== 'all' && kindOf(entry.mimeType, entry.name) !== filters.type) return false
    if (person && String(entry.ownerEmail ?? '').toLowerCase() !== person) return false
    if (since && !(entry.modified && entry.modified >= since)) return false
    if (filters.client && clientOf(entry.id) !== filters.client) return false
    return true
  })
}

/* ── asking Drive ──────────────────────────────────────────────────────── */

/**
 * Escape a value going into a Drive `q` string.
 *
 * Copied in spirit from `gdrive-core.escapeQueryValue` and re-stated here so
 * this file stays import-free and testable on its own: backslash first, then
 * the apostrophe, or the escapes escape each other.
 */
export function escapeQuery(value: string): string {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

export type QueryOptions = {
  /** the folder being looked at; omitted by a search that spans the whole root */
  parentId?: string | null
  /** what the person typed */
  text?: string | null
  type?: FileKind | 'all'
  /** ISO instant from `modifiedSince` */
  since?: string | null
  ownerEmail?: string | null
  /** folders only — the left tree */
  foldersOnly?: boolean
}

const MIME_FOR: Partial<Record<FileKind, string>> = {
  folder: `mimeType = '${FOLDER_MIME}'`,
  image: "mimeType contains 'image/'",
  video: "mimeType contains 'video/'",
  audio: "mimeType contains 'audio/'",
  pdf: "mimeType = 'application/pdf'",
  doc: "(mimeType contains 'document' or mimeType contains 'text/' or mimeType contains 'word')",
  sheet: "(mimeType contains 'spreadsheet' or mimeType contains 'excel' or mimeType = 'text/csv')",
  slides: "(mimeType contains 'presentation' or mimeType contains 'powerpoint')",
}

/**
 * The `q` Drive is asked.
 *
 * `name contains` is Drive's own prefix-ish match and the only text search the
 * API offers on a folder listing — `fullText contains` would reach inside
 * documents, which is not what "search in this folder" means to anybody. A
 * search with no parent walks everything the app can see, which under the
 * `drive.file` scope is everything under the picked root and nothing else.
 */
export function driveQuery(opts: QueryOptions): string {
  const parts: string[] = ['trashed = false']
  if (opts.parentId) parts.push(`'${escapeQuery(opts.parentId)}' in parents`)
  const text = String(opts.text ?? '').trim()
  if (text) parts.push(`name contains '${escapeQuery(text)}'`)
  if (opts.foldersOnly) parts.push(`mimeType = '${FOLDER_MIME}'`)
  else if (opts.type && opts.type !== 'all') {
    const clause = MIME_FOR[opts.type]
    // 'other' has no mime of its own — it is whatever the named kinds are not,
    // so it cannot be asked for in a query and is filtered after the fact
    if (clause) parts.push(clause)
  }
  if (opts.since) parts.push(`modifiedTime > '${escapeQuery(opts.since)}'`)
  if (opts.ownerEmail) parts.push(`'${escapeQuery(opts.ownerEmail)}' in owners`)
  return parts.join(' and ')
}

/** Drive's `orderBy`. Folders lead in every case: a listing that mixes them
 *  is a listing nobody can scan. */
export function driveOrderBy(sort: Sort): string {
  const dir = sort.dir === 'desc' ? ' desc' : ''
  const field = sort.by === 'modified' ? 'modifiedTime' : sort.by === 'size' ? 'quotaBytesUsed' : 'name'
  return `folder,${field}${dir}`
}

/** One page of a listing. 100 is Drive's comfortable size and keeps us well
 *  inside the per-minute quota when somebody scrolls a big folder fast. */
export const PAGE_SIZE = 100

/* ── the breadcrumb ────────────────────────────────────────────────────── */

export type Crumb = { id: string; name: string }

/**
 * Which crumbs are drawn when the path is longer than the bar.
 *
 * The root and the current folder are never dropped — they are the two things
 * that say where you are. Everything squeezed out of the middle comes back in
 * the "…" menu, so no folder on the way down becomes unreachable.
 */
export function crumbTrail(
  path: readonly Crumb[], max = 4,
): { visible: Crumb[]; hidden: Crumb[] } {
  if (path.length <= max) return { visible: [...path], hidden: [] }
  const head = path.slice(0, 1)
  const tail = path.slice(path.length - (max - 1))
  return { visible: [...head, ...tail], hidden: path.slice(1, path.length - (max - 1)) }
}

/** Walking back up: the path truncated at the folder that was clicked. */
export function pathUpTo(path: readonly Crumb[], id: string): Crumb[] {
  const at = path.findIndex(c => c.id === id)
  return at === -1 ? [...path] : path.slice(0, at + 1)
}

/** Walking down: the same path with a folder appended, or truncated to it if
 *  it was already open (clicking a crumb's own child must not double it). */
export function pathInto(path: readonly Crumb[], folder: Crumb): Crumb[] {
  if (path.some(c => c.id === folder.id)) return pathUpTo(path, folder.id)
  return [...path, folder]
}

/* ── the tree's open folders ───────────────────────────────────────────── */

/** Toggle one folder open or shut, keeping the list short and unique. */
export function toggleOpen(open: readonly string[], id: string): string[] {
  return open.includes(id) ? open.filter(o => o !== id) : [...open, id]
}

/** Every folder on the path is open, so arriving by breadcrumb or by search
 *  leaves the tree showing where you are rather than collapsed. */
export function openForPath(open: readonly string[], path: readonly Crumb[]): string[] {
  const next = new Set(open)
  for (const crumb of path) next.add(crumb.id)
  return [...next]
}

/* ── moving ────────────────────────────────────────────────────────────── */

/**
 * May these things be dropped into that folder?
 *
 * Three answers, all of them plain: a folder cannot go inside itself, a folder
 * cannot go inside its own descendant (Drive would accept it and orphan the
 * branch), and a file already sitting there has nowhere to move to.
 */
export function moveRefusal(
  ids: readonly string[], targetId: string, ancestorsOf: (id: string) => readonly string[],
): string | null {
  if (!ids.length) return 'Nothing was picked up.'
  if (ids.includes(targetId)) return 'A folder cannot go inside itself.'
  for (const id of ids) {
    if (ancestorsOf(targetId).includes(id)) {
      return 'A folder cannot go inside one of its own folders.'
    }
  }
  return null
}

/** Shift/Ctrl selection, as every file manager does it. */
export function nextSelection(
  current: readonly string[], ids: readonly string[], clicked: string,
  mods: { shift?: boolean; ctrl?: boolean },
): string[] {
  if (mods.ctrl) {
    return current.includes(clicked) ? current.filter(c => c !== clicked) : [...current, clicked]
  }
  if (mods.shift && current.length) {
    const anchor = ids.indexOf(current[current.length - 1])
    const to = ids.indexOf(clicked)
    if (anchor !== -1 && to !== -1) {
      const [from, until] = anchor <= to ? [anchor, to] : [to, anchor]
      return ids.slice(from, until + 1)
    }
  }
  return [clicked]
}

/* ── uploading ─────────────────────────────────────────────────────────── */

/**
 * How much of a file goes up in one request.
 *
 * 4 MB, not the 8 MB the mirror uses. The mirror runs on the server and PUTs
 * straight at Google; a drag-and-drop upload goes through one of our own route
 * handlers first, and a serverless request body is capped at 4.5 MB. A chunk
 * over that limit fails at the platform, before any of our code runs, with an
 * error nobody could act on. It must also be a multiple of 256 KB — Drive
 * rejects a non-final chunk that is not.
 */
export const UPLOAD_CHUNK = 4 * 1024 * 1024

/** Drive's own granularity: every chunk but the last must be a multiple of
 *  this. It matters on a RESUMED offset, which is Drive's number and not
 *  ours — see `nextChunk`. */
export const RESUME_UNIT = 256 * 1024

/** Drive's own ceiling, restated so the browser can refuse early. */
export const MAX_UPLOAD_BYTES = 5 * 1024 ** 4

export type UploadStatus = 'waiting' | 'sending' | 'done' | 'failed'

export type UploadState = {
  name: string
  size: number
  /** bytes Drive has confirmed it holds */
  sent: number
  status: UploadStatus
  error?: string
}

export function startUpload(name: string, size: number): UploadState {
  return { name, size, sent: 0, status: 'waiting' }
}

/**
 * The next slice to send, or null when there is nothing left.
 *
 * A zero-byte file is a real thing people drop (an empty caption card, a
 * placeholder). It gets exactly one chunk of zero length, because "nothing
 * left to send" and "nothing to send at all" have to be different answers or
 * the file is never created.
 */
export function nextChunk(state: UploadState): { start: number; end: number } | null {
  if (state.status === 'done' || state.status === 'failed') return null
  if (state.size === 0) return state.sent === 0 ? { start: 0, end: 0 } : null
  if (state.sent >= state.size) return null
  const end = Math.min(state.sent + UPLOAD_CHUNK, state.size)
  if (end === state.size) return { start: state.sent, end }
  // Not the last slice, so Drive requires a multiple of 256 KB. `sent` is
  // DRIVE's count, not ours, and Drive does not promise to stop on a boundary
  // — so a resumed offset of, say, 3,000,001 bytes would make the next chunk
  // 4 MB long starting off-boundary, and Drive would reject it. Round the END
  // down to a boundary instead; the slice is smaller, and the file is right.
  const aligned = Math.floor(end / RESUME_UNIT) * RESUME_UNIT
  return { start: state.sent, end: aligned > state.sent ? aligned : end }
}

/**
 * Fold what the server said back into the state.
 *
 * `received` is Drive's own count, never ours. Believing our arithmetic over
 * Drive's Range header is how a resumable upload silently corrupts a file —
 * the same rule `uploadStreamToFolder` follows on the server, for the same
 * reason.
 */
export function applyChunk(
  state: UploadState, result: { received?: number; done?: boolean; error?: string },
): UploadState {
  if (result.error) return { ...state, status: 'failed', error: result.error }
  const sent = typeof result.received === 'number' && result.received >= 0
    ? Math.min(result.received, state.size)
    : state.sent
  if (result.done) return { ...state, sent: state.size, status: 'done' }
  return { ...state, sent, status: 'sending' }
}

/** 0–100, and never 100 until Drive has said the file is finished — a bar
 *  that sits full while something is still happening reads as stuck. */
export function uploadPercent(state: UploadState): number {
  if (state.status === 'done') return 100
  if (state.size === 0) return state.status === 'sending' ? 99 : 0
  return Math.min(99, Math.floor((state.sent / state.size) * 100))
}

/** What the person reads beside the bar. */
export function uploadWords(state: UploadState): string {
  if (state.status === 'failed') return state.error || 'It did not go up. Try again.'
  if (state.status === 'done') return 'Uploaded'
  if (state.status === 'waiting') return 'Waiting'
  return `${uploadPercent(state)}%`
}

/** Everything still in flight, for the "3 files going up" line. */
export function uploadSummary(states: readonly UploadState[]): string {
  const going = states.filter(s => s.status === 'waiting' || s.status === 'sending').length
  const failed = states.filter(s => s.status === 'failed').length
  if (going) return going === 1 ? 'Uploading 1 file' : `Uploading ${going} files`
  if (failed) return failed === 1 ? '1 file did not go up' : `${failed} files did not go up`
  return 'All uploaded'
}

/* ── words for the screen ──────────────────────────────────────────────── */

const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB']

/** A size a person reads, not a number of bytes. Folders have none. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(Number(bytes))) return '—'
  let n = Math.max(0, Number(bytes))
  if (n < 1024) return `${Math.round(n)} bytes`
  let unit = 0
  while (n >= 1024 && unit < UNITS.length - 1) { n /= 1024; unit++ }
  return `${n >= 10 || unit === 1 ? Math.round(n) : n.toFixed(1)} ${UNITS[unit]}`
}

/**
 * When something last changed, in the words the mockup uses: "Today 14:20",
 * then a date. Formatted from the ISO string in the viewer's own zone —
 * unlike a posting time, "when did this file change" is a fact about the
 * person looking at it.
 */
export function formatModified(iso: string | null | undefined, now: Date): string {
  const at = iso ? new Date(iso) : null
  if (!at || Number.isNaN(at.getTime())) return '—'
  const time = at.toTimeString().slice(0, 5)
  const sameDay = at.toDateString() === now.toDateString()
  if (sameDay) return `Today ${time}`
  const yesterday = new Date(now.getTime() - DAY_MS)
  if (at.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`
  const sameYear = at.getFullYear() === now.getFullYear()
  return at.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/**
 * What the page says about the parts of Drive it cannot see.
 *
 * The app holds the `drive.file` scope: it sees folders it made itself and
 * folders a person handed it through Google's chooser, and nothing else. So a
 * folder the team made in the browser this morning is genuinely invisible
 * here, and saying so plainly is the only honest thing to do — an empty
 * folder that is not empty is worse than a sentence.
 */
/**
 * The first thing the Files page says about itself.
 *
 * A page shaped exactly like Google Drive invites the assumption that it works
 * like Google Drive. It does not: the dashboard reads Drive and never writes
 * to it. Saying so once, plainly, at the top, costs a line and saves somebody
 * hunting for an Upload button that is not there and never was.
 */
export const READ_ONLY_PAGE_NOTE =
  'This is a view of Google Drive. Nothing here changes it — to add, rename, '
  + 'move or delete anything, open it in Google Drive.'

export const PARTIAL_VIEW_NOTE =
  'This shows the folders MD Media set up or was given. Anything made straight in ' +
  'Google Drive since then will not be here until someone hands it over in Settings.'

/* ── reading a request ─────────────────────────────────────────────────── */

export type ListRequest = {
  parentId: string | null
  text: string | null
  type: FileKind | 'all'
  modified: ModifiedWindow
  ownerEmail: string | null
  foldersOnly: boolean
  sort: Sort
  pageToken: string | null
}

const KINDS = new Set<string>([
  'folder', 'image', 'video', 'audio', 'pdf', 'doc', 'sheet', 'slides', 'other',
])
const WINDOWS = new Set<string>(['any', 'today', 'week', 'month', 'year'])

/**
 * Turn a listing request's query string into something the rest of this file
 * will accept, or say plainly what is wrong with it.
 *
 * Every id is checked here, once, at the edge — an id that is not an id never
 * reaches a `q` string or a URL path. A filter that is not one of ours is
 * dropped rather than refused: a stale bookmark from an older version of the
 * page should show the folder, not an error.
 */
export function parseListRequest(
  get: (key: string) => string | null,
): { ok: true; request: ListRequest } | { ok: false; error: string } {
  const parent = get('parent')
  if (parent && !isDriveId(parent)) return { ok: false, error: 'That folder could not be found' }
  const pageToken = get('page')
  if (pageToken && pageToken.length > 4096) {
    return { ok: false, error: 'That page of files could not be loaded' }
  }
  const type = get('type')
  const modified = get('modified')
  const by = get('sort')
  const dir = get('dir')
  return {
    ok: true,
    request: {
      parentId: parent || null,
      text: (get('q') ?? '').trim().slice(0, 200) || null,
      type: type && KINDS.has(type) ? (type as FileKind) : 'all',
      modified: modified && WINDOWS.has(modified) ? (modified as ModifiedWindow) : 'any',
      ownerEmail: (get('owner') ?? '').trim().slice(0, 200) || null,
      foldersOnly: get('folders') === '1',
      sort: {
        by: by === 'modified' || by === 'size' ? by : 'name',
        dir: dir === 'desc' ? 'desc' : 'asc',
      },
      pageToken: pageToken || null,
    },
  }
}

/**
 * The `confirm: true` every change to somebody's Drive has to carry.
 *
 * The owner's rule, made into a gate the server enforces: nothing is renamed
 * or moved except by an explicit act of a person. A drag that lands, a sync
 * that runs, a retry that fires — none of them can produce this flag, because
 * only the dialog that names the item out loud sets it. A request without it
 * is refused with the sentence a person needs to hear, not a 400.
 */
export function confirmRefusal(body: { confirm?: unknown }): string | null {
  return body?.confirm === true
    ? null
    : 'Nothing was changed — this needs to be confirmed first.'
}

/** The sentence a confirm dialog shows, naming the thing out loud. */
export function renameConfirmWords(from: string, to: string): string {
  return `Rename “${from}” to “${to}”?`
}

export function moveConfirmWords(names: readonly string[], folder: string): string {
  const what = names.length === 1
    ? `“${names[0]}”`
    : `${names.length} items`
  return `Move ${what} into “${folder}”?`
}

/* ── searching below a folder ──────────────────────────────────────────── */

/**
 * How far a search is allowed to walk, and how long it may take.
 *
 * Drive's `q` has no subtree operator at all — `'x' in parents` means the
 * DIRECT children of x and nothing else. So "search in here and below" has to
 * be a walk, and a walk of somebody's whole archive is not a thing to start
 * without a stop on it. Two hundred folders and five seconds is generous for
 * a client folder and short enough that a search from the top of HQ comes back
 * rather than hanging; when it runs out, the page SAYS it ran out instead of
 * quietly showing a subset.
 */
export const SEARCH_FOLDER_CAP = 200
export const SEARCH_MS = 5_000
/** And how many matches come back. A search is a way of finding one file, not
 *  a way of listing ten thousand; past this the page could not draw them and
 *  the person needs a narrower folder, which `searchWords` tells them. */
export const SEARCH_MATCH_CAP = 500
/** How many parents fit in one `q` before it gets silly. Drive has no
 *  documented limit on the clause count; the URL length is the real one. */
export const SEARCH_PARENT_BATCH = 40

/** `('a' in parents or 'b' in parents)` — the one thing Drive gives us that
 *  makes a subtree search fewer than one request per folder. */
export function parentsClause(ids: readonly string[]): string {
  const parts = ids.map(id => `'${escapeQuery(id)}' in parents`)
  return parts.length === 1 ? parts[0] : `(${parts.join(' or ')})`
}

/** The `q` for one batch of the walk: the usual filters, plus "in any of
 *  these folders". */
export function searchBatchQuery(opts: QueryOptions, parentIds: readonly string[]): string {
  const base = driveQuery({ ...opts, parentId: null })
  return `${base} and ${parentsClause(parentIds)}`
}

/**
 * What the person is told about a search, including when it gave up.
 *
 * A capped search that says nothing is the worst of the three outcomes: the
 * person concludes the file is gone and uploads it again, into the owner's
 * real archive. So the sentence always says how far it looked.
 */
export function searchWords(
  found: number, text: string, foldersSearched: number, capped: boolean,
): string {
  const what = found === 0
    ? `Nothing called “${text}” in here or below it`
    : `${found} thing${found === 1 ? '' : 's'} called “${text}”`
  const where = foldersSearched === 1 ? 'this folder' : `${foldersSearched} folders`
  return capped
    ? `${what}. Searched ${where} — there is more below than we could look through, so try searching inside a smaller folder.`
    : `${what}. Searched ${where}.`
}

/* ── what happened to a move ───────────────────────────────────────────── */

/**
 * A move that half worked has to say WHICH half.
 *
 * The route already answers per item; the dialog used to read only the HTTP
 * status, so eight files dragged onto a folder with three refused on
 * permissions closed cleanly and looked like eight. Nothing about that is
 * recoverable by a person who was not told.
 */
export function moveOutcomeWords(
  moved: readonly string[],
  failed: readonly { name?: string | null; error?: string }[],
): { ok: boolean; words: string | null } {
  if (!failed.length) return { ok: true, words: null }
  const names = failed.map(f => `“${f.name || 'one file'}”`)
  const list = names.length <= 3
    ? names.join(', ')
    : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
  const kept = moved.length
    ? `${moved.length} moved. `
    : 'Nothing moved. '
  return {
    ok: false,
    words: `${kept}Google Drive would not move ${list}. They are still where they were.`,
  }
}
