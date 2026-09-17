import { table } from '@/lib/db'
import type { ContentItem, DrivePull } from '@/lib/db-types'
import { authzErrorResponse, requireSignedIn } from '../../../lib/authz'
import { disposition, isOwnAssetUrl, ownStorageBases } from '../../../lib/download-core'
import { isShareToken, sharedFilesOf } from '../../../lib/share-link-core'

/**
 * DOWNLOAD A FILE FROM OUR OWN STORAGE, AS A DOWNLOAD.
 *
 * The bucket is on another origin, so a link straight to it opens the file in
 * the tab instead of saving it. This route pipes the bytes back from the
 * bucket with a Content-Disposition of attachment — never held in memory, a
 * stream from R2 to the browser with a check at the front:
 *
 *   - a signed-in team member may download anything in our storage;
 *   - a public share token (share-link-core) may download the files its card
 *     shares, and nothing else;
 *   - a URL that is not ours is answered with a redirect to itself, so the
 *     person still lands on the file.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const url = String(q.get('url') ?? '').trim()
  const name = String(q.get('name') ?? '').trim() || url.split('/').pop() || 'file'
  const share = q.get('share')
  if (!/^https?:\/\//i.test(url)) return new Response('Not found', { status: 404 })

  try {
    if (share) {
      if (!isShareToken(share)) return new Response('Not found', { status: 404 })
      const item = (await table<ContentItem>('content_items').list({ where: r => (r as { share_token?: unknown }).share_token === share, limit: 1 }))[0]
      if (!item) return new Response('This link has been switched off', { status: 404 })
      const pulls = await table<DrivePull>('drive_pulls').list({ by: { scope_id: item.id } as never })
      if (!sharedFilesOf(item as never, pulls as never).some(f => f.url === url)) return new Response('Not found', { status: 404 })
    } else {
      await requireSignedIn()
    }
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return new Response(error, { status })
  }

  const bases = ownStorageBases({ R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL, NEXT_PUBLIC_MEDIA_URL: process.env.NEXT_PUBLIC_MEDIA_URL })
  if (!isOwnAssetUrl(url, bases)) return Response.redirect(url, 302)

  const upstream = await fetch(url, { cache: 'no-store' })
  if (!upstream.ok || !upstream.body) return new Response('That file could not be read', { status: 502 })
  const size = upstream.headers.get('content-length')
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': disposition(name),
      ...(size ? { 'Content-Length': size } : {}),
      'Cache-Control': 'private, no-store',
    },
  })
}
