import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity, notifyScheduleHandoff } from '../../../../../lib/workflow'
import { announceItemChange } from '../../../../../lib/production-live'

/** Hand an approved item to specific schedulers — the follow-up to a client
 *  approval, where the fan-out went to everyone and the manager narrows it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('account_manager')
    const { id } = await params
    const item = await loadItemForUser(user, id)
    if (item.status !== 'approved_for_scheduling') {
      return NextResponse.json({ error: 'Only an approved item can be handed to a scheduler' }, { status: 400 })
    }
    const body = await req.json()
    const ids: string[] = Array.isArray(body.scheduler_ids)
      ? body.scheduler_ids.map((v: unknown) => String(v)).filter(Boolean)
      : []
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Pick at least one scheduler' }, { status: 400 })
    }

    const sent = await notifyScheduleHandoff(user, item, ids)

    // persist the assignment: the scheduler dashboard shows THEIR items, the
    // way an editor's board shows their own jobs
    await supabase.from('content_items').update({ scheduler_ids: ids }).eq('id', id)
    announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'updated' })

    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: 'schedule_handoff',
      detail: `handed to ${sent} scheduler${sent === 1 ? '' : 's'}`,
    })
    return NextResponse.json({ notified: sent })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
