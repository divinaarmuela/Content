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
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
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
  Camera, CalendarDays, ChevronDown, FileText, Plus, Search, Trash2,
} from 'lucide-react'
import type { BatchStatus } from '../../lib/batch-brief-core'
import { STATUS_LABELS, type ItemStatus } from '../../lib/workflow-core'
import { BRIEF_STATUS_TURN, itemStatusLabel } from '../../lib/brief-task-core'
import {
  activeBriefTasks, isBriefTask, productionScope, type Viewer,
} from '../../lib/work-pages-core'
import { useProductionLive } from './useProductionLive'
import { AccountUnavailable, BATCH_STATUS_LABEL, BATCH_STATUS_STYLE } from './shoot-ui'
import { usePersistedScope, useTeamNames } from './workHooks'
import { useRole } from '../useRole'
import NewItemDialog, { type ClientRow } from './NewItemDialog'
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
  owner_id: string | null
  scheduler_ids?: unknown
  my_open_task?: boolean
  clients: { name: string } | null
  work_kinds?: { name: string; slug: string; color: string } | null
}

const SECTIONS: { status: BatchStatus; title: string }[] = [
  { status: 'brief', title: 'IN PLANNING' },
  { status: 'locked', title: 'DATE LOCKED' },
  { status: 'shot', title: 'SHOT' },
  { status: 'wrapped', title: 'WRAPPED' },
]

const SCOPE_KEY = 'md-production-scope'

function whenShort(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
}

/**
 * Production: the shoots, and the briefs that are still becoming shoots.
 *
 * A shoot is planned here BEFORE any content item exists — the Editor board
 * shows the aftermath; this shows the plan. The briefs in flight sit above the
 * shoots because they are the work: a shoot with no signed-off brief is a date
 * nobody can hold you to.
 */
