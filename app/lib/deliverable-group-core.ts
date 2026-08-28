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

/** One line of a mixed promise: "2 reels", "2 carousels". */
export type PlannedFormat = { type: string; qty: number }

export type DeliverableGroup = {
  id: string
  client_id: string
  batch_id?: string | null
  content_type: string
  title: string
  target: number
  /**
   * A MIX of formats in one card — [{type:'reel',qty:2},{type:'carousel',qty:2}].
   * `target` stays the sum and `content_type` the first/primary type, so a
   * single-format group (this null) behaves exactly as before. The column is
   * added by hand later; every reader tolerates its absence, so until then
   * `planned` is simply null everywhere and groups stay single-format.
   */
  planned?: PlannedFormat[] | null
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
  /** the piece's own format — the "reel" vs "carousel" a mixed card counts by.
   *  Optional so single-format callers need not supply it. */
  content_type?: string | null
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

// ─────────────────────────── mixed-format groups ───────────────────────────
// A card can promise a MIX — 2 reels + 2 carousels + 2 videos — carried in the
// group's `planned` list. Everything below tolerates `planned` being null (the
// column not migrated, or an old single-format group) by falling straight back
// to the single-format behaviour above.

/** singular / plural word per format, so counts read as English. */
const FORMAT_WORDS: Record<string, [string, string]> = {
  reel: ['reel', 'reels'],
  carousel: ['carousel', 'carousels'],
  story: ['story', 'stories'],
  static: ['graphic', 'graphics'],
  video: ['video', 'videos'],
  other: ['piece', 'pieces'],
}

/** "reel" / "reels" for a count — an unknown type just takes an "s". */
export function pluralType(type: string, n: number): string {
  const pair = FORMAT_WORDS[type]
  if (pair) return n === 1 ? pair[0] : pair[1]
  const base = type || 'piece'
  return n === 1 ? base : `${base}s`
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/**
 * Clean the raw `planned` value into merged {type, qty} rows, or null.
 *
 * Null (and any non-array / empty value) means "not a mix" — the caller then
 * uses the single `content_type` + `target` exactly as before. Duplicate types
 * are summed so "2 reels + 1 reel" is one "3 reels" row, and only whole
 * positive quantities survive.
 */
export function plannedFormats(group: { planned?: PlannedFormat[] | null }): PlannedFormat[] | null {
  const raw = group.planned
  if (!Array.isArray(raw) || raw.length === 0) return null
  const merged = new Map<string, number>()
  for (const r of raw) {
    const type = typeof r?.type === 'string' ? r.type.trim().slice(0, 20) : ''
    const qty = Math.floor(Number(r?.qty))
    if (!type || !Number.isFinite(qty) || qty < 1) continue
    merged.set(type, (merged.get(type) ?? 0) + Math.min(100, qty))
  }
  if (merged.size === 0) return null
  return [...merged.entries()].map(([type, qty]) => ({ type, qty }))
}

/** The pieces promised across every format — the "of 6". */
export function plannedTarget(rows: PlannedFormat[]): number {
  return rows.reduce((s, r) => s + Math.max(0, Math.floor(r.qty || 0)), 0)
}

/** True only when the card promises MORE THAN ONE format — a single-format
 *  `planned` (one row) still renders as the plain "Reels · 2 of 5" card. */
export function isMixedGroup(group: { planned?: PlannedFormat[] | null }): boolean {
  const rows = plannedFormats(group)
  return !!rows && rows.length > 1
}

export type FormatProgress = { type: string; done: number; target: number }

/**
 * How full each promised format is, counted from the pieces' OWN content_type.
 * A single-format group (null planned) collapses to one row driven by the
 * group's content_type and item count — identical to today. Over-fill (more
 * pieces of a type than promised) reports the real `done`; pieces whose type
 * is not in the plan simply do not land in any row.
 */
export function formatBreakdown<T extends GroupableItem>(
  group: DeliverableGroup, items: T[],
): FormatProgress[] {
  const rows = plannedFormats(group)
  if (!rows) {
    return [{ type: group.content_type, done: items.length, target: Math.max(1, group.target) }]
  }
  return rows.map(r => ({
    type: r.type,
    done: items.filter(i => (i.content_type ?? group.content_type) === r.type).length,
    target: r.qty,
  }))
}

/** The formats still owed — a type whose pieces are all in gets hidden, so
 *  "Add the next piece" only offers work that is actually still missing. */
export function remainingTypes<T extends GroupableItem>(
  group: DeliverableGroup, items: T[],
): string[] {
  return formatBreakdown(group, items).filter(f => f.done < f.target).map(f => f.type)
}

/** The mixed card's one summary line: "2 reels, 1 carousel, 0 videos — 3 of 6". */
export function mixedGroupLine<T extends GroupableItem>(
  group: DeliverableGroup, items: T[],
): string {
  const parts = formatBreakdown(group, items).map(f => `${f.done} ${pluralType(f.type, f.done)}`)
  return `${parts.join(', ')} — ${items.length} of ${Math.max(1, group.target)}`
}

/** One per-format chip: "Reels 2/2", plus whether that format is finished. */
export function formatChip(f: FormatProgress): { label: string; done: boolean } {
  return { label: `${cap(pluralType(f.type, 2))} ${f.done}/${f.target}`, done: f.done >= f.target }
}

/** The menu entry for adding one more of a type: "Add a reel". */
export function addTypeLabel(type: string): string {
  const word = pluralType(type, 1)
  const article = /^[aeiou]/i.test(word) ? 'an' : 'a'
  return `Add ${article} ${word}`
}

/**
 * The live summary under the formats list in the New dialog:
 * "2 reels, 2 carousels, 2 videos (6 pieces)". Empty rows are ignored.
 */
export function plannedSummary(rows: PlannedFormat[]): string {
  const clean = plannedFormats({ planned: rows })
  if (!clean) return ''
  const total = plannedTarget(clean)
  const parts = clean.map(r => `${r.qty} ${pluralType(r.type, r.qty)}`)
  return `${parts.join(', ')} (${total} ${total === 1 ? 'piece' : 'pieces'})`
}
