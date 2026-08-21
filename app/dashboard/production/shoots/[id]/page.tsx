'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  ArrowLeft, Camera, Check, ImagePlus, Link2, Lock, MapPin, Plus, Trash2, X,
} from 'lucide-react'
import { useProductionLive } from '../../useProductionLive'
import { uploadMedia } from '../../../uploadMedia'
import { BATCH_STATUS_LABEL, BATCH_STATUS_STYLE } from '../../shoot-ui'
import {
  availableBatchTransitions, type BatchStatus, type ReferenceMedia, type ShotRow,
} from '../../../../lib/batch-brief-core'
import { TYPE_LABELS, type ContentType } from '../../../../lib/agreement-core'

type Batch = {
  id: string; client_id: string; title: string; status: BatchStatus
  description: string | null; concept: string | null; location: string | null
  shoot_date: string | null; shot_list: ShotRow[]; reference_media: ReferenceMedia[]
  planned_deliverables: { type: string; qty: number }[]
  locked_at: string | null; shot_at: string | null
  month: number | null; year: number | null
  clients: { name: string } | null
}
type ItemLite = { id: string; title: string; status: string }
type Progress = { type: string; label: string; quota: number; planned: number; delivered: number }

const CONTENT_TYPE_OPTIONS = Object.entries(TYPE_LABELS) as [ContentType, string][]

function longDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : null
}
function stamp(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }).toUpperCase() : ''
}

/**
 * The shoot brief — a working surface, not a form. Everything saves on blur;
 * locking the date is the one ceremonial act, because it commits the team
 * and opens the shoot for content items.
 *
 * Known limitation (accepted for v1): concurrent shot-list edits are
 * last-write-wins; the realtime reload keeps the window small.
 */
