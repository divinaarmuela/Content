'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, ChevronLeft, ChevronRight, Image as ImageIcon, LayoutGrid, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ScopeViewer } from '../../lib/production-access-core'
import { addressWithClient, clientDropdownChoices, clientFromAddress, postApprovalWindowHref } from '../../lib/post-board-core'
import { monthCells } from '../../lib/social-schedule-core'
import { DEFAULT_TZ, dayKeyInZone } from '../../lib/timezone-core'
import { eventsFor, todayKey, type CalEvent, type CalItem } from '../../lib/work-calendar-core'
import { schedulerScope, type Viewer } from '../../lib/work-pages-core'
import {
  MONTH_CELL_MAX, dayWords, groupByDay, monthOfDay, rangeWords, shiftDay, shiftMonthDay, weekKeys,
} from '../../lib/post-calendar-core'
import { usePersistedChoice, usePersistedFlag, usePersistedScope } from '../production/workHooks'
import { useRole } from '../useRole'
import { NetworkLogos, STAGE_DIM, STAGE_RING, StageDot, clockLabel } from '../social/schedule/tiles'
import { usePostBoard, type BoardPost } from './board/usePostBoard'

/**
 * POST APPROVAL'S CALENDAR, IN THE SOCIAL SCHEDULE'S LOOK (the owner, 13 Nov 2026: "the calendar in post approval is
 * broken, we need to redesign this to look like the one in social schedule, because when I do week and show more the
 * popup is hidden").
 *
 * A bordered month or week. One tile is one post: its picture, its time, its client, its name, its networks, and its
 * stage's colour. A tile opens the post. A week shows every post of each day; a month shows the first few and
 * "+N more", which opens the whole day in the middle of the screen. Times are the client's, not the viewer's.
 * Read-only: nothing here books, moves or posts.
 */

type QueueItem = CalItem & { scheduler_ids?: unknown; batch_id?: string | null }
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const RANGES = ['month', 'week'] as const
const EVERY_CLIENT = 'every'

/** a post's picture: its first image, or a play mark for a video with no still */
function Picture({ bp }: { bp: BoardPost }) {
  const image = bp.face.thumbs.find(t => t.type === 'image')?.url
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" loading="lazy" className="h-full w-full object-cover" />
  }
  return (
    <span className="flex h-full w-full items-center justify-center bg-foreground/[0.08] text-muted-foreground">
      {bp.face.thumbs.length ? <Play className="h-3 w-3" strokeWidth={2} aria-hidden /> : <ImageIcon className="h-3 w-3" strokeWidth={1.8} aria-hidden />}
    </span>
  )
}

function PostTile({ bp, tz, roomy = false }: { bp: BoardPost; tz: string; roomy?: boolean }) {
  const { face, post } = bp
  const time = clockLabel(post.scheduled_for, tz)
  const said = [face.client, face.title, time, face.stage.label, face.missed].filter(Boolean).join(' · ')
  return (
    <Link href={postApprovalWindowHref(post)} aria-label={said} title={said} data-cal-post={post.id}
      className={cn(
        'relative flex w-full items-center gap-1.5 overflow-hidden rounded-tile border border-border bg-surface p-1 text-left transition-colors hover:border-foreground/30 focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue',
        roomy ? 'min-h-11' : 'min-h-9', STAGE_DIM[face.tone], STAGE_RING[face.tone],
      )}>
      <span className={cn('relative shrink-0 overflow-hidden rounded-[4px]', roomy ? 'h-9 w-9' : 'h-7 w-7')}>
        <Picture bp={bp} />
        <StageDot tone={face.tone} className="absolute left-0.5 top-0.5 h-2 w-2 border" />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[10px] font-semibold tabular-nums text-muted-foreground">{time}{face.client ? ` · ${face.client}` : ''}</span>
        <span className="block truncate text-[11px] font-semibold text-foreground">{face.title}</span>
      </span>
      <NetworkLogos platforms={face.networks.map(n => n.platform)} size={9} max={3} className="shrink-0" />
    </Link>
  )
}

/** a card's due date, drawn faint and dashed under the posts: a plan, where a post is a commitment */
function DueTile({ e }: { e: CalEvent }) {
  return (
    <Link href={e.href} title={`${e.title} · due · ${e.statusWord}`}
      className="flex min-h-9 w-full items-center gap-1.5 rounded-tile border border-dashed border-border px-1.5 py-1 text-left hover:border-foreground/40">
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[10px] font-semibold text-muted-foreground">Due{e.clientName ? ` · ${e.clientName}` : ''}</span>
        <span className="block truncate text-[11px] font-semibold text-foreground">{e.title}</span>
      </span>
    </Link>
  )
}

