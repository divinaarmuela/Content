import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireSignedIn, requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { performTransition } from '../../../../../lib/workflow'
import { ITEM_STATUSES, type ItemStatus } from '../../../../../lib/workflow-core'

/** Execute a status transition. Role legality, requirement evidence, and the
 *  optimistic-concurrency guard all live in performTransition. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSignedIn()
    const { id } = await params
    const item = await loadItemForUser(user, id)
    const body = await req.json()
    const to = body.to as ItemStatus
    if (!(ITEM_STATUSES as readonly string[]).includes(to)) {
      return NextResponse.json({ error: 'Invalid target status' }, { status: 400 })
    }
    const schedulerIds = Array.isArray(body.scheduler_ids)
      ? body.scheduler_ids.map((v: unknown) => String(v)).filter(Boolean).slice(0, 20)
      : undefined
    const updated = await performTransition(user, item, to, {
      reviewerIds: Array.isArray(body.notify_ids) ? body.notify_ids : undefined,
      schedulerIds,
    })
    // an approve-with-picker is also an assignment: the chosen schedulers'
    // dashboards show this item, others' stay clear
    if (to === 'approved_for_scheduling' && schedulerIds?.length) {
      await supabase.from('content_items').update({ scheduler_ids: schedulerIds }).eq('id', id)
    }
    return NextResponse.json(updated)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
