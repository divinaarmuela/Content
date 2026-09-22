import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { TeamBoard, TeamBoardComment } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { mayEditTeamBoard } from '../../../../../lib/team-board-core'
import { notifyTagged, resolveTags, settleTagNotifications, taggableTeam } from '../../../../../lib/comment-tags'
import { sanitiseCanvasCards } from '../../../../../lib/batch-brief-core'
import { findCanvasCard } from '../../../../../lib/canvas-comments-core'
import { teamBoardCommentPath } from '../../../../../lib/team-board-comments-core'
import { announceTeamBoardChange } from '../../../../../lib/production-live'

/**
 * A TEAM BOARD'S COMMENTS, team side (the owner, 22 Sep 2026: "make sure in
 * the boards internal comments is possible too, like tagging"). The same
 * shape as a shoot's card comments: every comment is pinned to ONE card of
 * the board, a team member tags a colleague with "@Name" (they are emailed
 * with a link that opens the board on that card, and it sits under "Waiting
 * on you" until marked done), and the client reads and writes the very
 * same rows on their portal page once the board is shared with them.
 *
 * Read only for a client: their own writes come through /api/portal/comment
 * with their token; this route is the team's.
 */
export const dynamic = 'force-dynamic'

const withAuthors = (rows: TeamBoardComment[]) =>
  attachOne(rows, 'author_id', 'team_users', ['name', 'role'])

const COMMENTS_MAX = 300

async function boardFor(id: string) {
  const board = await table<TeamBoard>('team_boards').get(id)
  return board ?? null
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      if (!mayEditTeamBoard(user)) return NextResponse.json({ error: 'Boards are the team’s' }, { status: 403 })
      const { id } = await params
      if (!(await boardFor(id))) return NextResponse.json({ error: 'Board not found' }, { status: 404 })
      let comments: unknown[] = []
      try {
        comments = await withAuthors(await table<TeamBoardComment>('team_board_comments').list({
          where: r => r.board_id === id, orderBy: [['created_at', 'asc']], limit: COMMENTS_MAX,
        }))
      } catch { comments = [] }
      return NextResponse.json({ comments, viewer_id: user.id })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      if (!mayEditTeamBoard(user)) return NextResponse.json({ error: 'Boards are the team’s' }, { status: 403 })
      const { id } = await params
      const board = await boardFor(id)
      if (!board) return NextResponse.json({ error: 'Board not found' }, { status: 404 })
      const json = await req.json().catch(() => ({})) as { body?: unknown; card_id?: unknown; mention_ids?: unknown }
      const body = String(json.body ?? '').trim().slice(0, 4000)
      if (!body) return NextResponse.json({ error: 'Write a comment first' }, { status: 400 })

      // pinned to one card of the board — only a card that is actually on it
      const cardId = json.card_id == null ? null : String(json.card_id).slice(0, 80)
      const card = cardId ? findCanvasCard(sanitiseCanvasCards((board as { canvas_cards?: unknown }).canvas_cards), cardId) : null
      if (!card) return NextResponse.json({ error: cardId ? 'That card is not on the board any more.' : 'A comment goes on a card — pick one' }, { status: cardId ? 404 : 400 })

      const explicit = Array.isArray(json.mention_ids) ? json.mention_ids.map(String) : []
      const tagged = resolveTags(body, explicit, await taggableTeam(), user.id)

      let data: (TeamBoardComment & { team_users: Record<string, unknown> | null }) | null = null
      try {
        const row = await table('team_board_comments').insert({
          board_id: id, author_id: user.id, body, card_id: card.id,
          assigned_to: tagged[0]?.id ?? null,
          resolved: false,
        })
        data = (await withAuthors([row as unknown as TeamBoardComment]))[0]
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save the comment' }, { status: 500 })
      }
      if (tagged.length > 0 && data) {
        await notifyTagged({
          actor: user, tagged, text: body,
          target: { kind: 'board', id, title: String(board.name ?? 'a board'), path: teamBoardCommentPath(id, card.id) },
          commentId: String((data as { id: string }).id),
        }).catch(e => console.error('board tag notify error:', e))
      }
      announceTeamBoardChange({ board_id: id, client_id: board.client_id ?? null })
      return NextResponse.json({ comment: data })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

/** Mark a tagged board comment done (or reopen it). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      if (!mayEditTeamBoard(user)) return NextResponse.json({ error: 'Boards are the team’s' }, { status: 403 })
      const { id } = await params
      const board = await boardFor(id)
      if (!board) return NextResponse.json({ error: 'Board not found' }, { status: 404 })
      const json = await req.json().catch(() => ({})) as { comment_id?: unknown; resolved?: unknown }
      if (!json.comment_id || typeof json.resolved !== 'boolean') {
        return NextResponse.json({ error: 'comment_id and resolved are required' }, { status: 400 })
      }
      const comments = table<TeamBoardComment>('team_board_comments')
      const existing = await comments.get(String(json.comment_id))
      // the comment must be on THIS board — never mark somebody else's thread
      if (!existing || existing.board_id !== id) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
      const updated = await comments.update(existing.id, { resolved: json.resolved })
      const data = updated ? (await withAuthors([updated]))[0] : null
      if (json.resolved) await settleTagNotifications(id, String(json.comment_id))
      announceTeamBoardChange({ board_id: id, client_id: board.client_id ?? null })
      return NextResponse.json({ comment: data })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
