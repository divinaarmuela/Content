'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DayPicker } from 'react-day-picker'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  calendarDateToDayKey, clockPillLabel, dayKeyToCalendarDate, joinClock, splitClock, to12, to24,
  HOURS_12, type ClockValue, type Meridiem,
} from '@/app/lib/schedule-compose-core'
import { defaultPostTime, hourIsPast, minuteIsPast, minuteOptions } from '@/app/lib/post-window-core'
import { dayKeyInZone, formatInZone, zoneLabel } from '@/app/lib/timezone-core'

/**
 * WHEN THE POST GOES OUT.
 *
 * A month to pick a day from, and an hour, a minute and am/pm beside it —
 * the shape Later uses, because it is the shape a person already knows.
 *
 * The one thing it refuses to get wrong: EVERY FIELD IS THE CLIENT'S TIME.
 * The calendar's "today", the hour in the box and the sentence underneath are
 * all read in the client's zone, so somebody in Manila scheduling for a
 * Melbourne restaurant picks 6:30 pm and the restaurant's followers see it at
 * 6:30 pm. `splitClock`/`joinClock` are the conversion, tested as inverses;
 * nothing in this file does date arithmetic of its own.
 *
 * The calendar is `react-day-picker`, already in the app, dressed in the
 * restyle's tokens rather than the marketing site's hexes so it is readable
 * in dark mode.
 */

/* EVERY CELL IS 40px, AND SO IS ITS BUTTON. The grid used to be `w-full`
 * with flex rows, so the cells took whatever width the panel gave them while
 * the buttons stayed 40px: on a narrower layout the cells came out at ~29px
 * and each 40px button spilled over the next cell — hover "15", and "14"
 * lit up (the owner, 9 Sep 2026). A fixed 280px grid (7 × 40) centred in
 * the panel cannot do that. */
// PIXELS, NOT REM: `w-10` is 2.5rem, and the dashboard's root font size is
// not 16px — the cells measured 48px, seven of them overran the 340px panel,
// Sunday sat outside the box and the hover landed one cell off (the owner,
// 9 Sep 2026: "I'm hovering over 13 and 13 is out of the box").
const dayCell = 'h-[40px] w-[40px] shrink-0 rounded-tile text-center text-[13px] p-0 relative text-foreground'

/** 'YYYY-MM-DD' ⇄ the Date react-day-picker draws and hands back — one frame
 *  of reference, the browser's local day, in BOTH directions. The UTC pair
 *  this replaced booked the day before for anyone east of Greenwich (see
 *  `dayKeyToCalendarDate` in schedule-compose-core, and its test). */
const dayOf = dayKeyToCalendarDate
const keyOf = calendarDateToDayKey

