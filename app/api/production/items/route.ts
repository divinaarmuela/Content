import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireSignedIn, requireRole, authzErrorResponse } from '../../../lib/authz'
import { canCreateItemsUnder, type BatchStatus } from '../../../lib/batch-brief-core'
import { accessibleClientIds } from '../../../lib/production-access'
import { logActivity, notifyJobAssigned, sanitiseRawAssets } from '../../../lib/workflow'
import { announceItemChange } from '../../../lib/production-live'
import { SCHEDULER_STATUSES, CLIENT_LABELS, ITEM_STATUSES, type ItemStatus } from '../../../lib/workflow-core'

/** List items, role-scoped. Filters: client_id, status, batch_id. */
export async function GET(req: Request) {
  try {
    // Every signed-in role may LIST; what they get back is scoped below.
    // `requireRole('client')` looked like "the lowest bar" but means the
    // opposite: client is a separate axis, so it admitted clients and
    // refused the editors who live on this page.
    const user = await requireSignedIn()
    const url = new URL(req.url)
    const clientFilter = url.searchParams.get('client_id')
    const statusFilter = url.searchParams.get('status')
    const batchFilter = url.searchParams.get('batch_id')

    let q = supabase
      .from('content_items')
      .select('*, clients(name), batches(title)')
      .order('updated_at', { ascending: false })
      .limit(500)

    const clientIds = await accessibleClientIds(user)
    if (clientIds !== null) {
      if (user.role === 'client') {
        if (clientIds.length === 0) return NextResponse.json([])
        q = q.in('client_id', clientIds)
      } else {
        // owning an item grants visibility to it: an editor assigned a job
        // must see the job, whether or not they're assigned the whole client
        q = clientIds.length === 0
          ? q.eq('owner_id', user.id)
          : q.or(`client_id.in.(${clientIds.join(',')}),owner_id.eq.${user.id}`)
      }
    }
    if (user.role === 'scheduler') q = q.in('status', SCHEDULER_STATUSES)
    if (clientFilter) q = q.eq('client_id', clientFilter)
    if (statusFilter && (ITEM_STATUSES as readonly string[]).includes(statusFilter)) {
      q = q.eq('status', statusFilter)
    }
    if (batchFilter) q = q.eq('batch_id', batchFilter)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    const rows = user.role === 'client'
      ? (data ?? []).map(r => ({ ...r, status_label: CLIENT_LABELS[r.status as ItemStatus] }))
      : data
    return NextResponse.json(rows)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Create one or many items (batch upload of a shoot). editor+. */
export async function POST(req: Request) {
  try {
    const user = await requireRole('editor')
    const body = await req.json()
    const items = Array.isArray(body.items) ? body.items : [body]
    if (items.length === 0 || items.length > 50) {
      return NextResponse.json({ error: 'Provide 1–50 items' }, { status: 400 })
    }

    const clientIds = await accessibleClientIds(user)

    // ── THE PRE-PRODUCTION GATE ──
    // Items belong to a shoot whose date is locked. An account manager can go
    // around it for genuinely ad-hoc work, with a reason that gets logged.
    const adhocReason = String(body.adhoc_reason ?? '').trim()
    const batchIds = [...new Set(items.map((it: { batch_id?: string }) => it.batch_id).filter(Boolean))] as string[]
    const { data: batchRows } = batchIds.length
      ? await supabase.from('batches').select('id, client_id, status').in('id', batchIds)
      : { data: [] }
    const batchById = new Map((batchRows ?? []).map(b => [b.id as string, b]))

    const rows = []
    for (const it of items) {
      if (!it.client_id || !it.title) {
        return NextResponse.json({ error: 'client_id and title are required on every item' }, { status: 400 })
      }
      if (clientIds !== null && !clientIds.includes(it.client_id)) {
        return NextResponse.json({ error: 'You are not assigned to that client' }, { status: 403 })
      }
      if (it.batch_id) {
        const batch = batchById.get(it.batch_id)
        if (!batch) return NextResponse.json({ error: 'That shoot no longer exists' }, { status: 400 })
        if (batch.client_id !== it.client_id) {
          return NextResponse.json({ error: "That shoot belongs to a different client" }, { status: 403 })
        }
        if (!canCreateItemsUnder(batch.status as BatchStatus, user.role)) {
          return NextResponse.json(
            { error: 'Content items need a locked shoot. Lock the shoot date on its brief first.' },
            { status: 422 },
          )
        }
      } else if (!canCreateItemsUnder(null, user.role, { reason: adhocReason })) {
        return NextResponse.json(
          { error: 'Content items need a locked shoot. Lock the shoot date on its brief first.' },
          { status: 422 },
        )
      }
      rows.push({
        client_id: it.client_id,
        batch_id: it.batch_id ?? null,
        title: String(it.title),
        content_type: it.content_type ?? 'reel',
        platform_targets: Array.isArray(it.platform_targets) ? it.platform_targets : [],
        owner_id: it.owner_id ?? (user.role === 'editor' ? user.id : null),
        // who handed out the job — the natural default reviewer later
        assigned_by: it.owner_id ? user.id : null,
        due_date: it.due_date ?? null,
        priority: it.priority ?? 'normal',
        caption: it.caption ?? null,
        raw_assets_url: it.raw_assets_url ? String(it.raw_assets_url).slice(0, 2000) : null,
        brief: it.brief ? String(it.brief).slice(0, 5000) : null,
        raw_assets: sanitiseRawAssets(it.raw_assets),
        client_approval_required: it.client_approval_required ?? true,
      })
    }

    const { data, error } = await supabase.from('content_items').insert(rows).select()
    if (error) throw new Error(error.message)
    for (const item of data ?? []) {
      await logActivity({
        actor: user, clientId: item.client_id,
        entityType: 'content_item', entityId: item.id,
        action: 'created', newValue: item.title,
        // an ad-hoc creation records WHY it skipped the shoot gate
        ...(item.batch_id ? {} : adhocReason ? { detail: `ad-hoc: ${adhocReason.slice(0, 300)}` } : {}),
      })
      announceItemChange({ item_id: item.id, client_id: item.client_id, status: item.status, kind: 'created' })
      // the handoff: an item created FOR an editor emails them the job
      notifyJobAssigned(user, item)
    }
    return NextResponse.json(data, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
