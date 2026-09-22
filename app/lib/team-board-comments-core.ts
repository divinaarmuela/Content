/**
 * COMMENTS ON A TEAM BOARD — the pure half (the owner, 22 Sep 2026: "when we
 * show to client, can they leave comments, like how we do for shoot briefs"
 * and "make sure in the boards internal comments is possible too, like
 * tagging").
 *
 * A team board's comments are the shoot brief's card comments, on a board
 * of its own: every comment is pinned to ONE card (`card_id`), the team
 * reads and writes them on the board page and tags each other with "@Name",
 * and the client — once a manager has shared the board with them — reads
 * and writes the same rows on their portal page, on the same card. Who is
 * told, where a link opens, and who may share are decided here. No I/O.
 */

import { commentSubject } from './canvas-comments-core'
import { mayManageTeamBoards, teamBoardPath, type TeamBoardViewer } from './team-board-core'

/** the team's board page, opened on that card's thread when there is one */
export function teamBoardCommentPath(boardId: string, cardId: string | null | undefined): string {
  const base = teamBoardPath(boardId)
  return cardId ? `${base}?card=${encodeURIComponent(cardId)}` : base
}

/** the client's page for a team board, on the same card */
export function portalTeamBoardPath(token: string, boardId: string, cardId?: string | null): string {
  const base = `/portal/${encodeURIComponent(token)}/team-board/${encodeURIComponent(boardId)}`
  return cardId ? `${base}?card=${encodeURIComponent(cardId)}` : base
}

/** the link a manager copies for the client: the portal's own token, so nothing new to keep secret */
export function portalTeamBoardLink(origin: string, token: string, boardId: string): string {
  return `${String(origin ?? '').replace(/\/+$/, '')}${portalTeamBoardPath(token, boardId)}`
}

/**
 * SHARING A BOARD WITH ITS CLIENT is a manager's (an account manager or a
 * super admin), and only a board that names a client can be shared — the
 * team's own board has no client to show it to.
 */
export function mayShareTeamBoard(viewer: TeamBoardViewer, board: { client_id?: string | null } | null | undefined): boolean {
  return mayManageTeamBoards(viewer) && !!board?.client_id
}

/** what the client can open: their own board, and only once it was shared — an unshared board is simply not there */
export function clientMaySeeTeamBoard(board: { client_id?: string | null; shared_with_client?: boolean | null } | null | undefined, clientId: string): boolean {
  return !!board && !!clientId && board.client_id === clientId && board.shared_with_client === true
}

/** "Glass den 1st shoot — on: Hero reel image" — the subject of the manager's email */
export function teamBoardCommentSubject(boardName: string | null | undefined, cardLabel: string | null | undefined): string {
  return commentSubject(String(boardName ?? '').trim() || 'a board', cardLabel)
}

/** the words on the Copy client link button's answer */
export function clientLinkWords(clientName: string | null): string {
  return clientName ? `Client link copied — send it to ${clientName}; they can comment on any card` : 'Client link copied'
}
