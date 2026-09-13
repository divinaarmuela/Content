import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Batch, Client, ContentItem } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { shootManager } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { announceBatchChange } from '../../../../../lib/production-live'
import { notifyPlanSharedWithClient } from '../../../../../lib/shoot-sop-notify'
import { NOT_YOUR_PAGE, canManageShoot, clientSharePatch, clientShareReady } from '../../../../../lib/shoot-sop-core'

/**
 * "SHARE THE PLAN WITH THE CLIENT" (the owner, 13 Sep 2026: "sometimes the
 * person who created the brief doesn't assign anyone; they review it
 * themselves and send it to the client themselves"). One press, once the
 * nine parts are in, at any stage from Draft on: the plan goes on the
 * client portal, the client is emailed, and Where it is reads "With the
 * client since …" until the portal brings back "Client approved" or "Client
 * asked for changes". No teammate-check step anywhere.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const batches = table<Batch>('batches')
    const batch = await batches.get(id)
    if (!batch) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })
    if (!canManageShoot(await shootManager(user), batch)) return NextResponse.json(NOT_YOUR_PAGE, { status: 403 })
    const itemCount = await table<ContentItem>('content_items').count({ by: { batch_id: id } })
    const ready = clientShareReady(batch, { itemCount })
    if (!ready.ok) return NextResponse.json({ error: ready.reason }, { status: 422 })
    const client = await table<Client>('clients').get(batch.client_id)
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const now = new Date().toISOString()
    const done = await batches.claim(id, cur => (cur ? { ...cur, ...(clientSharePatch(now, user.id) as Partial<Batch>) } : null))
    if (!done.claimed) return NextResponse.json({ error: 'Could not save — try again' }, { status: 409 })
    await logActivity({
      actor: user, clientId: batch.client_id, entityType: 'batch', entityId: id,
      action: 'sop_client_shared', detail: client.email ? `emailed ${client.email}` : 'the client has no email on file',
    })
    const emailed = await notifyPlanSharedWithClient(user, done.row, client).catch(e => { console.error('client share notify:', e); return false })
    announceBatchChange({ batch_id: id, client_id: batch.client_id, status: batch.status ?? 'brief', kind: 'updated' })
    return NextResponse.json({ ...done.row, emailed, client_email: client.email ?? null })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
