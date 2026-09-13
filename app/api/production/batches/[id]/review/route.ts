import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Batch, TeamUser as TeamUserRow, TeamUserClient } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { shootManager } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { announceBatchChange } from '../../../../../lib/production-live'
import { notifyPlanReviewAsked } from '../../../../../lib/shoot-sop-notify'
import { NOT_YOUR_PAGE, canManageShoot, reviewAskPatch, reviewersFor } from '../../../../../lib/shoot-sop-core'

/**
 * "ASK FOR A REVIEW" (the owner, 13 Sep 2026: "general user sometimes needs
 * to create it, how are they going to send the brief for a review"). Whoever
 * can manage the shoot asks the account managers on the client — or the
 * people they pick — to look at the plan. They are emailed the plan with a
 * link to the shoot page; their "Aligned with the strategist" tick is the
 * sign-off. Asking again re-stamps and emails again, on purpose.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const batches = table<Batch>('batches')
    const batch = await batches.get(id)
    if (!batch) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })
    if (!canManageShoot(await shootManager(user), batch)) return NextResponse.json(NOT_YOUR_PAGE, { status: 403 })

    const body = await req.json().catch(() => ({})) as { to?: unknown }
    const picked = Array.isArray(body.to) ? body.to.map(String) : null
    const links = await table<TeamUserClient>('team_user_clients').list({ by: { client_id: batch.client_id } })
    const linked = new Set(links.map(l => l.team_user_id))
    const managers = await table<TeamUserRow>('team_users').list({ where: u => linked.has(u.id) })
    const to = reviewersFor(user.id, picked, managers)
    if (to.length === 0) {
      return NextResponse.json({ error: 'Nobody to ask — pick a reviewer, or put an account manager on this client on the Team page' }, { status: 422 })
    }

    const now = new Date().toISOString()
    const done = await batches.claim(id, cur => (cur ? { ...cur, ...(reviewAskPatch(now, user.id, to) as Partial<Batch>) } : null))
    if (!done.claimed) return NextResponse.json({ error: 'Could not save — try again' }, { status: 409 })
    await logActivity({
      actor: user, clientId: batch.client_id, entityType: 'batch', entityId: id,
      action: 'sop_review_asked', detail: `asked ${to.length} to review the plan`,
    })
    const told = await notifyPlanReviewAsked(user, done.row, to).catch(e => { console.error('review notify:', e); return 0 })
    announceBatchChange({ batch_id: id, client_id: batch.client_id, status: batch.status ?? 'brief', kind: 'updated' })
    return NextResponse.json({ ...done.row, asked: to, told })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
