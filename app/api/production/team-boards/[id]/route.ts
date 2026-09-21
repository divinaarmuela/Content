import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { TeamBoard } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { applyCanvasOp } from '../../../../lib/batch-brief-core'
import { cleanBoardName, mayEditTeamBoard, mayManageTeamBoards } from '../../../../lib/team-board-core'

/**
 * ONE TEAM BOARD (the owner, 21 Sep 2026). Reading it and working on it —
 * adding, moving, deleting cards — is anyone's on the team. Renaming and
 * deleting it is a manager's.
 *
 * A canvas edit arrives as a per-card op and is merged INSIDE a claim, on
 * the row as it is at that instant: two people moving different cards both
 * win, and neither write is built on a copy the other has already changed
 * (trap 11 — never check-then-write).
 */
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler') // any team role; excludes `client`
      const { id } = await params
      const board = await table<TeamBoard>('team_boards').get(id)
      if (!board) return NextResponse.json({ error: 'Board not found' }, { status: 404 })
      return NextResponse.json({ board })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      if (!mayEditTeamBoard(user)) return NextResponse.json({ error: 'Boards are the team’s' }, { status: 403 })
      const { id } = await params
      const body = await req.json().catch(() => ({})) as { name?: unknown; canvas_op?: unknown }

      let name: string | null = null
      if ('name' in body) {
        if (!mayManageTeamBoards(user)) {
          return NextResponse.json({ error: 'Only an account manager or a super admin renames a board' }, { status: 403 })
        }
        name = cleanBoardName(body.name)
        if (!name) return NextResponse.json({ error: 'A board needs a name' }, { status: 422 })
      }
      const op = body.canvas_op && typeof body.canvas_op === 'object'
        ? { upsert: (body.canvas_op as { upsert?: unknown }).upsert, remove: (body.canvas_op as { remove?: unknown }).remove }
        : null
      if (!name && !op) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })

      const now = new Date().toISOString()
      const result = await table<TeamBoard>('team_boards').claim(id, ((cur: TeamBoard | null): unknown => {
        if (!cur) return null
        return {
          ...cur,
          ...(name ? { name } : {}),
          ...(op ? { canvas_cards: applyCanvasOp((cur as { canvas_cards?: unknown }).canvas_cards, op) } : {}),
          updated_at: now,
          updated_by: user.id,
        }
      }) as (c: TeamBoard | null) => TeamBoard | null)
      if (!result.claimed) return NextResponse.json({ error: 'Board not found' }, { status: 404 })
      return NextResponse.json({ board: result.row, canvas_cards: (result.row as { canvas_cards?: unknown }).canvas_cards ?? [] })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      if (!mayManageTeamBoards(user)) {
        return NextResponse.json({ error: 'Only an account manager or a super admin deletes a board' }, { status: 403 })
      }
      const { id } = await params
      const board = await table<TeamBoard>('team_boards').get(id)
      if (!board) return NextResponse.json({ error: 'Board not found' }, { status: 404 })
      await table<TeamBoard>('team_boards').remove(id)
      return NextResponse.json({ ok: true })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
