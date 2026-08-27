import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { canOpenBatch } from '../../../../../lib/production-access'
import { logActivity, notifyBatchTransition } from '../../../../../lib/workflow'
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
  try {
    const user = await requireRole('editor')
    const { id } = await params
    const body = await req.json()
    const to = body.to as BatchStatus
    if (!(BATCH_STATUSES as readonly string[]).includes(to)) {
      return NextResponse.json({ error: 'Invalid target status' }, { status: 400 })
    }

    const { data: batch } = await supabase.from('batches').select('*').eq('id', id).maybeSingle()
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

    const { data: updated, error } = await supabase
      .from('batches').update(patch).eq('id', id).eq('status', from)
      .select().maybeSingle()
    if (error) throw new Error(error.message)
    if (!updated) {
      return NextResponse.json({ error: 'Someone else moved this brief — refresh and try again' }, { status: 409 })
    }

    await logActivity({
      actor: user, clientId: batch.client_id,
      entityType: 'batch', entityId: id,
      action: 'status_change', oldValue: from, newValue: to, detail: check.rule.label,
    })
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
}
