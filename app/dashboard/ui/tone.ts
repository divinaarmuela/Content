import type { ChipTone } from './Chip'
import type { WorkTone } from './WorkCard'

/**
 * ONE tone map for the three boards.
 *
 * Production, Editor and Scheduler each had their own copy of these three
 * things — the card tint rule, the work-kind chip colours and the approval
 * gate chip colours. Three copies agreed by hand, and they had already
 * drifted: "the client asked for changes" was red on the Editor board and
 * amber on the Scheduler queue, so the same fact looked like two different
 * facts depending on which page you were standing on. They live here now,
 * pure and exported, and the boards import them.
 *
 * Nothing in this file fetches, subscribes or decides anything. It is a
 * lookup table with a test pinning it.
 */

/** Today in Melbourne-agnostic `YYYY-MM-DD` — the reader's own local date,
 *  the same string shape the rows carry. Injectable so a test never depends
 *  on the clock. */
export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * THE COLOUR OF A CARD IS THE THING THAT NEEDS A PERSON.
 *
 * In order, loudest first:
 *
 * - `ink`    — live. It is out and finished; it is the current thing.
 * - `red`    — it came back or it failed. Something went wrong and a person owns it.
 * - `amber`  — the date has arrived. This is the card somebody picks up today.
 * - `green`  — approved. Good news, ready to move.
 * - `blue`   — scheduled. Good news, already booked in.
 * - undefined — a plain white `surface` card, which is most of the board.
 *
 * A board where only three cards are coloured is a board you can read from
 * the doorway, so the plain card is the default and stays the default.
 */
export function cardTone(input: {
  status: string
  /** a due or shoot date, `YYYY-MM-DD` or an ISO timestamp; null when there is none */
  due?: string | null
  /** the approval gate came back asking for changes */
  changesRequested?: boolean
  /** the post did not go out */
  failed?: boolean
  /** today, for a test */
  today?: string
}): WorkTone | undefined {
  const { status, due, changesRequested, failed } = input
  const today = input.today ?? todayKey()
  if (status === 'published') return 'ink'
  if (failed || changesRequested || status === 'client_changes_requested') return 'red'
  if (due && due.slice(0, 10) <= today) return 'amber'
  if (status === 'approved_for_scheduling') return 'green'
  if (status === 'scheduled') return 'blue'
  return undefined
}

/** A work kind's stored colour, as a chip tone — the palette has five, not eight. */
export const KIND_TONE: Record<string, ChipTone> = {
  zinc: 'muted', pink: 'red', rose: 'red', sky: 'blue', indigo: 'blue',
  violet: 'blue', emerald: 'green', amber: 'amber',
}

/** A work kind's chip tone, with the fallback the boards all used. */
export function kindTone(color: string | null | undefined): ChipTone {
  return KIND_TONE[color ?? 'zinc'] ?? 'muted'
}

/**
 * Where the final post stands, as a chip tone.
 *
 * The keys are exactly what `approvalChip()` returns — `waiting | approved |
 * changes`. It used to carry a `pending` key that nothing could ever look up,
 * which meant "waiting on approval" fell through to the plain muted grey and
 * the blue that was written down was never seen.
 */
export const GATE_TONE: Record<'waiting' | 'approved' | 'changes', ChipTone> = {
  waiting: 'blue', approved: 'green', changes: 'red',
}
