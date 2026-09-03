'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
  addNextLabel, addTypeLabel, formatBreakdown, formatChip, groupLine, isMixedGroup,
  isTaskGroup, mixedGroupLine, nextPieceTitle, remainingTypes, splitByGroup,
  spreadLine, statusSpread,
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
import { useWorkRows } from '../useLiveWork'
import { useRole } from '../useRole'
import PageTitle from '../ui/PageTitle'
import Chip, { type ChipTone } from '../ui/Chip'
import WorkCard, { type Person, type WorkTone } from '../ui/WorkCard'
import { defaultAllows } from '../../lib/page-access-core'
import NewItemDialog, { type Batch, type ClientRow } from '../production/NewItemDialog'
import AddPieceDialog, { type AddPieceTarget } from '../production/AddPieceDialog'
import { AccountUnavailable, ShootChips } from '../production/shoot-ui'
import { teamNameMap, usePersistedChoice, usePersistedScope, useTeamMembers } from '../production/workHooks'

/** One colour per stage, for the segmented bar on a group card. The pipeline
 *  reads left to right: neutral while it is ours, amber while it is with the
 *  client, green once the client has said yes. Brand accents only — the board
 *  has five colours and a bar is not the place to invent a sixth. */
const SEGMENT_TINT: Record<ItemStatus, string> = {
  draft_uploaded: 'bg-foreground/25',
  internal_review: 'bg-accent-blue',
  revision_required: 'bg-accent-amber',
  revision_complete: 'bg-accent-blue',
  client_review: 'bg-accent-amber',
  client_changes_requested: 'bg-accent-red',
  approved_for_scheduling: 'bg-accent-green',
  scheduled: 'bg-accent-blue-deep',
  published: 'bg-accent-green',
}
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

/** Today where the reader is, as a plain YYYY-MM-DD so it compares straight
 *  against a due date with no clock or time zone getting involved. */
function todayKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * THE COLOUR OF A CARD IS THE THING THAT NEEDS A PERSON.
 *
 * The same rule the Production board uses, so one board teaches the other:
 * live work is ink, a date that has arrived is amber and outranks everything
 * else, then approved (green) and scheduled (blue). Everything else is a
 * plain white card — a board where three cards are coloured is a board you
 * can read from the doorway.
 */
function cardTone(status: ItemStatus, due: string | null): WorkTone | undefined {
  // `published` and `scheduled` cannot reach this board — `editorScope` drops
  // both before the lanes are built. They are kept so the three boards share
  // ONE rule rather than three that agree by coincidence, and so a card looks
  // the same the day someone widens the scope.
  if (status === 'published') return 'ink'
  if (due && due.slice(0, 10) <= todayKey()) return 'amber'
  if (status === 'approved_for_scheduling') return 'green'
  if (status === 'scheduled') return 'blue'
  return undefined
}

/** A work kind's colour, as a chip tone — the palette has five, not eight. */
const KIND_TONE: Record<string, ChipTone> = {
  zinc: 'muted', pink: 'red', rose: 'red', sky: 'blue', indigo: 'blue',
  violet: 'blue', emerald: 'green', amber: 'amber',
}

