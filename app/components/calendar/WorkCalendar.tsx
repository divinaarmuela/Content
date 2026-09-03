'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, LayoutGrid } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  canMove, clientTone, monthGrid, monthLabel, shiftDay, shiftMonth, todayKey,
  weekGrid, weekLabel,
  type CalEvent, type CalTone, type CalendarEvents, type GridCell,
} from '../../lib/work-calendar-core'
import { DEFAULT_TZ, formatInZone, zoneAbbrev } from '../../lib/timezone-core'
import type { Viewer } from '../../lib/work-pages-core'

/**
 * The one calendar Production, Editor and Scheduler all draw.
 *
 * Three pages were about to grow three month grids, which is three sets of
 * "which cell does a Manila viewer put a Melbourne client's Thursday post in".
 * Every date decision lives in `lib/work-calendar-core.ts`; this file is the
 * pixels, and it holds no rule that a test could have caught.
 *
 * What it is trying to be: a week you can read at arm's length. A colour per
 * client so a mixed cell separates without being read; the type and the state
 * as words rather than a legend to memorise; and a drag that moves a date,
 * because the alternative is opening an item to change one field.
 */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const LONG_WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** The dot beside an event — the client it belongs to, as colour. */
const DOT: Record<CalTone, string> = {
  zinc: 'bg-foreground/40',
  blue: 'bg-accent-blue',
  amber: 'bg-accent-amber',
  violet: 'bg-accent-blue-deep',
  emerald: 'bg-accent-green',
  sky: 'bg-accent-blue',
  cyan: 'bg-accent-blue-deep',
  rose: 'bg-accent-red',
}

/** The event's own face — its STATE, which is the other half of the read. */
const FACE: Record<CalTone, string> = {
  zinc: 'bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1]',
  blue: 'bg-tint-blue text-accent-blue-deep hover:brightness-95 dark:text-cream',
  amber: 'bg-tint-amber text-foreground hover:brightness-95',
  violet: 'bg-tint-blue text-accent-blue-deep hover:brightness-95 dark:text-cream',
  emerald: 'bg-tint-green text-foreground hover:brightness-95',
  sky: 'bg-tint-blue text-accent-blue-deep hover:brightness-95 dark:text-cream',
  cyan: 'bg-tint-blue text-accent-blue-deep hover:brightness-95 dark:text-cream',
  rose: 'bg-tint-red text-foreground hover:brightness-95',
}

export type CalendarView = 'month' | 'week'

/**
 * Board · Calendar — the Scheduler's view switcher, as a control the two
 * client-side pages can use too. Link pills there, buttons here; the same
 * shape, because it is the same idea in the same place on the page.
 */
