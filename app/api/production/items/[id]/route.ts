import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireSignedIn, requireRole, authzErrorResponse } from '../../../../lib/authz'
import { announceItemChange } from '../../../../lib/production-live'
import { loadItemForUser, shapeItemDetail } from '../../../../lib/production-access'
import { logActivity, notifyJobAssigned, sanitiseRawAssets } from '../../../../lib/workflow'

/** Item detail — versions, comments, schedule — shaped per role. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSignedIn()
    const { id } = await params
    const item = await loadItemForUser(user, id)

    const [versionsRes, commentsRes, scheduleRes, clientRes] = await Promise.all([
      supabase.from('asset_versions').select('*').eq('item_id', id).order('version_number', { ascending: false }),
      supabase.from('item_comments').select('*').eq('item_id', id).order('created_at', { ascending: true }),
      supabase.from('schedule_entries').select('*').eq('item_id', id),
      supabase.from('clients').select('name').eq('id', item.client_id).maybeSingle(),
    ])

    // name the comment authors — "who said this" is half of a comment's meaning
    const authorIds = [...new Set((commentsRes.data ?? []).map(c => c.author_id).filter(Boolean))]
    const { data: authors } = authorIds.length
      ? await supabase.from('team_users').select('id, name, email').in('id', authorIds)
      : { data: [] }
    const authorName = new Map((authors ?? []).map(a => [a.id, a.name || a.email]))
    const commentsNamed = (commentsRes.data ?? []).map(c => ({
      ...c,
      author_name: c.author_id ? authorName.get(c.author_id) ?? null : null,
    }))

    const shaped = shapeItemDetail(user, item, versionsRes.data ?? [], commentsNamed)
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

    const allowed = ['title', 'content_type', 'platform_targets', 'due_date', 'priority', 'caption', 'owner_id', 'client_approval_required', 'batch_id', 'raw_assets_url', 'brief', 'raw_assets'] as const
    const patch: Record<string, unknown> = {}
    for (const key of allowed) if (key in body) patch[key] = body[key]
    if ('raw_assets' in patch) patch.raw_assets = sanitiseRawAssets(patch.raw_assets)
    // re-assigning records who handed out the job
    if ('owner_id' in patch && patch.owner_id) patch.assigned_by = user.id
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
    // (re)assignment is a handoff: email the editor their job pack
    if ('owner_id' in patch && patch.owner_id) notifyJobAssigned(user, data)
    announceItemChange({ item_id: id, client_id: data.client_id, status: data.status, kind: 'updated' })
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Delete an item and everything hanging off it. Manager+ — deleting work
 *  is a management decision, and it announces so every open board updates. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('account_manager')
    const { id } = await params
    const item = await loadItemForUser(user, id)

    for (const table of ['schedule_entries', 'item_comments', 'asset_versions', 'approvals'] as const) {
      await supabase.from(table).delete().eq('item_id', id)
    }
    const { error } = await supabase.from('content_items').delete().eq('id', id)
    if (error) throw new Error(error.message)

    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: 'deleted', oldValue: item.title,
    })
    announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'updated' })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
