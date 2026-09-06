/**
 * Pure comment-visibility logic — no I/O, fully unit-testable.
 *
 * Who reads which comments on an item. Managers see the whole record; the
 * people doing the work see their own conversations. The rule that keeps
 * that honest: a comment reaches an editor or scheduler only when it is
 * ADDRESSED to them — tagged to them, written by them, or a reply inside a
 * thread they are already part of. A manager musing to another manager is
 * never broadcast to whoever happens to hold the job.
 */

import type { Role } from './identity-core'

export type VisibilityComment = {
  id: string
  author_id: string | null
  visibility: string
  assigned_to: string | null
  parent_id: string | null
}

/** Roles that read every comment on an item, client rows included. */
const FULL_ACCESS: Role[] = ['account_manager', 'super_admin']

/**
 * THE CLIENT IS TALKING TO THEIR MANAGER, NOT TO THE ROOM.
 *
 * The owner's rule: "make sure AM can see the client comments only and then
 * if needs changes can send back to the person assigned". A client's words
 * on a card reach the account manager (and a super admin); an editor or a
 * scheduler never reads them — what they get is the manager's own words,
 * sent back with the card. A client reads their own thread, of course.
 */
export function canReadClientComments(role: Role | null | undefined): boolean {
  return role === 'account_manager' || role === 'super_admin'
}

/** The client-visible rows of a thread, for someone allowed to read them —
 *  and nothing at all for anyone else. */
export function clientCommentsFor<T extends { visibility: string }>(role: Role | null | undefined, comments: readonly T[]): T[] {
  if (!canReadClientComments(role)) return []
  return comments.filter(c => c.visibility === 'client')
}

/**
 * Filter a thread for one viewer.
 *
 * - client: only comments marked client-visible
 * - account_manager / super_admin: everything
 * - editor / scheduler: internal comments in their own conversations —
 *   authored by them, tagged to them, or a reply within such a thread
 */
export function visibleComments<T extends VisibilityComment>(
  role: Role, viewerId: string, comments: T[],
): T[] {
  if (role === 'client') return comments.filter(c => c.visibility === 'client')
  if (FULL_ACCESS.includes(role)) return comments

  // a thread belongs to the viewer once any comment in it names them: the
  // root they were tagged in, or a root they wrote themselves
  const mine = (c: VisibilityComment) => c.author_id === viewerId || c.assigned_to === viewerId
  const ownedThreads = new Set<string>()
  for (const c of comments) {
    if (mine(c)) ownedThreads.add(c.parent_id ?? c.id)
  }
  return comments.filter(c =>
    c.visibility === 'internal' && (mine(c) || ownedThreads.has(c.parent_id ?? c.id)))
}
