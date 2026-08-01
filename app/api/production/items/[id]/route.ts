import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { loadItemForUser, shapeItemDetail } from '../../../../lib/production-access'
import { logActivity } from '../../../../lib/workflow'

/** Item detail — versions, comments, schedule — shaped per role. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('client')
    const { id } = await params
    const item = await loadItemForUser(user, id)

    const [versionsRes, commentsRes, scheduleRes, clientRes] = await Promise.all([
      supabase.from('asset_versions').select('*').eq('item_id', id).order('version_number', { ascending: false }),
      supabase.from('item_comments').select('*').eq('item_id', id).order('created_at', { ascending: true }),
      supabase.from('schedule_entries').select('*').eq('item_id', id),
      supabase.from('clients').select('name').eq('id', item.client_id).maybeSingle(),
    ])

    const shaped = shapeItemDetail(user, item, versionsRes.data ?? [], commentsRes.data ?? [])
    return NextResponse.json({
      ...shaped,
      client_name: clientRes.data?.name ?? null,
      schedule: scheduleRes.data ?? [],
      viewer_role: user.role,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Edit item fields. AM+ (editors edit via versions/comments, not metadata). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('account_manager')
    const { id } = await params
    await loadItemForUser(user, id)
    const body = await req.json()

    const allowed = ['title', 'content_type', 'platform_targets', 'due_date', 'priority', 'caption', 'owner_id', 'client_approval_required', 'batch_id'] as const
    const patch: Record<string, unknown> = {}
    for (const key of allowed) if (key in body) patch[key] = body[key]
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No editable fields in request' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('content_items').update(patch).eq('id', id).select().single()
    if (error) throw new Error(error.message)
    await logActivity({
      actor: user, clientId: data.client_id,
      entityType: 'content_item', entityId: id,
      action: 'updated', detail: Object.keys(patch).join(', '),
    })
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