/** How loud a piece of work is asking to be picked up. */
const PRIORITY_TONE: Record<string, string> = {
  urgent: 'text-accent-red',
  high: 'text-accent-amber',
  normal: 'text-muted-foreground',
  low: 'text-muted-foreground/50',
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** A date on a card, in the shortest form that is still unambiguous. */
const whenShort = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })

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
  /** which quota cards are open, listing their pieces */
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  /** the group + format the "add a piece" dialog is collecting content for */
  const [pieceTarget, setPieceTarget] = useState<AddPieceTarget | null>(null)
  /** the quota card the person is about to delete — irreversible, so confirmed */
  const [groupToDelete, setGroupToDelete] = useState<GroupCard<Item> | null>(null)
  const [deletingGroup, setDeletingGroup] = useState(false)
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [batchFilter, setBatchFilter] = useState<string>('all')

  const [newOpen, setNewOpen] = useState(false)
  const [preset, setPreset] = useState<{ client_id?: string; batch_id?: string } | undefined>()

  // the comments drawer: read and answer an item's comments without leaving
  // the board. `?comments=<itemId>` opens it on load (notification links).
  const commentsDrawer = useCommentsDrawer()

  const { me, role, loading, can } = useRole()
  const isManager = can('account_manager')
  // memoised: this is the memo key `useWorkRows` scopes the whole table by,
  // and a fresh object per render re-ran that on every keystroke in the
  // search box
  const viewer: Viewer | null = useMemo(
    () => (me ? { id: me.id, role: me.role } : null), [me])
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
   * THE BOARD, LIVE.
   *
   * Four API calls and a refetch-everything hint used to sit here. The board
   * now renders from database listeners: the first snapshot paints it, and
   * every later change — anybody's, anywhere — repaints it with no refetch
   * and no reload. The rows are scoped and joined exactly as
   * `/api/production/items` scoped and joined them; see
   * `app/lib/scope-client.ts`, whose rules are unit-tested against the
   * server's own predicate.
   *
   * WRITES ARE UNCHANGED: every mutation below is still its `fetch('/api/...')`
   * call, because the routes own the side effects. What has gone is the
   * `load()` that used to follow each one.
   */
  const live = useWorkRows(viewer)
  const items: Item[] | null = live.loading ? null : (live.items as unknown as Item[])
  const clients = live.clients as unknown as ClientRow[]
  const batches = live.batches as unknown as Batch[]
  const groups = live.groups as unknown as DeliverableGroup[]

  /**
   * A LISTENER THAT COULD NOT READ IS NOT AN EMPTY BOARD.
   *
   * The old page toasted 'Failed to load the editor board' when its fetch threw. Drawing
   * nothing and saying nothing is worse than that was — an empty board looks
   * like an answer. Toasted once per failure, not once per render.
   */
  const liveError = live.error
  useEffect(() => {
    if (liveError) toast.error('Failed to load the editor board')
  }, [liveError])
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

  /** The board in one plain sentence: what is on your hands, and what is out
   *  of them. Counted from the rows the columns are drawn from, so the
   *  sentence can never disagree with what is underneath it. */
  const toEdit = visible.filter(i =>
    ['draft_uploaded', 'revision_required', 'revision_complete'].includes(i.status)).length
  const withClient = visible.filter(i =>
    ['client_review', 'client_changes_requested'].includes(i.status)).length
  const boardSummary = !items
    ? 'Everything being edited, from first cut to client sign-off — it updates the moment anyone moves something.'
    : `${plural(toEdit, 'item')} to edit · ${withClient} waiting on a client`

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
    } finally {
      setBulkBusy(false)
    }
  }

  /**
   * Drag a card onto another day — the due date, moved.
   *
   * No optimistic copy any more: the card lands on the new day the moment the
   * write commits, because the listener is what draws it — and a refusal
   * therefore leaves it exactly where it was, with no bookkeeping here.
   * `canMove` only decides whether to offer the handle; the API is what
   * actually enforces who may move a date, and its refusal is shown in its
   * own words.
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not assign it')
    }
  }

  /** Open the "add a piece" dialog for one format — the piece is created only
   *  once a file or link is provided there, never on this click. */
  const openAddPiece = (card: GroupCard<Item>, contentType: string) => {
    setPieceTarget({
      group_id: card.group.id,
      client_id: card.group.client_id,
      batch_id: card.group.batch_id ?? null,
      content_type: contentType,
      work_kind_id: card.group.work_kind_id ?? null,
      title: nextPieceTitle(card.group, card.count),
    })
  }

  /** The dialog created a real piece (item + its first version). Nothing left
   *  to do here: the listener has already folded it into its card. */
  const applyCreatedPiece = () => {}

  /** Delete a quota card. Its pieces are detached server-side and stay on the
   *  board as plain cards; the listener drops the card the moment it is gone. */
  const deleteGroupCard = async (card: GroupCard<Item>) => {
    setDeletingGroup(true)
    try {
      const res = await fetch(`/api/production/groups/${card.group.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error((json as { error?: string } | null)?.error ?? 'Could not delete the card')
      toast.success(card.count
        ? `Card deleted — ${card.count} piece${card.count === 1 ? '' : 's'} kept on the board`
        : 'Card deleted')
      setGroupToDelete(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the card')
    } finally {
      setDeletingGroup(false)
    }
  }

  /** A quota card: the promise, how full it is, and the one next action.
   *  A MIXED card (2 reels + 2 carousels + 2 videos) shows the title, the
   *  aggregate "3 of 6", a per-format breakdown, and an "Add the next piece"
   *  menu of the formats still owed. A single-format card keeps its one line
   *  and one button, exactly as before. */
  const renderGroupCard = (card: GroupCard<Item>) => {
    const open = openGroups.has(card.group.id)
    const mixed = isMixedGroup(card.group)
    const breakdown = mixed ? formatBreakdown(card.group, card.items) : []
    const owed = mixed ? remainingTypes(card.group, card.items) : []
    return (
      <div key={`group-${card.group.id}`}
        className="flex flex-col gap-2.5 rounded-inner border border-border bg-surface p-3.5 text-foreground">
        <span className="text-[12px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">
          {clients.find(c => c.id === card.group.client_id)?.name ?? '—'}
        </span>
        <div className="flex items-start justify-between gap-2">
          {mixed ? (
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[15px] font-semibold leading-[1.25]">{card.group.title}</span>
              <span className="text-[13px] text-muted-foreground">{mixedGroupLine(card.group, card.items)}</span>
            </div>
          ) : (
            <span className="text-[15px] font-semibold leading-[1.25]">{groupLine(card)}</span>
          )}
          <div className="flex shrink-0 items-center">
            <button type="button" aria-label={open ? 'Hide the pieces' : 'Show the pieces'}
              onClick={() => setOpenGroups(prev => {
                const next = new Set(prev)
                if (next.has(card.group.id)) next.delete(card.group.id); else next.add(card.group.id)
                return next
              })}
              className="-my-2 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            <button type="button" aria-label="Delete this card"
              onClick={() => setGroupToDelete(card)}
              className="-my-2 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-accent-red">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* The bar, one segment per piece.
         *
         *  It used to be a single emerald fill of "how much exists", which
         *  meant a card holding five approved pieces and two the client
         *  wants changed drew a 100% GREEN bar while sitting in the
         *  "Client wants changes" lane — the only card on the board that
         *  could read finished and stuck at once. Segments show where the
         *  work actually is; the empty tail is what is still owed. */}
        <div className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-foreground/[0.08]">
          {statusSpread(card.items).map(s => (
            <div
              key={s.status}
              title={`${s.count} · ${STATUS_LABELS[s.status]}`}
              className={`h-full transition-all ${SEGMENT_TINT[s.status]}`}
              style={{ width: `${(s.count / Math.max(1, card.target)) * 100}%` }}
            />
          ))}
        </div>
        {/* …and the same fact in words, only when the pieces disagree */}
        {spreadLine(card.items, STATUS_LABELS) && (
          <p className="text-[13px] text-muted-foreground">
            {spreadLine(card.items, STATUS_LABELS)}
            {card.count < card.target && ` · ${card.target - card.count} not started`}
          </p>
        )}
        {/* per-format progress: Reels 2/2 ✓ · Carousels 1/2 · Videos 0/2 */}
        {mixed && (
          <div className="flex flex-wrap items-center gap-1.5">
            {breakdown.map(f => {
              const chip = formatChip(f)
              return (
                <Chip key={f.type} tone={chip.done ? 'green' : 'muted'}>
                  {chip.label}{chip.done ? ' ✓' : ''}
                </Chip>
              )
            })}
          </div>
        )}
        {!mixed && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip className="capitalize">{card.group.content_type}</Chip>
          </div>
        )}
        {open && (
          <div className="flex flex-col gap-1">
            {card.items.length === 0 && (
              <p className="text-[13px] text-muted-foreground">No pieces yet — add the first one below.</p>
            )}
            {card.items.map(i => (
              <Link key={i.id} href={`/dashboard/production/${i.id}`}
                className="flex min-h-11 items-center justify-between gap-2 rounded-tile px-2 text-[13px] hover:bg-foreground/[0.05]">
                <span className="flex min-w-0 items-center gap-1.5 truncate">
                  {mixed && (
                    <span className="shrink-0 rounded-tile bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {i.content_type}
                    </span>
                  )}
                  <span className="truncate">{i.title}</span>
                </span>
                <span className="shrink-0 text-muted-foreground">{STATUS_LABELS[i.status]}</span>
              </Link>
            ))}
          </div>
        )}
        {mixed ? (
          // driven by what each FORMAT still owes, not the aggregate count —
          // six reels on a 2+2+2 card have not filled the carousels
          owed.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="h-11 w-fit rounded-full bg-foreground px-4 text-[14px] font-semibold text-background hover:bg-foreground/90">
                  <Plus className="h-4 w-4" />
                  Add the next piece
                  <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {owed.map(t => (
                  <DropdownMenuItem key={t} className="min-h-11" onSelect={() => openAddPiece(card, t)}>
                    {addTypeLabel(t)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        ) : (!card.full && (
          <Button className="h-11 w-fit rounded-full bg-foreground px-4 text-[14px] font-semibold text-background hover:bg-foreground/90"
            onClick={() => openAddPiece(card, card.group.content_type)}>
            <Plus className="h-4 w-4" />
            {addNextLabel(card.group)}
          </Button>
        ))}
      </div>
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
      <PageTitle
        title="Editor"
        summary={boardSummary}
        actions={<>
          {/* one place, always on screen — a control that moves with the data
              is a control nobody learns */}
          <ScopeSwitch scope={scope} onChange={setScope}
            unassignedCount={openPool} unassignedHint={unassignedHint} />
          <Button className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90"
            onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" /> New item
          </Button>
        </>}
      />

      <div className="flex flex-wrap items-center gap-3">
        {/* the purpose, in a new hire's words: what is here and what you do with it */}
        <p className="text-[13px] text-muted-foreground">
          Every item <HelpHint term="item" /> being edited — take one, attach your work, send it for review
        </p>
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
          <Select value={clientFilter} onValueChange={v => { if (!v) return; setClientFilter(v); setBatchFilter('all') }}>
            <SelectTrigger className="h-11 w-44 rounded-full border-border bg-surface px-4"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {isManager && (
            <Button
              className={`h-11 rounded-full px-4 text-[14px] font-semibold ${
                selectMode
                  ? 'bg-foreground text-background hover:bg-foreground/90'
                  : 'border border-border bg-surface text-foreground hover:bg-foreground/[0.04]'
              }`}
              onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}>
              <CheckSquare className="h-4 w-4" /> {selectMode ? 'Cancel' : 'Select to delete'}
            </Button>
          )}
        </div>
      </div>

      {ready && <GettingStarted role={role} page="editor" />}

      <ShootChips batches={batches} clientFilter={clientFilter}
        value={batchFilter} onChange={setBatchFilter}
        countFor={bid => scoped.filter(i =>
          i.batch_id === bid && (clientFilter === 'all' || i.client_id === clientFilter)).length} />

      {strip && strip.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[12px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">
            {new Date().toLocaleDateString('en-AU', { month: 'long' })}
          </span>
          {strip.map(r => (
            <span key={r.type}
              title={`${r.posted ?? r.delivered} posted · ${r.scheduled ?? 0} scheduled · ${r.approved ?? 0} approved · ${r.in_production ?? Math.max(0, r.planned - r.delivered)} in production · ${Math.max(0, r.quota - r.planned)} not started`}>
              <Chip tone={r.delivered > r.quota ? 'amber' : 'muted'} className="tabular-nums">
                {r.label} {r.delivered}/{r.quota}
              </Chip>
            </span>
          ))}
        </div>
      )}

      {!ready ? (
        <div className="flex gap-3.5 overflow-x-hidden">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-72 min-w-[220px] flex-1 rounded-card" />)}
        </div>
      ) : scoped.length === 0 && groupCards.length === 0 ? (
        /* the scope itself is empty — a real "there is nothing here". A client
           or shoot chip matching nothing is not that, and keeps its board. */
        <div className="flex flex-col items-center gap-3 rounded-card border border-border bg-surface px-6 py-14 text-center">
            {showingOnlyMineAndPool ? (
              <>
                {/* say what THIS filter is empty of — "nothing assigned to
                    you" beside a pill reading "Free to take 1" is a page
                    arguing with itself */}
                <p className="max-w-sm text-[15px] text-muted-foreground">
                  {scope.has('mine') && scope.has('unassigned')
                    ? 'Nothing assigned to you, and nothing waiting to be picked up.'
                    : scope.has('mine')
                      ? 'Nothing is assigned to you right now.'
                      : 'Nothing is waiting to be picked up.'}
                </p>
                <Button className="h-11 rounded-full border border-border bg-surface px-4 text-[14px] font-semibold text-foreground hover:bg-foreground/[0.04]"
                  onClick={() => setScope(new Set<ScopeMode>(['all']))}>
                  Show everyone&rsquo;s
                </Button>
              </>
            ) : (
              /* scope Everyone and still nothing — the first thing a new
                 account manager sees. A dead end needs a next step. */
              <>
                <p className="text-[17px] font-semibold">Nothing to edit yet</p>
                <p className="max-w-sm text-[15px] text-muted-foreground">
                  When a shoot <HelpHint term="shoot" /> is locked, its items land here in {DRAFTING_LANE} — or create one now.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90"
                    onClick={() => setNewOpen(true)}>
                    <Plus className="h-4 w-4" /> New item
                  </Button>
                  <Button className="h-11 rounded-full border border-border bg-surface px-4 text-[14px] font-semibold text-foreground hover:bg-foreground/[0.04]" asChild>
                    <Link href="/dashboard/production">Plan a shoot <ArrowRight className="h-3.5 w-3.5" /></Link>
                  </Button>
                </div>
              </>
            )}
        </div>
      ) : view === 'calendar' ? (
        /* the same 22px surface card the Scheduler's calendar sits on — a
           month grid loose on the cream canvas is the one thing on the page
           without an edge. Wrapper only: no prop of WorkCalendar moves. */
        <section className="rounded-card border border-border bg-surface p-4 sm:p-6">
          <WorkCalendar
            events={calendar}
            viewer={viewer}
            view={range as CalendarView}
            onViewChange={setRange}
            onMove={moveEvent}
            undatedLabel="No due date"
            legend={
              <p className="text-[15px] text-muted-foreground">
                Every item on its due date, coloured by the step it is on. Drag one to
                another day to move the date.
              </p>
            }
          />
        </section>
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
                count: colItems.length + colGroups.length,
                hint: lane.key === 'drafting' ? <HelpHint term="drafting" />
                  : lane.key === 'approved' ? <HelpHint term="approved_for_scheduling" /> : undefined,
                empty: filtering && visible.length === 0 && groupCards.length === 0 ? 'Nothing for this client / shoot' : LANE_EMPTY[lane.key] ?? 'Nothing here.',
                cards: [...colGroups.map(renderGroupCard), ...colItems.map(item => {
                      const assignment = editorAssignment(item, viewer!)
                      const ownerName = item.owner_id ? nameById.get(item.owner_id) : undefined
                      // who is holding it — the 26px face on the card, the
                      // same one this person wears on every other board
                      const people: Person[] = assignment === 'other' && ownerName
                        ? [{ id: item.owner_id ?? undefined, name: ownerName, initials: initialsOf(ownerName) }]
                        : []
                      return (
                      <div key={item.id} className="relative">
                        <WorkCard
                          href={`/dashboard/production/${item.id}`}
                          client={item.clients?.name ?? '—'}
                          title={item.title}
                          tone={cardTone(item.status, item.due_date)}
                          people={people}
                          className={selectMode && selectedIds.has(item.id)
                            ? 'ring-2 ring-inset ring-accent-blue' : ''}
                          chips={<>
                            <Chip className="capitalize">{item.content_type}</Chip>
                            <Chip>{itemStatusLabel(item.work_kinds?.slug, item.status, STATUS_LABELS[item.status])}</Chip>
                            {item.work_kinds && item.work_kinds.slug !== 'edit' && (
                              <Chip tone={KIND_TONE[item.work_kinds.color] ?? 'muted'}>{item.work_kinds.name}</Chip>
                            )}
                            {/* TurnChip is the single answer to "is this on
                                me?" — the old `you` pill said it twice. The
                                avatar answers a different question (who OWNS
                                it, whoever's turn it is) and stays. */}
                            <TurnChip status={item.status} item={item} viewer={viewer!} ownerName={ownerName}
                              openTask={item.my_open_task}
                              onOpenComments={() => commentsDrawer.open(item.id, item.title)} />
                            {/* two different problems: one is ours to fix,
                                one came back from the client — and a board
                                where both are amber cannot say which */}
                            {item.status === 'revision_required' && <Chip tone="amber">needs edit</Chip>}
                            {item.status === 'client_changes_requested' && <Chip tone="red">client changes</Chip>}
                            {item.due_date && (
                              <Chip><CalendarDays className="h-3.5 w-3.5" />{whenShort(item.due_date)}</Chip>
                            )}
                            {item.current_version_number > 0 && (
                              <Chip className="tabular-nums">v{item.current_version_number}</Chip>
                            )}
                            <Flag className={`h-3.5 w-3.5 shrink-0 ${PRIORITY_TONE[item.priority] ?? PRIORITY_TONE.normal}`} />
                            {/* the conversation, right here — the drawer,
                                not a trip to the item page */}
                            <CommentsButton className="ml-auto" tagged={item.my_open_task} title={item.title}
                              onOpen={() => commentsDrawer.open(item.id, item.title)} />
                          </>}
                          actions={assignment === 'unassigned' && !selectMode ? <>
                            {canClaimEditor(item, viewer!) && (
                              <ClaimButton itemId={item.id} hat="editor" onDone={() => {}} />
                            )}
                            {isManager && nameById.size > 0 && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button className="h-11 rounded-full border border-border bg-surface px-4 text-[14px] font-semibold text-foreground hover:bg-foreground/[0.04]">Assign…</Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                                  {[...nameById].map(([id, name]) => (
                                    <DropdownMenuItem key={id} className="min-h-11" onClick={() => void assignTo(item.id, id)}>
                                      {name}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </> : <></>}
                        />
                        {/* SELECT MODE takes the card over: the tick is the
                            whole surface, so a tap cannot half-open an item
                            it was meant to select. */}
                        {selectMode && (
                          <button type="button" aria-label={`Select ${item.title}`}
                            aria-pressed={selectedIds.has(item.id)}
                            onClick={() => toggleSelected(item.id)}
                            className="absolute inset-0 z-20 flex items-start justify-start rounded-inner p-2.5">
                            <span className={`flex h-5 w-5 items-center justify-center rounded-[6px] border ${
                              selectedIds.has(item.id)
                                ? 'border-accent-blue bg-accent-blue text-cream'
                                : 'border-border bg-surface'
                            }`}>
                              {selectedIds.has(item.id) && <CheckSquare className="h-3.5 w-3.5" />}
                            </span>
                          </button>
                        )}
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
          className="flex min-h-11 items-center gap-1.5 self-start rounded-full border border-border bg-surface px-4 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground">
          <span className="font-semibold tabular-nums text-foreground">{tail.scheduled}</span>
          scheduled ·
          <span className="font-semibold tabular-nums text-foreground">{tail.published}</span>
          published
          <ArrowRight className="h-3.5 w-3.5" /> Scheduler
        </Link>
      )}

      {/* select-mode action bar */}
      {selectMode && (
        <div className="fixed bottom-6 left-1/2 z-40 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-full border border-border bg-surface/95 px-4 py-2 shadow-[0_6px_24px_rgba(11,11,11,0.14)] backdrop-blur">
          <span className="text-[13px] font-semibold tabular-nums text-muted-foreground">
            {selectedIds.size} selected
          </span>
          <Button className="h-11 rounded-full bg-transparent px-3 text-[14px] font-semibold text-foreground hover:bg-foreground/[0.06]"
            onClick={() => setSelectedIds(new Set(visible.map(i => i.id)))}>
            Select all
          </Button>
          <Button className="h-11 gap-1.5 rounded-full bg-accent-red px-4 text-[14px] font-semibold text-cream hover:bg-accent-red/90 disabled:opacity-50"
            disabled={selectedIds.size === 0} onClick={() => setBulkOpen(true)}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          <Button className="h-11 rounded-full bg-transparent px-3 text-[14px] font-semibold text-foreground hover:bg-foreground/[0.06]" onClick={exitSelect}>Cancel</Button>
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
        onCreated={() => {}}
        preset={preset}
        clients={clients}
        batches={batches}
        team={team}
      />
      <AddPieceDialog
        open={pieceTarget !== null}
        onOpenChange={o => { if (!o) setPieceTarget(null) }}
        target={pieceTarget}
        onCreated={applyCreatedPiece}
      />
      <AlertDialog open={groupToDelete !== null} onOpenChange={o => { if (!o && !deletingGroup) setGroupToDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this card?</AlertDialogTitle>
            <AlertDialogDescription>
              {groupToDelete && groupToDelete.count > 0
                ? `This removes the promise. The ${groupToDelete.count} piece${groupToDelete.count === 1 ? '' : 's'} already made will stay on the board as ${groupToDelete.count === 1 ? 'its' : 'their'} own card${groupToDelete.count === 1 ? '' : 's'}. This can’t be undone.`
                : 'This removes the promise. This can’t be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingGroup}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingGroup}
              onClick={e => { e.preventDefault(); if (groupToDelete) void deleteGroupCard(groupToDelete) }}
              className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600">
              {deletingGroup ? 'Deleting…' : 'Delete this card'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
