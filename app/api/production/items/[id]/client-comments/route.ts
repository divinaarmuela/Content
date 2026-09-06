import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ItemComment, TeamUser } from '@/lib/db-types'
import { requireSignedIn, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { canReadClientComments, clientCommentsFor } from '../../../../../lib/comment-access-core'

/**
 * THE CLIENT'S OWN WORDS ON A CARD — for the account manager only.
 *
 * The client is talking to their manager, not to the room. An account
 * manager on the client's team (and a super admin) reads the thread here;
 * an editor or a scheduler is refused outright, whatever they hold on the
 * card. What THEY get is the manager's words, sent back with the card
 * (`send-back`). The portal is the client's own view of the same thread.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireSignedIn()
    if (!canReadClientComments(user.role)) {
      return NextResponse.json(
        { error: "The client's comments go to their account manager" },
        { status: 403 },
      )
    }
    const { id } = await params
    const item = await loadItemForUser(user, id)
    const [rows, team] = await Promise.all([
      table<ItemComment>('item_comments')
        .list({ by: { item_id: id }, orderBy: [['created_at', 'asc']] }),
      table<TeamUser>('team_users').list(),
    ])
    const personName = new Map(team.map(a => [a.id, a.name || a.email]))
    const comments = clientCommentsFor(user.role, rows).map(c => ({
      id: c.id,
      created_at: c.created_at,
      body: c.body,
      author_id: c.author_id,
      author_name: c.author_id ? personName.get(c.author_id) ?? null : null,
      resolved: c.resolved === true,
    }))
    return NextResponse.json({
      item_id: id,
      status: item.status,
      comments,
      // what the manager last sent back, so the card can show it beside the thread
      change_note: (item as { change_note?: string | null }).change_note ?? null,
      change_note_at: (item as { change_note_at?: string | null }).change_note_at ?? null,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
