import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { accessibleClientIds } from '@/app/lib/production-access'
import { schedulerIdsOf, SCHEDULER_STATUSES, type ItemStatus } from '@/app/lib/workflow-core'
import { isAsset, isBriefTask, isInternalTask } from '@/app/lib/work-pages-core'
import { TASK_DONE_STATUSES } from '@/app/lib/task-kind-core'
import { DEFAULT_TZ, dayKeyInZone, safeZone } from '@/app/lib/timezone-core'
import {
  AGENCY_TZ, EMPTY_THROUGHPUT, groupByStatusWord, holds, isFinished, sparkline, splitDue,
  summariseThroughput, weekRangeInZone,
  type ActivityRow, type HeldItem, type TeamActivityRow,
} from '@/app/lib/team-activity-core'
import type { Role } from '@/app/lib/identity-core'

/**
 * The data behind /dashboard/team/activity — who holds what, and what is late.
 *
 * NOTE ON THE PATH. `/api/team/activity` is already the Asana rollup that
 * /dashboard/activity runs on; this is the PRODUCTION workload, read from the
 * app's own tables, so it sits one level in rather than taking a name that is
 * in use.
 *
 * Authorization is the point of the route, not decoration:
 *
 *   • a super admin sees the whole team;
 *   • an account manager sees the people who hold work on THEIR clients, plus
 *     themselves. Not "every account manager's team" — the clients they are
 *     assigned to are the only ones they can explain, and a workload row for
 *     someone whose items they may not open is a row they cannot act on.
 *
 * The filter runs here, before any data leaves. Nobody below account_manager
 * reaches it at all; the page is grantable, and a grant opens the page for a
 * person whose role already satisfies this floor.
 */

export const dynamic = 'force-dynamic'

type ItemRow = {
  id: string
  title: string
  status: ItemStatus
  owner_id: string | null
  scheduler_ids: unknown
  due_date: string | null
  client_id: string
  updated_at: string
  clients: { name: string; timezone: string | null } | null
  work_kinds: { slug: string | null; uses_media: boolean | null } | null
}

type PersonRow = {
  id: string
  name: string
  email: string
  role: Role
  timezone: string
}