export default function PostCalendar() {
  const { me, role } = useRole()
  const viewer = useMemo<(ScopeViewer & Viewer) | null>(() => (me ? { id: me.id, role: me.role } as ScopeViewer & Viewer : null), [me])
  const data = usePostBoard(viewer)
  const ready = viewer !== null && !data.loading

  const [range, setRange] = usePersistedChoice('md-scheduler-cal-range', RANGES, 'month')
  const [showDue, setShowDue] = usePersistedFlag('md-scheduler-cal-due', false)
  const [scope] = usePersistedScope('md-scheduler-scope', role)
  const today = todayKey(DEFAULT_TZ)
  const [cursor, setCursor] = useState<string>(today)
  const [openDay, setOpenDay] = useState<string | null>(null)

  // the client chosen on the board (?client=) is the client shown here, and choosing one here writes it back
  const [clientId, setClientId] = useState<string>(() => (typeof window === 'undefined' ? '' : clientFromAddress(window.location.search)))
  useEffect(() => {
    const next = addressWithClient(window.location.search, clientId)
    if (next !== window.location.search) window.history.replaceState(null, '', `${window.location.pathname}${next}`)
  }, [clientId])

  const zoneOf = useCallback((id: string) => data.zoneOf(id) || DEFAULT_TZ, [data])
  const scheduled = useMemo(
    () => data.onCalendar.filter(bp => !clientId || bp.post.client_id === clientId),
    [data.onCalendar, clientId])
  const byDay = useMemo(
    () => groupByDay(scheduled, bp => dayKeyInZone(bp.post.scheduled_for, zoneOf(bp.post.client_id)), bp => String(bp.post.scheduled_for ?? '')),
    [scheduled, zoneOf])
  const clients = useMemo(() => {
    const seen = new Map<string, string>()
    for (const bp of data.onCalendar) if (!seen.has(bp.post.client_id)) seen.set(bp.post.client_id, bp.face.client)
    const names = new Map(data.clients.map(c => [c.id, c.name]))
    return clientDropdownChoices([...seen].map(([id, name]) => ({ id, name })), clientId, id => names.get(id))
  }, [data.onCalendar, data.clients, clientId])

  /* ── the second layer: the due dates of the cards this person is posting ── */
  const [items, setItems] = useState<QueueItem[]>([])
  useEffect(() => {
    if (!showDue) return
    let live = true
    fetch('/api/production/items', { cache: 'no-store' }).then(r => (r.ok ? r.json() : [])).then(j => { if (live) setItems(Array.isArray(j) ? j : []) }).catch(() => {})
    return () => { live = false }
  }, [showDue])
  const due = useMemo(() => {
    if (!showDue || !viewer) return new Map<string, CalEvent[]>()
    const held = schedulerScope(items, viewer, scope).filter(i => !clientId || i.client_id === clientId)
    return eventsFor('scheduler', { entries: [], items: held }, DEFAULT_TZ).byDay
  }, [showDue, viewer, items, scope, clientId])

  const cells = range === 'month'
    ? monthCells(monthOfDay(cursor)).map(c => ({ key: c.key, day: c.day, inMonth: c.inMonth }))
    : weekKeys(cursor).map(key => ({ key, day: Number(key.slice(8)), inMonth: true }))
  const step = (dir: 1 | -1) => setCursor(c => (range === 'month' ? shiftMonthDay(c, dir) : shiftDay(c, dir * 7)))
  const inView = cells.filter(c => c.inMonth).reduce((n, c) => n + (byDay.get(c.key)?.length ?? 0), 0)

  const seg = (on: boolean) => `inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold ${on ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`
  const round = 'flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-foreground hover:bg-foreground/[0.06]'

  if (!ready) {
    return (
      <div role="status" aria-label="Loading the calendar" aria-busy="true" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2"><Skeleton className="h-11 w-11 rounded-full" /><Skeleton className="h-11 w-44 rounded-full" /><Skeleton className="h-11 w-11 rounded-full" /><Skeleton className="ml-auto h-11 w-48 rounded-full" /></div>
        <div className="grid grid-cols-7 overflow-hidden rounded-inner border border-border bg-surface">
          {Array.from({ length: 35 }).map((_, i) => <div key={i} className="flex min-h-[104px] flex-col gap-1 border-b border-l border-border p-1.5 [&:nth-child(7n+1)]:border-l-0"><Skeleton className="h-3 w-5" /><Skeleton className="h-9 w-full rounded-tile" /></div>)}
        </div>
      </div>
    )
  }

  const openList = openDay ? byDay.get(openDay) ?? [] : []

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-3" data-post-calendar>
      {/* ── one line: where you are, whose posts, and month or week ── */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={round} aria-label={range === 'month' ? 'Previous month' : 'Previous week'} onClick={() => step(-1)}><ChevronLeft className="h-[18px] w-[18px]" strokeWidth={1.8} /></button>
        <span className="inline-flex h-11 min-w-[170px] items-center justify-center rounded-full bg-foreground px-5 text-[14px] font-semibold text-background" aria-live="polite">{rangeWords(range, cursor)}</span>
        <button type="button" className={round} aria-label={range === 'month' ? 'Next month' : 'Next week'} onClick={() => step(1)}><ChevronRight className="h-[18px] w-[18px]" strokeWidth={1.8} /></button>
        <button type="button" onClick={() => setCursor(today)} className="inline-flex h-11 items-center rounded-full px-3 text-[14px] font-semibold text-foreground hover:bg-foreground/[0.06]">Today</button>
        {(clients.length > 1 || clientId !== '') && (
          <Select value={clientId || EVERY_CLIENT} onValueChange={v => setClientId(v === EVERY_CLIENT ? '' : v)}>
            <SelectTrigger aria-label="Show one client" className="h-11 w-[210px] rounded-full bg-surface px-4 text-[13px] font-semibold"><SelectValue placeholder="Every client" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={EVERY_CLIENT}>Every client</SelectItem>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <span className="text-[13px] text-muted-foreground">{inView === 1 ? '1 post' : `${inView} posts`}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" aria-pressed={showDue} onClick={() => setShowDue(!showDue)}
            title="Show the due dates of the cards you are posting, under the posts"
            className={`inline-flex h-11 items-center rounded-full border px-4 text-[13px] font-semibold ${showDue ? 'border-foreground bg-foreground text-background' : 'border-border bg-surface text-foreground hover:bg-foreground/[0.06]'}`}>Due dates</button>
          <div role="group" aria-label="Month or week" className="inline-flex h-11 items-center rounded-full border border-border bg-surface p-1">
            <button type="button" aria-pressed={range === 'month'} onClick={() => setRange('month')} className={seg(range === 'month')}><LayoutGrid className="h-4 w-4" aria-hidden /> Month</button>
            <button type="button" aria-pressed={range === 'week'} onClick={() => setRange('week')} className={seg(range === 'week')}><CalendarDays className="h-4 w-4" aria-hidden /> Week</button>
          </div>
        </div>
      </div>
      <p className="text-[13px] text-muted-foreground">Every post on the day its audience sees it. Times are the client&rsquo;s, not yours. Press a post to open it.</p>

      {/* ── the grid: the Schedule page's own, bordered cells. ON A PHONE THE DAYS STACK, one under the other, and a
          day with nothing on it is left out: seven columns in 390px left each tile too narrow to read its time ── */}
      <div className="min-w-0">
        <div className="flex flex-col rounded-inner border border-border bg-surface">
          <div className="hidden grid-cols-7 md:grid">
            {WEEKDAYS.map(d => <div key={d} className="border-b border-border px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{d}</div>)}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-7">
            {cells.map((cell, i) => {
              const list = byDay.get(cell.key) ?? []
              const dues = due.get(cell.key) ?? []
              const shown = range === 'week' ? list : list.slice(0, MONTH_CELL_MAX)
              const more = list.length - shown.length
              return (
                <div key={cell.key} data-day={cell.key}
                  className={cn(
                    'flex-col gap-1 border-b border-border p-2 md:border-l md:p-1.5 md:[&:nth-child(7n+1)]:border-l-0',
                    list.length === 0 && dues.length === 0 && today !== cell.key ? 'hidden md:flex' : 'flex',
                    range === 'week' ? 'md:min-h-[320px]' : 'md:min-h-[104px]',
                    !cell.inMonth && 'bg-foreground/[0.02] text-muted-foreground',
                    today === cell.key && 'bg-foreground/[0.035]',
                  )}>
                  <span className="flex items-center gap-1.5 px-0.5 text-[12px] font-semibold">
                    <span className="text-muted-foreground md:hidden">{WEEKDAYS[i % 7]}</span>
                    <span className={today === cell.key ? 'flex h-6 min-w-6 items-center justify-center rounded-full bg-foreground px-1.5 text-background' : ''}>{cell.day}</span>
                    {list.length > 0 && <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">{list.length}</span>}
                  </span>
                  <div className="flex flex-col gap-1">
                    {shown.map(bp => <PostTile key={bp.post.id} bp={bp} tz={zoneOf(bp.post.client_id)} roomy={range === 'week'} />)}
                    {more > 0 && (
                      <button type="button" onClick={() => setOpenDay(cell.key)} aria-label={`Show all ${list.length} on ${dayWords(cell.key)}`}
                        className="min-h-9 w-full rounded-tile px-1.5 text-left text-[12px] font-semibold text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">
                        +{more} more
                      </button>
                    )}
                    {dues.map(e => <DueTile key={e.uid} e={e} />)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── a whole day, in the middle of the screen (never hung under its cell, where the grid's edge cut it off) ── */}
      {openDay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" data-more-day
          onMouseDown={ev => { if (ev.target === ev.currentTarget) setOpenDay(null) }}>
          <div role="dialog" aria-modal="true" aria-label={dayWords(openDay)}
            className="flex max-h-[80vh] w-full max-w-md flex-col rounded-card border border-border bg-popover p-4 shadow-[0_6px_24px_rgba(11,11,11,0.14)]">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="min-w-0 text-[15px] font-semibold text-foreground">{dayWords(openDay)} · {openList.length}</p>
              <button type="button" onClick={() => setOpenDay(null)} aria-label="Close"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[20px] leading-none text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground">×</button>
            </div>
            <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
              {openList.map(bp => <PostTile key={bp.post.id} bp={bp} tz={zoneOf(bp.post.client_id)} roomy />)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
