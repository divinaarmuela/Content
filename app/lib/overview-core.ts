/**
 * The Overview's numbers — pure, no I/O.
 *
 * `/api/overview` used to read the database and shape the answer in one
 * function, so the only way to draw the Overview was to ask the server for
 * it. The page now renders from live listeners, and the ONE thing that must
 * not happen is the page and the API disagreeing about what "Ready for
 * review 3" means. So the shaping moved here and both call it: the route
 * feeds it rows it read, the page feeds it rows its listeners delivered, and
 * the answer is the same object either way.
 *
 * Everything below is the route's own logic, moved, not rewritten.
 */

import { ITEM_STATUSES, SCHEDULER_STATUSES, schedulerIdsOf } from './workflow-core'
import { SHOOT_BRIEF_SLUG } from './brief-task-core'
import { isInternalKind } from './task-kind-core'

export type OverviewItem = {
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
  work_kinds?: { slug?: string; uses_media?: boolean } | null
}

export type OverviewShoot = {
  id: string; title: string; client_id: string; clients: { name: string } | null
}

export type OverviewEntry = {
  id: string
  scheduled_at: string | null
  published_at?: string | null
  content_items?: unknown
}

export type OverviewInput = {
  user: { id: string; role: string; name: string }
  /** the viewer's items, already scoped — `visibleItems` / the route's predicate */
  items: OverviewItem[]
  /** ids of items and shoots with an unresolved comment tagged to the viewer */
  tagged: { items: string[]; batches: string[] }
  /** tagged items that the scoped list did not carry — still theirs to answer */
  taggedExtraItems?: OverviewItem[]
  taggedShoots?: OverviewShoot[]
  /** how many clients this person runs (the manager card's first number) */
  clientCount?: number
  /** schedule entries from a week ago onwards, soonest first */
  entries?: OverviewEntry[]
  /** leads, newest first — empty for anyone without the Leads page */
  leads?: { id: string; created_at: string }[]
  mayLeads?: boolean
  /** now, as a number, so a test can pin the week windows */
  now?: number
}

/**
 * How many leads the Overview's numbers are drawn from.
 *
 * The route has always read `leads` with `limit: 50`, so "8+ total" has always
 * meant "of the 50 newest". The cap lives HERE rather than only at each read,
 * because the page reads the same table through a live listener and a cap that
 * exists in one caller and not the other is a page and an endpoint quietly
 * disagreeing about a number. Both still cap at the read as well — no reason
 * to carry rows across the wire only to drop them.
 */
export const LEADS_CAP = 50

const kindOf = (i: OverviewItem) => i.work_kinds ?? null

/** The content funnel: one count per status, with the rows that are not
 *  content left out — a booked shoot plan, and every internal task. */
export function pipelineOf(items: OverviewItem[]): Record<string, number> {
  const pipeline: Record<string, number> = Object.fromEntries(ITEM_STATUSES.map(s => [s, 0]))
  for (const i of items) {
    const kind = kindOf(i)
    const brief = (kind?.slug ?? '') === SHOOT_BRIEF_SLUG
    // a BOOKED brief is 'scheduled' under the hood but is nothing the
    // Scheduler page will ever show — a brief still in review counts,
    // because "With client 1" must be true when a plan is with the client
    if (brief && (i.status === 'scheduled' || i.status === 'published')) continue
    // a research/strategy task is not in the content pipeline at all
    if (isInternalKind(kind)) continue
    if (pipeline[i.status] !== undefined) pipeline[i.status] += 1
  }
  return pipeline
}

/** Nobody's job yet: the pool anyone may pick up. Never a shoot plan (an
 *  account manager writes those), never anything already approved (that pool
 *  is the scheduler's seat), never an internal task (the Editor board this
 *  links to shows assets only). */
export function unassignedOf(items: OverviewItem[]): OverviewItem[] {
  return items.filter(i => {
    const kind = kindOf(i)
    return !i.owner_id
      && (kind?.slug ?? '') !== SHOOT_BRIEF_SLUG
      && !isInternalKind(kind)
      && !(SCHEDULER_STATUSES as readonly string[]).includes(i.status)
  })
}

