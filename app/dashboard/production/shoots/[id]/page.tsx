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
  ArrowLeft, Check, Link as LinkIcon, Lock, MoreHorizontal, Plus, Trash2, X, FileDown,
} from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useProductionLive } from '../../useProductionLive'
import { BATCH_STATUS_STYLE } from '../../shoot-ui'
import BriefCanvas, { type CanvasOp } from './BriefCanvas'
import BriefBoardComments from './BriefBoardComments'
import BriefComments from './BriefComments'
import LocationSearch from './LocationSearch'
import PlanReviewCard from './PlanReviewCard'
import { BriefParts, GoPanel, StageStrip, TeamPanel, type CrewRow, type TeamRow } from './ShootSop'
import type { ShootStage, SopShoot } from '../../../../lib/shoot-sop-core'
import {
  availableBatchTransitions, sanitiseCanvasCards,
  type BatchStatus, type CanvasCard, type ReferenceMedia, type ShotRow,
} from '../../../../lib/batch-brief-core'
import { SHOWN_SHOOT_LABEL, shownShootState } from '../../../../lib/shoot-lifecycle-core'
import { createCoalescer } from '../../../../lib/coalesce-core'
import { TYPE_LABELS, type ContentType } from '../../../../lib/agreement-core'
import { newLineId, planLines, plannedCount, shootCardId } from '../../../../lib/deliverable-group-core'

