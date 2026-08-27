'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import PlatformIcon from '../social/PlatformIcon'
import { useProductionLive } from '../production/useProductionLive'
import {
  DEFAULT_TZ, dayKeyInZone, formatInZone, formatWithZone, viewerHint, zoneAbbrev,
} from '../../lib/timezone-core'

type Entry = {
  id: string
  item_id: string
  platform: string
  scheduled_at: string | null
  publish_status: 'scheduled' | 'published'
  published_at: string | null
  live_url: string | null
  content_items: {
    id: string; title: string; status: string; content_type: string
    client_id: string; clients: { name: string; timezone?: string | null } | null
  } | null
}

/** The zone a row's time belongs to — its client's, and never the browser's. */
const tzOf = (e: Entry) => e.content_items?.clients?.timezone || DEFAULT_TZ

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Monday-first grid covering the weeks that contain this month. */
function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = new Date(first)
  const weekday = (first.getDay() + 6) % 7          // Monday = 0
  start.setDate(first.getDate() - weekday)

  const cells: Date[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    cells.push(d)
  }
  // trim the trailing week when it is entirely next month
  const lastWeek = cells.slice(35)
  return lastWeek.every(d => d.getMonth() !== anchor.getMonth()) ? cells.slice(0, 35) : cells
}

const key = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * The calendar is the same data as the queue, one zoom level out: what is
 * booked, when, and whether it actually went out. Published entries carry
 * their live link so the client-facing URL is one click from the date.
 */
export default function ScheduleCalendar() {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [anchor, setAnchor] = useState(() => new Date())
  /** the viewer has moved the calendar themselves — stop steering it */
  const [pinned, setPinned] = useState(false)
  /** the reader's own zone, for the "= your time" half of a tooltip */
  const [viewerTz, setViewerTz] = useState<string | null>(null)
  useEffect(() => {
    try { setViewerTz(Intl.DateTimeFormat().resolvedOptions().timeZone || null) } catch { /* no hint */ }
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/production/schedule')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load the schedule')
      setEntries(json)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the schedule')
      setEntries([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  // live calendar: schedule entries appear as they are set, no reload
  useProductionLive(load)

  /**
   * Which cell a post sits in.
   *
   * The date of a post is the date in the AUDIENCE's zone. A 9 am Melbourne
   * post is Thursday for the client and Wednesday night for a scheduler in
   * Los Angeles; putting it on Wednesday because that is where the browser
   * filed it would make the calendar disagree with the client's own portal
   * about which day their post goes out.
   */
  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>()
    for (const e of entries ?? []) {
      if (!e.scheduled_at) continue
      const k = dayKeyInZone(e.scheduled_at, tzOf(e))
      if (!k) continue
      map.set(k, [...(map.get(k) ?? []), e])
    }
    return map
  }, [entries])

  // Opening on an empty month above a badge reading "1 scheduled" makes the
  // whole calendar look broken. Land on the soonest month that HAS something
  // — this month when it does, otherwise the nearest one that does — until
  // the viewer takes the wheel with the arrows or Today.
  useEffect(() => {
    if (pinned || entries === null) return
    const dated = entries.map(e => e.scheduled_at).filter((d): d is string => !!d).sort()
    if (dated.length === 0) return
    const now = new Date()
    const inThisMonth = dated.some(d => {
      const x = new Date(d)
      return x.getFullYear() === now.getFullYear() && x.getMonth() === now.getMonth()
    })
    if (inThisMonth) return
    // the next one coming up, or — with nothing ahead — the most recent
    const upcoming = dated.find(d => new Date(d) >= now) ?? dated[dated.length - 1]
    const target = new Date(upcoming)
    setAnchor(new Date(target.getFullYear(), target.getMonth(), 1))
  }, [entries, pinned])

  const cells = monthGrid(anchor)
  const monthLabel = anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const todayKey = key(new Date())

  const unscheduled = (entries ?? []).filter(e => !e.scheduled_at).length
  // …and say how many of the total are in the month actually on screen
  const anchorMonthKey = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, '0')}`
  const inMonth = (entries ?? []).filter(e => {
    if (!e.scheduled_at) return false
    // counted by the client's calendar, the same one the cells are filled from
    return dayKeyInZone(e.scheduled_at, tzOf(e))?.slice(0, 7) === anchorMonthKey
  }).length

  if (entries === null) {
    return <Skeleton className="h-[480px] w-full" />
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm"
          onClick={() => { setPinned(true); setAnchor(a => new Date(a.getFullYear(), a.getMonth() - 1, 1)) }}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-44 text-sm font-medium">{monthLabel}</span>
        <Button variant="outline" size="sm"
          onClick={() => { setPinned(true); setAnchor(a => new Date(a.getFullYear(), a.getMonth() + 1, 1)) }}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => { setPinned(true); setAnchor(new Date()) }}>Today</Button>

        <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
          {inMonth} this month · {(entries ?? []).filter(e => e.scheduled_at).length} in total
          {unscheduled > 0 && ` · ${unscheduled} with no date`}
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-7 gap-px rounded-t-lg bg-zinc-200 dark:bg-zinc-800">
            {DAYS.map(d => (
              <div key={d} className="bg-white px-2 py-1.5 text-xs font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px rounded-b-lg bg-zinc-200 dark:bg-zinc-800">
            {cells.map(d => {
              const k = key(d)
              const dayEntries = byDay.get(k) ?? []
              const otherMonth = d.getMonth() !== anchor.getMonth()
              return (
                <div key={k}
                  className={`min-h-[96px] bg-white p-1.5 dark:bg-zinc-900 ${otherMonth ? 'opacity-40' : ''}`}>
                  <div className="flex items-center">
                    <span className={`text-xs tabular-nums ${
                      k === todayKey
                        ? 'flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                        : 'text-zinc-400 dark:text-zinc-500'
                    }`}>
                      {d.getDate()}
                    </span>
                  </div>

                  <ul className="mt-1 flex flex-col gap-1">
                    {dayEntries.slice(0, 3).map(e => {
                      const live = e.publish_status === 'published'
                      return (
                        <li key={e.id}>
                          <Link href={`/dashboard/production/${e.item_id}`}
                            className={`flex items-center gap-1 rounded px-1 py-0.5 text-[11px] transition-colors ${
                              live
                                ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300'
                                : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300'
                            }`}
                            title={[
                              `${e.content_items?.title ?? 'Item'} · ${e.content_items?.clients?.name ?? ''}`,
                              formatWithZone(e.scheduled_at, tzOf(e)),
                              viewerHint(e.scheduled_at, tzOf(e), viewerTz),
                            ].filter(Boolean).join(' · ')}>
                            <PlatformIcon platform={e.platform} size={12} />
                            <span className="truncate">
                              {/* the client's clock, and its letters, because a
                                  cell reading "09:00" is a different post for
                                  every country reading it */}
                              {e.scheduled_at && `${formatInZone(e.scheduled_at, tzOf(e), 'time')} ${zoneAbbrev(tzOf(e), e.scheduled_at)}`}
                              {' '}
                              {e.content_items?.title ?? 'Untitled'}
                            </span>
                            {live && e.live_url && <ExternalLink className="h-2.5 w-2.5 shrink-0" />}
                          </Link>
                        </li>
                      )
                    })}
                    {dayEntries.length > 3 && (
                      <li className="px-1 text-[11px] text-zinc-400 dark:text-zinc-500">
                        +{dayEntries.length - 3} more
                      </li>
                    )}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Green means published, with a live link. Grey is booked but not yet out.
      </p>
    </div>
  )
}
