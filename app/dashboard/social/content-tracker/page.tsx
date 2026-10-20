'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarClock, CheckCircle2, ChevronLeft, ChevronRight, Clock, ExternalLink, Eye, Heart, Loader2, MessageCircle,
  RefreshCw, Search, Share2,
} from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import PageTitle from '../../ui/PageTitle'
import PlatformIcon from '../PlatformIcon'
import { compact, monthKey, monthWords, platformsIn, shiftMonth } from '../../../lib/content-tracker-core'
import { KIND_WORDS, coverWords, type BoardItem, type ClientBoard, type ItemKind } from '../../../lib/content-board-core'
import { networkName } from '../../../lib/publish-core'

/**
 * THE CONTENT TRACKER (the owner, 20 Oct 2026: "create our own just pull post analytics for each client regarding
 * reels story etc published or scheduled so we can read nicely … so anyone knows what's going on"). One card per
 * client for the month: reels, stories and graphics out and to come, how far ahead they are covered, and how what
 * went out did. Everything is read from Zernio (app/lib/content-board-core.ts).
 */

type Client = { id: string; name: string; logo: string | null }
type Target = { reels: number | null; graphics: number | null; notes: string; responsible: string }
type Answer = {
  month: string; boards: ClientBoard[]; clients: Client[]; targets: Record<string, Target>
  unlinked: number; complete: boolean; fetchedAt: string
}
type Show = 'all' | 'attention' | 'covered'

const SHOWN_KINDS: ItemKind[] = ['reel', 'story', 'graphic']
const WHEN = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Melbourne' })

/** a client needs a look: nothing booked a week ahead, or short of a target */
function needsAttention(b: ClientBoard, t: Target | undefined): boolean {
  if (coverWords(b.scheduledUntil).tone !== 'good') return true
  const total = (k: 'reel' | 'graphic') => b.counts[k].published + b.counts[k].scheduled
  return (t?.reels != null && total('reel') < t.reels) || (t?.graphics != null && total('graphic') < t.graphics)
}

