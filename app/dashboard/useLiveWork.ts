'use client'

/**
 * THE BOARDS' DATA, LIVE.
 *
 * Production, Editor and Scheduler used to open with four API calls each and
 * then refetch all four every time anyone anywhere touched an item. That is
 * the "extremely slow and it's not realtime" complaint, in one paragraph.
 *
 * This hook subscribes to the tables those calls read and assembles exactly
 * the same rows in the browser: the same scoping (`scope-client.ts`, tested
 * against the server predicate), the same joins (`clients`, `batches`,
 * `work_kinds`), and the same three annotations the items API decorates a
 * board row with — "somebody tagged you here", the created-by/approved-by
 * credits, and how many slides the latest version holds. The pages that use
 * it therefore render the SAME cards they always did; only where the rows
 * come from has changed.
 *
 * Writes are untouched: every mutation is still the `fetch('/api/…')` call it
 * always was, because the routes own the side effects (emails, activity log,
 * Drive, the live announcement). There is simply no `load()` afterwards — the
 * listener repaints the moment the row lands.
 */

import { useEffect, useMemo, useState } from 'react'
import { useRow, useTable } from '@/lib/db-client'
import type {
  AssetVersion, Batch, Client, ContentItem, DeliverableGroup, ItemComment,
  TeamUser, TeamUserClient, WorkKind, WorkflowActivity, BatchComment,
} from '@/lib/db-types'
import { CLIENT_LABELS, type ItemStatus } from '../lib/workflow-core'
import { slidesOf } from '../lib/version-files-core'
import {
  scopeContextOf, taggedIdsOf, visibleBatches, visibleClientIdsOf, visibleGroups,
  visibleItems, type ScopeContext, type ScopeViewer,
} from '../lib/scope-client'

/** A board row: the item, its joins and the items API's three annotations. */
export type LiveItem = ContentItem & {
  clients: { name: string; timezone?: string | null } | null
  batches: { title: string; status?: string; planned_deliverables?: unknown[] } | null
  work_kinds: { name: string; slug: string; color: string; uses_media?: boolean } | null
  my_open_task?: boolean
  created_by?: string | null
  approved_by?: string | null
  slide_count?: number
  status_label?: string
}

/** A shoot, with its client's name and the "3 items" count the strip prints. */
export type LiveBatch = Batch & {
  clients: { name: string } | null
  content_items: { count: number }[]
}

/** A client row as `/api/website/clients?scope=mine` returns it. */
export type LiveClient = Client & { managers: { id: string; name: string; email: string }[] }

const BY_UPDATED_DESC: [keyof ContentItem & string, 'asc' | 'desc'][] = [['updated_at', 'desc']]
const BY_CREATED_DESC: [string, 'asc' | 'desc'][] = [['created_at', 'desc']]

/**
 * `useTable` hands back a fresh `{ rows, loading, error }` literal every
 * render — `rows` is memoised inside it, `loading` and `error` are primitives,
 * but the wrapper is not. Every memo downstream keys on these objects, so one
 * unmemoised wrapper defeats the lot. This pins the wrapper to its contents.
 */
function stableTable<T>(r: { rows: T[]; loading: boolean; error: string | null }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => r, [r.rows, r.loading, r.error])
}

/**
 * Every table the three boards read, as live listeners.
 *
 * Split out from `useWorkRows` so a page that needs one raw table (the
 * Overview needs `leads`; the Scheduler needs `schedule_entries`) can take
 * this and add its own, rather than each page opening its own duplicate set.
 *
 * DELIBERATELY NOT GATED ON THE VIEWER. Waiting for `/api/team/me` before
 * subscribing looked tidy and cost a bug: `enabled` flipping false→true left
 * exactly one render in which `loading` was already false and no snapshot had
 * arrived, so "no rows yet" was indistinguishable from "no rows" — which the
 * item page read as "this item is not yours" and bounced a super admin off a
 * page that plainly existed. The subscription is cheap and the read is open;
 * starting it immediately makes that window impossible instead of unlikely.
 */
