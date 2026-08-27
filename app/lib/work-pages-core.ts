/**
 * Pure logic for the three work pages — Editor, Scheduler, Production — no I/O.
 *
 * One board tried to be all three at once, so everyone scrolled past everyone
 * else's work. Each page now answers one question ("what is mine to edit",
 * "what is mine to post", "which shoots am I planning"), and the SAME item can
 * appear on two of them wearing two different hats. The scope filter is the
 * whole trick: by default you see your own work and the unclaimed pool, and
 * never the item that is plainly someone else's.
 */

import { SCHEDULER_STATUSES, STATUS_LABELS, schedulerIdsOf, type ItemStatus } from './workflow-core'
import { SHOOT_BRIEF_SLUG } from './brief-task-core'
import { isInternalKind, TASK_DONE_STATUSES } from './task-kind-core'
import type { Role } from './identity-core'

export type WorkItem = {
  id: string
  status: ItemStatus
  owner_id: string | null
  scheduler_ids?: unknown
  batch_id?: string | null
  work_kinds?: { slug?: string; uses_media?: boolean } | null
  /** the viewer has an open task on this item — a hand-off that outranks ownership */
  my_open_task?: boolean
}

export type Viewer = { id: string; role: Role }

/** What a page is showing: my work, the unclaimed pool, or everything. */
export type ScopeMode = 'mine' | 'unassigned' | 'all'
export type ScopeSet = Set<ScopeMode>

export const isManager = (role: Role) => role === 'account_manager' || role === 'super_admin'

/** Managers run the whole board; everyone else opens on their own work. */
export function defaultScope(role: Role): ScopeSet {
  return isManager(role) ? new Set<ScopeMode>(['all']) : new Set<ScopeMode>(['mine', 'unassigned'])
}

/** scheduler_ids as it is meant: a list of user ids. Anything else is none —
 *  the state machine's own reading of the field, not a second copy of it. */
export { schedulerIdsOf }

export function isBriefTask(i: { work_kinds?: { slug?: string; uses_media?: boolean } | null }): boolean {
  return i.work_kinds?.slug === SHOOT_BRIEF_SLUG
}

/** Research, strategy, copy: a task with nothing to post. Lives on Production. */
export function isInternalTask(i: { work_kinds?: { slug?: string; uses_media?: boolean } | null }): boolean {
  return isInternalKind(i.work_kinds)
}

/** An asset: the only thing the Editor board and the Scheduler ever show. */
export function isAsset(i: { work_kinds?: { slug?: string; uses_media?: boolean } | null }): boolean {
  return !isBriefTask(i) && !isInternalTask(i)
}

/** Tasks still open — Done ones leave the list. */
export function activeInternalTasks<T extends WorkItem>(items: T[]): T[] {
  return items.filter(i => isInternalTask(i) && !TASK_DONE_STATUSES.has(i.status))
}

/**
 * Tasks finished in the last `days` — the tail Production keeps, collapsed.
 *
 * A Done task leaves the open list, and `backLinkFor` still sends its detail
 * page to Production: without this, "Back" landed on a page that did not
 * contain the item. Newest first.
 */
export function recentlyDoneTasks<T extends WorkItem & { updated_at?: string | null }>(
  items: T[], now: Date = new Date(), days = 14,
): T[] {
  const since = now.getTime() - days * 86_400_000
  return items
    .filter(i => isInternalTask(i) && TASK_DONE_STATUSES.has(i.status))
    .filter(i => {
      const t = i.updated_at ? new Date(i.updated_at).getTime() : NaN
      return Number.isFinite(t) && t >= since
    })
    .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
}

/** The editor board's columns. Together they cover every status before the
 *  scheduler takes over — each one exactly once. */
export const EDITOR_LANES: { key: string; title: string; statuses: ItemStatus[] }[] = [
  { key: 'drafting', title: 'Drafting', statuses: ['draft_uploaded'] },
  { key: 'review', title: 'Ready for review', statuses: ['internal_review'] },
  { key: 'revising', title: 'Being revised', statuses: ['revision_required', 'revision_complete'] },
  { key: 'client', title: 'With client', statuses: ['client_review', 'client_changes_requested'] },
  // the status's own label, not "Approved": that word meant four things
  // across the app and read as "finished" on a column of work still to post
  { key: 'approved', title: STATUS_LABELS.approved_for_scheduling, statuses: ['approved_for_scheduling'] },
]

