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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
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
  Camera, CalendarDays, ChevronDown, FileText, ListChecks, MoreHorizontal, Plus, Search, Trash2,
} from 'lucide-react'
import type { BatchStatus } from '../../lib/batch-brief-core'
import { type ItemStatus } from '../../lib/workflow-core'
import { BRIEF_STATUS_TURN, itemStatusLabel } from '../../lib/brief-task-core'
import { TASK_STATUS_TURN, taskStatusLabel } from '../../lib/task-kind-core'
import {
  BRIEF_LANES, TASK_LANES, activeBriefTasks, activeInternalTasks, canClaimEditor, editorAssignment,
  isBriefTask, isInternalTask, productionScope, recentlyDoneTasks, unassignedCount,
  type ScopeMode, type Viewer,
} from '../../lib/work-pages-core'
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
import GettingStarted from '../GettingStarted'
import HelpHint from '../HelpHint'
import { toastOpen } from '../toastLink'
import { SHOOT_PLAN_SECTION, SHOOTS_SECTION, TASK_SECTION } from '../../lib/section-names'

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

/** The four stages a shoot goes through — and what each one actually means,
 *  said once on the page instead of nowhere. */
const SECTIONS: { status: BatchStatus; title: string; hint: string }[] = [
  { status: 'brief', title: 'IN PLANNING', hint: 'No date yet.' },
  { status: 'locked', title: 'DATE LOCKED', hint: 'Booked. The team is prepping.' },
  { status: 'shot', title: 'SHOT', hint: 'Footage is in; the edit is running.' },
  { status: 'wrapped', title: 'WRAPPED', hint: 'Everything delivered.' },
]

/** The plan's state as a shoot card should say it: the state only, four
 *  words at most. The card body says the action. */
function briefChip(status: ItemStatus): string {
  if (status === 'draft_uploaded') return 'Plan being written'
  if (status === 'client_review' || status === 'client_changes_requested') return 'Plan with client'
  if (status === 'approved_for_scheduling') return 'Plan approved'
  if (status === 'scheduled' || status === 'published') return 'Shoot booked'
  return 'Plan in review'
}

const SCOPE_KEY = 'md-production-scope'
const VIEW_KEY = 'md-production-view'
const RANGE_KEY = 'md-production-cal-range'
const VIEWS = ['board', 'calendar'] as const
const RANGES = ['month', 'week'] as const

/** One dot per lane, in the order work moves — the Editor board's colours,
 *  because a lane called "Ready for review" should look the same everywhere
 *  it appears. Shared by the brief board and the task board. */
const LANE_TINT: Record<string, string> = {
  doing: 'bg-zinc-400',
  review: 'bg-blue-500',
  revising: 'bg-amber-500',
  client: 'bg-violet-500',
  approved: 'bg-emerald-500',
  done: 'bg-emerald-500',
}

/** What is NOT in a shoot-plan column, in the column's own words. */
const BRIEF_LANE_EMPTY: Record<string, string> = {
  doing: 'Nothing being written.',
  review: 'Nothing waiting on a manager.',
  revising: 'No plans in revision.',
  client: 'Nothing with a client.',
  approved: 'Nothing to book.',
}

/** What is NOT in a task column. */
const TASK_LANE_EMPTY: Record<string, string> = {
  doing: 'Nothing to do.',
  review: 'Nothing waiting on a manager.',
  revising: 'No changes in progress.',
  client: 'Nothing with a client.',
  done: 'Nothing finished recently.',
}

function whenShort(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
}

/**
 * Production: the shoots, the shoot plans that are still becoming shoots, and
 * the tasks that have nothing to post.
 *
 * A shoot is planned here BEFORE any item exists — the Editor board shows the
 * aftermath; this shows the plan. Tasks run as a board rather than a list for
 * the same reason the Editor page does: a row tells you a task exists, a
 * column tells you whose step it is waiting on.
 */
