'use client'

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useProductionLive } from '../../useProductionLive'
import BriefCanvas, { type CanvasOp } from './BriefCanvas'
import BriefBoardComments from './BriefBoardComments'
import BriefComments from './BriefComments'
import {
  EditorCardPanel, PeoplePanel, PlanParts, PortalPanel, StageStrip, WherePanel,
  type CrewRow, type ShootSopBatch, type TeamRow,
} from './ShootSop'
import { STAGE_LABEL, createdWords, shootStage, stampWords, type ShootStage } from '../../../../lib/shoot-sop-core'
import { sanitiseCanvasCards, type CanvasCard, type ReferenceMedia, type ShotRow } from '../../../../lib/batch-brief-core'
import { createCoalescer } from '../../../../lib/coalesce-core'
import Chip from '../../../ui/Chip'

type Batch = ShootSopBatch & {
  client_id: string
  description: string | null; concept: string | null
  reference_media: ReferenceMedia[]
  canvas_cards?: CanvasCard[]
  board_name?: string | null
  last_edited_at?: string | null
  clients: { name: string } | null
}
type ItemLite = { id: string; title: string; status: string; work_kinds?: { slug?: string } | null }

/**
 * THE SHOOT PAGE — the account manager's working surface for one shoot,
 * rebuilt from the Shoot Brief SOP §3 (13 Sep 2026).
 *
 *   header   back to Shoots · the title (renamed in place) · the client ·
 *            the shoot date · the stage · "Created by …"
 *   strip    six stages, one "Next: …" line
 *   left     THE SHOOT PLAN (nine parts, fields inside the rows) · Notes
 *            for the team · the plan canvas
 *   right    WHERE IT IS · WHO IS ON THIS SHOOT · THE EDITOR'S CARD ·
 *            CLIENT PORTAL · the shoot's comments
 *
 * Only the people who may work the shoot reach it — the AM on the client,
 * the creator, a super admin, a general user. The server refuses everyone
 * else; an editor following an old link is sent to their Editor page.
 */
