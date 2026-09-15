import { authzErrorResponse } from '../../../lib/authz'
import { ALL_DRIVES, FILES, accessToken } from '../../../lib/gdrive'
import { requireFilesAccess } from '../../../lib/drive-page'
import { isDriveId } from '../../../lib/files-core'

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
 */
export const dynamic = 'force-dynamic'

const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']

export async function GET(req: Request) {
  try {
    await requireFilesAccess()
    const id = new URL(req.url).searchParams.get('id') ?? ''
    if (!isDriveId(id)) return new Response('Not found', { status: 404 })
    const auth = await accessToken()
    if (!auth.ok) return new Response(auth.message, { status: 502 })

    const range = req.headers.get('range')
    const url = `${FILES}/${encodeURIComponent(id)}?` + new URLSearchParams({ alt: 'media', ...ALL_DRIVES })
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${auth.token}`, ...(range ? { Range: range } : {}) },
    })
    if (!upstream.ok || !upstream.body) return new Response('That file could not be played', { status: upstream.status === 404 ? 404 : 502 })

    const headers = new Headers({ 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes' })
    for (const h of PASS) { const v = upstream.headers.get(h); if (v) headers.set(h, v) }
    return new Response(upstream.body as unknown as BodyInit, { status: upstream.status, headers })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return new Response(error, { status })
  }
}
