import 'server-only'
import { table } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { TeamBoard, TeamBoardComment } from '@/lib/db-types'
import { accountManagerName } from './portal-data'
import { resolvePortalClient, toPortalComment, type PortalComment } from './portal-thread'
import { sanitiseCanvasCards, type CanvasCard } from './batch-brief-core'
import { clientMaySeeTeamBoard } from './team-board-comments-core'
import { forTheClient } from './comment-visibility-core'

/**
 * A TEAM BOARD ON THE CLIENT'S PORTAL — the loader (the owner, 22 Sep 2026:
 * "when we show to client, can they leave comments, like how we do for
 * shoot briefs"). The client's own board, once a manager shared it; its
 * cards as the team drew them; and its comments, the same rows the team
 * reads on the board page. An unshared board, or another client's, is
 * simply not there.
 */
export type PortalTeamBoardDetail = {
  client: { id: string; name: string }
  am_name: string | null
  board: { id: string; name: string; canvas_cards: CanvasCard[] }
  comments: PortalComment[]
}

const COMMENTS_MAX = 300

export async function getPortalTeamBoardDetail(rawToken: string, boardId: string): Promise<PortalTeamBoardDetail | null> {
  const client = await resolvePortalClient(rawToken)
  if (!client) return null
  const board = await table<TeamBoard>('team_boards').get(boardId).catch(() => null)
  if (!clientMaySeeTeamBoard(board, client.id)) return null
  const b = board as TeamBoard & { canvas_cards?: unknown }

  const [comments, amName] = await Promise.all([
    table<TeamBoardComment>('team_board_comments')
      .list({ where: r => r.board_id === b.id, orderBy: [['created_at', 'asc']], limit: COMMENTS_MAX })
      .then(rows => attachOne(rows, 'author_id', 'team_users', ['name', 'role']))
      .then(rows => forTheClient(rows as never[]))
      .catch(() => []),
    accountManagerName(client.id),
  ])
  const asComment = toPortalComment(client.name)
  return {
    client: { id: client.id, name: client.name },
    am_name: amName,
    board: { id: b.id, name: String(b.name ?? 'Board'), canvas_cards: sanitiseCanvasCards(b.canvas_cards) },
    comments: comments.map(c => asComment(c as unknown as Parameters<typeof asComment>[0])),
  }
}
