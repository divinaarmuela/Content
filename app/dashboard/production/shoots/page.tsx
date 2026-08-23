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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Camera, Plus, Search, Trash2 } from 'lucide-react'
import { useProductionLive } from '../useProductionLive'
import { ViewSwitch } from '../shoot-ui'
import type { BatchStatus } from '../../../lib/batch-brief-core'

type Shoot = {
  id: string
  title: string
  status: BatchStatus
  client_id: string
  shoot_date: string | null
  shot_list?: { done?: boolean }[] | null
  planned_deliverables?: { qty: number }[] | null
  clients: { name: string } | null
  content_items?: { count: number }[]
}
type ClientRow = { id: string; name: string }

const STATUS_STYLE: Record<BatchStatus, string> = {
  brief: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400',
  locked: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-400',
  shot: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-400',
  wrapped: 'border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400',
}
const STATUS_LABEL: Record<BatchStatus, string> = {
  brief: 'In planning', locked: 'Date locked', shot: 'Shot', wrapped: 'Wrapped',
}
const SECTIONS: { status: BatchStatus; title: string }[] = [
  { status: 'brief', title: 'IN PLANNING' },
  { status: 'locked', title: 'DATE LOCKED' },
  { status: 'shot', title: 'SHOT' },
  { status: 'wrapped', title: 'WRAPPED' },
]

function whenShort(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
}

/**
 * The pre-production view: every shoot from first idea to wrapped, sectioned
 * by where it stands. A shoot is planned here BEFORE items exist — the board
 * shows the aftermath; this shows the plan.
 */
export default function ShootsPage() {
  const router = useRouter()
  const [shoots, setShoots] = useState<Shoot[] | null>(null)
  const [clients, setClients] = useState<ClientRow[]>([])
  const [clientFilter, setClientFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<string>('')
  const [needsSchema, setNeedsSchema] = useState(false)

  const [newOpen, setNewOpen] = useState(false)
  const [newBusy, setNewBusy] = useState(false)
  const [draft, setDraft] = useState({ client_id: '', title: '' })

  const load = useCallback(async () => {
    try {
      const [bRes, cRes, meRes] = await Promise.all([
        fetch('/api/production/batches'),
        fetch('/api/website/clients'),
        fetch('/api/overview'),
      ])
      if (bRes.ok) {
        const rows: Shoot[] = await bRes.json()
        // schema not migrated yet → rows have no status; show the setup card
        setNeedsSchema(rows.length > 0 && rows.every(r => !r.status))
        setShoots(rows)
      } else setShoots([])
      if (cRes.ok) setClients(((await cRes.json()) as ClientRow[]).filter(Boolean))
      if (meRes.ok) setRole(((await meRes.json()) as { role?: string }).role ?? '')
    } catch {
      toast.error('Could not load shoots')
      setShoots([])
    }
  }, [])
  useEffect(() => { void load() }, [load])
  useProductionLive(useCallback(() => { void load() }, [load]))

  const canPlan = ['editor', 'account_manager', 'super_admin'].includes(role)
  const isManager = ['account_manager', 'super_admin'].includes(role)
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

  const visible = (shoots ?? [])
    .filter(s => clientFilter === 'all' || s.client_id === clientFilter)
    .filter(s => !search || s.title.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Shoots</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Plan the shoot, lock the date, then production begins. Content items
            live on the board; the plan lives here.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ViewSwitch current="shoots" />
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
          {canPlan && (
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" /> Plan shoot
            </Button>
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

      {shoots === null ? (
        <div className="grid gap-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-24" />)}</div>
      ) : visible.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <Camera className="h-5 w-5 text-zinc-500 dark:text-zinc-400" />
            </div>
            <p className="text-sm font-medium">No shoots planned</p>
            <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              Plan a shoot to brief the team before production starts.
            </p>
            {canPlan && <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> Plan shoot</Button>}
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
                  return (
                    <div key={s.id} className="group/shoot relative">
                    <Link href={`/dashboard/production/shoots/${s.id}`}>
                      <Card className="py-0 transition-shadow hover:shadow-md">
                        <CardContent className="flex flex-col gap-1.5 p-3">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold">{s.title}</span>
                            <Badge variant="outline" className={`ml-auto shrink-0 font-normal ${STATUS_STYLE[s.status ?? 'shot']}`}>
                              {STATUS_LABEL[s.status ?? 'shot']}
                            </Badge>
                          </div>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {s.clients?.name ?? 'Unassigned'} ·{' '}
                            {whenShort(s.shoot_date) ?? <span className="italic text-zinc-400">No date yet</span>}
                          </p>
                          {meta && (
                            <p className="font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">{meta}</p>
                          )}
                        </CardContent>
                      </Card>
                    </Link>
                    {canDelete && (
                      <button
                        type="button"
                        aria-label="Delete shoot"
                        onClick={e => { e.preventDefault(); e.stopPropagation(); setToDelete(s) }}
                        className="absolute right-2 top-2 hidden rounded-md p-1.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-600 group-hover/shoot:block dark:hover:bg-rose-950/40"
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