export default function ShootPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [batch, setBatch] = useState<Batch | null>(null)
  const [items, setItems] = useState<ItemLite[]>([])
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [lastEdited, setLastEdited] = useState<{ name: string | null; at: string | null }>({ name: null, at: null })
  const [role, setRole] = useState<string>('')
  const [viewerId, setViewerId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [dateOpen, setDateOpen] = useState(false)
  const [dateDraft, setDateDraft] = useState({ shoot_date: '', reason: '' })
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [portalToken, setPortalToken] = useState<string | null>(null)
  const [clientEmail, setClientEmail] = useState<string | null>(null)
  const [crew, setCrew] = useState<CrewRow[]>([])
  const [team, setTeam] = useState<TeamRow[]>([])
  const [names, setNames] = useState<Record<string, string | null>>({})
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
      const json = await res.json().catch(() => ({}))
      // an editor, a scheduler or a crew member: their shoots are on Editor
      if (json.redirect) { toast.message(json.error ?? 'This page is the account manager’s'); router.replace(String(json.redirect)); return }
      toast.error(json.error ?? 'Could not load the shoot')
      router.push('/dashboard/production')
      return
    }
    const json = await res.json()
    if (seq !== loadSeq.current) return
    setBatch(json.batch)
    setItems(json.items ?? [])
    setLastEdited({ name: json.last_edited_by_name ?? null, at: json.last_edited_at ?? null })
    setRole(json.viewer_role ?? '')
    setViewerId(String(json.viewer_id ?? ''))
    setPortalToken(json.portal_token ?? null)
    setClientEmail(json.client_email ?? null)
    setCrew(Array.isArray(json.crew) ? json.crew : [])
    setTeam(Array.isArray(json.team) ? json.team : [])
    setNames(json.names && typeof json.names === 'object' ? json.names : {})
  }, [id, router])
  useEffect(() => { void load() }, [load])
  useProductionLive(useCallback(() => { void load() }, [load]))

  // stable identities for the canvas props — and ABOVE the early return:
  // hooks below a conditional return crash React with a hook-order error
  const canvasCards = useMemo(() => sanitiseCanvasCards(batch?.canvas_cards), [batch?.canvas_cards])
  const canvasRefs = useMemo(() => batch?.reference_media ?? [], [batch?.reference_media])

  /** Field-level save: send ONLY what changed. */
  const patch = async (field: string, value: unknown) => {
    setSaveState('saving')
    const res = await fetch(`/api/production/batches/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
    if (!res.ok) {
      setSaveState('idle')
      toast.error((await res.json().catch(() => ({}))).error ?? 'Could not save')
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
    return true
  }
  /** a save that reloads, so the crew list, the names and the ticks follow */
  const patchThenLoad = async (field: string, value: unknown) => {
    const ok = await patch(field, value)
    if (ok) void load()
    return ok
  }

  /** The shot list, made instant: local state first, ONE debounced PATCH. */
  const saveShotList = useCallback(async (list: ShotRow[]) => {
    setSaveState('saving')
    const res = await fetch(`/api/production/batches/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shot_list: list }),
    })
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
  useEffect(() => () => shotSaver.current?.flush(), [])
  const editShots = (next: ShotRow[]) => {
    setBatch(b => (b ? { ...b, shot_list: next } : b))
    shotSaver.current?.push(next)
  }

  /** a move along the playbook's timeline — Share, Go, Reminder, Footage is in */
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
      toast.success(handed && handed.total > 0
        ? `${json.moved} — the editor’s card is on the Editor page`
        : String(json.moved ?? 'Done'))
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move it')
    } finally {
      setBusy(null)
    }
  }
  const shareWithClient = async () => {
    setBusy('client')
    try {
      const res = await fetch(`/api/production/batches/${id}/share-client`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not share it')
      toast.success(json.emailed ? `Plan shared — ${json.client_email} has been emailed` : 'Plan is on the client portal')
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not share it')
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

  if (!batch) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" />
      </div>
    )
  }

  const deliverableItems = items.filter(i => i.work_kinds?.slug !== 'shoot_brief')
  const nameOf = (uid: string | null | undefined) => (uid ? names[uid] ?? null : null)
  const booked = batch.status !== 'brief'
  const stage = today ? shootStage(batch, today) : null

  return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard/production"
        className="inline-flex min-h-11 w-fit items-center gap-1.5 text-secondary-13 text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Shoots
      </Link>

      {/* ── header ── */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 flex-1">
          <label htmlFor="shoot-title" className="sr-only">Shoot name</label>
          <input
            id="shoot-title"
            key={batch.title}
            defaultValue={batch.title}
            onBlur={e => { const v = e.target.value.trim(); if (v && v !== batch.title) void patch('title', v) }}
            className="w-full min-w-0 bg-transparent text-page-title-sm outline-none focus:border-b focus:border-border"
          />
        </h1>
        {stage && <Chip tone={stage === 'footage_handed' ? 'green' : stage === 'shoot_day' ? 'amber' : 'ink'}>{STAGE_LABEL[stage]}</Chip>}
        {items.length === 0 && (
          <Button variant="outline" className="h-11 rounded-full px-4 text-[14px] font-semibold text-accent-red-deep"
            onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" aria-hidden /> Delete shoot
          </Button>
        )}
      </div>
      <p className="-mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[14px] text-muted-foreground">
        <Link href="/dashboard/clients" className="underline decoration-dotted">{batch.clients?.name}</Link>
        <span>· {batch.shoot_date ? `Shoot ${stampWords(batch.shoot_date)}` : 'No shoot date yet'}</span>
        {booked && batch.status !== 'wrapped' && (
          <button type="button" className="min-h-11 text-[13px] text-accent-blue-deep hover:underline"
            onClick={() => { setDateDraft({ shoot_date: batch.shoot_date ?? '', reason: '' }); setDateOpen(true) }}>
            Change date
          </button>
        )}
        <span>· {createdWords(batch, nameOf)}</span>
        <span className="font-mono text-[12px] uppercase tracking-wider">
          {saveState === 'saving' ? '· Saving…' : saveState === 'saved' ? <span className="text-accent-green">· Saved ✓</span> : '· Autosaves'}
        </span>
        {lastEdited.name && lastEdited.at && <span className="text-[13px]">· Last edited by {lastEdited.name}, {stampWords(lastEdited.at)}</span>}
      </p>

      {today && <StageStrip batch={batch} today={today} role={role as never} itemCount={deliverableItems.length} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── the plan ── */}
        <div className="flex flex-col gap-4">
          <PlanParts batch={batch} itemCount={deliverableItems.length} booked={booked} onPatch={patchThenLoad} onShots={editShots} />

          <Card>
            <CardContent className="p-4">
              <p className="mb-2 font-mono text-[12px] uppercase tracking-widest text-muted-foreground">Notes for the team</p>
              <textarea
                key={batch.concept ?? ''}
                defaultValue={batch.concept ?? ''}
                rows={4}
                aria-label="Notes for the team"
                placeholder="Anything else the team should know before the day."
                onBlur={e => { const v = e.target.value; if (v !== (batch.concept ?? '')) void patch('concept', v) }}
                className="w-full resize-y bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
              />
            </CardContent>
          </Card>

          {/* ── the plan canvas ── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-3">
              <p className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">Plan canvas</p>
              <input
                key={batch.board_name ?? ''}
                defaultValue={batch.board_name ?? ''}
                placeholder="Name this canvas…"
                aria-label="Canvas name"
                maxLength={80}
                className="min-w-0 flex-1 bg-transparent text-[15px] font-medium outline-none placeholder:text-muted-foreground"
                onBlur={e => { const v = e.target.value.trim(); if (v !== (batch.board_name ?? '')) void patch('board_name', v) }}
              />
              <span className="ml-auto font-mono text-[12px] tabular-nums text-muted-foreground">
                {canvasCards.length === 1 ? '1 card' : `${canvasCards.length} cards`}
              </span>
            </div>
            <BriefBoardComments batchId={batch.id} cards={canvasCards}>
              <BriefCanvas
                cards={canvasCards}
                references={canvasRefs}
                canEdit
                clientName={batch.clients?.name}
                onOp={async (op: CanvasOp) => {
                  const res = await fetch(`/api/production/batches/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ canvas_op: op }),
                  })
                  if (!res.ok) {
                    toast.error('Could not save the canvas')
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
        </div>

        {/* ── the rail ── */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          {today && (
            <WherePanel batch={batch} role={role as never} viewerId={viewerId} today={today}
              itemCount={deliverableItems.length} busy={busy !== null} nameOf={nameOf} clientEmail={clientEmail}
              onPatch={patchThenLoad} onMove={moveStage} onShareClient={shareWithClient} />
          )}
          <PeoplePanel batch={batch} crew={crew} team={team} busy={busy !== null} onPatch={patchThenLoad} onUnack={unacknowledge} />
          <EditorCardPanel batch={batch} items={items} editorName={nameOf(batch.editor_id)} />
          <PortalPanel batch={batch} portalToken={portalToken} onPatch={patchThenLoad} />
          <BriefComments batchId={batch.id} cards={canvasCards} />
        </div>
      </div>

      {/* ── a booked date moves with a reason ── */}
      <AlertDialog open={dateOpen} onOpenChange={o => busy === null && setDateOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change a booked date?</AlertDialogTitle>
            <AlertDialogDescription>
              The team committed to {stampWords(batch.shoot_date)}. Say why it is moving — the change is logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3">
            <Input type="date" value={dateDraft.shoot_date} aria-label="New shoot date" className="h-11 font-mono text-[14px]"
              onChange={e => setDateDraft(d => ({ ...d, shoot_date: e.target.value }))} />
            <p className="-mt-2 text-[12px] text-muted-foreground">
              {dateDraft.shoot_date ? `Moving it to ${stampWords(dateDraft.shoot_date)}` : 'The new date is read back here in words.'}
            </p>
            <Input value={dateDraft.reason} placeholder="Why is the date moving?" aria-label="Why the date is moving" className="h-11"
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
                if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error ?? 'Could not change the date'); return }
                setDateOpen(false)
                toast.success(`Date moved to ${stampWords(dateDraft.shoot_date)}`)
                void load()
              }}>
              {busy === 'date' ? 'Saving…' : 'Move the date'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── delete an empty shoot ── */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{batch.title}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              The plan, its shot list and its canvas go. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-accent-red text-cream hover:bg-accent-red/90"
              onClick={async e => {
                e.preventDefault()
                const res = await fetch(`/api/production/batches/${id}`, { method: 'DELETE' })
                if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error ?? 'Could not delete'); return }
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
