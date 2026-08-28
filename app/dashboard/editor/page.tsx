'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Plus, CalendarDays, CheckSquare, ChevronDown, ChevronUp, Flag, ListChecks, Trash2, ArrowRight } from 'lucide-react'
import { SCHEDULER_STATUSES, STATUS_LABELS, type ItemStatus } from '../../lib/workflow-core'
import { itemStatusLabel } from '../../lib/brief-task-core'
import {
  addNextLabel, groupLine, isTaskGroup, nextPieceTitle, splitByGroup,
  type DeliverableGroup, type GroupCard,
} from '../../lib/deliverable-group-core'
import {
  EDITOR_LANES, canClaimEditor, editorAssignment, editorScope, editorTail,
  isAsset, unassignedCount, type ScopeMode, type Viewer,
} from '../../lib/work-pages-core'
import {
  dayLabel, eventsFor, movePatch, moveUrl, type CalEvent,
} from '../../lib/work-calendar-core'
import WorkCalendar, { ViewSwitch, type CalendarView } from '../../components/calendar/WorkCalendar'
import { useProductionLive } from '../production/useProductionLive'
import { useOrderedLoad } from '../useOrderedLoad'
import { useRole } from '../useRole'
import { defaultAllows } from '../../lib/page-access-core'
import NewItemDialog, { type Batch, type ClientRow } from '../production/NewItemDialog'
import { AccountUnavailable, KIND_CARD, KIND_CHIP, PRIORITY_TINT, ShootChips } from '../production/shoot-ui'
import { teamNameMap, usePersistedChoice, usePersistedScope, useTeamMembers } from '../production/workHooks'
import { ScopeSwitch } from '../production/ScopeSwitch'
import { ClaimButton } from '../production/ClaimButton'
import { TurnChip } from '../production/TurnChip'
import { LaneBoard, type Lane } from '../production/LaneBoard'
import CommentsDrawer, { CommentsButton, useCommentsDrawer } from '../../components/comments/CommentsDrawer'
import GettingStarted from '../GettingStarted'
import HelpHint from '../HelpHint'
import { toastOpen } from '../toastLink'
import { DRAFTING_LANE } from '../../lib/section-names'

type Item = {
  id: string
  title: string
  client_id: string
  batch_id: string | null
  content_type: string
  status: ItemStatus
  priority: string
  due_date: string | null
  current_version_number: number
  owner_id: string | null
  scheduler_ids?: unknown
  my_open_task?: boolean
  /** the quota group this piece belongs to, when it was made inside one */
  group_id?: string | null
  clients: { name: string } | null
  batches: { title: string; status?: string; planned_deliverables?: { type: string; qty: number }[] } | null
  work_kinds?: { name: string; slug: string; color: string } | null
}

/** Everything one refetch of the board answers with, so the ordering guard has
 *  a single value to accept or discard rather than four scattered setStates. */
type BoardData = {
  items?: Item[]
  clients?: ClientRow[]
  batches?: Batch[]
  /** quota groups — "5 reels" as one card. Empty until the SQL has run. */
  groups?: DeliverableGroup[]
  /** the production tables are not migrated yet — a state, not a failure */
  noSchema?: boolean
}

/** One dot per lane, in the same order the work moves. */
const LANE_TINT: Record<string, string> = {
  drafting: 'bg-zinc-400',
  review: 'bg-blue-500',
  revising: 'bg-amber-500',
  client: 'bg-violet-500',
  approved: 'bg-emerald-500',
}

/** What is NOT in a column, said in the column's own words. */
const LANE_EMPTY: Record<string, string> = {
  drafting: 'No drafts.',
  review: 'Nothing waiting on a manager.',
  revising: 'No changes in progress.',
  client: 'Nothing with a client.',
  approved: 'Nothing approved yet.',
}

const SCOPE_KEY = 'md-editor-scope'
const VIEW_KEY = 'md-editor-view'
const RANGE_KEY = 'md-editor-cal-range'
const VIEWS = ['board', 'calendar'] as const
const RANGES = ['month', 'week'] as const

/** Two letters for a colleague, when their whole name would crowd the card. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

/**
 * The Editor board: items in the edit, and nothing else.
 *
 * The old single board showed every piece of work to everybody, so an editor
 * scrolled past shoot plans and scheduled posts to find their own three jobs.
 * This page carries one question — what is mine to edit, and what is free to
 * pick up — and the scope switch is how you answer it.
 */
