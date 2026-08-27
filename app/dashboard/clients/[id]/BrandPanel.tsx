'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { useRealtime } from 'inngest/react'
import {
  ArrowDown, ArrowUp, AtSign, Check, Copy, FileUp, GripVertical, Hash, Image as ImageIcon,
  Loader2, MessageSquare, Palette, Plus, RefreshCw, Sparkles, StickyNote, Trash2, Type, X,
} from 'lucide-react'
import { brandChannel } from '@/app/inngest/channels'
import { LoadOrder } from '@/app/lib/load-order'
import {
  COLOUR_ROLES, COLOUR_ROLE_LABEL, FONT_ROLES, FONT_ROLE_LABEL, applyProposal, asHandle, asHashtag,
  emptyProfile, moveItem, normaliseHex, normaliseProfile, profileHasContent,
  type BrandColour, type BrandFont, type BrandProfile, type ColourRole, type FontRole, type Proposal,
} from '@/app/lib/brand-profile-core'
import { fetchBrandSubscriptionToken } from './brandActions'

/**
 * The client's brand, kept by the team. A scan of the guidelines PDF fills it
 * the first time; after that every value here is editable in place — click a
 * value to change it, Enter saves, Esc cancels — and a later scan only
 * PROPOSES additions, reviewed in a sheet, so a hand edit is never lost.
 *
 * Saves are automatic, a moment after the last change, with the revision
 * check the API enforces: a colleague's newer save wins and this page reloads.
 */

type Doc = { filename: string; url: string; scanned_at: string }
type Loaded = { profile: BrandProfile; proposal: Proposal | null; docs: Doc[]; can_edit: boolean; last_scan_at: string | null }
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function copyText(value: string, label: string) {
  navigator.clipboard.writeText(value)
    .then(() => toast.success(`Copied ${label}`))
    .catch(() => toast.error('Could not copy'))
}

/** 44px tap floor on the small controls, so phones can hit them */
const TAP = 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center sm:min-h-[36px] sm:min-w-[36px]'
const ICON_BTN = `${TAP} rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40`

// ── inline editing ──────────────────────────────────────────────────────────

/**
 * Text that turns into a field when clicked. Enter saves (Shift+Enter is a
 * newline in a paragraph), Esc puts the old value back, leaving the field
 * saves too — nobody should lose a change by tapping elsewhere.
 */
function Editable({ value, onSave, placeholder, canEdit, multiline, className = '', mono }: {
  value: string
  onSave: (next: string) => void
  placeholder: string
  canEdit: boolean
  multiline?: boolean
  className?: string
  mono?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select() } }, [editing])

  const commit = () => {
    setEditing(false)
    if (draft.trim() !== value) onSave(draft.trim())
  }
  const cancel = () => { setDraft(value); setEditing(false) }

  const font = mono ? 'font-mono' : ''
  if (!canEdit) {
    return value
      ? <span className={`${className} ${font} whitespace-pre-wrap`}>{value}</span>
      : <span className={`${className} text-muted-foreground/60`}>{placeholder}</span>
  }
  if (editing) {
    const shared = {
      ref, value: draft, placeholder,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') { e.preventDefault(); cancel() }
        else if (e.key === 'Enter' && (!multiline || !e.shiftKey)) { e.preventDefault(); commit() }
      },
      className: `${className} ${font} w-full rounded-md border border-primary/50 bg-background px-2 py-1.5 text-sm outline-none ring-2 ring-primary/20`,
    }
    return multiline
      ? <textarea {...shared} rows={Math.min(8, Math.max(2, draft.split('\n').length + 1))} />
      : <input {...shared} type="text" />
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Click to edit"
      className={`${className} ${font} min-h-[36px] w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/70 ${value ? '' : 'text-muted-foreground/60'} whitespace-pre-wrap`}
    >
      {value || placeholder}
    </button>
  )
}

/** One field at the foot of a list: type, Enter, it is added, keep typing. */
function AddRow({ placeholder, onAdd, transform }: {
  placeholder: string
  onAdd: (value: string) => void
  transform?: (s: string) => string
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = (transform ?? (s => s.trim()))(draft)
    if (!v) return
    onAdd(v)
    setDraft('')
  }
  return (
    <div className="flex items-center gap-2">
      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        onBlur={add}
        className="min-h-[44px] w-full rounded-md border border-dashed border-border bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary/50 sm:min-h-[36px]"
      />
    </div>
  )
}

