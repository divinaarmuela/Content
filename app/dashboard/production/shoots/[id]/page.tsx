'use client'

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  ArrowLeft, Camera, Check, Link as LinkIcon, Lock, Plus, Trash2, X, FileDown,
} from 'lucide-react'
import { useProductionLive } from '../../useProductionLive'
import { BATCH_STATUS_LABEL, BATCH_STATUS_STYLE } from '../../shoot-ui'
import BriefCanvas, { type CanvasOp } from './BriefCanvas'
import BriefComments from './BriefComments'
import LocationSearch from './LocationSearch'
import {
  availableBatchTransitions, sanitiseCanvasCards,
  type BatchStatus, type CanvasCard, type ReferenceMedia, type ShotRow,
} from '../../../../lib/batch-brief-core'
import { TYPE_LABELS, type ContentType } from '../../../../lib/agreement-core'

type Batch = {
  id: string; client_id: string; title: string; status: BatchStatus
  description: string | null; concept: string | null; location: string | null
  shoot_date: string | null; shot_list: ShotRow[]; reference_media: ReferenceMedia[]
  canvas_cards?: CanvasCard[]
  planned_deliverables: { type: string; qty: number }[]
  locked_at: string | null; shot_at: string | null
  shared_with_client?: boolean
  share_board?: boolean | null
  board_name?: string | null
  month: number | null; year: number | null
  clients: { name: string } | null
}
type ItemLite = { id: string; title: string; status: string; work_kinds?: { slug?: string } | null }
type Progress = { type: string; label: string; quota: number; planned: number; delivered: number }

