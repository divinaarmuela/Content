import type { Role } from './identity-core'

// Deliberately imports NOTHING from workflow-core: the state machine reads
// this module (whoseTurn asks it who was asked), so it cannot also be read by
// it. Whose turn each status is arrives as an argument instead.

/**
 * WHO WAS ACTUALLY ASKED — and why one person acting clears it for everyone.
 *
 * Whose turn it is was worked out from the status and the role: a card in
 * Internal check said "your turn" to every manager on that client, and sat on
 * all of their Overviews until somebody moved it. Picking reviewers narrowed
 * the EMAIL and nothing else, so the room still carried the card.
 *
 * Asking somebody is assigning them. The people asked are written on the card
 * (`asked_ids`, with `asked_at`), and while they are set they ARE the queue:
 * the Overview counts the card for them and for nobody else, and the boards
 * show "your turn" to them and to nobody else. With nothing set, everything
 * behaves exactly as it did — the role-based rule is the fallback, not a
 * legacy path.
 *
 * And it is cleared by the next thing that happens to the card, in the SAME
 * write as the move. That is the owner's rule: "if anyone that's been
 * notified and it's been actioned, it shouldn't be in the Overview page,
 * because someone that was notified had actioned it." Two of three managers
 * never open it; the moment the third approves, it leaves all three
 * Overviews. A second round trip to clear it could leave the card asked-of
 * forever if it failed, so there is no second round trip.
 *
 * Pure: no I/O. `workflow.ts` and the routes do the writing.
 */

/** The shape every reader needs — the card, however it reached them. */
export type AskedItem = {
  asked_ids?: unknown
  asked_at?: string | null
}

/** Ids of the people asked, read tolerantly: the column may be missing, null,
 *  a stale object, or hold something that is not an id. */
export function askedIdsOf(item: AskedItem | null | undefined): string[] {
  const raw = item?.asked_ids
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, 20)
}

/** Has somebody been asked, specifically? */
export function isAsked(item: AskedItem | null | undefined): boolean {
  return askedIdsOf(item).length > 0
}

/**
 * Is this card waiting on THIS person?
 *
 * Nobody asked means the old question still stands and the caller's own
 * role-based rule decides — so this answers `true` and lets it through.
 * Somebody asked means exactly those people, and nobody else.
 */
export function waitingOnViewer(item: AskedItem | null | undefined, viewerId: string): boolean {
  const ids = askedIdsOf(item)
  return ids.length === 0 || ids.includes(viewerId)
}

/** What the people asked were asked FOR, in the words of the stage. */
export const ASKED_VERB: Record<Role, string> = {
  super_admin: 'to check',
  account_manager: 'to check',
  general: 'to make and post',
  editor: 'to make',
  scheduler: 'to post',
  client: 'to look at',
}

/** "Divina", "Divina and Yusuf", "Divina, Yusuf and Sam" — never an id. */
export function nameList(ids: readonly string[], names: ReadonlyMap<string, string>): string {
  const words = ids.map(id => names.get(id) ?? 'someone')
  if (words.length === 0) return ''
  if (words.length === 1) return words[0]
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/**
 * "With Divina to check" / "With Yusuf to post" — the line beside Who.
 *
 * It sits BESIDE the person on the card, never instead of them: who holds a
 * card and who was asked to do the next thing to it are two different facts,
 * and a card handed to an editor for a cut is both.
 *
 * `null` when nobody was asked, so the surfaces draw nothing rather than an
 * empty label.
 */
export function askedWords(
  item: AskedItem & { status?: string },
  names: ReadonlyMap<string, string>,
  /** whose turn each status is — `STATUS_TURN`, or a brief's own vocabulary */
  turns: Record<string, Role | null>,
): string | null {
  const ids = askedIdsOf(item)
  if (ids.length === 0) return null
  const hat = item.status ? turns[item.status] ?? null : null
  const verb = hat ? ASKED_VERB[hat] : null
  const who = nameList(ids, names)
  return verb ? `With ${who} ${verb}` : `With ${who}`
}

/**
 * The fields to write. ONE object, merged into the same update as the move,
 * so the card never sits half-changed.
 *
 * `null` removes the column: nobody is asked any more, which is what every
 * transition, send-back and approval means.
 */
export function askedPatch(ids: readonly string[] | null | undefined, at?: string): {
  asked_ids: string[] | null
  asked_at: string | null
} {
  const clean = (ids ?? [])
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .filter((x, i, all) => all.indexOf(x) === i)
    .slice(0, 20)
  if (clean.length === 0) return { asked_ids: null, asked_at: null }
  return { asked_ids: clean, asked_at: at ?? new Date().toISOString() }
}

/** The clear, named — every caller that ends an ask says it the same way. */
export const NOBODY_ASKED = { asked_ids: null, asked_at: null } as const
