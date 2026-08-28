import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { accessibleClientIds, assertUuid } from '../../../lib/production-access'
import { canCreateItemsUnder, type BatchStatus } from '../../../lib/batch-brief-core'
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
  try {
    const user = await requireRole('scheduler')
    const url = new URL(req.url)
    const clientFilter = url.searchParams.get('client_id')
    let q = supabase
      .from('deliverable_groups')
      .select('id, client_id, batch_id, content_type, title, target, work_kind_id, work_kinds(slug, uses_media, name, color), created_at')
      .order('created_at', { ascending: false })
      .limit(300)
    const clientIds = await accessibleClientIds(user)
    if (clientIds !== null) {
      if (clientIds.length === 0) return NextResponse.json([])
      q = q.in('client_id', clientIds.map(assertUuid))
    }
    if (clientFilter) q = q.eq('client_id', clientFilter)
    const { data, error } = await q
    if (error) {
      // the table may not be migrated yet — an empty board beats a dead one
      if (/relation|does not exist|could not find the table|schema cache/i.test(error.message)) return NextResponse.json([])
      throw new Error(error.message)
    }
    return NextResponse.json(data ?? [])
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Create ONE group — the quantity from the New dialog becomes its target. */
export async function POST(req: Request) {
  try {
    // the lowest team floor: every team role may promise work, no client may
    const user = await requireRole('scheduler')
    const body = await req.json()
    const clientId = String(body.client_id ?? '')
    const title = String(body.title ?? '').trim().slice(0, 120)
    const target = Math.min(100, Math.max(1, Number(body.target) || 1))
    const contentType = String(body.content_type ?? 'reel').slice(0, 20)
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
      const { data: kind } = await supabase.from('work_kinds')
        .select('id, slug, uses_media, active').eq('id', workKindId).maybeSingle()
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
      const { data: batch } = await supabase.from('batches')
        .select('id, client_id, status').eq('id', batchId).maybeSingle()
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
    const { data, error } = await supabase.from('deliverable_groups').insert({
      client_id: clientId,
      batch_id: taskGroup ? null : batchId,
      content_type: taskGroup ? 'other' : contentType,
      title,
      target,
      work_kind_id: workKindId,
      created_by: user.id,
    }).select().single()
    if (error) {
      if (/relation|does not exist|could not find the table|schema cache/i.test(error.message)) {
        return NextResponse.json(
          { error: 'This part of the app isn’t switched on yet — run supabase/deliverable_groups.sql' },
          { status: 503 },
        )
      }
      throw new Error(error.message)
    }
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
}
