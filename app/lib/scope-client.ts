/**
 * "What may this person see" — decided in the BROWSER, from rows already on
 * screen.
 *
 * The dashboard now renders from live database listeners instead of a round
 * trip per board, which means the scoping the `items` API used to do on the
 * server has to be reproducible from the same rows the listener already
 * delivered. These are not new rules: every predicate below is the one in
 * `app/api/production/items/route.ts` and `production-access.ts`, restated
 * over arrays instead of over queries. They are unit-tested against that
 * server predicate in `tests/scope-client.test.ts`, so the two cannot drift
 * without a test going red.
 *
 * NOTE ON WHAT THIS IS AND IS NOT. This is PRESENTATION scoping — it decides
 * what a page draws. Authorization is still enforced server-side in the API
 * route on every write, exactly as CLAUDE.md says: hiding a card is not
 * security, and nothing here is asked to be.
 *
 * No `server-only`, no `@/lib/db` — this file is imported by client
 * components.
 */

import { SCHEDULER_STATUSES, schedulerIdsOf, type ItemStatus } from './workflow-core'
import type { ScopeViewer } from './production-access-core'

export type { ScopeViewer } from './production-access-core'

/** The shape of an item these rules read — a live `content_items` row, with
 *  the work-kind join the board already carries when it has one. */
export type ScopeItem = {
  id: string
  client_id: string
  status: string
  owner_id?: string | null
  batch_id?: string | null
  scheduler_ids?: unknown
  work_kind_id?: string | null
  work_kinds?: { slug?: string | null } | null
}

export type ScopeAssignment = { team_user_id: string; client_id: string }
export type ScopeBatch = { id: string; client_id: string; owner_id?: string | null }

/**
 * The extra context assignment needs and a plain item array cannot carry:
 * the shoots this person owns outright, and the items/shoots they were tagged
 * on in a comment. All optional — a page that reads none of them simply
 * scopes by the parts it can see, which is a strictly narrower answer, never
 * a wider one.
 */
export type ScopeContext = {
  batches?: ScopeBatch[]
  /** the other items in hand — a shoot is HELD through an item on it, so
   *  `itemIsVisible` needs the neighbours to know whether this row's shoot
   *  is one of them */
  items?: ScopeItem[]
  taggedItemIds?: Iterable<string>
  taggedBatchIds?: Iterable<string>
  /** work_kinds rows, when the items carry only `work_kind_id` */
  workKinds?: { id: string; slug: string }[]
  /**
   * The scheduler post-filter — drop a shoot plan and other people's
   * handoffs. On by default because that is what the BOARD does. The
   * Overview deliberately turns it off: its route counts a scheduler's whole
   * scoped list and lets each card decide, so turning this on there would
   * quietly change every number on the page.
   */
  schedulerPostFilter?: boolean
}

/** A comment row, as the tag rules read it — item or shoot, either table. */
export type ScopeComment = {
  item_id?: string | null
  batch_id?: string | null
  assigned_to?: string | null
  resolved?: boolean | null
}

/**
 * The ids somebody was TAGGED on — assignment, which outlives being answered.
 *
 * Resolved or not: being asked a question about an item is what opens it, and
 * answering the question does not close the item again. `taggedItemIds` on the
 * server reads exactly this way.
 */
export function taggedIdsOf(
  comments: readonly ScopeComment[] | null | undefined,
  viewerId: string,
  key: 'item_id' | 'batch_id',
): string[] {
  return [...new Set((comments ?? [])
    .filter(c => c?.assigned_to === viewerId)
    .map(c => String(c?.[key] ?? ''))
    .filter(Boolean))]
}

/**
 * THE ONE PLACE THE SCOPE CONTEXT IS ASSEMBLED.
 *
 * `visibleItems` takes four grants a plain item array cannot carry — the
 * shoots, the tags on items, the tags on shoots, and the work kinds that say
 * which item is a shoot plan. Every caller has to pass all four or it scopes
 * differently from the others: with no `workKinds` a scheduler is shown the
 * shoot briefs the items API hides from them, and with no `batches` an editor
 * loses the item they hold only through a shoot.
 *
 * The items route, the boards' live hook and the Schedule page assembled this
 * separately, which is exactly how those two drifts happened. They call this
 * now. Tags may arrive already resolved (the server looks them up) or as the
 * comment rows themselves (the browser has them subscribed).
 */
