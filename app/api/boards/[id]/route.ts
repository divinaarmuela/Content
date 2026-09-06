import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireSignedIn } from '@/app/lib/authz'
import { boardErrorResponse, boardSnapshot, deleteBoard, renameBoard } from '@/app/lib/boards'

/** One board: everything on it (GET), its name/icon/colour (PATCH), gone (DELETE). */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      const { id } = await params
      return NextResponse.json(await boardSnapshot(user, id))
    } catch (e) {
      return boardErrorResponse(e)
    }
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      const { id } = await params
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      return NextResponse.json({ board: await renameBoard(user, id, body) })
    } catch (e) {
      return boardErrorResponse(e)
    }
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      const { id } = await params
      await deleteBoard(user, id)
      return NextResponse.json({ ok: true })
    } catch (e) {
      return boardErrorResponse(e)
    }
  })
}
