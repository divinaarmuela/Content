import 'server-only'
import {
  ALL_DRIVES, ALL_DRIVES_LIST, FILES, UPLOAD_FILES, accessToken, createSubfolder,
  driveFetch, findSubfolder,
  type DriveFailure, type DriveResult,
} from './gdrive'
import { safeSegment } from './gdrive-core'
import { CHUNK_SIZE, contentRange, receivedBytes } from './gdrive-mirror-core'
import {
  FOLDER_MIME as FILES_FOLDER_MIME, PAGE_SIZE, SEARCH_FOLDER_CAP, SEARCH_MS,
  SEARCH_PARENT_BATCH, driveOrderBy, driveQuery, isDriveId, isGoogleContentUrl,
  isGoogleUploadUri, searchBatchQuery,
  type DriveEntry, type QueryOptions, type Sort,
} from './files-core'

/**
 * Files in Drive — uploading, copying, moving, and who may see them.
 *
 * gdrive.ts makes folders. This makes the things that go IN them, which is a
 * different problem: a folder is one small JSON POST, and a master cut is two
 * gigabytes that must cross from Cloudflare R2 into Drive without ever being
 * held whole in a serverless function's memory.
 *
 * Hence resumable upload for every single file, not just the large ones. A
 * multipart POST would be one round trip for a 40 KB caption card — but it
 * would also mean two upload paths, a size threshold, and a rule about which
 * to use that would be wrong the first time somebody dropped in a 300 MB
 * ProRes. One path that streams is simpler than two paths and a threshold.
 */

/** Bytes an upload may be. Drive's own ceiling, quoted from the guide, and
 *  far past anything this app will ever see. */
export const MAX_UPLOAD_BYTES = 5 * 1024 ** 4

const asError = (message: string, detail?: string): DriveResult<never> =>
  ({ ok: false, reason: 'api_error', message, detail: detail?.slice(0, 400) })

// ── streaming a file in ───────────────────────────────────────────────────

/**
 * Start a resumable session and hand back the URI to PUT chunks at.
 *
 * `X-Upload-Content-Length` is what lets Drive reserve and validate; it is
 * omitted when the source would not tell us a length, which Drive accepts —
 * the chunks then carry a `*` total until the last one, which knows it.
 */
async function beginResumable(
  token: string,
  meta: { name: string; parents: string[]; mimeType?: string },
  size: number | null,
): Promise<DriveResult<{ uri: string }>> {
  const url = `${UPLOAD_FILES}?` + new URLSearchParams({
    uploadType: 'resumable', fields: 'id', ...ALL_DRIVES,
  })
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      ...(meta.mimeType ? { 'X-Upload-Content-Type': meta.mimeType } : {}),
      ...(size != null ? { 'X-Upload-Content-Length': String(size) } : {}),
    },
    body: JSON.stringify({ name: meta.name, parents: meta.parents }),
  })
  if (!res.ok) {
    return asError(`Google Drive ${res.status} starting the upload`, await res.text())
  }
  // the session URI arrives in a header, never in the body
  const uri = res.headers.get('location') ?? res.headers.get('Location')
  if (!uri) return asError('Google Drive started an upload with no session URI')
  return { ok: true, uri }
}

type DriveFileMeta = { id?: string; name?: string; size?: string; webViewLink?: string }

/** PUT one chunk, tolerating the 308 that means "keep going". */
async function putChunk(
  token: string, uri: string, body: Uint8Array, range: string,
): Promise<{ status: number; range: string | null; file: DriveFileMeta | null; text: string }> {
  const res = await fetch(uri, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Range': range,
      // BodyInit wants a plain ArrayBuffer view; the length header is set for
      // us from it, and setting it by hand is refused by undici
    },
    body: body as unknown as BodyInit,
  })
  if (res.status === 308) {
    return { status: 308, range: res.headers.get('range'), file: null, text: '' }
  }
  const text = await res.text()
  let file: DriveFileMeta | null = null
  try { file = JSON.parse(text) as DriveFileMeta } catch { /* not JSON — the text is the error */ }
  return { status: res.status, range: null, file, text }
}

