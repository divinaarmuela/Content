import { NextResponse } from 'next/server'
import { table, encodeKey, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { Batch, ContentItem, Lead, ScheduleEntry, UserPageAccess } from '@/lib/db-types'
import { AuthzError, requireSignedIn, authzErrorResponse } from '../../lib/authz'
import {
  accessibleClientIds, assertUuid, assignedItemsFilter, openTaggedIds,
} from '../../lib/production-access'
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
 return withRequestCache(async () => {
  try {
    const user = await requireSignedIn()
    if (user.role === 'client') throw new AuthzError('Not available to client accounts', 403)

    const clientIds = await accessibleClientIds(user)

    // assignment grants visibility, the SAME rule as the items API and
    // loadItemForUser: owning the job, holding its scheduling, being tagged
    // on it, or holding the shoot it sits under. "Assigned to you" that
    // omits a job you were assigned is the whole complaint. The predicate
    // below is the items GET's, line for line, so the Overview's numbers can
    // never disagree with the board they link to.
    const scopedClients = clientIds === null ? null : clientIds.map(assertUuid)
    const assigned = clientIds !== null ? await assignedItemsFilter(user) : null
    // a scheduler is gated by STATUS, not by client (accessibleClientIds is
    // null for them) — but a scheduler who OWNS a job must see it at any
    // status; the status gate is for other people's items.
    const me = user.role === 'scheduler' ? assertUuid(user.id) : user.id
    let items: ItemLite[] = []
    try {
      const rows = await table<ContentItem>('content_items').list({
        where: r => {
          if (scopedClients !== null && !(scopedClients.includes(r.client_id) || assigned!(r))) return false
          if (user.role === 'scheduler'
            && !((SCHEDULER_STATUSES as readonly string[]).includes(r.status) || r.owner_id === me)) return false
          return true
        },
        orderBy: [['updated_at', 'desc']],
        limit: 500,
      })
      items = await attachOne(
        await attachOne(rows, 'client_id', 'clients', ['name']),
        'work_kind_id', 'work_kinds', ['slug', 'uses_media'],
      ) as unknown as ItemLite[]
    } catch {
      // a fresh environment may hold no production rows at all — the overview
      // degrades to zeros rather than erroring the whole page
      items = []
    }

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

    // "someone tagged you and it is not done": the items (and shoots) with
    // an unresolved comment assigned to this person, whatever their role and
    // whether or not they are on the client. Every role's Overview shows it.
    const tagged = await openTaggedIds(user)
    const taggedItems = items.filter(i => tagged.items.includes(i.id))
    // an item off the roster is still theirs to answer — fetch the ones the
    // scoped list above did not carry
    const missing = tagged.items.filter(id => !items.some(i => i.id === id)).map(assertUuid)
    if (missing.length > 0) {
      const extra = await table<ContentItem>('content_items')
        .list({ where: r => missing.includes(r.id) })
        .then(rows => attachOne(rows, 'client_id', 'clients', ['name']))
        .catch(() => [])
      taggedItems.push(...(extra as unknown as ItemLite[]))
    }
    let taggedShoots: { id: string; title: string; client_id: string; clients: { name: string } | null }[] = []
    if (tagged.batches.length > 0) {
      const shootIds = tagged.batches.map(assertUuid)
      taggedShoots = await table<Batch>('batches')
        .list({ where: r => shootIds.includes(r.id) })
        .then(rows => attachOne(rows, 'client_id', 'clients', ['name']))
        .then(rows => rows as unknown as typeof taggedShoots)
        .catch(() => [])
    }
    const waitingOnYou = {
      items: taggedItems.map(i => ({ ...i, tagged: true })),
      shoots: taggedShoots,
    }

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
        waiting_on_you: waitingOnYou,
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
      // lower-bounded: without this, 200 historical rows fill the window
      // and both panels go permanently blank on a busy account
      const entryRows = await table<ScheduleEntry>('schedule_entries').list({
        where: r => r.scheduled_at != null && r.scheduled_at >= weekAgo,
        orderBy: [['scheduled_at', 'asc']],
        limit: 200,
      }).catch(() => [])
      // the item, and nested inside it its client's name and posting zone —
      // the shape the dashboard reads (e.content_items.clients.timezone)
      const withItems = await attachOne(entryRows, 'item_id', 'content_items', ['id', 'title', 'client_id'])
      const clientsById = new Map(
        (await table('clients').list().catch(() => []))
          .map(c => [c.id, { name: c.name, timezone: c.timezone }]),
      )
      const entries = withItems.map(e => ({
        ...e,
        content_items: e.content_items
          ? { ...e.content_items, clients: clientsById.get(e.content_items.client_id as string) ?? null }
          : null,
      }))
      {
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
        waiting_on_you: waitingOnYou,
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
    // the row's id IS (team_user_id, href) — one grant per person per page
    const leadsRow = await table<UserPageAccess & { hidden?: boolean }>('user_page_access')
      .get(`${user.id}__${encodeKey('/dashboard/leads')}`)
      .catch(() => null)
    // hidden wins for everyone — a super admin who muted Leads sees none of it
    const mayLeads = !leadsRow?.hidden
      && (user.role === 'super_admin' || (!!leadsRow && !leadsRow.hidden))
    const [clientRows, leads] = await Promise.all([
      // an empty id list scopes to nothing on its own — no sentinel needed
      table('clients').list({
        where: clientIds === null ? undefined : r => clientIds.includes(r.id),
        orderBy: [['name', 'asc']],
      }).catch(() => []),
      mayLeads
        ? table<Lead>('leads').list({ orderBy: [['created_at', 'desc']], limit: 50 }).catch(() => [])
        : Promise.resolve([] as Lead[]),
    ])
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
      waiting_on_you: waitingOnYou,
      manager: {
        clients: clientRows.length,
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
 })
}
