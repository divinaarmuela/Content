'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The month grid in the right-hand rail: Monday first, today filled ink, and
 * the days that have something on them tinted — shoots amber, posts blue,
 * client reviews green. Under it sits the one action the rail is for.
 *
 * Presentation only: the page passes the rows it already holds. Dates are
 * plain `YYYY-MM-DD` strings so nothing depends on the reader's time zone
 * matching Melbourne's.
 */

export type MarkerKind = 'shoot' | 'post' | 'review'
export type Marker = { date: string; kind: MarkerKind }

const MARKER_TINT: Record<MarkerKind, string> = {
  shoot: 'bg-tint-amber',
  post: 'bg-tint-blue',
  review: 'bg-tint-green',
}

const MARKER_WORD: Record<MarkerKind, string> = {
  shoot: 'shoot',
  post: 'post going out',
  review: 'client review',
}

/** loudest first — a day with a shoot and a post reads as a shoot day */
const PRIORITY: MarkerKind[] = ['shoot', 'post', 'review']

const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

/** local calendar date, never UTC — `toISOString()` would shift Melbourne back a day */
function key(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function MiniCalendar({
  month, markers = [], onMonthChange, onPick, action, today, className,
}: {
  /** any date inside the month being shown */
  month: Date
  markers?: Marker[]
  /** omit and the arrows are not drawn at all */
  onMonthChange?: (next: Date) => void
  onPick?: (date: string) => void
  /** the 44px ink button under the grid, e.g. { label: 'Book a shoot', href: '/dashboard/bookings' } */
  action?: { label: string; href: string }
  /** fixed "today" for tests; left out, it is read on the client after mount */
  today?: Date
  className?: string
}) {
  // reading the clock during render would disagree between the server (UTC)
  // and the browser (Melbourne) and hydrate wrong, so it is read after mount
  const [now, setNow] = useState<string | null>(today ? key(today) : null)
  useEffect(() => { if (!today) setNow(key(new Date())) }, [today])

  const year = month.getFullYear()
  const m = month.getMonth()
  const first = new Date(year, m, 1)
  const offset = (first.getDay() + 6) % 7            // Monday-first
  const daysInMonth = new Date(year, m + 1, 0).getDate()
  const weeks = Math.ceil((offset + daysInMonth) / 7)

  const byDate = new Map<string, MarkerKind[]>()
  for (const mk of markers) {
    const list = byDate.get(mk.date) ?? []
    list.push(mk.kind)
    byDate.set(mk.date, list)
  }

  const cells = Array.from({ length: weeks * 7 }, (_, i) => new Date(year, m, i - offset + 1))
  const label = first.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })

  const arrow = (dir: -1 | 1, Icon: typeof ChevronLeft, aria: string) => (
    onMonthChange ? (
      <button
        type="button"
        aria-label={aria}
        onClick={() => onMonthChange(new Date(year, m + dir, 1))}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-foreground/[0.06]"
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </button>
    ) : null
  )

  return (
    /* p-3, not p-5: seven real 44px day buttons need 308px, and 12px padding
       leaves 312px inside the 336px rail. The card's own breathing room comes
       from the buttons being 10px taller than the 34px dot they draw. */
    <section className={cn('flex flex-col gap-3.5 rounded-card border border-border bg-surface p-3 text-foreground', className)}>
      <div className="flex items-center justify-between gap-2">
        {arrow(-1, ChevronLeft, 'Previous month')}
        <h2 className="rounded-full bg-foreground px-2.5 py-1.5 text-chip-12 text-background">{label}</h2>
        {arrow(1, ChevronRight, 'Next month')}
      </div>

      {/* no gap: every column is one 44px-wide button whose visible 34px dot is
          centred inside it, so the tap areas touch and never overlap — the
          edge of a cell belongs to that cell */}
      <div className="grid grid-cols-7">
        {WEEKDAYS.map(d => (
          <div key={d} className="pb-1 text-center text-[11px] font-semibold tracking-[0.06em] text-muted-foreground">{d}</div>
        ))}
        {cells.map(d => {
          const k = key(d)
          const outside = d.getMonth() !== m
          const isToday = now === k
          const kinds = byDate.get(k) ?? []
          const kind = PRIORITY.find(p => kinds.includes(p))
          const what = kinds.length
            ? `, ${PRIORITY.filter(p => kinds.includes(p)).map(p => MARKER_WORD[p]).join(' and ')}`
            : ''
          return (
            <button
              key={k}
              type="button"
              disabled={!onPick}
              onClick={() => onPick?.(k)}
              aria-label={`${d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}${isToday ? ', today' : ''}${what}`}
              aria-current={isToday ? 'date' : undefined}
              className={cn('flex h-11 w-full items-center justify-center', onPick && 'cursor-pointer')}
            >
              {/* the button is the 44px target; this is the 34px dot you see */}
              <span
                className={cn(
                  'flex h-[34px] w-[34px] items-center justify-center rounded-full text-[13px] font-medium tabular-nums',
                  isToday ? 'bg-foreground text-background'
                    : kind ? MARKER_TINT[kind]
                    : '',
                  outside && !isToday ? 'text-foreground/30' : 'text-foreground',
                  isToday && 'text-background',
                )}
              >
                {d.getDate()}
              </span>
            </button>
          )
        })}
      </div>

      {action && (
        <Link
          href={action.href}
          className="flex h-11 w-full items-center justify-center rounded-full bg-foreground text-[14px] font-semibold text-background transition-opacity hover:opacity-90"
        >
          {action.label}
        </Link>
      )}
    </section>
  )
}
