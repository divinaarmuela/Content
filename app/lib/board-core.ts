/**
 * THE SIX COLUMNS — defined once, drawn everywhere.
 *
 * Ten statuses is how the state machine thinks; six columns is how a
 * person sees the board. The sixth, Quality check, arrived with the Team's
 * Playbook (11 Sep 2026): every piece passes a quality reviewer between the
 * account manager's check and the client. Production, Editor, Scheduler and the client
 * portal all read this file for what a column is called, what it means and
 * which statuses sit under it — so the same card is in the same column on
 * every screen, and nobody ever re-derives the mapping in a page.
 *
 * The statuses and the edges between them are NOT touched here: `canMoveTo`
 * asks `workflow-core` whether a drag is legal, exactly as a button would.
 * There is no second rule set.
 *
 * Pure: no I/O, no `server-only`. Client components import it.
 */

import {
  availableTransitionsAs, checkTransitionAs, ITEM_STATUSES, STATUS_LABELS,
  type ItemStatus,
} from './workflow-core'
import type { Role } from './identity-core'
import type { Hat } from './workflow-core'

export type BoardColumnKey = 'draft' | 'internal_check' | 'quality_check' | 'with_client' | 'ready_to_post' | 'booked' | 'posted'

export type BoardColumn = {
  key: BoardColumnKey
  /** what the column is called on screen — plain words */
  label: string
  /** one sentence for somebody new: what being here means */
  meaning: string
  /** the statuses underneath, in the order the funnel walks them */
  statuses: readonly ItemStatus[]
}

/** The board, left to right. */
export const BOARD_COLUMNS: readonly BoardColumn[] = [
  {
    key: 'draft',
    label: 'Draft',
    meaning: 'Being made. Nobody has checked it yet.',
    statuses: ['draft_uploaded'],
  },
  {
    key: 'internal_check',
    label: 'Internal check',
    meaning: 'An account manager is checking it, or changes are being made.',
    statuses: ['internal_review', 'revision_required', 'revision_complete'],
  },
  {
    key: 'quality_check',
    label: 'Quality check',
    meaning: 'The quality reviewer is checking it before it goes to the client or a scheduler.',
    statuses: ['quality_check'],
  },
  {
    key: 'with_client',
    label: 'With client',
    meaning: 'The client is looking at it, or has asked for changes.',
    statuses: ['client_review', 'client_changes_requested'],
  },
  {
    key: 'ready_to_post',
    label: 'Ready to post',
    meaning: 'Signed off. Needs a posting time.',
    statuses: ['approved_for_scheduling'],
  },
  // BOOKED IN is its own column (11 Sep 2026). A post the channel holds for
  // Sunday used to sit under "Posted" with only a chip to say it was not
  // out yet; a glance at the board read it as live. The column header now
  // says the truth. "Booked in" is the owner's word for it, never
  // "Scheduled".
  {
    key: 'booked',
    label: 'Booked in',
    meaning: 'The channel has it and will post it at its time.',
    statuses: ['scheduled'],
  },
  {
    key: 'posted',
    label: 'Posted',
    meaning: 'Already live.',
    statuses: ['published'],
  },
]

/** The columns past the point of doing: booked with the channel, or live. */
export const OUT_COLUMNS: readonly BoardColumnKey[] = ['booked', 'posted']
/** Is this status out of the team's hands — booked in or already posted? */
export function isOut(status: ItemStatus): boolean {
  return OUT_COLUMNS.includes(COLUMN_OF_STATUS[status])
}

const COLUMN_BY_KEY: Record<BoardColumnKey, BoardColumn> = Object.fromEntries(
  BOARD_COLUMNS.map(c => [c.key, c]),
) as Record<BoardColumnKey, BoardColumn>

const COLUMN_OF_STATUS: Record<ItemStatus, BoardColumnKey> = Object.fromEntries(
  BOARD_COLUMNS.flatMap(c => c.statuses.map(s => [s, c.key])),
) as Record<ItemStatus, BoardColumnKey>

/** The column a status sits in. Every status has exactly one. */
export function columnOf(status: ItemStatus): BoardColumnKey {
  return COLUMN_OF_STATUS[status]
}

/** A column's own row of the table above. */
export function boardColumn(key: BoardColumnKey): BoardColumn {
  return COLUMN_BY_KEY[key]
}