export function useWorkTables(enabled = true) {
  const items = stableTable(useTable<ContentItem>('content_items', { orderBy: BY_UPDATED_DESC, enabled }))
  const batches = stableTable(useTable<Batch>('batches', { orderBy: BY_CREATED_DESC as never, enabled }))
  const clients = stableTable(useTable<Client>('clients', { enabled }))
  const workKinds = stableTable(useTable<WorkKind>('work_kinds', { enabled }))
  const groups = stableTable(useTable<DeliverableGroup>('deliverable_groups', { orderBy: BY_CREATED_DESC as never, enabled }))
  const assignments = stableTable(useTable<TeamUserClient>('team_user_clients', { enabled }))
  const team = stableTable(useTable<TeamUser>('team_users', { enabled }))
  const itemComments = stableTable(useTable<ItemComment>('item_comments', { enabled }))
  const batchComments = stableTable(useTable<BatchComment & { assigned_to?: string | null; resolved?: boolean }>('batch_comments', { enabled }))
  const activity = stableTable(useTable<WorkflowActivity>('workflow_activity', { enabled }))
  const versions = stableTable(useTable<AssetVersion>('asset_versions', { enabled }))
  // memoised: `useWorkRows` and the Overview both use this object as a memo
  // key, and a fresh literal per render would defeat every one of them
  return useMemo(() => ({
    items, batches, clients, workKinds, groups, assignments, team,
    itemComments, batchComments, activity, versions,
  }), [
    items, batches, clients, workKinds, groups, assignments, team,
    itemComments, batchComments, activity, versions,
  ])
}

export type WorkTables = ReturnType<typeof useWorkTables>

/**
 * The boards' rows, scoped and annotated for this viewer.
 *
 * `loading` is true only until the FIRST snapshot of the tables the cards are
 * drawn from. The annotations (credits, slide counts, tags) are decoration,
 * exactly as they are on the server — a board never waits on them, and a
 * missing one leaves the badge off rather than the page blank.
 */
