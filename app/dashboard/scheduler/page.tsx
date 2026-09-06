'use client'

import { useEffect, useMemo, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useTable } from '@/lib/db-client'
import type { ScheduleEntry } from '@/lib/db-types'
import { pageCards, pageColumns, type BoardViewer } from '../../lib/board-view-core'
import { isAsset } from '../../lib/work-pages-core'
import { dayKeyInZone, DEFAULT_TZ } from '../../lib/timezone-core'
import { useWorkRows } from '../useLiveWork'
import { useRole } from '../useRole'
import { todayKey } from '../ui/tone'
import { AccountUnavailable } from '../production/shoot-ui'
import GettingStarted from '../GettingStarted'
import { Board, useBoardParams, type BoardCardRow } from '../board/Board'

/**
 * THE SCHEDULER PAGE: Ready to post, and Posted.
 *
 * Two columns of the one board. A Ready-to-post card is booked in from the
 * card — a channel and a time — and marked posted the same way. The Schedule
 * page (the posting calendar) is one pill away in the header.
 *
 * Anything handed to the scheduler rides along whatever column it is in, so
 * an internal task they hold is never on a page they cannot open.
 */
export default function SchedulerPage() {
  const { me, noAccount } = useRole()
  const viewer = useMemo<BoardViewer | null>(
    () => (me && me.role !== 'client' ? { id: me.id, role: me.role } : null), [me])
  // schedulerPostFilter off: the board shows the whole scoped list and the
  // columns say what each card is
  const live = useWorkRows(viewer, { schedulerPostFilter: false })
  const { column, show, clearShow } = useBoardParams()
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => { setToday(todayKey()) }, [])

  /** every client's connected channels, for booking in and for "waiting on
   *  an account" — the board still works without it */
  const [connected, setConnected] = useState<Record<string, string[]>>({})
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/social/accounts', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json()
        const map: Record<string, string[]> = {}
        for (const a of (json.accounts ?? []) as { client_id: string | null; platform: string; active: boolean }[]) {
          if (!a.active || !a.client_id) continue
          ;(map[a.client_id] ??= []).push(String(a.platform).toLowerCase())
        }
        if (!cancelled) setConnected(map)
      } catch { /* no channels known — every platform is offered */ }
    })()
    return () => { cancelled = true }
  }, [])
  const connectedClientIds = useMemo(() => new Set(Object.keys(connected)), [connected])

  /** the posts booked for today, so "Going out today" is a lens here too */
  const { rows: entries } = useTable<ScheduleEntry>('schedule_entries', { enabled: viewer !== null })
  const zone = me?.timezone || DEFAULT_TZ
  const postingToday = useMemo(() => {
    const out = new Set<string>()
    if (!today) return out
    for (const e of entries) {
      if (e.scheduled_at && dayKeyInZone(e.scheduled_at, zone) === today) out.add(e.item_id)
    }
    return out
  }, [entries, today, zone])

  const names = useMemo(
    () => new Map(live.tables.team.rows.map(u => [u.id, u.name || u.email])),
    [live.tables.team.rows])

  const cards = useMemo(() => {
    if (!viewer) return [] as BoardCardRow[]
    const rows = (live.items as unknown as BoardCardRow[]).filter(c => (c.work_kinds?.slug ?? '') !== 'shoot_brief')
    return pageCards('scheduler', rows, viewer, { isAsset: c => isAsset(c) })
  }, [live.items, viewer])
  const columns = useMemo(() => (viewer ? pageColumns('scheduler', viewer, cards) : []), [viewer, cards])
  const ready = viewer !== null && !live.loading && today !== null

  if (noAccount) return <AccountUnavailable />

  return (
    <div className="flex flex-col gap-4">
      {ready && <GettingStarted role={viewer.role} page="scheduler" />}

      {!ready ? (
        <div className="grid gap-3.5 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-card" />)}
        </div>
      ) : (
        <Board
          cards={cards}
          viewer={viewer}
          columns={columns}
          names={names}
          kinds={live.tables.workKinds.rows}
          today={today}
          initialColumn={column}
          show={show}
          onClearShow={clearShow}
          connected={connected}
          postingToday={postingToday}
          connectedClientIds={connectedClientIds}
          ariaLabel="Cards to post, by stage"
        />
      )}
    </div>
  )
}
