import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity, notifyPublishQueued } from '../../../../../lib/workflow'
import { planItemPublish, queueItemPublish } from '../../../../../lib/production-publish'
import { announceItemChange } from '../../../../../lib/production-live'

/** What would be published for this item, and what is stopping it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('scheduler')
    // the role ladder admits editors via 'scheduler'; publishing to a client's
    // live accounts is scheduler/super-admin only
    if (!['scheduler', 'super_admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Only a scheduler can publish' }, { status: 403 })
    }
    const { id } = await params
    await loadItemForUser(user, id) // client scoping
    return NextResponse.json(await planItemPublish(id))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Send an approved item to the client's connected channels.
 *
 *  Scheduler and above: this is the act of putting content in front of the
 *  public, and it is gated on the workflow having approved the item. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('scheduler')
    if (!['scheduler', 'super_admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Only a scheduler can publish' }, { status: 403 })
    }
    const { id } = await params
    const item = await loadItemForUser(user, id)
    const body = await req.json().catch(() => ({}))

    const result = await queueItemPublish(id, {
      publishNow: body.publishNow === true,
      createdBy: user.email,
    })
    if ('error' in result) {
      return NextResponse.json({ error: result.error, issues: result.issues }, { status: 400 })
    }

    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: body.publishNow ? 'publish_requested' : 'publish_queued',
      detail: `publish job ${result.id}`,
    })

    // an explicit empty pick means "tell no one" — only an ABSENT field
    // falls back to the client's assigned managers
    if (!Array.isArray(body.notifyIds) || body.notifyIds.length > 0) {
      notifyPublishQueued(user, item, {
        jobId: result.id,
        publishNow: body.publishNow === true,
        recipientIds: Array.isArray(body.notifyIds)
          ? body.notifyIds.map((v: unknown) => String(v)).filter(Boolean)
          : undefined,
      })
    }

    announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'schedule' })
    return NextResponse.json({ jobId: result.id })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
