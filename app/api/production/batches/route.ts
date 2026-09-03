import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { Batch, ContentItem } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { batchClientIds, heldBatchIds } from '../../../lib/production-access'
import { logActivity } from '../../../lib/workflow'
import { announceBatchChange } from '../../../lib/production-live'
import { onBatchCreated } from '../../../lib/gdrive-hooks'
import {
  sanitisePlannedDeliverables, sanitiseReferenceMedia, sanitiseShotList,
} from '../../../lib/batch-brief-core'

/** List batches (role-scoped, with per-batch item counts). */
export async function GET() {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const clientIds = await batchClientIds(user)
    // the shoots of my clients — plus any shoot I hold a job on, which
    // opens for me (canOpenBatch) and so must be listed for me
    const held = clientIds === null ? [] : await heldBatchIds(user)
    if (clientIds !== null && clientIds.length === 0 && held.length === 0) return NextResponse.json([])
    const rows = await table<Batch>('batches').list({
      where: clientIds === null
        ? undefined
        : r => clientIds.includes(r.client_id) || held.includes(r.id),
      orderBy: [['created_at', 'desc']],
      limit: 200,
    })
    const withClient = await attachOne(rows, 'client_id', 'clients', ['name'])
    // "3 items" per shoot: one read of the items, counted in memory — the
    // shape the board reads (`content_items[0].count`) is unchanged
    const countByBatch = new Map<string, number>()
    for (const it of await table<ContentItem>('content_items').list()) {
      if (it.batch_id) countByBatch.set(it.batch_id, (countByBatch.get(it.batch_id) ?? 0) + 1)
    }
    return NextResponse.json(withClient.map(b => ({
      ...b, content_items: [{ count: countByBatch.get(b.id) ?? 0 }],
    })))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Create a shoot brief. Any team role — it starts life as 'brief' (the DB
 *  default): a plan the team works up, not yet a commitment. Booking it IS
 *  the commitment, and that is still gated by the batch transitions. */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const body = await req.json()
    if (!body.client_id || !body.title) {
      return NextResponse.json({ error: 'client_id and title are required' }, { status: 400 })
    }
    const clientIds = await batchClientIds(user)
    if (clientIds !== null && !clientIds.includes(body.client_id)) {
      return NextResponse.json({ error: 'You are not assigned to that client' }, { status: 403 })
    }
    // validate the date and DERIVE month/year from it, rather than trusting the
    // body — a body month/year out of the check-constraint range would 500
    let shootDate: string | null = null
    let month: number | null = body.month ? Number(body.month) : null
    let year: number | null = body.year ? Number(body.year) : null
    if (body.shoot_date) {
      const t = new Date(`${String(body.shoot_date)}T00:00:00`)
      const yr = t.getUTCFullYear()
      if (Number.isNaN(t.getTime()) || yr < 2024 || yr > 2100) {
        return NextResponse.json({ error: 'Enter a valid shoot date' }, { status: 422 })
      }
      shootDate = String(body.shoot_date)
      month = t.getUTCMonth() + 1
      year = yr
    }
    if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) month = null
    if (year !== null && (!Number.isInteger(year) || year < 2024 || year > 2100)) year = null
    // the helper's untyped insert takes a partial row (created_at/updated_at
    // are stamped for us); the result is a full batch row
    const data = await table('batches').insert({
        client_id: body.client_id,
        title: String(body.title).slice(0, 120),
        description: body.description ? String(body.description).slice(0, 2000) : null,
        concept: body.concept ? String(body.concept).slice(0, 8000) : null,
        location: body.location ? String(body.location).slice(0, 300) : null,
        shoot_date: shootDate,
        shot_list: sanitiseShotList(body.shot_list),
        planned_deliverables: sanitisePlannedDeliverables(body.planned_deliverables),
        reference_media: sanitiseReferenceMedia(body.reference_media),
        month,
        year,
        owner_id: user.id,
        // Postgres defaulted the status; a shoot that reads back without one
        // is a plan no gate in batch-brief-core recognises
        status: 'brief',
      }) as unknown as Batch
    await logActivity({
      actor: user, clientId: data.client_id,
      entityType: 'batch', entityId: data.id,
      action: 'created', newValue: data.title,
    })
    announceBatchChange({ batch_id: data.id, client_id: data.client_id, status: data.status ?? 'brief', kind: 'created' })
    // the shoot's folder tree, in the background: never awaited, never able to
    // fail the create. With Drive unconnected this does nothing at all.
    onBatchCreated(data)
    return NextResponse.json(data, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
