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

import { SCHEDULER_STATUSES, schedulerIdsOf, type ItemStatus } from './workflow-core'
import { SHOOT_BRIEF_SLUG } from './brief-task-core'
import type { Role } from './identity-core'

export type WorkItem = {
  id: string
  status: ItemStatus
  owner_id: string | null
  scheduler_ids?: unknown
  batch_id?: string | null
  work_kinds?: { slug?: string } | null
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

export function isBriefTask(i: { work_kinds?: { slug?: string } | null }): boolean {
  return i.work_kinds?.slug === SHOOT_BRIEF_SLUG
}

/** The editor board's columns. Together they cover every status before the
 *  scheduler takes over — each one exactly once. */
export const EDITOR_LANES: { key: string; title: string; statuses: ItemStatus[] }[] = [
  { key: 'drafting', title: 'Drafting', statuses: ['draft_uploaded'] },
  { key: 'review', title: 'Ready for review', statuses: ['internal_review'] },
  { key: 'revising', title: 'Being revised', statuses: ['revision_required', 'revision_complete'] },
  { key: 'client', title: 'With client', statuses: ['client_review', 'client_changes_requested'] },
  { key: 'approved', title: 'Approved', statuses: ['approved_for_scheduling'] },
]

export type Assignment = 'mine' | 'unassigned' | 'other'

export function editorAssignment(i: WorkItem, v: Viewer): Assignment {
  if (i.owner_id === v.id || i.my_open_task) return 'mine'
  if (!i.owner_id) return 'unassigned'
  return 'other'
}

/** On the scheduler page the OWNER counts as mine too: the person who made it
 *  is allowed to follow it out the door. */
export function schedulerAssignment(i: WorkItem, v: Viewer): Assignment {
  const ids = schedulerIdsOf(i)
  if (ids.includes(v.id) || i.owner_id === v.id) return 'mine'
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
  const live = items.filter(i => !isBriefTask(i) && i.status !== 'scheduled' && i.status !== 'published')
  return applyScope(live, v, scope, editorAssignment)
}

/** The scheduler page: content items that have been signed off. */
export function schedulerScope<T extends WorkItem>(items: T[], v: Viewer, scope: ScopeSet): T[] {
  const queue = items.filter(i => !isBriefTask(i) && SCHEDULER_STATUSES.includes(i.status))
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
  const own = items.filter(i => !isBriefTask(i))
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
  return !isBriefTask(i)
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
  i: { status: ItemStatus; work_kinds?: { slug?: string } | null },
): { href: string; label: string } {
  // a brief lives on Production whatever its status — its "approved" is a
  // shoot to book, not a post to schedule
  if (isBriefTask(i)) return { href: '/dashboard/production', label: 'Production' }
  if (SCHEDULER_STATUSES.includes(i.status)) return { href: '/dashboard/scheduler', label: 'Scheduler' }
  return { href: '/dashboard/editor', label: 'Editor' }
}
