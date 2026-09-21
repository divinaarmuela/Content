import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { TeamBoard } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { cleanBoardName, mayManageTeamBoards, sortTeamBoards } from '../../../lib/team-board-core'

/**
 * TEAM BOARDS (the owner, 21 Sep 2026): the shoot brief's canvas, for the
 * team's own use. Internal only — every route here takes a team member and
 * refuses a client. Anyone on the team lists and opens the boards; only an
 * account manager or a super admin makes one.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler') // any team role; excludes `client`
      const rows = await table<TeamBoard>('team_boards').list()
      return NextResponse.json({ boards: sortTeamBoards(rows) })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      if (!mayManageTeamBoards(user)) {
        return NextResponse.json({ error: 'Only an account manager or a super admin makes a board' }, { status: 403 })
      }
      const body = await req.json().catch(() => ({})) as { name?: unknown }
      const name = cleanBoardName(body.name)
      if (!name) return NextResponse.json({ error: 'Give the board a name' }, { status: 422 })
      const now = new Date().toISOString()
      const board = await table<TeamBoard>('team_boards').insert({
        name, canvas_cards: [], created_by: user.id, updated_by: user.id, created_at: now, updated_at: now,
      } as never)
      return NextResponse.json({ board }, { status: 201 })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
