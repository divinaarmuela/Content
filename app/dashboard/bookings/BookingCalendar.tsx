'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import BookingDetails, { type BookingDetail } from './BookingDetails'

/**
 * The month a booking sits in, not just the row it occupies.
 *
 * A list answers "what did we take"; only a grid answers "what does Thursday
 * look like" and "are we double-stacked on Tuesday" — which is the question
 * you actually open a bookings page to ask. Filterable per resource, because
 * tech@'s week and hello@'s week are different weeks.
 */

export type CalBooking = BookingDetail

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Monday-first grid offset for a JS day (0=Sun). */
const gridIndex = (jsDay: number) => (jsDay + 6) % 7

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-AU', { timeZone: 'Australia/Melbourne', hour: 'numeric', minute: '2-digit' })

export default function BookingCalendar({ bookings }: { bookings: CalBooking[] }) {
  const today = new Date()
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() })
  const [resource, setResource] = useState<string>('all')
  /** the booking opened out beneath the grid — clicking a day's chip shows
   *  who it is and how to reach them, which the grid alone never did */
  const [open, setOpen] = useState<string | null>(null)

  const resources = useMemo(
    () => [...new Set(bookings.map(b => b.booking_resources?.label).filter((l): l is string => Boolean(l)))].sort(),
    [bookings],
  )

  const shown = useMemo(
    () => bookings.filter(b =>
      b.status !== 'cancelled'
      && (resource === 'all' || b.booking_resources?.label === resource)),
    [bookings, resource],
  )

  // group by local calendar day — the key is what a person reads off a wall
  const byDay = useMemo(() => {
    const map = new Map<string, CalBooking[]>()
    for (const b of shown) {
      const d = new Date(b.start_at)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      map.set(key, [...(map.get(key) ?? []), b])
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.start_at.localeCompare(b.start_at))
    }
    return map
  }, [shown])

  const first = new Date(cursor.y, cursor.m, 1)
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const lead = gridIndex(first.getDay())
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const monthLabel = first.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
  const step = (n: number) => setCursor(c => {
    const d = new Date(c.y, c.m + n, 1)
    return { y: d.getFullYear(), m: d.getMonth() }
  })

  const isToday = (day: number) =>
    today.getFullYear() === cursor.y && today.getMonth() === cursor.m && today.getDate() === day

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => step(-1)} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-40 text-sm font-medium">{monthLabel}</span>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => step(1)} aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs"
          onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}>
          Today
        </Button>

        {resources.length > 1 && (
          <div className="ml-auto flex flex-wrap gap-1">
            {['all', ...resources].map(r => (
              <button key={r} type="button" onClick={() => setResource(r)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  resource === r
                    ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border-zinc-200 text-zinc-500 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400'
                }`}>
                {r === 'all' ? 'Everyone' : r}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* a month grid needs room: below ~560px the cells were 55px wide and
          unreadable, with no way to scroll to the rest of the week */}
      <div className="overflow-x-auto">
      <div className="grid min-w-[560px] grid-cols-7 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800">
        {WEEKDAYS.map(d => (
          <div key={d} className="bg-zinc-50 py-1.5 text-center font-mono text-[10px] uppercase tracking-wider text-zinc-400 dark:bg-zinc-900 dark:text-zinc-500">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          const list = day ? byDay.get(`${cursor.y}-${cursor.m}-${day}`) ?? [] : []
          return (
            <div key={i}
              className={`min-h-24 bg-white p-1.5 dark:bg-zinc-950 ${day ? '' : 'opacity-40'}`}>
              {day && (
                <>
                  <span className={`font-mono text-[11px] tabular-nums ${
                    isToday(day)
                      ? 'rounded bg-zinc-900 px-1 text-white dark:bg-zinc-100 dark:text-zinc-900'
                      : 'text-zinc-400 dark:text-zinc-500'
                  }`}>
                    {day}
                  </span>
                  <div className="mt-1 flex flex-col gap-1">
                    {list.slice(0, 4).map(b => {
                      // an unpaid hold is somebody mid-checkout, not a booked
                      // session — it must never look identical to one
                      const held = b.status === 'pending'
                      return (
                        <button key={b.id} type="button"
                          onClick={() => setOpen(o => (o === b.id ? null : b.id))}
                          title={`${timeLabel(b.start_at)} · ${b.booking_services?.name ?? 'Booking'} · ${b.customer_name}${b.booking_resources?.label ? ` · ${b.booking_resources.label}` : ''}${held ? ' · awaiting payment' : ''}`}
                          className={`w-full truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight ${
                            held
                              ? 'border border-dashed border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                              : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                          }`}>
                          <span className="font-mono">{timeLabel(b.start_at)}</span>{' '}
                          {b.customer_name}
                          {held && <span className="ml-1 opacity-70">· holding</span>}
                        </button>
                      )
                    })}
                    {list.length > 4 && (
                      <span className="px-1 text-[10px] text-zinc-400">+{list.length - 4} more</span>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
      </div>

      {(() => {
        const picked = bookings.find(b => b.id === open)
        return picked ? <div className="mt-3"><BookingDetails booking={picked} /></div> : null
      })()}
    </div>
  )
}
