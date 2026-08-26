'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Plus } from 'lucide-react'
import { KIND_COLORS } from '../../lib/work-kinds-core'
import { useRole } from '../useRole'
import { uploadMedia } from '../uploadMedia'

export type ClientRow = { id: string; name: string }
export type Batch = {
  id: string; title: string; client_id: string; shoot_date?: string | null
  status?: 'brief' | 'locked' | 'shot' | 'wrapped'
  clients?: { name: string } | null
  content_items?: { count: number }[]
}

const CONTENT_TYPES = ['reel', 'carousel', 'story', 'static', 'video', 'other']

/** Job titles as people say them. */
const ROLE_WORD: Record<string, string> = {
  super_admin: 'super admin',
  account_manager: 'account manager',
  scheduler: 'scheduler',
  editor: 'editor',
}

const BLANK = {
  client_id: '', batch_id: '', title: '', content_type: 'reel', priority: 'normal', due_date: '', count: 1,
  owner_id: '', work_kind_id: '', raw_assets_url: '', brief: '', brief_url: '',
  deliverables: [] as { type: string; qty: number }[],
  raw_assets: [] as { url: string; name: string }[],
}

/**
 * "New work" — the one dialog every work page opens.
 *
 * It used to live inside the production board, which meant the Editor and
 * Scheduler pages could not create anything without copying 200 lines of it.
 * The page says WHICH kind of thing is being made (`presetKind`) and what it
 * already knows (`preset`); the dialog owns everything else — the AI work-kind
 * hint, the uploads, the manager-only fields.
 */
