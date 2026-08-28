/**
 * Pure who-may-touch-an-item rules — no I/O.
 *
 * The owner's rule, verbatim: "AM and super admins will edit too, and
 * scheduler/editor can create production items too" and "any team member, any
 * client" for tasks. These functions ARE that rule; the API routes call them
 * and the e2e role-play proves them against real rows.
 */

import type { Role } from './identity-core'
import { schedulerIdsOf } from './workflow-core'

/** Every team role may CREATE work — never a client. Which kinds a role may
 *  create is still the shoot gate's business (canCreateItemsUnder). */
export function roleMayCreateItems(role: Role): boolean {
  return role !== 'client'
}

/**
 * May this person edit this item's fields?
 *
 * Managers (AM + super admin) edit anything — reviewing is the job and it is
 * not per-item. Everyone else edits their OWN: the item's owner, or anyone
 * the scheduling was handed to. The narrower caption / plan-fields / due-date
 * exceptions stay with the routes — this is the general-fields rule.
 */
export function canEditItemFields(
  viewer: { id: string; role: Role },
  item: { owner_id?: string | null; scheduler_ids?: unknown },
): boolean {
  if (viewer.role === 'client') return false
  if (viewer.role === 'account_manager' || viewer.role === 'super_admin') return true
  return item.owner_id === viewer.id || schedulerIdsOf(item).includes(viewer.id)
}

/**
 * Does the client-team check apply to this creation?
 *
 * A TASK (research, strategy, copy — no media, not a shoot plan) is internal
 * work, not client-confidential: any team member may raise one for any
 * client. Shoots, shoot plans and assets keep the scoped list — those carry
 * a client's unreleased material.
 */
export function taskExemptFromClientScope(
  kind: { slug?: string | null; uses_media?: boolean | null } | null | undefined,
): boolean {
  if (!kind) return false
  return kind.slug !== 'shoot_brief' && kind.uses_media === false
}