/** The whole Overview payload, per role — byte for byte what the route
 *  answered with before this moved out of it. */
export function buildOverview(input: OverviewInput): Record<string, unknown> {
  const { user, items, tagged } = input
  const now = input.now ?? Date.now()
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString()
  const weekAhead = new Date(now + 7 * 86_400_000).toISOString()

  const pipeline = pipelineOf(items)

  // "someone tagged you and it is not done" — every role's Overview shows it
  const taggedItems = items.filter(i => tagged.items.includes(i.id))
  taggedItems.push(...(input.taggedExtraItems ?? []))
  const waitingOnYou = {
    items: taggedItems.map(i => ({ ...i, tagged: true })),
    shoots: input.taggedShoots ?? [],
  }

  const unassignedAll = unassignedOf(items)

  if (user.role === 'editor') {
    // strictly the editor's OWN work: the "Up for grabs" list below is the
    // answer to an empty desk, not colleagues' items filed under "yours"
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
    return {
      role: user.role,
      name: user.name,
      pipeline,
      waiting_on_you: waitingOnYou,
      editor: {
        my_items: mine.length,
        in_internal_review: pool.filter(i => i.status === 'internal_review').length,
        revisions_needed: pool.filter(i => i.status === 'revision_required').length,
        needs_action: needsAction,
        due_soon: dueSoonAll.slice(0, 8),
        due_soon_count: dueSoonAll.length,
        unassigned: unassignedAll.slice(0, 8),
        unassigned_count: unassignedAll.length,
      },
    }
  }

  if (user.role === 'scheduler') {
    // their queue, the way an editor's board is their jobs: items handed to
    // them, plus unassigned ones so nothing approved can go invisible
    const queue = items.filter(i => {
      if (i.status !== 'approved_for_scheduling') return false
      const kind = kindOf(i)
      // an approved shoot BRIEF is booked by its account manager, not queued
      if ((kind?.slug ?? '') === SHOOT_BRIEF_SLUG) return false
      // …and an approved internal task is simply Done
      if (isInternalKind(kind)) return false
      const assigned = Array.isArray(i.scheduler_ids) ? i.scheduler_ids : []
      return assigned.length === 0 || assigned.includes(user.id)
    })
    const entries = input.entries ?? []
    const nowIso = new Date(now).toISOString()
    const upcomingAll = entries.filter(e => e.scheduled_at && e.scheduled_at >= nowIso && e.scheduled_at <= weekAhead)
    return {
      role: user.role,
      name: user.name,
      pipeline,
      waiting_on_you: waitingOnYou,
      scheduler: {
        to_schedule: queue.length,
        queue: queue.slice(0, 8),
        upcoming: upcomingAll.slice(0, 8),
        upcoming_count: upcomingAll.length,
        published_week: entries.filter(e => e.published_at && e.published_at >= weekAgo).length,
      },
    }
  }

  // account_manager / super_admin — the funnel plus the front door
  // the cap is part of the answer, not an optimisation the caller may skip
  const leads = (input.leads ?? []).slice(0, LEADS_CAP)
  const mayLeads = input.mayLeads ?? false
  // the manager's own queue: the three statuses whose turn is theirs.
  // 'client_review' is the CLIENT's move and already has its own stat.
  const needsReview = items
    .filter(i => ['internal_review', 'revision_complete', 'client_changes_requested'].includes(i.status))
    .filter(i => !isInternalKind(kindOf(i)))
    .slice(0, 8)
  // managers get assigned work too — and being handed the SCHEDULING of an
  // approved item is an assignment whatever your title
  const myTasks = items
    .filter(i =>
      (i.owner_id === user.id
        && !['approved_for_scheduling', 'scheduled', 'published'].includes(i.status))
      || (['approved_for_scheduling', 'scheduled'].includes(i.status)
        && schedulerIdsOf(i).includes(user.id)))
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
  return {
    role: user.role,
    name: user.name,
    pipeline,
    waiting_on_you: waitingOnYou,
    manager: {
      clients: input.clientCount ?? 0,
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
  }
}
