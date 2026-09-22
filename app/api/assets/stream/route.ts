import { authzErrorResponse, requireSignedIn } from '../../../lib/authz'
import { isOwnAssetUrl, ownStorageBases } from '../../../lib/download-core'

/**
 * A VIDEO FROM OUR OWN STORAGE, ON OUR OWN ORIGIN (the owner, 22 Sep 2026:
 * "Choose a frame" on the MD Media post said "this video will not open here
 * — the place it is stored will not let the page read it").
 *
 * Taking a still out of a video means drawing it on a canvas, which the
 * browser allows only for a video it may READ across origins. Read live:
 * the bucket answers our origin with Access-Control-Allow-Origin, but
 * exposes only ETag — not Content-Range — so Chrome's cross-origin media
 * loader cannot see the range it asked for and calls the file a format
 * error, while ordinary playback (no cross-origin read) of the same file
 * works. Piping the bytes through here, Range and all, puts the video on
 * the page's own origin, where no permission is needed.
 *
 * A signed-in team member, our storage only (download-core.isOwnAssetUrl),
 * a GET of bytes and nothing else.
 */
export const dynamic = 'force-dynamic'

const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']

export async function GET(req: Request) {
  const url = String(new URL(req.url).searchParams.get('url') ?? '').trim()
  if (!/^https?:\/\//i.test(url)) return new Response('Not found', { status: 404 })
  try {
    await requireSignedIn()
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return new Response(error, { status })
  }
  const bases = ownStorageBases({ R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL, NEXT_PUBLIC_MEDIA_URL: process.env.NEXT_PUBLIC_MEDIA_URL })
  if (!isOwnAssetUrl(url, bases)) return new Response('Not found', { status: 404 })

  const range = req.headers.get('range')
  const upstream = await fetch(url, { cache: 'no-store', headers: range ? { Range: range } : {} }).catch(() => null)
  if (!upstream || !upstream.ok || !upstream.body) return new Response('That file could not be read', { status: 502 })
  const headers = new Headers({ 'Cache-Control': 'private, max-age=3600' })
  for (const h of PASS) { const v = upstream.headers.get(h); if (v) headers.set(h, v) }
  return new Response(upstream.body, { status: upstream.status, headers })
}