function Section({ icon: Icon, title, hint, count, onClear, canEdit, copy, children }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  hint?: string
  count?: number
  onClear?: () => void
  canEdit: boolean
  copy?: { value: string; label: string }
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {title}
        </h3>
        {hint && <span className="text-[11px] text-muted-foreground/80">{hint}</span>}
        <div className="ml-auto flex items-center gap-1">
          {copy && (count ?? 0) > 0 && (
            <button type="button" onClick={() => copyText(copy.value, copy.label)} className={`${ICON_BTN} px-2 text-[11px]`} title={`Copy all ${title.toLowerCase()}`}>
              <Copy className="mr-1 h-3 w-3" /> Copy all
            </button>
          )}
          {canEdit && onClear && (count ?? 0) > 0 && (
            <button type="button" onClick={onClear} className={`${ICON_BTN} px-2 text-[11px]`} title={`Remove all ${title.toLowerCase()}`}>
              <Trash2 className="mr-1 h-3 w-3" /> Remove all
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

/** A plain list of sentences: rules, dos, don'ts. */
function TextList({ items, onChange, canEdit, placeholder, empty, transform, chips }: {
  items: string[]
  onChange: (next: string[], removedLabel?: string) => void
  canEdit: boolean
  placeholder: string
  empty: string
  transform?: (s: string) => string
  /** short tokens (hashtags, handles) sit side by side */
  chips?: boolean
}) {
  const set = (i: number, v: string) => {
    const next = [...items]
    if (!v) { onChange(next.filter((_, j) => j !== i), items[i]); return }
    next[i] = v
    onChange(next)
  }
  return (
    <div className={chips ? 'flex flex-wrap items-center gap-2' : 'flex flex-col gap-1'}>
      {items.length === 0 && !canEdit && <p className="text-sm text-muted-foreground">{empty}</p>}
      {items.map((it, i) => (
        <div key={`${i}-${it}`} className={chips
          ? 'flex items-center rounded-full border border-border pl-1'
          : 'group flex items-start gap-1 rounded-md'}>
          {!chips && <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50 ml-2" />}
          <div className={chips ? '' : 'min-w-0 flex-1'}>
            <Editable value={it} onSave={v => set(i, transform ? transform(v) : v)} placeholder={placeholder} canEdit={canEdit} className={chips ? 'text-sm' : 'text-sm leading-relaxed'} />
          </div>
          {canEdit && (
            <button type="button" onClick={() => set(i, '')} className={`${ICON_BTN} ${chips ? 'min-h-[36px] min-w-[36px]' : ''}`} aria-label={`Remove "${it}"`} title="Remove">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      {canEdit && <div className={chips ? 'w-full' : ''}><AddRow placeholder={items.length === 0 ? empty : placeholder} onAdd={v => onChange([...items, v])} transform={transform} /></div>}
    </div>
  )
}

/** Drag handle + up/down arrows: drag on a desk, arrows on a phone. */
function Reorder({ index, count, onMove, dragProps }: {
  index: number
  count: number
  onMove: (to: number) => void
  dragProps: React.HTMLAttributes<HTMLDivElement>
}) {
  return (
    <div className="flex shrink-0 items-center">
      <div {...dragProps} className="hidden cursor-grab touch-none items-center text-muted-foreground/60 hover:text-foreground sm:flex" title="Drag to reorder">
        <GripVertical className="h-4 w-4" />
      </div>
      <div className="flex flex-col sm:hidden">
        <button type="button" onClick={() => onMove(index - 1)} disabled={index === 0} className="flex h-[22px] w-[44px] items-center justify-center text-muted-foreground disabled:opacity-30" aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => onMove(index + 1)} disabled={index === count - 1} className="flex h-[22px] w-[44px] items-center justify-center text-muted-foreground disabled:opacity-30" aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  )
}

/** HTML5 drag-to-reorder for a list, shared by colours and fonts. */
function useDragList(onMove: (from: number, to: number) => void) {
  const from = useRef<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const props = (i: number) => ({
    handle: {
      draggable: true,
      onDragStart: (e: React.DragEvent) => { from.current = i; e.dataTransfer.effectAllowed = 'move' },
      onDragEnd: () => { from.current = null; setOver(null) },
    } as React.HTMLAttributes<HTMLDivElement>,
    row: {
      onDragOver: (e: React.DragEvent) => { if (from.current !== null) { e.preventDefault(); setOver(i) } },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        if (from.current !== null && from.current !== i) onMove(from.current, i)
        from.current = null; setOver(null)
      },
      className: over === i && from.current !== i ? 'ring-2 ring-primary/40' : '',
    },
  })
  return props
}

const selectCls = 'min-h-[44px] rounded-md border border-border bg-background px-2 text-sm sm:min-h-[36px]'

function ColourList({ colours, onChange, canEdit }: {
  colours: BrandColour[]
  onChange: (next: BrandColour[], removedLabel?: string) => void
  canEdit: boolean
}) {
  const drag = useDragList((from, to) => onChange(moveItem(colours, from, to)))
  const patch = (i: number, p: Partial<BrandColour>) => onChange(colours.map((c, j) => (j === i ? { ...c, ...p } : c)))
  const setHex = (i: number, raw: string) => {
    const hex = normaliseHex(raw)
    if (!hex) { toast.error('Use a colour code like #1A2B3C'); return }
    if (colours.some((c, j) => j !== i && c.hex === hex)) { toast.error(`${hex} is already in the list`); return }
    patch(i, { hex })
  }
  return (
    <div className="flex flex-col gap-1.5">
      {colours.length === 0 && !canEdit && <p className="text-sm text-muted-foreground">No colours yet.</p>}
      {colours.map((c, i) => {
        const d = drag(i)
        return (
          <div key={c.hex} {...d.row} className={`flex items-center gap-2 rounded-md border border-border p-1.5 ${d.row.className}`}>
            {canEdit && <Reorder index={i} count={colours.length} onMove={to => onChange(moveItem(colours, i, to))} dragProps={d.handle} />}
            <label className="relative h-10 w-10 shrink-0 cursor-pointer rounded-md border border-border" style={{ backgroundColor: c.hex }} title={canEdit ? 'Pick a colour' : c.hex}>
              {canEdit && (
                <input type="color" value={c.hex.toLowerCase()} onChange={e => setHex(i, e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label={`Pick colour for ${c.name || c.hex}`} />
              )}
            </label>
            <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-x-2 sm:grid-cols-[1fr_auto_auto]">
              <Editable value={c.name} onSave={v => patch(i, { name: v })} placeholder="Name this colour" canEdit={canEdit} className="text-sm font-medium" />
              <div className="flex items-center gap-1">
                <Editable value={c.hex} onSave={v => setHex(i, v)} placeholder="#000000" canEdit={canEdit} mono className="text-xs text-muted-foreground sm:w-24" />
                <button type="button" onClick={() => copyText(c.hex, c.hex)} className={`${ICON_BTN} min-h-[36px] min-w-[36px]`} title={`Copy ${c.hex}`} aria-label={`Copy ${c.hex}`}><Copy className="h-3.5 w-3.5" /></button>
              </div>
              {canEdit ? (
                <select value={c.role} onChange={e => patch(i, { role: e.target.value as ColourRole })} className={selectCls} aria-label="What this colour is for">
                  {COLOUR_ROLES.map(r => <option key={r} value={r}>{COLOUR_ROLE_LABEL[r]}</option>)}
                </select>
              ) : <span className="text-xs text-muted-foreground">{COLOUR_ROLE_LABEL[c.role]}</span>}
            </div>
            {canEdit && (
              <button type="button" onClick={() => onChange(colours.filter((_, j) => j !== i), c.name || c.hex)} className={ICON_BTN} aria-label={`Remove ${c.name || c.hex}`} title="Remove"><X className="h-4 w-4" /></button>
            )}
          </div>
        )
      })}
      {canEdit && (
        <AddColour existing={colours} onAdd={c => onChange([...colours, c])} first={colours.length === 0} />
      )}
    </div>
  )
}

function AddColour({ existing, onAdd, first }: { existing: BrandColour[]; onAdd: (c: BrandColour) => void; first: boolean }) {
  const [hex, setHex] = useState('#3B82F6')
  const [name, setName] = useState('')
  const add = () => {
    const h = normaliseHex(hex)
    if (!h) { toast.error('Use a colour code like #1A2B3C'); return }
    if (existing.some(c => c.hex === h)) { toast.error(`${h} is already in the list`); return }
    onAdd({ name: name.trim(), hex: h, role: first ? 'primary' : 'secondary' })
    setName('')
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-1.5">
      <label className="relative h-10 w-10 shrink-0 cursor-pointer rounded-md border border-border" style={{ backgroundColor: normaliseHex(hex) ?? '#ffffff' }} title="Pick a colour">
        <input type="color" value={normaliseHex(hex)?.toLowerCase() ?? '#ffffff'} onChange={e => setHex(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Pick the new colour" />
      </label>
      <input type="text" value={name} placeholder={first ? 'No colours yet — name one, e.g. Forest green' : 'Name, e.g. Forest green'} onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        className="min-h-[44px] min-w-0 flex-1 bg-transparent px-2 text-sm outline-none sm:min-h-[36px]" />
      <input type="text" value={hex} onChange={e => setHex(e.target.value)} placeholder="#1A2B3C"
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        className="min-h-[44px] w-28 bg-transparent px-2 font-mono text-xs outline-none sm:min-h-[36px]" aria-label="Colour code" />
      <Button type="button" size="sm" variant="outline" onClick={add} className="min-h-[44px] sm:min-h-[36px]"><Plus className="mr-1 h-3.5 w-3.5" /> Add colour</Button>
    </div>
  )
}

function FontList({ fonts, onChange, canEdit }: {
  fonts: BrandFont[]
  onChange: (next: BrandFont[], removedLabel?: string) => void
  canEdit: boolean
}) {
  const drag = useDragList((from, to) => onChange(moveItem(fonts, from, to)))
  const patch = (i: number, p: Partial<BrandFont>) => onChange(fonts.map((f, j) => (j === i ? { ...f, ...p } : f)))
  const add = (name: string) => {
    if (fonts.some(f => f.name.toLowerCase() === name.toLowerCase())) { toast.error(`${name} is already in the list`); return }
    onChange([...fonts, { name, role: fonts.length === 0 ? 'heading' : 'body' }])
  }
  return (
    <div className="flex flex-col gap-1.5">
      {fonts.length === 0 && !canEdit && <p className="text-sm text-muted-foreground">No fonts yet.</p>}
      {fonts.map((f, i) => {
        const d = drag(i)
        return (
          <div key={f.name} {...d.row} className={`flex items-center gap-2 rounded-md border border-border p-1.5 ${d.row.className}`}>
            {canEdit && <Reorder index={i} count={fonts.length} onMove={to => onChange(moveItem(fonts, i, to))} dragProps={d.handle} />}
            <div className="grid min-w-0 flex-1 grid-cols-1 items-center gap-x-2 sm:grid-cols-[1fr_auto_minmax(0,1fr)]">
              <Editable value={f.name} onSave={v => { if (v) patch(i, { name: v }); else onChange(fonts.filter((_, j) => j !== i), f.name) }} placeholder="Font name" canEdit={canEdit} className="text-base font-semibold" />
              {canEdit ? (
                <select value={f.role} onChange={e => patch(i, { role: e.target.value as FontRole })} className={selectCls} aria-label="Where this font is used">
                  {FONT_ROLES.map(r => <option key={r} value={r}>{FONT_ROLE_LABEL[r]}</option>)}
                </select>
              ) : <span className="text-xs text-muted-foreground">{FONT_ROLE_LABEL[f.role]}</span>}
              {canEdit || f.url ? (
                <Editable value={f.url ?? ''} onSave={v => {
                  if (v && !/^https?:\/\//i.test(v)) { toast.error('A link starts with https://'); return }
                  patch(i, { url: v || undefined })
                }} placeholder="Link to the font (optional)" canEdit={canEdit} className="truncate text-xs text-muted-foreground" />
              ) : null}
            </div>
            {canEdit && (
              <button type="button" onClick={() => onChange(fonts.filter((_, j) => j !== i), f.name)} className={ICON_BTN} aria-label={`Remove ${f.name}`} title="Remove"><X className="h-4 w-4" /></button>
            )}
          </div>
        )
      })}
      {canEdit && <AddRow placeholder={fonts.length === 0 ? 'No fonts yet — type a font name, e.g. Lora' : 'Add a font, e.g. Inter'} onAdd={add} />}
    </div>
  )
}

// ── the panel ───────────────────────────────────────────────────────────────

export default function BrandPanel({ clientId }: { clientId: string }) {
  const [profile, setProfile] = useState<BrandProfile>(emptyProfile)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; message?: string } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmClear, setConfirmClear] = useState<{ label: string; run: () => void } | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const fileRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef(false)
  /** answers land in the order they are fresh, never a stale one on top */
  const order = useRef(new LoadOrder<Loaded>())
  /** unsaved edits exist — a refetch must not put the server's copy over them */
  const dirtyRef = useRef(false)
  const saveTimer = useRef<number | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const profileRef = useRef(profile)
  profileRef.current = profile

  /** how many answers have reached the screen — the post-scan review waits for one */
  const [loads, setLoads] = useState(0)
  const applyLoaded = useCallback((json: Loaded) => {
    if (!dirtyRef.current && !inFlight.current) setProfile(normaliseProfile(json.profile))
    setProposal(json.proposal)
    setDocs(json.docs ?? [])
    setCanEdit(Boolean(json.can_edit))
    setLoads(n => n + 1)
  }, [])

  const load = useCallback(async () => {
    const seq = order.current.begin()
    try {
      const [profRes, scanRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/brand/profile`),
        fetch(`/api/clients/${clientId}/brand`),
      ])
      if (!profRes.ok) { order.current.fail(seq); return }
      const json = await profRes.json() as Loaded
      const settled = order.current.settle(seq, json)
      if (settled.apply) applyLoaded(settled.value)
      if (scanRes.ok) {
        const s = await scanRes.json() as { scan?: { status: string; done: number; total: number; message?: string | null } }
        if (s.scan?.status === 'scanning' || s.scan?.status === 'queued') {
          setScanning(true)
          setProgress({ done: s.scan.done, total: s.scan.total, message: s.scan.message ?? undefined })
        } else if (!uploadRef.current) {
          setScanning(false); setProgress(null)
        }
      }
      setLoaded(true)
    } catch {
      order.current.fail(seq)
    }
  }, [clientId, applyLoaded])

  useEffect(() => { void load() }, [load])

  // a hidden tab suspends the socket; the stored status is the truth
  useEffect(() => {
    if (!scanning) return
    const id = window.setInterval(() => void load(), 8000)
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [scanning, load])

  const { messages } = useRealtime({
    channel: brandChannel,
    topics: ['progress'] as const,
    token: () => fetchBrandSubscriptionToken(),
    autoCloseOnTerminal: false,
    historyLimit: 20,
  })
  /** set when a scan finishes: the `loads` count at that moment, so the
   *  review waits for the refetch that carries the scan's result */
  const awaitingReview = useRef<number | null>(null)
  const loadsRef = useRef(loads)
  loadsRef.current = loads
  useEffect(() => {
    const latest = messages.last
    if (!latest) return
    const d = latest.data as { client_id: string; status: string; done: number; total: number; message?: string }
    if (!d || d.client_id !== clientId) return
    if (d.status === 'scanning') {
      setScanning(true); setProgress({ done: d.done, total: d.total, message: d.message })
    } else if (d.status === 'done') {
      setScanning(false); setProgress(null)
      awaitingReview.current = loadsRef.current
      void load()
    } else if (d.status === 'failed') {
      setScanning(false); setProgress(null)
      toast.error(d.message || 'The scan failed')
    }
  }, [messages.last, clientId, load])

  // a scan just finished: open the review straight away when it has
  // something to offer, otherwise say so — silence reads as failure
  useEffect(() => {
    if (awaitingReview.current === null || scanning || loads <= awaitingReview.current) return
    awaitingReview.current = null
    if (proposal && proposal.changes.length > 0) {
      setPicked(new Set(proposal.changes.map(c => c.id)))
      setReviewOpen(true)
    } else if (profileHasContent(profile)) {
      toast.success('Guidelines read — nothing new to add')
    } else {
      toast.error('Nothing usable was found in that document — add the brand by hand below')
    }
    // profile is read, not watched: this fires once, on the load after the scan
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loads, proposal, scanning])

  // ── saving ──
  const flush = useCallback(async () => {
    if (inFlight.current) return
    if (!dirtyRef.current) return
    dirtyRef.current = false
    setSaveState('saving')
    const body = profileRef.current
    const seq = order.current.begin()
    const run = (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/brand/profile`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile: body }),
        })
        if (res.status === 409) {
          order.current.fail(seq)
          toast.error('Someone else changed the brand profile just now — showing their version')
          dirtyRef.current = false
          inFlight.current = null
          await load()
          setSaveState('idle')
          return
        }
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))).error ?? 'Could not save'
          throw new Error(err)
        }
        const json = await res.json() as { profile: BrandProfile }
        // the content on screen may already be newer than what was sent;
        // only the revision comes back from the server
        const settled = order.current.settle(seq, { profile: json.profile, proposal: null, docs: [], can_edit: true, last_scan_at: null })
        if (settled.apply) setProfile(p => ({ ...p, rev: json.profile.rev }))
        setSaveState('saved')
      } catch (e) {
        order.current.fail(seq)
        dirtyRef.current = true
        setSaveState('error')
        toast.error(e instanceof Error ? e.message : 'Could not save')
      } finally {
        inFlight.current = null
      }
    })()
    inFlight.current = run
    await run
    // edits made while that was in flight go in the next save
    if (dirtyRef.current) void flush()
  }, [clientId, load])

  const update = useCallback((fn: (p: BrandProfile) => BrandProfile) => {
    setProfile(p => fn(p))
    dirtyRef.current = true
    setSaveState('saving')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void flush(), 600)
  }, [flush])

  /** A removal you can take back from the toast. */
  const removed = useCallback((label: string | undefined, before: BrandProfile) => {
    if (!label) return
    toast(`Removed ${label}`, {
      action: { label: 'Undo', onClick: () => update(p => ({ ...before, rev: p.rev })) },
    })
  }, [update])

  const setList = <K extends 'colours' | 'fonts' | 'logo_rules' | 'logo_files' | 'hashtags' | 'handles'>(key: K) =>
    (next: BrandProfile[K], removedLabel?: string) => {
      const before = profileRef.current
      update(p => ({ ...p, [key]: next }))
      removed(removedLabel, before)
    }
  const setVoiceList = (key: 'dos' | 'donts') => (next: string[], removedLabel?: string) => {
    const before = profileRef.current
    update(p => ({ ...p, voice: { ...p.voice, [key]: next } }))
    removed(removedLabel, before)
  }

  /** Removing many at once gets a real question; removing one is undoable. */
  const clearList = (label: string, count: number, run: () => void) => {
    if (count > 1) setConfirmClear({ label: `${count} ${label}`, run })
    else run()
  }

  // ── scan ──
  const scan = async (file: File) => {
    if (file.type !== 'application/pdf') { toast.error('Brand guidelines must be a PDF'); return }
    uploadRef.current = true
    setScanning(true)
    setProgress({ done: 0, total: 1, message: 'Uploading the PDF…' })
    try {
      const signRes = await fetch(`/api/clients/${clientId}/brand`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sign', name: file.name, size: file.size, type: file.type }),
      })
      if (!signRes.ok) throw new Error((await signRes.json()).error ?? 'Could not start the upload')
      const { signedUrl, publicUrl } = await signRes.json()
      const put = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file })
      if (!put.ok) throw new Error('Upload to storage failed')
      const scanRes = await fetch(`/api/clients/${clientId}/brand`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scan', url: publicUrl, filename: file.name }),
      })
      if (!scanRes.ok) throw new Error((await scanRes.json()).error ?? 'The scan failed')
      setProgress({ done: 0, total: 1, message: 'Reading the document…' })
      toast.info('Reading the document — this page updates as it goes')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong')
      setScanning(false); setProgress(null)
    } finally {
      uploadRef.current = false
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const reset = async () => {
    const res = await fetch(`/api/clients/${clientId}/brand`, { method: 'DELETE' })
    if (!res.ok) { toast.error('Could not clear it'); return }
    dirtyRef.current = false
    setProfile(emptyProfile()); setDocs([]); setProposal(null)
    toast.success('Brand profile cleared — upload a PDF or add things by hand')
  }

  const review = (ids: Iterable<string>) => {
    if (!proposal) return
    const count = [...ids].length
    update(p => applyProposal(p, proposal, ids))
    setProposal(null); setReviewOpen(false)
    toast.success(count > 0 ? `Added ${count} from the guidelines` : 'Skipped — the guidelines stay as they were')
  }

  if (!loaded) return <Skeleton className="h-40 w-full" />

  const hasContent = profileHasContent(profile)
  const pending = proposal?.changes.length ?? 0

  return (
    <div className="flex flex-col gap-4">
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) void scan(f) }} />

      {/* ── guidelines: scan / rescan ── */}
      <div className={'rounded-lg border p-4 sm:p-5 ' + (hasContent ? 'border-border bg-card' : 'border-primary/40 bg-primary/[0.04]')}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{hasContent ? 'Brand guidelines' : 'Start the brand profile'}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {scanning
                ? 'Reading the document. A long deck takes a few minutes — you can leave this page.'
                : hasContent
                  ? 'Everything below is editable — click a value to change it. Rescanning offers what is new; it never overwrites your edits.'
                  : 'Upload the client\'s brand PDF and the colours, fonts and voice are read into the lists below — or add them by hand.'}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canEdit && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
                {saveState === 'saving' && <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>}
                {saveState === 'saved' && <><Check className="h-3 w-3 text-emerald-600" /> Saved</>}
                {saveState === 'error' && (
                  <button type="button" onClick={() => { dirtyRef.current = true; void flush() }} className="text-destructive underline underline-offset-2">Not saved — try again</button>
                )}
              </span>
            )}
            {canEdit && (
              <Button size="sm" disabled={scanning} onClick={() => fileRef.current?.click()} className="min-h-[44px] sm:min-h-[36px]">
                {scanning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : hasContent ? <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> : <FileUp className="mr-1.5 h-3.5 w-3.5" />}
                {scanning ? 'Reading' : hasContent ? 'Rescan guidelines' : 'Upload PDF'}
              </Button>
            )}
            {canEdit && hasContent && (
              <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)} className="min-h-[44px] sm:min-h-[36px]" title="Clear the whole profile">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        {scanning && (
          <div className="mt-3 flex flex-col gap-1.5">
            <div className="h-1 w-full overflow-hidden rounded bg-muted">
              {progress && progress.total > 1
                ? <div className="h-1 rounded bg-primary transition-[width] duration-500" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
                : <div className="h-1 w-1/3 animate-pulse rounded bg-primary" />}
            </div>
            <p className="text-xs text-muted-foreground">
              {progress?.total && progress.total > 1 ? `Reading section ${progress.done + 1} of ${progress.total}…` : progress?.message ?? 'Reading the document…'}
            </p>
          </div>
        )}
        {docs.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Read from {docs.map((d, i) => (
              <span key={d.url}>{i > 0 && ', '}<a href={d.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{d.filename}</a></span>
            ))}
          </p>
        )}
        {pending > 0 && !scanning && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/[0.06] px-3 py-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            <span>The guidelines have <strong>{pending}</strong> thing{pending === 1 ? '' : 's'} not in the profile yet.</span>
            <Button size="sm" variant="outline" className="ml-auto min-h-[44px] sm:min-h-[36px]" onClick={() => { setPicked(new Set(proposal!.changes.map(c => c.id))); setReviewOpen(true) }}>
              {canEdit ? 'Review' : 'See what is new'}
            </Button>
          </div>
        )}
      </div>

      {/* ── colours ── */}
      <Section icon={Palette} title="Colours" hint="click a swatch to pick, drag to reorder" count={profile.colours.length} canEdit={canEdit}
        copy={{ label: 'every colour', value: profile.colours.map(c => [c.name, c.hex, COLOUR_ROLE_LABEL[c.role]].filter(Boolean).join(' · ')).join('\n') }}
        onClear={() => clearList('colours', profile.colours.length, () => setList('colours')([], `${profile.colours.length} colours`))}>
        <ColourList colours={profile.colours} onChange={setList('colours')} canEdit={canEdit} />
      </Section>

      {/* ── fonts ── */}
      <Section icon={Type} title="Fonts" hint="first is for headings" count={profile.fonts.length} canEdit={canEdit}
        copy={{ label: 'every font', value: profile.fonts.map(f => [f.name, FONT_ROLE_LABEL[f.role], f.url].filter(Boolean).join(' · ')).join('\n') }}
        onClear={() => clearList('fonts', profile.fonts.length, () => setList('fonts')([], `${profile.fonts.length} fonts`))}>
        <FontList fonts={profile.fonts} onChange={setList('fonts')} canEdit={canEdit} />
      </Section>

      {/* ── logo ── */}
      <Section icon={ImageIcon} title="Logo rules" count={profile.logo_rules.length + profile.logo_files.length} canEdit={canEdit}
        copy={{ label: 'the logo rules', value: profile.logo_rules.join('\n') }}
        onClear={() => clearList('logo rules', profile.logo_rules.length, () => setList('logo_rules')([], `${profile.logo_rules.length} logo rules`))}>
        <TextList items={profile.logo_rules} onChange={setList('logo_rules')} canEdit={canEdit} placeholder="Add a rule" empty="No logo rules yet — add one, e.g. Keep clear space around the logo" />
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Logo files</p>
          {profile.logo_files.length === 0 && <p className="mb-2 text-sm text-muted-foreground">No logo files linked yet.</p>}
          <ul className="flex flex-col gap-1">
            {profile.logo_files.map((f, i) => (
              <li key={f.url} className="flex items-center gap-2 text-sm">
                <a href={f.url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate underline underline-offset-2">{f.name}</a>
                {canEdit && <button type="button" onClick={() => setList('logo_files')(profile.logo_files.filter((_, j) => j !== i), f.name)} className={ICON_BTN} aria-label={`Remove ${f.name}`}><X className="h-3.5 w-3.5" /></button>}
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="mt-2">
              <AddRow placeholder="Paste a link to a logo file (https://…)" onAdd={url => {
                if (!/^https?:\/\//i.test(url)) { toast.error('A link starts with https://'); return }
                if (profile.logo_files.some(f => f.url === url)) { toast.error('That file is already listed'); return }
                setList('logo_files')([...profile.logo_files, { name: url.split('/').pop()?.split('?')[0] || 'logo', url }])
              }} />
            </div>
          )}
        </div>
      </Section>

      {/* ── voice ── */}
      <Section icon={MessageSquare} title="Voice & tone" count={profile.voice.dos.length + profile.voice.donts.length} canEdit={canEdit}
        copy={{ label: 'the voice', value: [profile.voice.tone, profile.voice.summary, ...profile.voice.dos.map(d => `Do: ${d}`), ...profile.voice.donts.map(d => `Don't: ${d}`)].filter(Boolean).join('\n') }}>
        <div className="flex flex-col gap-2">
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">In three words</p>
            <Editable value={profile.voice.tone} onSave={v => update(p => ({ ...p, voice: { ...p.voice, tone: v } }))} placeholder="e.g. Warm, direct, confident" canEdit={canEdit} className="text-sm font-medium" />
          </div>
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">How the brand speaks</p>
            <Editable value={profile.voice.summary} onSave={v => update(p => ({ ...p, voice: { ...p.voice, summary: v } }))} placeholder="A short paragraph on how the brand talks to people" canEdit={canEdit} multiline className="text-sm leading-relaxed" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-emerald-500/30 p-2.5">
              <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400"><Check className="h-3 w-3" /> Do</p>
              <TextList items={profile.voice.dos} onChange={setVoiceList('dos')} canEdit={canEdit} placeholder="Add a do" empty="Nothing yet — e.g. Use short sentences" />
            </div>
            <div className="rounded-md border border-rose-500/30 p-2.5">
              <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-rose-700 dark:text-rose-400"><X className="h-3 w-3" /> Don&apos;t</p>
              <TextList items={profile.voice.donts} onChange={setVoiceList('donts')} canEdit={canEdit} placeholder="Add a don't" empty="Nothing yet — e.g. No exclamation marks" />
            </div>
          </div>
        </div>
      </Section>

      {/* ── hashtags & handles ── */}
      <Section icon={Hash} title="Hashtags & handles" count={profile.hashtags.length + profile.handles.length} canEdit={canEdit}
        copy={{ label: 'hashtags and handles', value: [...profile.hashtags, ...profile.handles].join(' ') }}>
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"><Hash className="h-3 w-3" /> Hashtags</p>
            <TextList chips items={profile.hashtags} onChange={setList('hashtags')} canEdit={canEdit} placeholder="Add a hashtag" empty="No hashtags yet — type one and press Enter" transform={asHashtag} />
          </div>
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"><AtSign className="h-3 w-3" /> Handles</p>
            <TextList chips items={profile.handles} onChange={setList('handles')} canEdit={canEdit} placeholder="Add a handle" empty="No handles yet — e.g. @theclient" transform={asHandle} />
          </div>
        </div>
      </Section>

      {/* ── notes ── */}
      <Section icon={StickyNote} title="Notes" canEdit={canEdit} count={profile.notes ? 1 : 0} copy={{ label: 'the notes', value: profile.notes }}>
        <Editable value={profile.notes} onSave={v => update(p => ({ ...p, notes: v }))} placeholder="Anything else the team should know — imagery style, words to avoid, sign-off lines" canEdit={canEdit} multiline className="text-sm leading-relaxed" />
      </Section>

      {/* ── review what a new scan found ── */}
      <Sheet open={reviewOpen} onOpenChange={setReviewOpen}>
        <SheetContent className="flex w-full flex-col bg-popover sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>New from the guidelines</SheetTitle>
            <SheetDescription>
              {canEdit ? 'Tick what to add. Nothing you already have is changed.' : 'These are in the document but not in the profile. An account manager can add them.'}
            </SheetDescription>
          </SheetHeader>
          <div className="-mx-1 flex-1 overflow-y-auto px-1">
            {(['colours', 'fonts', 'logo_rules', 'voice_tone', 'voice_summary', 'dos', 'donts', 'notes'] as const).map(section => {
              const rows = proposal?.changes.filter(c => c.section === section) ?? []
              if (rows.length === 0) return null
              const title = { colours: 'Colours', fonts: 'Fonts', logo_rules: 'Logo rules', voice_tone: 'Voice, in three words', voice_summary: 'How the brand speaks', dos: 'Do', donts: "Don't", notes: 'Notes' }[section]
              return (
                <div key={section} className="mb-4">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
                  <ul className="flex flex-col gap-1">
                    {rows.map(c => (
                      <li key={c.id}>
                        <label className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm ${picked.has(c.id) ? 'border-primary/40 bg-primary/[0.05]' : 'border-border'}`}>
                          {canEdit && (
                            <input type="checkbox" checked={picked.has(c.id)} onChange={e => setPicked(prev => { const n = new Set(prev); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n })} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                          )}
                          {c.section === 'colours' && <span className="h-6 w-6 shrink-0 rounded border border-border" style={{ backgroundColor: (c.value as BrandColour).hex }} />}
                          <span className="min-w-0 flex-1 break-words">{c.label}</span>
                          {c.section === 'colours' && <span className="text-xs text-muted-foreground">{COLOUR_ROLE_LABEL[(c.value as BrandColour).role]}</span>}
                          {c.section === 'fonts' && <span className="text-xs text-muted-foreground">{FONT_ROLE_LABEL[(c.value as BrandFont).role]}</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
          {canEdit && proposal && (
            <SheetFooter className="flex-col gap-2 sm:flex-row">
              <Button variant="ghost" onClick={() => review([])} className="min-h-[44px]">Skip all</Button>
              {picked.size < proposal.changes.length && picked.size > 0 && (
                <Button variant="outline" onClick={() => review(picked)} className="min-h-[44px]">Add {picked.size} selected</Button>
              )}
              <Button onClick={() => review(picked.size === proposal.changes.length ? picked : proposal.changes.map(c => c.id))} className="min-h-[44px]">
                Add all {proposal.changes.length}
              </Button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmClear !== null} onOpenChange={o => { if (!o) setConfirmClear(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {confirmClear?.label}?</AlertDialogTitle>
            <AlertDialogDescription>They come off the profile straight away. You can add them back by hand or by rescanning the guidelines.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction onClick={() => { confirmClear?.run(); setConfirmClear(null) }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the whole brand profile?</AlertDialogTitle>
            <AlertDialogDescription>Every colour, font, rule and note goes, and so does the scan history. The uploaded PDFs stay in storage.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void reset(); setConfirmReset(false) }}>Clear everything</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
