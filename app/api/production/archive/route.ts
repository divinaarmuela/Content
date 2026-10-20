import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Batch, ContentItem, TeamBoard } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { canManageBatch, loadItemForUser } from '../../../lib/production-access'
import { mayManageTeamBoards } from '../../../lib/team-board-core'
import { logActivity } from '../../../lib/workflow'
import { archivePatch, mayArchiveCard, type ArchiveKind } from '../../../lib/archive-core'

/**
 * ARCHIVE / BRING BACK (the owner, 20 Oct 2026; archive-core). POST { kind: 'shoot' | 'card' | 'board', id, archive }.
 * Stamps or clears `archived_at` and nothing else: the row's files, comments, versions and history are untouched.
 * The lists and the client's portal read the stamp; each kind is allowed to the people who already run it.
 */
const TABLE: Record<ArchiveKind, 'batches' | 'content_items' | 'team_boards'> = { shoot: 'batches', card: 'content_items', board: 'team_boards' }

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const body = await req.json().catch(() => ({})) as { kind?: string; id?: string; archive?: unknown }
      const kind = body.kind as ArchiveKind
      const id = String(body.id ?? '')
      if (!TABLE[kind] || !id) return NextResponse.json({ error: 'Say what to archive' }, { status: 400 })
      const archive = body.archive === true

      let clientId: string | null = null
      let title = ''
      if (kind === 'shoot') {
        const b = await table<Batch>('batches').get(id)
        if (!b) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })
        if (!(await canManageBatch(user, b))) return NextResponse.json({ error: 'Only whoever runs this shoot may archive it' }, { status: 403 })
        clientId = b.client_id; title = b.title
      } else if (kind === 'card') {
        // throws 404 / 403 for a card this person may not open
        const item = await loadItemForUser(user, id) as ContentItem
        if (!mayArchiveCard(user, item)) return NextResponse.json({ error: 'Only a manager, or whoever the card belongs to, may archive it' }, { status: 403 })
        clientId = item.client_id; title = item.title
      } else {
        if (!mayManageTeamBoards(user)) return NextResponse.json({ error: 'Only an account manager or a super admin may archive a board' }, { status: 403 })
        const b = await table<TeamBoard>('team_boards').get(id)
        if (!b) return NextResponse.json({ error: 'Board not found' }, { status: 404 })
        clientId = b.client_id ?? null; title = b.name
      }

      await table(TABLE[kind]).update(id, { ...archivePatch(archive, user.id), updated_at: new Date().toISOString() } as never)
      await logActivity({
        actor: user, clientId,
        entityType: kind === 'shoot' ? 'batch' : kind === 'card' ? 'content_item' : 'team_board',
        entityId: id, action: archive ? 'archived' : 'unarchived', newValue: title,
      })
      return NextResponse.json({ ok: true, archived: archive })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
