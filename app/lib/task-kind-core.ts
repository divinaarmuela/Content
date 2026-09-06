/**
 * Pure internal-task logic — no I/O, the third overlay on the item machine.
 *
 * Research, strategy, copywriting: production work with nothing to post. An
 * internal task is a content_item whose work kind uses no media (and is not
 * a shoot brief). It rides the normal review loop in its own words, and it
 * ends at "Done" — it never reaches the Scheduler and never counts toward
 * the client's agreement, because the agreement is what gets published.
 */

import type { Role } from './identity-core'
import {
  checkTransitionAs, offeredTransitionsFrom, STATUS_MEANING, STATUS_TURN, TRANSITIONS,
  type ItemStatus, type TransitionCheck,
} from './workflow-core'
import { SHOOT_BRIEF_SLUG } from './brief-task-core'

export type KindShape = { slug?: string | null; uses_media?: boolean | null } | null | undefined

/** A kind that produces nothing to post: not a brief, and no media. */
export function isInternalKind(kind: KindShape): boolean {
  if (!kind) return false
  if (kind.slug === SHOOT_BRIEF_SLUG) return false
  return kind.uses_media === false
}

/** What each stage is CALLED for a task. Approved is the end: Done. */
export const TASK_KIND_LABELS: Record<ItemStatus, string> = {
  draft_uploaded: 'In progress',
  internal_review: 'Ready for checking',
  revision_required: 'Being changed',
  revision_complete: 'Changes made — check again',
  client_review: 'With client',
  client_changes_requested: 'Client wants changes',
  approved_for_scheduling: 'Done',
  scheduled: 'Done',
  published: 'Done',
}

export const TASK_STATUS_MEANING: Record<ItemStatus, string> = {
  ...STATUS_MEANING,
  draft_uploaded: 'The work is being done.',
  approved_for_scheduling: 'Signed off. Nothing left to do.',
  scheduled: 'Signed off. Nothing left to do.',
  published: 'Signed off. Nothing left to do.',
}

/** Nobody's turn once it is done — a task never hands over to a scheduler. */
export const TASK_STATUS_TURN: Record<ItemStatus, Role | null> = {
  ...STATUS_TURN,
  approved_for_scheduling: null,
  scheduled: null,
  published: null,
}

export function taskStatusLabel(
  kind: KindShape, status: ItemStatus, fallback: string,
  /** has anything been attached yet? A task created a minute ago that nobody
   *  has opened reads as "In progress", and the team assumes somebody is on
   *  it. Nothing attached means nobody has started. */
  opts?: { hasWork?: boolean },
): string {
  if (!isInternalKind(kind)) return fallback
  if (status === 'draft_uploaded' && opts?.hasWork === false) return 'Not started'
  return TASK_KIND_LABELS[status] ?? fallback
}

type Override = { label: string; roles: Role[] } | { blocked: true }

/** Edges that read differently for a task; everything else is the asset rule. */
const TASK_TRANSITION_OVERRIDES: Record<string, Override> = {
  'draft_uploaded>internal_review': { label: 'Submit for review', roles: ['editor', 'account_manager'] },
  'internal_review>approved_for_scheduling': { label: 'Approve — done', roles: ['account_manager'] },
  'revision_complete>approved_for_scheduling': { label: 'Approve — done', roles: ['account_manager'] },
  // the client's own yes, recorded — not the manager approving it themselves
  'client_review>approved_for_scheduling': { label: 'Client approved — mark done', roles: ['client', 'account_manager'] },
  // a task has nothing to schedule or publish — Done is the end, for everyone
  'approved_for_scheduling>scheduled': { blocked: true },
  'scheduled>published': { blocked: true },
}

export function checkTaskTransitionAs(
  roles: readonly Role[], from: ItemStatus, to: ItemStatus,
  /** the app's own move — see `checkTransitionAs`. An internal task has the
   *  same `auto` edges an asset does (a new draft saved while the piece is
   *  with the client pulls it back), and this wrapper has to be able to say
   *  so, or those edges are simply unreachable for a task. */
  opts?: { auto?: boolean },
): TransitionCheck {
  const exists = TRANSITIONS[from]?.[to]
  if (!exists) return { ok: false, reason: `No transition from ${from} to ${to}` }
  const override = TASK_TRANSITION_OVERRIDES[`${from}>${to}`]
  if (!override) return checkTransitionAs(roles, from, to, opts)
  if ('blocked' in override) {
    return { ok: false, reason: 'A task ends when it is approved — there is nothing to schedule or publish' }
  }
  if (!roles.includes('super_admin') && !override.roles.some(r => roles.includes(r))) {
    return { ok: false, reason: `${roles.join('/') || 'nobody'} may not perform "${override.label}"` }
  }
  const { labelFor: _drop, ...base } = exists
  void _drop
  return { ok: true, rule: { ...base, label: override.label, roles: override.roles } }
}

export function availableTaskTransitionsAs(
  roles: readonly Role[], from: ItemStatus,
): { to: ItemStatus; label: string }[] {
  return offeredTransitionsFrom(from)
    .map(to => {
      const c = checkTaskTransitionAs(roles, from, to)
      return c.ok ? { to, label: c.rule.label } : null
    })
    .filter((t): t is NonNullable<typeof t> => t !== null)
}

/** A task is finished once approved, whatever the machine calls it. */
export const TASK_DONE_STATUSES: ReadonlySet<ItemStatus> = new Set<ItemStatus>([
  'approved_for_scheduling', 'scheduled', 'published',
])
