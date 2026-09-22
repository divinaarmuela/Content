/**
 * CARD COMMENTS — where a comment's email should land, by role (13 Sep 2026).
 * Pure: no I/O. The old link opened the retired full-card page; every
 * role now opens the card ON THE BOARD they have, with `?card=` as the
 * boards read it (useCardSheet).
 */import { reviewPath } from './video-review-core'


export type CommentRole = 'super_admin' | 'account_manager' | 'general' | 'editor' | 'scheduler' | 'quality_checker' | 'client' | string

/** The path (no host) that opens this card for a person of this role. */
export function cardPathForRole(role: CommentRole | null | undefined, itemId: string): string {
  if (role === 'editor') return `/dashboard/editor?card=${itemId}`
  // schedulers, quality checkers, managers, general: the Post approval board
  return `/dashboard/scheduler?card=${itemId}`
}

/**
 * A NOTE ON A CLIP LINKS TO THE CLIP (the owner, 18 Sep 2026: "the link in the
 * email takes them to the card, make sure it takes them to that page"): the
 * clip page — the clip on the left, its comments on the right — for everyone
 * whose pages include the Editor page. A scheduler's do not, so they land on
 * their board with the card open, as before.
 */
export function commentPathForRole(role: CommentRole | null | undefined, itemId: string, clip?: { id: string | null; name?: string | null } | null): string {
  if (clip?.id && role !== 'scheduler') return reviewPath(itemId, clip.id, clip.name ?? null)
  return cardPathForRole(role, itemId)
}

/** the bell carries the clip in the entity id: "<card>#<comment>#holder#clip:<file>" */
export function commentEntityId(itemId: string, commentId: string, suffix: string | null, clipId: string | null): string {
  return `${itemId}#${commentId}${suffix ? `#${suffix}` : ''}${clipId ? `#clip:${clipId}` : ''}`
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

/**
 * SAID ALREADY (the owner, 22 Sep 2026: "comment showing two is not right — that's not two comments").
 * A send-back note that only repeats, word for word, a comment already on the card — the client's
 * words on a clip, copied into the note when their change was logged — is the same comment, not a
 * second one. The send-back does not write it again, and a card that already holds such a copy
 * draws and counts it once, on the clip.
 */
const sameWords = (a: unknown, b: unknown) => {
  const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  const x = norm(a)
  return x.length > 0 && x === norm(b)
}

/** does the card's thread already say this, in these words? */
export function repeatsAComment(note: string, thread: readonly { body?: string | null }[]): boolean {
  return thread.some(c => sameWords(c.body, note))
}

/** the thread without a card-level row that only repeats a clip's comment — the clip's row is the one drawn */
export function withoutRepeatedNotes<T extends { body?: string | null; video_file_id?: string | null }>(thread: readonly T[]): T[] {
  const onClips = thread.filter(c => !!c.video_file_id)
  return thread.filter(c => !!c.video_file_id || !onClips.some(k => sameWords(k.body, c.body)))
}
