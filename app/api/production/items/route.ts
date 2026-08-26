import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireSignedIn, requireRole, authzErrorResponse } from '../../../lib/authz'
import { canCreateItemsUnder, sanitisePlannedDeliverables, type BatchStatus } from '../../../lib/batch-brief-core'
import { announceBatchChange } from '../../../lib/production-live'
import { isValidOwner, resolveKindForWrite, type WorkKind } from '../../../lib/work-kinds-core'
import { accessibleClientIds, assertUuid } from '../../../lib/production-access'
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
      .select('*, clients(name), batches(title, status, planned_deliverables), work_kinds(name, slug, color, uses_media)')
      .order('updated_at', { ascending: false })
      .limit(500)

    const clientIds = await accessibleClientIds(user)
    if (clientIds !== null) {
      if (user.role === 'client') {
        if (clientIds.length === 0) return NextResponse.json([])
        q = q.in('client_id', clientIds)
      } else {
        // ASSIGNMENT grants visibility: whoever holds the job — as its owner
        // or as one of the people handed its scheduling — sees it, whether or
        // not they're assigned the whole client. `cs` is jsonb containment;
        // scheduler_ids is a jsonb array of user ids.
        const me = assertUuid(user.id)
        const assigned = `owner_id.eq.${me},scheduler_ids.cs.["${me}"]`
        q = clientIds.length === 0
          ? q.or(assigned)
          : q.or(`client_id.in.(${clientIds.map(assertUuid).join(',')}),${assigned}`)
      }
    }
    if (user.role === 'scheduler') {
      // a scheduler OWNING a job (they can be assigned work now) must see it
      // at any status — the status gate is for other people's items
      q = q.or(`status.in.(${SCHEDULER_STATUSES.join(',')}),owner_id.eq.${assertUuid(user.id)}`)
    }
    if (clientFilter) q = q.eq('client_id', clientFilter)
    if (statusFilter && (ITEM_STATUSES as readonly string[]).includes(statusFilter)) {
      q = q.eq('status', statusFilter)
    }
    if (batchFilter) q = q.eq('batch_id', batchFilter)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    // a scheduler sees an unclaimed approved item (anyone can pick it up) or
    // one explicitly handed to them — never someone else's private handoff.
    // 'Hand to a scheduler' notified specific people but never actually
    // restricted the queue until now.
    const scoped = user.role === 'scheduler'
      ? (data ?? []).filter(r => {
          // a shoot BRIEF is never scheduling work — booking a shoot is an
          // account manager's call. Excluding it in the two scheduler pages
          // left it one new surface away from reappearing; the API is the
          // place that guarantees it. Owning one is the only way to see it.
          const slug = (r.work_kinds as { slug?: string } | null)?.slug ?? ''
          if (r.owner_id === user.id) return true
          if (slug === 'shoot_brief') return false
          const ids = Array.isArray(r.scheduler_ids) ? r.scheduler_ids as string[] : []
          return ids.length === 0 || ids.includes(user.id)
        })
      : (data ?? [])

    if (user.role === 'client') {
      return NextResponse.json(
        (data ?? []).map(r => ({ ...r, status_label: CLIENT_LABELS[r.status as ItemStatus] })),
      )
    }

    // "someone is waiting on YOU here" — an unresolved comment tagged to the
    // viewer. One query for the whole list; best-effort, because a missing
    // badge is a smaller failure than a board that won't load.
    let rows: Record<string, unknown>[] = scoped
    try {
      const { data: tagged, error: tagErr } = await supabase
        .from('item_comments')
        .select('item_id')
        .eq('assigned_to', user.id)
        .eq('resolved', false)
      if (tagErr) throw new Error(tagErr.message)
      const waiting = new Set((tagged ?? []).map(t => t.item_id as string))
      rows = rows.map(r => ({ ...r, my_open_task: waiting.has(r.id as string) }))
    } catch {
      // leave the annotation off rather than fail the list
    }
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

    // work kinds: resolve/validate once per request
    const { data: kindRows } = await supabase.from('work_kinds').select('*')
    const kinds = (kindRows ?? []) as WorkKind[]

    // open assignment: anyone active on the team can carry a task — validate
    // every named owner in one query, never trust a raw uuid
    const ownerIds = [...new Set(items.map((it: { owner_id?: string }) => it.owner_id).filter(Boolean))] as string[]
    const { data: ownerRows } = ownerIds.length
      ? await supabase.from('team_users').select('id, role, active_status').in('id', ownerIds)
      : { data: [] }
    const ownerById = new Map((ownerRows ?? []).map(o => [o.id as string, o]))
    for (const oid of ownerIds) {
      if (!isValidOwner(ownerById.get(oid) ?? null)) {
        return NextResponse.json({ error: 'owner_id must be an active team member' }, { status: 400 })
      }
    }
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
      // the kind decides WHICH gate applies, so it resolves first: a shoot
      // BRIEF is the exception that may start from nothing — running the
      // produced-item gate before knowing the kind rejected every brief
      const kind = resolveKindForWrite(kinds, it.work_kind_id)
      if (!kind.ok) return NextResponse.json({ error: kind.reason }, { status: 400 })
      const kindSlug = kinds.find(k => k.id === kind.id)?.slug ?? null
      // research / strategy / copy: nothing to shoot, nothing to post — the
      // shoot gate is about assets and does not apply
      const isInternal = kindSlug !== 'shoot_brief' && kinds.find(k => k.id === kind.id)?.uses_media === false

      if (it.batch_id) {
        const batch = batchById.get(it.batch_id)
        if (!batch) return NextResponse.json({ error: 'That shoot no longer exists' }, { status: 400 })
        if (batch.client_id !== it.client_id) {
          return NextResponse.json({ error: "That shoot belongs to a different client" }, { status: 403 })
        }
      }
      if (kindSlug !== 'shoot_brief' && !isInternal) {
        const batchStatus = it.batch_id
          ? ((batchById.get(it.batch_id)?.status ?? null) as BatchStatus | null)
          : null
        if (it.batch_id ? !canCreateItemsUnder(batchStatus, user.role) : !canCreateItemsUnder(null, user.role, { reason: adhocReason })) {
          return NextResponse.json(
            { error: 'Content items need a locked shoot. Lock the shoot date on its brief first.' },
            { status: 422 },
          )
        }
      }

      let briefBatchId: string | null = null
      if (kindSlug === 'shoot_brief') {
        // a brief task IS how a shoot begins: it creates its shoot with it
        // (or attaches to one still in planning), and there is exactly one
        // brief per shoot — the partial unique index enforces it
        if (!canCreateItemsUnder(
          it.batch_id ? ((batchById.get(it.batch_id)?.status ?? null) as BatchStatus | null) : null,
          user.role, undefined, 'shoot_brief',
        )) {
          return NextResponse.json(
            { error: 'Shoot briefs are created by account managers, on a shoot still in planning' },
            { status: 403 },
          )
        }
        if (it.batch_id) {
          briefBatchId = it.batch_id
        } else {
          const { data: newBatch, error: bErr } = await supabase.from('batches').insert({
            client_id: it.client_id,
            title: String(it.title).slice(0, 120),
            shoot_date: it.due_date ?? null,
            planned_deliverables: sanitisePlannedDeliverables(it.planned_deliverables),
            owner_id: it.owner_id ?? user.id,
          }).select('id, status').single()
          if (bErr) throw new Error(bErr.message)
          briefBatchId = newBatch.id
          announceBatchChange({ batch_id: newBatch.id, client_id: it.client_id, status: newBatch.status ?? 'brief', kind: 'created' })
        }
      }

      rows.push({
        work_kind_id: kind.id,
        ...(kindSlug === 'shoot_brief'
          ? {
              batch_id: briefBatchId,
              content_type: 'other',
              brief_url: it.brief_url ? String(it.brief_url).trim().slice(0, 2000) : null,
            }
          : {}),
        client_id: it.client_id,
        batch_id: kindSlug === 'shoot_brief' ? briefBatchId : isInternal ? null : (it.batch_id ?? null),
        title: String(it.title),
        content_type: kindSlug === 'shoot_brief' || isInternal ? 'other' : (it.content_type ?? 'reel'),
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
    if (error) {
      if (/content_items_one_brief_per_batch_uidx/.test(error.message)) {
        return NextResponse.json({ error: 'This shoot already has a brief task' }, { status: 409 })
      }
      throw new Error(error.message)
    }
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