export function useWorkRows(
  viewerIn: ScopeViewer | null,
  opts: { schedulerPostFilter?: boolean } = {},
) {
  const schedulerPostFilter = opts.schedulerPostFilter !== false
  const t = useWorkTables()

  // A CLIENT viewer is scoped by their own client_id, which `/api/team/me`
  // does not carry — the people table does, and it is already on the wire.
  const viewer = useMemo(() => {
    if (!viewerIn) return null
    if (viewerIn.client_id !== undefined) return viewerIn
    const row = t.team.rows.find(u => u.id === viewerIn.id)
    return { ...viewerIn, client_id: row?.client_id ?? null }
  }, [viewerIn, t.team.rows])

  /** items and shoots with an unresolved comment tagged to the viewer */
  const tagged = useMemo(() => {
    if (!viewer || viewer.role === 'client') return { items: [] as string[], batches: [] as string[] }
    return {
      items: [...new Set(t.itemComments.rows
        .filter(c => c.assigned_to === viewer.id && c.resolved === false)
        .map(c => c.item_id).filter(Boolean))],
      batches: [...new Set(t.batchComments.rows
        .filter(c => c.assigned_to === viewer.id && c.resolved === false)
        .map(c => c.batch_id).filter(Boolean))],
    }
  }, [viewer, t.itemComments.rows, t.batchComments.rows])

  /** every item/shoot tag, resolved or not — assignment, which outlives being
   *  answered (`taggedItemIds` / `taggedBatchIds` on the server). Read through
   *  the shared helper so the boards, the items route and the Schedule page
   *  cannot drift on what counts as a tag. */
  const tagAssignments = useMemo(() => {
    if (!viewer || viewer.role === 'client') return { items: [] as string[], batches: [] as string[] }
    return {
      items: taggedIdsOf(t.itemComments.rows, viewer.id, 'item_id'),
      batches: taggedIdsOf(t.batchComments.rows, viewer.id, 'batch_id'),
    }
  }, [viewer, t.itemComments.rows, t.batchComments.rows])

  const clientById = useMemo(
    () => new Map(t.clients.rows.map(c => [c.id, c])), [t.clients.rows])
  const batchById = useMemo(
    () => new Map(t.batches.rows.map(b => [b.id, b])), [t.batches.rows])
  const kindById = useMemo(
    () => new Map(t.workKinds.rows.map(k => [k.id, k])), [t.workKinds.rows])

  /** "Manal made this · Divina approved it" — the same two credits the items
   *  API derives from the activity log. */
  const credits = useMemo(() => {
    const nameOf = new Map(t.team.rows.map(a => [a.id, a.name || a.email]))
    const byItem = new Map<string, { created_by: string | null; approved_by: string | null }>()
    const acts = t.activity.rows
      .filter(a => a.entity_type === 'content_item' && ['created', 'status_change'].includes(a.action))
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
    for (const a of acts) {
      const entry = byItem.get(a.entity_id) ?? { created_by: null, approved_by: null }
      const who = a.actor_id ? nameOf.get(a.actor_id) ?? null : null
      if (a.action === 'created') entry.created_by = who
      else if (a.new_value === 'approved_for_scheduling') entry.approved_by = who
      byItem.set(a.entity_id, entry)
    }
    return byItem
  }, [t.activity.rows, t.team.rows])

  /** how many slides the LATEST version of each item holds */
  const slideCounts = useMemo(() => {
    const latest = new Map<string, AssetVersion>()
    for (const v of t.versions.rows) {
      const seen = latest.get(v.item_id)
      if (!seen || (v.version_number ?? 0) > (seen.version_number ?? 0)) latest.set(v.item_id, v)
    }
    return new Map([...latest].map(([id, v]) => [id, slidesOf(v).length]))
  }, [t.versions.rows])

  /** the joined, annotated, scoped board rows — the items API's answer */
  const items: LiveItem[] = useMemo(() => {
    if (!viewer) return []
    const scoped = visibleItems(
      viewer,
      t.items.rows as unknown as (ContentItem & { work_kinds?: null })[],
      t.assignments.rows,
      scopeContextOf({
        viewer,
        batches: t.batches.rows,
        taggedItemIds: tagAssignments.items,
        taggedBatchIds: tagAssignments.batches,
        workKinds: t.workKinds.rows,
        schedulerPostFilter,
      }),
    )
    const openTasks = new Set(tagged.items)
    return scoped.map(r => {
      const client = clientById.get(r.client_id) ?? null
      const batch = r.batch_id ? batchById.get(r.batch_id) ?? null : null
      const kind = r.work_kind_id ? kindById.get(r.work_kind_id) ?? null : null
      const credit = credits.get(r.id)
      const row: LiveItem = {
        ...(r as unknown as ContentItem),
        clients: client ? { name: client.name, timezone: client.timezone ?? null } : null,
        batches: batch
          ? {
              title: batch.title,
              status: batch.status ?? undefined,
              planned_deliverables: (batch.planned_deliverables ?? undefined) as unknown[] | undefined,
            }
          : null,
        work_kinds: kind
          ? { name: kind.name, slug: kind.slug, color: kind.color, uses_media: kind.uses_media }
          : null,
      }
      if (viewer.role === 'client') {
        row.status_label = CLIENT_LABELS[row.status as ItemStatus]
        return row
      }
      row.my_open_task = openTasks.has(r.id)
      row.created_by = credit?.created_by ?? null
      row.approved_by = credit?.approved_by ?? null
      row.slide_count = slideCounts.get(r.id) ?? 0
      return row
    })
  }, [
    viewer, t.items.rows, t.assignments.rows, t.batches.rows, t.workKinds.rows,
    tagAssignments, tagged.items, clientById, batchById, kindById, credits, slideCounts,
    schedulerPostFilter,
  ])

  /** the shoots, scoped as `/api/production/batches` scopes them, each with
   *  its "3 items" count */
  const batches: LiveBatch[] = useMemo(() => {
    if (!viewer) return []
    const countByBatch = new Map<string, number>()
    for (const it of t.items.rows) {
      if (it.batch_id) countByBatch.set(it.batch_id, (countByBatch.get(it.batch_id) ?? 0) + 1)
    }
    return visibleBatches(viewer, t.batches.rows, t.items.rows, t.assignments.rows, tagAssignments.batches)
      .map(b => ({
        ...b,
        clients: clientById.get(b.client_id) ? { name: clientById.get(b.client_id)!.name } : null,
        content_items: [{ count: countByBatch.get(b.id) ?? 0 }],
      }))
  }, [viewer, t.batches.rows, t.items.rows, t.assignments.rows, tagAssignments.batches, clientById])

  /** `?scope=mine`: the clients this person actually works for */
  const clients: LiveClient[] = useMemo(() => {
    if (!viewer) return []
    const scoped = visibleClientIdsOf(viewer, t.items.rows, t.batches.rows, t.assignments.rows, {
      taggedItemIds: tagAssignments.items,
      taggedBatchIds: tagAssignments.batches,
    })
    const managersByClient = new Map<string, { id: string; name: string; email: string }[]>()
    const teamById = new Map(t.team.rows.map(u => [u.id, u]))
    for (const link of t.assignments.rows) {
      const u = teamById.get(link.team_user_id)
      if (!u || !u.active_status) continue
      if (!['account_manager', 'super_admin'].includes(u.role)) continue
      const list = managersByClient.get(link.client_id) ?? []
      list.push({ id: u.id, name: u.name, email: u.email })
      managersByClient.set(link.client_id, list)
    }
    return t.clients.rows
      .filter(c => scoped === null || scoped.includes(c.id))
      .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
      .map(c => ({ ...c, managers: managersByClient.get(c.id) ?? [] }))
  }, [viewer, t.clients.rows, t.items.rows, t.batches.rows, t.assignments.rows, t.team.rows, tagAssignments])

  /** the quota groups — "5 reels" as one card — with their kind attached */
  const groups = useMemo(() => {
    if (!viewer) return []
    return visibleGroups(viewer, t.groups.rows, t.assignments.rows).map(g => {
      const kind = g.work_kind_id ? kindById.get(g.work_kind_id) ?? null : null
      return {
        ...g,
        work_kinds: kind
          ? { slug: kind.slug, uses_media: kind.uses_media, name: kind.name, color: kind.color }
          : null,
      }
    })
  }, [viewer, t.groups.rows, t.assignments.rows, kindById])

  // The first paint waits only on what the cards are made of. Credits and
  // slide counts arrive a beat later and only add a line to a card.
  const loading = viewer === null
    || t.items.loading || t.batches.loading || t.clients.loading || t.workKinds.loading

  /**
   * A listener that could not read is a FAILURE, not an empty board.
   *
   * The old pages toasted "Could not load shoots" when their fetch threw. A
   * live board that silently draws nothing on a dropped subscription is worse
   * than the fetch was: it looks like an answer. Only the four tables the
   * cards are made of count — a missing credit is not a broken page.
   */
  const error = t.items.error || t.batches.error || t.clients.error || t.workKinds.error || null

  // memoised: this object is a memo key on every page that uses it (the
  // Overview derives its whole payload from it), and a fresh literal per
  // render would re-run every one of those on every keystroke
  return useMemo(
    () => ({ items, batches, clients, groups, tagged, tables: t, loading, error }),
    [items, batches, clients, groups, tagged, t, loading, error],
  )
}

