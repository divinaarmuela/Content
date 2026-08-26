'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
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
import { Plus, CalendarDays, CheckSquare, Flag, Trash2, ChevronDown } from 'lucide-react'
import type { ItemStatus } from '../../lib/workflow-core'
import { useProductionLive } from './useProductionLive'
import { ViewSwitch } from './shoot-ui'
import { useRole } from '../useRole'
import NewItemDialog, { type Batch, type ClientRow } from './NewItemDialog'

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
  clients: { name: string } | null
  batches: { title: string; status?: string; planned_deliverables?: { type: string; qty: number }[] } | null
  work_kinds?: { name: string; slug: string; color: string } | null
}
/** Board columns — revision-loop states share columns to keep the board tight. */
const COLUMNS: { key: string; title: string; statuses: ItemStatus[]; tint: string }[] = [
  { key: 'draft',     title: 'Draft uploaded',  statuses: ['draft_uploaded'], tint: 'bg-zinc-400' },
  { key: 'internal',  title: 'Internal review', statuses: ['internal_review'], tint: 'bg-blue-500' },
  { key: 'revision',  title: 'Revisions',       statuses: ['revision_required', 'revision_complete'], tint: 'bg-amber-500' },
  { key: 'client',    title: 'Client review',   statuses: ['client_review', 'client_changes_requested'], tint: 'bg-violet-500' },
  { key: 'approved',  title: 'Approved',        statuses: ['approved_for_scheduling'], tint: 'bg-emerald-500' },
  { key: 'scheduled', title: 'Scheduled',       statuses: ['scheduled'], tint: 'bg-cyan-600' },
  { key: 'published', title: 'Published',       statuses: ['published'], tint: 'bg-emerald-700' },
]

const PRIORITY_TINT: Record<string, string> = {
  urgent: 'text-red-600 dark:text-red-400',
  high: 'text-amber-600 dark:text-amber-400',
  normal: 'text-zinc-400 dark:text-zinc-500',
  low: 'text-zinc-300 dark:text-zinc-600',
}


const KIND_CHIP: Record<string, string> = {
  zinc: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  pink: 'bg-pink-100 text-pink-700 dark:bg-pink-950/50 dark:text-pink-400',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-400',
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-400',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400',
}

/** Card face per work kind — a coloured edge and a faint wash, so a column
 *  full of mixed work reads at a glance instead of as plain white cards. */
const KIND_CARD: Record<string, string> = {
  zinc: '',
  pink: 'border-l-2 border-l-pink-400 bg-pink-50/40 dark:bg-pink-950/20',
  sky: 'border-l-2 border-l-sky-400 bg-sky-50/40 dark:bg-sky-950/20',
  indigo: 'border-l-2 border-l-indigo-400 bg-indigo-50/40 dark:bg-indigo-950/20',
  violet: 'border-l-2 border-l-violet-400 bg-violet-50/40 dark:bg-violet-950/20',
  emerald: 'border-l-2 border-l-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20',
  amber: 'border-l-2 border-l-amber-400 bg-amber-50/40 dark:bg-amber-950/20',
  rose: 'border-l-2 border-l-rose-400 bg-rose-50/40 dark:bg-rose-950/20',
}

