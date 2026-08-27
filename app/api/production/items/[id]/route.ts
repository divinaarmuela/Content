import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireSignedIn, requireRole, authzErrorResponse } from '../../../../lib/authz'
import { announceItemChange } from '../../../../lib/production-live'
import { loadItemForUser, shapeItemDetail } from '../../../../lib/production-access'
import { logActivity, notifyJobAssigned, sanitiseRawAssets } from '../../../../lib/workflow'
import { actingRoles } from '../../../../lib/workflow-core'
import { loadPostingContext } from '../../../../lib/production-publish'
import { DEFAULT_TZ } from '../../../../lib/timezone-core'
import {
  itemMirrorProgress, mirrorRawAssets, newRawAssets, type RawAsset,
} from '../../../../lib/gdrive-mirror'

/** Item detail — versions, comments, schedule — shaped per role. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSignedIn()
    const { id } = await params
    const item = await loadItemForUser(user, id)

    const [versionsRes, commentsRes, scheduleRes, clientRes, kindRes] = await Promise.all([
      supabase.from('asset_versions').select('*').eq('item_id', id).order('version_number', { ascending: false }),
      supabase.from('item_comments').select('*').eq('item_id', id).order('created_at', { ascending: true }),
      supabase.from('schedule_entries').select('*').eq('item_id', id),
      // the zone travels with the name: every posting time on this page is
      // read and written in the client's zone, never the browser's
      supabase.from('clients').select('name, timezone').eq('id', item.client_id).maybeSingle(),
      supabase.from('content_items')
        // concept + shot_list travel too: the brief's submit edge accepts
        // either as evidence, and the page can only pre-check what it can see
        .select('work_kinds(name, slug, color, uses_media), batches(id, title, status, planned_deliverables, concept, shot_list)')
        .eq('id', id).maybeSingle(),
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
    // the item's craft and its shoot — every surface labels itself by these
    ;(shaped as Record<string, unknown>).work_kind = kindRes.data?.work_kinds ?? null
    ;(shaped as Record<string, unknown>).batch = kindRes.data?.batches ?? null

    // the audit trail, named. A client never sees who inside the agency did
    // what — the history is an internal record, like the internal comments.
    let activity: Record<string, unknown>[] = []
    if (user.role !== 'client') {
      const { data: rows } = await supabase
        .from('workflow_activity')
        .select('id, created_at, actor_id, action, old_value, new_value, detail')
        .eq('entity_type', 'content_item')
        .eq('entity_id', id)
        .order('created_at', { ascending: false })
        .limit(50)
      const actorIds = [...new Set((rows ?? []).map(r => r.actor_id).filter(Boolean))]
      const { data: actors } = actorIds.length
        ? await supabase.from('team_users').select('id, name, email').in('id', actorIds)
        : { data: [] }
      const actorName = new Map((actors ?? []).map(a => [a.id, a.name || a.email]))
      activity = (rows ?? []).map(r => ({
        ...r, actor_name: r.actor_id ? actorName.get(r.actor_id) ?? null : null,
      }))
    }

    // who at the client would actually be emailed by a "Send to client" —
    // the confirm dialog names them rather than asking for a leap of faith
    let client_users: { name: string; email: string }[] = []
    if (user.role !== 'client') {
      const { data: cu } = await supabase.from('team_users')
        .select('name, email')
        .eq('role', 'client').eq('client_id', item.client_id).eq('active_status', true)
      client_users = (cu ?? []).map(u => ({ name: u.name || u.email, email: u.email }))
    }

    // who's who on this job — every team role reads it at a glance
    let owner_name: string | null = null
    let managers: { name: string; email: string }[] = []
    if (user.role !== 'client') {
      const [ownerRes, mgrRes] = await Promise.all([
        item.owner_id
          ? supabase.from('team_users').select('name, email').eq('id', item.owner_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from('team_user_clients')
          .select('team_users!team_user_clients_team_user_id_fkey(name, email, role, active_status)')
          .eq('client_id', item.client_id),
      ])
      owner_name = ownerRes.data?.name || ownerRes.data?.email || null
      managers = (mgrRes.data ?? [])
        .map(r => r.team_users as unknown as { name: string; email: string; role: string; active_status: boolean })
        .filter(u => u.active_status && ['account_manager', 'super_admin'].includes(u.role))
        .map(u => ({ name: u.name || u.email, email: u.email }))
    }

    // The posting card's whole state — connected accounts and the live publish
    // job — comes down with the item so the card knows what it is before
    // anybody clicks "Check channels". Clients never see the plumbing, and a
    // shoot brief has nothing to post.
    const kindSlug = (kindRes.data?.work_kinds as { slug?: string } | null)?.slug ?? null
    const usesMedia = (kindRes.data?.work_kinds as { uses_media?: boolean } | null)?.uses_media
    const posting = user.role !== 'client' && kindSlug !== 'shoot_brief' && usesMedia !== false
      ? await loadPostingContext(id, item.client_id as string)
      : null

    return NextResponse.json({
      ...shaped,
      posting,
      client_name: clientRes.data?.name ?? null,
      client_timezone: (clientRes.data?.timezone as string | null) || DEFAULT_TZ,
      owner_name,
      managers,
      client_users,
      activity,
      schedule: scheduleRes.data ?? [],
      viewer_role: user.role,
      // the pickers need to know who is looking: you are never emailed about
      // your own action, so offering yourself as a reviewer is a silent no-op
      viewer_id: user.id,
      // "Mirrored to Drive · 7 files" under the folder link. A client never
      // sees it: the job pack is internal production material, and so is the
      // fact that we keep a copy of it.
      drive_mirror: user.role === 'client' ? null : await itemMirrorProgress(
        id, (item as { raw_assets?: RawAsset[] | null }).raw_assets ?? null,
      ),
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Edit item fields. AM+ (editors edit via versions/comments, not metadata). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // metadata edits are manager work — except the CAPTION, which is the
    // scheduler's post text: they may polish it without touching anything else
    const body = await req.json()
    const keys = Object.keys(body ?? {})
    const captionOnly = keys.length === 1 && keys[0] === 'caption'
    // the BRIEF fields are the evidence a shoot brief is submitted with, and
    // the brief's own submit edge is open to its editor-owner — so an owner
    // who is not an account manager must be able to fill them in
    const briefOnly = keys.length > 0 && keys.every(k => k === 'brief_url' || k === 'brief')
    // 'scheduler' is the lowest team floor: it admits every team role and no
    // client. The per-item hat check below is the real gate.
    const user = captionOnly || briefOnly
      ? await requireRole('scheduler')
      : await requireRole('account_manager')
    const { id } = await params
    const current = await loadItemForUser(user, id)
    if (
      briefOnly
      && !['account_manager', 'super_admin'].includes(user.role)
      && !actingRoles({ id: user.id, role: user.role }, current).includes('editor')
    ) {
      return NextResponse.json({ error: 'This brief is assigned to someone else' }, { status: 403 })
    }
    // 'scheduler' as a floor admits editors — the caption IS the published post
    // text, so it belongs to whoever holds the SCHEDULING here (the hat, not
    // the title: an editor handed the item writes the post text they will
    // post) plus AM and super admin. An editor holding no scheduling hat may
    // not touch it.
    if (
      captionOnly
      && !['account_manager', 'super_admin'].includes(user.role)
      && !actingRoles({ id: user.id, role: user.role }, current).includes('scheduler')
    ) {
      return NextResponse.json({ error: 'Only the person scheduling this may edit the caption' }, { status: 403 })
    }

    const allowed = ['title', 'content_type', 'platform_targets', 'due_date', 'priority', 'caption', 'owner_id', 'client_approval_required', 'batch_id', 'raw_assets_url', 'brief', 'raw_assets', 'work_kind_id', 'brief_url'] as const
    const patch: Record<string, unknown> = {}
    for (const key of allowed) if (key in body) patch[key] = body[key]
    if ('raw_assets' in patch) patch.raw_assets = sanitiseRawAssets(patch.raw_assets)
    // what this save ADDED, decided before the write: the upload queue sends
    // the whole array back every time it appends one file, so the payload is
    // not the news — the difference is
    const addedAssets = 'raw_assets' in patch
      ? newRawAssets(
          (current as { raw_assets?: RawAsset[] | null }).raw_assets ?? null,
          patch.raw_assets as RawAsset[],
        )
      : []
    // re-assigning records who handed out the job
    if ('owner_id' in patch && patch.owner_id) {
      // anyone active on the team can carry a task — but only real, active
      // team members, never a client account or a stale id
      const { data: owner } = await supabase.from('team_users')
        .select('id, role, active_status').eq('id', patch.owner_id).maybeSingle()
      const { isValidOwner } = await import('../../../../lib/work-kinds-core')
      if (!isValidOwner(owner)) {
        return NextResponse.json({ error: 'owner_id must be an active team member' }, { status: 400 })
      }
      patch.assigned_by = user.id
    }
    if ('work_kind_id' in patch && patch.work_kind_id) {
      const { data: kind } = await supabase.from('work_kinds')
        .select('id, active').eq('id', patch.work_kind_id).maybeSingle()
      if (!kind?.active) {
        return NextResponse.json({ error: 'Pick a current work type' }, { status: 400 })
      }
    }
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
    // every new file lands in the item's Drive folder too — queued, never
    // awaited: a slow Drive must not slow a save
    if (addedAssets.length > 0) mirrorRawAssets(id, addedAssets)
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

    // publish_jobs has NO fk to content_items — cancel any queued/publishing job
    // FIRST, or the cron would publish a deleted item to the client's live account
    await supabase.from('publish_jobs')
      .update({ status: 'cancelled' })
      .eq('content_item_id', id)
      .in('status', ['queued', 'publishing'])

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
