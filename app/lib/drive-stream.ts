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

/** The file's bytes from Drive — through our account, else as anyone with
 *  the link — for the given Range; null when neither can read it. */
export async function openDriveFile(id: string, range: string | null): Promise<Response | null> {
  const rangeHeader: Record<string, string> = range ? { Range: range } : {}

  // first through our account — a file in the agency's own Drive
  let upstream: Response | null = null
  const auth = await accessToken()
  if (auth.ok) {
    const url = `${FILES}/${encodeURIComponent(id)}?` + new URLSearchParams({ alt: 'media', ...ALL_DRIVES })
    const own = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}`, ...rangeHeader } })
    if (own.ok && own.body) upstream = own
  }
  // then as anyone with the link — a client's shared folder
  if (!upstream) {
    const pub = await fetch(`${PUBLIC_DOWNLOAD}?` + new URLSearchParams({ id, export: 'download', confirm: 't' }), { headers: rangeHeader })
    // an HTML answer is Google's own page (not shared, or a sign-in), never the clip
    if (pub.ok && pub.body && !(pub.headers.get('content-type') ?? '').startsWith('text/html')) upstream = pub
  }
  return upstream
}

/** the whole size of a file, read off the Content-Range of a one-byte ask */
export function totalFromContentRange(res: Response): number | null {
  const m = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '')
  if (m) return Number(m[1])
  const len = Number(res.headers.get('content-length'))
  return res.status === 200 && Number.isFinite(len) && len > 0 ? len : null
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
