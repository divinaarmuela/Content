'use client'

import { useCallback, useEffect, useState } from 'react'
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
import { Plus, CalendarDays, CheckSquare, Flag, ListChecks, Trash2, ArrowRight } from 'lucide-react'
import { SCHEDULER_STATUSES, STATUS_LABELS, type ItemStatus } from '../../lib/workflow-core'
import { itemStatusLabel } from '../../lib/brief-task-core'
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
import { usePersistedChoice, usePersistedScope, useTeamNames } from '../production/workHooks'
import { ScopeSwitch } from '../production/ScopeSwitch'
import { ClaimButton } from '../production/ClaimButton'
import { TurnChip } from '../production/TurnChip'
import { LaneBoard, type Lane } from '../production/LaneBoard'
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
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [batchFilter, setBatchFilter] = useState<string>('all')
  const [needsSchema, setNeedsSchema] = useState(false)

  const [newOpen, setNewOpen] = useState(false)
  const [preset, setPreset] = useState<{ client_id?: string; batch_id?: string } | undefined>()

  const { me, role, loading, can } = useRole()
  const isManager = can('account_manager')
  const viewer: Viewer | null = me ? { id: me.id, role: me.role } : null
  // the footer is a link to another PAGE — only offer it to someone who may
  // open it. No grants are loaded here, so this is the role default; a
  // person granted the page individually reaches it from the sidebar.
  const canSeeScheduler = defaultAllows(me?.role ?? null, '/dashboard/scheduler')

  // managers can hand a loose job to somebody by name instead of waiting for
  // it to be picked up
  const nameById = useTeamNames(isManager)
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
      const [itemsRes, clientsRes, batchesRes] = await Promise.all([
        fetch('/api/production/items', { cache: 'no-store' }),
        // scope=mine: the client filter and the New-work dialog offer the
        // clients this person holds work for, assignments included
        fetch('/api/website/clients?scope=mine'),
        fetch('/api/production/batches'),
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
      }
    },
    data => {
      if (data.noSchema) { setNeedsSchema(true); setItems([]); return }
      if (data.items) setItems(data.items)
      if (data.clients) setClients(data.clients)
      if (data.batches) setBatches(data.batches)
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
      ) : scoped.length === 0 ? (
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
              const colItems = visible.filter(i => lane.statuses.includes(i.status))
              return {
                key: lane.key,
                title: lane.title,
                tint: LANE_TINT[lane.key] ?? 'bg-zinc-400',
                count: colItems.length,
                hint: lane.key === 'drafting' ? <HelpHint term="drafting" />
                  : lane.key === 'approved' ? <HelpHint term="approved_for_scheduling" /> : undefined,
                empty: filtering && visible.length === 0 ? 'Nothing for this client / shoot' : LANE_EMPTY[lane.key] ?? 'Nothing here.',
                cards: colItems.map(item => {
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
                                openTask={item.my_open_task} />
                              {assignment === 'other' && ownerName && (
                                <span title={ownerName}
                                  className="rounded-full bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                  {initialsOf(ownerName)}
                                </span>
                              )}
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
                    }),
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

      <NewItemDialog
        open={newOpen}
        onOpenChange={o => { setNewOpen(o); if (!o) setPreset(undefined) }}
        onCreated={load}
        preset={preset}
        clients={clients}
        batches={batches}
      />
    </div>
  )
}