export default function NewItemDialog({
  open, onOpenChange, onCreated, presetKind, preset, clients, batches, briefedBatchIds,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** the rows the server actually created — the caller may need to widen a
   *  filter so the person can see what they just made */
  onCreated: (created?: { id: string; owner_id?: string | null }[]) => void
  presetKind?: 'shoot_brief' | 'task'
  preset?: { client_id?: string; batch_id?: string }
  clients: ClientRow[]
  batches: Batch[]
  /** shoots that already have a brief task — they cannot take a second one */
  briefedBatchIds?: string[]
}) {
  const [newBusy, setNewBusy] = useState(false)
  const [draft, setDraft] = useState({ ...BLANK })
  const assetFileRef = useRef<HTMLInputElement>(null)
  const [assetBusy, setAssetBusy] = useState(false)
  // AI work-kind suggestion: fires ~1s after the title/brief stops changing;
  // only a hint — applying it is always the human's click
  const [kindHint, setKindHint] = useState<
    { match: 'existing'; kind_id: string; name: string } | { match: 'new'; name: string; color: string } | null
  >(null)
  const kindTouchedRef = useRef(false)
  // making a task type on the spot: null = the dropdown as usual, a string =
  // the name field is open. A type is data, and the dialog is where the gap
  // in the data is noticed.
  const [newKindName, setNewKindName] = useState<string | null>(null)
  const [newKindBusy, setNewKindBusy] = useState(false)
  const onAssetFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setAssetBusy(true)
    try {
      // straight to R2, same as deliverables — the API body cap never sees them
      for (const f of Array.from(files)) {
        const { url } = await uploadMedia(f, { purpose: 'production' })
        setDraft(d => ({ ...d, raw_assets: [...d.raw_assets, { url, name: f.name }] }))
      }
      toast.success(files.length === 1 ? 'File uploaded' : `${files.length} files uploaded`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setAssetBusy(false)
      if (assetFileRef.current) assetFileRef.current.value = ''
    }
  }
  useEffect(() => {
    if (!open || kindTouchedRef.current) return
    const title = draft.title.trim()
    const brief = draft.brief.trim()
    if (title.length < 4 && brief.length < 12) { setKindHint(null); return }
    const t = window.setTimeout(() => {
      void fetch('/api/production/work-kinds/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, brief }),
      })
        .then(r => (r.ok ? r.json() : null))
        .then(j => setKindHint(j?.suggestion ?? null))
        .catch(() => setKindHint(null))
    }, 900)
    return () => window.clearTimeout(t)
  }, [open, draft.title, draft.brief])

  // managers assign the job to an editor at creation; the editor gets the
  // job-pack email (brief + raw assets + due date)
  const { can } = useRole()
  const isManager = can('account_manager')
  const [team, setTeam] = useState<{ id: string; name: string; email: string; role: string }[]>([])
  const [kinds, setKinds] = useState<{ id: string; slug: string; name: string; color: string; uses_media: boolean; default_roles: string[]; active: boolean }[]>([])
  useEffect(() => {
    if (!isManager) return
    fetch('/api/team')
      .then(r => (r.ok ? r.json() : { members: [] }))
      .then(json => setTeam(
        (json.members ?? [])
          // anyone on the team can carry a task — clients never
          .filter((m: { role: string; active_status?: boolean }) => m.role !== 'client' && m.active_status !== false)
          .map((m: { id: string; name: string; email: string; role: string }) => ({ id: m.id, name: m.name, email: m.email, role: m.role })),
      ))
      .catch(() => setTeam([]))
  }, [isManager])
  useEffect(() => {
    fetch('/api/production/work-kinds?active=1')
      .then(r => (r.ok ? r.json() : null))
      .then(j => setKinds(j?.kinds ?? []))
      .catch(() => {})
  }, [])

  /** Mint a task type from here and select it. Tasks have nothing to post, so
   *  the new kind uses no media — that is what keeps it off the Scheduler and
   *  out of the client's agreement. AM-gated, exactly like the API. */
  const createKind = async () => {
    const name = (newKindName ?? '').trim()
    if (!name || newKindBusy) return
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
    if (!slug) { toast.error('Give the type a name with some letters in it'); return }
    setNewKindBusy(true)
    try {
      const res = await fetch('/api/production/work-kinds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug, name, default_roles: [], uses_media: false,
          // a colour per type so the board stays readable; cycles the palette
          color: KIND_COLORS[kinds.length % KIND_COLORS.length],
        }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) { toast.error(j?.error ?? 'Could not create the work type'); return }
      setKinds(ks => [...ks, j])
      kindTouchedRef.current = true
      setDraft(d => ({ ...d, work_kind_id: j.id }))
      setNewKindName(null)
      toast.success(`New task type "${name}" created`)
    } catch {
      toast.error('Could not create the work type')
    } finally {
      setNewKindBusy(false)
    }
  }

  const [adhocReason, setAdhocReason] = useState('')
  // does this need the client's sign-off, or can a manager finish it in-house?
  // An asset says yes by default; an internal task never asks the client.
  const [clientApproval, setClientApproval] = useState(true)

  // What the caller already knows, folded in when the dialog opens. The two
  // fields are read out as primitives on purpose: an inline `preset={{…}}`
  // object is a new identity every render, and depending on it would loop.
  const presetClient = preset?.client_id
  const presetBatch = preset?.batch_id
  useEffect(() => {
    if (!open || (!presetClient && !presetBatch)) return
    setDraft(d => ({
      ...d,
      client_id: presetClient ?? d.client_id,
      batch_id: presetBatch ?? d.batch_id,
    }))
  }, [open, presetClient, presetBatch])

  // A brief is made from the Production page, an asset from the Editor page —
  // never by accident from the other one. Preset: lock the kind and hide the
  // chooser. No preset: the brief kind is not in the list at all.
  const briefKind = kinds.find(k => k.slug === 'shoot_brief') ?? null
  // a TASK (research, strategy, copy) is any kind with no media that is not
  // a brief; it is made from Production and never offered on the Editor page
  const taskKinds = kinds.filter(k => k.slug !== 'shoot_brief' && !k.uses_media)
  const selectableKinds = presetKind === 'shoot_brief' ? kinds
    : presetKind === 'task' ? taskKinds
    : kinds.filter(k => k.slug !== 'shoot_brief' && k.uses_media)
  useEffect(() => {
    if (presetKind === 'task') {
      const first = taskKinds[0]
      if (first) setDraft(d => (taskKinds.some(k => k.id === d.work_kind_id) ? d : { ...d, work_kind_id: first.id }))
      return
    }
    if (presetKind !== 'shoot_brief' || !briefKind) return
    setDraft(d => (d.work_kind_id === briefKind.id ? d : { ...d, work_kind_id: briefKind.id }))
  }, [presetKind, briefKind, taskKinds])

  // Leaving the work type alone sends no work_kind_id at all, and the server
  // resolves that to the 'edit' kind — so the row that means "I didn't choose"
  // has to be labelled with the kind that actually gets used, not with
  // whatever happens to sort first.
  const defaultKind = (presetKind === 'task' ? null : kinds.find(k => k.slug === 'edit')) ?? selectableKinds[0] ?? null

  // the chosen work kind reshapes the dialog: a shoot BRIEF is planned, not
  // produced — no footage fields, its own gate, deliverables instead of type
  const selectedKind = kinds.find(k => k.id === draft.work_kind_id) ?? defaultKind
  const isBriefKind = selectedKind?.slug === 'shoot_brief'
  const isTaskKind = presetKind === 'task'
  const hidesMedia = selectedKind ? !selectedKind.uses_media : false

  /** an asset with no shoot behind it needs a reason, and the reason is logged */
  const needsAdhocReason = !isBriefKind && !isTaskKind && isManager && !draft.batch_id
  /** a non-manager with no locked shoot to pick cannot create an asset at all */
  const shootChoices = batches
    .filter(b => ['locked', 'shot'].includes(b.status ?? 'shot'))
    .filter(b => !draft.client_id || b.client_id === draft.client_id)
  // the shoots a BRIEF may attach to: this client's, not finished, and not
  // already carrying one (the DB has a one-brief-per-shoot unique index)
  const briefableShoots = batches.filter(b =>
    (!draft.client_id || b.client_id === draft.client_id)
    && (b.status ?? 'brief') !== 'wrapped'
    && !(briefedBatchIds ?? []).includes(b.id))
  const blockedNoShoot = !isBriefKind && !isTaskKind && !isManager && shootChoices.length === 0

  const createItems = async () => {
    if (!draft.client_id || !draft.title.trim()) return toast.error('Client and title are required')
    if (isBriefKind && draft.deliverables.length === 0) {
      return toast.error('Add at least one deliverable — the brief is the promise of what gets made.')
    }
    if (needsAdhocReason && !adhocReason.trim()) {
      return toast.error('Say why this has no shoot — it goes in the log.')
    }
    setNewBusy(true)
    try {
      const count = isBriefKind || isTaskKind ? 1 : Math.min(Math.max(1, draft.count), 30)
      const payload = Array.from({ length: count }, (_, i) => ({
        client_id: draft.client_id,
        batch_id: draft.batch_id || null,
        title: count === 1 ? draft.title.trim() : `${draft.title.trim()} ${String(i + 1).padStart(2, '0')}`,
        content_type: isTaskKind ? 'other' : draft.content_type,
        priority: draft.priority,
        due_date: draft.due_date || null,
        ...(draft.owner_id ? { owner_id: draft.owner_id } : {}),
        ...(draft.work_kind_id ? { work_kind_id: draft.work_kind_id } : {}),
        ...(isBriefKind ? {
          brief_url: draft.brief_url.trim() || null,
          planned_deliverables: draft.deliverables,
          // an explicitly chosen shoot, or null to create one with the brief
          batch_id: draft.batch_id || null,
        } : {}),
        ...(isTaskKind ? { batch_id: null } : {}),
        raw_assets_url: draft.raw_assets_url.trim() || null,
        brief: draft.brief.trim() || null,
        raw_assets: draft.raw_assets,
        // a task is finished in-house; a brief always goes to the client
        client_approval_required: isTaskKind ? false : isBriefKind ? true : clientApproval,
      }))
      const res = await fetch('/api/production/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload, ...(draft.batch_id ? {} : { adhoc_reason: adhocReason.trim() }) }),
      })
      const created = await res.json().catch(() => null)
      if (!res.ok) throw new Error(created?.error ?? 'Create failed')
      toast.success(
        isTaskKind ? 'Task created — it is on Production, under Tasks'
          : isBriefKind ? 'Brief task created — it is on Production, under Briefs being planned'
          : count === 1 ? 'Content item created — it is on the Editor board, in Drafting'
          : `${count} content items created — they are on the Editor board, in Drafting`,
      )
      onOpenChange(false)
      setDraft({ ...BLANK })
      setAdhocReason('')
      setClientApproval(true)
      onCreated(Array.isArray(created) ? created : undefined)
    } catch (e) {
      // "Failed to fetch" is the RESPONSE dying, not the request — the server
      // may well have created everything. Check before inviting a retry that
      // would duplicate the batch.
      if (e instanceof TypeError) {
        toast.message('Network hiccup — checking whether they were created…')
        onCreated()
        toast.message('Board refreshed. If your items are there, do NOT create them again.')
      } else {
        toast.error(e instanceof Error ? e.message : 'Create failed')
      }
    } finally {
      setNewBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (newBusy) return; onOpenChange(o); kindTouchedRef.current = false; setKindHint(null); setNewKindName(null) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isBriefKind ? 'New brief task' : isTaskKind ? 'New task' : `New content item${draft.count > 1 ? 's' : ''}`}</DialogTitle>
          <DialogDescription className="text-xs">* required</DialogDescription>
        </DialogHeader>
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
          {/* a brief belongs to a shoot. Without this picker "New brief task"
              silently created a SECOND shoot beside the one already there. */}
          {isBriefKind && (
            <div className="grid gap-1.5">
              <Label>Which shoot?</Label>
              <Select value={draft.batch_id || 'new'}
                onValueChange={v => setDraft(d => ({ ...d, batch_id: v === 'new' ? '' : v ?? '' }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">…or start a new shoot</SelectItem>
                  {briefableShoots.map(b => (
                    <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {!draft.client_id
                  ? 'Choose a client to see their shoots.'
                  : briefableShoots.length === 0
                    ? 'This client has no shoot waiting for a brief — one will be created with this task.'
                    : draft.batch_id
                      ? 'The brief attaches to that shoot; no new shoot is created.'
                      : 'A new shoot will be created with this brief.'}
              </p>
            </div>
          )}
          {!isBriefKind && !isTaskKind && (
          <div className="grid gap-1.5">
            <Label>Shoot</Label>
            <Select value={draft.batch_id || 'none'} onValueChange={v => setDraft(d => ({ ...d, batch_id: v === 'none' ? '' : v ?? '' }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {isManager && (
                  <SelectItem value="none">Ad-hoc item (no shoot)</SelectItem>
                )}
                {shootChoices.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {needsAdhocReason && (
              <Input value={adhocReason} placeholder="Why no shoot? (required — this is logged)"
                onChange={e => setAdhocReason(e.target.value)} className="text-xs" />
            )}
            {blockedNoShoot && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                No shoot is ready for this client yet. Ask an account manager to lock a
                shoot date, or plan one on{' '}
                <a href="/dashboard/production" className="underline underline-offset-2">Production</a>.
              </p>
            )}
          </div>
          )}
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Title * {draft.count > 1 && <span className="text-xs text-zinc-400">(numbered automatically)</span>}</Label>
            <Input value={draft.title} placeholder={isTaskKind ? "e.g. Competitor research — October" : isBriefKind ? "e.g. October clinic day" : "e.g. May shoot — BTS reel"} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
          </div>
          {!isBriefKind && !isTaskKind && (
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <Select value={draft.content_type} onValueChange={v => v && setDraft(d => ({ ...d, content_type: v }))}>
              {/* the trigger renders the item's own text — capitalising only
                  the list left `reel` showing in the closed control */}
              <SelectTrigger className="capitalize"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONTENT_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          )}
          <div className="grid gap-1.5">
            <Label>Priority</Label>
            <Select value={draft.priority} onValueChange={v => v && setDraft(d => ({ ...d, priority: v }))}>
              <SelectTrigger className="capitalize"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['low', 'normal', 'high', 'urgent'].map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>{isBriefKind ? 'Target shoot date' : 'Due date'}</Label>
            <Input type="date" value={draft.due_date} onChange={e => setDraft(d => ({ ...d, due_date: e.target.value }))} className="font-mono" />
            {/* the picker's own order follows the BROWSER's locale, which is
                not ours to set — so echo the date back in words. An Australian
                typing 09/15 for 15 September sees it immediately. */}
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
              {draft.due_date
                ? new Date(`${draft.due_date}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
                : 'Shown in words once picked.'}
            </p>
          </div>
          {!isBriefKind && !isTaskKind && (
          <div className="grid gap-1.5">
            <Label>How many?</Label>
            <Input type="number" min={1} max={30} value={draft.count}
              onChange={e => setDraft(d => ({ ...d, count: Number(e.target.value) || 1 }))} className="font-mono" />
          </div>
          )}
          {selectableKinds.length > 0 && presetKind !== 'shoot_brief' && (
            <div className="grid gap-1.5">
              <Label>
                {isTaskKind ? 'Task type *' : 'Work type'}
                <span className="ml-1 text-xs font-normal text-zinc-400">
                  {isTaskKind ? '' : '(optional — defaults below)'}
                </span>
              </Label>
              <Select value={draft.work_kind_id || 'default'}
                onValueChange={v => {
                  if (v === '__new__') { setKindHint(null); setNewKindName(''); return }
                  kindTouchedRef.current = true
                  setKindHint(null)
                  setNewKindName(null)
                  setDraft(d => ({ ...d, work_kind_id: v === 'default' ? '' : v ?? '' }))
                }}>
                <SelectTrigger className={newKindName !== null ? 'hidden' : undefined}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">{defaultKind?.name ?? 'Video edit'}</SelectItem>
                  {selectableKinds.filter(k => k.id !== defaultKind?.id)
                    .map(k => <SelectItem key={k.id} value={k.id}>{k.name}</SelectItem>)}
                  {isTaskKind && isManager && <SelectItem value="__new__">+ New type&hellip;</SelectItem>}
                </SelectContent>
              </Select>
              {newKindName !== null && (
                <div className="flex items-center gap-1.5">
                  <Input
                    autoFocus
                    value={newKindName}
                    maxLength={80}
                    placeholder="Name the type, e.g. Market research"
                    className="min-w-0 flex-1"
                    onChange={e => setNewKindName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void createKind() } if (e.key === 'Escape') setNewKindName(null) }}
                  />
                  <Button type="button" size="sm" disabled={newKindBusy || !newKindName.trim()}
                    onClick={() => void createKind()}>
                    {newKindBusy ? '…' : 'Add'}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={newKindBusy} aria-label="Cancel"
                    onClick={() => setNewKindName(null)}>
                    ✕
                  </Button>
                </div>
              )}
              {isTaskKind && (
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  What kind of work this is. Managers can add a type from the list.
                </p>
              )}
              {kindHint && kindHint.match === 'existing' && kindHint.kind_id !== (draft.work_kind_id || defaultKind?.id) && (
                <button type="button"
                  className="flex w-fit items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] text-violet-700 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"
                  onClick={() => { kindTouchedRef.current = true; setDraft(d => ({ ...d, work_kind_id: kindHint.kind_id })); setKindHint(null) }}>
                  ✦ Looks like <span className="font-semibold">{kindHint.name}</span> — click to use
                </button>
              )}
              {kindHint && kindHint.match === 'new' && isManager && (
                <button type="button"
                  className="flex w-fit items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] text-violet-700 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"
                  onClick={async () => {
                    const hint = kindHint
                    setKindHint(null)
                    kindTouchedRef.current = true
                    const slug = hint.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
                    const res = await fetch('/api/production/work-kinds', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      // a type minted from the task dialog is a task type: no media, so it
                      // lands on Production and never on the Scheduler or the agreement
                      body: JSON.stringify({ slug, name: hint.name, color: hint.color, default_roles: [], uses_media: !isTaskKind }),
                    })
                    const j = await res.json().catch(() => null)
                    if (!res.ok) { toast.error(j?.error ?? 'Could not create the work type'); return }
                    setKinds(ks => [...ks, j])
                    setDraft(d => ({ ...d, work_kind_id: j.id }))
                    toast.success(`New work type "${hint.name}" created`)
                  }}>
                  ✦ New type? Create <span className="font-semibold">{kindHint.name}</span> and use it
                </button>
              )}
            </div>
          )}
          {isManager && (
            <div className="grid gap-1.5">
              <Label>Who&rsquo;s doing this?</Label>
              <Select value={draft.owner_id || 'none'} onValueChange={v => setDraft(d => ({ ...d, owner_id: v === 'none' ? '' : v ?? '' }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nobody yet — anyone can pick it up</SelectItem>
                  {(() => {
                    const kind = selectedKind
                    const suggested = kind ? team.filter(m => kind.default_roles.includes(m.role)) : []
                    const ids = new Set(suggested.map(m => m.id))
                    const rest = team.filter(m => !ids.has(m.id))
                    return (
                      <>
                        {suggested.length > 0 && (
                          <SelectGroup>
                            <SelectLabel>Suggested for this work type</SelectLabel>
                            {suggested.map(m => (
                              <SelectItem key={m.id} value={m.id}>{m.name || m.email}</SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                        {rest.map(m => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name || m.email} · {ROLE_WORD[m.role] ?? m.role}
                          </SelectItem>
                        ))}
                      </>
                    )
                  })()}
                </SelectContent>
              </Select>
            </div>
          )}
          {/* does the client have to sign this off, or can we finish it in
              house? A task never asks; a brief always does. */}
          {!isTaskKind && !isBriefKind && (
            <label className="flex items-center gap-2.5 self-end pb-1.5 text-sm sm:col-span-2">
              <Switch checked={clientApproval} onCheckedChange={setClientApproval} />
              <span>
                Client must approve this
                <span className="block text-[11px] text-zinc-400 dark:text-zinc-500">
                  Off means an account manager can approve it without sending it out.
                </span>
              </span>
            </label>
          )}
          {!hidesMedia && (
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Folder link <span className="text-xs font-normal text-zinc-400">(Dropbox / Drive — what the editor works from)</span></Label>
            <Input value={draft.raw_assets_url} placeholder="https://www.dropbox.com/…"
              onChange={e => setDraft(d => ({ ...d, raw_assets_url: e.target.value }))} className="font-mono text-xs" />
          </div>
          )}
          {isBriefKind && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Brief link <span className="text-xs font-normal text-zinc-400">(Milanote or anywhere — or write the concept and shot list on the shoot page)</span></Label>
              <Input value={draft.brief_url} placeholder="https://app.milanote.com/…"
                onChange={e => setDraft(d => ({ ...d, brief_url: e.target.value }))} className="font-mono text-xs" />
            </div>
          )}
          {isBriefKind && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Deliverables * <span className="text-xs font-normal text-zinc-400">(what the shoot must produce)</span></Label>
              {draft.deliverables.map((d0, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={d0.type} onValueChange={v => v && setDraft(d => ({
                    ...d, deliverables: d.deliverables.map((x, j) => j === i ? { ...x, type: v } : x),
                  }))}>
                    <SelectTrigger className="flex-1 capitalize"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONTENT_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="number" min={1} value={d0.qty} className="w-20 text-center font-mono"
                    onChange={e => setDraft(d => ({
                      ...d, deliverables: d.deliverables.map((x, j) => j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x),
                    }))} />
                  <button type="button" aria-label="Remove deliverable"
                    onClick={() => setDraft(d => ({ ...d, deliverables: d.deliverables.filter((_, j) => j !== i) }))}
                    className="text-zinc-400 hover:text-red-500">&#10005;</button>
                </div>
              ))}
              <Button type="button" variant="ghost" size="sm" className="w-fit text-zinc-500"
                onClick={() => setDraft(d => ({ ...d, deliverables: [...d.deliverables, { type: 'reel', qty: 1 }] }))}>
                <Plus className="h-3.5 w-3.5" /> Add deliverable
              </Button>
            </div>
          )}
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>{isBriefKind ? 'Note to reviewer' : isTaskKind ? 'What needs doing' : 'Brief'} <span className="text-xs font-normal text-zinc-400">{isBriefKind ? '(context for whoever reviews the brief)' : isTaskKind ? '(the ask, in a few lines — sent to whoever takes it)' : '(what the edit should be — sent to the editor)'}</span></Label>
            <Textarea rows={3} value={draft.brief} placeholder={isBriefKind ? 'Going with the garden concept — see the moodboard for tone…' : isTaskKind ? 'e.g. Pull the top five competitors’ last 30 days of posts and note what is working.' : 'Hook in the first 2s, use the b-roll from cam B, end on the offer…'}
              onChange={e => setDraft(d => ({ ...d, brief: e.target.value }))} />
          </div>
          {!hidesMedia && (
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>Files <span className="text-xs font-normal text-zinc-400">(uploaded for the editor — or use the folder link for full shoots)</span></Label>
            {draft.raw_assets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {draft.raw_assets.map(a => (
                  <Badge key={a.url} variant="secondary" className="gap-1 font-normal">
                    <span className="max-w-40 truncate">{a.name}</span>
                    <button type="button" aria-label={`Remove ${a.name}`}
                      onClick={() => setDraft(d => ({ ...d, raw_assets: d.raw_assets.filter(x => x.url !== a.url) }))}
                      className="text-zinc-400 hover:text-red-500">✕</button>
                  </Badge>
                ))}
              </div>
            )}
            <input ref={assetFileRef} type="file" multiple className="hidden"
              onChange={e => void onAssetFiles(e.target.files)} />
            <Button type="button" variant="outline" size="sm" className="w-fit"
              disabled={assetBusy} onClick={() => assetFileRef.current?.click()}>
              <Plus className="h-3.5 w-3.5" /> {assetBusy ? 'Uploading…' : 'Add files'}
            </Button>
          </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={newBusy}>Cancel</Button>
          <Button onClick={createItems} disabled={newBusy || blockedNoShoot}>{newBusy ? 'Creating…' : isBriefKind ? 'Create brief task' : isTaskKind ? 'Create task' : `Create ${draft.count > 1 ? draft.count + ' items' : 'item'}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