/** Join the parts we have buffered into exactly `n` bytes, leaving the rest. */
function take(parts: Uint8Array[], n: number): Uint8Array {
  const out = new Uint8Array(n)
  let filled = 0
  while (filled < n) {
    const head = parts[0]
    const need = n - filled
    if (head.length <= need) {
      out.set(head, filled)
      filled += head.length
      parts.shift()
    } else {
      out.set(head.subarray(0, need), filled)
      parts[0] = head.subarray(need)
      filled = n
    }
  }
  return out
}

export type UploadedFile = { id: string; bytes: number }

/**
 * Copy the bytes at `sourceUrl` into a Drive folder, streaming.
 *
 * The source is read once, as a stream, and forwarded in 8 MB chunks. At no
 * point does more than one chunk exist in memory, which is the difference
 * between mirroring a shoot day and running a function out of heap on the
 * first 4K master.
 *
 * A 308 carrying a `Range` header is Drive telling us it kept less than we
 * sent (a truncated request, a retried proxy). We believe Drive over our own
 * accounting and re-send from where it says it is — which is exactly the case
 * resumable upload exists for, and the reason a dropped connection mid-file
 * costs a chunk rather than the whole transfer.
 */
export async function uploadStreamToFolder(opts: {
  sourceUrl: string
  name: string
  parentId: string
}): Promise<DriveResult<UploadedFile>> {
  const auth = await accessToken()
  if (!auth.ok) return auth

  const src = await fetch(opts.sourceUrl)
  if (!src.ok || !src.body) {
    return asError(
      `Could not read the file to mirror (${src.status})`,
      `${opts.sourceUrl.slice(0, 200)}`,
    )
  }
  const header = src.headers.get('content-length')
  const size = header && /^\d+$/.test(header) ? Number(header) : null
  if (size != null && size > MAX_UPLOAD_BYTES) {
    return asError(`That file is larger than Drive accepts (${size} bytes)`)
  }
  const mimeType = src.headers.get('content-type')?.split(';')[0]?.trim() || undefined

  const begun = await beginResumable(auth.token, {
    name: opts.name, parents: [opts.parentId], mimeType,
  }, size)
  if (!begun.ok) {
    // the source stream is ours to close; leaving it open leaks a socket per
    // failed mirror, and mirrors fail in batches when they fail at all
    await src.body.cancel().catch(() => {})
    return begun
  }

  const reader = src.body.getReader()
  const parts: Uint8Array[] = []
  let buffered = 0
  let sent = 0
  let done = false
  let finished: DriveFileMeta | null = null

  try {
    while (!done) {
      const read = await reader.read()
      if (read.done) done = true
      else {
        parts.push(read.value)
        buffered += read.value.length
      }

      // full chunks while we have them; the tail waits for the end, because
      // only the final chunk may be a non-multiple of 256 KB
      while (buffered >= CHUNK_SIZE || (done && buffered > 0)) {
        const n = Math.min(CHUNK_SIZE, buffered)
        const isLast = done && n === buffered
        const chunk = take(parts, n)
        buffered -= n
        const total = isLast ? sent + n : (size ?? null)
        const range = total != null
          ? contentRange(sent, sent + n, total)
          : `bytes ${sent}-${sent + n - 1}/*`

        const res = await putChunk(auth.token, begun.uri, chunk, range)
        if (res.status === 308) {
          const have = receivedBytes(res.range)
          // Drive is the authority on what it holds. Believing our own count
          // over its Range is how a resumable upload silently corrupts a file.
          if (have > 0 && have !== sent + n) {
            if (have < sent) {
              return asError('Google Drive lost part of the upload — it will be retried')
            }
            sent = have
            continue
          }
          sent += n
          continue
        }
        if (res.status === 200 || res.status === 201) {
          sent += n
          finished = res.file
          done = true
          break
        }
        return asError(`Google Drive ${res.status} during the upload`, res.text)
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }

  if (!finished?.id) {
    return asError('Google Drive finished the upload without returning a file id')
  }
  return { ok: true, id: finished.id, bytes: Number(finished.size ?? sent) || sent }
}

// ── copying what is already in Drive ──────────────────────────────────────

/**
 * A server-side copy of a file already in Drive.
 *
 * The approved cut is mirrored into the item's folder before it is ever
 * approved, so the copy into `03 Final` and the copy into `_Scheduled` have no
 * reason to cross the internet again. `files.copy` is one request that never
 * leaves Google — a 2 GB master takes the same time as a 2 KB one.
 */
export async function copyDriveFile(
  fileId: string, name: string, parentId: string,
): Promise<DriveResult<UploadedFile>> {
  const auth = await accessToken()
  if (!auth.ok) return auth
  const url = `${FILES}/${encodeURIComponent(fileId)}/copy?` +
    new URLSearchParams({ fields: 'id,size', ...ALL_DRIVES })
  const res = await driveFetch<DriveFileMeta>(auth.token, url, {
    method: 'POST',
    body: JSON.stringify({ name, parents: [parentId] }),
  })
  if (!res.ok) return res
  if (!res.data.id) return asError('Google Drive copied a file with no id')
  return { ok: true, id: res.data.id, bytes: Number(res.data.size ?? 0) || 0 }
}

/** The folders a file currently sits in. Needed to MOVE it: Drive has no
 *  "set parent", only add-and-remove. */
export async function fileParents(fileId: string): Promise<DriveResult<{ parents: string[] }>> {
  const auth = await accessToken()
  if (!auth.ok) return auth
  const url = `${FILES}/${encodeURIComponent(fileId)}?` +
    new URLSearchParams({ fields: 'id,parents,trashed', ...ALL_DRIVES })
  const res = await driveFetch<{ parents?: string[]; trashed?: boolean }>(auth.token, url)
  if (!res.ok) return res
  if (res.data.trashed) return asError('That file is in the Drive bin')
  return { ok: true, parents: res.data.parents ?? [] }
}

/**
 * Move a file to a different folder.
 *
 * Used when a scheduled piece's date is pushed into a new month. A copy would
 * leave the old month claiming a post that is not happening then — the only
 * honest answer is that the file MOVES, so `_Scheduled/2026-08` empties itself
 * as work slips.
 */
export async function moveDriveFile(
  fileId: string, toParentId: string,
): Promise<DriveResult<{ moved: boolean }>> {
  const current = await fileParents(fileId)
  if (!current.ok) return current
  if (current.parents.includes(toParentId) && current.parents.length === 1) {
    return { ok: true, moved: false }
  }
  const auth = await accessToken()
  if (!auth.ok) return auth
  const remove = current.parents.filter(p => p !== toParentId)
  const url = `${FILES}/${encodeURIComponent(fileId)}?` + new URLSearchParams({
    fields: 'id',
    addParents: toParentId,
    ...(remove.length ? { removeParents: remove.join(',') } : {}),
    ...ALL_DRIVES,
  })
  // a PATCH with no body still needs one — Drive rejects a bodiless PATCH
  const res = await driveFetch<DriveFileMeta>(auth.token, url, {
    method: 'PATCH', body: JSON.stringify({}),
  })
  if (!res.ok) return res
  return { ok: true, moved: true }
}

/** The URL a person opens for a FILE (folders have their own form). */
export function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`
}

// ── permissions ───────────────────────────────────────────────────────────

export type DrivePermission = {
  id?: string
  type?: string
  role?: string
  emailAddress?: string
}

/** Every permission on a folder, paginated. */
export async function listPermissions(
  fileId: string,
): Promise<DriveResult<{ permissions: DrivePermission[] }>> {
  const auth = await accessToken()
  if (!auth.ok) return auth
  const permissions: DrivePermission[] = []
  let pageToken: string | undefined
  do {
    const url = `${FILES}/${encodeURIComponent(fileId)}/permissions?` + new URLSearchParams({
      fields: 'nextPageToken, permissions(id,type,role,emailAddress)',
      pageSize: '100',
      ...ALL_DRIVES,
      ...(pageToken ? { pageToken } : {}),
    })
    const res = await driveFetch<{ permissions?: DrivePermission[]; nextPageToken?: string }>(
      auth.token, url,
    )
    if (!res.ok) return res
    permissions.push(...(res.data.permissions ?? []))
    pageToken = res.data.nextPageToken
  } while (pageToken)
  return { ok: true, permissions }
}

/**
 * Grant one person writer access.
 *
 * `sendNotificationEmail=false` on purpose: this runs on every team change and
 * on every reconcile, and a contractor who gets four "a folder was shared with
 * you" emails in a week stops reading them. They are told about the folder by
 * the person who hired them, not by a job.
 */
export async function grantUserPermission(
  fileId: string, email: string,
): Promise<DriveResult<{ id: string }>> {
  const auth = await accessToken()
  if (!auth.ok) return auth
  const url = `${FILES}/${encodeURIComponent(fileId)}/permissions?` + new URLSearchParams({
    fields: 'id', sendNotificationEmail: 'false', ...ALL_DRIVES,
  })
  const res = await driveFetch<{ id?: string }>(auth.token, url, {
    method: 'POST',
    body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
  })
  if (!res.ok) return res
  return { ok: true, id: res.data.id ?? '' }
}

/** Revoke one permission by its id. */
export async function revokePermission(
  fileId: string, permissionId: string,
): Promise<DriveResult<{ revoked: true }>> {
  const auth = await accessToken()
  if (!auth.ok) return auth
  const url = `${FILES}/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}?` +
    new URLSearchParams({ ...ALL_DRIVES })
  const res = await fetch(url, {
    method: 'DELETE', headers: { Authorization: `Bearer ${auth.token}` },
  })
  // 204 is the success; 404 means it is already gone, which is the same
  // outcome and must not fail a reconcile
  if (!res.ok && res.status !== 404) {
    return asError(`Google Drive ${res.status} revoking access`, await res.text())
  }
  return { ok: true, revoked: true }
}

// ═════════════════════════════════════════════════════════════════════════
// The Files page's half of Drive
//
// Everything below serves `/dashboard/files`: browsing, searching, previews,
// downloads, and the uploads a person starts by dropping something on a
// folder. The rule the whole section is written around is the owner's:
//
//   THE APP NEVER RENAMES, MOVES OR DELETES ANYTHING IN THE OWNER'S DRIVE ON
//   ITS OWN.
//
// So there is no delete here at all — not a helper, not a route, nothing that
// could grow into one. Rename and move exist, they take one item at a time,
// and the routes above them refuse to run without an explicit confirmation
// from a person. Creating a folder finds an existing one by name FIRST and
// hands it back rather than making a second one, because Drive has no
// unique-name constraint and a duplicated client folder is the exact failure
// the owner asked us to make impossible. A failure at any point is reported
// and left alone: nothing here retries under a different name.
// ═════════════════════════════════════════════════════════════════════════

/** The fields every listing asks for, and no more.
 *
 *  Drive charges the same for a big `fields` list as a small one in quota, but
 *  not in bytes: a 100-file page fetched with `*` is a few hundred KB of JSON
 *  crossing the wire on every folder click. This list is what the page draws. */
const ENTRY_FIELDS =
  'id,name,mimeType,size,modifiedTime,webViewLink,hasThumbnail,owners(displayName,emailAddress)'

type RawEntry = {
  id?: string
  name?: string
  mimeType?: string
  size?: string
  modifiedTime?: string
  webViewLink?: string
  hasThumbnail?: boolean
  owners?: { displayName?: string; emailAddress?: string }[]
}

function toEntry(raw: RawEntry): DriveEntry | null {
  if (!raw.id || !raw.name) return null
  const owner = raw.owners?.[0]
  return {
    id: raw.id,
    name: raw.name,
    mimeType: raw.mimeType ?? '',
    size: raw.size != null && /^\d+$/.test(raw.size) ? Number(raw.size) : null,
    modified: raw.modifiedTime ?? null,
    ownerName: owner?.displayName ?? null,
    ownerEmail: owner?.emailAddress ?? null,
    hasThumbnail: Boolean(raw.hasThumbnail),
    webViewLink: raw.webViewLink ?? null,
  }
}

export type Listing = { entries: DriveEntry[]; nextPageToken: string | null }

/**
 * One page of a folder's contents — or of a search, when no parent is given.
 *
 * Paged rather than drained. `listSubfolders` in gdrive.ts loops until Drive
 * runs out because it is answering "what names are taken", a question with one
 * answer; this answers "what is on the screen", and a client folder holding
 * four thousand raw clips must not become four thousand rows and a
 * forty-second wait.
 */
export async function listEntries(
  opts: QueryOptions & {
    sort?: Sort; pageToken?: string | null; pageSize?: number
    /** a `q` built elsewhere — the subtree search's batched parents clause */
    rawQuery?: string
  },
): Promise<DriveResult<Listing>> {
  const auth = await accessToken()
  if (!auth.ok) return auth
  const sort: Sort = opts.sort ?? { by: 'name', dir: 'asc' }
  const url = `${FILES}?` + new URLSearchParams({
    q: opts.rawQuery ?? driveQuery(opts),
    fields: `nextPageToken, files(${ENTRY_FIELDS})`,
    pageSize: String(Math.min(Math.max(opts.pageSize ?? PAGE_SIZE, 1), PAGE_SIZE)),
    orderBy: driveOrderBy(sort),
    ...ALL_DRIVES_LIST,
    ...(opts.pageToken ? { pageToken: opts.pageToken } : {}),
  })
  const res = await driveFetch<{ files?: RawEntry[]; nextPageToken?: string }>(auth.token, url)
  if (!res.ok) return res
  const entries = (res.data.files ?? []).map(toEntry).filter((e): e is DriveEntry => e !== null)
  return { ok: true, entries, nextPageToken: res.data.nextPageToken ?? null }
}

export type EntryDetail = DriveEntry & { parents: string[] }

/** One file or folder, with its parents — the info panel and the breadcrumb. */
export async function entryDetail(id: string): Promise<DriveResult<{ entry: EntryDetail }>> {
  if (!isDriveId(id)) return asError('That file could not be found')
  const auth = await accessToken()
  if (!auth.ok) return auth
  const url = `${FILES}/${encodeURIComponent(id)}?` + new URLSearchParams({
    fields: `${ENTRY_FIELDS},parents,trashed`, ...ALL_DRIVES,
  })
  const res = await driveFetch<RawEntry & { parents?: string[]; trashed?: boolean }>(auth.token, url)
  if (!res.ok) return res
  if (res.data.trashed) return asError('That file is in the Google Drive bin')
  const entry = toEntry(res.data)
  if (!entry) return asError('That file could not be found')
  return { ok: true, entry: { ...entry, parents: res.data.parents ?? [] } }
}

/**
 * The folders from the picked root down to this one.
 *
 * Walked upwards by `parents`, one request per level, stopping at the root or
 * after MAX_DEPTH levels — a cycle is impossible in Drive but a partial grant
 * is not, and a walk that never reaches the root has to end rather than loop.
 * A trail that could not reach the root comes back as far as it got, which is
 * what the breadcrumb should show: where you are, honestly.
 */
const MAX_DEPTH = 20

export async function trailTo(
  id: string, rootId: string,
): Promise<DriveResult<{ trail: { id: string; name: string }[] }>> {
  if (!isDriveId(id) || !isDriveId(rootId)) return asError('That folder could not be found')
  const trail: { id: string; name: string }[] = []
  let at = id
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    const detail = await entryDetail(at)
    if (!detail.ok) return detail
    trail.unshift({ id: detail.entry.id, name: detail.entry.name })
    if (at === rootId) break
    const up = detail.entry.parents[0]
    if (!up || !isDriveId(up)) break
    at = up
  }
  return { ok: true, trail }
}

/**
 * Is `candidate` inside `ancestor`, at any depth?
 *
 * THREE answers, not two. This is the guard that stops a folder being dropped
 * into one of its own folders — which Drive accepts, and which takes the whole
 * branch out of the tree with nothing to undo it. It used to answer `false`
 * when the walk hit a Drive error, ran past `MAX_DEPTH`, or reached a parent
 * the `drive.file` grant does not cover; the route read `false` as "safe", so
 * a transient 500 was enough to permit the one move on this page that cannot
 * be taken back.
 *
 * A read error is an error. "I could not check" is its own answer, and the
 * caller refuses on it.
 */
export type Ancestry = 'inside' | 'outside' | 'unknown'

export async function isInside(candidate: string, ancestor: string): Promise<Ancestry> {
  let at = candidate
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (at === ancestor) return 'inside'
    const detail = await entryDetail(at)
    if (!detail.ok) return 'unknown'
    const up = detail.entry.parents[0]
    // no parent at all is a real answer: this is the top of what we can see,
    // and the ancestor was not on the way up
    if (!up) return 'outside'
    if (!isDriveId(up)) return 'unknown'
    at = up
  }
  // ran out of depth without an answer — which is not "no"
  return 'unknown'
}

/**
 * Everything below a folder, as far as we are allowed to walk.
 *
 * Drive's `q` has no subtree operator: `'x' in parents` is x's DIRECT children
 * and nothing else. So a search that says "in here or below it" has to walk,
 * and a walk of somebody's whole archive needs a stop on it — breadth first,
 * capped at `SEARCH_FOLDER_CAP` folders and `SEARCH_MS`. Breadth first because
 * the near folders are the ones a person means; depth first would spend the
 * whole budget down one branch of raw clips.
 *
 * `capped` is returned rather than hidden. A truncated search that says
 * nothing is how a person concludes their file is gone and uploads it again,
 * into the owner's real archive.
 */
export async function foldersUnder(
  parentId: string,
): Promise<DriveResult<{ ids: string[]; capped: boolean }>> {
  if (!isDriveId(parentId)) return asError('That folder could not be found')
  const started = Date.now()
  const ids = [parentId]
  const queue = [parentId]
  let capped = false

  while (queue.length) {
    if (ids.length >= SEARCH_FOLDER_CAP || Date.now() - started > SEARCH_MS) {
      capped = true
      break
    }
    const at = queue.shift() as string
    const page = await listEntries({ parentId: at, foldersOnly: true, pageSize: PAGE_SIZE })
    // one unreadable branch does not sink the search; it is simply not walked,
    // and `capped` already tells the person the answer may be short
    if (!page.ok) { capped = true; continue }
    if (page.nextPageToken) capped = true
    for (const folder of page.entries) {
      if (ids.length >= SEARCH_FOLDER_CAP) { capped = true; break }
      ids.push(folder.id)
      queue.push(folder.id)
    }
  }
  return { ok: true, ids, capped: capped || queue.length > 0 }
}

export type SearchResult = {
  entries: DriveEntry[]
  foldersSearched: number
  capped: boolean
}

/** The walk, then the search — batched, so a hundred folders is three
 *  requests rather than a hundred. */
export async function searchBelow(
  opts: QueryOptions & { parentId: string; sort?: Sort },
): Promise<DriveResult<SearchResult>> {
  const under = await foldersUnder(opts.parentId)
  if (!under.ok) return under

  const found = new Map<string, DriveEntry>()
  for (let at = 0; at < under.ids.length; at += SEARCH_PARENT_BATCH) {
    const batch = under.ids.slice(at, at + SEARCH_PARENT_BATCH)
    const page = await listEntries({
      ...opts,
      parentId: null,
      rawQuery: searchBatchQuery(opts, batch),
      pageSize: PAGE_SIZE,
    })
    if (!page.ok) return page
    // the same file can sit in two of the folders we walked; a person wants
    // one row for it, not one per parent
    for (const entry of page.entries) found.set(entry.id, entry)
  }
  return {
    ok: true,
    entries: [...found.values()],
    foldersSearched: under.ids.length,
    capped: under.capped,
  }
}

/**
 * A folder called `name` inside `parentId` — the existing one if there is one.
 *
 * ADOPT, never duplicate. Drive has no unique-name constraint, so pressing
 * "New folder" twice, or two people pressing it at once, would otherwise leave
 * two folders with the same name and no way for anybody to tell which one the
 * work went into. `created` says which of the two happened, so the page can
 * say "That folder is already there" rather than pretending it made something.
 */
export async function findOrCreateFolder(
  parentId: string, name: string,
): Promise<DriveResult<{ id: string; created: boolean }>> {
  if (!isDriveId(parentId)) return asError('That folder could not be found')
  // `safeSegment` answers "Untitled" for a blank name, which is fine when a
  // job is naming a folder and wrong when a person is: they typed nothing, and
  // a folder called Untitled in the owner's Drive is a mess somebody has to
  // clean up by hand. Ask again instead.
  if (!String(name ?? '').trim()) return asError('Give the folder a name first')
  const clean = safeSegment(name)
  const existing = await findSubfolder(parentId, clean)
  if (!existing.ok) return existing
  if (existing.id) return { ok: true, id: existing.id, created: false }
  const made = await createSubfolder(parentId, clean)
  if (!made.ok) return made
  return { ok: true, id: made.id, created: true }
}

/**
 * Rename one file or folder.
 *
 * One item, by explicit request, and that is the whole design: there is no
 * bulk rename in this file and there is not meant to be one. A failure is
 * returned as it happened — nothing here tries again under a different name,
 * because "the rename failed so we invented a name" is exactly how somebody's
 * folder ends up called "Sui Kitchen (2)" with nobody having asked for it.
 */
export async function renameDriveItem(
  id: string, name: string,
): Promise<DriveResult<{ name: string }>> {
  if (!isDriveId(id)) return asError('That file could not be found')
  if (!String(name ?? '').trim()) return asError('Give it a name first')
  const clean = safeSegment(name)
  const auth = await accessToken()
  if (!auth.ok) return auth
  const url = `${FILES}/${encodeURIComponent(id)}?` +
    new URLSearchParams({ fields: 'id,name', ...ALL_DRIVES })
  const res = await driveFetch<{ name?: string }>(auth.token, url, {
    method: 'PATCH', body: JSON.stringify({ name: clean }),
  })
  if (!res.ok) return res
  return { ok: true, name: res.data.name ?? clean }
}

/**
 * A link anybody holding it can open, for sending a client one file.
 *
 * Reader, not writer, and `allowFileDiscovery` off so the file never turns up
 * in a stranger's search. Drive answers 400 when the permission is already
 * there; that is the same outcome as success from here, so the link is read
 * back either way rather than the second press failing.
 */
export async function shareableLink(id: string): Promise<DriveResult<{ url: string }>> {
  if (!isDriveId(id)) return asError('That file could not be found')
  const auth = await accessToken()
  if (!auth.ok) return auth
  const permUrl = `${FILES}/${encodeURIComponent(id)}/permissions?` + new URLSearchParams({
    fields: 'id', sendNotificationEmail: 'false', ...ALL_DRIVES,
  })
  const granted = await driveFetch<{ id?: string }>(auth.token, permUrl, {
    method: 'POST',
    body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }),
  })
  const detail = await entryDetail(id)
  if (!detail.ok) return granted.ok ? detail : granted
  const url = detail.entry.webViewLink
    ?? (detail.entry.mimeType === FILES_FOLDER_MIME
      ? `https://drive.google.com/drive/folders/${id}`
      : driveFileUrl(id))
  return { ok: true, url }
}

