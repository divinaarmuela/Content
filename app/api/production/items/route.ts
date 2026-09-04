import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { TeamUserClient } from '@/lib/db-types'
import type {
  AssetVersion, Batch, ContentItem, DeliverableGroup, TeamUser, WorkflowActivity,
  WorkKind as WorkKindRow,
} from '@/lib/db-types'
import { requireSignedIn, requireRole, authzErrorResponse } from '../../../lib/authz'
import { canCreateItemsUnder, sanitisePlannedDeliverables, type BatchStatus } from '../../../lib/batch-brief-core'
import { announceBatchChange } from '../../../lib/production-live'
import { isValidOwner, resolveKindForWrite, type WorkKind } from '../../../lib/work-kinds-core'
import { taskExemptFromClientScope } from '../../../lib/item-edit-core'
import {
  accessibleClientIds, canOpenBatch, openTaggedIds,
  taggedBatchIds, taggedItemIds,
} from '../../../lib/production-access'
import { scopeContextOf, visibleItems, type ScopeViewer } from '../../../lib/scope-client'
import { logActivity, notifyJobAssigned, sanitiseRawAssets } from '../../../lib/workflow'
import { announceItemChange } from '../../../lib/production-live'
import { onItemsCreated } from '../../../lib/gdrive-hooks'
import { takeClaimLock, releaseClaimLock, briefLockKey } from '../../../lib/claim-lock'
import { CLIENT_LABELS, ITEM_STATUSES, type ItemStatus } from '../../../lib/workflow-core'
import { slidesOf } from '../../../lib/version-files-core'