type Batch = {
  id: string; client_id: string; title: string; status: BatchStatus
  description: string | null; concept: string | null; location: string | null
  shoot_date: string | null; shot_list: ShotRow[]; reference_media: ReferenceMedia[]
  canvas_cards?: CanvasCard[]
  /** the plan's lines — read through `planLines`, which also understands the
   *  old {type, qty} shape still on some shoots */
  planned_deliverables: unknown[]
  locked_at: string | null; shot_at: string | null
  shared_with_client?: boolean
  share_board?: boolean | null
  board_name?: string | null
  month: number | null; year: number | null
  /** the shoot's folder in Drive, minted when the shoot was created */
  drive_folder_id?: string | null
  drive_url?: string | null
  clients: { name: string } | null
} & SopShoot
type ItemLite = { id: string; title: string; status: string; work_kinds?: { slug?: string } | null }

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
 * and opens the shoot for the items that come out of it.
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
  /** the line being typed under the plan, saved on Enter or Add */
  const [newLine, setNewLine] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [dateOpen, setDateOpen] = useState(false)
  const [dateDraft, setDateDraft] = useState({ shoot_date: '', reason: '' })
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [portalToken, setPortalToken] = useState<string | null>(null)
  // the Shoot Brief SOP: who is on the shoot and who has read it, the team
  // to pick from (managers), and who is looking
  const [crew, setCrew] = useState<CrewRow[]>([])
  const [team, setTeam] = useState<TeamRow[]>([])
  const [viewerId, setViewerId] = useState('')
  const [sopNames, setSopNames] = useState<{ go_by?: string | null; shared_by?: string | null; handed_by?: string | null }>({})
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => { setToday(new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })) }, [])

  /** Stamped so a slow answer from an older request cannot overwrite a newer
   *  one — the poll, the realtime hint and every save all call this. */
  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    const res = await fetch(`/api/production/batches/${id}`, { cache: 'no-store' })
    if (!res.ok) {
      if (seq !== loadSeq.current) return
      toast.error((await res.json()).error ?? 'Could not load the shoot')
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
    setCrew(Array.isArray(json.crew) ? json.crew : [])
    setTeam(Array.isArray(json.team) ? json.team : [])
    setViewerId(String(json.viewer_id ?? ''))
    setSopNames({ go_by: json.go_by_name ?? null, shared_by: json.brief_shared_by_name ?? null, handed_by: json.footage_handed_by_name ?? null })
  }, [id, router])
  useEffect(() => { void load() }, [load])
  useProductionLive(useCallback(() => { void load() }, [load]))

  // stable identities for the canvas props — and ABOVE the early return:
  // hooks below a conditional return crash React with a hook-order error
  const canvasCards = useMemo(() => sanitiseCanvasCards(batch?.canvas_cards), [batch?.canvas_cards])
  const canvasRefs = useMemo(() => batch?.reference_media ?? [], [batch?.reference_media])

  const isManager = ['account_manager', 'super_admin'].includes(role)
  // the same people the PATCH route lets in (editor and up — the general
  // role included): a general user could create a shoot and then found
  // every field on it disabled (the render audit of 11 Sep 2026)
  const canEdit = ['editor', 'general', 'account_manager', 'super_admin'].includes(role)

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
    // the shot list renders from LOCAL state and saves through the coalescer
    // below — a server echo from some other field's save is never newer than
    // what the person is typing, so it must not overwrite it
    const { shot_list: _echo, ...rest } = json as Record<string, unknown>
    void _echo
    setBatch(b => (b ? { ...b, ...rest } : b))
    setLastEdited({ name: 'you', at: new Date().toISOString() })
    setSaveState('saved')
    window.setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 2000)
    void quiet
    return true
  }

  /**
   * The shot list, made instant.
   *
   * Every tick, rename and delete used to PATCH the whole array and wait for
   * the answer before the screen moved — and the input remounted on the echo,
   * dropping focus mid-word. Now the edit lands in local state immediately,
   * the screen renders from that, and ONE debounced PATCH (~600ms after the
   * typing pauses) sends the latest array — ten quick edits, one request.
   * The response is not merged back over the list (local is newer or equal);
   * a refusal reloads the truth. Concurrent editors stay last-write-wins, as
   * the note at the top of this file already accepts.
   */
  const saveShotList = useCallback(async (list: ShotRow[]) => {
    pending.current += 1
    setSaveState('saving')
    const res = await fetch(`/api/production/batches/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shot_list: list }),
    })
    pending.current = Math.max(0, pending.current - 1)
    if (!res.ok) {
      setSaveState('idle')
      toast.error((await res.json().catch(() => ({}))).error ?? 'Could not save the shot list')
      void load()
      return
    }
    setLastEdited({ name: 'you', at: new Date().toISOString() })
    setSaveState('saved')
    window.setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 2000)
  }, [id, load])
  const saveShotListRef = useRef(saveShotList)
  useEffect(() => { saveShotListRef.current = saveShotList }, [saveShotList])
  const shotSaver = useRef<ReturnType<typeof createCoalescer<ShotRow[]>> | null>(null)
  if (!shotSaver.current) shotSaver.current = createCoalescer<ShotRow[]>(list => { void saveShotListRef.current(list) }, 600)
  // leaving the page saves whatever is still pending
  useEffect(() => () => shotSaver.current?.flush(), [])
  const editShots = (next: ShotRow[]) => {
    setBatch(b => (b ? { ...b, shot_list: next } : b))
    shotSaver.current?.push(next)
  }

  /** a move along the playbook's timeline — Share, Go, Reminder, Footage */
  const moveStage = async (to: ShootStage, opts?: { reason?: string }) => {
    setBusy(`stage:${to}`)
    try {
      const res = await fetch(`/api/production/batches/${id}/stage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, ...(opts?.reason ? { reason: opts.reason } : {}) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not move it')
      const handed = json.handed as { total: number } | null
      toast.success(handed
        ? `${json.moved} — ${handed.total} card${handed.total === 1 ? '' : 's'} now with the editor, on the Editor page`
        : String(json.moved ?? 'Done'))
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move it')
    } finally {
      setBusy(null)
    }
  }
  const acknowledge = async () => {
    setBusy('ack')
    try {
      const res = await fetch(`/api/production/batches/${id}/acknowledge`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not save')
      toast.success('Thanks — you have read the plan')
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(null)
    }
  }
  const unacknowledge = async (userId: string) => {
    setBusy('unack')
    try {
      const res = await fetch(`/api/production/batches/${id}/acknowledge`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not undo it')
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not undo it')
    } finally {
      setBusy(null)
    }
  }
  /** a field save that reloads, so the crew list and the ticks follow */
  const patchThenLoad = async (field: string, value: unknown) => {
    const ok = await patch(field, value, true)
    if (ok) void load()
    return ok
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
      toast.success(`${label} — done`)
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
  /** what this shoot actually PRODUCED — its own plan is not a deliverable */
  const deliverableItems = items.filter(i => i.work_kinds?.slug !== 'shoot_brief')
  const shots = batch.shot_list ?? []
  const captured = shots.filter(s => s.done).length
  const transitions = availableBatchTransitions(role as never, batch.status)
  // GO IS THE ONE SIGN-OFF (the owner, 11 Sep 2026): pressing "Confirm — it is
  // go" on the right books the shoot too, so there is no second "Book the
  // shoot" button here. "Shot" is derived from the calendar (shownShootState);
  // closing a shoot and undoing a booking live in the ⋯ menu.
  const quiet = transitions.filter(t => t.to !== 'locked' && t.to !== 'shot')
  const state = shownShootState(batch)
  const stateStyle = { planning: 'brief', booked: 'locked', shot: 'shot', closed: 'wrapped' } as const
  /** the plan as lines, whichever shape it was stored in */
  const planned = planLines(batch.planned_deliverables)
  const itemById = new Map(items.map(i => [i.id, i]))
  const addLine = async () => {
    const title = newLine.trim()
    if (!title) return
    setNewLine('')
    await patch('planned_deliverables', [...planned, { id: newLineId(), title }], true)
  }

  return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard/production"
        className="inline-flex w-fit items-center gap-1.5 text-secondary-13 text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Shoots
      </Link>

      {/* ── header ── */}
      <div className="flex flex-wrap items-center gap-3 pb-2 pt-2">
        {/* The shoot's name IS this page's name, and it is editable in place.
            So the box is the h1 rather than sitting under one: the page gets
            the heading every other page has, and a screen reader still hears
            what the field is for from the label. */}
        <h1 className="min-w-0 flex-1">
          <label htmlFor="shoot-title" className="sr-only">Shoot name</label>
          <input
            id="shoot-title"
            key={batch.title}
            defaultValue={batch.title}
            disabled={!canEdit}
            onBlur={e => { const v = e.target.value.trim(); if (v && v !== batch.title) void patch('title', v) }}
            className="w-full min-w-0 bg-transparent text-page-title-sm outline-none focus:border-b focus:border-border disabled:opacity-100"
          />
        </h1>
        {/* what actually happened, derived from the calendar — a booked shoot
            whose date has passed says "Shot" with nobody pressing anything */}
        <Badge variant="outline" className={`font-normal ${BATCH_STATUS_STYLE[stateStyle[state]]}`}>
          {SHOWN_SHOOT_LABEL[state]}
        </Badge>
        {/* the exceptions — closing early, undoing a booking, reopening — live
            in a quiet ⋯ menu so the page carries one obvious action */}
        {isManager && quiet.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" aria-label="More actions for this shoot">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {quiet.map(t => (
                <DropdownMenuItem key={t.to} disabled={busy !== null}
                  onClick={() => void transition(t.to, t.label)}>
                  {t.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {isManager && items.length === 0 && (
          <Button size="sm" variant="outline" className="text-accent-red"
            onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete shoot
          </Button>
        )}
      </div>
      <p className="-mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-body-15 text-muted-foreground">
        <Link href="/dashboard/clients" className="underline decoration-dotted">{batch.clients?.name}</Link>
        {canEdit && (
          <span className="font-mono text-[12px] uppercase tracking-wider">
            {saveState === 'saving' ? <span className="text-muted-foreground">· Saving…</span>
              : saveState === 'saved' ? <span className="text-accent-green">· Saved ✓</span>
              : <span className="text-muted-foreground">· Autosaves</span>}
          </span>
        )}
        {lastEdited.name && lastEdited.at && (
          <span className="text-secondary-13 text-muted-foreground">
            · Last edited by {lastEdited.name} {timeAgo(lastEdited.at)}
          </span>
        )}
      </p>

      {/* stays until the shoot HAS a brief. Gating it on 'brief' meant that
          locking the date removed the only way to raise one, and the New ▾
          menu then built a second shoot instead of joining this one. */}
      {isManager && batch.status !== 'wrapped' && !briefTask && (
        <div className="flex flex-wrap items-center gap-3 rounded-inner border border-accent-blue/25 bg-tint-blue px-4 py-3">
          <p className="text-body-15 text-foreground">
            Nothing has been written up for this shoot yet. A shoot plan is what the
            client signs off before we film. Write it here, share it with the team,
            and press Go on the right — that books the date.
          </p>
          <Button size="sm" className="ml-auto" disabled={busy !== null}
            onClick={async () => {
              setBusy('plan-task')
              try {
                const kindsRes = await fetch('/api/production/work-kinds?active=1')
                const kinds = kindsRes.ok ? (await kindsRes.json()).kinds ?? [] : []
                const briefKind = kinds.find((k: { slug: string }) => k.slug === 'shoot_brief')
                if (!briefKind) throw new Error('The shoot plan work type is missing')
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
                if (!res.ok) throw new Error(json.error ?? 'Could not create the shoot plan')
                toast.success('Shoot plan created')
                void load()
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Could not create the shoot plan')
              } finally {
                setBusy(null)
              }
            }}>
            {busy === 'plan-task' ? 'Creating…' : 'Write the shoot plan'}
          </Button>
        </div>
      )}

      {/* THE review lifecycle — the "what's the next move" card, moved here so
          the plan lives on ONE page: write it above, send it for review here,
          the client decides on their portal, then Book the shoot. */}
      {/* the flow, on the page: six stages and the one next move */}
      {today && (
        <StageStrip batch={batch} today={today} role={role as never} itemCount={deliverableItems.length} />
      )}

      {briefTask && (
        <PlanReviewCard
          briefItemId={briefTask.id}
          // the LIVE plan content, so "Send plan for review" enables the moment
          // the concept is written or a shot is added — no reload needed
          planHasContent={Boolean((batch.concept ?? '').trim() || (batch.shot_list?.length ?? 0) > 0)}
          onChanged={load}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── working column ── */}
        <div className="flex flex-col gap-4">
          {/* THE BRIEF, AS THE PLAYBOOK DEFINES IT: nine parts, each ticked
              as it is filled in. The shoot cannot leave Drafting without them. */}
          <BriefParts batch={batch} canEdit={canEdit} itemCount={deliverableItems.length} onPatch={patchThenLoad} />

          <Card>
            <CardContent className="p-4">
              <p className="mb-2 font-mono text-[12px] uppercase tracking-widest text-muted-foreground">Notes for the team</p>
              <textarea
                key={batch.concept ?? ''}
                defaultValue={batch.concept ?? ''}
                disabled={!canEdit}
                rows={5}
                placeholder="Anything else the team should know before the day."
                onBlur={e => { const v = e.target.value; if (v !== (batch.concept ?? '')) void patch('concept', v) }}
                className="w-full resize-y bg-transparent text-body-15 leading-relaxed outline-none placeholder:text-muted-foreground"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-2 p-4">
              <div className="flex items-baseline justify-between">
                <p className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">Shot list</p>
                {batch.status === 'shot' && shots.length > 0 && (
                  <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{captured}/{shots.length} captured</span>
                )}
              </div>
              {shots.length === 0 && (
                <p className="text-body-15 text-muted-foreground">No shots yet. List what needs to be captured on the day.</p>
              )}
              {shots.map((shot, i) => (
                <div key={shot.id} className="group flex items-center gap-2">
                  <input type="checkbox" checked={shot.done} disabled={!canEdit}
                    onChange={e => editShots(shots.map((s, j) => j === i ? { ...s, done: e.target.checked } : s))}
                    className="h-4 w-4 shrink-0 accent-[var(--dbx-blue)]" />
                  {/* keyed by the shot's id ONLY — keying on the text remounted
                      the field on every echo and dropped focus mid-word */}
                  <Input key={shot.id} defaultValue={shot.text} disabled={!canEdit}
                    className="h-8 border-transparent bg-transparent px-1 text-body-15 shadow-none hover:border-border"
                    onBlur={e => {
                      const v = e.target.value.trim()
                      if (v !== shot.text) editShots(v === '' ? shots.filter((_, j) => j !== i) : shots.map((s, j) => j === i ? { ...s, text: v } : s))
                    }} />
                  <Select value={shot.type ?? 'none'}
                    onValueChange={v => editShots(shots.map((s, j) => j === i ? { ...s, ...(v === 'none' ? { type: undefined } : { type: v }) } : s))}>
                    <SelectTrigger className="h-8 w-28 border-transparent text-secondary-13 shadow-none"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Any use</SelectItem>
                      {CONTENT_TYPE_OPTIONS.map(([t, label]) => <SelectItem key={t} value={t}>{label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {canEdit && (
                    <button type="button" className="opacity-60 transition-opacity group-hover:opacity-100"
                      onClick={() => editShots(shots.filter((_, j) => j !== i))}>
                      <X className="h-3.5 w-3.5 text-muted-foreground hover:text-accent-red" />
                    </button>
                  )}
                </div>
              ))}
              {canEdit && (
                <Button size="sm" variant="ghost" className="w-fit text-muted-foreground"
                  onClick={() => editShots([...shots, { id: Math.random().toString(36).slice(2, 10), text: 'New shot', done: false }])}>
                  <Plus className="h-3.5 w-3.5" /> Add shot
                </Button>
              )}
            </CardContent>
          </Card>

                </div>

        {/* ── rail ── */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          {/* where the shoot is on the playbook's timeline, and the one next move */}
          {today && (
            <GoPanel batch={batch} role={role as never} viewerId={viewerId} today={today}
              itemCount={deliverableItems.length} busy={busy !== null} names={sopNames}
              onPatch={patchThenLoad} onMove={moveStage} />
          )}
          <TeamPanel batch={batch} crew={crew} team={team} viewerId={viewerId} role={role as never}
            busy={busy !== null} onPatch={patchThenLoad} onAck={acknowledge} onUnack={unacknowledge} />

          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">Shoot details</p>
              {batch.status === 'brief' ? (
                <div className="grid gap-1.5">
                  <label className="text-secondary-13 text-muted-foreground">Shoot date</label>
                  <Input type="date" key={batch.shoot_date ?? ''} defaultValue={batch.shoot_date ?? ''} disabled={!canEdit}
                    className="font-mono text-secondary-13"
                    onBlur={e => { if ((e.target.value || null) !== batch.shoot_date) void patch('shoot_date', e.target.value || null) }} />
                  {/* the picker's field order follows the BROWSER's locale,
                      which is not ours to set — so echo it back in words */}
                  <p className="text-[12px] text-muted-foreground">
                    {batch.shoot_date ? longDate(batch.shoot_date) : 'The date is read back here in words once set.'}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  <span className="inline-flex items-center gap-1.5 text-body-15 font-semibold">
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" /> {longDate(batch.shoot_date)}
                  </span>
                  {batch.locked_at && (
                    <span className="font-mono text-[12px] uppercase tracking-wider text-muted-foreground">
                      Booked by {lockedByName ?? 'the team'} · {stamp(batch.locked_at)}
                    </span>
                  )}
                  {isManager && batch.status !== 'wrapped' && (
                    <button type="button" className="w-fit text-secondary-13 text-accent-blue-deep hover:underline"
                      onClick={() => { setDateDraft({ shoot_date: batch.shoot_date ?? '', reason: '' }); setDateOpen(true) }}>
                      Change date
                    </button>
                  )}
                </div>
              )}
              <div className="grid gap-1.5">
                <label className="text-secondary-13 text-muted-foreground">Location</label>
                <LocationSearch
                  value={batch.location ?? ''}
                  disabled={!canEdit}
                  onSave={v => void patch('location', v, true)}
                />
              </div>
              {batch.month && batch.year && (
                <p className="font-mono text-[12px] text-muted-foreground">
                  Counts toward {new Date(batch.year, batch.month - 1).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}
                </p>
              )}
            </CardContent>
          </Card>

          {/* WHAT IS COMING OUT — a plain list. ONE SHOOT, ONE CARD (the
              owner, 11 Sep 2026): the list is what the editor's single card
              says needs doing, and the count of finals expected is read off
              it ("5 reels" is five). Always drawn for anyone who can edit:
              the checklist's Deliverables row sends people here. */}
          {(planned.length > 0 || canEdit) && (
          <Card>
            <CardContent className="flex flex-col gap-2 p-4">
              <p className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">What is coming out of this shoot</p>
              {planned.length === 0 && (
                <p className="text-[13px] text-muted-foreground">Nothing listed yet. Add a line for each thing coming out of the shoot.</p>
              )}
              <p className="text-[13px] text-muted-foreground">List what is coming out: 5 reels, 1 long-form, 1 photo set. The editor gets one card for the whole shoot{plannedCount(batch.planned_deliverables) > 0 ? `, holding ${plannedCount(batch.planned_deliverables)} final${plannedCount(batch.planned_deliverables) === 1 ? '' : 's'}` : ''}.</p>
              {planned.map((line, i) => {
                return (
                  <div key={line.id} className="flex items-center gap-1.5">
                    <span className="w-5 shrink-0 text-right font-mono text-[12px] text-muted-foreground">{i + 1}</span>
                    <Input key={`${line.id}:${line.title}`} defaultValue={line.title} disabled={!canEdit}
                      className="h-9 min-w-0 flex-1 text-body-15"
                      onBlur={e => {
                        const title = e.target.value.trim()
                        if (title && title !== line.title) void patch('planned_deliverables',
                          planned.map((x, j) => j === i ? { ...x, title } : x), true)
                      }} />
                    {canEdit && (
                      <button type="button" aria-label="Remove this line"
                        className="flex h-11 w-11 shrink-0 items-center justify-center"
                        onClick={() => void patch('planned_deliverables', planned.filter((_, j) => j !== i), true)}>
                        <X className="h-3.5 w-3.5 text-muted-foreground hover:text-accent-red" />
                      </button>
                    )}
                  </div>
                )
              })}
              {canEdit && (
                <div className="flex items-center gap-1.5">
                  <span className="w-5 shrink-0 text-right font-mono text-[12px] text-muted-foreground">{planned.length + 1}</span>
                  <Input value={newLine} placeholder="Add a line — e.g. Hero reel" className="h-9 min-w-0 flex-1 text-body-15"
                    onChange={e => setNewLine(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addLine() } }} />
                  <Button size="sm" variant="ghost" className="shrink-0 text-muted-foreground" disabled={!newLine.trim()}
                    onClick={() => void addLine()}>
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </div>
              )}
              {(() => {
                const one = itemById.get(shootCardId(batch.id)) ?? deliverableItems[0]
                return one ? (
                  <Link href={`/dashboard/editor?card=${one.id}`} className="w-fit text-secondary-13 font-semibold text-accent-blue-deep underline-offset-4 hover:underline">
                    Open the editor’s card
                  </Link>
                ) : (
                  <p className="text-[12px] text-muted-foreground">
                    {batch.status === 'brief'
                      ? 'The editor’s card is made when the shoot is booked or confirmed.'
                      : 'The editor’s card is made as soon as something is listed here.'}
                  </p>
                )
              })()}
            </CardContent>
          </Card>
          )}

          <Card>
            <CardContent className="flex flex-col gap-2 p-4">
              <p className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">The editor’s card</p>
              {batch.status === 'brief' ? (
                <p className="text-body-15 text-muted-foreground">
                  Pressing Go books the shoot and makes the editor’s one card, briefed with “What is coming out of this shoot”.
                </p>
              ) : (
                <>
                  {/* the BRIEF task rides this shoot too, and it is paperwork,
                      not a deliverable — counting it told an account manager
                      there was a piece of content when there was none */}
                  <p className="text-body-15">
                    <span className="font-mono tabular-nums">{deliverableItems.length}</span> card{deliverableItems.length === 1 ? '' : 's'} on Editor
                    {deliverableItems.length === 0 && (
                      <span className="text-muted-foreground"> — none yet; Go makes it</span>
                    )}
                  </p>
                  {deliverableItems.slice(0, 5).map(it => (
                    <Link key={it.id} href={`/dashboard/editor?card=${it.id}`}
                      className="flex items-center gap-2 text-body-15 hover:underline">
                      <Check className={`h-3.5 w-3.5 ${['published', 'scheduled'].includes(it.status) ? 'text-accent-green' : 'text-muted-foreground'}`} />
                      <span className="truncate">{it.title}</span>
                    </Link>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" asChild>
                      <Link href="/dashboard/editor">Open on Editor</Link>
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-col gap-3 p-4">
              <p className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">Client portal</p>
              {isManager ? (
                <>
                  <label className="flex flex-col gap-1 text-secondary-13 text-muted-foreground">
                    <span className="flex items-center gap-2">
                      <Switch
                        checked={batch.shared_with_client ?? false}
                        onCheckedChange={async v => {
                          const ok = await patch('shared_with_client', v)
                          if (ok) toast.success(v ? 'Shoot plan is now on the client portal' : 'Hidden from the client portal')
                        }}
                      />
                      <span className="text-foreground">Visible on the client portal</span>
                    </span>
                    <span className="text-[12px] text-muted-foreground">Turns on by itself when the plan is shared with the client. They can see the plan and comment on the canvas.</span>
                  </label>
                </>
              ) : (
                <p className="text-secondary-13 text-muted-foreground">
                  {batch.shared_with_client ? 'Visible on the client portal.' : 'Not shared with the client. An account manager can share it.'}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="w-fit" asChild>
                  <a href={`/api/production/batches/${batch.id}/pdf`} download>
                    <FileDown className="h-3.5 w-3.5" /> Download the plan PDF
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

          <BriefComments batchId={batch.id} cards={canvasCards} />
        </div>
      </div>

      {/* ── the board: the Milanote-style canvas ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-3">
          <p className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">Plan canvas</p>
          {canEdit ? (
            <input
              key={batch.board_name ?? ''}
              defaultValue={batch.board_name ?? ''}
              placeholder="Name this canvas…"
              maxLength={80}
              className="min-w-0 flex-1 bg-transparent text-body-15 font-medium outline-none placeholder:text-muted-foreground dark:placeholder:text-muted-foreground"
              onBlur={e => {
                const v = e.target.value.trim()
                if (v !== (batch.board_name ?? '')) void patch('board_name', v)
              }}
            />
          ) : (
            batch.board_name && <span className="text-body-15 font-medium">{batch.board_name}</span>
          )}
          <span className="ml-auto font-mono text-[12px] tabular-nums text-muted-foreground">
            {(batch.canvas_cards ?? []).length === 1 ? '1 card' : `${(batch.canvas_cards ?? []).length} cards`}
          </span>
        </div>
        {/* every card wears its comment count; picking one opens the thread
            the client sees on the same card of their portal */}
        <BriefBoardComments batchId={batch.id} cards={canvasCards}>
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
        </BriefBoardComments>
      </div>

      {/* ── AM changes a booked date, with a reason ── */}
      <AlertDialog open={dateOpen} onOpenChange={o => busy === null && setDateOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change a booked date?</AlertDialogTitle>
            <AlertDialogDescription>
              The team committed to {longDate(batch.shoot_date)}. Say why it&rsquo;s moving — the change is logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3">
            <Input type="date" value={dateDraft.shoot_date} className="font-mono text-secondary-13"
              onChange={e => setDateDraft(d => ({ ...d, shoot_date: e.target.value }))} />
            <p className="-mt-2 text-[12px] text-muted-foreground">
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

      {/* ── delete an unbooked, empty shoot ── */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{batch.title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              The shoot plan, its shot list, and its references go. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-accent-red text-cream hover:bg-accent-red/90"
              onClick={async e => {
                e.preventDefault()
                const res = await fetch(`/api/production/batches/${id}`, { method: 'DELETE' })
                if (!res.ok) { toast.error((await res.json()).error ?? 'Could not delete'); return }
                toast.success('Shoot deleted')
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