/**
 * The bytes of a file, or of its Drive-made thumbnail, as a live stream.
 *
 * Both go through the server for one reason: the access token. A
 * `thumbnailLink` is not a public URL — it is signed for the account that
 * asked for it — so putting one in an `<img src>` either fails, or works by
 * handing the browser something it should never hold. The page asks this app
 * for a picture; this app asks Google with its own credentials and passes the
 * pixels back.
 */
export async function openThumbnail(
  id: string, size = 400,
): Promise<DriveResult<{ body: ReadableStream<Uint8Array>; contentType: string }>> {
  if (!isDriveId(id)) return asError('That file could not be found')
  const auth = await accessToken()
  if (!auth.ok) return auth
  const url = `${FILES}/${encodeURIComponent(id)}?` +
    new URLSearchParams({ fields: 'thumbnailLink,hasThumbnail', ...ALL_DRIVES })
  const meta = await driveFetch<{ thumbnailLink?: string; hasThumbnail?: boolean }>(auth.token, url)
  if (!meta.ok) return meta
  const link = meta.data.thumbnailLink
  if (!link) return asError('There is no preview for that file')
  // Drive's link ends in `=s220`; asking for a bigger one is a swap, not a
  // second request — and a 220px tile on a retina screen looks broken
  const sized = link.replace(/=s\d+$/, `=s${Math.min(Math.max(size, 64), 1600)}`)
  // the token goes in an Authorization header on the next line, so the host it
  // goes to is checked first — the same cheap rule the upload session gets
  if (!isGoogleContentUrl(sized)) return asError('That preview could not be loaded')
  const res = await fetch(sized, { headers: { Authorization: `Bearer ${auth.token}` } })
  if (!res.ok || !res.body) return asError('That preview could not be loaded')
  return {
    ok: true,
    body: res.body as ReadableStream<Uint8Array>,
    contentType: res.headers.get('content-type') ?? 'image/jpeg',
  }
}

