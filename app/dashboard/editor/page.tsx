'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
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
import { Plus, CalendarDays, CheckSquare, Flag, Trash2, ArrowRight } from 'lucide-react'
import { SCHEDULER_STATUSES, STATUS_LABELS, type ItemStatus } from '../../lib/workflow-core'
import { itemStatusLabel } from '../../lib/brief-task-core'
import {
  EDITOR_LANES, canClaimEditor, editorAssignment, editorScope, editorTail,
  isBriefTask, unassignedCount, type ScopeMode, type Viewer,
} from '../../lib/work-pages-core'
import { useProductionLive } from '../production/useProductionLive'
import { useRole } from '../useRole'
import { defaultAllows } from '../../lib/page-access-core'
import NewItemDialog, { type Batch, type ClientRow } from '../production/NewItemDialog'
import { AccountUnavailable, KIND_CARD, KIND_CHIP, PRIORITY_TINT, ShootChips } from '../production/shoot-ui'
import { usePersistedScope, useTeamNames } from '../production/workHooks'
import { ScopeSwitch } from '../production/ScopeSwitch'
import { ClaimButton } from '../production/ClaimButton'
import { TurnChip } from '../production/TurnChip'

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

/** One dot per lane, in the same order the work moves. */
const LANE_TINT: Record<string, string> = {
  drafting: 'bg-zinc-400',
  review: 'bg-blue-500',
  revising: 'bg-amber-500',
  client: 'bg-violet-500',
  approved: 'bg-emerald-500',
}

const SCOPE_KEY = 'md-editor-scope'

/** Two letters for a colleague, when their whole name would crowd the card. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

/**
 * The Editor board: assets in the edit, and nothing else.
 *
 * The old single board showed every piece of work to everybody, so an editor
 * scrolled past shoot briefs and scheduled posts to find their own three jobs.
 * This page carries one question — what is mine to edit, and what is free to
 * pick up — and the scope switch is how you answer it.
 */
export default function EditorPage() {
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

  const [strip, setStrip] = useState<{ type: string; label: string; quota: number; planned: number; delivered: number; in_production?: number; approved?: number; scheduled?: number; posted?: number }[] | null>(null)
  useEffect(() => {
    if (clientFilter === 'all') { setStrip(null); return }
    fetch(`/api/production/deliverables-progress?client_id=${clientFilter}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => setStrip(j?.per_type ?? []))
      .catch(() => setStrip([]))
  }, [clientFilter])

  const load = useCallback(async () => {
    try {
      const [itemsRes, clientsRes, batchesRes] = await Promise.all([
        fetch('/api/production/items'),
        fetch('/api/website/clients'),
        fetch('/api/production/batches'),
      ])
      if (!itemsRes.ok) {
        const err = (await itemsRes.json()).error ?? ''
        if (String(err).match(/relation|does not exist/i)) { setNeedsSchema(true); setItems([]); return }
        throw new Error(err || 'Failed to load items')
      }
      setItems(await itemsRes.json())
      if (clientsRes.ok) setClients(await clientsRes.json())
      if (batchesRes.ok) setBatches(await batchesRes.json())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load the editor board')
      setItems([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  // arriving from a brief's "Create items": dialog open, client+shoot preset
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const forBatch = q.get('new_for_batch')
    if (forBatch) {
      setPreset({ batch_id: forBatch, client_id: q.get('client') ?? undefined })
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
  const openPool = viewer
    ? unassignedCount(
      filtered.filter(i => !isBriefTask(i) && !SCHEDULER_STATUSES.includes(i.status)),
      viewer, editorAssignment,
    )
    : 0
  // the tail counts what the board is SHOWING: under "Mine" it is my
  // scheduled and published work, not the whole team's. Counting `filtered`
  // ignored the scope switch entirely.
  const tail = editorTail(visible)

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

  /** Hand a loose job to somebody. Manager-only on the server too. */
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

  if (needsSchema) {
    return (
      <Card className="border-dashed shadow-none">
        <CardContent className="py-14 text-center text-sm text-zinc-500 dark:text-zinc-400">
          The production tables don&apos;t exist yet — run <span className="font-mono">supabase/production.sql</span> in
          the Supabase SQL editor, then reload.
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
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Assets in the edit — from first draft to client approval.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
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
          <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> New</Button>
        </div>
      </div>

      <ShootChips batches={batches} clientFilter={clientFilter}
        value={batchFilter} onChange={setBatchFilter} />

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
                <p>Nothing assigned to you, and nothing waiting to be picked up.</p>
                <Button variant="outline" size="sm" onClick={() => setScope(new Set<ScopeMode>(['all']))}>
                  Show everyone
                </Button>
              </>
            ) : (
              <p>No assets in the edit yet.</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="w-full overflow-x-auto">
          <div className="flex gap-3 pb-3">
            {EDITOR_LANES.map(lane => {
              const colItems = visible.filter(i => lane.statuses.includes(i.status))
              return (
                <div key={lane.key} className="min-w-44 flex-1">
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <span className={`h-2 w-2 rounded-full ${LANE_TINT[lane.key] ?? 'bg-zinc-400'}`} />
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{lane.title}</span>
                    <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{colItems.length}</span>
                  </div>
                  <div className="flex min-h-24 flex-col gap-2">
                    {colItems.map(item => {
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
                              <span className="font-mono text-[11px] uppercase text-zinc-400 dark:text-zinc-500">{item.content_type}</span>
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
                              <TurnChip status={item.status} item={item} viewer={viewer!} ownerName={ownerName} />
                              {assignment === 'mine' && (
                                <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                                  you
                                </span>
                              )}
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
                                  <ClaimButton itemId={item.id} hat="editor" label="Take this job" onDone={load} />
                                )}
                                {isManager && nameById.size > 0 && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button size="sm" variant="outline">Assign…</Button>
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
                    })}
                    {colItems.length === 0 && (
                      <div className="rounded-lg border border-dashed border-zinc-200 py-6 text-center text-xs text-zinc-300 dark:border-zinc-800 dark:text-zinc-600">
                        {filtering && visible.length === 0 ? 'Nothing for this client / shoot' : 'Empty'}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* done, but kept visible: the two counts that belong to the next page */}
      {ready && canSeeScheduler && (
        <Link href="/dashboard/scheduler"
          className="flex items-center gap-1.5 self-start rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-500 transition-colors hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100">
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
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
            onClick={() => setSelectedIds(new Set(visible.map(i => i.id)))}>
            Select all
          </Button>
          <Button size="sm" variant="destructive" className="h-7 gap-1.5 px-3 text-xs"
            disabled={selectedIds.size === 0} onClick={() => setBulkOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={exitSelect}>Cancel</Button>
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