export default function ContentTrackerPage() {
  const thisMonth = monthKey(new Date().toISOString())!
  const [month, setMonth] = useState(thisMonth)
  const [data, setData] = useState<Answer | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [show, setShow] = useState<Show>('all')
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async (m: string, fresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/content-tracker?month=${m}${fresh ? '&fresh=1' : ''}`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Could not load the month')
      setData(j)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the month')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load(month) }, [month, load])

  const clientOf = useMemo(() => new Map((data?.clients ?? []).map(c => [c.id, c])), [data])
  const boards = useMemo(() => (data?.boards ?? []).filter(b => {
    const name = clientOf.get(b.clientId)?.name ?? ''
    if (query.trim() && !name.toLowerCase().includes(query.trim().toLowerCase())) return false
    if (show === 'all') return true
    const attention = needsAttention(b, data?.targets[b.clientId])
    return show === 'attention' ? attention : !attention
  }), [data, query, show, clientOf])

  const all = data?.boards ?? []
  const sum = (k: ItemKind) => all.reduce((n, b) => n + b.counts[k].published + b.counts[k].scheduled, 0)
  const attentionCount = all.filter(b => needsAttention(b, data?.targets[b.clientId])).length
  const opened = open ? all.find(b => b.clientId === open) ?? null : null
  const blank = loading && !data

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageTitle
        title="Content tracker"
        actions={<>
          <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-1">
            <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"
              className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[132px] text-center text-[14px] font-semibold">{monthWords(month)}</span>
            <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"
              className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <button type="button" onClick={() => void load(month, true)} disabled={loading} aria-label="Refresh from Zernio"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-50">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
          </button>
        </>}
      />

      {/* the month across every client */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Clients" value={blank ? null : String(all.length)} />
        <Stat label="Published" value={blank ? null : String(all.reduce((n, b) => n + b.published, 0))} />
        <Stat label="Scheduled" value={blank ? null : String(all.reduce((n, b) => n + b.scheduled, 0))} />
        <Stat label="Reels" value={blank ? null : String(sum('reel'))} />
        <Stat label="Stories" value={blank ? null : String(sum('story'))} />
        <Stat label="Graphics" value={blank ? null : String(sum('graphic'))} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-10 w-full items-center gap-2 rounded-full border border-border bg-surface px-3 sm:w-64">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a client" aria-label="Find a client"
            className="w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground" />
        </label>
        <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-1">
          <Pill on={show === 'all'} onClick={() => setShow('all')}>All clients</Pill>
          <Pill on={show === 'attention'} onClick={() => setShow('attention')}>
            Needs content{attentionCount ? <span className="ml-1.5 rounded-full bg-accent-amber px-1.5 text-[11px] font-bold text-ink">{attentionCount}</span> : null}
          </Pill>
          <Pill on={show === 'covered'} onClick={() => setShow('covered')}>On track</Pill>
        </div>
      </div>

      {error && (
        <div className="rounded-inner border border-accent-red/40 bg-accent-red/10 p-4 text-[14px]">
          {error} <button type="button" className="ml-2 font-semibold underline" onClick={() => void load(month, true)}>Try again</button>
        </div>
      )}

      {blank ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-72 w-full rounded-inner" />)}
        </div>
      ) : boards.length === 0 ? (
        <p className="rounded-inner border border-dashed border-border p-10 text-center text-[14px] text-muted-foreground">
          {all.length === 0 ? `Nothing in Zernio for ${monthWords(month)}.` : 'No client matches.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {boards.map(b => (
            <ClientCard key={b.clientId} board={b} client={clientOf.get(b.clientId)} target={data?.targets[b.clientId]} onOpen={() => setOpen(b.clientId)} />
          ))}
        </div>
      )}

      {data && (data.unlinked > 0 || !data.complete) && (
        <p className="text-[12px] text-muted-foreground">
          {data.unlinked > 0 && `${data.unlinked} post${data.unlinked === 1 ? '' : 's'} in Zernio this month ${data.unlinked === 1 ? 'is' : 'are'} on an account not linked to a client. `}
          {!data.complete && 'Zernio did not send everything in one go — press Refresh.'}
        </p>
      )}

      <Sheet open={!!opened} onOpenChange={v => { if (!v) setOpen(null) }}>
        <SheetContent className="w-full overflow-y-auto bg-popover sm:max-w-xl">
          {opened && (
            <ClientDetail board={opened} client={clientOf.get(opened.clientId)} month={month}
              target={data?.targets[opened.clientId]} onSaved={() => void load(month)} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cn('inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium transition-colors', on ? 'bg-foreground text-background' : 'hover:bg-muted')}>
      {children}
    </button>
  )
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-inner border border-border bg-surface px-4 py-3">
      <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
      {value === null ? <Skeleton className="mt-1.5 h-7 w-12" /> : <p className="text-[26px] font-semibold leading-tight tabular-nums">{value}</p>}
    </div>
  )
}

function Logo({ src, name, size = 40 }: { src: string | null | undefined; name: string; size?: number }) {
  const [broken, setBroken] = useState(false)
  const style = { width: size, height: size }
  if (!src || broken) {
    return <span style={style} className="flex shrink-0 items-center justify-center rounded-full bg-muted text-[15px] font-semibold">{name.charAt(0).toUpperCase()}</span>
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" style={style} onError={() => setBroken(true)} className="shrink-0 rounded-full object-cover" />
}

function Cover({ until }: { until: string | null }) {
  const c = coverWords(until)
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold',
      c.tone === 'good' && 'bg-accent-green/15 text-accent-green',
      c.tone === 'soon' && 'bg-accent-amber/20 text-amber-700 dark:text-amber-300',
      c.tone === 'none' && 'bg-accent-red/10 text-accent-red')}>
      <CalendarClock className="h-3.5 w-3.5" />{c.text}
    </span>
  )
}

/** one kind's line: a bar of what went out (solid) and what is still to go (light), against a target if one is set */
function KindRow({ kind, count, target }: { kind: ItemKind; count: { published: number; scheduled: number }; target: number | null }) {
  const total = count.published + count.scheduled
  const scale = Math.max(target ?? 0, total, 1)
  const met = target !== null && total >= target
  return (
    <div className="grid grid-cols-[72px_1fr_auto] items-center gap-3">
      <span className="text-[13px] font-semibold">{KIND_WORDS[kind].many}</span>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="absolute inset-y-0 left-0 bg-foreground" style={{ width: `${(count.published / scale) * 100}%` }} />
        <div className="absolute inset-y-0 bg-foreground/30" style={{ left: `${(count.published / scale) * 100}%`, width: `${(count.scheduled / scale) * 100}%` }} />
        {target !== null && target > 0 && <div className="absolute inset-y-0 w-0.5 bg-accent-blue" style={{ left: `calc(${(target / scale) * 100}% - 1px)` }} />}
      </div>
      <span className="min-w-[132px] text-right text-[12px] tabular-nums text-muted-foreground">
        <b className="text-foreground">{count.published}</b> out · <b className="text-foreground">{count.scheduled}</b> to go
        {target !== null && <span className={cn('ml-1', met ? 'text-accent-green' : 'text-amber-700 dark:text-amber-300')}>/ {target}</span>}
      </span>
    </div>
  )
}

function ClientCard({ board, client, target, onOpen }: { board: ClientBoard; client: Client | undefined; target: Target | undefined; onOpen: () => void }) {
  const name = client?.name ?? 'Unknown client'
  return (
    <button type="button" onClick={onOpen}
      className="flex flex-col gap-4 rounded-inner border border-border bg-surface p-4 text-left transition-shadow hover:shadow-[0_2px_12px_rgba(11,11,11,0.08)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue">
      <div className="flex items-start gap-3">
        <Logo src={client?.logo} name={name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold">{name}</p>
          <p className="truncate text-[12px] text-muted-foreground">{target?.responsible || 'No one responsible yet'}</p>
        </div>
        <Cover until={board.scheduledUntil} />
      </div>

      <div className="flex flex-col gap-2.5">
        {SHOWN_KINDS.map(k => (
          <KindRow key={k} kind={k} count={board.counts[k]}
            target={k === 'reel' ? target?.reels ?? null : k === 'graphic' ? target?.graphics ?? null : null} />
        ))}
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <span className="flex items-center gap-2.5">
          {platformsIn(Object.keys(board.networks).map(platform => ({ platform }))).map(p => (
            <span key={p} className="inline-flex items-center gap-1 text-[12px] tabular-nums" title={`${board.networks[p]} on ${networkName(p)}`}>
              <PlatformIcon platform={p} size={15} />{board.networks[p]}
            </span>
          ))}
        </span>
        <span className="flex items-center gap-3 text-[12px] tabular-nums text-muted-foreground">
          <span className="inline-flex items-center gap-1" title="Views on what went out"><Eye className="h-3.5 w-3.5" />{compact(board.metrics.views)}</span>
          <span className="inline-flex items-center gap-1" title="Likes"><Heart className="h-3.5 w-3.5" />{compact(board.metrics.likes)}</span>
          {board.engagement !== null && <span title="Likes, comments, shares and saves over views">{board.engagement}% eng.</span>}
        </span>
      </div>
    </button>
  )
}

function ClientDetail({ board, client, month, target, onSaved }: {
  board: ClientBoard; client: Client | undefined; month: string; target: Target | undefined; onSaved: () => void
}) {
  const name = client?.name ?? 'Unknown client'
  const out = board.items.filter(i => i.state === 'published').sort((a, b) => b.at.localeCompare(a.at))
  const coming = board.items.filter(i => i.state === 'scheduled')
  const save = async (patch: Record<string, unknown>) => {
    const res = await fetch('/api/content-tracker', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: board.clientId, month, ...patch }),
    }).catch(() => null)
    if (!res?.ok) { toast.error((await res?.json().catch(() => null))?.error ?? 'Could not save'); return }
    toast.success('Saved')
    onSaved()
  }
  return (
    <div className="flex flex-col gap-6">
      <SheetHeader className="text-left">
        <div className="flex items-center gap-3">
          <Logo src={client?.logo} name={name} size={48} />
          <div className="min-w-0">
            <SheetTitle className="truncate text-[20px]">{name}</SheetTitle>
            <SheetDescription>{monthWords(month)}</SheetDescription>
          </div>
        </div>
        <div className="pt-2"><Cover until={board.scheduledUntil} /></div>
      </SheetHeader>

      <div className="grid grid-cols-4 gap-2">
        <Mini label="Views" value={compact(board.metrics.views)} />
        <Mini label="Likes" value={compact(board.metrics.likes)} />
        <Mini label="Comments" value={compact(board.metrics.comments)} />
        <Mini label="Engagement" value={board.engagement === null ? '—' : `${board.engagement}%`} />
      </div>

      <section className="flex flex-col gap-3 rounded-inner border border-border p-3">
        <h3 className="text-[13px] font-semibold">This month’s plan</h3>
        <div className="grid grid-cols-2 gap-3">
          <TargetInput label="Reels needed" value={target?.reels ?? null} onSave={v => save({ required_reels: v })} />
          <TargetInput label="Graphics needed" value={target?.graphics ?? null} onSave={v => save({ required_graphics: v })} />
        </div>
        <TextInput label="Responsible" value={target?.responsible ?? ''} onSave={v => save({ responsible: v })} />
        <TextInput label="Notes" value={target?.notes ?? ''} onSave={v => save({ notes: v })} />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold"><Clock className="h-4 w-4" />Still to go · {coming.length}</h3>
        {coming.length === 0 ? <p className="text-[13px] text-muted-foreground">Nothing waiting in Zernio this month.</p>
          : coming.map(i => <ItemRow key={i.key} item={i} />)}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold"><CheckCircle2 className="h-4 w-4" />Went out · {out.length}</h3>
        {out.length === 0 ? <p className="text-[13px] text-muted-foreground">Nothing published through Zernio yet this month.</p>
          : out.map(i => <ItemRow key={i.key} item={i} />)}
      </section>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-inner bg-surface px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-[18px] font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function ItemRow({ item }: { item: BoardItem }) {
  const [broken, setBroken] = useState(false)
  const live = item.state === 'published'
  return (
    <div className="flex gap-3 rounded-inner border border-border bg-surface p-2.5">
      <div className="h-20 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
        {item.thumbnail && !broken
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={item.thumbnail} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
          : <span className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">{KIND_WORDS[item.kind].one}</span>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className={cn('rounded-full px-2 py-0.5 font-semibold', live ? 'bg-foreground text-background' : 'bg-accent-blue/15 text-accent-blue')}>
            {KIND_WORDS[item.kind].one}
          </span>
          <span className="text-muted-foreground">{live ? 'Went out' : 'Goes out'} {WHEN.format(new Date(item.at))}</span>
        </div>
        {item.caption && <p className="line-clamp-2 text-[13px] leading-snug">{item.caption}</p>}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            {item.networks.map(n => n.url
              ? <a key={n.platform} href={n.url} target="_blank" rel="noopener noreferrer" title={`Open on ${networkName(n.platform)}`}
                  className="inline-flex items-center gap-0.5 rounded-full border border-border px-1.5 py-0.5 hover:bg-muted">
                  <PlatformIcon platform={n.platform} size={14} /><ExternalLink className="h-3 w-3" />
                </a>
              : <span key={n.platform} title={networkName(n.platform)}><PlatformIcon platform={n.platform} size={14} /></span>)}
          </span>
          {live && (
            <span className="flex items-center gap-2.5 text-[12px] tabular-nums text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{compact(item.views)}</span>
              <span className="inline-flex items-center gap-1"><Heart className="h-3.5 w-3.5" />{compact(item.likes)}</span>
              <span className="inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" />{compact(item.comments)}</span>
              <span className="inline-flex items-center gap-1"><Share2 className="h-3.5 w-3.5" />{compact(item.shares + item.saves)}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function TargetInput({ label, value, onSave }: { label: string; value: number | null; onSave: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? '' : String(value))
  useEffect(() => { setText(value === null ? '' : String(value)) }, [value])
  return (
    <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
      {label}
      <input value={text} inputMode="numeric" placeholder="Not set"
        onChange={e => setText(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => { const v = text === '' ? null : Number(text); if (v !== value) onSave(v) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="h-10 rounded-md border border-border bg-surface px-3 text-[14px] text-foreground" />
    </label>
  )
}

function TextInput({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => { setText(value) }, [value])
  return (
    <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
      {label}
      <input value={text} placeholder="—"
        onChange={e => setText(e.target.value)}
        onBlur={() => { if (text.trim() !== value.trim()) onSave(text) }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="h-10 rounded-md border border-border bg-surface px-3 text-[14px] text-foreground" />
    </label>
  )
}
