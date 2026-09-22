import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, TeamBoard } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { applyCanvasOp } from '../../../../lib/batch-brief-core'
import {
  boardStatusOf, checkBoardTransition, cleanBoardName, cleanClientId, mayEditTeamBoard, mayManageTeamBoards, statusAfterEdit,
} from '../../../../lib/team-board-core'

/**
 * ONE TEAM BOARD (the owner, 21 Sep 2026). Reading it and working on it —
 * adding, moving, deleting cards — is anyone's on the team. Renaming and
 * deleting it, and saying which client it is for, is a manager's.
 *
 * THE STAGES (22 Sep 2026: "ensure it goes through the quality check stage
 * and approved"): `status` moves the board — anyone on the team sends it to
 * the quality check; the checker or a manager approves it or asks for
 * changes with a note. The rules are team-board-core's `checkBoardTransition`;
 * this route only applies them. An edit to an approved board puts it back
 * to Inspo (`statusAfterEdit`).
 *
 * A canvas edit arrives as a per-card op and is merged INSIDE a claim, on
 * the row as it is at that instant: two people moving different cards both
 * win, and neither write is built on a copy the other has already changed
 * (trap 11 — never check-then-write). The stage step is decided inside the
 * same claim, against the stage the row is in at that instant, for the same
 * reason.
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
      const body = await req.json().catch(() => ({})) as { name?: unknown; client_id?: unknown; status?: unknown; note?: unknown; canvas_op?: unknown }

      let name: string | null = null
      if ('name' in body) {
        if (!mayManageTeamBoards(user)) {
          return NextResponse.json({ error: 'Only an account manager or a super admin renames a board' }, { status: 403 })
        }
        name = cleanBoardName(body.name)
        if (!name) return NextResponse.json({ error: 'A board needs a name' }, { status: 422 })
      }
      // which client the board is for — null clears it (the team's own board)
      let clientChange: { client_id: string | null } | null = null
      if ('client_id' in body) {
        if (!mayManageTeamBoards(user)) {
          return NextResponse.json({ error: 'Only an account manager or a super admin says which client a board is for' }, { status: 403 })
        }
        const client_id = cleanClientId(body.client_id)
        if (body.client_id != null && body.client_id !== '' && body.client_id !== 'none' && !client_id) {
          return NextResponse.json({ error: 'That is not a client' }, { status: 422 })
        }
        if (client_id && !(await table<Client>('clients').get(client_id))) {
          return NextResponse.json({ error: 'That client could not be found' }, { status: 422 })
        }
        clientChange = { client_id }
      }
      const to = 'status' in body ? String(body.status ?? '') : null
      const op = body.canvas_op && typeof body.canvas_op === 'object'
        ? { upsert: (body.canvas_op as { upsert?: unknown }).upsert, remove: (body.canvas_op as { remove?: unknown }).remove }
        : null
      if (!name && !clientChange && !to && !op) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })

      const now = new Date().toISOString()
      let refused: string | null = null
      const result = await table<TeamBoard>('team_boards').claim(id, ((cur: TeamBoard | null): unknown => {
        if (!cur) return null
        const from = boardStatusOf(cur)
        let stage: Partial<TeamBoard> = {}
        if (to) {
          const step = checkBoardTransition(user, from, to, body.note)
          if (!step.ok) { refused = step.error; return null }
          stage = to === 'quality_check'
            ? { status: to, submitted_by: user.id, submitted_at: now, review_note: null }
            : { status: to, reviewed_by: user.id, reviewed_at: now, review_note: step.note }
        } else if (op) {
          // what was approved is no longer what is on the board
          const after = statusAfterEdit(from)
          if (after !== from) stage = { status: after }
        }
        return {
          ...cur,
          ...(name ? { name } : {}),
          ...(clientChange ?? {}),
          ...(op ? { canvas_cards: applyCanvasOp((cur as { canvas_cards?: unknown }).canvas_cards, op) } : {}),
          ...stage,
          updated_at: now,
          updated_by: user.id,
        }
      }) as (c: TeamBoard | null) => TeamBoard | null)
      if (refused) return NextResponse.json({ error: refused }, { status: 409 })
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
