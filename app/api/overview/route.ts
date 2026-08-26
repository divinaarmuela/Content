import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { AuthzError, requireSignedIn, authzErrorResponse } from '../../lib/authz'
import { accessibleClientIds, assertUuid } from '../../lib/production-access'
import { ITEM_STATUSES, SCHEDULER_STATUSES, schedulerIdsOf } from '../../lib/workflow-core'
import { SHOOT_BRIEF_SLUG } from '../../lib/brief-task-core'
import { isInternalKind } from '../../lib/task-kind-core'

/**
 * One request, shaped to the caller's role — the data behind the Overview.
 *
 * Each role gets the slice of the business they act on (doc 1 §3): editors
 * their production work, schedulers the approved queue and what's going out,
 * managers the funnel plus leads. Everything is scoped through the same
 * accessibleClientIds gate the item list uses, so this endpoint can never
 * show someone a number their pages would refuse to explain.
 */

type ItemLite = {
  id: string
  title: string
  status: string
  content_type: string
  priority: string
  due_date: string | null
  scheduler_ids?: unknown
  client_id: string
  owner_id: string | null
  updated_at: string
  clients: { name: string } | null
}

export async function GET() {
  try {
    const user = await requireSignedIn()
    if (user.role === 'client') throw new AuthzError('Not available to client accounts', 403)

    const clientIds = await accessibleClientIds(user)

    let itemsQ = supabase
      .from('content_items')
      .select('id, title, status, content_type, priority, due_date, client_id, owner_id, scheduler_ids, updated_at, clients(name), work_kinds(slug, uses_media)')
      .order('updated_at', { ascending: false })
      .limit(500)
    if (clientIds !== null) {
      // assignment grants visibility, same rule as the items API — owning the
      // job, or being handed its scheduling
      const me = assertUuid(user.id)
      const assigned = `owner_id.eq.${me},scheduler_ids.cs.["${me}"]`
      itemsQ = clientIds.length === 0
        ? itemsQ.or(assigned)
        : itemsQ.or(`client_id.in.(${clientIds.map(assertUuid).join(',')}),${assigned}`)
    }
    if (user.role === 'scheduler') {
      // accessibleClientIds is null for a scheduler — they are gated by STATUS,
      // not by client — so without this the pipeline counts on their Overview
      // included pre-approval work their pages would refuse to show them.
      // Same rule as the items list: the approved queue, plus anything they own.
      itemsQ = itemsQ.or(
        `status.in.(${SCHEDULER_STATUSES.join(',')}),owner_id.eq.${assertUuid(user.id)}`)
    }
    const { data: itemRows, error: itemsErr } = await itemsQ
    // the production tables may not exist yet in a fresh environment — the
    // overview should degrade to zeros, not error the whole page
    const items: ItemLite[] = itemsErr ? [] : ((itemRows ?? []) as unknown as ItemLite[])

    const pipeline: Record<string, number> = Object.fromEntries(ITEM_STATUSES.map(s => [s, 0]))
    for (const i of items) {
      // a BOOKED brief is 'scheduled' under the hood but is nothing the
      // Scheduler page will ever show — a brief still in review counts,
      // because "With client 1" must be true when a plan is with the client
      const kind = (i as { work_kinds?: { slug?: string; uses_media?: boolean } | null }).work_kinds
      const brief = (kind?.slug ?? '') === SHOOT_BRIEF_SLUG
      if (brief && (i.status === 'scheduled' || i.status === 'published')) continue
      // a research/strategy task is not in the content pipeline at all
      if (isInternalKind(kind)) continue
      if (pipeline[i.status] !== undefined) pipeline[i.status] += 1
    }

    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString()

    // nobody's job yet: the pool anyone may pick up. A shoot brief is never in
    // it (an account manager writes those), and neither is anything already
    // approved — that pool is the scheduler's, and it is a different seat.
    // …and neither is an internal task: the Editor board this list links to
    // shows assets only, so counting tasks here promised rows nobody could see.
    const unassignedAll = items.filter(i => {
      const kind = (i as { work_kinds?: { slug?: string; uses_media?: boolean } | null }).work_kinds
      return !i.owner_id
        && (kind?.slug ?? '') !== SHOOT_BRIEF_SLUG
        && !isInternalKind(kind)
        && !(SCHEDULER_STATUSES as readonly string[]).includes(i.status)
    })

    if (user.role === 'editor') {
      // strictly the editor's OWN work: the old "…else everything" fallback
      // filed colleagues' items under "Needs your action" for anyone holding
      // nothing. The "Up for grabs" list below is the answer to an empty desk.
      const pool = items.filter(i => i.owner_id === user.id)
      const mine = pool
      // 'revision_complete' is deliberately absent: the editor has already
      // done that one and it is the manager's move now
      const needsAction = pool
        .filter(i => ['revision_required', 'draft_uploaded'].includes(i.status))
        .sort((a, b) => (a.status === 'revision_required' ? -1 : 1) - (b.status === 'revision_required' ? -1 : 1))
        .slice(0, 8)
      const dueSoonAll = pool
        .filter(i => i.due_date && i.due_date <= weekAhead.slice(0, 10) && !['published', 'scheduled'].includes(i.status))
        .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
      const dueSoon = dueSoonAll.slice(0, 8)
      return NextResponse.json({
        role: user.role,
        name: user.name,
        pipeline,
        editor: {
          my_items: mine.length,
          in_internal_review: pool.filter(i => i.status === 'internal_review').length,
          revisions_needed: pool.filter(i => i.status === 'revision_required').length,
          needs_action: needsAction,
          due_soon: dueSoon,
          due_soon_count: dueSoonAll.length,
          unassigned: unassignedAll.slice(0, 8),
          unassigned_count: unassignedAll.length,
        },
      })
    }

    if (user.role === 'scheduler') {
      // their queue, the way an editor's board is their jobs: items handed to
      // them, plus unassigned ones so nothing approved can go invisible
      const queue = items.filter(i => {
        if (i.status !== 'approved_for_scheduling') return false
        const kind = (i as { work_kinds?: { slug?: string; uses_media?: boolean } | null }).work_kinds
        // an approved shoot BRIEF is booked by its account manager, not queued
        if ((kind?.slug ?? '') === 'shoot_brief') return false
        // …and an approved internal task is simply Done — the Scheduler page
        // hides it, so counting it in "To schedule" promised work that isn't
        if (isInternalKind(kind)) return false
        const assigned = Array.isArray(i.scheduler_ids) ? i.scheduler_ids : []
        return assigned.length === 0 || assigned.includes(user.id)
      })
      let upcoming: unknown[] = []
      let upcomingCount = 0
      let publishedWeek = 0
      const { data: entries } = await supabase
        .from('schedule_entries')
        .select('id, item_id, platform, scheduled_at, live_url, published_at, content_items(id, title, client_id, clients(name))')
        // lower-bounded: without this, 200 historical rows fill the window
        // and both panels go permanently blank on a busy account
        .gte('scheduled_at', weekAgo)
        .order('scheduled_at', { ascending: true })
        .limit(200)
      if (entries) {
        const now = new Date().toISOString()
        const upcomingAll = entries
          .filter(e => e.scheduled_at && e.scheduled_at >= now && e.scheduled_at <= weekAhead)
        upcoming = upcomingAll.slice(0, 8)
        upcomingCount = upcomingAll.length
        publishedWeek = entries.filter(e => e.published_at && e.published_at >= weekAgo).length
      }
      return NextResponse.json({
        role: user.role,
        name: user.name,
        pipeline,
        scheduler: {
          to_schedule: queue.length,
          queue: queue.slice(0, 8),
          upcoming,
          upcoming_count: upcomingCount,
          published_week: publishedWeek,
        },
      })
    }

    // account_manager / super_admin — the funnel plus the front door.
    // Lead data only for those who may see the Leads page: supers by role,
    // an AM only via an explicit per-person grant.
    const { data: leadsRow } = await supabase.from('user_page_access')
      .select('hidden').eq('team_user_id', user.id).eq('href', '/dashboard/leads').maybeSingle()
    // hidden wins for everyone — a super admin who muted Leads sees none of it
    const mayLeads = !leadsRow?.hidden
      && (user.role === 'super_admin' || (!!leadsRow && !leadsRow.hidden))
    let clientsQ = supabase.from('clients').select('id, name').order('name')
    if (clientIds !== null) clientsQ = clientsQ.in('id', clientIds.length ? clientIds : ['00000000-0000-0000-0000-000000000000'])
    const [{ data: clientRows }, { data: leadRows }] = await Promise.all([
      clientsQ,
      mayLeads
        ? supabase.from('leads')
            .select('id, fname, lname, biz, source, created_at')
            .order('created_at', { ascending: false })
            .limit(50)
        : Promise.resolve({ data: null }),
    ])
    const leads = leadRows ?? []
    // the manager's own queue: the three statuses whose turn is theirs.
    // 'client_review' is the CLIENT's move and already has its own stat
    // ("With client"); 'revision_complete' is a manager sign-off and used to
    // be reported nowhere at all. Same population as the pipeline counts
    // above it — a "Ready for review 0" above three rows is a bug report.
    const needsReview = items
      .filter(i => ['internal_review', 'revision_complete', 'client_changes_requested'].includes(i.status))
      .filter(i => !isInternalKind((i as { work_kinds?: { slug?: string; uses_media?: boolean } | null }).work_kinds))
      .slice(0, 8)
    // managers get assigned work too (a graphics or copy task can land on
    // anyone) — surface it, soonest due first, or it silently rots
    // — and being handed the SCHEDULING of an approved item is an assignment
    // too, whatever your title. Those live past the point where owning it
    // stops mattering, so they are matched on scheduler_ids instead.
    const myTasks = items
      .filter(i =>
        (i.owner_id === user.id
          && !['approved_for_scheduling', 'scheduled', 'published'].includes(i.status))
        // a published item is finished — assigned or not, it is not a task
        || (['approved_for_scheduling', 'scheduled'].includes(i.status)
          && schedulerIdsOf(i).includes(user.id)))
      .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    return NextResponse.json({
      role: user.role,
      name: user.name,
      pipeline,
      manager: {
        clients: (clientRows ?? []).length,
        // both stages that wait on a manager: the first look and the re-look
        awaiting_internal_review: (pipeline.internal_review ?? 0) + (pipeline.revision_complete ?? 0),
        awaiting_client: (pipeline.client_review ?? 0) + (pipeline.client_changes_requested ?? 0),
        revisions_open: pipeline.revision_required ?? 0,
        needs_review: needsReview,
        my_tasks: myTasks.slice(0, 8),
        my_tasks_count: myTasks.length,
        // work sitting in nobody's queue — the number a manager acts on
        unassigned_count: unassignedAll.length,
        ...(mayLeads
          ? {
              leads_total: leads.length,
              leads_week: leads.filter(l => l.created_at >= weekAgo).length,
              latest_leads: leads.slice(0, 6),
            }
          : {}),
      },
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