export function scopeContextOf(input: {
  viewer: ScopeViewer
  batches?: ScopeBatch[]
  workKinds?: { id: string; slug: string }[]
  /** already-resolved tag ids — the server's way */
  taggedItemIds?: Iterable<string>
  taggedBatchIds?: Iterable<string>
  /** or the comment rows to read them off — the browser's way */
  itemComments?: readonly ScopeComment[]
  batchComments?: readonly ScopeComment[]
  /** the other items in hand, for "is this ONE row visible" */
  items?: ScopeItem[]
  schedulerPostFilter?: boolean
}): ScopeContext {
  const { viewer } = input
  // a client is scoped by their own client_id and holds no tags at all
  const tagsOff = viewer.role === 'client'
  const itemTags = tagsOff ? [] : [
    ...(input.taggedItemIds ?? []),
    ...taggedIdsOf(input.itemComments, viewer.id, 'item_id'),
  ]
  const batchTags = tagsOff ? [] : [
    ...(input.taggedBatchIds ?? []),
    ...taggedIdsOf(input.batchComments, viewer.id, 'batch_id'),
  ]
  return {
    batches: input.batches ?? [],
    workKinds: input.workKinds ?? [],
    taggedItemIds: [...new Set(itemTags)],
    taggedBatchIds: [...new Set(batchTags)],
    ...(input.items ? { items: input.items } : {}),
    ...(input.schedulerPostFilter === undefined ? {} : { schedulerPostFilter: input.schedulerPostFilter }),
  }
}

/** `accessibleClientIds` — the client ids whose work is this person's to run.
 *  null means unrestricted. Mirrors production-access.ts exactly. */
export function accessibleClientIdsOf(
  viewer: ScopeViewer,
  assignments: ScopeAssignment[],
): string[] | null {
  if (viewer.role === 'super_admin') return null
  if (viewer.role === 'client') return viewer.client_id ? [viewer.client_id] : []
  if (viewer.role === 'scheduler') return null // gated by STATUS, not by client
  return assignments.filter(a => a.team_user_id === viewer.id).map(a => a.client_id)
}

/** `batchClientIds` — shoots have no status gate, so a scheduler IS client-
 *  scoped here. Only super_admin is unrestricted. */
export function batchClientIdsOf(
  viewer: ScopeViewer,
  assignments: ScopeAssignment[],
): string[] | null {
  if (viewer.role === 'super_admin') return null
  if (viewer.role === 'client') return viewer.client_id ? [viewer.client_id] : []
  return assignments.filter(a => a.team_user_id === viewer.id).map(a => a.client_id)
}

/** `heldBatchIds` — shoots this person holds a stake in: one carrying an item
 *  they own or were handed the scheduling of, one they own outright, or one
 *  they were tagged on. */
export function heldBatchIdsOf(
  viewer: ScopeViewer,
  items: ScopeItem[],
  batches: ScopeBatch[] = [],
  taggedBatchIds: Iterable<string> = [],
): Set<string> {
  if (viewer.role === 'client') return new Set()
  const held = new Set<string>()
  for (const i of items) {
    if (i.batch_id && (i.owner_id === viewer.id || schedulerIdsOf(i).includes(viewer.id))) {
      held.add(i.batch_id)
    }
  }
  for (const b of batches) if (b.owner_id === viewer.id) held.add(b.id)
  for (const id of taggedBatchIds) if (id) held.add(id)
  return held
}

/** `assignedItemsFilter` — the four ways an assignment opens ONE item for
 *  somebody who is not on its client team. */
export function assignedItemsPredicate(
  viewer: ScopeViewer,
  heldBatches: Set<string>,
  taggedItems: Set<string>,
): (item: ScopeItem) => boolean {
  return (item: ScopeItem) =>
    item.owner_id === viewer.id
    || schedulerIdsOf(item).includes(viewer.id)
    || (item.batch_id != null && heldBatches.has(item.batch_id))
    || taggedItems.has(item.id)
}

/** The work kind's slug for an item, whichever way the row carries it. */
function slugOf(item: ScopeItem, kindSlugById: Map<string, string>): string {
  return item.work_kinds?.slug ?? (item.work_kind_id ? kindSlugById.get(item.work_kind_id) ?? '' : '')
}

/**
 * The `items` GET scoping, restated over an array.
 *
 * Line for line with the route: client scope (a client is their client's rows
 * and nothing else; everyone else is their clients OR anything assignment
 * hands them), then the scheduler's status gate (scheduler statuses, or a row
 * they own), then the scheduler post-filter (own it → yes; a shoot plan → no;
 * otherwise the handoff must be empty or include them).
 *
 * Input order is preserved, so a caller that sorted its rows keeps its sort.
 */