export default function ProductionPage() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [clients, setClients] = useState<ClientRow[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [batchFilter, setBatchFilter] = useState<string>('all')
  const [needsSchema, setNeedsSchema] = useState(false)

  const [newOpen, setNewOpen] = useState(false)
  const [preset, setPreset] = useState<{ client_id?: string; batch_id?: string } | undefined>()

  const { can } = useRole()
  const isManager = can('account_manager')

  const [strip, setStrip] = useState<{ type: string; label: string; quota: number; planned: number; delivered: number }[] | null>(null)
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
      toast.error(e instanceof Error ? e.message : 'Failed to load production board')
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

  const visible = (items ?? [])
    .filter(i => clientFilter === 'all' || i.client_id === clientFilter)
    .filter(i => batchFilter === 'all' || i.batch_id === batchFilter)

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Production</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Every piece of work, from shoot brief to published. Click a card for detail and actions.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ViewSwitch current="board" />
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4" /> New <ChevronDown className="h-3.5 w-3.5 opacity-70" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => setNewOpen(true)}>
                <Plus className="h-4 w-4" /> Content item
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/dashboard/production/shoots"><CalendarDays className="h-4 w-4" /> Plan a shoot</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* shoots exist as first-class things, not just a dropdown inside the
          create dialog — a new batch appears here immediately, and clicking
          one narrows the board to that shoot's items */}
      {batches.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
            Shoots
          </span>
          <button type="button" onClick={() => setBatchFilter('all')}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              batchFilter === 'all'
                ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                : 'border-zinc-200 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}>
            All
          </button>
          {batches
            .filter(b => (b.status ?? 'shot') !== 'brief')
            .filter(b => clientFilter === 'all' || b.client_id === clientFilter)
            .map(b => {
              const count = b.content_items?.[0]?.count ?? 0
              return (
                <button key={b.id} type="button"
                  onClick={() => setBatchFilter(f => (f === b.id ? 'all' : b.id))}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    batchFilter === b.id
                      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-200 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
                  }`}>
                  {(b.status === 'locked' || b.status === 'shot') && (
                    <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${b.status === 'locked' ? 'bg-sky-500' : 'bg-violet-500'}`} />
                  )}
                  {b.title}
                  {b.clients?.name && <span className="opacity-60"> · {b.clients.name}</span>}
                  <span className="ml-1 font-mono tabular-nums opacity-60">{count}</span>
                </button>
              )
            })}
        </div>
      )}

      {strip && strip.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
            {new Date().toLocaleDateString('en-AU', { month: 'long' })}
          </span>
          {strip.map(r => (
            <span key={r.type}
              title={`${r.delivered} delivered · ${r.planned - r.delivered > 0 ? `${r.planned - r.delivered} in production · ` : ''}${Math.max(0, r.quota - r.planned)} remaining`}
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

      {items === null ? (
        <div className="flex gap-3 overflow-x-hidden">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-72 min-w-44 flex-1" />)}
        </div>
      ) : (
        <div className="w-full overflow-x-auto">
          <div className="flex gap-3 pb-3">
            {COLUMNS.map(col => {
              const colItems = visible.filter(i => col.statuses.includes(i.status))
              // a booked shoot brief reuses 'scheduled' (same pipeline, different
              // meaning) — the lane header must not read as "scheduled to post"
              // when it's actually holding a booked shoot
              // 'approved' is likewise approved_for_scheduling under the hood —
              // for a brief that means "the plan is signed off, book the date",
              // never "a scheduler has it"
              const briefsHere = colItems.some(i => i.work_kinds?.slug === 'shoot_brief')
              const hasBrief = col.key === 'scheduled' && briefsHere
              const briefApproved = col.key === 'approved' && briefsHere
              return (
                <div key={col.key} className="min-w-44 flex-1">
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <span className={`h-2 w-2 rounded-full ${col.tint}`} />
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {hasBrief ? 'Scheduled · Shoot booked'
                        : briefApproved ? 'Approved · Ready to book'
                        : col.title}
                    </span>
                    <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{colItems.length}</span>
                  </div>
                  <div className="flex min-h-24 flex-col gap-2">
                    {colItems.map(item => (
                      <Link key={item.id} href={`/dashboard/production/${item.id}`} className="block"
                        onClick={e => { if (selectMode) { e.preventDefault(); toggleSelected(item.id) } }}>
                        <Card className={`cursor-pointer py-0 transition-shadow hover:shadow-md ${
                          item.work_kinds?.slug === 'shoot_brief'
                            ? 'border-l-2 border-l-sky-400 bg-sky-50/40 dark:bg-sky-950/20'
                            : KIND_CARD[item.work_kinds?.color ?? 'zinc'] ?? ''
                        } ${selectMode && selectedIds.has(item.id) ? 'ring-2 ring-inset ring-blue-500' : ''}`}>
                          <CardContent className="flex flex-col gap-1.5 p-3">
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
                              {item.work_kinds?.slug !== 'shoot_brief' && (
                                <span className="font-mono text-[11px] uppercase text-zinc-400 dark:text-zinc-500">{item.content_type}</span>
                              )}
                              {item.work_kinds?.slug === 'shoot_brief' && item.status === 'scheduled' && (
                                <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950/50 dark:text-sky-400">
                                  Shoot booked
                                </span>
                              )}
                              {item.work_kinds?.slug === 'shoot_brief' && (item.batches?.planned_deliverables?.length ?? 0) > 0 && (
                                <span className="font-mono text-[10.5px] text-zinc-400 dark:text-zinc-500">
                                  {item.batches!.planned_deliverables!.slice(0, 3).map(d => `${d.qty} ${d.type}${d.qty > 1 ? 's' : ''}`).join(' · ')}
                                  {item.batches!.planned_deliverables!.length > 3 ? ` +${item.batches!.planned_deliverables!.length - 3}` : ''}
                                </span>
                              )}
                              {item.work_kinds && item.work_kinds.slug !== 'edit' && (
                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${KIND_CHIP[item.work_kinds.color] ?? KIND_CHIP.zinc}`}>
                                  {item.work_kinds.name}
                                </span>
                              )}
                              {item.current_version_number > 0 && (
                                <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">v{item.current_version_number}</span>
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
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                    {colItems.length === 0 && (
                      <div className="rounded-lg border border-dashed border-zinc-200 py-6 text-center text-xs text-zinc-300 dark:border-zinc-800 dark:text-zinc-600">
                        Empty
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
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
