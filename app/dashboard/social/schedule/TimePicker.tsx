'use client'

import { useEffect, useRef, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  clockPillLabel, joinClock, splitClock, to12, to24,
  HOURS_12, MINUTE_STEPS, type ClockValue, type Meridiem,
} from '@/app/lib/schedule-compose-core'
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

const dayCell = 'h-10 w-10 rounded-tile text-center text-[13px] p-0 relative'

/** 'YYYY-MM-DD' → the Date react-day-picker wants, read as a plain day (UTC,
 *  so no zone can shift it onto the day before). */
function dayOf(key: string | null): Date | undefined {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return undefined
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}
const keyOf = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`

export default function TimePicker({
  value, tz, onChange, disabled,
}: {
  /** the instant the post goes out, or null */
  value: string | null
  /** the client's zone — the whole point of this component */
  tz: string
  onChange: (iso: string | null) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // the zone this browser is in — a scheduler overseas sees the client's
  // time AND their own, so nobody converts in their head
  const [mine, setMine] = useState<string | null>(null)
  useEffect(() => {
    try { setMine(Intl.DateTimeFormat().resolvedOptions().timeZone || null) } catch { setMine(null) }
  }, [])

  // a panel that will not close is a panel that covers the thing you wanted
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const today = dayKeyInZone(Date.now(), tz) ?? ''
  // no time chosen yet: the fields have to show something, and the client's
  // today at 6 pm is a better guess than an empty box nobody can act on
  const current: ClockValue = splitClock(value, tz)
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

      {open && (
        // bg-popover, not bg-surface: a panel that floats has to sit ABOVE the
        // card behind it in dark mode or it disappears into it
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-[300px] rounded-inner border border-border bg-popover p-3 shadow-lg">
          <DayPicker
            mode="single"
            selected={dayOf(current.dayKey)}
            defaultMonth={dayOf(current.dayKey)}
            onSelect={d => { if (d) set({ dayKey: keyOf(d) }) }}
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
              button_previous:
                'absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground hover:bg-muted',
              button_next:
                'absolute right-0 top-0 flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground hover:bg-muted',
              month_grid: 'w-full border-collapse',
              weekdays: 'flex',
              weekday: 'w-10 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground',
              week: 'mt-1 flex w-full',
              day: dayCell,
              day_button: 'h-10 w-10 rounded-tile font-medium hover:bg-muted',
              selected: '[&>button]:bg-foreground [&>button]:text-background',
              today: '[&>button]:font-bold [&>button]:text-accent-blue',
              outside: 'opacity-40',
              disabled: 'opacity-30',
              hidden: 'invisible',
            }}
            components={{
              Chevron: ({ orientation }) =>
                orientation === 'left'
                  ? <ChevronLeft className="h-4 w-4" strokeWidth={2} />
                  : <ChevronRight className="h-4 w-4" strokeWidth={2} />,
            }}
          />

          <div className="mt-2 flex items-center gap-1.5 border-t border-border pt-3">
            <Field
              label="Hour"
              value={String(current.hour12)}
              options={HOURS_12.map(h => [String(h), String(h)])}
              onChange={v => set({ hour12: Number(v) })}
            />
            <span className="text-[15px] font-semibold">:</span>
            <Field
              label="Minute"
              value={String(current.minute)}
              options={MINUTE_STEPS.map(m => [String(m), String(m).padStart(2, '0')])}
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
      )}
    </div>
  )
}

/** A labelled select, 44px, no invented styling. */
function Field({ label, value, options, onChange }: {
  label: string
  value: string
  options: [string, string][]
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
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

export { to12, to24 }
