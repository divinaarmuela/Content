import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Batch, TeamUser as TeamUserRow, TeamUserClient } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { canConfirmFootage } from '../../../../../lib/shoot-sop-core'
import { logActivity } from '../../../../../lib/workflow'
import { announceBatchChange } from '../../../../../lib/production-live'
import { escapeHtml, notify, renderEmail } from '../../../../../lib/mailer'
import { DASHBOARD_URL } from '../../../../../lib/app-url'


/**
 * "GOT THE FOOTAGE" (the owner, 14 Sep 2026: "how do we know if he has
 * received the footage?"). The shoot's editor presses it once on their card;
 * the stamp is claimed, the line appears on the shoot page, and the account
 * managers are told. Anybody else is refused.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const batch = await table<Batch>('batches').get(id)
    if (!batch) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })
    if (!batch.footage_handed_at) return NextResponse.json({ error: 'The footage has not been handed over yet' }, { status: 400 })
    if (batch.footage_received_at) return NextResponse.json({ ...batch, already: true })
    if (!canConfirmFootage(batch, user.id)) {
      return NextResponse.json({ error: 'Only the editor on this shoot confirms the footage' }, { status: 403 })
    }
    const now = new Date().toISOString()
    const done = await table<Batch>('batches').claim(id, cur =>
      cur && !cur.footage_received_at ? { ...cur, footage_received_at: now, footage_received_by: user.id } : null)
    if (!done.claimed) return NextResponse.json({ ...batch, already: true })
    await logActivity({
      actor: user, clientId: batch.client_id, entityType: 'batch', entityId: id,
      action: 'footage_received', detail: 'Got the footage', newValue: user.id,
    })
    announceBatchChange({ batch_id: id, client_id: batch.client_id, status: batch.status ?? 'brief', kind: 'updated' })
    // the account managers and the owner hear it, once
    try {
      const ids = new Set<string>()
      if (batch.owner_id) ids.add(batch.owner_id)
      for (const l of await table<TeamUserClient>('team_user_clients').list({ by: { client_id: batch.client_id } })) ids.add(l.team_user_id)
      const people = await table<TeamUserRow>('team_users').list({
        where: u => u.active_status === true && ids.has(u.id) && u.id !== user.id && ['account_manager', 'super_admin'].includes(u.role),
      })
      for (const p of people) {
        await notify({
          actorName: user.name, actorEmail: user.email,
          eventType: 'shoot_footage_in', entityType: 'batch', entityId: `${id}#footage-received`,
          recipientId: p.id, recipientEmail: p.email,
          subject: `${user.name || user.email} has the footage: ${batch.title}`,
          bodyHtml: renderEmail(
            `${escapeHtml(batch.title)} — footage received`,
            `<p>${escapeHtml(user.name || user.email)} confirmed they have the footage for <strong>${escapeHtml(batch.title)}</strong>. The edit is under way.</p>`,
            'Open the shoot', `${DASHBOARD_URL}/dashboard/production/shoots/${id}`,
          ),
        })
      }
    } catch (e) {
      console.error('footage received notify:', e instanceof Error ? e.message : e)
    }
    return NextResponse.json(done.row)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
