import 'server-only'
import { table } from '@/lib/db'
import type { Board, BoardComment, BoardItem } from '@/lib/db-types'
import { AuthzError, type TeamUser } from './authz'
import { notifyManagersOfComment } from './portal-actor'
import {
  commentsFor, validateComment, visibleCanvasComments, type CommentRole,
} from './board-canvas-core'

/**
 * A comment pinned to ONE item on a canvas — storage the dashboard and the
 * portal share.
 *
 * The portal calls `addBoardComment` with the client's portal actor (see
 * portal-actor.ts) as the author, after checking the board belongs to the
 * client whose token it holds; the dashboard calls it with the signed-in
 * team member. Either way the row is the same shape, `author_role` says
 * who wrote it, and `listBoardComments` hands each viewer only what that
 * role may read: a client's comment reaches the account manager and never
 * an editor.
 */

export type CommentAuthor = { id: string | null; name: string; role: CommentRole | string }

export async function addBoardComment(input: {
  boardId: string
  itemId: string
  author: CommentAuthor
  body: unknown
  /** the board's own title, for the manager's email when a client wrote it */
  subjectTitle?: string
}): Promise<BoardComment> {
  const v = validateComment(input.body)
  if (!v.ok) throw new AuthzError(v.reason, 400)
  const item = await table<BoardItem>('board_items').get(input.itemId)
  if (!item || item.board_id !== input.boardId) throw new AuthzError('That item is not on this board any more', 404)
  const row = await table<BoardComment>('board_comments').insert({
    board_id: input.boardId,
    item_id: input.itemId,
    author_id: input.author.id,
    author_name: input.author.name.slice(0, 80),
    author_role: String(input.author.role),
    body: v.body,
    resolved_at: null,
  } as Omit<BoardComment, 'id'>)
  if (input.author.role === 'client') {
    // the client is talking to their manager, not to the room
    const board = await table<Board>('boards').get(input.boardId)
    if (board) {
      await notifyManagersOfComment({
        clientId: board.client_id,
        speaker: input.author.name,
        subjectTitle: input.subjectTitle ?? board.name,
        body: v.body,
        dashboardPath: `/dashboard/boards/${board.id}?item=${item.id}`,
      }).catch(e => console.error('board comment notify error:', e))
    }
  }
  return row
}

/** The comments on one board, or one item on it, that this role may read. */
export async function listBoardComments(
  boardId: string, role: CommentRole | string, itemId?: string | null,
): Promise<BoardComment[]> {
  const rows = await table<BoardComment>('board_comments').list({ by: { board_id: boardId } })
  const visible = visibleCanvasComments(role, rows)
  return itemId ? commentsFor(itemId, visible) : visible.sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/**
 * Mark a comment dealt with. A claim: the first person to resolve it wins,
 * and a second click on a stale panel is told rather than re-stamped.
 * The author or anyone on the team may resolve; a client resolves only
 * their own.
 */
export async function resolveBoardComment(user: TeamUser, boardId: string, commentId: string): Promise<BoardComment> {
  const result = await table<BoardComment>('board_comments').claim(commentId, current => {
    if (!current || current.board_id !== boardId || current.resolved_at) return null
    if (user.role === 'client' && current.author_id !== user.id) return null
    return { ...current, resolved_at: new Date().toISOString() }
  })
  if (result.claimed) return result.row
  if (!result.current || result.current.board_id !== boardId) throw new AuthzError('That comment is gone', 404)
  if (result.current.resolved_at) throw new AuthzError('Someone already marked that done', 409)
  throw new AuthzError('You can only resolve your own comment', 403)
}