/** The Scheduler queue's three tabs — the same words the Editor board's last
 *  column and the item's status badge use, so the hand-off says one thing. */
export const SCHEDULER_LANES: { key: ItemStatus; title: string }[] = [
  { key: 'approved_for_scheduling', title: STATUS_LABELS.approved_for_scheduling },
  { key: 'scheduled', title: STATUS_LABELS.scheduled },
  { key: 'published', title: STATUS_LABELS.published },
]

/**
 * The Production page's TASK columns — the same shape as EDITOR_LANES, in the
 * task's own vocabulary. A flat list of rows never showed where the approve /
 * review step was; a board does, and it is the board people already know from
 * the Editor page.
 *
 * 'Done' is the tail: it holds all three end statuses, and the page shows only
 * the recent ones (see `recentlyDoneTasks`) so the column stays a footnote.
 */
export const TASK_LANES: { key: string; title: string; statuses: ItemStatus[] }[] = [
  // "To do", not "In progress": a task at draft_uploaded with nothing attached
  // reads "Not started" on its own page, and a card saying Not started inside
  // a column headed In progress is the board contradicting the item
  { key: 'doing', title: 'To do', statuses: ['draft_uploaded'] },
  { key: 'review', title: 'Ready for review', statuses: ['internal_review'] },
  { key: 'revising', title: 'Being revised', statuses: ['revision_required', 'revision_complete'] },
  { key: 'client', title: 'With client', statuses: ['client_review', 'client_changes_requested'] },
  { key: 'done', title: 'Done', statuses: ['approved_for_scheduling', 'scheduled', 'published'] },
]

/**
 * The Production page's BRIEF columns — the Editor board's shape again, in the
 * shoot plan's own vocabulary.
 *
 * A flat list of briefs said only that they existed. The whole point of these
 * boards is that the column IS the step: a plan waiting on a manager and a
 * plan waiting on the client are different problems, and a list put them in
 * the same pile.
 *
 * There is no Done lane. A booked brief is a shoot, and it appears as one on
 * the shoot cards below — `activeBriefTasks` drops it before it ever reaches a
 * column here.
 */
export const BRIEF_LANES: { key: string; title: string; statuses: ItemStatus[] }[] = [
  { key: 'doing', title: 'Writing', statuses: ['draft_uploaded'] },
  // revision_complete is "the changes are in, look again" — the same waiting
  // room as a first submission, and the manager's move either way
  { key: 'review', title: 'Ready for review', statuses: ['internal_review', 'revision_complete'] },
  { key: 'revising', title: 'Being revised', statuses: ['revision_required', 'client_changes_requested'] },
  { key: 'client', title: 'With client', statuses: ['client_review'] },
  { key: 'approved', title: 'Approved — book the shoot', statuses: ['approved_for_scheduling'] },
]

export type Assignment = 'mine' | 'unassigned' | 'other'

export function editorAssignment(i: WorkItem, v: Viewer): Assignment {
  if (i.owner_id === v.id || i.my_open_task) return 'mine'
  if (!i.owner_id) return 'unassigned'
  return 'other'
}

/**
 * On the scheduler page "mine" means the SCHEDULING is mine — nothing else.
 *
 * The owner used to count too, on the theory that whoever made a thing may
 * follow it out the door. On screen that produced a flat contradiction: under
 * "Mine · Only what is assigned to you" sat a row badged "Unassigned — any
 * scheduler can take it", because the item's editor was the viewer and its
 * scheduler was nobody. One row cannot be both. The scheduling seat is the
 * only assignment this page is about.
 */
export function schedulerAssignment(i: WorkItem, v: Viewer): Assignment {
  const ids = schedulerIdsOf(i)
  if (ids.includes(v.id)) return 'mine'
  if (ids.length === 0) return 'unassigned'
  return 'other'
}

export function applyScope<T extends WorkItem>(
  items: T[], v: Viewer, scope: ScopeSet, classify: (i: T, v: Viewer) => Assignment,
): T[] {
  if (scope.has('all')) return items
  return items.filter(i => {
    const a = classify(i, v)
    return a !== 'other' && scope.has(a)
  })
}

/** The editor page: content items only, and only while they are still in the
 *  making — once it is scheduled it belongs to the scheduler page. */
