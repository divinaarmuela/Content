/**
 * Pure quota-card logic — no I/O.
 *
 * Creating "5 reels" used to mean five titled cards on the board before a
 * frame was edited. A deliverable GROUP is the promise itself: one row saying
 * "5 reels for this client", drawn as one card that fills up — "Reels · 2 of
 * 5" — as pieces are actually added to it.
 *
 * The group is presentation only. The client's agreement counts PUBLISHED
 * items exactly as before (agreement-core), the portal shows published
 * pieces, and an item with no group renders exactly as it always has. A
 * group with target 1 is not a quota at all and renders as a plain card.
 */

import type { ItemStatus } from './workflow-core'

export type DeliverableGroup = {
  id: string
  client_id: string
  batch_id?: string | null
  content_type: string
  title: string
  target: number
  /** the kind of work the pieces are; null means a plain content item */
  work_kind_id?: string | null
  work_kinds?: { slug?: string | null; uses_media?: boolean | null; name?: string | null; color?: string | null } | null
  created_by?: string | null
  created_at?: string
}

/** A TASK group lives on the Production board; everything else on Editor. */
export function isTaskGroup(g: DeliverableGroup): boolean {
  const k = g.work_kinds
  return !!k && k.slug !== 'shoot_brief' && k.uses_media === false
}

export type GroupableItem = {
  id: string
  status: ItemStatus
  group_id?: string | null
}

/** One card on the board: the group, its pieces so far, and where it sits. */
export type GroupCard<T extends GroupableItem> = {
  group: DeliverableGroup
  items: T[]
  /** pieces made so far — the "2" of "2 of 5" */
  count: number
  /** the promise — the "of 5" */
  target: number
  /** true once every promised piece exists */
  full: boolean
  /**
   * The status whose lane this card sits in: the LEAST advanced open piece,
   * because a quota card is about the work still owed — a group with one
   * published reel and one first draft belongs with the draft. With no
   * pieces yet it sits at the very start: nothing has begun.
   */
  laneStatus: ItemStatus
}

/** The one order the pipeline moves in — used to find the least-advanced piece. */
const STATUS_ORDER: ItemStatus[] = [
  'draft_uploaded', 'internal_review', 'revision_required', 'revision_complete',
  'client_review', 'client_changes_requested', 'approved_for_scheduling',
  'scheduled', 'published',
]
const rank = (s: ItemStatus) => {
  const i = STATUS_ORDER.indexOf(s)
  return i === -1 ? 0 : i
}

/**
 * Split a board's rows into quota cards and plain items.
 *
 * An item whose group_id names a group the caller holds is folded into that
 * group's card and never rendered on its own. An item pointing at a group
 * this list does not contain (deleted, or filtered away) falls back to being
 * a plain card — a card is always better than a vanished piece of work.
 * A target-1 group is a plain promise, not a quota: its items render as
 * ordinary cards and no group card is drawn for it.
 */
export function splitByGroup<T extends GroupableItem>(
  items: T[], groups: DeliverableGroup[],
): { groupCards: GroupCard<T>[]; plainItems: T[] } {
  const byId = new Map(groups.filter(g => g.target > 1).map(g => [g.id, g]))
  const members = new Map<string, T[]>()
  const plainItems: T[] = []
  for (const item of items) {
    const g = item.group_id ? byId.get(item.group_id) : undefined
    if (!g) { plainItems.push(item); continue }
    const list = members.get(g.id) ?? []
    list.push(item)
    members.set(g.id, list)
  }
  const groupCards = groups
    .filter(g => g.target > 1)
    .map(g => groupCard(g, members.get(g.id) ?? []))
  return { groupCards, plainItems }
}

/** One group's card, derived from its pieces. */
export function groupCard<T extends GroupableItem>(
  group: DeliverableGroup, items: T[],
): GroupCard<T> {
  const target = Math.max(1, group.target)
  const count = items.length
  const open = items.filter(i => i.status !== 'published')
  const laneStatus: ItemStatus = count === 0
    ? 'draft_uploaded'
    : (open.length > 0 ? open : items)
        .reduce((lo, i) => (rank(i.status) < rank(lo.status) ? i : lo)).status
  return { group, items, count, target, full: count >= target, laneStatus }
}

/** "Reels · 2 of 5" — the card's one line. */
export function groupLine(card: { group: DeliverableGroup; count: number; target: number }): string {
  return `${card.group.title} · ${card.count} of ${card.target}`
}

/** The next piece's title: "October reels 03". Numbered by how many exist,
 *  padded so the files sort the way people expect. */
export function nextPieceTitle(group: { title: string }, existingCount: number): string {
  return `${group.title} ${String(existingCount + 1).padStart(2, '0')}`
}

/** What the primary button says: "Add the next reel". */
export function addNextLabel(group: { content_type: string }): string {
  const word = group.content_type && group.content_type !== 'other' ? group.content_type : 'piece'
  return `Add the next ${word}`
}