export async function openDownload(id: string): Promise<DriveResult<{
  body: ReadableStream<Uint8Array>; contentType: string; name: string; size: string | null
}>> {
  if (!isDriveId(id)) return asError('That file could not be found')
  const detail = await entryDetail(id)
  if (!detail.ok) return detail
  if (detail.entry.mimeType === FILES_FOLDER_MIME) {
    return asError('A folder cannot be downloaded — open it in Google Drive instead')
  }
  const auth = await accessToken()
  if (!auth.ok) return auth
  const url = `${FILES}/${encodeURIComponent(id)}?` +
    new URLSearchParams({ alt: 'media', ...ALL_DRIVES })
  const res = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } })
  if (!res.ok || !res.body) {
    return asError('That file could not be downloaded', String(res.status))
  }
  return {
    ok: true,
    body: res.body as ReadableStream<Uint8Array>,
    contentType: res.headers.get('content-type')
      ?? detail.entry.mimeType
      ?? 'application/octet-stream',
    name: detail.entry.name,
    size: res.headers.get('content-length'),
  }
}

// ── uploads a person starts ───────────────────────────────────────────────

/**
 * Open a resumable session for a file coming off somebody's desktop.
 *
 * The same mechanism `uploadStreamToFolder` uses, split in two so the browser
 * can drive it: the bytes are not on our server, they are on a laptop, and a
 * 900 MB clip has to arrive a slice at a time with a progress bar somebody can
 * watch. The session URI is kept on the server (in `drive_uploads`) and never
 * handed out — the browser holds an opaque id of ours instead.
 */
