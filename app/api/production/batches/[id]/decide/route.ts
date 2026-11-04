import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Batch } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { shootManager } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { announceBatchChange } from '../../../../../lib/production-live'
import { NOT_YOUR_PAGE, canManageShoot, clientDecisionPatch, mayDecideShoot } from '../../../../../lib/shoot-sop-core'
import { archivePatch } from '../../../../../lib/archive-core'
import { autoShareIfReady } from '../../../../../lib/shoot-auto-share'

/**
 * WE DECIDE (Manal, 4 Nov 2026). POST { action }:
 *   client_approved — the client said yes somewhere other than the portal; we tick it for them, stamped with who,
 *                     and the plan goes to the team by itself if everything else is in place
 *   done            — the shoot is finished (filmed, edited, scheduled, or never needed the full road): it closes,
 *                     goes to Archive, and every reminder stops (each sweep skips a closed shoot)
 *   reopen          — Done taken back: out of Archive and open again
 * Account managers and super admins on the shoot only.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      if (!mayDecideShoot(user.role)) return NextResponse.json({ error: 'Only an account manager or a super admin can do this' }, { status: 403 })
      const { id } = await params
      const body = await req.json().catch(() => ({})) as { action?: string }
      const batches = table<Batch>('batches')
      const batch = await batches.get(id)
      if (!batch) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })
      const me = await shootManager(user)
      if (!canManageShoot(me, batch)) return NextResponse.json(NOT_YOUR_PAGE, { status: 403 })
      const now = new Date().toISOString()
      const who = user.name || user.email

      if (body.action === 'client_approved') {
        if (batch.client_decision === 'approved') return NextResponse.json({ error: 'The client has already approved this plan' }, { status: 409 })
        const patch = { ...clientDecisionPatch('approved', `Approved on the client's behalf by ${who}`, now), updated_at: now }
        const row = await batches.update(id, patch as never)
        await logActivity({ actor: user, clientId: batch.client_id, entityType: 'batch', entityId: id, action: 'client_approved_for_client', detail: `Marked approved on the client's behalf by ${who}` })
        const shared = await autoShareIfReady(user, id).catch(e => { console.error('auto share after approve:', e); return false })
        announceBatchChange({ batch_id: id, client_id: batch.client_id, status: batch.status ?? 'brief', kind: 'updated' })
        return NextResponse.json({ ok: true, shared, row })
      }

      if (body.action === 'done' || body.action === 'reopen') {
        const done = body.action === 'done'
        if (done && batch.status === 'wrapped' && batch.archived_at) return NextResponse.json({ error: 'Already done' }, { status: 409 })
        const status = done ? 'wrapped' : (batch.go_at || batch.footage_handed_at ? 'locked' : 'brief')
        const row = await batches.update(id, { status, ...archivePatch(done, user.id), updated_at: now } as never)
        await logActivity({
          actor: user, clientId: batch.client_id, entityType: 'batch', entityId: id,
          action: 'status_change', oldValue: batch.status ?? undefined, newValue: status,
          detail: done ? `Marked done by ${who} — closed and archived` : `Opened again by ${who}`,
        })
        announceBatchChange({ batch_id: id, client_id: batch.client_id, status, kind: 'updated' })
        return NextResponse.json({ ok: true, row })
      }

      return NextResponse.json({ error: 'Say what to do' }, { status: 400 })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
