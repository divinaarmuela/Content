'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Camera, CalendarDays, ChevronDown, ChevronUp, FileText, ListChecks, MoreHorizontal, Plus, Search, Trash2,
} from 'lucide-react'
import type { BatchStatus } from '../../lib/batch-brief-core'
import { type ItemStatus } from '../../lib/workflow-core'
import { BRIEF_STATUS_TURN, itemStatusLabel } from '../../lib/brief-task-core'
import { TASK_STATUS_TURN, taskStatusLabel } from '../../lib/task-kind-core'
import {
  BRIEF_LANES, activeBriefTasks, activeInternalTasks, canClaimEditor, editorAssignment,
  isBriefTask, isInternalTask, productionScope, recentlyDoneTasks, unassignedCount,
  type ScopeMode, type Viewer,
} from '../../lib/work-pages-core'
import { SHOWN_SHOOT_LABEL, shownShootState } from '../../lib/shoot-lifecycle-core'
import {
  addNextLabel, groupLine, isTaskGroup, nextPieceTitle, splitByGroup,
  type DeliverableGroup, type GroupCard,
} from '../../lib/deliverable-group-core'
import {
  dayLabel, eventsFor, movePatch, moveUrl, type CalEvent,
} from '../../lib/work-calendar-core'
import WorkCalendar, { ViewSwitch, type CalendarView } from '../../components/calendar/WorkCalendar'
import { useProductionLive } from './useProductionLive'
import { useOrderedLoad } from '../useOrderedLoad'
import { AccountUnavailable, BATCH_STATUS_STYLE, KIND_CHIP } from './shoot-ui'
import { teamNameMap, usePersistedChoice, usePersistedScope, useTeamMembers } from './workHooks'
import { useRole } from '../useRole'
import NewItemDialog, { type ClientRow } from './NewItemDialog'
import { ClaimButton } from './ClaimButton'
import { ScopeSwitch } from './ScopeSwitch'
import { TurnChip } from './TurnChip'
import { LaneBoard, type Lane } from './LaneBoard'
import CommentsDrawer, { CommentsButton, useCommentsDrawer } from '../../components/comments/CommentsDrawer'
import GettingStarted from '../GettingStarted'
import HelpHint from '../HelpHint'
import { toastOpen } from '../toastLink'

type Shoot = {
  id: string
  title: string
  status: BatchStatus
  client_id: string
  owner_id?: string | null
  shoot_date: string | null
  shot_list?: { done?: boolean }[] | null
  planned_deliverables?: { qty: number }[] | null
  clients: { name: string } | null
  content_items?: { count: number }[]
}
type BriefTask = {
  id: string
  title: string
  client_id: string
  batch_id: string | null
  status: ItemStatus
  due_date: string | null
  updated_at?: string | null
  owner_id: string | null
  scheduler_ids?: unknown
  my_open_task?: boolean
  /** the quota group this piece belongs to, when it was made inside one */
  group_id?: string | null
  clients: { name: string } | null
  work_kinds?: { name: string; slug: string; color: string; uses_media?: boolean } | null
  /** the audit trail, as much of it as a card has room for */
  created_by?: string | null
  approved_by?: string | null
  current_version_number?: number
}

/** "Manal made this · Divina approved it" — the log, on the card. */
function credits(i: { created_by?: string | null; approved_by?: string | null }): string | null {
  return [
    i.created_by && `by ${i.created_by}`,
    i.approved_by && `approved by ${i.approved_by}`,
  ].filter(Boolean).join(' · ') || null
}

const SCOPE_KEY = 'md-production-scope'
const VIEW_KEY = 'md-production-view'
const RANGE_KEY = 'md-production-cal-range'
const VIEWS = ['board', 'calendar'] as const
const RANGES = ['month', 'week'] as const

/** One dot per lane, in the order work moves — the Editor board's colours,
 *  because a lane called "Ready for review" should look the same everywhere
 *  it appears. */
const LANE_TINT: Record<string, string> = {
  doing: 'bg-zinc-400',
  review: 'bg-blue-500',
  revising: 'bg-amber-500',
  client: 'bg-violet-500',
  approved: 'bg-emerald-500',
}

