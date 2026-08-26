/**
 * Pure "can I pick this up?" logic — no I/O, fully unit-testable.
 *
 * Claiming is the open-pool half of the assignment rules in workflow-core:
 * an item nobody holds can be taken, and taking it is what grants the hat.
 * This file only DECIDES; the route does the write, and the write is the
 * race guard (UPDATE … WHERE owner_id IS NULL), never a check-then-write.
 */

import type { Role } from './identity-core'
import { SCHEDULER_STATUSES, type ItemStatus } from './workflow-core'

/** The two seats a person can take on an item. */
export type ClaimHat = 'editor' | 'scheduler'

/** What the decision needs to know about the item. */
export type ClaimItem = {
  status: ItemStatus
  /** a shoot brief belongs to the account manager who wrote it */
  is_brief: boolean
}

export type ClaimDecision =
  | { ok: true }
  | { ok: false; status: 400 | 403; error: string }

/**
 * May this viewer take this seat on this item?
 *
 * Deliberately does NOT look at owner_id / scheduler_ids: whether the seat is
 * still empty is decided by the UPDATE's WHERE clause, so that two people
 * clicking at once can never both win.
 */
export function claimDecision(
  item: ClaimItem,
  viewer: { id: string; role: Role },
  hat: ClaimHat,
): ClaimDecision {
  if (viewer.role === 'client') {
    return { ok: false, status: 403, error: 'Client accounts cannot pick up work' }
  }
  if (item.is_brief) {
    return { ok: false, status: 400, error: 'A shoot brief is owned by its account manager' }
  }

  const inScheduling = (SCHEDULER_STATUSES as readonly string[]).includes(item.status)

  if (hat === 'editor') {
    if (inScheduling) return { ok: false, status: 400, error: 'This one is past editing' }
    // a scheduler picking up someone's unstarted draft is not a thing
    if (viewer.role === 'scheduler') {
      return { ok: false, status: 403, error: 'Editing work is handed to you, not picked up' }
    }
    return { ok: true }
  }

  if (!inScheduling || item.status === 'published') {
    return { ok: false, status: 400, error: 'This one is not ready for scheduling yet' }
  }
  // the OPEN scheduling pool is schedulers only — anyone else gets handed the
  // item explicitly, which is what puts them in scheduler_ids
  if (viewer.role !== 'scheduler' && viewer.role !== 'super_admin') {
    return { ok: false, status: 403, error: 'Scheduling is handed to you, not picked up' }
  }
  return { ok: true }
}

/**
 * "Revisions done" has to mean a revision happened.
 *
 * True when changes were requested and no version has landed since. With no
 * record of a request (a legacy item, logged before the audit trail), there
 * is nothing to compare against and the move is allowed.
 */
export function needsNewVersion(
  latestVersionAt: string | null,
  revisionRequestedAt: string | null,
): boolean {
  if (!revisionRequestedAt) return false
  if (!latestVersionAt) return true
  return !(new Date(latestVersionAt).getTime() > new Date(revisionRequestedAt).getTime())
}
