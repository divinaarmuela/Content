import 'server-only'
import { ALL_DRIVES, FILES, accessToken } from './gdrive'
import { videoMimeOf } from './video-review-core'

/**
 * A DRIVE CLIP'S BYTES, PASSED THROUGH (the owner, 15 Sep 2026: the clip's
 * review page — "the video on the left, the comments on the right"; 16 Sep:
 * the client's editing portal plays the same clips, and the Drive pull
 * copies whole files through the same opener). The browser's <video> asks
 * for pieces of the file with a Range header and expects them back as 206
 * with a Content-Range; without that it cannot seek, and a comment's marker
 * cannot jump to its second. The Range goes straight through to Drive and
 * the answer straight back, with our credentials and none of them in the
 * page. Read only (trap 13): a GET of bytes, nothing more. Never cached: a
 * clip is re-exported, the page plays the new one.
 *
 * A CLIP SHARED BY LINK (15 Sep 2026: "this page is not playing the video"):
 * the folder a client pastes is readable by anyone with the link, but Drive's
 * API will not hand its files to our account — the same reason the card page
 * lists that folder through the public folder view. When the API refuses (or
 * Drive is not connected at all), the bytes come from Google's own download
 * address with its "download anyway" confirmation, which takes a Range the
 * same way. That answer is typed `application/octet-stream` for everything,
 * so the clip's name, sent along by the page, says what it is.
 *
 * Two routes stream through this — the team's /api/drive/stream (a signed-in
 * team member) and the client's /api/portal/stream (a portal token and a
 * signed clip) — and each does its own gate before asking for the bytes.
 */
const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']
/** Google's public download address — the one a "Download" on a shared file goes to */
const PUBLIC_DOWNLOAD = 'https://drive.usercontent.google.com/download'

/**
 * The file's bytes from Drive — through our account, else as anyone with
 * the link — for the given Range; null when neither can read it. A Range
 * asked for is a Range required: an answer that ignores it (a 200 with the
 * whole file) is put down and the other way is tried, so a slice is never
 * the wrong bytes and never the whole file in memory. An answer can be
 * abandoned with `signal`.
 */
export async function openDriveFile(id: string, range: string | null, signal?: AbortSignal): Promise<Response | null> {
  const rangeHeader: Record<string, string> = range ? { Range: range } : {}
  const usable = (res: Response) => res.ok && !!res.body && (!range || res.status === 206)

  // first through our account — a file in the agency's own Drive
  const auth = await accessToken()
  if (auth.ok) {
    const url = `${FILES}/${encodeURIComponent(id)}?` + new URLSearchParams({ alt: 'media', ...ALL_DRIVES })
    const own = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}`, ...rangeHeader }, signal }).catch(() => null)
    if (own && usable(own)) return own
    if (own) void own.body?.cancel().catch(() => undefined)
  }
  // then as anyone with the link — a client's shared folder
  const pub = await fetch(`${PUBLIC_DOWNLOAD}?` + new URLSearchParams({ id, export: 'download', confirm: 't' }), { headers: rangeHeader, signal }).catch(() => null)
  // an HTML answer is Google's own page (not shared, or a sign-in), never the clip
  if (pub && usable(pub) && !(pub.headers.get('content-type') ?? '').startsWith('text/html')) return pub
  if (pub) void pub.body?.cancel().catch(() => undefined)
  return null
}

/** the whole size of a file, read off the Content-Range of a one-byte ask */
export function totalFromContentRange(res: Response): number | null {
  const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')
  if (m) return Number(m[1])
  const len = Number(res.headers.get('content-length'))
  return res.status === 200 && Number.isFinite(len) && len > 0 ? len : null
}

/**
 * What a file is, without touching its bytes: name, type and size from
 * Drive's metadata through our account; else from the headers of a one-byte
 * ask as anyone with the link, abandoned the moment they are in. Null when
 * nothing will say.
 */
export async function driveFileMeta(id: string): Promise<{ name: string; mime: string; size: number | null; modified: string | null } | null> {
  const auth = await accessToken()
  if (auth.ok) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const res = await fetch(`${FILES}/${encodeURIComponent(id)}?` + new URLSearchParams({ fields: 'name,mimeType,size,modifiedTime', ...ALL_DRIVES }), {
        headers: { Authorization: `Bearer ${auth.token}` }, signal: ctrl.signal,
      })
      if (res.ok) {
        const meta = await res.json() as { name?: string; mimeType?: string; size?: string | number; modifiedTime?: string }
        const n = Number(meta.size)
        return { name: String(meta.name || id), mime: String(meta.mimeType || 'application/octet-stream'), size: Number.isFinite(n) && n > 0 ? n : null, modified: meta.modifiedTime ? String(meta.modifiedTime) : null }
      }
    } catch { /* fall through to the public ask */ } finally { clearTimeout(timer) }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await openDriveFile(id, 'bytes=0-0', ctrl.signal)
    if (!res) return null
    const size = totalFromContentRange(res)
    const disposition = res.headers.get('content-disposition') ?? ''
    const named = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1] ?? /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? null
    const name = named ? decodeURIComponent(named) : id
    const typed = res.headers.get('content-type') ?? ''
    ctrl.abort()
    return { name, mime: typed && !typed.startsWith('application/octet-stream') && !typed.startsWith('application/binary') ? typed : (videoMimeOf(name) ?? 'application/octet-stream'), size, modified: null }
  } catch {
    return null
  } finally { clearTimeout(timer) }
}

/** just the size — the metadata's, or the one-byte ask's */
export async function driveFileSize(id: string): Promise<number | null> {
  const auth = await accessToken()
  if (auth.ok) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const res = await fetch(`${FILES}/${encodeURIComponent(id)}?` + new URLSearchParams({ fields: 'size', ...ALL_DRIVES }), {
        headers: { Authorization: `Bearer ${auth.token}` }, signal: ctrl.signal,
      })
      if (res.ok) {
        const meta = await res.json() as { size?: string | number }
        const n = Number(meta.size)
        if (Number.isFinite(n) && n > 0) return n
      }
    } catch { /* fall through to the public ask */ } finally { clearTimeout(timer) }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await openDriveFile(id, 'bytes=0-0', ctrl.signal)
    const size = res ? totalFromContentRange(res) : null
    ctrl.abort()
    return size
  } catch {
    return null
  } finally { clearTimeout(timer) }
}

export async function streamDriveFile(id: string, range: string | null, name: string | null): Promise<Response> {
  const upstream = await openDriveFile(id, range)
  if (!upstream) return new Response('That file could not be played', { status: 404 })

  const headers = new Headers({ 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes' })
  for (const h of PASS) { const v = upstream.headers.get(h); if (v) headers.set(h, v) }
  const typed = headers.get('content-type') ?? ''
  const fromName = videoMimeOf(name)
  if (fromName && (!typed || typed.startsWith('application/octet-stream'))) headers.set('content-type', fromName)
  return new Response(upstream.body as unknown as BodyInit, { status: upstream.status, headers })
}
