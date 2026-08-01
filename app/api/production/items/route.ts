import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { accessibleClientIds } from '../../../lib/production-access'
import { logActivity } from '../../../lib/workflow'
import { SCHEDULER_STATUSES, CLIENT_LABELS, ITEM_STATUSES, type ItemStatus } from '../../../lib/workflow-core'

/** List items, role-scoped. Filters: client_id, status, batch_id. */
export async function GET(req: Request) {
  try {
    const user = await requireRole('client') // any signed-in role; scoping below
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
      if (clientIds.length === 0) return NextResponse.json([])
      q = q.in('client_id', clientIds)
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
    const rows = []
    for (const it of items) {
      if (!it.client_id || !it.title) {
        return NextResponse.json({ error: 'client_id and title are required on every item' }, { status: 400 })
      }
      if (clientIds !== null && !clientIds.includes(it.client_id)) {
        return NextResponse.json({ error: 'You are not assigned to that client' }, { status: 403 })
      }
      rows.push({
        client_id: it.client_id,
        batch_id: it.batch_id ?? null,
        title: String(it.title),
        content_type: it.content_type ?? 'reel',
        platform_targets: Array.isArray(it.platform_targets) ? it.platform_targets : [],
        owner_id: it.owner_id ?? (user.role === 'editor' ? user.id : null),
        due_date: it.due_date ?? null,
        priority: it.priority ?? 'normal',
        caption: it.caption ?? null,
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
      })
    }
    return NextResponse.json(data, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