export function ViewSwitch<T extends string>({ value, onChange, options, label }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; icon?: React.ComponentType<{ className?: string }> }[]
  label: string
}) {
  return (
    <nav aria-label={label}
      className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-surface p-1">
      {options.map(o => {
        const Icon = o.icon
        const active = o.value === value
        return (
          <button key={o.value} type="button" aria-pressed={active} onClick={() => onChange(o.value)}
            className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[14px] font-semibold transition-colors ${
              active
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground'
            }`}>
            {Icon && <Icon className="h-4 w-4" />} {o.label}
          </button>
        )
      })}
    </nav>
  )
}

/** How many fit in a cell before the rest go behind "+n more". */
const CAP = { month: 3, week: 8 } as const

type MoveFn = (event: CalEvent, day: string) => void | Promise<void>

/** One event, wherever it is drawn: a cell, a popover, or the undated tray. */
function EventChip({ e, viewer, onMove, dense, onDragStart, onDragEnd }: {
  e: CalEvent
  viewer: Viewer | null
  onMove?: MoveFn
  dense: boolean
  onDragStart?: (e: CalEvent) => void
  onDragEnd?: () => void
}) {
  const movable = !!onMove && canMove(e, viewer)
  const time = e.at ? formatInZone(e.at, e.clientTz, 'time') : null
  const title = [
    `${e.typeChip} · ${e.title}`,
    e.clientName,
    time && `${time} ${zoneAbbrev(e.clientTz, e.at)}`,
    e.statusWord,
    movable && 'Drag to another day, or hold Alt and press an arrow key',
  ].filter(Boolean).join(' · ')

  return (
    <Link
      href={e.href}
      title={title}
      draggable={movable}
      onDragStart={ev => {
        if (!movable) return
        ev.dataTransfer.effectAllowed = 'move'
        // some browsers refuse a drag with nothing on the transfer
        ev.dataTransfer.setData('text/plain', e.uid)
        onDragStart?.(e)
      }}
      onDragEnd={() => onDragEnd?.()}
      onKeyDown={ev => {
        if (!movable || !e.day || !ev.altKey) return
        const step = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1
          : ev.key === 'ArrowUp' ? -7 : ev.key === 'ArrowDown' ? 7 : 0
        if (step === 0) return
        ev.preventDefault()
        void onMove?.(e, shiftDay(e.day, step))
      }}
      className={`group flex items-center gap-1 rounded-tile px-1.5 py-1 text-left leading-tight transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground ${
        dense ? 'text-[11px]' : 'text-xs'
      } ${FACE[e.tone]} ${
        // the due layer is the QUIETER one: outlined rather than filled, so a
        // booked post stays louder than a deadline sitting under it
        e.layer === 'due'
          ? 'border border-dashed border-border bg-transparent hover:bg-foreground/[0.04]'
          : ''
      } ${
        movable ? 'cursor-grab active:cursor-grabbing' : ''
      }`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[clientTone(e.clientId)]}`}
        aria-hidden />
      {/* the same 12/600 pill the boards wear — a 9px mono chip was the one
          piece of type on the calendar nobody could read at arm's length */}
      <span className="shrink-0 rounded-full bg-black/[0.06] px-2 py-0.5 text-chip-12 uppercase dark:bg-white/[0.12]">
        {e.typeChip}
      </span>
      {time && <span className="shrink-0 font-mono text-[10px] tabular-nums">{time}</span>}
      <span className="truncate">{e.title}</span>
      <span className="ml-auto hidden shrink-0 whitespace-nowrap text-[10px] opacity-70 sm:inline">
        {e.statusWord}
      </span>
      {e.live && e.liveUrl && <ExternalLink className="h-2.5 w-2.5 shrink-0" aria-hidden />}
    </Link>
  )
}

/** The rest of a busy day, on demand. */
function MorePopover({ day, events, viewer, onMove, label }: {
  day: string
  events: CalEvent[]
  viewer: Viewer | null
  onMove?: MoveFn
  label: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const away = (ev: MouseEvent) => {
      if (box.current && !box.current.contains(ev.target as Node)) setOpen(false)
    }
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="relative" ref={box}>
      <button type="button" aria-expanded={open}
        aria-label={`Show all ${events.length} on ${label}`}
        onClick={() => setOpen(o => !o)}
        className="w-full rounded-tile px-1.5 py-1 text-left text-[12px] font-semibold text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground">
        +{events.length} more
      </button>
      {open && (
        <div role="dialog" aria-label={label}
          className="absolute left-0 top-full z-30 mt-1 w-64 rounded-inner border border-border bg-popover p-2 shadow-[0_6px_24px_rgba(11,11,11,0.14)]">
          <p className="mb-1.5 px-1 text-[12px] font-semibold text-muted-foreground">{label}</p>
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
            {events.map(e => (
              <li key={e.uid} data-day={day}>
                <EventChip e={e} viewer={viewer} onMove={onMove} dense={false} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export type WorkCalendarProps = {
  /** what to draw, already scoped and filtered by the page */
  events: CalendarEvents
  viewer: Viewer | null
  /** the zone "today" is decided in — the agency's, unless a page knows better */
  tz?: string
  /** absent = this calendar is read-only */
  onMove?: MoveFn
  /** month vs week, remembered by the page */
  view: CalendarView
  onViewChange: (v: CalendarView) => void
  /** what the tray under the grid is called, and null to hide it */
  undatedLabel?: string | null
  /** a line under the grid explaining the colours, if the page has one */
  legend?: React.ReactNode
  /** extra controls beside Today — a layer toggle, for instance */
  controls?: React.ReactNode
  /** a day worth opening on when this month is empty (see `suggestedDay`).
   *  Honoured until the viewer takes the wheel with the arrows or Today. */
  openOn?: string | null
}

export default function WorkCalendar({
  events, viewer, tz = DEFAULT_TZ, onMove, view, onViewChange,
  undatedLabel = 'Undated', legend, controls, openOn = null,
}: WorkCalendarProps) {
  const today = todayKey(tz)
  const [cursor, setCursor] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
  }))
  const [weekAnchor, setWeekAnchor] = useState(today)
  /** the viewer has steered it themselves — stop steering it for them */
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    if (pinned || !openOn) return
    setCursor({ year: Number(openOn.slice(0, 4)), month: Number(openOn.slice(5, 7)) })
    setWeekAnchor(openOn)
  }, [openOn, pinned])
  /** the event under the pointer, so a cell can say whether it will take it */
  const [dragging, setDragging] = useState<CalEvent | null>(null)
  const [over, setOver] = useState<string | null>(null)

  const cells: GridCell[] = useMemo(
    () => (view === 'month'
      ? monthGrid(cursor.year, cursor.month)
      : weekGrid(weekAnchor, cursor.month, cursor.year)),
    [view, cursor, weekAnchor],
  )

  const heading = view === 'month' ? monthLabel(cursor.year, cursor.month) : weekLabel(cells)

  const step = useCallback((delta: number) => {
    setPinned(true)
    if (view === 'month') {
      setCursor(c => shiftMonth(c.year, c.month, delta))
    } else {
      setWeekAnchor(a => {
        const next = shiftDay(a, delta * 7)
        setCursor({ year: Number(next.slice(0, 4)), month: Number(next.slice(5, 7)) })
        return next
      })
    }
  }, [view])

  const goToday = useCallback(() => {
    setPinned(true)
    setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) })
    setWeekAnchor(today)
  }, [today])

  const cap = CAP[view]
  const total = useMemo(
    () => cells.reduce((n, c) => n + (events.byDay.get(c.key)?.length ?? 0), 0),
    [cells, events],
  )

  const drop = (day: string) => {
    const e = dragging
    setDragging(null)
    setOver(null)
    if (!e || !onMove || e.day === day || !canMove(e, viewer)) return
    void onMove(e, day)
  }

  const dayLabel = (c: GridCell) => {
    const idx = (new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay() + 6) % 7
    return `${LONG_WEEKDAYS[idx]} ${c.day} ${monthLabel(c.year, c.month)}`
  }

  const cell = (c: GridCell) => {
    const list = events.byDay.get(c.key) ?? []
    const shown = list.slice(0, cap)
    const rest = list.slice(cap)
    const isToday = c.key === today
    const takes = !!dragging && !!onMove && canMove(dragging, viewer) && dragging.day !== c.key
    return (
      <section
        key={c.key}
        aria-label={`${dayLabel(c)} — ${list.length === 1 ? '1 item' : `${list.length} items`}`}
        onDragOver={ev => { if (takes) { ev.preventDefault(); setOver(c.key) } }}
        onDragLeave={() => setOver(o => (o === c.key ? null : o))}
        onDrop={ev => { ev.preventDefault(); drop(c.key) }}
        className={`flex flex-col bg-surface p-1.5 transition-colors ${
          view === 'month' ? 'min-h-[104px]' : 'min-h-[132px]'
        } ${c.inMonth ? '' : 'opacity-45'} ${
          over === c.key && takes ? 'ring-2 ring-inset ring-foreground' : ''
        }`}>
        <div className="flex items-center gap-1.5">
          <span className={`text-[13px] tabular-nums ${
            isToday
              ? 'flex h-6 w-6 items-center justify-center rounded-full bg-foreground font-bold text-background'
              : 'text-muted-foreground'
          }`}>
            {c.day}
          </span>
          {/* the week view has room to name the day; the month grid has a
              header row doing it once */}
          {view === 'week' && (
            <span className="text-[12px] text-muted-foreground md:hidden">
              {LONG_WEEKDAYS[(new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay() + 6) % 7]}
            </span>
          )}
        </div>
        <ul className="mt-1 flex flex-col gap-1">
          {shown.map(e => (
            <li key={e.uid}>
              <EventChip e={e} viewer={viewer} onMove={onMove} dense={view === 'month'}
                onDragStart={setDragging} onDragEnd={() => { setDragging(null); setOver(null) }} />
            </li>
          ))}
          {rest.length > 0 && (
            <li>
              <MorePopover day={c.key} events={list} viewer={viewer} onMove={onMove}
                label={dayLabel(c)} />
            </li>
          )}
        </ul>
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button className="h-11 w-11 rounded-full border border-border bg-surface p-0 text-foreground hover:bg-foreground/[0.06]"
          aria-label={view === 'month' ? 'Previous month' : 'Previous week'}
          onClick={() => step(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {/* the month itself is the ink pill — the one thing on the bar that
            says where you are */}
        <span className="flex min-h-11 min-w-36 items-center justify-center rounded-full bg-foreground px-4 text-[14px] font-semibold text-background md:min-w-44">
          {heading}
        </span>
        <Button className="h-11 w-11 rounded-full border border-border bg-surface p-0 text-foreground hover:bg-foreground/[0.06]"
          aria-label={view === 'month' ? 'Next month' : 'Next week'}
          onClick={() => step(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button className="h-11 rounded-full bg-transparent px-4 text-[14px] font-semibold text-foreground hover:bg-foreground/[0.06]" onClick={goToday}>Today</Button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {controls}
          <ViewSwitch<CalendarView>
            label="Calendar range"
            value={view}
            onChange={onViewChange}
            options={[
              { value: 'month', label: 'Month', icon: LayoutGrid },
              { value: 'week', label: 'Week', icon: CalendarDays },
            ]}
          />
        </div>
      </div>

      {/* the legend ABOVE the thing it explains — under ~500px of grid it was
          read by nobody */}
      {legend}

      {/* MONTH is a seven-column grid that scrolls sideways on a phone rather
          than crushing seven columns into 360px. WEEK stacks into one column
          there instead: a week of one-line days is readable on a phone, and a
          week of seven 50px columns is not. */}
      {view === 'month' ? (
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-t-inner bg-border">
              {WEEKDAYS.map(d => (
                <div key={d} className="bg-surface px-2 py-2 text-[12px] font-semibold text-muted-foreground">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-b-inner bg-border">
              {cells.map(cell)}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-inner bg-border md:grid-cols-7">
          {cells.map(c => (
            <div key={`h-${c.key}`} className="hidden bg-surface px-2 py-2 text-[12px] font-semibold text-muted-foreground md:block">
              {WEEKDAYS[(new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay() + 6) % 7]}
            </div>
          ))}
          {cells.map(cell)}
        </div>
      )}

      {undatedLabel && events.undated.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-inner border border-dashed border-border p-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.02em] text-muted-foreground">
            {undatedLabel} <span className="tabular-nums">{events.undated.length}</span>
          </p>
          <p className="text-[13px] text-muted-foreground">
            Nothing here has a date, so nothing here is on the grid. Drop one on a day
            from its own page, or set the date there.
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {events.undated.map(e => (
              <li key={e.uid} className="max-w-64">
                <EventChip e={e} viewer={viewer} dense={false} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {total === 0 && events.undated.length === 0 && (
        <p className="text-[13px] text-muted-foreground">
          Nothing dated in this {view === 'month' ? 'month' : 'week'}.
        </p>
      )}
    </div>
  )
}