/** What FILLS an empty column, in plain words — not just "nothing here". */
const LANE_EMPTY: Record<string, string> = {
  doing: 'New shoots, plans and tasks start here while they are being written.',
  review: 'Work sent for review waits here for a manager.',
  revising: 'Work the reviewer or client asked to change comes back here.',
  client: 'Plans sent to the client for sign-off sit here.',
  approved: 'Approved plans wait here until someone books the shoot.',
}

function whenShort(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
}

/**
 * Production: ONE board.
 *
 * It used to be three boards stacked — a Shoots section, a "Shoot plans" lane
 * board and a "Tasks" lane board — and finding one job meant scrolling past
 * two boards that were not about it. Now everything still being planned
 * flows across the same five columns the Editor board taught everyone:
 * Writing · Ready for review · Being revised · With client · Approved.
 * A shoot-plan card carries its shoot date and a status chip; a booked shoot
 * leaves the board (its chip lives in the strip below); tasks ride the same
 * columns in their own words.
 */
export default function ProductionPage() {
  const router = useRouter()
  const [shoots, setShoots] = useState<Shoot[] | null>(null)
  const [briefTasks, setBriefTasks] = useState<BriefTask[]>([])
  const [internalTasks, setInternalTasks] = useState<BriefTask[]>([])
  const [taskOpen, setTaskOpen] = useState(false)
  const [clients, setClients] = useState<ClientRow[]>([])
  /** quota groups — a "5 write-ups" task promise as one card. [] until the
   *  SQL has run; the endpoint degrades to [] on a missing table. */
  const [groups, setGroups] = useState<DeliverableGroup[]>([])
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [clientFilter, setClientFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [needsSchema, setNeedsSchema] = useState(false)
  /** finished tasks are a tail, not a queue — collapsed until asked for */
  const [doneOpen, setDoneOpen] = useState(false)
  /** closed shoots in the strip — hidden until asked for */
  const [closedOpen, setClosedOpen] = useState(false)

  // the comments drawer: read and answer an item's comments without leaving
  // the board. `?comments=<itemId>` opens it on load (notification links).
  const commentsDrawer = useCommentsDrawer()

  const [briefOpen, setBriefOpen] = useState(false)

  const { me, role, loading, can } = useRole()
  const canPlan = can('editor')
  const isManager = can('account_manager')
  const viewer: Viewer | null = me ? { id: me.id, role: me.role } : null

  // names for "waiting on …" and the Assign… menu — managers only. One
  // `/api/team` fetch, shared with the two New-work dialogs below.
  const team = useTeamMembers(isManager)
  const nameById = useMemo(() => teamNameMap(team), [team])
  const [scope, setScope] = usePersistedScope(SCOPE_KEY, role)
  // the board and the calendar are two readings of the same page, and which
  // one you were on is worth remembering between visits
  const [view, setView] = usePersistedChoice(VIEW_KEY, VIEWS, 'board', 'view')
  const [range, setRange] = usePersistedChoice(RANGE_KEY, RANGES, 'month')

  /** The page, refetched with its answers kept in order — and never dropped.
   *  One fetcher, one apply; see lib/load-order.ts for why "newest issued
   *  wins" threw away every post-mutation refetch. */
  const loadOrdered = useOrderedLoad<{
    shoots: Shoot[]; clients?: ClientRow[]; items?: BriefTask[]; groups?: DeliverableGroup[]
  }>(
    async () => {
      const [bRes, cRes, iRes, gRes] = await Promise.all([
        fetch('/api/production/batches', { cache: 'no-store' }),
        // the clients this person actually works for — their team's, plus any
        // they hold a shoot or an item on. The server decides; a client-side
        // role guess is how the assignee got left out in the first place.
        fetch('/api/website/clients?scope=mine'),
        fetch('/api/production/items', { cache: 'no-store' }),
        // quota groups — [] on a database where the table has not been made
        fetch('/api/production/groups', { cache: 'no-store' }),
      ])
      return {
        shoots: bRes.ok ? (await bRes.json()) as Shoot[] : [],
        clients: cRes.ok ? ((await cRes.json()) as ClientRow[]).filter(Boolean) : undefined,
        // every plan, not just the live ones: the lanes want the active ones,
        // but a shoot chip still has to say "Booked"
        items: iRes.ok ? (await iRes.json()) as BriefTask[] : undefined,
        groups: gRes.ok ? (await gRes.json()) as DeliverableGroup[] : [],
      }
    },
    data => {
      // schema not migrated yet → rows have no status; show the setup card
      setNeedsSchema(data.shoots.length > 0 && data.shoots.every(r => !r.status))
      setShoots(data.shoots)
      if (data.clients) setClients(data.clients)
      if (data.items) {
        setBriefTasks(data.items.filter(isBriefTask))
        setInternalTasks(data.items.filter(isInternalTask))
      }
      setGroups(Array.isArray(data.groups) ? data.groups : [])
    },
  )
  const load = useCallback(async () => {
    try {
      await loadOrdered()
    } catch {
      toast.error('Could not load shoots')
      setShoots([])
    }
  }, [loadOrdered])
  useEffect(() => { void load() }, [load])
  useProductionLive(useCallback(() => { void load() }, [load]))

  const [toDelete, setToDelete] = useState<Shoot | null>(null)
  const [delBusy, setDelBusy] = useState(false)

  const remove = async () => {
    if (!toDelete) return
    setDelBusy(true)
    try {
      const res = await fetch(`/api/production/batches/${toDelete.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not delete the shoot')
      toast.success('Shoot deleted')
      setToDelete(null)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the shoot')
    } finally {
      setDelBusy(false)
    }
  }

  /** Hand a loose plan or task to somebody. Manager-only on the server too. */
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

  /**
   * Drag a card onto another day.
   *
   * The row moves on screen first, because a date that waits for a round trip
   * before it lands makes the drag feel broken — and then `load()` has the
   * last word either way (the sequence-stamped load from lib/load-order.ts).
   * The server is the authority on WHO may do this.
   */
  const moveEvent = async (e: CalEvent, day: string) => {
    const patch = movePatch(e, day)
    if (!patch) return
    if (e.kind === 'shoot') {
      setShoots(prev => (prev ?? []).map(s => (s.id === e.entityId ? { ...s, shoot_date: day } : s)))
    } else {
      const bump = (rows: BriefTask[]) =>
        rows.map(t => (t.id === e.entityId ? { ...t, due_date: day } : t))
      setBriefTasks(bump)
      setInternalTasks(bump)
    }
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

  /**
   * After creating something, make sure the person can SEE it.
   *
   * A task created with nobody on it is "unassigned"; if the remembered scope
   * happens to be "Mine" alone, the board answered a successful creation with
   * an empty page. Creating is an explicit act — it earns a view.
   */
  const revealCreated = (created?: { id: string; owner_id?: string | null }[]) => {
    void load()
    if (!viewer || !created?.length || scope.has('all')) return
    const hidden = created.some(r => {
      const a = editorAssignment({ id: r.id, status: 'draft_uploaded', owner_id: r.owner_id ?? null }, viewer)
      return a === 'other' || !scope.has(a)
    })
    if (!hidden) return
    setScope(new Set<ScopeMode>(['all']))
    toast.message('Showing everyone’s, so the new work is on screen.')
  }

  const matches = (clientId: string, title: string) =>
    (clientFilter === 'all' || clientId === clientFilter)
    && (!search || title.toLowerCase().includes(search.toLowerCase()))

  const visibleShoots = (shoots ?? []).filter(s => matches(s.client_id, s.title))
  const batchById = useMemo(
    () => new Map((shoots ?? []).map(s => [s.id, s])),
    [shoots],
  )

  // a plan and its shoot are one job: whoever owns the shoot owns the plan,
  // even when the task row itself was never assigned to anybody
  const batchOwnerById = Object.fromEntries((shoots ?? []).map(s => [s.id, s.owner_id ?? null]))
  const briefsInFilters = activeBriefTasks(briefTasks).filter(b => matches(b.client_id, b.title))
  const briefRows = viewer
    ? productionScope(briefsInFilters, viewer, scope, batchOwnerById)
    : []
  // built from every plan, so a booked one still labels its shoot chip
  const briefByBatch = new Map(briefTasks.filter(b => b.batch_id).map(b => [b.batch_id as string, b]))
  // research / strategy / copy — production work with nothing to post
  const tasksInFilters = activeInternalTasks(internalTasks).filter(t => matches(t.client_id, t.title))
  const doneInFilters = recentlyDoneTasks(internalTasks).filter(t => matches(t.client_id, t.title))
  const scopedTaskRows = viewer ? productionScope(tasksInFilters, viewer, scope, {}) : []
  const doneRows = viewer ? productionScope(doneInFilters, viewer, scope, {}) : []

  // "5 write-ups" is ONE card that fills up — a task group folds its pieces
  // into a single card exactly like the asset quota cards on the Editor
  // board. The card counts EVERY piece — done ones included, whatever the
  // scope pills say — or a finished piece would shrink the count back down.
  const taskGroups = groups.filter(g => isTaskGroup(g) && matches(g.client_id, g.title))
  const { groupCards: taskGroupCards } = splitByGroup(
    internalTasks.filter(t => matches(t.client_id, t.title)), taskGroups)
  const groupedTaskIds = new Set(taskGroupCards.flatMap(c => c.items.map(i => i.id)))
  const taskRows = scopedTaskRows.filter(t => !groupedTaskIds.has(t.id))
  const doneShown = doneRows.filter(t => !groupedTaskIds.has(t.id))

  // shoots with NO plan yet, still in planning: they get their own card in
  // Writing — the plan they are waiting for is written there. Booked and shot
  // shoots have left the board; they live in the strip below the columns.
  const planlessShoots = visibleShoots.filter(s =>
    !briefByBatch.has(s.id) && (s.status ?? 'brief') === 'brief')
  const bookedShoots = visibleShoots.filter(s => ['locked', 'shot'].includes(s.status ?? ''))
  const closedShoots = visibleShoots.filter(s => (s.status ?? '') === 'wrapped')

  const boardCount = briefRows.length + taskRows.length + taskGroupCards.length + planlessShoots.length
  const outOfScope = (briefsInFilters.length - briefRows.length) + (tasksInFilters.length - scopedTaskRows.length)
  const nothingToShow = shoots !== null && boardCount === 0 && doneRows.length === 0
    && bookedShoots.length === 0 && closedShoots.length === 0

  // the pool: plans and tasks nobody has picked up yet
  const openPool = viewer
    ? unassignedCount([...briefsInFilters, ...tasksInFilters], viewer, editorAssignment)
    : 0

  /** The calendar, drawn from exactly the rows the board is drawn from. */
  const calendar = eventsFor('production', {
    batches: visibleShoots,
    items: [...briefRows, ...taskRows, ...doneRows],
  })

  // the whole page hangs off the viewer, so a missing account is not a slower
  // load — it is a different screen, and saying so beats a skeleton forever
  if (!loading && !viewer) return <AccountUnavailable />

  /** The Assign… menu — the affordance the chip promised and the page lacked. */
  const assignMenu = (itemId: string) => (
    isManager && nameById.size > 0 ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="min-h-11 md:min-h-8">Assign…</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
          {[...nameById].map(([uid, name]) => (
            <DropdownMenuItem key={uid} onClick={() => void assignTo(itemId, uid)}>{name}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null
  )

  /** A shoot plan's card — the shoot date and state chip ride it, because the
   *  plan and its shoot are one job on one card now. */
  const briefCard = (b: BriefTask, laneKey: string) => {
    const shoot = b.batch_id ? batchById.get(b.batch_id) : undefined
    const state = shoot ? shownShootState(shoot) : null
    return (
      <div key={b.id} className="relative">
        <Card className="py-0 transition-shadow hover:shadow-md">
          <CardContent className="flex flex-col gap-1.5 p-3">
            {/* the whole card opens the plan, as a stretched link rather
                than a wrapper — the buttons below are buttons */}
            <Link href={`/dashboard/production/${b.id}`} aria-label={b.title}
              className="absolute inset-0 rounded-xl" />
            <div className="flex items-center gap-2">
              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-sky-700 dark:bg-sky-950/50 dark:text-sky-400">
                Shoot plan
              </span>
              <span className="truncate text-sm font-medium leading-snug">{b.title}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="font-normal text-zinc-600 dark:text-zinc-400">
                {b.clients?.name ?? '—'}
              </Badge>
              <Badge variant="outline" className="font-normal text-zinc-600 dark:text-zinc-400">
                {itemStatusLabel('shoot_brief', b.status, b.status)}
              </Badge>
              {shoot && state && (
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${BATCH_STATUS_STYLE[shoot.status ?? 'brief']}`}>
                  {SHOWN_SHOOT_LABEL[state]}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {viewer && (
                <TurnChip status={b.status} item={b} viewer={viewer} turns={BRIEF_STATUS_TURN} brief
                  openTask={b.my_open_task}
                  onOpenComments={() => commentsDrawer.open(b.id, b.title)}
                  ownerName={b.owner_id ? nameById.get(b.owner_id) : undefined} />
              )}
              {(shoot?.shoot_date || b.due_date) && (
                <span className="flex items-center gap-1 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                  <CalendarDays className="h-3 w-3" />
                  {whenShort(shoot?.shoot_date ?? b.due_date)}
                </span>
              )}
              {/* the conversation, right here — the drawer, not a page trip */}
              <CommentsButton className="ml-auto" tagged={b.my_open_task} title={b.title}
                onOpen={() => commentsDrawer.open(b.id, b.title)} />
            </div>
            {credits(b) && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{credits(b)}</p>
            )}
            {(laneKey === 'approved' || !b.owner_id) && (
              // above the stretched link, so these are clicks on a control
              <div className="relative z-10 flex flex-wrap items-center gap-1.5">
                {laneKey === 'approved' && shoot && (
                  // the ONE action an approved plan wants: the date is picked
                  // and committed on the shoot page
                  <Button size="sm" className="min-h-11 md:min-h-8" asChild>
                    <Link href={`/dashboard/production/shoots/${shoot.id}`}>Book the shoot</Link>
                  </Button>
                )}
                {!b.owner_id && assignMenu(b.id)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  const taskCard = (t: BriefTask, muted = false) => {
    const assignment = viewer ? editorAssignment(t, viewer) : 'other'
    return (
      <div key={t.id} className="relative">
        <Card className={`py-0 transition-shadow hover:shadow-md ${muted ? 'opacity-60' : ''}`}>
          <CardContent className="flex flex-col gap-1.5 p-3">
            {/* the whole card opens the task, as a stretched link rather than
                a wrapper — the claim button below is a button, not an anchor */}
            <Link href={`/dashboard/production/${t.id}`} aria-label={t.title}
              className="absolute inset-0 rounded-xl" />
            <span className="text-sm font-medium leading-snug">{t.title}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="font-normal text-zinc-600 dark:text-zinc-400">
                {t.clients?.name ?? '—'}
              </Badge>
              {/* "Not started" and "In progress" share the Writing lane — the
                  card is the only place that can tell them apart */}
              <Badge variant="outline" className="font-normal text-zinc-600 dark:text-zinc-400">
                {taskStatusLabel(t.work_kinds, t.status, t.status, { hasWork: (t.current_version_number ?? 0) > 0 })}
              </Badge>
              {t.work_kinds?.name && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${KIND_CHIP[t.work_kinds.color] ?? KIND_CHIP.zinc}`}>
                  {t.work_kinds.name}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {viewer && (
                <TurnChip status={t.status} item={t} viewer={viewer} turns={TASK_STATUS_TURN}
                  openTask={t.my_open_task}
                  onOpenComments={() => commentsDrawer.open(t.id, t.title)}
                  ownerName={t.owner_id ? nameById.get(t.owner_id) : undefined} />
              )}
              {t.due_date && (
                <span className="flex items-center gap-1 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                  <CalendarDays className="h-3 w-3" />
                  {whenShort(t.due_date)}
                </span>
              )}
              {/* the conversation, right here — the drawer, not a page trip */}
              <CommentsButton className="ml-auto" tagged={t.my_open_task} title={t.title}
                onOpen={() => commentsDrawer.open(t.id, t.title)} />
            </div>
            {credits(t) && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{credits(t)}</p>
            )}
            {assignment === 'unassigned' && viewer && !muted && (
              // above the stretched link, so these are clicks on a control
              <div className="relative z-10 flex flex-wrap items-center gap-1.5">
                {canClaimEditor(t, viewer) && (
                  <ClaimButton itemId={t.id} hat="editor" onDone={load} />
                )}
                {assignMenu(t.id)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  /** "Add the next piece" — one real task, filed into the group. */
  const addNextPiece = async (card: GroupCard<BriefTask>) => {
    setAddingTo(card.group.id)
    try {
      const res = await fetch('/api/production/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{
          client_id: card.group.client_id,
          batch_id: null,
          group_id: card.group.id,
          title: nextPieceTitle(card.group, card.count),
          content_type: 'other',
          ...(card.group.work_kind_id ? { work_kind_id: card.group.work_kind_id } : {}),
        }] }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error((json as { error?: string } | null)?.error ?? 'Could not add it')
      const made = Array.isArray(json) ? json[0] : null
      toastOpen(
        `${made?.title ?? 'Piece'} added — ${card.count + 1} of ${card.target}`,
        made?.id ? `/dashboard/production/${made.id}` : '/dashboard/production',
        router.push,
      )
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add it')
    } finally {
      setAddingTo(null)
    }
  }

  /** A task quota card: the promise, how full it is, and the pieces inside. */
  const taskGroupCard = (card: GroupCard<BriefTask>) => {
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
              {card.group.work_kinds?.name && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${KIND_CHIP[card.group.work_kinds.color ?? 'zinc'] ?? KIND_CHIP.zinc}`}>
                  {card.group.work_kinds.name}
                </span>
              )}
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
                    <span className="shrink-0 text-zinc-400 dark:text-zinc-500">
                      {taskStatusLabel(i.work_kinds, i.status, i.status, { hasWork: (i.current_version_number ?? 0) > 0 })}
                    </span>
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

  /** A shoot with no plan yet — its card IS the reminder to write one. */
  const shootCard = (s: Shoot) => {
    const canDelete = isManager && (s.content_items?.[0]?.count ?? 0) === 0
    return (
      <div key={s.id} className="relative">
        <Card className="py-0 transition-shadow hover:shadow-md">
          <CardContent className="flex flex-col gap-1.5 p-3">
            <Link href={`/dashboard/production/shoots/${s.id}`} aria-label={s.title}
              className="absolute inset-0 rounded-xl" />
            <div className="flex items-center gap-2">
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                Shoot
              </span>
              <span className="truncate text-sm font-semibold">{s.title}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="font-normal text-zinc-600 dark:text-zinc-400">
                {s.clients?.name ?? '—'}
              </Badge>
              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${BATCH_STATUS_STYLE[s.status ?? 'brief']}`}>
                {SHOWN_SHOOT_LABEL[shownShootState(s)]}
              </span>
              {s.shoot_date && (
                <span className="flex items-center gap-1 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                  <CalendarDays className="h-3 w-3" />
                  {whenShort(s.shoot_date)}
                </span>
              )}
            </div>
            <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">Write the shoot plan →</p>
          </CardContent>
        </Card>
        {canDelete && (
          // an overflow menu, not a hover-only icon: on a tablet a control
          // that only appears on hover does not exist
          <div className="absolute right-2 top-2 z-10">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-11 w-11 text-zinc-400 md:h-8 md:w-8"
                  aria-label={`More for ${s.title}`}
                  onClick={e => { e.preventDefault(); e.stopPropagation() }}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-rose-600 dark:text-rose-400"
                  onClick={e => { e.preventDefault(); setToDelete(s) }}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete shoot
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    )
  }

  /** A booked or closed shoot in the strip — one chip, straight to its page. */
  const shootChip = (s: Shoot) => (
    <Link key={s.id} href={`/dashboard/production/shoots/${s.id}`}
      className="flex min-h-11 items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-600 transition-colors hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-300 dark:hover:text-zinc-100">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${shownShootState(s) === 'shot' ? 'bg-violet-500' : 'bg-sky-500'}`} />
      {s.title}
      <span className="opacity-60">· {SHOWN_SHOOT_LABEL[shownShootState(s)]}{s.shoot_date ? ` · ${whenShort(s.shoot_date)}` : ''}</span>
    </Link>
  )

  return (
    <div className="flex flex-col gap-4">
      {viewer && shoots !== null && <GettingStarted role={role} page="production" />}

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Shoots <HelpHint term="shoot" />, shoot plans <HelpHint term="shoot_plan" /> and tasks — one board
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Board answers "whose step is this on"; Calendar answers "what is
              happening on Thursday". Same rows, same filters, two questions. */}
          <ViewSwitch
            label="How to show this page"
            value={view}
            onChange={setView}
            options={[
              { value: 'board', label: 'Board', icon: ListChecks },
              { value: 'calendar', label: 'Calendar', icon: CalendarDays },
            ]}
          />
          {/* one place, always on screen — a control that moves with the data
              is a control nobody learns */}
          <ScopeSwitch scope={scope} onChange={setScope} unassignedCount={openPool}
            unassignedHint="Plans and tasks nobody has picked up yet." />
          <Select value={clientFilter} onValueChange={v => v && setClientFilter(v)}>
            <SelectTrigger className="w-44 bg-white dark:bg-zinc-900"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
            <Input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search shoots, plans and tasks…" className="w-56 bg-white pl-8 dark:bg-zinc-900" />
          </div>
          {(canPlan || isManager) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="min-h-11 md:min-h-9"><Plus className="h-4 w-4" /> New <ChevronDown className="h-3.5 w-3.5 opacity-70" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                {/* one line of context: a shoot plan IS the shoot — there is
                    no separate "make a shoot" step to get wrong */}
                <p className="px-2 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  A shoot plan is the concept and shot list for a filming day. Making it sets up the shoot too.
                </p>
                {canPlan && (
                  <DropdownMenuItem className="min-h-11 items-start" onClick={() => setBriefOpen(true)}>
                    <FileText className="mt-0.5 h-4 w-4" />
                    <span className="flex flex-col">
                      New shoot plan
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">the plan the client signs off — creates the shoot with it</span>
                    </span>
                  </DropdownMenuItem>
                )}
                {canPlan && (
                  <DropdownMenuItem className="min-h-11 items-start" onClick={() => setTaskOpen(true)}>
                    <ListChecks className="mt-0.5 h-4 w-4" />
                    <span className="flex flex-col">
                      Other work
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">research, strategy or copy — nothing to post</span>
                    </span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <p className="-mt-2 text-xs text-zinc-400 dark:text-zinc-500">
        The Mine / Nobody&rsquo;s / Everyone switch covers plans and tasks. Shoots are always shown.
        {outOfScope > 0 && <> ({outOfScope} more outside this view)</>}
      </p>

      {needsSchema && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardContent className="p-4 text-sm text-amber-800 dark:text-amber-300">
            This part of the app isn&rsquo;t switched on yet. Send this to your developer:
            run <span className="font-mono">supabase/agreements_and_briefs.sql</span>.
          </CardContent>
        </Card>
      )}

      {view === 'calendar' ? (
        <WorkCalendar
          events={calendar}
          viewer={viewer}
          view={range as CalendarView}
          onViewChange={setRange}
          onMove={moveEvent}
          undatedLabel="No date yet"
          legend={
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Shoots sit on their shoot date; plans and tasks on their due date. Drag one
              to another day to move it — a booked shoot moves from the shoot
              page, with a reason.
            </p>
          }
        />
      ) : shoots === null ? (
        <div className="flex gap-3 overflow-x-hidden">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-72 min-w-44 flex-1" />)}
        </div>
      ) : nothingToShow ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <Camera className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
            </div>
            <p className="text-sm font-medium">Nothing on the board yet</p>
            <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              {outOfScope > 0
                ? 'Work is being planned, but none of it is yours.'
                : 'Start with a shoot plan — the concept and shot list for a filming day. Making it sets up the shoot too.'}
            </p>
            {/* planning is always a valid next move for whoever can plan —
                whatever the reason the page is empty */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {outOfScope > 0 && (
                <Button variant="outline" size="sm" className="min-h-11" onClick={() => setScope(new Set<ScopeMode>(['all']))}>
                  Show everyone&rsquo;s
                </Button>
              )}
              {canPlan && <Button size="sm" className="min-h-11" onClick={() => setBriefOpen(true)}><Plus className="h-4 w-4" /> New shoot plan</Button>}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <LaneBoard
            ariaLabel="Production columns"
            initialLane={BRIEF_LANES.find(l =>
              briefRows.some(b => l.statuses.includes(b.status) && b.owner_id === viewer?.id)
              || taskRows.some(t => l.statuses.includes(t.status) && (t.owner_id === viewer?.id || t.my_open_task)))?.key}
            lanes={BRIEF_LANES.map((lane): Lane => {
              const laneBriefs = briefRows.filter(b => lane.statuses.includes(b.status))
              const laneTasks = taskRows.filter(t => lane.statuses.includes(t.status))
              // a task quota card sits in the lane of its least-finished
              // piece — the work still owed — and starts in Writing
              const laneGroups = taskGroupCards.filter(c => lane.statuses.includes(c.laneStatus))
              const laneShoots = lane.key === 'doing' ? planlessShoots : []
              const cards = [
                ...laneShoots.map(shootCard),
                ...laneBriefs.map(b => briefCard(b, lane.key)),
                ...laneGroups.map(taskGroupCard),
                ...laneTasks.map(t => taskCard(t)),
              ]
              // finished tasks are a tail on the last column, collapsed:
              // "Back" from a finished task still lands somewhere real
              if (lane.key === 'approved' && doneShown.length > 0) {
                cards.push(!doneOpen
                  ? (
                    <button key="done-toggle" type="button" onClick={() => setDoneOpen(true)}
                      className="min-h-11 rounded-lg border border-dashed border-zinc-200 py-4 text-center text-xs text-zinc-500 hover:text-zinc-800 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
                      {doneShown.length} task{doneShown.length === 1 ? '' : 's'} finished in the last 14 days — show
                    </button>
                  ) : (
                    <div key="done-list" className="flex flex-col gap-2">
                      {doneShown.map(t => taskCard(t, true))}
                      <button type="button" onClick={() => setDoneOpen(false)}
                        className="min-h-11 self-start px-1 text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
                        Hide finished tasks
                      </button>
                    </div>
                  ))
              }
              return {
                key: lane.key,
                title: lane.title,
                tint: LANE_TINT[lane.key] ?? 'bg-zinc-400',
                count: laneShoots.length + laneBriefs.length + laneGroups.length + laneTasks.length,
                empty: LANE_EMPTY[lane.key] ?? 'Nothing here.',
                cards,
              }
            })}
          />

          {/* booked shoots have left the board — but not the page. One chip
              each, straight to the shoot page where the items are created. */}
          {(bookedShoots.length > 0 || closedShoots.length > 0) && (
            <div className="flex flex-col gap-1.5">
              <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                Booked shoots <span className="tabular-nums">{bookedShoots.length}</span>
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {bookedShoots.map(shootChip)}
                {closedShoots.length > 0 && (
                  !closedOpen ? (
                    <button type="button" onClick={() => setClosedOpen(true)}
                      className="min-h-11 rounded-full border border-dashed border-zinc-200 px-3 py-1 text-xs text-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:hover:text-zinc-200">
                      {closedShoots.length} closed — show
                    </button>
                  ) : (
                    <>
                      {closedShoots.map(shootChip)}
                      <button type="button" onClick={() => setClosedOpen(false)}
                        className="min-h-11 px-2 text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
                        Hide closed
                      </button>
                    </>
                  )
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* the side drawer: this board's cards open it via the comment button */}
      <CommentsDrawer target={commentsDrawer.target} onClose={commentsDrawer.close} />

      {/* the SHOOT PLAN — the reviewable plan that rides the item pipeline.
          presetKind locks the kind: without it the dialog filters it out. */}
      <NewItemDialog
        open={briefOpen}
        onOpenChange={setBriefOpen}
        onCreated={revealCreated}
        presetKind="shoot_brief"
        clients={clients}
        batches={shoots ?? []}
        briefedBatchIds={[...briefByBatch.keys()]}
        team={team}
      />

      {/* a TASK: research, strategy, copy — no shoot, no post, ends at Done */}
      <NewItemDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        onCreated={revealCreated}
        presetKind="task"
        clients={clients}
        batches={shoots ?? []}
        team={team}
      />

      <AlertDialog open={!!toDelete} onOpenChange={o => !delBusy && !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the shoot, its plan and its board. It cannot be undone. A shoot
              that produced no items can be deleted at any stage; one with items is closed instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delBusy}>Keep it</AlertDialogCancel>
            <AlertDialogAction disabled={delBusy}
              className="bg-rose-600 hover:bg-rose-700"
              onClick={e => { e.preventDefault(); void remove() }}>
              {delBusy ? 'Deleting…' : 'Delete shoot'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