export default function EditorPage() {
  const router = useRouter()
  const [items, setItems] = useState<Item[] | null>(null)
  const [clients, setClients] = useState<ClientRow[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [groups, setGroups] = useState<DeliverableGroup[]>([])
  /** which quota cards are open, listing their pieces */
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [batchFilter, setBatchFilter] = useState<string>('all')
  const [needsSchema, setNeedsSchema] = useState(false)

  const [newOpen, setNewOpen] = useState(false)
  const [preset, setPreset] = useState<{ client_id?: string; batch_id?: string } | undefined>()

  // the comments drawer: read and answer an item's comments without leaving
  // the board. `?comments=<itemId>` opens it on load (notification links).
  const commentsDrawer = useCommentsDrawer()

  const { me, role, loading, can } = useRole()
  const isManager = can('account_manager')
  const viewer: Viewer | null = me ? { id: me.id, role: me.role } : null
  // the footer is a link to another PAGE — only offer it to someone who may
  // open it. No grants are loaded here, so this is the role default; a
  // person granted the page individually reaches it from the sidebar.
  const canSeeScheduler = defaultAllows(me?.role ?? null, '/dashboard/scheduler')

  // managers can hand a loose job to somebody by name instead of waiting for
  // it to be picked up — one `/api/team` fetch, shared with the New-work
  // dialog below instead of being fetched twice per board load
  const team = useTeamMembers(isManager)
  const nameById = useMemo(() => teamNameMap(team), [team])
  const [scope, setScope] = usePersistedScope(SCOPE_KEY, role)
  // lanes or dates — two readings of the same board, and which one you were
  // on is worth remembering
  const [view, setView] = usePersistedChoice(VIEW_KEY, VIEWS, 'board', 'view')
  const [range, setRange] = usePersistedChoice(RANGE_KEY, RANGES, 'month')

  const [strip, setStrip] = useState<{ type: string; label: string; quota: number; planned: number; delivered: number; in_production?: number; approved?: number; scheduled?: number; posted?: number }[] | null>(null)
  useEffect(() => {
    if (clientFilter === 'all') { setStrip(null); return }
    fetch(`/api/production/deliverables-progress?client_id=${clientFilter}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => setStrip(j?.per_type ?? []))
      .catch(() => setStrip([]))
  }, [clientFilter])

  /**
   * The board, refetched with its answers kept in order — and never dropped.
   *
   * One fetcher, one apply: with the setState calls buried in the fetch, an
   * answer ruled "too old" had already half-written itself. See
   * lib/load-order.ts for why "newest issued wins" lost every post-mutation
   * refetch — including the one after "Create items", which is why new items
   * did not appear until the board was reloaded by hand.
   */
  const loadOrdered = useOrderedLoad<BoardData>(
    async () => {
      const [itemsRes, clientsRes, batchesRes, groupsRes] = await Promise.all([
        fetch('/api/production/items', { cache: 'no-store' }),
        // scope=mine: the client filter and the New-work dialog offer the
        // clients this person holds work for, assignments included
        fetch('/api/website/clients?scope=mine'),
        fetch('/api/production/batches'),
        // quota groups — the endpoint answers [] on a database where the
        // table has not been created yet, so this can never break the board
        fetch('/api/production/groups', { cache: 'no-store' }),
      ])
      if (!itemsRes.ok) {
        const err = (await itemsRes.json().catch(() => ({}))).error ?? ''
        if (String(err).match(/relation|does not exist/i)) return { noSchema: true }
        throw new Error(err || 'Failed to load items')
      }
      return {
        items: await itemsRes.json(),
        clients: clientsRes.ok ? await clientsRes.json() : undefined,
        batches: batchesRes.ok ? await batchesRes.json() : undefined,
        groups: groupsRes.ok ? await groupsRes.json() : [],
      }
    },
    data => {
      if (data.noSchema) { setNeedsSchema(true); setItems([]); return }
      if (data.items) setItems(data.items)
      if (data.clients) setClients(data.clients)
      if (data.batches) setBatches(data.batches)
      if (data.groups) setGroups(Array.isArray(data.groups) ? data.groups : [])
    },
  )
  const load = useCallback(async () => {
    try {
      await loadOrdered()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load the editor board')
      setItems([])
    }
  }, [loadOrdered])

  useEffect(() => { load() }, [load])

  // arriving from a shoot's "Create items": dialog open, client+shoot preset
  // (the old `new_for_batch` spelling still works — a bookmarked link is a link)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const forShoot = q.get('new_for_shoot') ?? q.get('new_for_batch')
    if (forShoot) {
      setPreset({ batch_id: forShoot, client_id: q.get('client') ?? undefined })
      setNewOpen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // live board: any item created/moved/commented anywhere refreshes the columns
  useProductionLive(load)

  const all = items ?? []
  // the client and shoot chips narrow EVERYTHING the header reports, not just
  // the lanes — a badge reading 7 above five empty columns is a bug report
  const inFilters = (i: Item) =>
    (clientFilter === 'all' || i.client_id === clientFilter)
    && (batchFilter === 'all' || i.batch_id === batchFilter)
  const filtering = clientFilter !== 'all' || batchFilter !== 'all'

  const scoped = viewer ? editorScope(all, viewer, scope) : []
  const visible = scoped.filter(inFilters)
  const filtered = all.filter(inFilters)

  // quota cards: grouped pieces fold into ONE card per group ("Reels · 2 of
  // 5") and never render individually. Groups follow the client / shoot
  // chips; the scope pills govern the pieces inside them. With the groups
  // table not migrated yet the list is [] and every card is a plain card.
  const groupsInFilters = groups.filter(g =>
    !isTaskGroup(g) // task groups live on the Production board
    && (clientFilter === 'all' || g.client_id === clientFilter)
    && (batchFilter === 'all' || (g.batch_id ?? null) === batchFilter))
  // the card counts EVERY piece the group holds — published ones included,
  // whatever the scope pills say — or "3 of 5" would shrink back to "1 of 5"
  // the moment two pieces went live. The pieces drawn as plain cards still
  // obey the scope.
  const { groupCards } = splitByGroup(filtered, groupsInFilters)
  const groupedIds = new Set(groupCards.flatMap(c => c.items.map(i => i.id)))
  const plainItems = visible.filter(i => !groupedIds.has(i.id))

  // the pool anyone may pick up — briefs are never in it, and neither is
  // anything already approved: that seat belongs to the scheduler
  // …and only ASSETS: this board shows nothing else, so counting a research
  // task here advertised a pool with rows the columns cannot draw.
  const openPool = viewer
    ? unassignedCount(
      filtered.filter(i => isAsset(i) && !SCHEDULER_STATUSES.includes(i.status)),
      viewer, editorAssignment,
    )
    : 0
  // the tail counts the work that has LEFT this board — editorScope has
  // already dropped scheduled and published, so it has to be counted before
  // the scope is applied or both numbers are structurally zero
  const tail = editorTail(filtered)

  /** The same rows the lanes are drawn from, filed by due date instead of by
   *  step. The scope switch and the client / shoot chips have already had
   *  their say, so the two views can never disagree about what is here. */
  const calendar = eventsFor('editor', { items: visible })

  /* ── bulk select + delete: tick cards on the board instead of opening each ── */
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const toggleSelected = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const exitSelect = () => { setSelectMode(false); setSelectedIds(new Set()) }
  const bulkDelete = async () => {
    setBulkBusy(true)
    try {
      const ids = [...selectedIds]
      const results = await Promise.allSettled(ids.map(async id => {
        const res = await fetch(`/api/production/items/${id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed')
      }))
      const failed = results.filter(r => r.status === 'rejected').length
      const deleted = ids.length - failed
      if (failed === 0) toast.success(deleted === 1 ? 'Item deleted' : `${deleted} items deleted`)
      else toast.error(`Deleted ${deleted}, but ${failed} failed — the board shows what remains`)
      setBulkOpen(false)
      exitSelect()
      void load()
    } finally {
      setBulkBusy(false)
    }
  }

  /**
   * Drag a card onto another day — the due date, moved.
   *
   * Optimistic, then reconciled: the card lands where it was dropped straight
   * away, and the sequence-stamped `load()` (lib/load-order.ts) has the last
   * word whichever way the server answers, so a refusal puts it back without
   * any bookkeeping here. `canMove` only decides whether to offer the handle;
   * the API is what actually enforces who may move a date, and its refusal is
   * shown in its own words.
   */
  const moveEvent = async (e: CalEvent, day: string) => {
    const patch = movePatch(e, day)
    if (!patch) return
    setItems(prev => (prev ?? []).map(i => (i.id === e.entityId ? { ...i, due_date: day } : i)))
    try {
      const res = await fetch(moveUrl(e), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not move it')
      toast.success(`${e.title} → ${dayLabel(day)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move it')
    } finally {
      void load()
    }
  }

  /** Hand a loose job to somebody. Manager-only on the server too. */
  const assignTo = async (itemId: string, ownerId: string) => {
    try {
      const res = await fetch(`/api/production/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_id: ownerId }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not assign it')
      const who = nameById.get(ownerId) ?? 'a teammate'
      toastOpen(`Assigned to ${who} — they have been emailed`, `/dashboard/production/${itemId}`, router.push)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not assign it')
    }
  }

  /** "Add the next reel" — one real item, filed into the group. */
  const addNextPiece = async (card: GroupCard<Item>) => {
    setAddingTo(card.group.id)
    try {
      const res = await fetch('/api/production/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{
          client_id: card.group.client_id,
          batch_id: card.group.batch_id ?? null,
          group_id: card.group.id,
          title: nextPieceTitle(card.group, card.count),
          content_type: card.group.content_type,
          ...(card.group.work_kind_id ? { work_kind_id: card.group.work_kind_id } : {}),
        }] }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error((json as { error?: string } | null)?.error ?? 'Could not add it')
      const made = Array.isArray(json) ? json[0] : null
      toastOpen(
        `${made?.title ?? 'Piece'} added — ${card.count + 1} of ${card.target}`,
        made?.id ? `/dashboard/production/${made.id}` : '/dashboard/editor',
        router.push,
      )
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add it')
    } finally {
      setAddingTo(null)
    }
  }

  /** A quota card: the promise, how full it is, and the one next action. */
  const renderGroupCard = (card: GroupCard<Item>) => {
    const open = openGroups.has(card.group.id)
    const pct = Math.min(100, Math.round((card.count / card.target) * 100))
    return (
      <div key={`group-${card.group.id}`}>
        <Card className="py-0 transition-shadow hover:shadow-md">
          <CardContent className="flex flex-col gap-2 p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium leading-snug">{groupLine(card)}</span>
              <button type="button" aria-label={open ? 'Hide the pieces' : 'Show the pieces'}
                onClick={() => setOpenGroups(prev => {
                  const next = new Set(prev)
                  if (next.has(card.group.id)) next.delete(card.group.id); else next.add(card.group.id)
                  return next
                })}
                className="flex h-8 w-8 shrink-0 items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
                {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>
            {/* the small filled bar — how much of the promise exists */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="font-normal text-zinc-600 dark:text-zinc-400">
                {clients.find(c => c.id === card.group.client_id)?.name ?? '—'}
              </Badge>
              <span className="font-mono text-[11px] capitalize text-zinc-400 dark:text-zinc-500">{card.group.content_type}</span>
            </div>
            {open && (
              <div className="flex flex-col gap-1">
                {card.items.length === 0 && (
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">No pieces yet — add the first one below.</p>
                )}
                {card.items.map(i => (
                  <Link key={i.id} href={`/dashboard/production/${i.id}`}
                    className="flex min-h-8 items-center justify-between gap-2 rounded px-1 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                    <span className="truncate">{i.title}</span>
                    <span className="shrink-0 text-zinc-400 dark:text-zinc-500">{STATUS_LABELS[i.status]}</span>
                  </Link>
                ))}
              </div>
            )}
            {!card.full && (
              <Button size="sm" className="min-h-11 w-fit md:min-h-8"
                disabled={addingTo === card.group.id}
                onClick={() => void addNextPiece(card)}>
                <Plus className="h-3.5 w-3.5" />
                {addingTo === card.group.id ? 'Adding…' : addNextLabel(card.group)}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (needsSchema) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="py-14 text-center text-sm text-zinc-500 dark:text-zinc-400">
          This part of the app isn&rsquo;t switched on yet. Send this to your developer:
          run <span className="font-mono">supabase/production.sql</span>.
        </CardContent>
      </Card>
    )
  }

  // the board is drawn per viewer — no viewer is a different screen, not a
  // slower load, and a skeleton that never resolves tells nobody anything
  if (!loading && !viewer) return <AccountUnavailable />

  const ready = viewer !== null && items !== null
  const unassignedHint = role === 'super_admin'
    ? 'Unassigned across all clients.'
    : role === 'account_manager' ? 'Unassigned within your clients.' : undefined
  const showingOnlyMineAndPool = !scope.has('all')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Editor</h2>
          {/* the purpose, in a new hire's words: what is here and what you do with it */}
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Every item <HelpHint term="item" /> being edited, from first cut to client
            sign-off. Take one, attach your work, send it for review.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* the lanes say whose step a job is on; the calendar says when it
              is due. Same rows, same filters, two questions. */}
          <ViewSwitch
            label="How to show this board"
            value={view}
            onChange={setView}
            options={[
              { value: 'board', label: 'Board', icon: ListChecks },
              { value: 'calendar', label: 'Calendar', icon: CalendarDays },
            ]}
          />
          <ScopeSwitch scope={scope} onChange={setScope}
            unassignedCount={openPool} unassignedHint={unassignedHint} />
          <Select value={clientFilter} onValueChange={v => { if (!v) return; setClientFilter(v); setBatchFilter('all') }}>
            <SelectTrigger className="w-44 bg-white dark:bg-zinc-900"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {isManager && (
            <Button variant={selectMode ? 'default' : 'outline'} size="sm"
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}>
              <CheckSquare className="h-4 w-4" /> {selectMode ? 'Cancel' : 'Select to delete'}
            </Button>
          )}
          <Button size="sm" className="min-h-11 md:min-h-9" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> New item</Button>
        </div>
      </div>

      {ready && <GettingStarted role={role} page="editor" />}

      <ShootChips batches={batches} clientFilter={clientFilter}
        value={batchFilter} onChange={setBatchFilter}
        countFor={bid => scoped.filter(i =>
          i.batch_id === bid && (clientFilter === 'all' || i.client_id === clientFilter)).length} />

      {strip && strip.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
            {new Date().toLocaleDateString('en-AU', { month: 'long' })}
          </span>
          {strip.map(r => (
            <span key={r.type}
              title={`${r.posted ?? r.delivered} posted · ${r.scheduled ?? 0} scheduled · ${r.approved ?? 0} approved · ${r.in_production ?? Math.max(0, r.planned - r.delivered)} in production · ${Math.max(0, r.quota - r.planned)} not started`}
              className={`rounded-full border px-2.5 py-1 font-mono text-xs tabular-nums ${
                r.delivered > r.quota
                  ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400'
                  : 'border-zinc-200 text-zinc-600 dark:border-zinc-800 dark:text-zinc-400'
              }`}>
              {r.label} {r.delivered}/{r.quota}
            </span>
          ))}
        </div>
      )}

      {!ready ? (
        <div className="flex gap-3 overflow-x-hidden">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-72 min-w-44 flex-1" />)}
        </div>
      ) : scoped.length === 0 && groupCards.length === 0 ? (
        /* the scope itself is empty — a real "there is nothing here". A client
           or shoot chip matching nothing is not that, and keeps its board. */
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {showingOnlyMineAndPool ? (
              <>
                {/* say what THIS filter is empty of — "nothing assigned to
                    you" beside a pill reading "Free to take 1" is a page
                    arguing with itself */}
                <p>
                  {scope.has('mine') && scope.has('unassigned')
                    ? 'Nothing assigned to you, and nothing waiting to be picked up.'
                    : scope.has('mine')
                      ? 'Nothing is assigned to you right now.'
                      : 'Nothing is waiting to be picked up.'}
                </p>
                <Button variant="outline" size="sm" className="min-h-11" onClick={() => setScope(new Set<ScopeMode>(['all']))}>
                  Show everyone&rsquo;s
                </Button>
              </>
            ) : (
              /* scope Everyone and still nothing — the first thing a new
                 account manager sees. A dead end needs a next step. */
              <>
                <p className="font-medium text-zinc-700 dark:text-zinc-200">Nothing to edit yet.</p>
                <p className="max-w-sm">
                  When a shoot <HelpHint term="shoot" /> is locked, its items land here in {DRAFTING_LANE} — or create one now.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button size="sm" className="min-h-11" onClick={() => setNewOpen(true)}>
                    <Plus className="h-4 w-4" /> New item
                  </Button>
                  <Button variant="outline" size="sm" className="min-h-11" asChild>
                    <Link href="/dashboard/production">Plan a shoot <ArrowRight className="h-3.5 w-3.5" /></Link>
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : view === 'calendar' ? (
        <WorkCalendar
          events={calendar}
          viewer={viewer}
          view={range as CalendarView}
          onViewChange={setRange}
          onMove={moveEvent}
          undatedLabel="No due date"
          legend={
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Every item on its due date, coloured by the step it is on. Drag one to
              another day to move the date.
            </p>
          }
        />
      ) : (
        <LaneBoard
          ariaLabel="Editor columns"
          // a phone opens on the viewer's own step: the first column with
          // something that is theirs to move, else the first with anything
          initialLane={EDITOR_LANES.find(l => visible.some(i => l.statuses.includes(i.status) && editorAssignment(i, viewer!) === 'mine'))?.key}
          lanes={EDITOR_LANES.map((lane): Lane => {
              const colItems = plainItems.filter(i => lane.statuses.includes(i.status))
              // a quota card sits in the lane of its least-finished piece —
              // the work still owed — and in Drafting while it is empty
              const colGroups = groupCards.filter(c => lane.statuses.includes(c.laneStatus))
              return {
                key: lane.key,
                title: lane.title,
                tint: LANE_TINT[lane.key] ?? 'bg-zinc-400',
                count: colItems.length + colGroups.length,
                hint: lane.key === 'drafting' ? <HelpHint term="drafting" />
                  : lane.key === 'approved' ? <HelpHint term="approved_for_scheduling" /> : undefined,
                empty: filtering && visible.length === 0 && groupCards.length === 0 ? 'Nothing for this client / shoot' : LANE_EMPTY[lane.key] ?? 'Nothing here.',
                cards: [...colGroups.map(renderGroupCard), ...colItems.map(item => {
                      const assignment = editorAssignment(item, viewer!)
                      const ownerName = item.owner_id ? nameById.get(item.owner_id) : undefined
                      return (
                      <div key={item.id} className="relative">
                        <Card className={`cursor-pointer py-0 transition-shadow hover:shadow-md ${
                          KIND_CARD[item.work_kinds?.color ?? 'zinc'] ?? ''
                        } ${selectMode && selectedIds.has(item.id) ? 'ring-2 ring-inset ring-blue-500' : ''}`}>
                          <CardContent className="flex flex-col gap-1.5 p-3">
                            {/* the whole card opens the item, but as a stretched
                                link rather than a wrapper — a button inside an
                                anchor is invalid, and the claim button is one */}
                            <Link href={`/dashboard/production/${item.id}`} aria-label={item.title}
                              className="absolute inset-0 rounded-xl"
                              onClick={e => { if (selectMode) { e.preventDefault(); toggleSelected(item.id) } }} />
                            <div className="flex items-start justify-between gap-2">
                              {selectMode && (
                                <input type="checkbox" checked={selectedIds.has(item.id)} readOnly
                                  className="pointer-events-none mt-0.5 h-4 w-4 shrink-0 accent-blue-600" />
                              )}
                              <span className="text-sm font-medium leading-snug">{item.title}</span>
                              <Flag className={`mt-0.5 h-3 w-3 shrink-0 ${PRIORITY_TINT[item.priority] ?? ''}`} />
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant="outline" className="font-normal text-zinc-600 dark:text-zinc-400">
                                {item.clients?.name ?? '—'}
                              </Badge>
                              <span className="font-mono text-[11px] capitalize text-zinc-400 dark:text-zinc-500">{item.content_type}</span>
                              <Badge variant="outline" className="font-normal text-zinc-600 dark:text-zinc-400">
                                {itemStatusLabel(item.work_kinds?.slug, item.status, STATUS_LABELS[item.status])}
                              </Badge>
                              {item.work_kinds && item.work_kinds.slug !== 'edit' && (
                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${KIND_CHIP[item.work_kinds.color] ?? KIND_CHIP.zinc}`}>
                                  {item.work_kinds.name}
                                </span>
                              )}
                              {item.current_version_number > 0 && (
                                <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">v{item.current_version_number}</span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {/* TurnChip is the single answer to "is this on
                                  me?" — the old `you` pill said it twice. The
                                  initials answer a different question (who
                                  OWNS it, whoever's turn it is) and stay. */}
                              <TurnChip status={item.status} item={item} viewer={viewer!} ownerName={ownerName}
                                openTask={item.my_open_task}
                                onOpenComments={() => commentsDrawer.open(item.id, item.title)} />
                              {assignment === 'other' && ownerName && (
                                <span title={ownerName}
                                  className="rounded-full bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                  {initialsOf(ownerName)}
                                </span>
                              )}
                              {/* the conversation, right here — the drawer,
                                  not a trip to the item page */}
                              <CommentsButton className="ml-auto" tagged={item.my_open_task} title={item.title}
                                onOpen={() => commentsDrawer.open(item.id, item.title)} />
                            </div>
                            {(item.due_date || item.status === 'revision_required' || item.status === 'client_changes_requested') && (
                              <div className="flex items-center gap-2">
                                {item.due_date && (
                                  <span className="flex items-center gap-1 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                                    <CalendarDays className="h-3 w-3" />
                                    {new Date(item.due_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                                  </span>
                                )}
                                {item.status === 'revision_required' && (
                                  <Badge variant="outline" className="border-amber-200 bg-amber-50 font-normal text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">needs edit</Badge>
                                )}
                                {item.status === 'client_changes_requested' && (
                                  <Badge variant="outline" className="border-violet-200 bg-violet-50 font-normal text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-400">client changes</Badge>
                                )}
                              </div>
                            )}
                            {assignment === 'unassigned' && !selectMode && (
                              // above the stretched link, so these are clicks on
                              // a control and not on the card
                              <div className="relative z-10 flex flex-wrap items-center gap-1.5">
                                {canClaimEditor(item, viewer!) && (
                                  <ClaimButton itemId={item.id} hat="editor" onDone={load} />
                                )}
                                {isManager && nameById.size > 0 && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button size="sm" variant="outline" className="min-h-11 md:min-h-8">Assign…</Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                                      {[...nameById].map(([id, name]) => (
                                        <DropdownMenuItem key={id} onClick={() => void assignTo(item.id, id)}>
                                          {name}
                                        </DropdownMenuItem>
                                      ))}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </div>
                      )
                    })],
              }
            })}
        />
      )}

      {/* done, but kept visible: the two counts that belong to the next page */}
      {ready && canSeeScheduler && (
        <Link href="/dashboard/scheduler"
          className="flex min-h-11 items-center gap-1.5 self-start rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100">
          <span className="font-mono font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">{tail.scheduled}</span>
          scheduled ·
          <span className="font-mono font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">{tail.published}</span>
          published
          <ArrowRight className="h-3 w-3" /> Scheduler
        </Link>
      )}

      {/* select-mode action bar */}
      {selectMode && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-zinc-200 bg-white/95 px-4 py-2 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
          <span className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
            {selectedIds.size} selected
          </span>
          <Button size="sm" variant="ghost" className="min-h-11 px-2 text-xs"
            onClick={() => setSelectedIds(new Set(visible.map(i => i.id)))}>
            Select all
          </Button>
          <Button size="sm" variant="destructive" className="min-h-11 gap-1.5 px-3 text-xs"
            disabled={selectedIds.size === 0} onClick={() => setBulkOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
          <Button size="sm" variant="ghost" className="min-h-11 px-2 text-xs" onClick={exitSelect}>Cancel</Button>
        </div>
      )}

      {/* bulk delete confirm */}
      <AlertDialog open={bulkOpen} onOpenChange={o => !bulkBusy && setBulkOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.size === 1 ? 'this item' : `these ${selectedIds.size} items`}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Each item goes with its versions, comments, approvals, and schedule
              entries. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700"
              disabled={bulkBusy}
              onClick={e => { e.preventDefault(); void bulkDelete() }}>
              {bulkBusy ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* the side drawer: this board's cards open it via the comment button */}
      <CommentsDrawer target={commentsDrawer.target} onClose={commentsDrawer.close} />

      <NewItemDialog
        open={newOpen}
        onOpenChange={o => { setNewOpen(o); if (!o) setPreset(undefined) }}
        onCreated={load}
        preset={preset}
        clients={clients}
        batches={batches}
        team={team}
      />
    </div>
  )
}
