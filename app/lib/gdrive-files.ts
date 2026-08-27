import 'server-only'
import {
  ALL_DRIVES, FILES, UPLOAD_FILES, accessToken, driveFetch,
  type DriveResult,
} from './gdrive'
import { CHUNK_SIZE, contentRange, receivedBytes } from './gdrive-mirror-core'

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
