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
    // scheduler assignment is a TEAM decision — a client-role caller (the
    // portal approves through this machinery) must not be able to pick who
    // schedules or narrow another scheduler's queue
    const requestedSchedulerIds = user.role !== 'client' && Array.isArray(body.scheduler_ids)
      ? body.scheduler_ids.map((v: unknown) => String(v)).filter(Boolean).slice(0, 20)
      : undefined
    // …and only REAL people: the same validation the handoff route does. A
    // stale or client id persisted as an assignee would hand the scheduling
    // hat to an account that can never wear it, and quietly empty the queue
    // it was taken out of.
    let schedulerIds: string[] | undefined
    if (requestedSchedulerIds?.length) {
      const { data: people } = await supabase
        .from('team_users')
        .select('id, role, active_status')
        .in('id', requestedSchedulerIds)
      const valid = (people ?? [])
        .filter(u => u.active_status && u.role !== 'client')
        .map(u => u.id as string)
      if (valid.length === 0) {
        return NextResponse.json({ error: 'Pick at least one active team member' }, { status: 400 })
      }
      schedulerIds = valid
    }
    const note = String(body.note ?? '').trim().slice(0, 2000)
    const updated = await performTransition(user, item, to, {
      reviewerIds: Array.isArray(body.notify_ids) ? body.notify_ids : undefined,
      schedulerIds,
      note: note || undefined,
    })
    // the note also lands in the item's own thread, tagged to the owner so
    // it stays visible in their narrowed view even when the requester isn't
    // their assignor — best-effort, never fails the transition
    if (note) {
      // …except on the client's own change request: that edge notifies account
      // managers and NEVER the editor directly (workflow-core), and a tagged
      // comment emails whoever it names. Leave it untagged so the rule holds.
      const clientChanges = item.status === 'client_review' && to === 'client_changes_requested'
      // A client's note is a note to US, and visibility follows the author's
      // role exactly as it does on the comments route: they must be able to see
      // what they sent. A client also never assigns — a note filed against the
      // editor would email them directly, past the gatekeeper.
      const fromClient = user.role === 'client'
      await supabase.from('item_comments')
        .insert({
          item_id: id, author_id: user.id,
          visibility: fromClient ? 'client' : 'internal', body: note,
          assigned_to: fromClient || clientChanges ? null : item.owner_id ?? null,
        })
        .then(() => {}, () => {})
    }
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