/**
 * The context ONE item's visibility check needs — the two grants a single row
 * cannot carry on its own.
 *
 * `assignmentOpensItem` on the server opens an item for somebody off its
 * client team in four ways: they own it, they hold its scheduling, they were
 * TAGGED in a comment on it, or they hold the SHOOT it sits under (which is
 * `canOpenBatch`: owning the shoot, owning or scheduling any item on it, or
 * being tagged in the shoot's own thread). The first two are readable off the
 * row; the other two are not, and passing `{ items: [item] }` quietly dropped
 * them — a tagged editor off the client team opened their notification link
 * and was told "Item not found".
 *
 * `loading` is the part that matters as much as the data: every leg here can
 * only ever GRANT access, so judging on a half-arrived snapshot produces a
 * false "not yours". It stays true until the subscriptions are keyed to THIS
 * item and have all answered.
 */
export function useItemScopeContext(
  viewer: ScopeViewer | null,
  item: { id: string; batch_id?: string | null } | null | undefined,
  /** this item's comments, already subscribed by the caller */
  itemComments: { item_id?: string; assigned_to?: string | null }[],
): { ctx: ScopeContext; loading: boolean } {
  const batchId = item?.batch_id ?? null
  const byBatch = useMemo(() => ({ batch_id: batchId ?? '' }), [batchId])
  // the shoot, and every OTHER item on it: holding one of those siblings is
  // what opens the shoot, and the shoot is what opens this row
  const { row: batch, loading: batchLoading } = useRow<Batch>('batches', batchId)
  const { rows: siblings, loading: siblingsLoading } = useTable<ContentItem>(
    'content_items', { by: byBatch })
  const { rows: batchComments, loading: batchCommentsLoading } =
    useTable<BatchComment & { assigned_to?: string | null }>('batch_comments')

  // A subscription re-keys in an EFFECT, one render after the key changed, so
  // for that one render the hook still reports the previous key's settled
  // rows. This says "not yet" for exactly that render.
  const [keyedTo, setKeyedTo] = useState<string | null | undefined>(undefined)
  useEffect(() => { setKeyedTo(batchId) }, [batchId])
  const keyed = keyedTo === batchId

  const ctx: ScopeContext = useMemo(() => ({
    items: siblings,
    batches: batch ? [batch] : [],
    // a tag on THIS item's thread — resolved or not, exactly as the server's
    // `taggedItemIds` reads it: being asked a question is the assignment
    taggedItemIds: viewer && item && itemComments.some(c => c.assigned_to === viewer.id)
      ? [item.id]
      : [],
    taggedBatchIds: viewer
      ? batchComments.filter(c => c.assigned_to === viewer.id).map(c => c.batch_id).filter(Boolean)
      : [],
  }), [siblings, batch, batchComments, itemComments, viewer, item?.id])

  return {
    ctx,
    loading: !keyed || siblingsLoading || batchCommentsLoading || (batchId !== null && batchLoading),
  }
}
