import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireSignedIn } from '@/app/lib/authz'
import { boardErrorResponse, boardForItem, createBoard, listClientBoards } from '@/app/lib/boards'

/**
 * Boards: a client's top-level canvases, and the one behind a piece of work.
 *
 *   GET  ?clientId=…   the client's boards, with what each holds
 *   GET  ?itemId=…     the board behind a card (made on first open, claimed
 *                      so two openers get one board)
 *   POST { client_id, name, icon?, colour?, parent_board_id?, at? }
 *                      one button makes a board — inside another when
 *                      parent_board_id is given, with its tile placed at `at`
 */

export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      const url = new URL(req.url)
      const itemId = url.searchParams.get('itemId')
      if (itemId) return NextResponse.json({ board: await boardForItem(user, itemId) })
      const clientId = url.searchParams.get('clientId')
      if (!clientId) return NextResponse.json({ error: 'Pick a client first' }, { status: 400 })
      return NextResponse.json(await listClientBoards(user, clientId))
    } catch (e) {
      return boardErrorResponse(e)
    }
  })
}

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      if (typeof body.item_id === 'string' && body.item_id) {
        return NextResponse.json({ board: await boardForItem(user, body.item_id) })
      }
      const clientId = String(body.client_id ?? '')
      if (!clientId) return NextResponse.json({ error: 'Pick a client first' }, { status: 400 })
      const at = body.at && typeof body.at === 'object'
        ? { x: Number((body.at as { x?: unknown }).x ?? 64), y: Number((body.at as { y?: unknown }).y ?? 64) }
        : undefined
      const made = await createBoard(user, {
        client_id: clientId, name: body.name, icon: body.icon, colour: body.colour,
        parent_board_id: typeof body.parent_board_id === 'string' ? body.parent_board_id : null,
        at,
      })
      return NextResponse.json(made)
    } catch (e) {
      return boardErrorResponse(e)
    }
  })
}