export function visibleItems<T extends ScopeItem>(
  viewer: ScopeViewer,
  items: T[],
  assignments: ScopeAssignment[] = [],
  ctx: ScopeContext = {},
): T[] {
  const clientIds = accessibleClientIdsOf(viewer, assignments)
  if (clientIds !== null && viewer.role === 'client' && clientIds.length === 0) return []

  const heldBatches = heldBatchIdsOf(viewer, items, ctx.batches ?? [], ctx.taggedBatchIds ?? [])
  const taggedItems = new Set(ctx.taggedItemIds ?? [])
  const assigned = clientIds !== null && viewer.role !== 'client'
    ? assignedItemsPredicate(viewer, heldBatches, taggedItems)
    : null
  const kindSlugById = new Map((ctx.workKinds ?? []).map(k => [k.id, k.slug]))

  const scoped = items.filter(r => {
    if (clientIds !== null) {
      if (viewer.role === 'client') {
        if (!clientIds.includes(r.client_id)) return false
      } else if (!(clientIds.includes(r.client_id) || assigned!(r))) return false
    }
    // a scheduler OWNING a job must see it at any status — the status gate is
    // for other people's items
    if (viewer.role === 'scheduler'
      && !((SCHEDULER_STATUSES as readonly string[]).includes(r.status) || r.owner_id === viewer.id)) {
      return false
    }
    return true
  })

  if (viewer.role !== 'scheduler' || ctx.schedulerPostFilter === false) return scoped
  // the scheduler post-filter, exactly as the route applies it after the join
  return scoped.filter(r => {
    if (r.owner_id === viewer.id) return true
    if (slugOf(r, kindSlugById) === 'shoot_brief') return false
    const ids = schedulerIdsOf(r)
    return ids.length === 0 || ids.includes(viewer.id)
  })
}

/**
 * The `batches` GET scoping: the shoots of my clients, plus any shoot I hold
 * a job on (which `canOpenBatch` opens for me, so a list that left them out
 * would promise a page nobody could find).
 */
export function visibleBatches<T extends ScopeBatch>(
  viewer: ScopeViewer,
  batches: T[],
  items: ScopeItem[] = [],
  assignments: ScopeAssignment[] = [],
  taggedBatchIds: Iterable<string> = [],
): T[] {
  const clientIds = batchClientIdsOf(viewer, assignments)
  if (clientIds === null) return batches
  const held = heldBatchIdsOf(viewer, items, batches, taggedBatchIds)
  return batches.filter(b => clientIds.includes(b.client_id) || held.has(b.id))
}

/**
 * `visibleClientIds` — the clients whose NAME and context this person may be
 * shown: the ones they are on, plus the clients of everything assignment
 * already opens for them. null stays null.
 */
export function visibleClientIdsOf(
  viewer: ScopeViewer,
  items: ScopeItem[],
  batches: ScopeBatch[],
  assignments: ScopeAssignment[],
  ctx: ScopeContext = {},
): string[] | null {
  const base = accessibleClientIdsOf(viewer, assignments)
  if (base === null || viewer.role === 'client') return base
  const held = heldBatchIdsOf(viewer, items, batches, ctx.taggedBatchIds ?? [])
  const assigned = assignedItemsPredicate(viewer, held, new Set(ctx.taggedItemIds ?? []))
  return [...new Set([
    ...base,
    ...items.filter(assigned).map(i => i.client_id),
    ...batches.filter(b => held.has(b.id)).map(b => b.client_id),
  ].filter(Boolean))]
}

/** The `deliverable_groups` GET scoping — the same client gate the items use. */
export function visibleGroups<T extends { client_id: string }>(
  viewer: ScopeViewer,
  groups: T[],
  assignments: ScopeAssignment[] = [],
): T[] {
  const clientIds = accessibleClientIdsOf(viewer, assignments)
  if (clientIds === null) return groups
  if (clientIds.length === 0) return []
  return groups.filter(g => clientIds.includes(g.client_id))
}

/**
 * `loadItemForUser` for ONE row — the item page's "is this mine to open".
 *
 * Deliberately NOT `visibleItems([item])`: the LIST also drops a shoot plan
 * from a scheduler's board (it is an account manager's job to book one), but
 * the item page has always OPENED one for them. Restating the list rule here
 * would 404 a page the server serves. Everything else is the same: the
 * scheduler status gate, the taken seat, then the client gate with assignment
 * as the way through it.
 */
export function itemIsVisible(
  viewer: ScopeViewer,
  item: ScopeItem | null,
  assignments: ScopeAssignment[] = [],
  ctx: ScopeContext = {},
): boolean {
  if (!item) return false
  if (viewer.role === 'scheduler') {
    if (!(SCHEDULER_STATUSES as readonly string[]).includes(item.status)
      && item.owner_id !== viewer.id) return false
    const handed = schedulerIdsOf(item)
    if (handed.length > 0 && !handed.includes(viewer.id) && item.owner_id !== viewer.id) return false
  }
  const clientIds = accessibleClientIdsOf(viewer, assignments)
  if (clientIds === null || clientIds.includes(item.client_id)) return true
  if (viewer.role === 'client') return false
  const held = heldBatchIdsOf(viewer, ctx.items ?? [item], ctx.batches ?? [], ctx.taggedBatchIds ?? [])
  return assignedItemsPredicate(viewer, held, new Set(ctx.taggedItemIds ?? []))(item)
}

export { SCHEDULER_STATUSES }
export type { ItemStatus }
