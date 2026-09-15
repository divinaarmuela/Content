import { authzErrorResponse } from '../../../lib/authz'
import { ALL_DRIVES, FILES, accessToken } from '../../../lib/gdrive'
import { requireFilesAccess } from '../../../lib/drive-page'
import { isDriveId } from '../../../lib/files-core'
import { videoMimeOf } from '../../../lib/video-review-core'

/**
 * A DRIVE CLIP, PLAYED HERE (the owner, 15 Sep 2026: the clip's review page
 * — "the video on the left, the comments on the right"). The browser's
 * <video> asks for pieces of the file with a Range header and expects them
 * back as 206 with a Content-Range; without that it cannot seek, and a
 * comment's marker cannot jump to its second. This route passes the Range
 * straight through to Drive and the answer straight back, with our
 * credentials and none of them in the page. Read only (trap 13): a GET of
 * bytes, nothing more. Never cached: a clip is re-exported, the page plays
 * the new one.
 *
 * A CLIP SHARED BY LINK (15 Sep 2026: "this page is not playing the video"):
 * the folder a client pastes is readable by anyone with the link, but Drive's
 * API will not hand its files to our account — the same reason the card page
 * lists that folder through the public folder view. When the API refuses (or
 * Drive is not connected at all), the bytes come from Google's own download
 * address with its "download anyway" confirmation, which takes a Range the
 * same way. That answer is typed `application/octet-stream` for everything,
 * so the clip's name, sent along by the page, says what it is.
 */
export const dynamic = 'force-dynamic'

const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']
/** Google's public download address — the one a "Download" on a shared file goes to */
const PUBLIC_DOWNLOAD = 'https://drive.usercontent.google.com/download'

export async function GET(req: Request) {
  try {
    await requireFilesAccess()
    const search = new URL(req.url).searchParams
    const id = search.get('id') ?? ''
    if (!isDriveId(id)) return new Response('Not found', { status: 404 })
    const range = req.headers.get('range')
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
    if (!upstream) return new Response('That file could not be played', { status: 404 })

    const headers = new Headers({ 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes' })
    for (const h of PASS) { const v = upstream.headers.get(h); if (v) headers.set(h, v) }
    const typed = headers.get('content-type') ?? ''
    const fromName = videoMimeOf(search.get('name'))
    if (fromName && (!typed || typed.startsWith('application/octet-stream'))) headers.set('content-type', fromName)
    return new Response(upstream.body as unknown as BodyInit, { status: upstream.status, headers })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return new Response(error, { status })
  }
}