/** List items, role-scoped. Filters: client_id, status, batch_id. */
export async function GET(req: Request) {
  return withRequestCache(async () => {
  const t0 = Date.now()
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

    // ONE scoping predicate, and it is `visibleItems` (app/lib/scope-client.ts)
    // — the same function the live boards scope with. It used to be restated
    // here, line for line, kept honest only by a test comparing the two; a
    // rule that has to be written twice is a rule that will one day be
    // written differently. The route now READS what the rule needs and calls
    // it. Everything server-only stays here: auth, the joins, the
    // annotations. `visibleItems` imports nothing server-side.
    const viewer: ScopeViewer = {
      id: user.id,
      role: user.role,
      client_id: (user as { client_id?: string | null }).client_id ?? null,
    }
    // the same tables the boards subscribe to (see useLiveWork.ts), read once
    // inside this request's cache
    const [assignments, batches, workKinds, itemTags, batchTags] = await Promise.all([
      user.role === 'super_admin' || user.role === 'client'
        ? Promise.resolve([] as TeamUserClient[])
        : table<TeamUserClient>('team_user_clients').list({ by: { team_user_id: user.id } }),
      user.role === 'client' ? Promise.resolve([] as Batch[]) : table<Batch>('batches').list({ limit: 2000 }),
      table<WorkKindRow>('work_kinds').list(),
      taggedItemIds(user),
      taggedBatchIds(user),
    ])
    if (user.role === 'client' && !viewer.client_id) return NextResponse.json([])

    const rows0 = await table<ContentItem>('content_items').list({
      by: clientFilter ? { client_id: clientFilter } : undefined,
      where: r => {
        if (statusFilter && (ITEM_STATUSES as readonly string[]).includes(statusFilter)
          && r.status !== statusFilter) return false
        if (batchFilter && r.batch_id !== batchFilter) return false
        return true
      },
      orderBy: [['updated_at', 'desc']],
    })
    // scope FIRST, cap second — a 500-row cap taken before scoping would hand
    // a person the first 500 of everybody's work and then show them their
    // share of it
    const visible = visibleItems(
      viewer,
      rows0 as unknown as (ContentItem & { work_kinds?: null })[],
      assignments,
      // the same assembly the boards and the Schedule page use — four grants
      // that have to travel together or the three surfaces scope differently
      scopeContextOf({
        viewer,
        batches,
        taggedItemIds: itemTags,
        taggedBatchIds: batchTags,
        workKinds: workKinds as unknown as { id: string; slug: string }[],
      }),
    ).slice(0, 500)

    // clients.timezone rides along: every row that prints a posting time has
    // to print it in the audience's zone, not the reader's
    const data = await attachOne(
      await attachOne(
        await attachOne(visible as unknown as ContentItem[], 'client_id', 'clients', ['name', 'timezone']),
        'batch_id', 'batches', ['title', 'status', 'planned_deliverables'],
      ),
      'work_kind_id', 'work_kinds', ['name', 'slug', 'color', 'uses_media'],
    )
    const tMain = Date.now()
    const scoped = data

    if (user.role === 'client') {
      console.log(`[items] GET ${Date.now() - t0}ms (main ${tMain - t0}, annot 0)`)
      return NextResponse.json(
        data.map(r => ({ ...r, status_label: CLIENT_LABELS[r.status as ItemStatus] })),
      )
    }

    // ── The annotations, all at once ──
    // Three best-effort passes decorate the list: "someone is waiting on YOU
    // here" (an unresolved comment tagged to the viewer — the same answer the
    // Overview's "Waiting on you" reads), the created-by / approved-by
    // credits the cards show, and how many slides the latest version holds
    // (a scheduler picking up a carousel needs to know it IS one — "v3" said
    // nothing about whether the post is one card or six, and six is a
    // different job). Awaited in sequence they added four DB round-trips to
    // every board load; they are independent, so they run in ONE Promise.all.
    // Each keeps its own try/catch: a missing badge, credit or count is a
    // smaller failure than a board that will not load, and one slow
    // annotation must never block the list.
    let rows: Record<string, unknown>[] = scoped as unknown as Record<string, unknown>[]
    const ids = rows.map(r => r.id as string).slice(0, 300)
    const [waiting, credits, slideCounts] = await Promise.all([
      (async () => {
        try {
          return new Set((await openTaggedIds(user)).items)
        } catch {
          return null // leave the annotation off rather than fail the list
        }
      })(),
      (async () => {
        try {
          if (ids.length === 0) return null
          const acts = await table<WorkflowActivity>('workflow_activity').list({
            where: a => a.entity_type === 'content_item'
              && ids.includes(a.entity_id)
              && ['created', 'status_change'].includes(a.action),
            orderBy: [['created_at', 'asc']],
            limit: 3000,
          })
          const actors = await table<TeamUser>('team_users').list()
          const nameOf = new Map(actors.map(a => [a.id, a.name || a.email]))
          const byItem = new Map<string, { created_by: string | null; approved_by: string | null }>()
          for (const a of acts) {
            const key = a.entity_id
            const entry = byItem.get(key) ?? { created_by: null, approved_by: null }
            const who = a.actor_id ? nameOf.get(a.actor_id) ?? null : null
            if (a.action === 'created') entry.created_by = who
            // rows arrive oldest-first, so the last approval wins
            else if (a.new_value === 'approved_for_scheduling') entry.approved_by = who
            byItem.set(key, entry)
          }
          return byItem
        } catch {
          return null // no credits rather than no board
        }
      })(),
      (async () => {
        try {
          if (ids.length === 0) return null
          // ONE asset_versions read serves the slide count; anything else that
          // needs the latest version derives from the same rows in memory
          const versions = await table<AssetVersion>('asset_versions').list({
            where: v => ids.includes(v.item_id),
            orderBy: [['version_number', 'desc']],
            limit: 2000,
          })
          // rows arrive newest-first, so the first seen for an item is its latest
          const countByItem = new Map<string, number>()
          for (const v of versions) {
            const key = v.item_id
            if (!countByItem.has(key)) countByItem.set(key, slidesOf(v).length)
          }
          return countByItem
        } catch {
          return null // leave the count off rather than fail the list
        }
      })(),
    ])
    rows = rows.map(r => ({
      ...r,
      ...(waiting ? { my_open_task: waiting.has(r.id as string) } : {}),
      ...(credits ? credits.get(r.id as string) ?? {} : {}),
      ...(slideCounts ? { slide_count: slideCounts.get(r.id as string) ?? 0 } : {}),
    }))
    console.log(`[items] GET ${Date.now() - t0}ms (main ${tMain - t0}, annot ${Date.now() - tMain})`)
    return NextResponse.json(rows)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Create one or many items (batch upload of a shoot). Any team role — the
 *  'scheduler' floor is the lowest team bar: it admits every team role and no
 *  client. What each role may create is the shoot gate's business below. */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
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
    const kinds = await table<WorkKindRow>('work_kinds').list() as unknown as WorkKind[]

    // open assignment: anyone active on the team can carry a task — validate
    // every named owner in one query, never trust a raw uuid
    const ownerIds = [...new Set(items.map((it: { owner_id?: string }) => it.owner_id).filter(Boolean))] as string[]
    const ownerRows = ownerIds.length
      ? await table<TeamUser>('team_users').list({ where: o => ownerIds.includes(o.id) })
      : []
    const ownerById = new Map(ownerRows.map(o => [o.id, o]))
    for (const oid of ownerIds) {
      if (!isValidOwner(ownerById.get(oid) ?? null)) {
        return NextResponse.json({ error: 'owner_id must be an active team member' }, { status: 400 })
      }
    }
    const batchIds = [...new Set(items.map((it: { batch_id?: string }) => it.batch_id).filter(Boolean))] as string[]
    const batchRows = batchIds.length
      ? await table<Batch>('batches').list({ where: b => batchIds.includes(b.id) })
      : []
    const batchById = new Map(batchRows.map(b => [b.id, b]))

    // quota groups: a piece may land inside a deliverable_groups row — the
    // "Reels · 2 of 5" card. Validate every named group once.
    const groupIds = [...new Set(items.map((it: { group_id?: string }) => it.group_id).filter(Boolean))] as string[]
    const groupRows = groupIds.length
      ? await table<DeliverableGroup>('deliverable_groups').list({ where: gr => groupIds.includes(gr.id) })
      : []
    const groupById = new Map(groupRows.map(gr => [gr.id, gr]))

    const rows: Record<string, unknown>[] = []
    // Every shoot lock this request has taken. A lock is only worth holding
    // while there is a plan behind it, so ANY exit that does not create one —
    // a later item failing validation, an insert throwing, an unexpected
    // error — hands it straight back rather than leaving the shoot
    // unplannable until the lock ages out.
    const heldBriefLocks: { key: string; holder: string }[] = []
    let planned = false
    const releaseHeld = async (keep: ReadonlySet<string> = new Set()) => {
      for (const l of heldBriefLocks) {
        if (keep.has(l.holder)) continue
        await releaseClaimLock(l.key, l.holder).catch(() => {})
      }
    }
    try {
    for (const it of items) {
      if (!it.client_id || !it.title) {
        return NextResponse.json({ error: 'client_id and title are required on every item' }, { status: 400 })
      }
      // the kind decides WHICH gate applies, so it resolves first: a shoot
      // BRIEF is the exception that may start from nothing — running the
      // produced-item gate before knowing the kind rejected every brief
      const kind = resolveKindForWrite(kinds, it.work_kind_id)
      if (!kind.ok) return NextResponse.json({ error: kind.reason }, { status: 400 })
      const kindRow = kinds.find(k => k.id === kind.id) ?? null
      const kindSlug = kindRow?.slug ?? null
      // research / strategy / copy: nothing to shoot, nothing to post — the
      // shoot gate is about assets and does not apply
      const isInternal = kindSlug !== 'shoot_brief' && kindRow?.uses_media === false
      if (
        clientIds !== null && !clientIds.includes(it.client_id)
        // a TASK is internal work, not client-confidential — any team member
        // may raise one for any client (the owner's rule). Shoots, plans and
        // assets keep the scoped list: they carry unreleased material.
        && !taskExemptFromClientScope(kindRow)
      ) {
        // off the client team, but holding a job on the shoot (the brief handed
        // to a manager) — the shoot opens for them, so its items may be made
        const heldShoot = it.batch_id ? batchById.get(it.batch_id) : null
        const viaShoot = heldShoot
          ? await canOpenBatch(user, heldShoot as { id: string; client_id: string; owner_id?: string | null })
          : false
        if (!viaShoot) {
          return NextResponse.json({ error: 'You are not assigned to that client' }, { status: 403 })
        }
      }

      // a named group must exist and belong to the same client — and joining
      // one is itself the recorded reason the piece may exist without a shoot:
      // the promise was logged when the group was made
      const group = it.group_id ? groupById.get(String(it.group_id)) : null
      if (it.group_id && !group) {
        return NextResponse.json({ error: 'That group no longer exists' }, { status: 400 })
      }
      if (group && group.client_id !== it.client_id) {
        return NextResponse.json({ error: 'That group belongs to a different client' }, { status: 403 })
      }
      const itemAdhocReason = adhocReason || (group ? `piece of the planned group "${group.title}"` : '')

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
        if (it.batch_id ? !canCreateItemsUnder(batchStatus, user.role) : !canCreateItemsUnder(null, user.role, { reason: itemAdhocReason })) {
          return NextResponse.json(
            { error: 'Items need a booked shoot. Book the shoot on its page first — or say where the footage is from.' },
            { status: 422 },
          )
        }
      }

      let briefBatchId: string | null = null
      // minted before the write so the shoot's lock can name the plan it holds
      let briefItemId: string | null = null
      if (kindSlug === 'shoot_brief') {
        // a brief task IS how a shoot begins: it creates its shoot with it
        // (or attaches to one still in planning), and there is exactly one
        // brief per shoot — the partial unique index enforces it
        if (!canCreateItemsUnder(
          it.batch_id ? ((batchById.get(it.batch_id)?.status ?? null) as BatchStatus | null) : null,
          user.role, undefined, 'shoot_brief',
        )) {
          return NextResponse.json(
            { error: 'A shoot plan can only be raised on a shoot that is not finished' },
            { status: 403 },
          )
        }
        if (it.batch_id) {
          // Exactly ONE plan per shoot. The partial unique index that enforced
          // it has no counterpart here, and "does this shoot already have
          // one?" spans rows, so it is a lock row on the shoot — claimed, not
          // checked. That covers both races at once: two requests arriving
          // together, and two brief items inside one body (nothing is written
          // until the loop below is done, so a read could not see either).
          const briefKindIds = new Set(kinds.filter(k => k.slug === 'shoot_brief').map(k => k.id))
          briefItemId = crypto.randomUUID()
          const gate = await takeClaimLock(briefLockKey(String(it.batch_id)), briefItemId, async holder => {
            const held = await table<ContentItem>('content_items').get(holder)
            return !!held && held.work_kind_id != null && briefKindIds.has(held.work_kind_id)
          })
          // …and plans written before this lock existed, which nothing holds
          const already = gate.ok
            ? await table<ContentItem>('content_items').list({ by: { batch_id: it.batch_id } })
            : []
          if (!gate.ok || already.some(r => r.work_kind_id != null && briefKindIds.has(r.work_kind_id))) {
            if (gate.ok) await releaseClaimLock(briefLockKey(String(it.batch_id)), briefItemId).catch(() => {})
            return NextResponse.json({ error: 'This shoot already has a shoot plan' }, { status: 409 })
          }
          heldBriefLocks.push({ key: briefLockKey(String(it.batch_id)), holder: briefItemId })
          briefBatchId = it.batch_id
        } else {
          const newBatch = await table('batches').insert({
            client_id: it.client_id,
            title: String(it.title).slice(0, 120),
            shoot_date: it.due_date ?? null,
            planned_deliverables: sanitisePlannedDeliverables(it.planned_deliverables),
            owner_id: it.owner_id ?? user.id,
            // Postgres defaulted the status; a shoot without one matches no
            // gate in batch-brief-core
            status: 'brief',
          })
          briefBatchId = String(newBatch.id)
          announceBatchChange({ batch_id: briefBatchId, client_id: it.client_id, status: String(newBatch.status ?? 'brief'), kind: 'created' })
        }
      }

      rows.push({
        work_kind_id: kind.id,
        ...(kindSlug === 'shoot_brief'
          ? {
              ...(briefItemId ? { id: briefItemId } : {}),
              batch_id: briefBatchId,
              content_type: 'other',
              brief_url: it.brief_url ? String(it.brief_url).trim().slice(0, 2000) : null,
            }
          : {}),
        client_id: it.client_id,
        // a grouped piece rides its group: the card carries the shoot, so the
        // piece inherits it when the caller named none
        ...(group ? { group_id: group.id } : {}),
        batch_id: kindSlug === 'shoot_brief' ? briefBatchId : isInternal ? null : (it.batch_id ?? group?.batch_id ?? null),
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
        // the caller decides; an internal task defaults to NO client step
        // (its "Approve — done" is the whole point), everything else to yes
        client_approval_required: typeof it.client_approval_required === 'boolean'
          ? it.client_approval_required
          : !isInternal,
        // both were Postgres column defaults; an item that reads back without
        // a status is on no board at all
        status: 'draft_uploaded',
        current_version_number: 0,
      })
    }

    // Each row is its own write, so a batch upload can half-succeed. Saying
    // "500" over eight items that were created and two that were not is the
    // worst answer available — the caller is told exactly what landed.
    const settled = await Promise.allSettled(
      rows.map(r => table('content_items').insert(r) as Promise<unknown> as Promise<ContentItem>),
    )
    const data: ContentItem[] = []
    const failed: { index: number; title: string; error: string }[] = []
    settled.forEach((res, i) => {
      if (res.status === 'fulfilled') data.push(res.value)
      else {
        failed.push({
          index: i,
          title: String(rows[i].title),
          error: res.reason instanceof Error ? res.reason.message : String(res.reason),
        })
      }
    })
    for (const item of data) {
      await logActivity({
        actor: user, clientId: item.client_id,
        entityType: 'content_item', entityId: item.id,
        action: 'created', newValue: item.title,
        // an ad-hoc creation records WHY it skipped the shoot gate
        ...(item.batch_id ? {} : adhocReason ? { detail: `ad-hoc: ${adhocReason.slice(0, 300)}` } : {}),
      })
      announceItemChange({ item_id: item.id, client_id: item.client_id, status: item.status, kind: 'created' })
      // the handoff: an item created FOR an editor emails them the job
      notifyJobAssigned(user, item as unknown as Parameters<typeof notifyJobAssigned>[1])
    }
    // a folder per deliverable, and the master link prefilled from it — in
    // the background, so a slow Drive never delays a batch upload
    onItemsCreated(data)
    // a plan whose insert did not land holds nothing; every other lock is
    // now backed by a real row and stays
    planned = true
    await releaseHeld(new Set(data.map(d => d.id)))
    // 207: some of this landed and some did not, and the body says which
    if (failed.length > 0) return NextResponse.json({ created: data, failed }, { status: 207 })
    return NextResponse.json(data, { status: 201 })
    } finally {
      if (!planned) await releaseHeld()
    }
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