const CONTENT_TYPE_OPTIONS = Object.entries(TYPE_LABELS) as [ContentType, string][]

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 45) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

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
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [lastEdited, setLastEdited] = useState<{ name: string | null; at: string | null }>({ name: null, at: null })
  const [role, setRole] = useState<string>('')
  const [progress, setProgress] = useState<Progress[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [lockOpen, setLockOpen] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const [dateDraft, setDateDraft] = useState({ shoot_date: '', reason: '' })
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [portalToken, setPortalToken] = useState<string | null>(null)

  /** Stamped so a slow answer from an older request cannot overwrite a newer
   *  one — the poll, the realtime hint and every save all call this. */
  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    const res = await fetch(`/api/production/batches/${id}`, { cache: 'no-store' })
    if (!res.ok) {
      if (seq !== loadSeq.current) return
      toast.error((await res.json()).error ?? 'Could not load the brief')
      router.push('/dashboard/production')
      return
    }
    const json = await res.json()
    if (seq !== loadSeq.current) return
    setBatch(json.batch)
    setItems(json.items ?? [])
    setLockedByName(json.locked_by_name ?? null)
    setLastEdited({ name: json.last_edited_by_name ?? null, at: json.last_edited_at ?? null })
    setRole(json.viewer_role ?? '')
    setPortalToken(json.portal_token ?? null)
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

  // stable identities for the canvas props — and ABOVE the early return:
  // hooks below a conditional return crash React with a hook-order error
  const canvasCards = useMemo(() => sanitiseCanvasCards(batch?.canvas_cards), [batch?.canvas_cards])
  const canvasRefs = useMemo(() => batch?.reference_media ?? [], [batch?.reference_media])

  const isManager = ['account_manager', 'super_admin'].includes(role)
  const canEdit = ['editor', 'account_manager', 'super_admin'].includes(role)

  /**
   * Field-level save: send ONLY what changed.
   *
   * `pending` counts saves still in the air. THE FIRST-CLICK BUG lived here:
   * the shoot date is an uncontrolled input saved on blur, and the Lock
   * confirm was `disabled={… || !batch.shoot_date}`. Type a date, click
   * "Lock shoot date", click "Lock date" — and the blur's PATCH had not
   * answered yet, so `batch.shoot_date` was still null, so the confirm was
   * disabled, so the click hit a disabled button and vanished without a
   * toast. A second click, after the PATCH landed, worked. Nothing else on
   * screen ever said why.
   */
  const pending = useRef(0)
  // the freshest batch, readable from inside an async click handler — the
  // `batch` a closure captured is the one from the render it was created in
  const batchRef = useRef<Batch | null>(null)
  useEffect(() => { batchRef.current = batch }, [batch])
  const patch = async (field: string, value: unknown, quiet = false) => {
    pending.current += 1
    setSaveState('saving')
    const res = await fetch(`/api/production/batches/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    pending.current = Math.max(0, pending.current - 1)
    if (!res.ok) {
      setSaveState('idle')
      toast.error((await res.json()).error ?? 'Could not save')
      void load()
      return false
    }
    const json = await res.json()
    setBatch(b => (b ? { ...b, ...json } : b))
    setLastEdited({ name: 'you', at: new Date().toISOString() })
    setSaveState('saved')
    window.setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 2000)
    void quiet
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



  if (!batch) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const briefTask = items.find(i => i.work_kinds?.slug === 'shoot_brief') ?? null
  // "Book the shoot" moves the BRIEF to scheduled; the batch keeps its own
  // status. Without reading it back here the shoot never said it was booked.
  const booked = briefTask?.status === 'scheduled' || briefTask?.status === 'published'
  /** what this shoot actually PRODUCED — its own brief is not a deliverable */
  const deliverableItems = items.filter(i => i.work_kinds?.slug !== 'shoot_brief')
  const shots = batch.shot_list ?? []
  const captured = shots.filter(s => s.done).length
  const transitions = availableBatchTransitions(role as never, batch.status)
  const primary = transitions.find(t => t.to === (batch.status === 'brief' ? 'locked' : 'shot'))
  const progressFor = (type: string) => (progress ?? []).find(p => p.type === type)

  return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard/production"
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
        {/* the brief said "Shoot booked" while the shoot itself said nothing —
            one job, two pages, and they have to agree */}
        {booked && (
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
            Booked
          </Badge>
        )}
        {primary && (
          <Button size="sm" disabled={busy !== null}
            onClick={() => primary.to === 'locked' ? setLockOpen(true) : void transition(primary.to, primary.label)}
            title={primary.to === 'locked' && !batch.shoot_date ? 'Set a shoot date first' : undefined}>
            {primary.to === 'locked' && <Lock className="h-3.5 w-3.5" />} {primary.label}
          </Button>
        )}
        {/* "Wrap" was unpredictable from the label — say what it does */}
        {isManager && transitions.some(t => t.to === 'wrapped') && (
          <Button size="sm" variant="outline" disabled={busy !== null}
            title="Everything from this shoot is delivered. It moves to WRAPPED and stops appearing as live work."
            onClick={() => void transition('wrapped', 'Close this shoot')}>Close this shoot</Button>
        )}
        {isManager && items.length === 0 && (
          <Button size="sm" variant="outline" className="text-red-600 dark:text-red-400"
            onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete shoot
          </Button>
        )}
      </div>
      <p className="-mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-zinc-500 dark:text-zinc-400">
        <Link href="/dashboard/clients" className="underline decoration-dotted">{batch.clients?.name}</Link>
        {canEdit && (
          <span className="font-mono text-[11px] uppercase tracking-wider">
            {saveState === 'saving' ? <span className="text-zinc-400">· Saving…</span>
              : saveState === 'saved' ? <span className="text-emerald-600 dark:text-emerald-400">· Saved ✓</span>
              : <span className="text-zinc-400">· Autosaves</span>}
          </span>
        )}
        {lastEdited.name && lastEdited.at && (
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            · Last edited by {lastEdited.name} {timeAgo(lastEdited.at)}
          </span>
        )}
      </p>

      {/* stays until the shoot HAS a brief. Gating it on 'brief' meant that
          locking the date removed the only way to raise one, and the New ▾
          menu then built a second shoot instead of joining this one. */}
      {isManager && batch.status !== 'wrapped' && !briefTask && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 dark:border-sky-900 dark:bg-sky-950/40">
          <p className="text-sm text-sky-900 dark:text-sky-200">
            This shoot isn&rsquo;t on the pipeline yet — a brief task puts it through
            review and books the date.
          </p>
          <Button size="sm" className="ml-auto" disabled={busy !== null}
            onClick={async () => {
              setBusy('brief-task')
              try {
                const kindsRes = await fetch('/api/production/work-kinds?active=1')
                const kinds = kindsRes.ok ? (await kindsRes.json()).kinds ?? [] : []
                const briefKind = kinds.find((k: { slug: string }) => k.slug === 'shoot_brief')
                if (!briefKind) throw new Error('The Shoot brief work type is missing')
                const res = await fetch('/api/production/items', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ items: [{
                    client_id: batch.client_id,
                    batch_id: batch.id,
                    title: batch.title,
                    work_kind_id: briefKind.id,
                  }] }),
                })
                const json = await res.json()
                if (!res.ok) throw new Error(json.error ?? 'Could not create the brief task')
                toast.success("Brief task created — it's on Production, under Briefs in flight")
                void load()
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Could not create the brief task')
              } finally {
                setBusy(null)
              }
            }}>
            {busy === 'brief-task' ? 'Creating…' : 'Create brief task'}
          </Button>
        </div>
      )}
      {briefTask && (
        <Link href={`/dashboard/production/${briefTask.id}`}
          className="w-fit font-mono text-[11px] uppercase tracking-wider text-sky-600 underline decoration-dotted dark:text-sky-400">
          Open the brief task →
        </Link>
      )}

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
                  {/* the picker's field order follows the BROWSER's locale,
                      which is not ours to set — so echo it back in words */}
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    {batch.shoot_date ? longDate(batch.shoot_date) : 'The date is read back here in words once set.'}
                  </p>
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
                <LocationSearch
                  value={batch.location ?? ''}
                  disabled={!canEdit}
                  onSave={v => void patch('location', v, true)}
                />
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
                  {/* the BRIEF task rides this shoot too, and it is paperwork,
                      not a deliverable — counting it told an account manager
                      there was a piece of content when there was none */}
                  <p className="text-sm">
                    <span className="font-mono tabular-nums">{deliverableItems.length}</span> item{deliverableItems.length === 1 ? '' : 's'} in production
                    {deliverableItems.length === 0 && (
                      <span className="text-zinc-400 dark:text-zinc-500"> — nothing made from this shoot yet</span>
                    )}
                  </p>
                  {deliverableItems.slice(0, 5).map(it => (
                    <Link key={it.id} href={`/dashboard/production/${it.id}`}
                      className="flex items-center gap-2 text-sm hover:underline">
                      <Check className={`h-3.5 w-3.5 ${['published', 'scheduled'].includes(it.status) ? 'text-emerald-500' : 'text-zinc-300 dark:text-zinc-600'}`} />
                      <span className="truncate">{it.title}</span>
                    </Link>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" asChild>
                      <Link href="/dashboard/editor">View on Editor</Link>
                    </Button>
                    {canEdit && role !== 'scheduler' && (
                      <Button size="sm" asChild>
                        <Link href={`/dashboard/editor?new_for_batch=${batch.id}&client=${batch.client_id}`}>
                          <Camera className="h-3.5 w-3.5" /> Create items
                        </Link>
                      </Button>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Client portal</p>
              {isManager ? (
                <>
                  <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <Switch
                      checked={batch.shared_with_client ?? false}
                      onCheckedChange={async v => {
                        const ok = await patch('shared_with_client', v)
                        if (ok) toast.success(v ? 'Shoot plan is now on the client portal' : 'Hidden from the client portal')
                      }}
                    />
                    Visible on the client portal
                    <span className="block text-[11px] text-zinc-400">Turns on by itself when you share the plan for approval. This only shows it — it asks the client for nothing.</span>
                  </label>
                  <label className={`flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 ${batch.shared_with_client ? '' : 'opacity-50'}`}>
                    <Switch
                      // nothing reaches the portal while the plan itself is off —
                      // showing a lit board toggle then reads as "still shared"
                      checked={batch.shared_with_client ? (batch.share_board ?? true) : false}
                      disabled={!batch.shared_with_client}
                      onCheckedChange={async v => {
                        const ok = await patch('share_board', v)
                        if (ok) toast.success(v ? 'Board is visible to the client' : 'Board hidden — the client sees the brief only')
                      }}
                    />
                    Also show the planning board
                  </label>
                </>
              ) : (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {batch.shared_with_client ? 'Visible on the client portal.' : 'Not shared with the client. An account manager can share it.'}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="w-fit" asChild>
                  <a href={`/api/production/batches/${batch.id}/pdf`} download>
                    <FileDown className="h-3.5 w-3.5" /> Download brief PDF
                  </a>
                </Button>
                {portalToken && (
                  <Button size="sm" variant="outline" className="w-fit"
                    onClick={() => {
                      void navigator.clipboard.writeText(`${window.location.origin}/portal/${portalToken}`)
                        .then(() => toast.success('Client portal link copied'))
                        .catch(() => toast.error('Could not copy — copy it from the Clients page'))
                    }}>
                    <LinkIcon className="h-3.5 w-3.5" /> Copy client portal link
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <BriefComments batchId={batch.id} />
        </div>
      </div>

      {/* ── the board: the Milanote-style canvas ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-3">
          <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Board</p>
          {canEdit ? (
            <input
              key={batch.board_name ?? ''}
              defaultValue={batch.board_name ?? ''}
              placeholder="Name this board…"
              maxLength={80}
              className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
              onBlur={e => {
                const v = e.target.value.trim()
                if (v !== (batch.board_name ?? '')) void patch('board_name', v)
              }}
            />
          ) : (
            batch.board_name && <span className="text-sm font-medium">{batch.board_name}</span>
          )}
          <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
            {(batch.canvas_cards ?? []).length === 1 ? '1 card' : `${(batch.canvas_cards ?? []).length} cards`}
          </span>
        </div>
        <BriefCanvas
          cards={canvasCards}
          references={canvasRefs}
          canEdit={canEdit}
          clientName={batch.clients?.name}
          onOp={async (op: CanvasOp) => {
            const res = await fetch(`/api/production/batches/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ canvas_op: op }),
            })
            if (!res.ok) {
              toast.error('Could not save the board')
              void load()
              return false
            }
            const json = await res.json()
            setBatch(b => (b ? { ...b, canvas_cards: json.canvas_cards } : b))
            return true
          }}
        />
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
            {/* never disabled by data that might still be in flight: while a
                field save is in the air the button WAITS for it and then goes,
                so a click always ends in a lock or a message */}
            <AlertDialogAction disabled={busy !== null}
              onClick={async e => {
                e.preventDefault()
                if (pending.current > 0) {
                  setBusy('locked')
                  // let the blur-save that is in the air land first
                  for (let i = 0; i < 40 && pending.current > 0; i++) await new Promise(r => setTimeout(r, 50))
                  setBusy(null)
                }
                const dated = batchRef.current?.shoot_date ?? batch.shoot_date
                if (!dated) {
                  toast.error('Set the shoot date first — it is the field above this button.')
                  return
                }
                void transition('locked', 'Lock shoot date')
              }}>
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
            <p className="-mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">
              {dateDraft.shoot_date ? `Moving it to ${longDate(dateDraft.shoot_date)}` : 'The new date is read back here in words.'}
            </p>
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
                router.push('/dashboard/production')
              }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
