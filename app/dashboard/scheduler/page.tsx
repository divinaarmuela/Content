'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { useTable } from '@/lib/db-client'
import type { ScheduleEntry } from '@/lib/db-types'
import { pageCards, type BoardViewer } from '../../lib/board-view-core'
import { dayKeyInZone, DEFAULT_TZ } from '../../lib/timezone-core'
import { useWorkRows } from '../useLiveWork'
import { useRole } from '../useRole'
import { todayKey } from '../ui/tone'
import { AccountUnavailable } from '../production/shoot-ui'
import GettingStarted from '../GettingStarted'
import NoReviewerBanner from '../ui/NoReviewerBanner'
import { Board, useBoardParams, type BoardCardRow } from '../board/Board'
import { CardSheet, useCardSheet } from '../board/CardSheet'
import { BoardFilters } from '../board/BoardFilters'
import { useBoardFilters } from '../board/useBoardFilters'
import {
  applyFilters, clientsOnCards, filterWords, filteredEmpty, mayFilterPeople, peopleOnCards, validChoice,
} from '../../lib/people-filter-core'
import WaitingOnYou from './WaitingOnYou'

/**
 * THE SCHEDULER PAGE: links and what needs doing, on the whole board.
 *
 * Every content card for the clients the person holds, on the one board.
 * The two stages a scheduler works — Ready to post, Posted — get full
 * lanes; everything before them (Draft, Quality check, With client) is
 * folded into one narrow "Coming up" lane, so what is coming is visible
 * before it is ready without three columns sitting empty. Each card
 * carries the link to the work and what needs doing. Back here the card just
 * moves, Ready to post → Posted; it never asks for a channel, a time or a
 * live link.
 *
 * Writing the post itself is the ONE button in the header (`NewPostButton`),
 * and it happens HERE: files or the client's Drive folder, the preview, and
 * "Send for approval" — the Schedule page's own flow (`useComposeFlow`),
 * opened over this board rather than on another page.
 *
 * Above the board sits "Waiting on you" (`WaitingOnYou` / `waiting-core`):
 * every one of those cards that somebody is actually held up by — a post
 * sent for its final sign-off, a piece waiting on this manager's check, a
 * piece sitting with the client, anything this person was asked for — with
 * the two answers on the row. It reads the same cards the board does and
 * offers only what the same rules already allow.
 *
 * The two fetches below feed the Overview's lenses only — "Going out today"
 * (`?show=today`) and "Waiting on an account" (`?show=account`) — and the
 * board works without either.
 */
export default function SchedulerPage() {
  const { me, noAccount } = useRole()
  const viewer = useMemo<BoardViewer | null>(
    () => (me && me.role !== 'client' ? { id: me.id, role: me.role, quality_reviewer: me.quality_reviewer === true } : null), [me])
  // schedulerPostFilter off: the board shows the whole scoped list and the
  // columns say what each card is
  const live = useWorkRows(viewer, { schedulerPostFilter: false })
  const { column, show, clearShow } = useBoardParams()
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => { setToday(todayKey()) }, [])
  // the card that is open beside the board, named in the address
  const sheet = useCardSheet()
  // (trend research, a caption pass) is a card like any other
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

  const allCards = useMemo(() => {
    if (!viewer) return [] as BoardCardRow[]
    // the same cards Production shows, minus shoot briefs — those are plans
    // for a shoot, not something to post
    const rows = (live.items as unknown as BoardCardRow[]).filter(c => (c.work_kinds?.slug ?? '') !== 'shoot_brief')
    return pageCards('scheduler', rows, viewer, today)
  }, [live.items, viewer, today])
  /* ── who is doing what: the Client and People filters, for the people whose
        job is to look across everyone's work (the owner, 11 Sep 2026) ── */
  const mayFilter = viewer !== null && mayFilterPeople(viewer)
  const filter = useBoardFilters('scheduler')
  const who = useMemo(
    () => new Map(live.tables.team.rows.map(u => [u.id, { name: u.name || u.email, role: String(u.role ?? '') }])),
    [live.tables.team.rows])
  const clientNames = useMemo(() => new Map(live.tables.clients.rows.map(c => [c.id, c.name])), [live.tables.clients.rows])
  const clientRows = useMemo(() => clientsOnCards(allCards, clientNames), [allCards, clientNames])
  const peopleRows = useMemo(() => peopleOnCards(allCards, who), [allCards, who])
  // a remembered or linked id that is not on the board is nobody
  const chosen = useMemo(() => ({
    client: mayFilter ? validChoice(filter.client, clientRows) : null,
    person: mayFilter ? validChoice(filter.person, peopleRows) : null,
  }), [mayFilter, filter.client, filter.person, clientRows, peopleRows])
  const filterNames = {
    person: chosen.person ? (who.get(chosen.person)?.name ?? null) : null,
    client: chosen.client ? (clientNames.get(chosen.client) ?? null) : null,
  }
  const cards = useMemo(() => applyFilters(allCards, chosen), [allCards, chosen])
  const ready = viewer !== null && !live.loading && today !== null

  /**
   * `?item=<id>` — the card an email or the bell points at. Opened once the
   * cards have arrived, and only once: closing it must not reopen it. The
   * owner, 8 Sep 2026: "the email when a scheduler sends is wrong — make sure
   * it takes them to the right place." The right place is the card, open.
   */
  const openedFromAddress = useRef(false)
  useEffect(() => {
    if (!ready || openedFromAddress.current) return
    let wanted: string | null = null
    try { wanted = new URLSearchParams(window.location.search).get('item') } catch { /* no address */ }
    if (!wanted) return
    openedFromAddress.current = true
    if (cards.some(c => c.id === wanted)) sheet.open(wanted)
    else toast.error('That piece is not on this board any more — it may have been deleted.')
  }, [ready, cards, sheet])

  if (noAccount) return <AccountUnavailable />

  return (
    <div className="flex flex-col gap-4">
      {ready && <GettingStarted role={viewer.role} page="scheduler" />}
      {ready && <NoReviewerBanner me={me} />}

      {/* everything stuck on a decision, before the board that holds it —
          hidden entirely when nothing is waiting */}
      {ready && (
        <WaitingOnYou cards={cards} viewer={viewer} today={today} onOpenCard={sheet.open} />
      )}

      {!ready ? (
        <div role="status" aria-label="Loading the board" aria-busy="true" className="grid gap-3.5 md:grid-cols-2">
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
          filters={mayFilter ? (
            <BoardFilters clients={clientRows} people={peopleRows} value={chosen}
              onClient={filter.setClient} onPerson={filter.setPerson} onClear={filter.clear} />
          ) : undefined}
          filterNote={filterWords(chosen, filterNames, cards.length, allCards.length)}
          laneEmpty={label => filteredEmpty(label, chosen, filterNames)}
        />
      )}
      {/* the card, beside the board — the board stays live behind it */}
      {/* ONE drawer for every card (the render audit of 11 Sep 2026): a card
          from a shoot used to open the old production drawer here, without
          the delivery date, Files to work from, the account manager line or
          the editor's tools. The full card page is one press away inside. */}
      <CardSheet id={sheet.cardId} onClose={sheet.close} simple />
    </div>
  )
}
