import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { TeamUser } from '@/lib/db-types'
import { requireRole, authzErrorResponse, AuthzError } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity, notifyScheduleHandoff } from '../../../../../lib/workflow'
import { announceItemChange } from '../../../../../lib/production-live'

/** Hand an approved item to specific schedulers — the follow-up to a client
 *  approval, where the fan-out went to everyone and the manager narrows it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    // managers, super admins — and the general role, who may make and post
    // a card and so may hand one on (the tutorial walk of 11 Sep 2026: the
    // board offered "Hand to…" and this route answered 403)
    const user = await requireRole('scheduler')
    if (!['account_manager', 'super_admin', 'general'].includes(user.role)) {
      throw new AuthzError('Handing a card on is for managers and general users', 403)
    }
    const { id } = await params
    const item = await loadItemForUser(user, id)
    // approved OR already scheduled: re-handing a scheduled item to someone
    // else to publish is a real need, not an edge case. A published one is done.
    if (!['approved_for_scheduling', 'scheduled'].includes(item.status)) {
      return NextResponse.json(
        { error: 'Only an approved or scheduled item can be handed to someone' },
        { status: 400 },
      )
    }
    const body = await req.json()
    const ids: string[] = Array.isArray(body.scheduler_ids)
      ? body.scheduler_ids.map((v: unknown) => String(v)).filter(Boolean)
      : []
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Pick at least one person' }, { status: 400 })
    }

    // anyone on the team can be handed the scheduling now — the hat follows
    // the assignment, not the job title. Only a real, active, non-client
    // account survives: a stale id must never be persisted as an assignee.
    const wanted = ids.slice(0, 20)
    const people = await table<TeamUser>('team_users').list({ where: u => wanted.includes(u.id) })
    const valid = people
      .filter(u => u.active_status && u.role !== 'client')
      .map(u => u.id)
    if (valid.length === 0) {
      return NextResponse.json({ error: 'Pick at least one active team member' }, { status: 400 })
    }

    const sent = await notifyScheduleHandoff(user, item, valid)

    // INTO THE SCHEDULER'S DRAFT, NOT READY TO POST (the owner, 14 Sep 2026:
    // "handing over to a scheduler should go in Draft — the drive files are
    // what they work from"). The handed folder and the editor's edit stay on
    // the card as the source; the scheduler produces the post and sends it
    // for the quality check. A card the scheduler only has to book (already
    // scheduled) is left where it is.
    const patch: Record<string, unknown> = { scheduler_ids: valid }
    const toDraft = item.status === 'approved_for_scheduling'
    if (toDraft) patch.status = 'draft_uploaded'
    await table('content_items').update(id, patch)
    announceItemChange({ item_id: id, client_id: item.client_id, status: toDraft ? 'draft_uploaded' : item.status, kind: 'updated' })

    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: 'schedule_handoff',
      detail: `handed to ${valid.length} person${valid.length === 1 ? '' : 's'} (${sent} notified)`,
    })
    return NextResponse.json({ notified: sent })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
