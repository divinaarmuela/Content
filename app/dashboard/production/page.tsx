'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
  Camera, CalendarDays, ChevronDown, FileText, Kanban, Link2, ListChecks, MoreHorizontal, Plus, Search, Trash2,
} from 'lucide-react'
import { BOARD_COLUMNS, columnOf, type BoardColumnKey } from '../../lib/board-core'
import { pageColumns } from '../../lib/board-view-core'
import { Board, COLUMN_EMPTY, useBoardParams, type BoardCardRow } from '../board/Board'
import { NewCardDialog } from '../board/BoardDialogs'
import type { BatchStatus } from '../../lib/batch-brief-core'
import { type ItemStatus } from '../../lib/workflow-core'
import { BRIEF_STATUS_TURN, itemStatusLabel } from '../../lib/brief-task-core'
import { TASK_STATUS_TURN, taskStatusLabel } from '../../lib/task-kind-core'
import {
  activeBriefTasks, activeInternalTasks, canClaimEditor, editorAssignment,
  isBriefTask, isInternalTask, productionScope, recentlyDoneTasks, unassignedCount,
  type ScopeMode, type Viewer,
} from '../../lib/work-pages-core'
import { SHOWN_SHOOT_LABEL, shownShootState } from '../../lib/shoot-lifecycle-core'
import {
  dayLabel, eventsFor, movePatch, moveUrl, type CalEvent,
} from '../../lib/work-calendar-core'
import WorkCalendar, { ViewSwitch, type CalendarView } from '../../components/calendar/WorkCalendar'
import { useWorkRows } from '../useLiveWork'
import { AccountUnavailable } from './shoot-ui'
import { teamNameMap, usePersistedChoice, usePersistedScope, useTeamMembers } from './workHooks'
import { useRole } from '../useRole'
import NewShootPlanDialog, { type ClientRow } from './NewItemDialog'
import { ClaimButton } from './ClaimButton'
import { ScopeSwitch } from './ScopeSwitch'
import { TurnChip } from './TurnChip'
import { LaneBoard, type Lane } from './LaneBoard'
import CommentsDrawer, { CommentsButton, useCommentsDrawer } from '../../components/comments/CommentsDrawer'
import PageTitle from '../ui/PageTitle'
import Chip, { type ChipTone } from '../ui/Chip'
import WorkCard, { type Person, type WorkTone } from '../ui/WorkCard'
import { cardTone, kindTone, todayKey } from '../ui/tone'
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
  planned_deliverables?: unknown[] | null
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

const SCOPE_KEY = 'md-production-scope'
const VIEW_KEY = 'md-production-view'
const RANGE_KEY = 'md-production-cal-range'
/** List is the shoots, plans and tasks in their own columns; Board is the
 *  five-column work board every page shares; Calendar is the same rows by
 *  date. A remembered "board" from before this change opens the work board,
 *  which is the view the owner asked for. */
const VIEWS = ['list', 'board', 'calendar'] as const
const RANGES = ['month', 'week'] as const

function whenShort(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
}


/**
 * A shoot with no plan yet has no item status of its own — the only thing that
 * can colour it is its date. Said in its own words rather than by borrowing a
 * status the row does not have.
 */
function shootTone(s: { shoot_date: string | null }): WorkTone | undefined {
  return s.shoot_date && s.shoot_date.slice(0, 10) <= todayKey() ? 'amber' : undefined
}

/** "Jess Mackay" → "JM", for a 26px avatar. */
function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/)
  const two = (parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')
  return (two || name.slice(0, 2)).toUpperCase()
}

/** A shoot's stage, as a chip tone. */
const SHOOT_CHIP: Record<BatchStatus, ChipTone> = {
  brief: 'amber', locked: 'blue', shot: 'green', wrapped: 'muted',
}