export default function ShootBriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [batch, setBatch] = useState<Batch | null>(null)
  const [items, setItems] = useState<ItemLite[]>([])
  const [lockedByName, setLockedByName] = useState<string | null>(null)
  const [role, setRole] = useState<string>('')
  const [progress, setProgress] = useState<Progress[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [lockOpen, setLockOpen] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const [dateDraft, setDateDraft] = useState({ shoot_date: '', reason: '' })
  const [deleteOpen, setDeleteOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [linkDraft, setLinkDraft] = useState('')
  const [addingLink, setAddingLink] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/production/batches/${id}`)
    if (!res.ok) {
      toast.error((await res.json()).error ?? 'Could not load the brief')
      router.push('/dashboard/production/shoots')
      return
    }
    const json = await res.json()
    setBatch(json.batch)
    setItems(json.items ?? [])
    setLockedByName(json.locked_by_name ?? null)
    setRole(json.viewer_role ?? '')
    // monthly context for the deliverable captions
    if (json.batch?.client_id) {
      const m = json.batch.month ?? (json.batch.shoot_date ? new Date(json.batch.shoot_date).getUTCMonth() + 1 : null)
      const y = json.batch.year ?? (json.batch.shoot_date ? new Date(json.batch.shoot_date).getUTCFullYear() : null)
      const qs = m && y ? `&month=${m}&year=${y}` : ''
      fetch(`/api/production/deliverables-progress?client_id=${json.batch.client_id}${qs}`)
        .then(r => (r.ok ? r.json() : null))
        .then(p => setProgress(p?.per_type ?? []))
        .catch(() => setProgress([]))
    }
  }, [id, router])
  useEffect(() => { void load() }, [load])
  useProductionLive(useCallback(() => { void load() }, [load]))

  const isManager = ['account_manager', 'super_admin'].includes(role)
  const canEdit = ['editor', 'account_manager', 'super_admin'].includes(role)

  /** Field-level save: send ONLY what changed. */
  const patch = async (field: string, value: unknown, quiet = false) => {
    const res = await fetch(`/api/production/batches/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    if (!res.ok) {
      toast.error((await res.json()).error ?? 'Could not save')
      void load()
      return false
    }
    const json = await res.json()
    setBatch(b => (b ? { ...b, ...json } : b))
    if (!quiet) return true
    return true
  }

  const transition = async (to: BatchStatus, label: string) => {
    if (!batch) return
    setBusy(to)
    try {
      const res = await fetch(`/api/production/batches/${id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `${label} failed`)
      setLockOpen(false)
      toast.success(to === 'locked'
        ? `Shoot locked for ${longDate(json.shoot_date)}. Content items are now open.`
        : `${label} — done`)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${label} failed`)
    } finally {
      setBusy(null)
    }
  }

  const addReferenceFiles = async (files: FileList) => {
    if (!batch) return
    setBusy('refs')
    try {
      const added: ReferenceMedia[] = []
      for (const file of Array.from(files)) {
        const { url } = await uploadMedia(file, { purpose: 'production' })
        added.push({ kind: 'image', url, name: file.name })
      }
      await patch('reference_media', [...(batch.reference_media ?? []), ...added], true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (!batch) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const shots = batch.shot_list ?? []
  const captured = shots.filter(s => s.done).length
  const transitions = availableBatchTransitions(role as never, batch.status)
  const primary = transitions.find(t => t.to === (batch.status === 'brief' ? 'locked' : 'shot'))
  const progressFor = (type: string) => (progress ?? []).find(p => p.type === type)

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <Link href="/dashboard/production/shoots"
        className="inline-flex w-fit items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
        <ArrowLeft className="h-3.5 w-3.5" /> Shoots
      </Link>

      {/* ── header ── */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          key={batch.title}
          defaultValue={batch.title}
          disabled={!canEdit}
          onBlur={e => { const v = e.target.value.trim(); if (v && v !== batch.title) void patch('title', v) }}
          className="min-w-0 flex-1 bg-transparent text-2xl font-semibold tracking-tight outline-none focus:border-b focus:border-zinc-300 disabled:opacity-100 dark:focus:border-zinc-700"
        />
        <Badge variant="outline" className={`font-normal ${BATCH_STATUS_STYLE[batch.status]}`}>
          {BATCH_STATUS_LABEL[batch.status]}
        </Badge>
        {primary && (
          <Button size="sm" disabled={busy !== null}
            onClick={() => primary.to === 'locked' ? setLockOpen(true) : void transition(primary.to, primary.label)}
            title={primary.to === 'locked' && !batch.shoot_date ? 'Set a shoot date first' : undefined}>
            {primary.to === 'locked' && <Lock className="h-3.5 w-3.5" />} {primary.label}
          </Button>
        )}
        {isManager && transitions.some(t => t.to === 'wrapped') && (
          <Button size="sm" variant="outline" disabled={busy !== null}
            onClick={() => void transition('wrapped', 'Wrap shoot')}>Wrap</Button>
        )}
        {isManager && batch.status === 'brief' && items.length === 0 && (
          <Button size="sm" variant="ghost" className="text-red-600 dark:text-red-400"
            onClick={() => setDeleteOpen(true)}><Trash2 className="h-3.5 w-3.5" /></Button>
        )}
      </div>
      <p className="-mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        <Link href="/dashboard/clients" className="underline decoration-dotted">{batch.clients?.name}</Link>
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── working column ── */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Concept & notes</p>
              <textarea
                key={batch.concept ?? ''}
                defaultValue={batch.concept ?? ''}
                disabled={!canEdit}
                rows={5}
                placeholder="What's the idea? Moodboard notes, talent, wardrobe, props, hooks…"
                onBlur={e => { const v = e.target.value; if (v !== (batch.concept ?? '')) void patch('concept', v) }}
                className="w-full resize-y bg-transparent text-sm leading-relaxed outline-none placeholder:text-zinc-400"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-2 p-4">
              <div className="flex items-baseline justify-between">
                <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Shot list</p>
                {batch.status === 'shot' && shots.length > 0 && (
                  <span className="font-mono text-[11px] tabular-nums text-zinc-500">{captured}/{shots.length} captured</span>
                )}
              </div>
              {shots.length === 0 && (
                <p className="text-sm text-zinc-400 dark:text-zinc-500">No shots yet. List what needs to be captured on the day.</p>
              )}
              {shots.map((shot, i) => (
                <div key={shot.id} className="group flex items-center gap-2">
                  <input type="checkbox" checked={shot.done} disabled={!canEdit}
                    onChange={e => void patch('shot_list', shots.map((s, j) => j === i ? { ...s, done: e.target.checked } : s), true)}
                    className="h-4 w-4 shrink-0 accent-blue-600" />
                  <Input key={`${shot.id}:${shot.text}`} defaultValue={shot.text} disabled={!canEdit}
                    className="h-8 border-transparent bg-transparent px-1 text-sm shadow-none hover:border-zinc-200 dark:hover:border-zinc-800"
                    onBlur={e => {
                      const v = e.target.value.trim()
                      if (v !== shot.text) void patch('shot_list', v === '' ? shots.filter((_, j) => j !== i) : shots.map((s, j) => j === i ? { ...s, text: v } : s), true)
                    }} />
                  <Select value={shot.type ?? 'none'}
                    onValueChange={v => void patch('shot_list', shots.map((s, j) => j === i ? { ...s, ...(v === 'none' ? { type: undefined } : { type: v }) } : s), true)}>
                    <SelectTrigger className="h-8 w-28 border-transparent text-xs shadow-none"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Any use</SelectItem>
                      {CONTENT_TYPE_OPTIONS.map(([t, label]) => <SelectItem key={t} value={t}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {canEdit && (
                    <button type="button" className="opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => void patch('shot_list', shots.filter((_, j) => j !== i), true)}>
                      <X className="h-3.5 w-3.5 text-zinc-400 hover:text-red-500" />
                    </button>
                  )}
                </div>
              ))}
              {canEdit && (
                <Button size="sm" variant="ghost" className="w-fit text-zinc-500"
                  onClick={() => void patch('shot_list', [...shots, { id: Math.random().toString(36).slice(2, 10), text: 'New shot', done: false }], true)}>
                  <Plus className="h-3.5 w-3.5" /> Add shot
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">References</p>
              {(batch.reference_media ?? []).length === 0 && (
                <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-400 dark:border-zinc-700"
                  onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="h-5 w-5" />
                  Drop reference images or add links.
                </label>
              )}
              <div className="columns-2 gap-2 sm:columns-3 [&>*]:mb-2">
                {(batch.reference_media ?? []).map((ref, i) => (
                  <div key={ref.url} className="group relative break-inside-avoid overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                    {ref.kind === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ref.url} alt={ref.name ?? 'reference'} className="w-full" />
                    ) : (
                      <a href={ref.url} target="_blank" rel="noreferrer noopener"
                        className="flex items-center gap-2 p-3 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                        <Link2 className="h-4 w-4 shrink-0 text-zinc-400" />
                        <span className="truncate">{ref.name || new URL(ref.url).hostname}</span>
                      </a>
                    )}
                    {canEdit && (
                      <button type="button"
                        className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={() => void patch('reference_media', (batch.reference_media ?? []).filter((_, j) => j !== i), true)}>
                        <X className="h-3 w-3 text-white" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {canEdit && (
                <div className="flex flex-wrap items-center gap-2">
                  <input ref={fileRef} type="file" multiple accept="image/*" className="hidden"
                    onChange={e => e.target.files?.length && void addReferenceFiles(e.target.files)} />
                  <Button size="sm" variant="outline" disabled={busy === 'refs'} onClick={() => fileRef.current?.click()}>
                    <ImagePlus className="h-3.5 w-3.5" /> {busy === 'refs' ? 'Uploading…' : 'Image'}
                  </Button>
                  {addingLink ? (
                    <div className="flex items-center gap-1.5">
                      <Input autoFocus value={linkDraft} placeholder="https://…" className="h-8 w-64 text-xs"
                        onChange={e => setLinkDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && linkDraft.trim().startsWith('https://')) {
                            void patch('reference_media', [...(batch.reference_media ?? []), { kind: 'link', url: linkDraft.trim() }], true)
                            setLinkDraft(''); setAddingLink(false)
                          }
                          if (e.key === 'Escape') setAddingLink(false)
                        }} />
                      <Button size="sm" variant="ghost" onClick={() => setAddingLink(false)}>Cancel</Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setAddingLink(true)}>
                      <Link2 className="h-3.5 w-3.5" /> Link
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── rail ── */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Shoot details</p>
              {batch.status === 'brief' ? (
                <div className="grid gap-1.5">
                  <label className="text-xs text-zinc-500">Shoot date</label>
                  <Input type="date" key={batch.shoot_date ?? ''} defaultValue={batch.shoot_date ?? ''} disabled={!canEdit}
                    className="font-mono text-xs"
                    onBlur={e => { if ((e.target.value || null) !== batch.shoot_date) void patch('shoot_date', e.target.value || null) }} />
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                    <Lock className="h-3.5 w-3.5 text-zinc-400" /> {longDate(batch.shoot_date)}
                  </span>
                  {batch.locked_at && (
                    <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                      Locked by {lockedByName ?? 'the team'} · {stamp(batch.locked_at)}
                    </span>
                  )}
                  {isManager && batch.status !== 'wrapped' && (
                    <button type="button" className="w-fit text-xs text-blue-600 hover:underline dark:text-blue-400"
                      onClick={() => { setDateDraft({ shoot_date: batch.shoot_date ?? '', reason: '' }); setDateOpen(true) }}>
                      Change date
                    </button>
                  )}
                </div>
              )}
              <div className="grid gap-1.5">
                <label className="text-xs text-zinc-500">Location</label>
                <div className="relative">
                  <MapPin className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
                  <Input key={batch.location ?? ''} defaultValue={batch.location ?? ''} disabled={!canEdit}
                    placeholder={'Studio, address, or "TBC"'} className="pl-8 text-sm"
                    onBlur={e => { if (e.target.value !== (batch.location ?? '')) void patch('location', e.target.value, true) }} />
                </div>
              </div>
              {batch.month && batch.year && (
                <p className="font-mono text-[11px] text-zinc-400">
                  Counts toward {new Date(batch.year, batch.month - 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-2 p-4">
              <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Planned deliverables</p>
              {(batch.planned_deliverables ?? []).map((d, i) => {
                const prog = progressFor(d.type)
                const over = prog && prog.planned + d.qty > prog.quota && prog.quota > 0
                return (
                  <div key={`${d.type}-${i}`} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <Select value={d.type} onValueChange={v => v && void patch('planned_deliverables',
                        (batch.planned_deliverables ?? []).map((x, j) => j === i ? { ...x, type: v } : x), true)}>
                        <SelectTrigger className="h-8 flex-1 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CONTENT_TYPE_OPTIONS.map(([t, label]) => <SelectItem key={t} value={t}>{label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input type="number" min={1} key={`${d.type}:${d.qty}`} defaultValue={d.qty} disabled={!canEdit}
                        className="h-8 w-16 text-center font-mono text-sm tabular-nums"
                        onBlur={e => {
                          const qty = Math.max(1, Number(e.target.value) || 1)
                          if (qty !== d.qty) void patch('planned_deliverables',
                            (batch.planned_deliverables ?? []).map((x, j) => j === i ? { ...x, qty } : x), true)
                        }} />
                      {canEdit && (
                        <button type="button" onClick={() => void patch('planned_deliverables',
                          (batch.planned_deliverables ?? []).filter((_, j) => j !== i), true)}>
                          <X className="h-3.5 w-3.5 text-zinc-400 hover:text-red-500" />
                        </button>
                      )}
                    </div>
                    {prog && prog.quota > 0 && (
                      <p className={`font-mono text-[10.5px] ${over ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-400'}`}>
                        {over
                          ? `Exceeds the monthly agreement by ${prog.planned + d.qty - prog.quota}`
                          : `Covers ${Math.min(d.qty, prog.quota)} of ${prog.quota} ${prog.label}`}
                      </p>
                    )}
                  </div>
                )
              })}
              {progress !== null && progress.length === 0 && (
                <p className="text-xs text-zinc-400">
                  {isManager
                    ? <Link href={`/dashboard/clients/${batch.client_id}/agreement`} className="underline decoration-dotted">No agreement on file — set one up</Link>
                    : 'No agreement on file'}
                </p>
              )}
              {canEdit && (
                <Button size="sm" variant="ghost" className="w-fit text-zinc-500"
                  onClick={() => void patch('planned_deliverables', [...(batch.planned_deliverables ?? []), { type: 'reel', qty: 1 }], true)}>
                  <Plus className="h-3.5 w-3.5" /> Add deliverable
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-2 p-4">
              <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Production</p>
              {batch.status === 'brief' ? (
                <p className="text-sm text-zinc-400 dark:text-zinc-500">
                  Lock the shoot date to start creating content items.
                </p>
              ) : (
                <>
                  <p className="text-sm">
                    <span className="font-mono tabular-nums">{items.length}</span> item{items.length === 1 ? '' : 's'} in production
                  </p>
                  {items.slice(0, 5).map(it => (
                    <Link key={it.id} href={`/dashboard/production/${it.id}`}
                      className="flex items-center gap-2 text-sm hover:underline">
                      <Check className={`h-3.5 w-3.5 ${['published', 'scheduled'].includes(it.status) ? 'text-emerald-500' : 'text-zinc-300 dark:text-zinc-600'}`} />
                      <span className="truncate">{it.title}</span>
                    </Link>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" asChild>
                      <Link href="/dashboard/production">View on board</Link>
                    </Button>
                    {canEdit && role !== 'scheduler' && (
                      <Button size="sm" asChild>
                        <Link href={`/dashboard/production?new_for_batch=${batch.id}&client=${batch.client_id}`}>
                          <Camera className="h-3.5 w-3.5" /> Create items
                        </Link>
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── the lock ceremony ── */}
      <AlertDialog open={lockOpen} onOpenChange={o => busy === null && setLockOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lock this shoot date?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-3">
                <span className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  {longDate(batch.shoot_date) ?? 'No date set'}
                </span>
                <span>{batch.clients?.name}{batch.location ? ` · ${batch.location}` : ''}</span>
                <span>
                  Locking commits the team to this date and opens the shoot for
                  content items. Changing a locked date requires an account manager.
                </span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy !== null || !batch.shoot_date}
              onClick={e => { e.preventDefault(); void transition('locked', 'Lock shoot date') }}>
              {busy === 'locked' ? 'Locking…' : 'Lock date'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── AM changes a locked date, with a reason ── */}
      <AlertDialog open={dateOpen} onOpenChange={o => busy === null && setDateOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change a locked date?</AlertDialogTitle>
            <AlertDialogDescription>
              The team committed to {longDate(batch.shoot_date)}. Say why it&rsquo;s moving — the change is logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3">
            <Input type="date" value={dateDraft.shoot_date} className="font-mono text-xs"
              onChange={e => setDateDraft(d => ({ ...d, shoot_date: e.target.value }))} />
            <Input value={dateDraft.reason} placeholder="Why is the date moving?"
              onChange={e => setDateDraft(d => ({ ...d, reason: e.target.value }))} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null || !dateDraft.shoot_date || !dateDraft.reason.trim()}
              onClick={async e => {
                e.preventDefault()
                setBusy('date')
                const res = await fetch(`/api/production/batches/${id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'change_date', ...dateDraft }),
                })
                setBusy(null)
                if (!res.ok) { toast.error((await res.json()).error ?? 'Could not change the date'); return }
                setDateOpen(false)
                toast.success(`Date moved to ${longDate(dateDraft.shoot_date)}`)
                void load()
              }}>
              {busy === 'date' ? 'Saving…' : 'Move the date'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── delete an unlocked, empty brief ── */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{batch.title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              The brief, its shot list, and its references go. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700"
              onClick={async e => {
                e.preventDefault()
                const res = await fetch(`/api/production/batches/${id}`, { method: 'DELETE' })
                if (!res.ok) { toast.error((await res.json()).error ?? 'Could not delete'); return }
                toast.success('Brief deleted')
                router.push('/dashboard/production/shoots')
              }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
