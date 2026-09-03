import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { Batch, ContentItem } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { canOpenBatch } from '../../../../../lib/production-access'
import { logActivity, notifyBatchTransition, performTransition } from '../../../../../lib/workflow'
import { announceBatchChange } from '../../../../../lib/production-live'
import { onShootDateChanged } from '../../../../../lib/gdrive-hooks'
import {
  BATCH_STATUSES, batchSatisfiesLock, checkBatchTransition, type BatchStatus,
} from '../../../../../lib/batch-brief-core'

/** Move a shoot brief through its lifecycle. Locking the date is the
 *  commitment moment — it stamps who and when, derives the counting month,
 *  and opens the shoot for content items. Optimistic concurrency throughout:
 *  two people acting at once cannot double-move it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    const body = await req.json()
    const to = body.to as BatchStatus
    if (!(BATCH_STATUSES as readonly string[]).includes(to)) {
      return NextResponse.json({ error: 'Invalid target status' }, { status: 400 })
    }

    const batches = table<Batch>('batches')
    const batch = await batches.get(id)
    if (!batch) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })
    if (!(await canOpenBatch(user, batch))) {
      return NextResponse.json({ error: 'You are not on this client or assigned to this shoot' }, { status: 403 })
    }

    const from = batch.status as BatchStatus
    const check = checkBatchTransition(user.role, from, to)
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 403 })

    if (to === 'locked' && !batchSatisfiesLock(batch)) {
      return NextResponse.json({ error: 'Set a shoot date first' }, { status: 422 })
    }

    const patch: Record<string, unknown> = { status: to }
    if (to === 'locked') {
      const d = new Date(batch.shoot_date as string)
      patch.locked_at = new Date().toISOString()
      patch.locked_by = user.id
      patch.month = d.getUTCMonth() + 1
      patch.year = d.getUTCFullYear()
    }
    if (from === 'locked' && to === 'brief') {
      patch.locked_at = null
      patch.locked_by = null
      // month/year stay — items already counted to that month keep counting
    }
    if (to === 'shot') patch.shot_at = new Date().toISOString()

    // Nothing merely READ is trusted at the moment of the write: the shoot's
    // status is re-read here and the move refused if somebody else has
    // already made it.
    const live = await batches.get(id)
    if (!live || live.status !== from) {
      return NextResponse.json({ error: 'Someone else moved this shoot — refresh and try again' }, { status: 409 })
    }
    const updated = await batches.update(id, patch as Partial<Batch>)
    if (!updated) {
      return NextResponse.json({ error: 'Someone else moved this shoot — refresh and try again' }, { status: 409 })
    }

    await logActivity({
      actor: user, clientId: batch.client_id,
      entityType: 'batch', entityId: id,
      action: 'status_change', oldValue: from, newValue: to, detail: check.rule.label,
    })

    // ── booking is ONE action ──
    // "Book the shoot" = set the date + lock it. The shoot's approved plan
    // used to need a second click on its own page to move to "Shoot booked";
    // now the lock carries it. Best-effort: a plan not yet approved, or a
    // locker whose role may not book (the plan's own rule), simply leaves the
    // plan where it is — the lock itself already succeeded.
    if (to === 'locked') {
      const candidates = await table<ContentItem>('content_items').list({
        by: { batch_id: id },
        where: r => r.status === 'approved_for_scheduling',
      })
      const plan = (await attachOne(candidates, 'work_kind_id', 'work_kinds', ['slug']))
        .find(r => (r.work_kinds as { slug?: string } | null)?.slug === 'shoot_brief')
      if (plan) {
        try {
          await performTransition(user, plan as Parameters<typeof performTransition>[1], 'scheduled')
        } catch {
          // the plan stays at approved; booking it stays available on its page
        }
      }
    }
    notifyBatchTransition(user, updated, from, to)
    announceBatchChange({ batch_id: id, client_id: batch.client_id, status: to, kind: 'transition' })
    // locking is the moment the date becomes a fact — and the shoot folder is
    // named by the date's MONTH, so a plan folded under the month it was
    // RAISED in gets its name put right here
    if (to === 'locked') onShootDateChanged(updated)
    return NextResponse.json(updated)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