/**
 * Production: ONE board, and the List is the same five columns.
 *
 * It used to be three boards stacked — a Shoots section, a "Shoot plans" lane
 * board and a "Tasks" lane board — and then a List with its own five stage
 * names beside the Board's five. Now the List's columns ARE the board's
 * (`BOARD_COLUMNS`, `columnOf`): Draft · Internal check · With client · Ready
 * to post · Posted. A shoot-plan card carries its shoot date and a status
 * chip; a booked shoot leaves the columns (its chip lives in the strip
 * below); a task rides the same columns. A card is one thing — every piece
 * is its own card, whatever group it was once made in.
 */
export default function ProductionPage() {
  const router = useRouter()
  const [clientFilter, setClientFilter] = useState('all')
  const [search, setSearch] = useState('')
  /** finished tasks are a tail, not a queue — collapsed until asked for */
  const [doneOpen, setDoneOpen] = useState(false)
  /** closed shoots in the strip — hidden until asked for */
  const [closedOpen, setClosedOpen] = useState(false)

  // the comments drawer: read and answer an item's comments without leaving
  // the board. `?comments=<itemId>` opens it on load (notification links).
  const commentsDrawer = useCommentsDrawer()

  const [briefOpen, setBriefOpen] = useState(false)

  const { me, role, loading, can } = useRole()
  // anyone on the team plans a shoot — the boards decide whose work it then
  // is, which is a different question from who may write it down
  const canPlan = can('scheduler')
  const isManager = can('account_manager')
  // memoised: this is the memo key `useWorkRows` scopes the whole table by,
  // and a fresh object per render re-ran that on every keystroke in the
  // search box
  const viewer: Viewer | null = useMemo(
    () => (me ? { id: me.id, role: me.role } : null), [me])

  // names for "waiting on …" and the Assign… menu — managers only. One
  // `/api/team` fetch, shared with the two New-work dialogs below.
  const team = useTeamMembers(isManager)
  const nameById = useMemo(() => teamNameMap(team), [team])
  const [scope, setScope] = usePersistedScope(SCOPE_KEY, role)
  // the board and the calendar are two readings of the same page, and which
  // one you were on is worth remembering between visits
  const [view, setView] = usePersistedChoice(VIEW_KEY, VIEWS, 'list', 'view')
  const [range, setRange] = usePersistedChoice(RANGE_KEY, RANGES, 'month')
  // the work board: the column and the lens named in the address, today's
  // date (read after mount — the page prerenders), and the new-card dialog
  const boardParams = useBoardParams()
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => { setToday(todayKey()) }, [])
  const [newCardOpen, setNewCardOpen] = useState(false)

  /**
   * THE PAGE, LIVE.
   *
   * Four API calls and a refetch-everything-on-every-change hint used to sit
   * here. The board now renders from database listeners: the first snapshot
   * paints it and every later change repaints it, so nothing on this page
   * reloads and nothing waits for a round trip to show what somebody just
   * did. The rows are scoped and joined exactly as `/api/production/items`
   * and `/api/production/batches` scoped and joined them (see
   * `app/lib/scope-client.ts` — one set of rules, unit-tested against the
   * server's).
   *
   * WRITES ARE UNCHANGED. Every mutation below is still its `fetch('/api/...')`
   * call, because the routes own the emails, the activity log and the Drive
   * work. There is just no `load()` afterwards any more — the listener has
   * already repainted by the time the toast appears.
   */
  const live = useWorkRows(viewer)
  const shoots: Shoot[] | null = live.loading ? null : (live.batches as unknown as Shoot[])
  const clients = live.clients as unknown as ClientRow[]
  const briefTasks = useMemo(
    () => (live.items as unknown as BriefTask[]).filter(isBriefTask), [live.items])
  const internalTasks = useMemo(
    () => (live.items as unknown as BriefTask[]).filter(isInternalTask), [live.items])
  // schema not migrated yet: rows come back with no status — show the setup card
  const needsSchema = shoots !== null && shoots.length > 0 && shoots.every(r => !r.status)

  /**
   * A LISTENER THAT COULD NOT READ IS NOT AN EMPTY BOARD.
   *
   * The old page toasted 'Could not load shoots' when its fetch threw. Drawing
   * nothing and saying nothing is worse than that was — an empty board looks
   * like an answer. Toasted once per failure, not once per render.
   */
  const liveError = live.error
  useEffect(() => {
    if (liveError) toast.error('Could not load shoots')
  }, [liveError])

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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not assign it')
    }
  }

  /**
   * Drag a card onto another day.
   *
   * No optimistic copy any more: the row lands on the new day the instant the
   * write commits, because the listener is what draws it. A refusal therefore
   * leaves the card exactly where it was, with the server's own words in a
   * toast — the server is the authority on WHO may do this.
   */
  const moveEvent = async (e: CalEvent, day: string) => {
    const patch = movePatch(e, day)
    if (!patch) return
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

  /** the work board's cards: every card this person may see, bar the shoot
   *  plans (those are shoots, and live on the list), through the same client
   *  and search filters as the list */
  const boardCards = useMemo(() => {
    const rows = (live.items as unknown as BoardCardRow[]).filter(c => (c.work_kinds?.slug ?? '') !== 'shoot_brief')
    return rows.filter(c => (clientFilter === 'all' || c.client_id === clientFilter)
      && (!search || c.title.toLowerCase().includes(search.toLowerCase())))
  }, [live.items, clientFilter, search])
  const boardColumns = useMemo(() => (viewer ? pageColumns('production', viewer) : []), [viewer])
  /** id → name for everyone on the team, from the rows already on the wire */
  const teamNames = useMemo(
    () => new Map(live.tables.team.rows.map(u => [u.id, u.name || u.email])),
    [live.tables.team.rows])

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
  // every task is its own card — the group it was made in is not drawn
  const taskRows = viewer ? productionScope(tasksInFilters, viewer, scope, {}) : []
  const doneRows = viewer ? productionScope(doneInFilters, viewer, scope, {}) : []

  // shoots with NO plan yet, still in planning: they get their own card in
  // Draft — the plan they are waiting for is written there. Booked and shot
  // shoots have left the board; they live in the strip below the columns.
  const planlessShoots = visibleShoots.filter(s =>
    !briefByBatch.has(s.id) && (s.status ?? 'brief') === 'brief')
  const bookedShoots = visibleShoots.filter(s => ['locked', 'shot'].includes(s.status ?? ''))
  const closedShoots = visibleShoots.filter(s => (s.status ?? '') === 'wrapped')

  const boardCount = briefRows.length + taskRows.length + planlessShoots.length
  // "18 items across 6 clients" — counted from the cards actually on screen,
  // so the sentence and the board can never disagree
  const boardClients = new Set<string>([
    ...briefRows.map(b => b.client_id),
    ...taskRows.map(t => t.client_id),
    ...planlessShoots.map(s => s.client_id),
  ].filter(Boolean))
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const boardSummary = shoots === null
    ? 'Everything being planned, shot and written — it updates the moment anyone moves something.'
    : `${plural(boardCount, 'item')} across ${plural(boardClients.size, 'client')} · updates the moment anyone moves something`
  const outOfScope = (briefsInFilters.length - briefRows.length) + (tasksInFilters.length - taskRows.length)
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

  /** Whoever is holding this, as the one avatar the card has room for. Only a
   *  manager is given the team's names, so for everyone else a card shows the
   *  turn chip and no face — the same as it did before the restyle. */
  const holder = (ownerId: string | null | undefined): Person[] => {
    const name = ownerId ? nameById.get(ownerId) : undefined
    return ownerId && name ? [{ id: ownerId, name, initials: initialsOf(name) }] : []
  }

  /** The Assign… menu — the affordance the chip promised and the page lacked. */
  const assignMenu = (itemId: string) => (
    isManager && nameById.size > 0 ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-11 rounded-full border-border bg-surface px-4 text-[14px] font-semibold">Assign…</Button>
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
  const briefCard = (b: BriefTask, column: BoardColumnKey) => {
    const shoot = b.batch_id ? batchById.get(b.batch_id) : undefined
    const state = shoot ? shownShootState(shoot) : null
    const when = shoot?.shoot_date ?? b.due_date
    return (
      /* the whole card opens the plan on its SHOOT page — plan and shoot are
         one page now. Falls back to the item page for the rare brief with no
         shoot behind it (never a dead link). */
      <WorkCard
        key={b.id}
        href={b.batch_id ? `/dashboard/production/shoots/${b.batch_id}` : `/dashboard/production/${b.id}`}
        client={b.clients?.name ?? '—'}
        title={b.title}
        tone={cardTone({ status: b.status, due: when })}
        people={holder(b.owner_id)}
        chips={<>
          <Chip tone="surface">Shoot plan</Chip>
          <Chip>{itemStatusLabel('shoot_brief', b.status, b.status)}</Chip>
          {shoot && state && (
            <Chip tone={SHOOT_CHIP[shoot.status ?? 'brief']}>{SHOWN_SHOOT_LABEL[state]}</Chip>
          )}
          {viewer && (
            <TurnChip status={b.status} item={b} viewer={viewer} turns={BRIEF_STATUS_TURN} brief
              openTask={b.my_open_task}
              onOpenComments={() => commentsDrawer.open(b.id, b.title)}
              ownerName={b.owner_id ? nameById.get(b.owner_id) : undefined} />
          )}
          {when && (
            <Chip><CalendarDays className="h-3.5 w-3.5" />{whenShort(when)}</Chip>
          )}
          {/* the conversation, right here — the drawer, not a page trip */}
          <CommentsButton className="ml-auto" tagged={b.my_open_task} title={b.title}
            onOpen={() => commentsDrawer.open(b.id, b.title)} />
        </>}
        note={credits(b)}
        actions={<>
          {column === 'ready_to_post' && shoot && (
            // the ONE action an approved plan wants: the date is picked and
            // committed on the shoot page
            <Button className="h-11 rounded-full bg-foreground px-4 text-[14px] font-semibold text-background hover:bg-foreground/90 [[data-tone=ink]_&]:bg-cream [[data-tone=ink]_&]:text-ink" asChild>
              <Link href={`/dashboard/production/shoots/${shoot.id}`}>Book the shoot</Link>
            </Button>
          )}
          {!b.owner_id && assignMenu(b.id)}
        </>}
      />
    )
  }

  const taskCard = (t: BriefTask, muted = false) => {
    const assignment = viewer ? editorAssignment(t, viewer) : 'other'
    return (
      <WorkCard
        key={t.id}
        href={`/dashboard/production/${t.id}`}
        client={t.clients?.name ?? '—'}
        title={t.title}
        tone={muted ? undefined : cardTone({ status: t.status, due: t.due_date })}
        people={holder(t.owner_id)}
        className={muted ? 'opacity-60' : ''}
        chips={<>
          {/* "Not started" and "In progress" share the Draft column — the
              card is the only place that can tell them apart */}
          <Chip>{taskStatusLabel(t.work_kinds, t.status, t.status, { hasWork: (t.current_version_number ?? 0) > 0 })}</Chip>
          {t.work_kinds?.name && (
            <Chip tone={kindTone(t.work_kinds.color)}>{t.work_kinds.name}</Chip>
          )}
          {viewer && (
            <TurnChip status={t.status} item={t} viewer={viewer} turns={TASK_STATUS_TURN}
              openTask={t.my_open_task}
              onOpenComments={() => commentsDrawer.open(t.id, t.title)}
              ownerName={t.owner_id ? nameById.get(t.owner_id) : undefined} />
          )}
          {t.due_date && (
            <Chip><CalendarDays className="h-3.5 w-3.5" />{whenShort(t.due_date)}</Chip>
          )}
          {/* the conversation, right here — the drawer, not a page trip */}
          <CommentsButton className="ml-auto" tagged={t.my_open_task} title={t.title}
            onOpen={() => commentsDrawer.open(t.id, t.title)} />
        </>}
        note={credits(t)}
        actions={<>
          {assignment === 'unassigned' && viewer && !muted && (
            <>
              {canClaimEditor(t, viewer) && (
                <ClaimButton itemId={t.id} hat="editor" onDone={() => {}} />
              )}
              {assignMenu(t.id)}
            </>
          )}
        </>}
      />
    )
  }

  /** A shoot with no plan yet — its card IS the reminder to write one. */
  const shootCard = (s: Shoot) => {
    // no longer "only while it is empty": a shoot plan is itself an item, so
    // the option vanished the moment anyone described the shoot. Its cards
    // are kept and detached server-side; the dialog says so before you commit.
    const canDelete = isManager
    return (
      <div key={s.id} className="relative">
        <WorkCard
          href={`/dashboard/production/shoots/${s.id}`}
          client={s.clients?.name ?? '—'}
          title={s.title}
          tone={shootTone(s)}
          chips={<>
            <Chip tone="surface">Shoot</Chip>
            <Chip tone={SHOOT_CHIP[s.status ?? 'brief']}>{SHOWN_SHOOT_LABEL[shownShootState(s)]}</Chip>
            {s.shoot_date && (
              <Chip><CalendarDays className="h-3.5 w-3.5" />{whenShort(s.shoot_date)}</Chip>
            )}
          </>}
          note={<span className="font-semibold text-foreground">Write the shoot plan →</span>}
        />
        {canDelete && (
          // an overflow menu, not a hover-only icon: on a tablet a control
          // that only appears on hover does not exist
          <div className="absolute right-2 top-2 z-10">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full text-muted-foreground"
                  aria-label={`More for ${s.title}`}
                  onClick={e => { e.preventDefault(); e.stopPropagation() }}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-accent-red"
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
      className="flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold transition-colors hover:bg-foreground/[0.04]">
      <span className={`inline-block h-2 w-2 rounded-full ${shownShootState(s) === 'shot' ? 'bg-accent-green' : 'bg-accent-blue'}`} />
      {s.title}
      <span className="font-normal text-muted-foreground">· {SHOWN_SHOOT_LABEL[shownShootState(s)]}{s.shoot_date ? ` · ${whenShort(s.shoot_date)}` : ''}</span>
    </Link>
  )

  return (
    <div className="flex flex-col gap-4">
      {viewer && shoots !== null && <GettingStarted role={role} page="production" />}

      <PageTitle
        title="Production"
        summary={boardSummary}
        actions={<>
          {/* one place, always on screen — a control that moves with the data
              is a control nobody learns */}
          <ScopeSwitch scope={scope} onChange={setScope} unassignedCount={openPool}
            unassignedHint="Plans and tasks nobody has picked up yet." />
          {(canPlan || isManager) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90">
                  <Plus className="h-4 w-4" /> New card <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                {/* one line of context: a shoot plan IS the shoot — there is
                    no separate "make a shoot" step to get wrong */}
                <p className="px-2 py-1.5 text-[13px] text-muted-foreground">
                  A shoot plan is the concept and shot list for a filming day. Making it sets up the shoot too.
                </p>
                {canPlan && (
                  <DropdownMenuItem className="min-h-11 items-start" onClick={() => setNewCardOpen(true)}>
                    <Link2 className="mt-0.5 h-4 w-4" />
                    <span className="flex flex-col">
                      New card
                      <span className="text-[13px] text-muted-foreground">one thing to make — a reel, a graphic, research, anything. Type what it is.</span>
                    </span>
                  </DropdownMenuItem>
                )}
                {canPlan && (
                  <DropdownMenuItem className="min-h-11 items-start" onClick={() => setBriefOpen(true)}>
                    <FileText className="mt-0.5 h-4 w-4" />
                    <span className="flex flex-col">
                      New shoot plan
                      <span className="text-[13px] text-muted-foreground">the plan the client signs off — creates the shoot with it</span>
                    </span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[13px] text-muted-foreground">
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
              { value: 'list', label: 'List', icon: ListChecks },
              { value: 'board', label: 'Board', icon: Kanban },
              { value: 'calendar', label: 'Calendar', icon: CalendarDays },
            ]}
          />
          <Select value={clientFilter} onValueChange={v => v && setClientFilter(v)}>
            <SelectTrigger className="h-11 w-44 rounded-full border-border bg-surface px-4"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="absolute left-4 top-[15px] h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search shoots, plans and tasks…"
              className="h-11 w-56 rounded-full border-border bg-surface pl-11" />
          </div>
        </div>
      </div>
      <p className="-mt-2 text-[13px] text-muted-foreground">
        Mine, Unassigned and Everyone cover plans and tasks. Shoots are always shown.
        {outOfScope > 0 && <> ({outOfScope} more outside this view)</>}
      </p>

      {needsSchema && (
        <div className="rounded-card bg-tint-amber p-5 text-[15px]">
          This part of the app isn&rsquo;t switched on yet. Send this to your developer —
          shoots are missing their status.
        </div>
      )}

      {view === 'board' ? (
        !viewer || live.loading || today === null ? (
          <div className="flex gap-3.5 overflow-x-hidden">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-72 min-w-[220px] flex-1 rounded-card" />)}
          </div>
        ) : (
          <Board
            cards={boardCards}
            viewer={viewer}
            columns={boardColumns}
            names={teamNames}
            kinds={live.tables.workKinds.rows}
            today={today}
            initialColumn={boardParams.column}
            show={boardParams.show}
            onClearShow={boardParams.clearShow}
            ariaLabel="Every card, by stage"
          />
        )
      ) : view === 'calendar' ? (
        <WorkCalendar
          events={calendar}
          viewer={viewer}
          view={range as CalendarView}
          onViewChange={setRange}
          onMove={moveEvent}
          undatedLabel="No date yet"
          legend={
            <p className="text-[15px] text-muted-foreground">
              Shoots sit on their shoot date; plans and tasks on their due date. Drag one
              to another day to move it — a booked shoot moves from the shoot
              page, with a reason.
            </p>
          }
        />
      ) : shoots === null ? (
        <div className="flex gap-3.5 overflow-x-hidden">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-72 min-w-[220px] flex-1 rounded-card" />)}
        </div>
      ) : nothingToShow ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-border bg-surface px-6 py-14 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-tile bg-foreground/[0.06]">
            <Camera className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-[17px] font-semibold">Nothing on the board yet</p>
          <p className="max-w-sm text-[15px] text-muted-foreground">
            {outOfScope > 0
              ? 'Work is being planned, but none of it is yours.'
              : 'Start with a shoot plan — the concept and shot list for a filming day. Making it sets up the shoot too.'}
          </p>
          {/* planning is always a valid next move for whoever can plan —
              whatever the reason the page is empty */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {outOfScope > 0 && (
              <Button variant="outline" className="h-11 rounded-full border-border bg-surface px-4 text-[14px] font-semibold"
                onClick={() => setScope(new Set<ScopeMode>(['all']))}>
                Show everyone&rsquo;s
              </Button>
            )}
            {canPlan && (
              <Button className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90"
                onClick={() => setBriefOpen(true)}><Plus className="h-4 w-4" /> New shoot plan</Button>
            )}
          </div>
        </div>
      ) : (
        <>
          <LaneBoard
            ariaLabel="Production columns"
            initialLane={BOARD_COLUMNS.find(c =>
              briefRows.some(b => columnOf(b.status) === c.key && b.owner_id === viewer?.id)
              || taskRows.some(t => columnOf(t.status) === c.key && (t.owner_id === viewer?.id || t.my_open_task)))?.key}
            lanes={BOARD_COLUMNS.map((column): Lane => {
              const laneBriefs = briefRows.filter(b => columnOf(b.status) === column.key)
              const laneTasks = taskRows.filter(t => columnOf(t.status) === column.key)
              // a shoot with no plan yet has no status of its own: it starts
              // in Draft, where the plan it is waiting for gets written
              const laneShoots = column.key === 'draft' ? planlessShoots : []
              const cards = [
                ...laneShoots.map(shootCard),
                ...laneBriefs.map(b => briefCard(b, column.key)),
                ...laneTasks.map(t => taskCard(t)),
              ]
              // finished tasks are a tail on their own column, collapsed:
              // "Back" from a finished task still lands somewhere real
              const laneDone = doneRows.filter(t => columnOf(t.status) === column.key)
              if (laneDone.length > 0) {
                cards.push(!doneOpen
                  ? (
                    <button key="done-toggle" type="button" onClick={() => setDoneOpen(true)}
                      className="min-h-11 rounded-inner border border-dashed border-border py-4 text-center text-[13px] text-muted-foreground hover:text-foreground">
                      {laneDone.length} task{laneDone.length === 1 ? '' : 's'} finished in the last 14 days — show
                    </button>
                  ) : (
                    <div key="done-list" className="flex flex-col gap-2.5">
                      {laneDone.map(t => taskCard(t, true))}
                      <button type="button" onClick={() => setDoneOpen(false)}
                        className="min-h-11 self-start px-1 text-[13px] text-muted-foreground hover:text-foreground">
                        Hide finished tasks
                      </button>
                    </div>
                  ))
              }
              return {
                key: column.key,
                title: column.label,
                count: laneShoots.length + laneBriefs.length + laneTasks.length,
                empty: COLUMN_EMPTY[column.key],
                cards,
                hint: <span className="sr-only">{column.meaning}</span>,
              }
            })}
          />

          {/* booked shoots have left the board — but not the page. One chip
              each, straight to the shoot page where the items are created. */}
          {(bookedShoots.length > 0 || closedShoots.length > 0) && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[12px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">
                Booked shoots <span className="tabular-nums">{bookedShoots.length}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {bookedShoots.map(shootChip)}
                {closedShoots.length > 0 && (
                  !closedOpen ? (
                    <button type="button" onClick={() => setClosedOpen(true)}
                      className="min-h-11 rounded-full border border-dashed border-border px-4 text-[13px] font-semibold text-muted-foreground hover:text-foreground">
                      {closedShoots.length} closed — show
                    </button>
                  ) : (
                    <>
                      {closedShoots.map(shootChip)}
                      <button type="button" onClick={() => setClosedOpen(false)}
                        className="min-h-11 px-2 text-[13px] text-muted-foreground hover:text-foreground">
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

      {/* a CARD: one deliverable, one client, one link — the link-first work
          the three pages track */}
      {viewer && (
        <NewCardDialog
          open={newCardOpen}
          onOpenChange={setNewCardOpen}
          clients={clients.map(c => ({ id: c.id, name: c.name }))}
          kinds={live.tables.workKinds.rows}
          team={team}
          viewer={{ ...viewer, name: me?.name }}
          defaultClientId={clientFilter}
          onCreated={() => { if (view !== 'board') setView('board') }}
        />
      )}

      {/* the SHOOT PLAN — the reviewable plan that rides the item pipeline */}
      <NewShootPlanDialog
        open={briefOpen}
        onOpenChange={setBriefOpen}
        onCreated={revealCreated}
        clients={clients}
        batches={shoots ?? []}
        briefedBatchIds={[...briefByBatch.keys()]}
        team={team}
      />

      <AlertDialog open={!!toDelete} onOpenChange={o => !delBusy && !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {/* the count the card already holds, said back before the click:
                  "it cannot be undone" is only frightening, whereas "its four
                  cards stay" is the fact somebody actually needs */}
              This removes the shoot and its own record. It cannot be undone.{' '}
              {(toDelete?.content_items?.[0]?.count ?? 0) > 0
                ? `Its ${toDelete!.content_items![0].count} card${toDelete!.content_items![0].count === 1 ? ' stays' : 's stay'} on the board.`
                : 'Nothing is attached to it, so nothing else changes.'}
              {' '}A shoot with anything already scheduled or live is closed instead of deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delBusy}>Keep it</AlertDialogCancel>
            <AlertDialogAction disabled={delBusy}
              className="bg-accent-red text-cream hover:bg-accent-red/90"
              onClick={e => { e.preventDefault(); void remove() }}>
              {delBusy ? 'Deleting…' : 'Delete shoot'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
