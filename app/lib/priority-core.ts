/**
 * A CARD'S PRIORITY (the owner, 21 Sep 2026: "in the editor and designer add
 * a priority option, and a filter"). Four words, Normal being the default
 * every card already carries; High and Urgent wear a chip on the card so
 * they stand out in a crowded column; Low wears none. Pure: no I/O.
 */
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type Priority = typeof PRIORITIES[number]
export const PRIORITY_LABELS: Record<Priority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }

export function isPriority(v: unknown): v is Priority {
  return typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v)
}

/** the card's priority — Normal when unset or unknown */
export function priorityOf(card: { priority?: unknown } | null | undefined): Priority {
  return isPriority(card?.priority) ? card.priority : 'normal'
}

/** a filter choice read from the address or storage — null when it is not one of the four */
export function priorityChoice(v: string | null | undefined): Priority | null {
  return isPriority(v) ? v : null
}

/** the chip on the card: High and Urgent only — the rest is the default and says nothing */
export function priorityChip(card: { priority?: unknown } | null | undefined): { label: string; tone: 'red' | 'amber' } | null {
  const p = priorityOf(card)
  if (p === 'urgent') return { label: 'Urgent', tone: 'red' }
  if (p === 'high') return { label: 'High priority', tone: 'amber' }
  return null
}

/** " at high priority" — the filter's words */
export function priorityWords(p: Priority): string {
  return `at ${PRIORITY_LABELS[p].toLowerCase()} priority`
}