/** The statuses under a column, in funnel order. */
export function statusesIn(column: BoardColumnKey): readonly ItemStatus[] {
  return COLUMN_BY_KEY[column].statuses
}

/**
 * Which columns a ROLE is shown.
 *
 * Every team role sees all six — the owner's rule is "all pages should have
 * the columns", so an editor watches their card go on to the client and out
 * the door, and a scheduler sees what is coming before it is ready. How a
 * PAGE arranges them — the stages that person works given room, the rest
 * folded into one narrow lane — is `pageLanes` in board-view-core. What a
 * role may MOVE is still the transition rules' business (canMoveTo). A
 * client's portal is the With-client column and nothing else — the rest of
 * the funnel is how the agency works, not what the client is asked to look at.
 */
export function columnsForRole(role: Role | null): BoardColumnKey[] {
  switch (role) {
    case 'editor':
    case 'scheduler':
    case 'account_manager':
    case 'super_admin': return BOARD_COLUMNS.map(c => c.key)
    case 'client': return ['with_client']
    default: return []
  }
}

/** Group cards by column, every column present (empty arrays included), in
 *  board order. Input order within a column is preserved. */
export function groupByColumn<T extends { status: string }>(
  cards: readonly T[],
  columns: readonly BoardColumnKey[] = BOARD_COLUMNS.map(c => c.key),
): { column: BoardColumn; cards: T[] }[] {
  const buckets = new Map<BoardColumnKey, T[]>(columns.map(k => [k, []]))
  for (const card of cards) {
    const key = COLUMN_OF_STATUS[card.status as ItemStatus]
    buckets.get(key)?.push(card)
  }
  return columns.map(k => ({ column: COLUMN_BY_KEY[k], cards: buckets.get(k)! }))
}

/** What `canMoveTo` reads off a card. `hats` come from `actingRoles`. */
export type BoardCard = { status: ItemStatus }

export type MoveDecision =
  | { ok: true; to: ItemStatus; label: string }
  | { ok: false; reason: string }

/**
 * May these hats drag this card into this column — and if so, which status
 * does the drop land on?
 *
 * A column with several statuses is entered at the FIRST one the person may
 * legally reach, in funnel order: an account manager dropping a card on
 * Internal check from With client lands it on "Ask for changes"
 * (revision_required), because that is the only edge they hold into that
 * column. The legality comes straight from `workflow-core` — the same rules
 * as the buttons, never a copy of them — so a drag can do nothing a button
 * could not. Refused moves carry the machine's own plain sentence.
 */
export function canMoveTo(card: BoardCard, column: BoardColumnKey, hats: readonly Hat[]): MoveDecision {
  const target = COLUMN_BY_KEY[column]
  const from = card.status
  if (COLUMN_OF_STATUS[from] === column) {
    return { ok: false, reason: `Already in ${target.label}` }
  }
  // the offers the buttons would make, filtered to this column, first wins
  const offered = availableTransitionsAs(hats, from)
  for (const to of target.statuses) {
    const hit = offered.find(o => o.to === to)
    if (hit) return { ok: true, to, label: hit.label }
  }
  // refused: prefer the sentence for an edge that exists but is not theirs
  // ("editor may not perform …") over "no such move" — it tells the person
  // whose move it is
  for (const to of target.statuses) {
    const check = checkTransitionAs(hats, from, to)
    if (!check.ok && !check.reason.startsWith('No transition')) return { ok: false, reason: check.reason }
  }
  return { ok: false, reason: `Nothing moves from ${STATUS_LABELS[from]} to ${target.label}` }
}

/** Every column a card may be dragged to by these hats, with the status it
 *  would land on — what a board highlights while a card is being dragged. */
export function reachableColumns(card: BoardCard, hats: readonly Hat[]): { column: BoardColumnKey; to: ItemStatus; label: string }[] {
  const out: { column: BoardColumnKey; to: ItemStatus; label: string }[] = []
  for (const c of BOARD_COLUMNS) {
    const d = canMoveTo(card, c.key, hats)
    if (d.ok) out.push({ column: c.key, to: d.to, label: d.label })
  }
  return out
}

/** Every status, so a test can prove each belongs to exactly one column. */
export const ALL_STATUSES: readonly ItemStatus[] = ITEM_STATUSES
