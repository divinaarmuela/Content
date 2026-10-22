/**
 * REACTIONS ON A COMMENT (the owner, 22 Oct 2026: "also in comments can u
 * please add reactions") — pure, no I/O.
 *
 * A comment row (`item_comments.reactions`) holds `{ [emoji]: teamUserId[] }`.
 * One press toggles one person's one emoji. Only the fixed set below is ever
 * stored, so a key is always a short known string (RTDB keys cannot hold
 * `. # $ [ ] /`, and none of these do). No notification is sent for a
 * reaction — it is a nod, not a message.
 */

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '👀', '✅', '🔥'] as const
export type ReactionEmoji = typeof REACTION_EMOJIS[number]
export type Reactions = Partial<Record<ReactionEmoji, string[]>>

export function isReactionEmoji(v: unknown): v is ReactionEmoji {
  return typeof v === 'string' && (REACTION_EMOJIS as readonly string[]).includes(v)
}

/** The row's reactions as stored, cleaned: known emojis only, unique string
 *  ids, empty lists dropped. RTDB may hand back a list as an object keyed
 *  0,1,2 — read either. */
export function reactionsOf(raw: unknown): Reactions {
  const out: Reactions = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isReactionEmoji(k)) continue
    const list = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []
    const ids = [...new Set(list.filter((x): x is string => typeof x === 'string' && x.length > 0))]
    if (ids.length > 0) out[k] = ids
  }
  return out
}

/** Add `userId` to `emoji` if absent, take it away if present. */
export function toggleReaction(raw: unknown, emoji: ReactionEmoji, userId: string): Reactions {
  const cur = reactionsOf(raw)
  const ids = cur[emoji] ?? []
  const next = ids.includes(userId) ? ids.filter(i => i !== userId) : [...ids, userId]
  const out: Reactions = { ...cur }
  if (next.length > 0) out[emoji] = next
  else delete out[emoji]
  return out
}

/** The chips under a comment, in the picker's order. */
export function reactionChips(raw: unknown, meId: string | null | undefined): { emoji: ReactionEmoji; count: number; mine: boolean; ids: string[] }[] {
  const r = reactionsOf(raw)
  return REACTION_EMOJIS.filter(e => (r[e]?.length ?? 0) > 0)
    .map(e => ({ emoji: e, count: r[e]!.length, mine: !!meId && r[e]!.includes(meId), ids: r[e]! }))
}