export default function TimePicker({
  value, tz, onChange, disabled, now: nowChip,
}: {
  /** the instant the post goes out, or null */
  value: string | null
  /** the client's zone — the whole point of this component */
  tz: string
  onChange: (iso: string | null) => void
  disabled?: boolean
  /**
   * THE "NOW" CHIP (audit W3, 29 Sep 2026). It is Post now, for a post that
   * is approved and may be booked; anywhere else it is drawn disabled with
   * the reason on it ("Approve first") — never missing while a refusal tells
   * someone to choose it. Leave it out where "now" means nothing.
   */
  now?: { enabled: boolean; reason: string | null; onNow: () => void } | null
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // the zone this browser is in — a scheduler overseas sees the client's
  // time AND their own, so nobody converts in their head
  const [mine, setMine] = useState<string | null>(null)
  /* The composer scrolls inside itself, and an absolutely-placed panel is
   * CLIPPED by a scrolling ancestor — the calendar was being cut off halfway
   * down the window. So the panel is rendered to the body and placed from the
   * button's own position, above the button when there is no room below. */
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (!open) { setAt(null); return }
    const place = () => {
      const el = box.current?.querySelector('button')
      if (!el) return
      const r = el.getBoundingClientRect()
      const PANEL = 380
      const below = window.innerHeight - r.bottom
      setAt({
        // the panel is 340 wide: seven 40px day cells plus the picker's own
        // gutters overran a 300px panel and Sunday spilled past the border —
        // seen on a laptop, 8 Sep 2026, which is where posts are scheduled
        left: Math.min(Math.max(8, r.left), window.innerWidth - 356),
        top: below > PANEL ? r.bottom + 6 : Math.max(8, r.top - PANEL - 6),
      })
    }
    place()
    // once per frame: a scroll fires many times a frame, and re-placing (and
    // re-rendering the month) on each was part of the lag
    let raf = 0
    const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; place() }) }
    window.addEventListener('scroll', later, true)
    window.addEventListener('resize', later)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', later, true)
      window.removeEventListener('resize', later)
    }
  }, [open])
  useEffect(() => {
    try { setMine(Intl.DateTimeFormat().resolvedOptions().timeZone || null) } catch { setMine(null) }
  }, [])

  // a panel that will not close is a panel that covers the thing you wanted
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      const t = e.target as Node
      const inPanel = t instanceof Element && t.closest('[data-time-panel]')
      if (box.current && !box.current.contains(t) && !inPanel) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const nowMs = Date.now()
  const today = dayKeyInZone(nowMs, tz) ?? ''
  // no time chosen yet: the fields start on the next quarter-hour at least 15
  // minutes out. "Today at 6 pm" was already gone for anyone after 6 pm, and
  // the button was then refused (audit W9, 29 Sep 2026).
  const current: ClockValue = splitClock(value, tz)
    ?? splitClock(defaultPostTime(nowMs), tz)
    ?? { dayKey: today, hour12: 6, minute: 0, meridiem: 'pm' }

  const set = (patch: Partial<ClockValue>) => {
    const next = { ...current, ...patch }
    onChange(joinClock(next, tz))
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex min-h-11 items-center gap-2 rounded-full border border-border bg-paper px-3 text-[13px] font-semibold',
          disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-muted',
        )}
      >
        {clockPillLabel(value, tz)}
        <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
      </button>

      {open && at && createPortal(
        // bg-popover, not bg-surface: a panel that floats has to sit ABOVE the
        // card behind it in dark mode or it disappears into it
        <div data-time-panel
          role="dialog"
          aria-label="Pick the day and time"
          style={{ left: at.left, top: at.top }}
          // bg-popover WITHOUT its foreground left the calendar's day numbers on
          // the browser default — black digits on the dark panel, unreadable.
          className="fixed z-[70] w-[340px] rounded-inner border border-border bg-popover p-3 text-popover-foreground shadow-lg">
          <DayPicker
            mode="single"
            selected={dayOf(current.dayKey)}
            defaultMonth={dayOf(current.dayKey)}
            onSelect={d => { if (d) set({ dayKey: keyOf(d) }) }}
            // "today" is the CLIENT's today, not the browser's: an overseas
            // scheduler booking a Melbourne client sees Melbourne's day ringed
            today={dayOf(today)}
            showOutsideDays
            weekStartsOn={1}
            // a day that has gone cannot hold a post. Refusing it at save time
            // with "That time has already gone" is a correct message about a
            // click that should never have been possible.
            disabled={dayOf(today) ? { before: dayOf(today) as Date } : undefined}
            classNames={{
              months: 'flex flex-col',
              month: 'space-y-2',
              month_caption: 'relative flex items-center justify-center pt-1',
              caption_label: 'text-[14px] font-semibold',
              nav: 'flex items-center',
              // 44px, not 36: month-to-month is the control a thumb reaches
              // for most on this panel
              button_previous:
                'absolute left-0 top-0 flex h-11 w-11 items-center justify-center rounded-full border border-border text-foreground hover:bg-muted',
              button_next:
                'absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-full border border-border text-foreground hover:bg-muted',
              month_grid: 'mx-auto w-[280px] max-w-full border-collapse table-fixed',
              weekdays: 'flex',
              weekday: 'h-[24px] w-[40px] shrink-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground',
              week: 'mt-1 flex',
              day: dayCell,
              day_button: 'block h-[40px] w-[40px] rounded-tile font-medium hover:bg-muted',
              selected: '[&>button]:bg-foreground [&>button]:text-background',
              today: '[&>button]:font-bold [&>button]:text-accent-blue',
              outside: 'opacity-40',
              disabled: 'opacity-30',
              hidden: 'invisible',
            }}
            components={{
              Chevron: ({ orientation }) =>
                orientation === 'left'
                  ? <ChevronLeft className="h-4 w-4" strokeWidth={2} aria-hidden />
                  : <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden />,
            }}
          />

          <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-3">
            {/* An hour that has gone is not offered. The minute box comes in
                five-minute steps and always holds the post's own minute, so
                the pill and the box never disagree (audit W9). */}
            <Field
              label="Hour"
              value={String(current.hour12)}
              options={HOURS_12.map(h => [String(h), String(h), hourIsPast(current, h, tz, nowMs)])}
              onChange={v => set({ hour12: Number(v) })}
            />
            <span className="text-[15px] font-semibold">:</span>
            <Field
              label="Minute"
              value={String(current.minute)}
              options={minuteOptions(current.minute).map(m => [String(m), String(m).padStart(2, '0'), minuteIsPast(current, m, tz, nowMs)])}
              onChange={v => set({ minute: Number(v) })}
            />
            <Field
              label="am or pm"
              value={current.meridiem}
              options={[['am', 'am'], ['pm', 'pm']]}
              onChange={v => set({ meridiem: v as Meridiem })}
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto flex min-h-11 items-center rounded-full bg-foreground px-4 text-[13px] font-semibold text-background"
            >
              Done
            </button>
          </div>

          {nowChip && (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <button
                type="button"
                disabled={!nowChip.enabled}
                title={nowChip.reason ?? 'Post it now'}
                onClick={() => { setOpen(false); nowChip.onNow() }}
                className="flex min-h-11 items-center rounded-full border border-border px-4 text-[13px] font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                Now
              </button>
              {!nowChip.enabled && nowChip.reason && (
                <span className="text-[12px] text-muted-foreground">{nowChip.reason}</span>
              )}
            </div>
          )}

          <p className="pt-2 text-[12px] text-muted-foreground">
            {/* the sentence that stops the whole class of "it went out at 4am"
                surprises: this is the CLIENT's clock, not yours — and for a
                scheduler working from another country, what that is on
                THEIR clock, so nobody does the sum in their head */}
            Times are {zoneLabel(tz)} — the client&rsquo;s time.
            {value && mine && mine !== tz && (
              <> That&rsquo;s {formatInZone(value, mine, 'short')} your time ({zoneLabel(mine)}).</>
            )}
          </p>
        </div>
        , document.body)}
    </div>
  )
}

/** A labelled select, 44px, no invented styling. An option may be marked
 *  gone (a time that has passed) — never the one the post already holds. */
function Field({ label, value, options, onChange }: {
  label: string
  value: string
  options: [string, string, boolean?][]
  onChange: (v: string) => void
}) {
  return (
    <label className="flex flex-col">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="min-h-11 rounded-full border border-border bg-surface px-2.5 text-[13px] font-semibold text-foreground"
      >
        {options.map(([v, l, gone]) => <option key={v} value={v} disabled={gone === true && v !== value}>{l}</option>)}
      </select>
    </label>
  )
}

export { to12, to24 }
