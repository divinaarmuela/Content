'use client'

import { useCallback, useEffect, useState } from 'react'
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
  TASK_LANES, activeBriefTasks, activeInternalTasks, canClaimEditor, editorAssignment,
  isBriefTask, isInternalTask, productionScope, recentlyDoneTasks, unassignedCount,
  type Viewer,
} from '../../lib/work-pages-core'
import { useProductionLive } from './useProductionLive'
import { AccountUnavailable, BATCH_STATUS_STYLE, KIND_CHIP } from './shoot-ui'
import { usePersistedScope, useTeamNames } from './workHooks'
import { useRole } from '../useRole'
import NewItemDialog, { type ClientRow } from './NewItemDialog'
import { ClaimButton } from './ClaimButton'
import { ScopeSwitch } from './ScopeSwitch'
import { TurnChip } from './TurnChip'

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
}

/** The four stages a shoot goes through — and what each one actually means,
 *  said once on the page instead of nowhere. */
const SECTIONS: { status: BatchStatus; title: string; hint: string }[] = [
  { status: 'brief', title: 'IN PLANNING', hint: 'No date yet.' },
  { status: 'locked', title: 'DATE LOCKED', hint: 'Booked. The team is prepping.' },
  { status: 'shot', title: 'SHOT', hint: 'Footage is in; the edit is running.' },
  { status: 'wrapped', title: 'WRAPPED', hint: 'Everything delivered.' },
]

/** The brief's state as a shoot card should say it: the state only, four
 *  words at most. The card body says the action. */
function briefChip(status: ItemStatus): string {
  if (status === 'draft_uploaded') return 'Brief being written'
  if (status === 'client_review' || status === 'client_changes_requested') return 'Brief with client'
  if (status === 'approved_for_scheduling') return 'Brief approved'
  if (status === 'scheduled' || status === 'published') return 'Shoot booked'
  return 'Brief in review'
}

const SCOPE_KEY = 'md-production-scope'

/** One dot per task lane, in the order work moves. */
const LANE_TINT: Record<string, string> = {
  doing: 'bg-zinc-400',
  review: 'bg-blue-500',
  revising: 'bg-amber-500',
  client: 'bg-violet-500',
  done: 'bg-emerald-500',
}

function whenShort(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
}

