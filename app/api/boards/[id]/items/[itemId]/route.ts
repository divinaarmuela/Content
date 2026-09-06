import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireSignedIn } from '@/app/lib/authz'
import { boardErrorResponse, patchItem, removeItem } from '@/app/lib/boards'

type Params = { params: Promise<{ id: string; itemId: string }> }

/** PATCH — move, resize, recolour, rewrite, or drop into a column. */
export async function PATCH(req: Request, { params }: Params) {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      const { id, itemId } = await params
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      return NextResponse.json({ item: await patchItem(user, id, itemId, body) })
    } catch (e) {
      return boardErrorResponse(e)
    }
  })
}

export async function DELETE(_req: Request, { params }: Params) {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      const { id, itemId } = await params
      await removeItem(user, id, itemId)
      return NextResponse.json({ ok: true })
    } catch (e) {
      return boardErrorResponse(e)
    }
  })
}
