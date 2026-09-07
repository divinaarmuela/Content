'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus } from 'lucide-react'
import { useTable } from '@/lib/db-client'
import type { ScheduleEntry } from '@/lib/db-types'
import { pageCards, type BoardViewer } from '../../lib/board-view-core'
import { dayKeyInZone, DEFAULT_TZ } from '../../lib/timezone-core'
import { useWorkRows } from '../useLiveWork'
import { useRole } from '../useRole'
import { todayKey } from '../ui/tone'
import { AccountUnavailable } from '../production/shoot-ui'
import GettingStarted from '../GettingStarted'
import { Board, useBoardParams, type BoardCardRow } from '../board/Board'
import { CardSheet, useCardSheet } from '../board/CardSheet'
import { NewCardDialog } from '../board/BoardDialogs'
import { useTeamMembers } from '../production/workHooks'

/**
 * THE SCHEDULER PAGE: links and what needs doing, on the whole board.
 *
 * Every content card for the clients the person holds, on the one board.
 * The two stages a scheduler works — Ready to post, Posted — get full
 * lanes; everything before them (Draft, Internal check, With client) is
 * folded into one narrow "Coming up" lane, so what is coming is visible
 * before it is ready without three columns sitting empty. Each card
 * carries the link to the work and what needs doing. The scheduler
 * takes those and posts on the Schedule page — one pill away in the header
 * — or wherever they post; back here the card just moves, Ready to post →
 * Posted. The card never asks for a channel, a time or a live link.
 *
 * The two fetches below feed the Overview's lenses only — "Going out today"
 * (`?show=today`) and "Waiting on an account" (`?show=account`) — and the
 * board works without either.
 */
export default function SchedulerPage() {
  const { me, noAccount } = useRole()
  const viewer = useMemo<BoardViewer | null>(
    () => (me && me.role !== 'client' ? { id: me.id, role: me.role } : null), [me])
  // schedulerPostFilter off: the board shows the whole scoped list and the
  // columns say what each card is
  const live = useWorkRows(viewer, { schedulerPostFilter: false })
  const { column, show, clearShow } = useBoardParams()
  // the card that is open beside the board, named in the address
  const sheet = useCardSheet()
  // any team role makes work — the owner's rule; a scheduler's odd task
  // (trend research, a caption pass) is a card like any other
  const isManager = viewer?.role === 'account_manager' || viewer?.role === 'super_admin'
  const team = useTeamMembers(isManager)
  const [newOpen, setNewOpen] = useState(false)
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => { setToday(todayKey()) }, [])

  /** clients with at least one connected channel — for "Waiting on an account" */
  const [connectedClientIds, setConnectedClientIds] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/social/accounts', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json()
        const ids = new Set<string>()
        for (const a of (json.accounts ?? []) as { client_id: string | null; platform: string; active: boolean }[]) {
          if (a.active && a.client_id) ids.add(a.client_id)
        }
        if (!cancelled) setConnectedClientIds(ids)
      } catch { /* no channels known — the lens shows every ready card */ }
    })()
    return () => { cancelled = true }
  }, [])

  /** the posts booked for today — for "Going out today" */
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
    // the same cards Production shows, minus shoot briefs — those are plans
    // for a shoot, not something to post
    const rows = (live.items as unknown as BoardCardRow[]).filter(c => (c.work_kinds?.slug ?? '') !== 'shoot_brief')
    return pageCards('scheduler', rows, viewer, today)
  }, [live.items, viewer, today])
  const ready = viewer !== null && !live.loading && today !== null

  if (noAccount) return <AccountUnavailable />

  return (
    <div className="flex flex-col gap-4">
      {viewer && (
        <div className="flex justify-end">
          <Button onClick={() => setNewOpen(true)}
            className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90">
            <Plus className="h-4 w-4" /> New card
          </Button>
        </div>
      )}
      {ready && <GettingStarted role={viewer.role} page="scheduler" />}

      {!ready ? (
        <div className="grid gap-3.5 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-card" />)}
        </div>
      ) : (
        <Board
          cards={cards}
          viewer={viewer}
          page="scheduler"
          names={names}
          kinds={live.tables.workKinds.rows}
          today={today}
          onOpen={c => sheet.open(c.id)}
          initialColumn={column}
          show={show}
          onClearShow={clearShow}
          postingToday={postingToday}
          connectedClientIds={connectedClientIds}
          ariaLabel="Every card, by stage"
        />
      )}
      {/* the card, beside the board — the board stays live behind it */}
      <CardSheet id={sheet.cardId} onClose={sheet.close} />
      {viewer && (
        <NewCardDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          clients={live.clients.map(c => ({ id: c.id, name: c.name }))}
          kinds={live.tables.workKinds.rows}
          team={team}
          viewer={{ ...viewer, name: me?.name }}
        />
      )}
    </div>
  )
}
