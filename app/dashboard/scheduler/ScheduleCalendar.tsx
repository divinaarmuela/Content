'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import PlatformIcon from '../social/PlatformIcon'

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
    client_id: string; clients: { name: string } | null
  } | null
}

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

  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>()
    for (const e of entries ?? []) {
      if (!e.scheduled_at) continue
      const k = key(new Date(e.scheduled_at))
      map.set(k, [...(map.get(k) ?? []), e])
    }
    return map
  }, [entries])

  const cells = monthGrid(anchor)
  const monthLabel = anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const todayKey = key(new Date())

  const unscheduled = (entries ?? []).filter(e => !e.scheduled_at).length

  if (entries === null) {
    return <Skeleton className="h-[480px] w-full" />
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm"
          onClick={() => setAnchor(a => new Date(a.getFullYear(), a.getMonth() - 1, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-44 text-sm font-medium">{monthLabel}</span>
        <Button variant="outline" size="sm"
          onClick={() => setAnchor(a => new Date(a.getFullYear(), a.getMonth() + 1, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAnchor(new Date())}>Today</Button>

        <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
          {(entries ?? []).filter(e => e.scheduled_at).length} scheduled
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
                            title={`${e.content_items?.title ?? 'Item'} · ${e.content_items?.clients?.name ?? ''}`}>
                            <PlatformIcon platform={e.platform} size={12} />
                            <span className="truncate">
                              {e.scheduled_at &&
                                new Date(e.scheduled_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
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
