'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Plus, CalendarDays, Flag } from 'lucide-react'
import type { ItemStatus } from '../../lib/workflow-core'

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
  batches: { title: string } | null
}
type ClientRow = { id: string; name: string }
type Batch = { id: string; title: string; client_id: string }

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

const CONTENT_TYPES = ['reel', 'carousel', 'story', 'static', 'video', 'other']

export default function ProductionPage() {
  const [items, setItems] = useState<Item[] | null>(null)
  const [clients, setClients] = useState<ClientRow[]>([])
  const [batches, setBatches] = useState<Batch[]>([])
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [needsSchema, setNeedsSchema] = useState(false)

  const [newOpen, setNewOpen] = useState(false)
  const [newBusy, setNewBusy] = useState(false)
  const [draft, setDraft] = useState({
    client_id: '', batch_id: '', title: '', content_type: 'reel', priority: 'normal', due_date: '', count: 1,
  })

  const [batchOpen, setBatchOpen] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchDraft, setBatchDraft] = useState({ client_id: '', title: '', shoot_date: '' })

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

  const visible = (items ?? []).filter(i => clientFilter === 'all' || i.client_id === clientFilter)

  const createItems = async () => {
    if (!draft.client_id || !draft.title.trim()) return toast.error('Client and title are required')
    setNewBusy(true)
    try {
      const count = Math.min(Math.max(1, draft.count), 30)
      const payload = Array.from({ length: count }, (_, i) => ({
        client_id: draft.client_id,
        batch_id: draft.batch_id || null,
        title: count === 1 ? draft.title.trim() : `${draft.title.trim()} ${String(i + 1).padStart(2, '0')}`,
        content_type: draft.content_type,
        priority: draft.priority,
        due_date: draft.due_date || null,
      }))
      const res = await fetch('/api/production/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Create failed')
      toast.success(count === 1 ? 'Item created' : `${count} items created`)
      setNewOpen(false)
      setDraft({ client_id: '', batch_id: '', title: '', content_type: 'reel', priority: 'normal', due_date: '', count: 1 })
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setNewBusy(false)
    }
  }

  const createBatch = async () => {
    if (!batchDraft.client_id || !batchDraft.title.trim()) return toast.error('Client and title are required')
    setBatchBusy(true)
    try {
      const res = await fetch('/api/production/batches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: batchDraft.client_id,
          title: batchDraft.title.trim(),
          shoot_date: batchDraft.shoot_date || null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Create failed')
      toast.success('Batch created')
      setBatchOpen(false)
      setBatchDraft({ client_id: '', title: '', shoot_date: '' })
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBatchBusy(false)
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
            Every content item, from first draft to published. Click a card for detail, versions, and actions.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Select value={clientFilter} onValueChange={v => v && setClientFilter(v)}>
            <SelectTrigger className="w-44 bg-white dark:bg-zinc-900"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All clients</SelectItem>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setBatchOpen(true)}>
            <Plus className="h-4 w-4" /> Batch
          </Button>
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" /> New item
          </Button>
        </div>
      </div>

      {items === null ? (
        <div className="flex gap-3 overflow-x-hidden">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-72 w-64 shrink-0" />)}
        </div>
      ) : (
        <ScrollArea className="w-full">
          <div className="flex gap-3 pb-3">
            {COLUMNS.map(col => {
              const colItems = visible.filter(i => col.statuses.includes(i.status))
              return (
                <div key={col.key} className="w-64 shrink-0">
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <span className={`h-2 w-2 rounded-full ${col.tint}`} />
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{col.title}</span>
                    <span className="ml-auto font-mono text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">{colItems.length}</span>
                  </div>
                  <div className="flex min-h-24 flex-col gap-2">
                    {colItems.map(item => (
                      <Link key={item.id} href={`/dashboard/production/${item.id}`} className="block">
                        <Card className="cursor-pointer py-0 transition-shadow hover:shadow-md">
                          <CardContent className="flex flex-col gap-1.5 p-3">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm font-medium leading-snug">{item.title}</span>
                              <Flag className={`mt-0.5 h-3 w-3 shrink-0 ${PRIORITY_TINT[item.priority] ?? ''}`} />
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant="outline" className="font-normal text-zinc-600 dark:text-zinc-400">
                                {item.clients?.name ?? '—'}
                              </Badge>
                              <span className="font-mono text-[10px] uppercase text-zinc-400 dark:text-zinc-500">{item.content_type}</span>
                              {item.current_version_number > 0 && (
                                <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">v{item.current_version_number}</span>
                              )}
                            </div>
                            {(item.due_date || item.status === 'revision_required' || item.status === 'client_changes_requested') && (
                              <div className="flex items-center gap-2">
                                {item.due_date && (
                                  <span className="flex items-center gap-1 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
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
        </ScrollArea>
      )}

      {/* New item dialog */}
      <Dialog open={newOpen} onOpenChange={o => !newBusy && setNewOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>New content item{draft.count > 1 ? 's' : ''}</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Client *</Label>
              <Select value={draft.client_id} onValueChange={v => v && setDraft(d => ({ ...d, client_id: v, batch_id: '' }))}>
                <SelectTrigger><SelectValue placeholder="Choose client" /></SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Batch (optional)</Label>
              <Select value={draft.batch_id || 'none'} onValueChange={v => setDraft(d => ({ ...d, batch_id: v === 'none' ? '' : v ?? '' }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No batch</SelectItem>
                  {batches.filter(b => !draft.client_id || b.client_id === draft.client_id).map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Title * {draft.count > 1 && <span className="text-xs text-zinc-400">(numbered automatically)</span>}</Label>
              <Input value={draft.title} placeholder="e.g. May shoot — BTS reel" onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select value={draft.content_type} onValueChange={v => v && setDraft(d => ({ ...d, content_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTENT_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Priority</Label>
              <Select value={draft.priority} onValueChange={v => v && setDraft(d => ({ ...d, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['low', 'normal', 'high', 'urgent'].map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Due date</Label>
              <Input type="date" value={draft.due_date} onChange={e => setDraft(d => ({ ...d, due_date: e.target.value }))} className="font-mono" />
            </div>
            <div className="grid gap-1.5">
              <Label>How many?</Label>
              <Input type="number" min={1} max={30} value={draft.count}
                onChange={e => setDraft(d => ({ ...d, count: Number(e.target.value) || 1 }))} className="font-mono" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)} disabled={newBusy}>Cancel</Button>
            <Button onClick={createItems} disabled={newBusy}>{newBusy ? 'Creating…' : `Create ${draft.count > 1 ? draft.count + ' items' : 'item'}`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New batch dialog */}
      <Dialog open={batchOpen} onOpenChange={o => !batchBusy && setBatchOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>New batch (shoot)</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Client *</Label>
              <Select value={batchDraft.client_id} onValueChange={v => v && setBatchDraft(d => ({ ...d, client_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Choose client" /></SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Title *</Label>
              <Input value={batchDraft.title} placeholder="e.g. May studio shoot" onChange={e => setBatchDraft(d => ({ ...d, title: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Shoot date</Label>
              <Input type="date" value={batchDraft.shoot_date} onChange={e => setBatchDraft(d => ({ ...d, shoot_date: e.target.value }))} className="font-mono" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchOpen(false)} disabled={batchBusy}>Cancel</Button>
            <Button onClick={createBatch} disabled={batchBusy}>{batchBusy ? 'Creating…' : 'Create batch'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
