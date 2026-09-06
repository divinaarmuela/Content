import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireSignedIn } from '@/app/lib/authz'
import { boardErrorResponse, loadBoardForUser } from '@/app/lib/boards'
import { addBoardComment, listBoardComments, resolveBoardComment } from '@/app/lib/board-comments'

type Params = { params: Promise<{ id: string; itemId: string }> }

/**
 * Comments pinned to one item. Who reads what is decided by role in
 * board-canvas-core (`visibleCanvasComments`): a client's words reach the
 * account manager, never an editor. The portal writes through the same
 * storage (board-comments.ts) with its token, not through this route.
 */

export async function GET(_req: Request, { params }: Params) {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      const { id, itemId } = await params
      await loadBoardForUser(user, id)
      return NextResponse.json({ comments: await listBoardComments(id, user.role, itemId) })
    } catch (e) {
      return boardErrorResponse(e)
    }
  })
}

/** POST { body } */
export async function POST(req: Request, { params }: Params) {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      const { id, itemId } = await params
      const board = await loadBoardForUser(user, id)
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      const comment = await addBoardComment({
        boardId: id, itemId,
        author: { id: user.id, name: user.name, role: user.role },
        body: body.body, subjectTitle: board.name,
      })
      return NextResponse.json({ comment })
    } catch (e) {
      return boardErrorResponse(e)
    }
  })
}

/** PATCH { id } — mark a comment dealt with. */
export async function PATCH(req: Request, { params }: Params) {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      const { id } = await params
      await loadBoardForUser(user, id)
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      const commentId = String(body.id ?? '')
      if (!commentId) return NextResponse.json({ error: 'That comment is gone' }, { status: 404 })
      return NextResponse.json({ comment: await resolveBoardComment(user, id, commentId) })
    } catch (e) {
      return boardErrorResponse(e)
    }
  })
}