export default function ProductionPage() {
  const router = useRouter()
  const [shoots, setShoots] = useState<Shoot[] | null>(null)
  const [briefTasks, setBriefTasks] = useState<BriefTask[]>([])
  const [internalTasks, setInternalTasks] = useState<BriefTask[]>([])
  const [taskOpen, setTaskOpen] = useState(false)
  const [clients, setClients] = useState<ClientRow[]>([])
  const [clientFilter, setClientFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [needsSchema, setNeedsSchema] = useState(false)
  /** the Done column is a tail, not a queue — collapsed until asked for */
  const [doneOpen, setDoneOpen] = useState(false)

  const [newOpen, setNewOpen] = useState(false)
  const [newBusy, setNewBusy] = useState(false)
  const [draft, setDraft] = useState({ client_id: '', title: '' })
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
    shoots: Shoot[]; clients?: ClientRow[]; items?: BriefTask[]
  }>(
    async () => {
      const [bRes, cRes, iRes] = await Promise.all([
        fetch('/api/production/batches', { cache: 'no-store' }),
        // the clients this person actually works for — their team's, plus any
        // they hold a shoot or an item on. The server decides; a client-side
        // role guess is how the assignee got left out in the first place.
        fetch('/api/website/clients?scope=mine'),
        fetch('/api/production/items', { cache: 'no-store' }),
      ])
      return {
        shoots: bRes.ok ? (await bRes.json()) as Shoot[] : [],
        clients: cRes.ok ? ((await cRes.json()) as ClientRow[]).filter(Boolean) : undefined,
        // every brief, not just the live ones: the lanes want the active ones,
        // but a shoot card still has to say "Shoot booked"
        items: iRes.ok ? (await iRes.json()) as BriefTask[] : undefined,
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

  const create = async () => {
    if (!draft.client_id || !draft.title.trim()) { toast.error('Client and a working title are required'); return }
    setNewBusy(true)
    try {
      const res = await fetch('/api/production/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: draft.client_id, title: draft.title.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not create the shoot')
      router.push(`/dashboard/production/shoots/${json.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the shoot')
      setNewBusy(false)
    }
  }

  /** Hand a loose brief or task to somebody. Manager-only on the server too. */
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
   * last word either way. That is the sequence-stamped load from
   * lib/load-order.ts: whatever the server actually did is what stays on
   * screen, so a refusal puts the card back without any bookkeeping here.
   *
   * The server is the authority on WHO may do this; `canMove` only decides
   * whether to offer a drag handle. A refusal is shown in the server's own
   * words rather than a guess at what it objected to.
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
   * an empty page and a count of zero, and the only way out was to click a
   * filter nobody suspected. Creating is an explicit act — it earns a view.
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

  const visible = (shoots ?? []).filter(s => matches(s.client_id, s.title))

  // a brief and its shoot are one job: whoever owns the shoot owns the brief,
  // even when the task row itself was never assigned to anybody
  const batchOwnerById = Object.fromEntries((shoots ?? []).map(s => [s.id, s.owner_id ?? null]))
  const briefsInFilters = activeBriefTasks(briefTasks).filter(b => matches(b.client_id, b.title))
  const briefRows = viewer
    ? productionScope(briefsInFilters, viewer, scope, batchOwnerById)
    : []
  // built from every brief, so a booked one still labels its shoot card
  const briefByBatch = new Map(briefTasks.filter(b => b.batch_id).map(b => [b.batch_id as string, b]))
  // briefs that exist but sit outside the chosen scope — worth saying, and
  // worth saying in the ONE empty card rather than a second one beside it
  const briefsOutOfScope = briefsInFilters.length > 0 && briefRows.length === 0
  // research / strategy / copy — production work with nothing to post
  const tasksInFilters = activeInternalTasks(internalTasks).filter(t => matches(t.client_id, t.title))
  const doneInFilters = recentlyDoneTasks(internalTasks).filter(t => matches(t.client_id, t.title))
  const taskRows = viewer ? productionScope(tasksInFilters, viewer, scope, {}) : []
  const doneRows = viewer ? productionScope(doneInFilters, viewer, scope, {}) : []
  const anyTasks = tasksInFilters.length > 0 || doneInFilters.length > 0
  const nothingToShow = shoots !== null && visible.length === 0
    && briefRows.length === 0 && taskRows.length === 0 && doneRows.length === 0

  // the pool: briefs and tasks nobody has picked up yet
  const openPool = viewer
    ? unassignedCount([...briefsInFilters, ...tasksInFilters], viewer, editorAssignment)
    : 0

  /**
   * The calendar, drawn from exactly the rows the board is drawn from.
   *
   * The scope switch and the client filter have already had their say above,
   * so the two views cannot disagree about what is on this page — and shoots
   * follow the page's own rule, which the line under the header states: the
   * filter covers briefs and tasks, and shoots are always shown.
   */
  const calendar = eventsFor('production', {
    batches: visible,
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

  /** A shoot plan on the plan board — the task card's twin, in the plan's own
   *  words. A plan is never claimed (only an account manager picks one up),
   *  so it carries the Assign… menu where a task carries "Take this". */
  const briefCard = (b: BriefTask) => (
    <div key={b.id} className="relative">
      <Card className="py-0 transition-shadow hover:shadow-md">
        <CardContent className="flex flex-col gap-1.5 p-3">
          {/* the whole card opens the brief task, as a stretched link rather
              than a wrapper — the Assign… menu below is a button */}
          <Link href={`/dashboard/production/${b.id}`} aria-label={b.title}
            className="absolute inset-0 rounded-xl" />
          <span className="text-sm font-medium leading-snug">{b.title}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="font-normal text-zinc-600 dark:text-zinc-400">
              {b.clients?.name ?? '—'}
            </Badge>
            <Badge variant="outline" className="font-normal text-zinc-600 dark:text-zinc-400">
              {itemStatusLabel('shoot_brief', b.status, b.status)}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {viewer && (
              <TurnChip status={b.status} item={b} viewer={viewer} turns={BRIEF_STATUS_TURN} brief
                openTask={b.my_open_task}
                ownerName={b.owner_id ? nameById.get(b.owner_id) : undefined} />
            )}
            {b.due_date && (
              <span className="flex items-center gap-1 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                <CalendarDays className="h-3 w-3" />
                {whenShort(b.due_date)}
              </span>
            )}
          </div>
          {credits(b) && (
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{credits(b)}</p>
          )}
          {!b.owner_id && (
            // above the stretched link, so this is a click on a control
            <div className="relative z-10 flex flex-wrap items-center gap-1.5">
              {assignMenu(b.id)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )

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
              {/* "Not started" and "In progress" share the To-do lane — the
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
                  ownerName={t.owner_id ? nameById.get(t.owner_id) : undefined} />
              )}
              {t.due_date && (
                <span className="flex items-center gap-1 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                  <CalendarDays className="h-3 w-3" />
                  {whenShort(t.due_date)}
                </span>
              )}
            </div>
            {credits(t) && (
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{credits(t)}</p>
            )}
            {assignment === 'unassigned' && viewer && (
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

  return (
    <div className="flex flex-col gap-4">
      {viewer && shoots !== null && <GettingStarted role={role} page="production" />}

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Shoots <HelpHint term="shoot" />, shoot plans <HelpHint term="shoot_plan" /> and tasks
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
            unassignedHint="Briefs and tasks nobody has picked up yet." />
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
                {/* the one line that lets a new hire choose: the two words
                    this menu turns on, defined where the choice is made */}
                <p className="px-2 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  A shoot is the filming day. A shoot plan is what the client signs off before it.
                </p>
                {canPlan && (
                  <DropdownMenuItem className="min-h-11 items-start" onClick={() => setNewOpen(true)}>
                    <CalendarDays className="mt-0.5 h-4 w-4" />
                    <span className="flex flex-col">
                      Plan a shoot
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">a filming day — date, location, shot list</span>
                    </span>
                  </DropdownMenuItem>
                )}
                {isManager && (
                  <DropdownMenuItem className="min-h-11 items-start" onClick={() => setBriefOpen(true)}>
                    <FileText className="mt-0.5 h-4 w-4" />
                    <span className="flex flex-col">
                      Write a shoot plan
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">the concept the client signs off before we film</span>
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
              to another day to move it — a shoot whose date is locked moves from the shoot
              page, with a reason.
            </p>
          }
        />
      ) : (
        <>
      {/* the plans still being written, above the shoots they will become */}
      {briefsInFilters.length > 0 && (
        <div className="flex flex-col gap-2">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
              {SHOOT_PLAN_SECTION} <span className="tabular-nums">{briefRows.length}</span>
              {briefsInFilters.length > briefRows.length && (
                <span className="ml-2 normal-case tracking-normal text-zinc-400 dark:text-zinc-500">
                  ({briefsInFilters.length - briefRows.length} more outside this filter)
                </span>
              )}
            </p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              What the client signs off before we film. A booked one moves down to the shoots.
            </p>
          </div>
          {briefRows.length === 0 ? (
            /* when there is nothing at all on the page, the one empty card
               below carries this line — never two empty cards at once */
            nothingToShow ? null : (
              <Card className="border-dashed shadow-none">
                <CardContent className="flex flex-col items-center gap-2 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  Shoot plans are being written, but none of them are yours.
                  <Button variant="outline" size="sm" className="min-h-11" onClick={() => setScope(new Set<ScopeMode>(['all']))}>
                    Show everyone&rsquo;s
                  </Button>
                </CardContent>
              </Card>
            )
          ) : (
            <LaneBoard
              ariaLabel="Shoot plan columns"
              initialLane={BRIEF_LANES.find(l => briefRows.some(b => l.statuses.includes(b.status) && b.owner_id === viewer?.id))?.key}
              lanes={BRIEF_LANES.map((lane): Lane => {
                const colItems = briefRows.filter(b => lane.statuses.includes(b.status))
                return {
                  key: lane.key,
                  title: lane.title,
                  tint: LANE_TINT[lane.key] ?? 'bg-zinc-400',
                  count: colItems.length,
                  empty: BRIEF_LANE_EMPTY[lane.key] ?? 'Nothing here.',
                  cards: colItems.map(b => briefCard(b)),
                }
              })}
            />
          )}
        </div>
      )}

      {/* research, strategy, copy — production work with nothing to post.
          A board, not a list: the columns ARE the review steps. */}
      {anyTasks && (
        <div className="flex flex-col gap-2">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
              {/* the Done lane is one of the columns under this heading, so it
                  counts: "TASKS 0" beside a Done lane reading 1 is the block
                  contradicting itself */}
              {TASK_SECTION} <span className="tabular-nums">{taskRows.length + doneRows.length}</span>
              {tasksInFilters.length > taskRows.length && (
                <span className="ml-2 normal-case tracking-normal text-zinc-400 dark:text-zinc-500">
                  ({tasksInFilters.length - taskRows.length} more outside this filter)
                </span>
              )}
            </p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Research, strategy and copy — work with nothing to post. A task with nobody on it says &ldquo;Take this&rdquo;.
            </p>
          </div>
          {taskRows.length === 0 && doneRows.length === 0 ? (
            nothingToShow ? null : (
              <Card className="border-dashed shadow-none">
                <CardContent className="flex flex-col items-center gap-2 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  There are open tasks, but none of them are yours.
                  <Button variant="outline" size="sm" className="min-h-11" onClick={() => setScope(new Set<ScopeMode>(['all']))}>
                    Show everyone&rsquo;s
                  </Button>
                </CardContent>
              </Card>
            )
          ) : (
            <LaneBoard
              ariaLabel="Task columns"
              initialLane={TASK_LANES.find(l => taskRows.some(t => l.statuses.includes(t.status) && (t.owner_id === viewer?.id || t.my_open_task)))?.key}
              lanes={TASK_LANES.map((lane): Lane => {
                const isDone = lane.key === 'done'
                // the Done column is the last 14 days only — a tail, kept
                // visible so "Back" from a finished task lands somewhere real
                const colItems = (isDone ? doneRows : taskRows)
                  .filter(t => lane.statuses.includes(t.status))
                return {
                  key: lane.key,
                  title: lane.title,
                  tint: LANE_TINT[lane.key] ?? 'bg-zinc-400',
                  count: colItems.length,
                  empty: TASK_LANE_EMPTY[lane.key] ?? 'Nothing here.',
                  cards: colItems.map(t => taskCard(t, isDone)),
                  replace: isDone && colItems.length > 0
                    ? (!doneOpen
                      ? (
                        <button type="button" onClick={() => setDoneOpen(true)}
                          className="min-h-11 rounded-lg border border-dashed border-zinc-200 py-6 text-center text-xs text-zinc-500 hover:text-zinc-800 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
                          {colItems.length} finished in the last 14 days — show
                        </button>
                      ) : (
                        <>
                          {colItems.map(t => taskCard(t, true))}
                          <button type="button" onClick={() => setDoneOpen(false)}
                            className="min-h-11 self-start px-1 text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
                            Hide
                          </button>
                        </>
                      ))
                    : undefined,
                }
              })}
            />
          )}
        </div>
      )}

      {shoots === null ? (
        <div className="grid gap-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-24" />)}</div>
      ) : nothingToShow ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <Camera className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
            </div>
            <p className="text-sm font-medium">No shoots planned yet</p>
            <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              {briefsOutOfScope
                ? 'Shoot plans are being written, but none of them are yours.'
                : 'A shoot is one filming day. Plan the first one — pick the client and give it a working title — and the shoot page opens.'}
            </p>
            {/* planning is always a valid next move for whoever can plan —
                whatever the reason the page is empty */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {briefsOutOfScope && (
                <Button variant="outline" size="sm" className="min-h-11" onClick={() => setScope(new Set<ScopeMode>(['all']))}>
                  Show everyone&rsquo;s
                </Button>
              )}
              {canPlan && <Button size="sm" className="min-h-11" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> Plan a shoot</Button>}
            </div>
          </CardContent>
        </Card>
      ) : (
        SECTIONS.map(section => {
          const rows = visible.filter(s => (s.status ?? 'shot') === section.status)
          if (rows.length === 0) return null
          return (
            <div key={section.status} className="flex flex-col gap-2">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                  {SHOOTS_SECTION} · {section.title} <span className="tabular-nums">{rows.length}</span>
                  {section.status === 'wrapped' && <HelpHint term="wrapped" />}
                </p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">{section.hint}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {rows.map(s => {
                  const shots = s.shot_list?.length ?? 0
                  const deliverables = (s.planned_deliverables ?? []).reduce((n, d) => n + (d.qty || 0), 0)
                  const itemCount = s.content_items?.[0]?.count ?? 0
                  const brief = briefByBatch.get(s.id)
                  // the shoot's own brief task rides this count — it is
                  // paperwork, not something the shoot produced
                  const madeCount = Math.max(0, itemCount - (brief ? 1 : 0))
                  const meta = [
                    shots > 0 && `${shots} shot${shots === 1 ? '' : 's'} planned`,
                    deliverables > 0 && `${deliverables} promised`,
                    madeCount > 0 && `${madeCount} item${madeCount === 1 ? '' : 's'} being edited`,
                  ].filter(Boolean).join(' · ')
                  const canDelete = isManager && itemCount === 0
                  // the card is already inside its named section, so the state
                  // badge would only repeat the heading — say the next move
                  const nextMove = !brief && s.status !== 'wrapped'
                    ? 'Write the shoot plan →'
                    : brief?.status === 'approved_for_scheduling' && s.status === 'brief'
                      ? 'Lock the date →'
                      : s.status === 'locked'
                        ? 'After the shoot: mark it shot, then create the items →'
                        : s.status === 'shot' && madeCount === 0
                          ? 'Create the items →'
                          : null
                  return (
                    <div key={s.id} className="relative">
                      <Card className="py-0 transition-shadow hover:shadow-md">
                        <CardContent className="flex flex-col gap-1.5 p-3">
                          {/* stretched link, so the menu below is a button
                              beside an anchor and not inside one */}
                          <Link href={`/dashboard/production/shoots/${s.id}`} aria-label={s.title}
                            className="absolute inset-0 rounded-xl" />
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                              Shoot
                            </span>
                            <span className="truncate text-sm font-semibold">{s.title}</span>
                            {brief && (
                              <span className={`ml-auto shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${BATCH_STATUS_STYLE[s.status ?? 'shot']}`}>
                                {briefChip(brief.status)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {s.clients?.name ?? 'No client'} ·{' '}
                            {whenShort(s.shoot_date) ?? <span className="italic text-zinc-400">No date yet</span>}
                          </p>
                          {nextMove && (
                            <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{nextMove}</p>
                          )}
                          {meta && (
                            <p className="font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{meta}</p>
                          )}
                        </CardContent>
                      </Card>
                      {canDelete && (
                        // an overflow menu, not a hover-only icon: on a tablet
                        // a control that only appears on hover does not exist
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
                })}
              </div>
            </div>
          )
        })
      )}
        </>
      )}

      <Dialog open={newOpen} onOpenChange={o => !newBusy && setNewOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Plan a shoot</DialogTitle>
            <DialogDescription>
              A shoot is one day of filming. Next you write its shoot plan on the shoot
              page and send that to the client to sign off.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Client</label>
              <Select value={draft.client_id} onValueChange={v => v && setDraft(d => ({ ...d, client_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Pick a client" /></SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Working title</label>
              <Input value={draft.title} placeholder="e.g. September studio day"
                onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && create()} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setNewOpen(false)} disabled={newBusy}>Cancel</Button>
            <Button className="min-h-11" onClick={create} disabled={newBusy || !draft.client_id || !draft.title.trim()}>
              {newBusy ? 'Creating…' : 'Create the shoot'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
