import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireSignedIn } from '@/app/lib/authz'
import { addItem, boardErrorResponse } from '@/app/lib/boards'

/** POST { kind, x, y, w?, h?, colour?, text?, url?, label?, column_title?, parent_item_id? }
 *  — put a note, image, link, heading or column on the canvas. A board tile
 *  is made by POST /api/boards with parent_board_id, never here. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      const { id } = await params
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      return NextResponse.json({ item: await addItem(user, id, body) })
    } catch (e) {
      return boardErrorResponse(e)
    }
  })
}
