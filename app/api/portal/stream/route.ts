import { isDriveId } from '../../../lib/files-core'
import { streamDriveFile } from '../../../lib/drive-stream'
import { editingPortalItem } from '../../../lib/editing-portal'
import { clipSignatureOk } from '../../../lib/editing-portal-core'

/**
 * A CLIP, PLAYED ON THE CLIENT'S EDITING PORTAL (the owner, 16 Sep 2026).
 * Token-bearer, like every portal route: the token has to reach a card
 * that is the client's and on their portal, and the file has to be one the
 * page signed as that card's clip. Then the same read-only bytes the team's
 * review page plays (lib/drive-stream) — Range through, nothing cached.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const search = new URL(req.url).searchParams
  const token = search.get('token') ?? ''
  const itemId = search.get('item') ?? ''
  const id = search.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(token.split('--').pop() ?? '') || !itemId || !isDriveId(id)) return new Response('Not found', { status: 404 })
  const secret = process.env.CREDENTIALS_KEY ?? ''
  if (!secret || !clipSignatureOk(secret, itemId, id, search.get('sig'))) return new Response('Not found', { status: 404 })
  const found = await editingPortalItem(token, itemId)
  if (!found) return new Response('Not found', { status: 404 })
  try {
    return await streamDriveFile(id, req.headers.get('range'), search.get('name'))
  } catch {
    return new Response('That file could not be played', { status: 502 })
  }
}