export async function GET(req: Request) {
  try {
    const me = await requireRole('account_manager')
    const isAdmin = me.role === 'super_admin'
    const url = new URL(req.url)
    const roleFilter = url.searchParams.get('role')
    const clientFilter = url.searchParams.get('client')
    const now = new Date()

    const clientIds = await accessibleClientIds(me)

    // ─── The work ───────────────────────────────────────────────────────
    // 'published' is dropped at the database rather than in shaping: it is the
    // one status that accumulates for ever, and a board query that pages
    // through five years of live posts to show this week is a bug waiting for
    // the account to get busy. Everything still open reaches the shaping,
    // which decides per overlay what "finished" means.
    let itemsQ = supabase
      .from('content_items')
      .select('id, title, status, owner_id, scheduler_ids, due_date, client_id, updated_at, clients(name, timezone), work_kinds(slug, uses_media)')
      .neq('status', 'published')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(1000)
    if (clientIds !== null) {
      itemsQ = clientIds.length === 0
        ? itemsQ.eq('client_id', '00000000-0000-0000-0000-000000000000')
        : itemsQ.in('client_id', clientIds)
    }
    const { data: itemRows, error: itemsErr } = await itemsQ
    // a fresh environment has no production tables yet — the page should say
    // "nothing here", not fail
    const allItems: ItemRow[] = itemsErr ? [] : ((itemRows ?? []) as unknown as ItemRow[])
    const items = clientFilter ? allItems.filter(i => i.client_id === clientFilter) : allItems

    // ─── The shoots ─────────────────────────────────────────────────────
    // A wrapped shoot is history; the other three states are somebody's job.
    let batchQ = supabase
      .from('batches')
      .select('id, title, owner_id, client_id, shoot_date, status')
      .neq('status', 'wrapped')
      .limit(500)
    if (clientIds !== null && clientIds.length > 0) batchQ = batchQ.in('client_id', clientIds)
    if (clientIds !== null && clientIds.length === 0) batchQ = batchQ.eq('client_id', '00000000-0000-0000-0000-000000000000')
    const { data: batchRows } = await batchQ
    const batches = ((batchRows ?? []) as { id: string; owner_id: string | null; client_id: string }[])
      .filter(b => !clientFilter || b.client_id === clientFilter)

    // ─── Who this viewer may see ────────────────────────────────────────
    // For a super admin: everyone. For an account manager: whoever holds work
    // on their clients — plus themselves, because a manager holding three
    // overdue briefs is exactly who this page exists to show.
    const heldBy = new Set<string>([me.id])
    for (const i of allItems) {
      if (i.owner_id) heldBy.add(i.owner_id)
      for (const s of schedulerIdsOf(i)) heldBy.add(s)
    }
    for (const b of batches) if (b.owner_id) heldBy.add(b.owner_id)

    let peopleQ = supabase
      .from('team_users')
      .select('id, name, email, role, timezone')
      .eq('active_status', true)
      .neq('role', 'client')
      .order('name')
    if (!isAdmin) peopleQ = peopleQ.in('id', [...heldBy])
    if (roleFilter) peopleQ = peopleQ.eq('role', roleFilter)
    const { data: peopleRows, error: peopleErr } = await peopleQ
    if (peopleErr) throw new Error(peopleErr.message)
    const people = ((peopleRows ?? []) as PersonRow[])
    const peopleIds = people.map(p => p.id)

    // ─── Open tagged comments ───────────────────────────────────────────
    // Being tagged in a comment is a hand-off with no status change behind it,
    // so it is invisible on every board — and it is the thing people most
    // often forget they are holding.
    const visibleItemIds = new Set(items.map(i => i.id))
    const { data: commentRows } = peopleIds.length
      ? await supabase
          .from('item_comments')
          .select('id, item_id, assigned_to')
          .eq('resolved', false)
          .in('assigned_to', peopleIds)
          .limit(1000)
      : { data: [] as { id: string; item_id: string; assigned_to: string | null }[] }
    const openComments = new Map<string, number>()
    for (const c of (commentRows ?? []) as { item_id: string; assigned_to: string | null }[]) {
      if (!c.assigned_to || !visibleItemIds.has(c.item_id)) continue
      openComments.set(c.assigned_to, (openComments.get(c.assigned_to) ?? 0) + 1)
    }

    // ─── The trail ──────────────────────────────────────────────────────
    // One window covers both readings: the sparkline needs 14 days, and the
    // agency week always starts inside those 14 days, so the throughput is a
    // filter over the same rows rather than a second round trip.
    const week = weekRangeInZone(now, AGENCY_TZ)
    const sparkFrom = new Date(now.getTime() - 14 * 86_400_000).toISOString()
    const windowFrom = sparkFrom < week.startIso ? sparkFrom : week.startIso
    const { data: actRows } = peopleIds.length
      ? await supabase
          .from('workflow_activity')
          .select('actor_id, created_at, action, new_value')
          .in('actor_id', peopleIds)
          .gte('created_at', windowFrom)
          .order('created_at', { ascending: false })
          .limit(5000)
      : { data: [] as { actor_id: string | null; created_at: string; action: string; new_value: string | null }[] }
    const byActor = new Map<string, ActivityRow[]>()
    for (const r of (actRows ?? []) as { actor_id: string | null; created_at: string; action: string; new_value: string | null }[]) {
      if (!r.actor_id) continue
      const list = byActor.get(r.actor_id) ?? []
      list.push({ created_at: r.created_at, action: r.action, new_value: r.new_value })
      byActor.set(r.actor_id, list)
    }

    // Someone quiet for a fortnight still has a last-active date, and "never"
    // in its place is a different (and usually wrong) claim. One extra query
    // for the quiet ones only — the busy ones are already answered.
    const quiet = peopleIds.filter(id => !byActor.has(id))
    const lastSeen = new Map<string, string>()
    if (quiet.length > 0) {
      const { data: olderRows } = await supabase
        .from('workflow_activity')
        .select('actor_id, created_at')
        .in('actor_id', quiet)
        .lt('created_at', windowFrom)
        .order('created_at', { ascending: false })
        .limit(1000)
      for (const r of (olderRows ?? []) as { actor_id: string | null; created_at: string }[]) {
        if (r.actor_id && !lastSeen.has(r.actor_id)) lastSeen.set(r.actor_id, r.created_at)
      }
    }

    // ─── Shape one row per person ───────────────────────────────────────
    const shape = (i: ItemRow): HeldItem => ({
      id: i.id,
      title: i.title,
      status: i.status,
      owner_id: i.owner_id,
      scheduler_ids: i.scheduler_ids,
      due_date: i.due_date,
      client_id: i.client_id,
      client_name: i.clients?.name ?? null,
      // Postgres nulls become absences here, once, so every scope and overlay
      // downstream reads the one shape rather than each defending itself
      work_kinds: i.work_kinds
        ? { slug: i.work_kinds.slug ?? undefined, uses_media: i.work_kinds.uses_media ?? undefined }
        : null,
    })

    const shaped = items.map(shape)
    // each client's own zone, so a due date is read on the calendar the piece
    // is going out on
    const zoneOfClient = new Map<string, string>()
    for (const i of items) zoneOfClient.set(i.client_id, safeZone(i.clients?.timezone ?? DEFAULT_TZ))

    const rows: TeamActivityRow[] = people.map(p => {
      const open = shaped.filter(i => holds(i, p.id) && !isFinished(i))

      // A due date belongs to the CLIENT's calendar — that is whose week the
      // piece is going out in — so items are bucketed in groups, one per zone,
      // and a Manila client's Monday is not forced onto Melbourne's.
      const byZone = new Map<string, HeldItem[]>()
      for (const i of open) {
        const tz = zoneOfClient.get(i.client_id) ?? DEFAULT_TZ
        byZone.set(tz, [...(byZone.get(tz) ?? []), i])
      }
      let overdue = 0, dueToday = 0, dueWeek = 0
      for (const [tz, group] of byZone) {
        const todayKey = dayKeyInZone(now, tz) ?? ''
        const split = splitDue(group, todayKey, weekRangeInZone(now, tz).endKey)
        overdue += split.overdue.length
        dueToday += split.today.length
        dueWeek += split.this_week.length
      }

      const trail = byActor.get(p.id) ?? []
      const thisWeek = trail.filter(r => r.created_at >= week.startIso && r.created_at < week.endIso)

      return {
        id: p.id,
        name: p.name,
        email: p.email,
        role: p.role,
        timezone: safeZone(p.timezone),
        last_active: trail[0]?.created_at ?? lastSeen.get(p.id) ?? null,
        holding: {
          total: open.length,
          items: open.filter(i => i.owner_id === p.id).length,
          shoots: batches.filter(b => b.owner_id === p.id).length,
          scheduling: open.filter(i => schedulerIdsOf(i).includes(p.id) && i.owner_id !== p.id).length,
          comments: openComments.get(p.id) ?? 0,
          by_status: groupByStatusWord(open),
        },
        due: { overdue, today: dueToday, this_week: dueWeek },
        throughput: thisWeek.length ? summariseThroughput(thisWeek) : { ...EMPTY_THROUGHPUT },
        activity: sparkline(trail, now, 14, AGENCY_TZ),
        // capped: the panel is a list to act on, not an export
        items: open.slice(0, 60),
      }
    })

    // ─── The pool nobody holds ──────────────────────────────────────────
    // The same three scopes the work pages run on, read as one question: what
    // is sitting there waiting for somebody to pick it up? A shoot brief is
    // never in it — an account manager writes those.
    const unassigned = shaped
      .filter(i => {
        if (isBriefTask(i)) return false
        if (isInternalTask(i)) return !i.owner_id && !TASK_DONE_STATUSES.has(i.status)
        if (!isAsset(i)) return false
        // an asset before sign-off wants an editor; after it, a scheduler
        return (SCHEDULER_STATUSES as readonly string[]).includes(i.status)
          ? i.status === 'approved_for_scheduling' && schedulerIdsOf(i).length === 0
          : !i.owner_id
      })

    // Clients that actually have work here — an empty filter is worse than no
    // filter at all.
    const clientNames = new Map<string, string>()
    for (const i of allItems) if (i.clients?.name) clientNames.set(i.client_id, i.clients.name)

    return NextResponse.json({
      rows,
      viewer: { id: me.id, role: me.role, timezone: safeZone(me.timezone), isAdmin },
      week: { start: week.startKey, end: week.endKey, tz: AGENCY_TZ },
      unassigned: { total: unassigned.length, items: unassigned.slice(0, 40) },
      clients: [...clientNames.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