export default function ProductionPage() {
  const router = useRouter()
  const [shoots, setShoots] = useState<Shoot[] | null>(null)
  const [briefTasks, setBriefTasks] = useState<BriefTask[]>([])
  const [clients, setClients] = useState<ClientRow[]>([])
  const [clientFilter, setClientFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [needsSchema, setNeedsSchema] = useState(false)

  const [newOpen, setNewOpen] = useState(false)
  const [newBusy, setNewBusy] = useState(false)
  const [draft, setDraft] = useState({ client_id: '', title: '' })
  const [briefOpen, setBriefOpen] = useState(false)

  const { me, role, loading, can } = useRole()
  const canPlan = can('editor')
  const isManager = can('account_manager')
  const viewer: Viewer | null = me ? { id: me.id, role: me.role } : null

  // names for "waiting on …" — managers can see who holds a brief
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
      // ones, but a shoot card still has to say "Brief: Shoot booked"
      if (iRes.ok) setBriefTasks(((await iRes.json()) as BriefTask[]).filter(isBriefTask))
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
      if (!res.ok) throw new Error(json.error ?? 'Could not create the brief')
      router.push(`/dashboard/production/shoots/${json.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the brief')
      setNewBusy(false)
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
  const nothingToShow = shoots !== null && visible.length === 0 && briefRows.length === 0

  // the whole page hangs off the viewer, so a missing account is not a slower
  // load — it is a different screen, and saying so beats a skeleton forever
  if (!loading && !viewer) return <AccountUnavailable />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="ml-auto flex flex-wrap items-center gap-2">
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
              placeholder="Find a shoot…" className="w-44 bg-white pl-8 dark:bg-zinc-900" />
          </div>
          {(canPlan || isManager) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4" /> New <ChevronDown className="h-3.5 w-3.5 opacity-70" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {canPlan && (
                  <DropdownMenuItem onClick={() => setNewOpen(true)}>
                    <CalendarDays className="h-4 w-4" /> Plan shoot
                  </DropdownMenuItem>
                )}
                {isManager && (
                  <DropdownMenuItem onClick={() => setBriefOpen(true)}>
                    <FileText className="h-4 w-4" /> New brief task
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {needsSchema && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardContent className="p-4 text-sm text-amber-800 dark:text-amber-300">
            The shoot-brief upgrade needs its database migration — run
            <span className="font-mono"> supabase/agreements_and_briefs.sql</span> in the SQL editor.
          </CardContent>
        </Card>
      )}

      {/* the plans still being written, above the shoots they will become */}
      {briefsInFilters.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
              BRIEFS IN FLIGHT <span className="tabular-nums">{briefRows.length}</span>
            </p>
            <div className="ml-auto">
              <ScopeSwitch scope={scope} onChange={setScope} />
            </div>
          </div>
          {briefRows.length === 0 ? (
            /* when there is nothing at all on the page, the one empty card
               below carries this line — never two empty cards at once */
            nothingToShow ? null : (
              <Card className="border-dashed shadow-none">
                <CardContent className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  Briefs are in flight, but none of them are yours — switch to Everyone to see them.
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
                        <TurnChip status={b.status} item={b} viewer={viewer} turns={BRIEF_STATUS_TURN}
                          ownerName={b.owner_id ? nameById.get(b.owner_id) : undefined} />
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
                ? 'Briefs are in flight, but none of them are yours — switch to Everyone above to see them.'
                : 'Plan a shoot to brief the team before production starts.'}
            </p>
            {canPlan && !briefsOutOfScope && (
              <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> Plan shoot</Button>
            )}
          </CardContent>
        </Card>
      ) : (
        SECTIONS.map(section => {
          const rows = visible.filter(s => (s.status ?? 'shot') === section.status)
          if (rows.length === 0) return null
          return (
            <div key={section.status} className="flex flex-col gap-2">
              <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
                {section.title} <span className="tabular-nums">{rows.length}</span>
              </p>
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
                  return (
                    <div key={s.id} className="group/shoot relative">
                      <Card className="py-0 transition-shadow hover:shadow-md">
                        <CardContent className="flex flex-col gap-1.5 p-3">
                          {/* stretched link, so the delete control below is a
                              button beside an anchor and not inside one */}
                          <Link href={`/dashboard/production/shoots/${s.id}`} aria-label={s.title}
                            className="absolute inset-0 rounded-xl" />
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold">{s.title}</span>
                            <Badge variant="outline" className={`ml-auto shrink-0 font-normal ${BATCH_STATUS_STYLE[s.status ?? 'shot']}`}>
                              {BATCH_STATUS_LABEL[s.status ?? 'shot']}
                            </Badge>
                          </div>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {s.clients?.name ?? 'Unassigned'} ·{' '}
                            {whenShort(s.shoot_date) ?? <span className="italic text-zinc-400">No date yet</span>}
                          </p>
                          {brief && (
                            <span className="w-fit rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950/50 dark:text-sky-400">
                              Brief: {itemStatusLabel('shoot_brief', brief.status, STATUS_LABELS[brief.status])}
                            </span>
                          )}
                          {meta && (
                            <p className="font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{meta}</p>
                          )}
                        </CardContent>
                      </Card>
                      {canDelete && (
                        <button
                          type="button"
                          aria-label="Delete shoot"
                          onClick={e => { e.preventDefault(); e.stopPropagation(); setToDelete(s) }}
                          // hidden until the card is hovered OR anything in it
                          // takes focus — a keyboard tabbing the stretched link
                          // reveals it, and it stays put once focused itself
                          className="absolute right-2 top-2 z-10 hidden rounded-md p-1.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-600 focus:block group-hover/shoot:block group-focus-within/shoot:block dark:hover:bg-rose-950/40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
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
          <DialogHeader><DialogTitle>New shoot brief</DialogTitle></DialogHeader>
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
            <Button onClick={create} disabled={newBusy}>{newBusy ? 'Creating…' : 'Create brief'}</Button>
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
