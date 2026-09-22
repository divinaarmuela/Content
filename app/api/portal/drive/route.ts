import { table } from '@/lib/db'
import type { Batch, TeamBoard } from '@/lib/db-types'
import { resolvePortalClient } from '../../../lib/portal-thread'
import { openThumbnail } from '../../../lib/gdrive-files'
import { streamDriveFile } from '../../../lib/drive-stream'
import { PUBLIC_THUMBNAIL } from '../../../lib/drive-public-file-core'
import { isDriveId, isResourceKey } from '../../../lib/files-core'
import { sanitiseCanvasCards } from '../../../lib/batch-brief-core'
import { driveFileOnBoard, type PortalDriveKind } from '../../../lib/canvas-drive-core'
import { clientMaySeeTeamBoard } from '../../../lib/team-board-comments-core'

/**
 * A DRIVE FILE ON A BOARD THE CLIENT WAS SHOWN (the owner, 22 Sep 2026: the
 * client link to The Glass Den's posting-order board, "the files not
 * playing — from the drive"). The team's Drive proxies answer a signed-in
 * team member; the client has a portal token, so a Drive file on their
 * board was named and not drawn. This route is the client's proxy: the
 * same read-only bytes, behind the token.
 *
 * THREE GATES, each one a person could reason about: the token is a real
 * client's; the board is THEIRS and was shared with them (a team board's
 * "Share with client", a shoot's plan on the portal with its board on); and
 * the file is ON THAT BOARD — a token never reaches a Drive file somebody
 * merely knows the id of. Read only (trap 13): a GET of pixels or bytes.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const search = new URL(req.url).searchParams
  const token = search.get('token') ?? ''
  const kind = search.get('kind') as PortalDriveKind
  const boardId = search.get('board') ?? ''
  const id = search.get('id') ?? ''
  const what = search.get('what') === 'stream' ? 'stream' : 'thumbnail'
  if (!/^[0-9a-f-]{36}$/i.test(token.split('--').pop() ?? '') || !isDriveId(id) || !/^[A-Za-z0-9_-]{1,64}$/.test(boardId)) {
    return new Response('Not found', { status: 404 })
  }
  if (kind !== 'shoot' && kind !== 'team_board') return new Response('Not found', { status: 404 })
  const client = await resolvePortalClient(token)
  if (!client) return new Response('Not found', { status: 404 })

  // the board, theirs and shared
  let cards: unknown = null
  if (kind === 'team_board') {
    const board = await table<TeamBoard>('team_boards').get(boardId).catch(() => null)
    if (!clientMaySeeTeamBoard(board, client.id)) return new Response('Not found', { status: 404 })
    cards = (board as { canvas_cards?: unknown }).canvas_cards
  } else {
    const batch = await table<Batch>('batches').get(boardId).catch(() => null)
    if (!batch || batch.client_id !== client.id || !batch.shared_with_client || (batch as { share_board?: boolean | null }).share_board === false) {
      return new Response('Not found', { status: 404 })
    }
    cards = batch.canvas_cards
  }
  // the file, on that board
  const file = driveFileOnBoard(sanitiseCanvasCards(cards), id)
  if (!file) return new Response('Not found', { status: 404 })
  const key = isResourceKey(file.key) ? file.key : (isResourceKey(search.get('key')) ? search.get('key') : null)

  if (what === 'stream') {
    return streamDriveFile(id, req.headers.get('range'), search.get('name') ?? file.name, key)
  }
  const size = Number(search.get('size') ?? '800')
  const want = Number.isFinite(size) ? size : 800
  const own = await openThumbnail(id, want, key)
  if (own.ok) {
    return new Response(own.body as unknown as BodyInit, { headers: { 'Content-Type': own.contentType, 'Cache-Control': 'private, max-age=3600' } })
  }
  // as anyone with the link (drive-public-file-core.ts)
  const pub = await fetch(PUBLIC_THUMBNAIL(id, want), { cache: 'no-store' }).catch(() => null)
  const type = pub?.headers.get('content-type') ?? ''
  if (!pub || !pub.ok || !pub.body || !type.startsWith('image/')) {
    if (pub) void pub.body?.cancel().catch(() => undefined)
    return new Response('No preview', { status: 404 })
  }
  return new Response(pub.body as unknown as BodyInit, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' } })
}
