'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import WorkCalendar, { type CalendarView } from '../../components/calendar/WorkCalendar'
import { useProductionLive } from '../production/useProductionLive'
import { usePersistedChoice, usePersistedFlag, usePersistedScope } from '../production/workHooks'
import { useRole } from '../useRole'
import {
  dayLabel, eventsFor, movePatch, moveUrl, suggestedDay, todayKey,
  type CalEntry, type CalEvent, type CalItem,
} from '../../lib/work-calendar-core'
import { schedulerScope, type Viewer } from '../../lib/work-pages-core'
import { DEFAULT_TZ } from '../../lib/timezone-core'

/**
 * The scheduler's month, and now the scheduler's week.
 *
 * It has always answered "what posts when": every schedule entry on the day
 * its AUDIENCE sees it, which is the client's zone and never the browser's.
 * The half it could not answer was "and what is due" — the approved item with
 * a deadline on Thursday sat on the queue, invisible here, so a scheduler
 * planning their week had to read two screens and hold the join in their head.
 *
 * "Tasks due" is that second layer, drawn faint over the posting times: one
 * calendar, two questions, and the posting times still louder than the
 * deadlines because a booked post is a commitment and a due date is a plan.
 */

type Entry = CalEntry & { publish_status: 'scheduled' | 'published' }
/** the scheduling seat rides along — `schedulerScope` is the rule that decides
 *  whose deadlines this layer is allowed to show */
type QueueItem = CalItem & { scheduler_ids?: unknown; batch_id?: string | null }

const RANGE_KEY = 'md-scheduler-cal-range'
const DUE_KEY = 'md-scheduler-cal-due'
const RANGES = ['month', 'week'] as const

export default function ScheduleCalendar() {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [items, setItems] = useState<QueueItem[]>([])
  const [range, setRange] = usePersistedChoice(RANGE_KEY, RANGES, 'month')
  const [showDue, setShowDue] = usePersistedFlag(DUE_KEY, false)

  const { me, role } = useRole()
  const viewer: Viewer | null = me ? { id: me.id, role: me.role } : null
  // the same remembered scope the Queue uses: "mine and the free pool" there
  // means the same thing here, and one switch for two views of one job
  const [scope] = usePersistedScope('md-scheduler-scope', role)

  const load = useCallback(async () => {
    try {
      const [sRes, iRes] = await Promise.all([
        fetch('/api/production/schedule'),
        fetch('/api/production/items', { cache: 'no-store' }),
      ])
      const json = await sRes.json()
      if (!sRes.ok) throw new Error(json.error ?? 'Could not load the schedule')
      setEntries(json)
      setItems(iRes.ok ? await iRes.json() : [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the schedule')
      setEntries([])
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // live calendar: schedule entries appear as they are set, no reload
  useProductionLive(load)

  /** The items this scheduler is holding, or could pick up — the same rule
   *  the queue applies, so the layer never shows a job the queue hides. */
  const held = useMemo(
    () => (viewer ? schedulerScope(items, viewer, scope) : []),
    [items, viewer, scope],
  )

  const calendar = useMemo(
    () => eventsFor('scheduler', {
      entries: entries ?? [],
      items: showDue ? held : [],
    }, DEFAULT_TZ),
    [entries, held, showDue],
  )

  // an empty month above a badge reading "1 scheduled" reads as a broken page
  const openOn = useMemo(
    () => suggestedDay([...calendar.byDay.keys()], todayKey(DEFAULT_TZ)),
    [calendar],
  )

  /** Move a due date from here — the posting times are set on the item's own
   *  posting card, where the zone and the platform are chosen together, so
   *  `eventsFor` marks them immovable and only the due layer offers a drag. */
  const moveEvent = async (e: CalEvent, day: string) => {
    const patch = movePatch(e, day)
    if (!patch) return
    setItems(prev => prev.map(i => (i.id === e.entityId ? { ...i, due_date: day } : i)))
    try {
      const res = await fetch(moveUrl(e), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not move it')
      toast.success(`${e.title} → ${dayLabel(day)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move it')
    } finally {
      void load()
    }
  }

  if (entries === null) return <Skeleton className="h-[480px] w-full" />

  const dueCount = held.filter(i => i.due_date).length

  return (
    <WorkCalendar
      events={calendar}
      viewer={viewer}
      tz={DEFAULT_TZ}
      view={range as CalendarView}
      onViewChange={setRange}
      onMove={moveEvent}
      openOn={openOn}
      undatedLabel={null}
      controls={
        <button type="button" aria-pressed={showDue} onClick={() => setShowDue(!showDue)}
          title="Show the due dates of the items you are scheduling, under the posting times"
          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
            showDue
              ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
              : 'border-zinc-200 text-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
          }`}>
          Tasks due
          {dueCount > 0 && (
            <span className="ml-1.5 font-mono text-[10px] tabular-nums opacity-70">{dueCount}</span>
          )}
        </button>
      }
      legend={
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Green means published, with a live link; grey is booked but not yet out. Times are
          the client&rsquo;s, not yours. Switch on Tasks due for the deadlines behind them —
          those are outlined, and can be dragged.
        </p>
      }
    />
  )
}