/**
 * Production: the shoots, the briefs that are still becoming shoots, and the
 * tasks that have nothing to post.
 *
 * A shoot is planned here BEFORE any content item exists — the Editor board
 * shows the aftermath; this shows the plan. Tasks run as a board rather than a
 * list for the same reason the Editor page does: a row tells you a task exists,
 * a column tells you whose step it is waiting on.
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

  // names for "waiting on …" and the Assign… menu — managers only
  const nameById = useTeamNames(isManager)
  const [scope, setScope] = usePersistedScope(SCOPE_KEY, role)

  const load = useCallback(async () => {
    try {
      const [bRes, cRes, iRes] = await Promise.all([
        fetch('/api/production/batches'),
        fetch('/api/website/clients'),
        fetch('/api/production/items'),
      ])
      if (bRes.ok) {
        const rows: Shoot[] = await bRes.json()
        // schema not migrated yet → rows have no status; show the setup card
        setNeedsSchema(rows.length > 0 && rows.every(r => !r.status))
        setShoots(rows)
      } else setShoots([])
      if (cRes.ok) setClients(((await cRes.json()) as ClientRow[]).filter(Boolean))
      // every brief, not just the live ones: the flight list wants the active
      // ones, but a shoot card still has to say "Shoot booked"
      if (iRes.ok) {
        const all = (await iRes.json()) as BriefTask[]
        setBriefTasks(all.filter(isBriefTask))
        setInternalTasks(all.filter(isInternalTask))
      }
    } catch {
      toast.error('Could not load shoots')
      setShoots([])
    }
  }, [])
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
      toast.success(`Assigned to ${nameById.get(ownerId) ?? 'them'}`)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not assign it')
    }
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

  // the whole page hangs off the viewer, so a missing account is not a slower
  // load — it is a different screen, and saying so beats a skeleton forever
  if (!loading && !viewer) return <AccountUnavailable />

  /** The Assign… menu — the affordance the chip promised and the page lacked. */
  const assignMenu = (itemId: string) => (
    isManager && nameById.size > 0 ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">Assign…</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
          {[...nameById].map(([uid, name]) => (
            <DropdownMenuItem key={uid} onClick={() => void assignTo(itemId, uid)}>{name}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null
  )

  /** One task card — the Editor board's card, in the task vocabulary. */
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
              {t.work_kinds?.name && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${KIND_CHIP[t.work_kinds.color] ?? KIND_CHIP.zinc}`}>
                  {t.work_kinds.name}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {viewer && (
                <TurnChip status={t.status} item={t} viewer={viewer} turns={TASK_STATUS_TURN}
                  ownerName={t.owner_id ? nameById.get(t.owner_id) : undefined} />
              )}
              {t.due_date && (
                <span className="flex items-center gap-1 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                  <CalendarDays className="h-3 w-3" />
                  {whenShort(t.due_date)}
                </span>
              )}
            </div>
            {assignment === 'unassigned' && viewer && (
              // above the stretched link, so these are clicks on a control
              <div className="relative z-10 flex flex-wrap items-center gap-1.5">
                {canClaimEditor(t, viewer) && (
                  <ClaimButton itemId={t.id} hat="editor" label="Take this task" onDone={load} />
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
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Shoots, briefs and tasks</p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
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
              placeholder="Search shoots, briefs and tasks…" className="w-56 bg-white pl-8 dark:bg-zinc-900" />
          </div>
          {(canPlan || isManager) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4" /> New <ChevronDown className="h-3.5 w-3.5 opacity-70" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                {canPlan && (
                  <DropdownMenuItem className="items-start" onClick={() => setNewOpen(true)}>
                    <CalendarDays className="mt-0.5 h-4 w-4" />
                    <span className="flex flex-col">
                      Shoot
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">plan a shoot and its brief page</span>
                    </span>
                  </DropdownMenuItem>
                )}
                {isManager && (
                  <DropdownMenuItem className="items-start" onClick={() => setBriefOpen(true)}>
                    <FileText className="mt-0.5 h-4 w-4" />
                    <span className="flex flex-col">
                      Brief task
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">a shoot plan that gets signed off</span>
                    </span>
                  </DropdownMenuItem>
                )}
                {canPlan && (
                  <DropdownMenuItem className="items-start" onClick={() => setTaskOpen(true)}>
                    <ListChecks className="mt-0.5 h-4 w-4" />
                    <span className="flex flex-col">
                      Task
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">research, strategy or copy</span>
                    </span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <p className="-mt-2 text-xs text-zinc-400 dark:text-zinc-500">
        The filter above covers briefs and tasks. Shoots are always shown.
      </p>

      {needsSchema && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardContent className="p-4 text-sm text-amber-800 dark:text-amber-300">
            This part of the app isn&rsquo;t switched on yet. Send this to your developer:
            run <span className="font-mono">supabase/agreements_and_briefs.sql</span>.
          </CardContent>
        </Card>
      )}

      {/* the plans still being written, above the shoots they will become */}
      {briefsInFilters.length > 0 && (
        <div className="flex flex-col gap-2">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
              BRIEFS BEING PLANNED <span className="tabular-nums">{briefRows.length}</span>
            </p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">Shoot plans still going through review.</p>
          </div>
          {briefRows.length === 0 ? (
            /* when there is nothing at all on the page, the one empty card
               below carries this line — never two empty cards at once */
            nothingToShow ? null : (
              <Card className="border-dashed shadow-none">
                <CardContent className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  Briefs are being planned, but none of them are yours — switch to Everyone to see them.
                </CardContent>
              </Card>
            )
          ) : (
            <div className="grid gap-2">
              {briefRows.map(b => (
                <div key={b.id} className="relative">
                  <Card className="py-0 transition-shadow hover:shadow-md">
                    <CardContent className="flex flex-wrap items-center gap-2 p-3">
                      {/* the whole row opens the brief task, as a stretched link
                          rather than a wrapper — controls may live inside it */}
                      <Link href={`/dashboard/production/${b.id}`} aria-label={b.title}
                        className="absolute inset-0 rounded-xl" />
                      <span className="text-sm font-medium">{b.title}</span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {b.clients?.name ?? 'Unassigned'}
                      </span>
                      <Badge variant="outline" className="font-normal text-zinc-600 dark:text-zinc-400">
                        {itemStatusLabel('shoot_brief', b.status, b.status)}
                      </Badge>
                      {viewer && (
                        <TurnChip status={b.status} item={b} viewer={viewer} turns={BRIEF_STATUS_TURN} brief
                          ownerName={b.owner_id ? nameById.get(b.owner_id) : undefined} />
                      )}
                      {!b.owner_id && (
                        <span className="relative z-10">{assignMenu(b.id)}</span>
                      )}
                      {b.due_date && (
                        <span className="ml-auto flex items-center gap-1 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                          <CalendarDays className="h-3 w-3" />
                          {whenShort(b.due_date)}
                        </span>
                      )}
                    </CardContent>
                  </Card>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* research, strategy, copy — production work with nothing to post.
          A board, not a list: the columns ARE the review steps. */}
      {anyTasks && (
        <div className="flex flex-col gap-2">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
              TASKS <span className="tabular-nums">{taskRows.length}</span>
            </p>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Research, strategy and copy — work with nothing to post.
            </p>
          </div>
          {taskRows.length === 0 && doneRows.length === 0 ? (
            nothingToShow ? null : (
              <Card className="border-dashed shadow-none">
                <CardContent className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  There are open tasks, but none of them are yours — switch to Everyone to see them.
                </CardContent>
              </Card>
            )
          ) : (
            <div className="w-full overflow-x-auto">
              <div className="flex gap-3 pb-3">
                {TASK_LANES.map(lane => {
                  const isDone = lane.key === 'done'
                  // the Done column is the last 14 days only — a tail, kept
                  // visible so "Back" from a finished task lands somewhere real
                  const colItems = (isDone ? doneRows : taskRows)
                    .filter(t => lane.statuses.includes(t.status))
                  return (
                    <div key={lane.key} className="min-w-44 flex-1">
                      <div className="mb-2 flex items-center gap-2 px-1">
                        <span className={`h-2 w-2 rounded-full ${LANE_TINT[lane.key] ?? 'bg-zinc-400'}`} />
                        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{lane.title}</span>
                        <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
                          {colItems.length}
                        </span>
                      </div>
                      <div className="flex min-h-24 flex-col gap-2">
                        {isDone && colItems.length > 0 && !doneOpen ? (
                          <button type="button" onClick={() => setDoneOpen(true)}
                            className="rounded-lg border border-dashed border-zinc-200 py-6 text-center text-xs text-zinc-500 hover:text-zinc-800 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
                            {colItems.length} finished in the last 14 days — show
                          </button>
                        ) : (
                          colItems.map(t => taskCard(t, isDone))
                        )}
                        {isDone && colItems.length > 0 && doneOpen && (
                          <button type="button" onClick={() => setDoneOpen(false)}
                            className="self-start px-1 text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
                            Hide
                          </button>
                        )}
                        {colItems.length === 0 && (
                          <div className="rounded-lg border border-dashed border-zinc-200 py-6 text-center text-xs text-zinc-300 dark:border-zinc-800 dark:text-zinc-600">
                            {isDone ? 'Nothing finished recently.' : 'Nothing here.'}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
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
            <p className="text-sm font-medium">No shoots planned</p>
            <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              {briefsOutOfScope
                ? 'Briefs are being planned, but none of them are yours — switch to Everyone above to see them.'
                : 'Plan a shoot to brief the team before production starts.'}
            </p>
            {/* planning is always a valid next move for whoever can plan —
                whatever the reason the page is empty */}
            {canPlan && <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> Plan a shoot</Button>}
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
                  {section.title} <span className="tabular-nums">{rows.length}</span>
                </p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500">{section.hint}</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {rows.map(s => {
                  const shots = s.shot_list?.length ?? 0
                  const deliverables = (s.planned_deliverables ?? []).reduce((n, d) => n + (d.qty || 0), 0)
                  const itemCount = s.content_items?.[0]?.count ?? 0
                  const meta = [
                    shots > 0 && `${shots} shot${shots === 1 ? '' : 's'} planned`,
                    deliverables > 0 && `${deliverables} deliverables`,
                    itemCount > 0 && `${itemCount} item${itemCount === 1 ? '' : 's'} in production`,
                  ].filter(Boolean).join(' · ')
                  const canDelete = isManager && itemCount === 0
                  const brief = briefByBatch.get(s.id)
                  // the card is already inside its named section, so the state
                  // badge would only repeat the heading — say the next move
                  const nextMove = brief?.status === 'approved_for_scheduling' && s.status === 'brief'
                    ? 'Lock the date →'
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
                            <span className="truncate text-sm font-semibold">{s.title}</span>
                            {brief && (
                              <span className={`ml-auto shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${BATCH_STATUS_STYLE[s.status ?? 'shot']}`}>
                                {briefChip(brief.status)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {s.clients?.name ?? 'Unassigned'} ·{' '}
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
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-zinc-400"
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

      <Dialog open={newOpen} onOpenChange={o => !newBusy && setNewOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Plan a shoot</DialogTitle>
            <DialogDescription>
              A shoot is a day of filming. Its brief is written on the shoot page, then
              sent for review as a brief task.
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
            <Button variant="outline" onClick={() => setNewOpen(false)} disabled={newBusy}>Cancel</Button>
            <Button onClick={create} disabled={newBusy}>{newBusy ? 'Creating…' : 'Create shoot'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* the brief TASK — the reviewable plan that rides the item pipeline.
          presetKind locks the kind: without it the dialog filters it out. */}
      <NewItemDialog
        open={briefOpen}
        onOpenChange={setBriefOpen}
        onCreated={load}
        presetKind="shoot_brief"
        clients={clients}
        batches={shoots ?? []}
      />

      {/* a TASK: research, strategy, copy — no shoot, no post, ends at Done */}
      <NewItemDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        onCreated={load}
        presetKind="task"
        clients={clients}
        batches={shoots ?? []}
      />

      <AlertDialog open={!!toDelete} onOpenChange={o => !delBusy && !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the shoot plan and its board. A shoot that produced no
              content items can be deleted at any stage; one with items is wrapped instead.
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
