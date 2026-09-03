import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { Batch, DeliverableGroup, WorkKind } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { accessibleClientIds, assertUuid } from '../../../lib/production-access'
import { canCreateItemsUnder, type BatchStatus } from '../../../lib/batch-brief-core'
import { plannedFormats, plannedTarget } from '../../../lib/deliverable-group-core'
import { taskExemptFromClientScope } from '../../../lib/item-edit-core'
import { logActivity } from '../../../lib/workflow'
import { announceItemChange } from '../../../lib/production-live'

/**
 * Deliverable groups — "5 reels" as ONE card that fills up.
 *
 * A group is the promise made when the job was created: the board draws it as
 * "Reels · 2 of 5" and each "Add the next reel" files one real item into it.
 * Presentation only — the client's agreement still counts published ITEMS
 * (agreement-core), and the portal never sees a group.
 */

/** List groups, role-scoped the same way the board's items are. */
export async function GET(req: Request) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const url = new URL(req.url)
    const clientFilter = url.searchParams.get('client_id')
    const clientIds = await accessibleClientIds(user)
    if (clientIds !== null && clientIds.length === 0) return NextResponse.json([])
    const scoped = clientIds === null ? null : clientIds.map(assertUuid)
    const rows = await table<DeliverableGroup>('deliverable_groups').list({
      by: clientFilter ? { client_id: clientFilter } : undefined,
      where: scoped === null ? undefined : r => scoped.includes(r.client_id),
      orderBy: [['created_at', 'desc']],
      limit: 300,
    })
    return NextResponse.json(
      await attachOne(rows, 'work_kind_id', 'work_kinds', ['slug', 'uses_media', 'name', 'color']),
    )
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Create ONE group — the quantity from the New dialog becomes its target. */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    // the lowest team floor: every team role may promise work, no client may
    const user = await requireRole('scheduler')
    const body = await req.json()
    const clientId = String(body.client_id ?? '')
    const title = String(body.title ?? '').trim().slice(0, 120)
    // A MIX of formats — [{type,qty}] — makes ONE card. When present it drives
    // both numbers: target = sum of the quantities, content_type = the first
    // (primary) type. A single-format create sends no `planned` and keeps the
    // old target/content_type fields exactly as before.
    const planned = plannedFormats({ planned: body.planned })
    const target = planned
      ? Math.min(100, Math.max(1, plannedTarget(planned)))
      : Math.min(100, Math.max(1, Number(body.target) || 1))
    const contentType = planned ? planned[0].type.slice(0, 20) : String(body.content_type ?? 'reel').slice(0, 20)
    const batchId = body.batch_id ? String(body.batch_id) : null
    const adhocReason = String(body.adhoc_reason ?? '').trim()
    if (!clientId || !title) {
      return NextResponse.json({ error: 'client_id and title are required' }, { status: 400 })
    }
    // the promised pieces' kind, when the caller named one. A TASK group
    // (no media, not a shoot plan) is internal work: any client, no shoot
    // gate — exactly the rules one task follows.
    const workKindId = body.work_kind_id ? String(body.work_kind_id) : null
    let taskGroup = false
    if (workKindId) {
      const kind = await table<WorkKind>('work_kinds').get(workKindId)
      if (!kind?.active) {
        return NextResponse.json({ error: 'Pick a current work type' }, { status: 400 })
      }
      taskGroup = taskExemptFromClientScope(kind)
    }
    const clientIds = await accessibleClientIds(user)
    if (!taskGroup && clientIds !== null && !clientIds.includes(clientId)) {
      return NextResponse.json({ error: 'You are not assigned to that client' }, { status: 403 })
    }
    // the same shoot gate one item faces: promised pieces come from a booked
    // shoot, or the promise says where the footage will come from instead
    let batchStatus: BatchStatus | null = null
    if (batchId) {
      const batch = await table<Batch>('batches').get(batchId)
      if (!batch) return NextResponse.json({ error: 'That shoot no longer exists' }, { status: 400 })
      if (batch.client_id !== clientId) {
        return NextResponse.json({ error: 'That shoot belongs to a different client' }, { status: 403 })
      }
      batchStatus = (batch.status ?? null) as BatchStatus | null
    }
    if (!taskGroup
      && (batchId ? !canCreateItemsUnder(batchStatus, user.role) : !canCreateItemsUnder(null, user.role, { reason: adhocReason }))) {
      return NextResponse.json(
        { error: 'Promised pieces need a booked shoot — or say where the footage is from.' },
        { status: 422 },
      )
    }
    const baseRow = {
      client_id: clientId,
      batch_id: taskGroup ? null : batchId,
      content_type: taskGroup ? 'other' : contentType,
      title,
      target,
      work_kind_id: workKindId,
      created_by: user.id,
    }
    const data = await table('deliverable_groups')
      .insert(planned ? { ...baseRow, planned } : baseRow) as unknown as DeliverableGroup
    await logActivity({
      actor: user, clientId,
      entityType: 'content_item', entityId: data.id,
      action: 'created',
      newValue: `${title} — ${target} promised`,
      ...(batchId || !adhocReason ? {} : { detail: `ad-hoc: ${adhocReason.slice(0, 300)}` }),
    })
    // wake every open board so the new card appears without a reload
    announceItemChange({ item_id: data.id, client_id: clientId, status: 'draft_uploaded', kind: 'created' })
    return NextResponse.json(data, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
