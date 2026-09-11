import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Batch } from '@/lib/db-types'
import { requireRole, roleSatisfies, authzErrorResponse } from '../../../../../lib/authz'
import { canOpenBatch } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { announceBatchChange } from '../../../../../lib/production-live'
import { peopleOnShoot, withAck, withoutAck } from '../../../../../lib/shoot-sop-core'

/**
 * "I've read the brief." One press by somebody on the shoot; a manager can
 * take one back (DELETE with the person's id). Idempotent both ways — the
 * list is rewritten inside a claim, so two presses or a press during a
 * crew change cannot lose anybody else's acknowledgement.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const batches = table<Batch>('batches')
    const batch = await batches.get(id)
    if (!batch) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })
    if (!(await canOpenBatch(user, batch))) {
      return NextResponse.json({ error: 'You are not on this shoot' }, { status: 403 })
    }
    if (!peopleOnShoot(batch).includes(user.id)) {
      return NextResponse.json({ error: 'You are not on this shoot — the account manager adds the people who need to read the plan' }, { status: 403 })
    }
    const now = new Date().toISOString()
    const done = await batches.claim(id, cur => (cur ? { ...cur, acknowledgements: withAck(cur, user.id, now) } : null))
    if (!done.claimed) return NextResponse.json({ error: 'Could not save — try again' }, { status: 409 })
    await logActivity({
      actor: user, clientId: batch.client_id, entityType: 'batch', entityId: id,
      action: 'brief_acknowledged', detail: 'read the plan',
    })
    announceBatchChange({ batch_id: id, client_id: batch.client_id, status: batch.status ?? 'brief', kind: 'updated' })
    return NextResponse.json(done.row)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('account_manager')
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const who = String(body.user_id ?? '')
    if (!who) return NextResponse.json({ error: 'Say whose acknowledgement to take back' }, { status: 400 })
    if (!roleSatisfies(user.role, 'account_manager')) {
      return NextResponse.json({ error: 'Only an account manager can take an acknowledgement back' }, { status: 403 })
    }
    const batches = table<Batch>('batches')
    const batch = await batches.get(id)
    if (!batch) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })
    if (!(await canOpenBatch(user, batch))) {
      return NextResponse.json({ error: 'You are not on this client or assigned to this shoot' }, { status: 403 })
    }
    const done = await batches.claim(id, cur => (cur ? { ...cur, acknowledgements: withoutAck(cur, who) } : null))
    if (!done.claimed) return NextResponse.json({ error: 'Could not save — try again' }, { status: 409 })
    await logActivity({
      actor: user, clientId: batch.client_id, entityType: 'batch', entityId: id,
      action: 'brief_acknowledgement_undone', newValue: who,
    })
    announceBatchChange({ batch_id: id, client_id: batch.client_id, status: batch.status ?? 'brief', kind: 'updated' })
    return NextResponse.json(done.row)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