export async function openUploadSession(
  parentId: string, name: string, size: number | null, mimeType?: string,
): Promise<DriveResult<{ uri: string; name: string }>> {
  if (!isDriveId(parentId)) return asError('That folder could not be found')
  if (!String(name ?? '').trim()) return asError('That file has no name')
  const clean = safeSegment(name)
  if (size != null && size > MAX_UPLOAD_BYTES) {
    return asError('That file is larger than Google Drive accepts')
  }
  const auth = await accessToken()
  if (!auth.ok) return auth
  const begun = await beginResumable(
    auth.token, { name: clean, parents: [parentId], mimeType }, size,
  )
  if (!begun.ok) return begun
  return { ok: true, uri: begun.uri, name: clean }
}

export type ChunkOutcome =
  | { ok: true; done: false; received: number }
  | { ok: true; done: true; id: string; bytes: number }
  | DriveFailure

/**
 * Push one slice at an open session.
 *
 * Drive's answer is the authority on how much it holds — the 308's `Range`
 * header, never our own count. When the two disagree the caller resends from
 * where Drive says it is, which is the whole reason resumable upload exists
 * and the difference between a dropped connection costing one chunk and
 * costing the file.
 */
export async function pushUploadChunk(
  uri: string, chunk: Uint8Array, start: number, total: number | null,
): Promise<ChunkOutcome> {
  // belt and braces: `liveUploadRow` checks the stored URI too, and this is
  // the line that actually attaches the token
  if (!isGoogleUploadUri(uri)) return asError('That upload is no longer going')
  const auth = await accessToken()
  if (!auth.ok) return auth
  const end = start + chunk.length
  const range = chunk.length === 0
    ? `bytes */${total ?? 0}`
    : total != null
      ? contentRange(start, end, total)
      : `bytes ${start}-${end - 1}/*`
  const res = await putChunk(auth.token, uri, chunk, range)
  if (res.status === 308) {
    const have = receivedBytes(res.range)
    return { ok: true, done: false, received: have > 0 ? have : end }
  }
  if (res.status === 200 || res.status === 201) {
    if (!res.file?.id) {
      return asError('Google Drive finished the upload without returning a file id')
    }
    return { ok: true, done: true, id: res.file.id, bytes: Number(res.file.size ?? end) || end }
  }
  return asError(`Google Drive ${res.status} during the upload`, res.text)
}