export function editorScope<T extends WorkItem>(items: T[], v: Viewer, scope: ScopeSet): T[] {
  const live = items.filter(i => isAsset(i) && i.status !== 'scheduled' && i.status !== 'published')
  return applyScope(live, v, scope, editorAssignment)
}

/** The scheduler page: content items that have been signed off. */
export function schedulerScope<T extends WorkItem>(items: T[], v: Viewer, scope: ScopeSet): T[] {
  const queue = items.filter(i => isAsset(i) && SCHEDULER_STATUSES.includes(i.status))
  return applyScope(queue, v, scope, schedulerAssignment)
}

/** The production page: shoot briefs, where the BATCH's owner counts as much
 *  as the task's — planning a shoot is one job across several rows. */
export function productionScope<T extends WorkItem>(
  briefTasks: T[], v: Viewer, scope: ScopeSet,
  batchOwnerById: Record<string, string | null | undefined>,
): T[] {
  return applyScope(briefTasks, v, scope, (i, viewer) => {
    const batchOwner = batchOwnerById[i.batch_id ?? '']
    if (i.owner_id === viewer.id || batchOwner === viewer.id) return 'mine'
    if (!i.owner_id && !batchOwner) return 'unassigned'
    return 'other'
  })
}

/** How many of these are waiting for somebody to pick them up. */
export function unassignedCount<T extends WorkItem>(
  items: T[], v: Viewer, classify: (i: T, v: Viewer) => Assignment,
): number {
  return items.filter(i => classify(i, v) === 'unassigned').length
}

/** The two counts the editor page shows as a footnote rather than a column —
 *  work that is done, kept visible without taking up the board. */
export function editorTail(items: WorkItem[]): { scheduled: number; published: number } {
  // NOTE: pass the PRE-scope list. editorScope has already dropped 'scheduled'
  // and 'published', so counting its output can only ever return two zeros.
  const own = items.filter(i => isAsset(i))
  return {
    scheduled: own.filter(i => i.status === 'scheduled').length,
    published: own.filter(i => i.status === 'published').length,
  }
}

export function canClaimEditor(i: WorkItem, v: Viewer): boolean {
  return !isBriefTask(i)
    && !i.owner_id
    && !SCHEDULER_STATUSES.includes(i.status)
    && v.role !== 'client'
    && v.role !== 'scheduler'
}

export function canClaimScheduler(i: WorkItem, v: Viewer): boolean {
  return isAsset(i)
    && SCHEDULER_STATUSES.includes(i.status)
    && i.status !== 'published'
    && schedulerIdsOf(i).length === 0
    && (v.role === 'scheduler' || v.role === 'super_admin')
}

/** Briefs still being planned — a booked shoot is done, whatever it says. */
export function activeBriefTasks<T extends WorkItem>(items: T[]): T[] {
  return items.filter(i => isBriefTask(i) && i.status !== 'scheduled' && i.status !== 'published')
}

/** Where an item's detail page came from, so "Back" lands where you were. */
export function backLinkFor(
  i: { status: ItemStatus; work_kinds?: { slug?: string; uses_media?: boolean } | null },
): { href: string; label: string } {
  // a brief lives on Production whatever its status — its "approved" is a
  // shoot to book, not a post to schedule
  if (isBriefTask(i) || isInternalTask(i)) return { href: '/dashboard/production', label: 'Production' }
  if (SCHEDULER_STATUSES.includes(i.status)) return { href: '/dashboard/scheduler', label: 'Scheduler' }
  return { href: '/dashboard/editor', label: 'Editor' }
}

/**
 * Which remembered choice to open on: the link's, then the browser's, then
 * the default.
 *
 * A link that says `?view=calendar` was written by someone who meant the
 * calendar — the note in the bell, the "it is on the posting calendar" toast.
 * For a while the choice stored in localStorage won over the URL, so the
 * person who had last used the board followed a link to the calendar and
 * arrived on the board, wondering where the thing they were sent to had gone.
 * Anything not in `allowed` is a guess we no longer understand and is skipped.
 */
export function restoredChoice<T extends string>(
  allowed: readonly T[], fallback: T,
  { fromUrl, fromStorage }: { fromUrl?: string | null; fromStorage?: string | null },
): T {
  const ok = (v: string | null | undefined): v is T =>
    typeof v === 'string' && (allowed as readonly string[]).includes(v)
  if (ok(fromUrl)) return fromUrl
  if (ok(fromStorage)) return fromStorage
  return fallback
}
