import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, roleSatisfies, authzErrorResponse } from '../../../../lib/authz'
import { accessibleClientIds } from '../../../../lib/production-access'
import { logActivity } from '../../../../lib/workflow'
import { announceBatchChange } from '../../../../lib/production-live'
import {
  applyCanvasOp, sanitisePlannedDeliverables, sanitiseReferenceMedia, sanitiseShotList,
} from '../../../../lib/batch-brief-core'

/** Load a brief the caller may touch, or answer with the right refusal. */
async function loadBatch(user: Awaited<ReturnType<typeof requireRole>>, id: string) {
  const { data: batch } = await supabase
    .from('batches')
    .select('*, clients(name)')
    .eq('id', id)
    .maybeSingle()
  if (!batch) return { response: NextResponse.json({ error: 'Shoot not found' }, { status: 404 }) }
  const ids = await accessibleClientIds(user)
  if (ids !== null && !ids.includes(batch.client_id)) {
    return { response: NextResponse.json({ error: 'You are not assigned to this client' }, { status: 403 }) }
  }
  return { batch }
}

/** One brief, with its items — the working surface's data. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const loaded = await loadBatch(user, id)
    if ('response' in loaded) return loaded.response

    const [{ data: items }, { data: lockedBy }, { data: proposal }] = await Promise.all([
      supabase.from('content_items')
        .select('id, title, status, content_type, work_kinds(slug)')
        .eq('batch_id', id).order('created_at', { ascending: true }).limit(100),
      loaded.batch.locked_by
        ? supabase.from('team_users').select('name, email').eq('id', loaded.batch.locked_by).maybeSingle()
        : Promise.resolve({ data: null }),
      loaded.batch.proposal_id
        ? supabase.from('shoot_proposals').select('id, status').eq('id', loaded.batch.proposal_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    return NextResponse.json({
      batch: loaded.batch,
      items: items ?? [],
      locked_by_name: lockedBy?.name ?? lockedBy?.email ?? null,
      proposal: proposal ?? null,
      viewer_role: user.role,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Field-level edits — the browser sends ONLY the field that changed, so two
 *  people editing different parts of a brief cannot clobber each other's
 *  jsonb wholesale. Status never moves here; that is the transition route. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    const loaded = await loadBatch(user, id)
    if ('response' in loaded) return loaded.response
    const batch = loaded.batch
    const body = await req.json()

    // an AM changing a LOCKED date is its own audited act, with a reason
    if (body.action === 'change_date') {
      if (!roleSatisfies(user.role, 'account_manager')) {
        return NextResponse.json({ error: 'Only an account manager can change a locked date' }, { status: 403 })
      }
      const reason = String(body.reason ?? '').trim()
      const newDate = String(body.shoot_date ?? '').trim()
      if (!reason) return NextResponse.json({ error: 'Say why the date is moving — the team sees this' }, { status: 422 })
      if (!newDate || Number.isNaN(new Date(newDate).getTime())) {
        return NextResponse.json({ error: 'Pick a valid date' }, { status: 422 })
      }
      const d = new Date(newDate)
      const { data, error } = await supabase.from('batches')
        .update({ shoot_date: newDate, month: d.getUTCMonth() + 1, year: d.getUTCFullYear() })
        .eq('id', id).select().single()
      if (error) throw new Error(error.message)
      await logActivity({
        actor: user, clientId: batch.client_id,
        entityType: 'batch', entityId: id, action: 'date_changed',
        oldValue: batch.shoot_date ?? '', newValue: newDate, detail: reason,
      })
      announceBatchChange({ batch_id: id, client_id: batch.client_id, status: data.status, kind: 'updated' })
      return NextResponse.json(data)
    }

    const patch: Record<string, unknown> = {}
    // board edits arrive as per-card ops and merge server-side, so two people
    // moving different cards both win. Per-card last-write-wins; the small
    // read-modify-write window is accepted for v1 (realtime reload keeps
    // collisions rare; a jsonb-merge SQL function is the future tightening).
    if (body.canvas_op && typeof body.canvas_op === 'object') {
      patch.canvas_cards = applyCanvasOp(batch.canvas_cards, {
        upsert: (body.canvas_op as { upsert?: unknown }).upsert,
        remove: (body.canvas_op as { remove?: unknown }).remove,
      })
    }
    if ('title' in body) {
      const t = String(body.title ?? '').trim().slice(0, 120)
      if (!t) return NextResponse.json({ error: 'A shoot needs a title' }, { status: 422 })
      patch.title = t
    }
    if ('description' in body) patch.description = String(body.description ?? '').slice(0, 2000) || null
    if ('concept' in body) patch.concept = String(body.concept ?? '').slice(0, 8000) || null
    if ('location' in body) patch.location = String(body.location ?? '').slice(0, 300) || null
    if ('shot_list' in body) patch.shot_list = sanitiseShotList(body.shot_list)
    if ('planned_deliverables' in body) patch.planned_deliverables = sanitisePlannedDeliverables(body.planned_deliverables)
    if ('reference_media' in body) patch.reference_media = sanitiseReferenceMedia(body.reference_media)
    if ('owner_id' in body) {
      if (!roleSatisfies(user.role, 'account_manager')) {
        return NextResponse.json({ error: 'Only an account manager can change the owner' }, { status: 403 })
      }
      patch.owner_id = body.owner_id || null
    }
    if ('shared_with_client' in body) {
      // showing a shoot plan on the client portal is an AM call
      if (!roleSatisfies(user.role, 'account_manager')) {
        return NextResponse.json({ error: 'Only an account manager can share a shoot with the client' }, { status: 403 })
      }
      patch.shared_with_client = body.shared_with_client === true
    }
    if ('shoot_date' in body) {
      // freely editable while still a plan; once locked, the date is a
      // commitment and moves only through change_date above
      if (batch.status !== 'brief') {
        return NextResponse.json({ error: 'The date is locked — use "Change date" (account managers)' }, { status: 409 })
      }
      patch.shoot_date = body.shoot_date || null
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
    }

    const { data, error } = await supabase.from('batches').update(patch).eq('id', id).select().single()
    if (error) throw new Error(error.message)
    announceBatchChange({ batch_id: id, client_id: batch.client_id, status: data.status, kind: 'updated' })
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Delete a brief that never became anything: still in planning, no items. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('account_manager')
    const { id } = await params
    const loaded = await loadBatch(user, id)
    if ('response' in loaded) return loaded.response

    // any shoot with no items can go — a shoot that produced work cannot
    const { count } = await supabase.from('content_items')
      .select('id', { count: 'exact', head: true }).eq('batch_id', id)
    if ((count ?? 0) > 0) {
      return NextResponse.json({ error: 'This shoot has content items — wrap it instead of deleting' }, { status: 409 })
    }
    const { error } = await supabase.from('batches').delete().eq('id', id)
    if (error) throw new Error(error.message)
    await logActivity({
      actor: user, clientId: loaded.batch.client_id,
      entityType: 'batch', entityId: id, action: 'deleted', oldValue: loaded.batch.title,
    })
    announceBatchChange({ batch_id: id, client_id: loaded.batch.client_id, status: 'brief', kind: 'deleted' })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
