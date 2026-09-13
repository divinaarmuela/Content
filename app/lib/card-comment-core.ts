/**
 * CARD COMMENTS — where a comment's email should land, by role (13 Sep 2026).
 * Pure: no I/O. The old link opened the retired full-card page; every
 * role now opens the card ON THE BOARD they have, with `?card=` as the
 * boards read it (useCardSheet).
 */

export type CommentRole = 'super_admin' | 'account_manager' | 'general' | 'editor' | 'scheduler' | 'quality_checker' | 'client' | string

/** The path (no host) that opens this card for a person of this role. */
export function cardPathForRole(role: CommentRole | null | undefined, itemId: string): string {
  if (role === 'editor') return `/dashboard/editor?card=${itemId}`
  // schedulers, quality checkers, managers, general: the Post approval board
  return `/dashboard/scheduler?card=${itemId}`
}

/**
 * Who is told about a team note, beyond whoever was tagged: the card's
 * holder(s) — its owner and the schedulers it was handed to — the client's
 * account managers, and the super admin who created the card (they asked
 * for it). Never the author, never anyone already tagged. Pure.
 */
export function noteAudience(input: {
  authorId: string
  ownerId?: string | null
  schedulerIds?: readonly string[]
  managerIds?: readonly string[]
  /** the card's creator, when a super admin */
  creatorId?: string | null
  creatorIsSuperAdmin?: boolean
  taggedIds?: readonly string[]
}): string[] {
  const ids = [
    ...(input.ownerId ? [input.ownerId] : []),
    ...(input.schedulerIds ?? []),
    ...(input.managerIds ?? []),
    ...(input.creatorIsSuperAdmin && input.creatorId ? [input.creatorId] : []),
  ]
  const tagged = new Set(input.taggedIds ?? [])
  return [...new Set(ids)].filter(id => id && id !== input.authorId && !tagged.has(id))
}

/** The subject line of a note's email: who wrote what on which card. */
export function noteSubject(author: string, cardTitle: string, text: string): string {
  const snippet = text.trim().replace(/\s+/g, ' ').slice(0, 120)
  return `${author} wrote on ${cardTitle}: \u201c${snippet}${text.trim().length > 120 ? '\u2026' : ''}\u201d`
}
