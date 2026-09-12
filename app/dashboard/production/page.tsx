'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { CalendarDays, Kanban, Plus, Search } from 'lucide-react'
import { BoardFilters } from '../board/BoardFilters'
import { useBoardFilters } from '../board/useBoardFilters'
import {
  applyFilters, clientsOnCards, filterWords, filteredEmpty, mayFilterPeople, peopleOnCards, validChoice,
} from '../../lib/people-filter-core'
import type { BatchStatus } from '../../lib/batch-brief-core'
import type { ItemStatus } from '../../lib/workflow-core'
import { isBriefTask } from '../../lib/work-pages-core'
import {
  dayLabel, eventsFor, movePatch, moveUrl, type CalEvent,
} from '../../lib/work-calendar-core'
import WorkCalendar, { ViewSwitch, type CalendarView } from '../../components/calendar/WorkCalendar'
import { useWorkRows } from '../useLiveWork'
import { AccountUnavailable } from './shoot-ui'
import { usePersistedChoice, useTeamMembers } from './workHooks'
import { useRole } from '../useRole'
import NewShootPlanDialog, { type ClientRow } from './NewItemDialog'
import { ShootStageBoard, type StageShoot } from './ShootStageBoard'
import { STAGE_LABEL as SOP_STAGE_LABEL, type ShootStage } from '../../lib/shoot-sop-core'
import PageTitle from '../ui/PageTitle'
import { todayKey } from '../ui/tone'
import GettingStarted from '../GettingStarted'
import HelpHint from '../HelpHint'

/**
 * SHOOTS — one page, one kind of card.
 *
 * It used to be four views (Shoots · List · Board · Calendar) of three kinds
 * of thing — shoots, the plan documents behind them, and internal tasks —
 * and the owner's verdict was "it's confusing". Now the page is shoots and
 * nothing else: one card per filming day in the playbook's six columns
 * (Draft · Shared with team · Confirmed · Reminder sent · Shoot day · Footage
 * handed over), with "By date" as the only other way to look at the same
 * shoots. A shoot's plan — its Milanote-style canvas, the nine-part
 * checklist, who has read it, the Go sign-off and the plan's own approval —
 * lives on the shoot's page, which a card opens. Internal tasks (research,
 * strategy, copy) are ordinary cards and live on the Editor page with
 * everything else that is made.
 */

const VIEW_KEY = 'md-production-view-3'
/** by stage (the SOP columns) or by date — a remembered "board", "list" or
 *  "shoots" from the old page falls back to the columns; "calendar" is
 *  mapped to "date" below so an old link still lands on the calendar */
const VIEWS = ['stage', 'date'] as const
const RANGE_KEY = 'md-production-cal-range'
const RANGES = ['month', 'week'] as const

type Shoot = StageShoot & {
  status: BatchStatus
  shoot_date: string | null
  clients: { name: string } | null
  content_items?: { count: number }[]
}

export default function ProductionPage() {
  const [search, setSearch] = useState('')
  const [planOpen, setPlanOpen] = useState(false)

  const { me, role, loading, can } = useRole()
  // anyone on the team plans a shoot — the shoot page decides whose it then is
  const canPlan = can('scheduler')
  const isManager = can('account_manager')
  const viewer = useMemo(() => (me ? { id: me.id, role: me.role, quality_reviewer: me.quality_reviewer === true } : null), [me])
  const team = useTeamMembers(isManager)

  const [view, setView] = usePersistedChoice(VIEW_KEY, VIEWS, 'stage', 'view')
  // an old "?view=calendar" link (the four-view page) still opens the calendar
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('view') === 'calendar') setView('date')
    } catch { /* no URL, nothing to map */ }
  }, [setView])
  const [range, setRange] = usePersistedChoice(RANGE_KEY, RANGES, 'month')
  const [stageBusy, setStageBusy] = useState<string | null>(null)
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => { setToday(todayKey()) }, [])

  /* the rows, live — scoped the way the server scopes them (scope-client) */
  const live = useWorkRows(viewer)
  const shoots: Shoot[] | null = live.loading ? null : (live.batches as unknown as Shoot[])
  const clients = live.clients as unknown as ClientRow[]
  // schema not migrated yet: rows come back with no status — show the setup card
  const needsSchema = shoots !== null && shoots.length > 0 && shoots.every(r => !r.status)

  const liveError = live.error
  useEffect(() => {
    if (liveError) toast.error('Could not load shoots')
  }, [liveError])

  /** the plan document behind each shoot, for the "Plan …" line on its card
   *  and so a shoot cannot be given a second plan */
  const planByShoot = useMemo(() => {
    const m = new Map<string, ItemStatus>()
    for (const i of live.items as unknown as { batch_id?: string | null; status: ItemStatus; work_kinds?: { slug?: string } | null }[]) {
      if (i.batch_id && isBriefTask(i)) m.set(i.batch_id, i.status)
    }
    return m
  }, [live.items])
  /** cards pointed at each shoot, bar the shoot's own plan — a deliverable
   *  is a line on the plan or a card */
  const itemCountByShoot = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of live.items as unknown as { batch_id?: string | null; work_kinds?: { slug?: string } | null }[]) {
      if (!i.batch_id || isBriefTask(i)) continue
      m.set(i.batch_id, (m.get(i.batch_id) ?? 0) + 1)
    }
    return m
  }, [live.items])
  /** id → name for everyone on the team, from the rows already on the wire */
  const teamNames = useMemo(
    () => new Map(live.tables.team.rows.map(u => [u.id, u.name || u.email])),
    [live.tables.team.rows])

  /* ── who is doing what: the Client and People filters. Everyone here may
        pick a client (the page always could); narrowing to a person is for
        managers, super admins and the quality reviewer (11 Sep 2026) ── */
  const mayFilterPerson = viewer !== null && mayFilterPeople(viewer)
  const filter = useBoardFilters('shoots')
  const who = useMemo(
    () => new Map(live.tables.team.rows.map(u => [u.id, { name: u.name || u.email, role: String(u.role ?? '') }])),
    [live.tables.team.rows])
  const clientNames = useMemo(() => new Map(clients.map(c => [c.id, c.name])), [clients])
  const clientRows = useMemo(() => clientsOnCards(shoots ?? [], clientNames), [shoots, clientNames])
  const peopleRows = useMemo(() => (mayFilterPerson ? peopleOnCards(shoots ?? [], who) : []), [mayFilterPerson, shoots, who])
  const chosen = useMemo(() => ({
    client: validChoice(filter.client, clientRows),
    person: mayFilterPerson ? validChoice(filter.person, peopleRows) : null,
  }), [filter.client, filter.person, clientRows, peopleRows, mayFilterPerson])
  const filterNames = {
    person: chosen.person ? (who.get(chosen.person)?.name ?? null) : null,
    client: chosen.client ? (clientNames.get(chosen.client) ?? null) : null,
  }
  const visibleShoots = useMemo(() => applyFilters(shoots ?? [], chosen).filter(s =>
    !search || s.title.toLowerCase().includes(search.toLowerCase())), [shoots, chosen, search])
  const filterNote = filterWords(chosen, filterNames, visibleShoots.length, (shoots ?? []).length)

  /**
   * Move a shoot along the playbook's timeline — the drag on the board. The
   * stamp lands the instant the write commits (the listener repaints); a
   * refusal leaves the card where it was, in the SOP's words.
   */
  const moveShoot = async (s: StageShoot, to: ShootStage) => {
    setStageBusy(s.id)
    try {
      const res = await fetch(`/api/production/batches/${s.id}/stage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not move it')
      const handed = json.handed as { total: number } | null
      toast.success(handed
        ? `${s.title} → ${SOP_STAGE_LABEL[to]} — ${handed.total} card${handed.total === 1 ? '' : 's'} now with the editor`
        : `${s.title} → ${SOP_STAGE_LABEL[to]}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move it')
    } finally {
      setStageBusy(null)
    }
  }

  /** Drag a shoot onto another day on the calendar. The server is the
   *  authority on who may, and answers in its own words. */
  const moveEvent = async (e: CalEvent, day: string) => {
    const patch = movePatch(e, day)
    if (!patch) return
    try {
      const res = await fetch(moveUrl(e), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not move it')
      toast.success(`${e.title} → ${dayLabel(day)}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not move it')
    }
  }

  /** the calendar: the same shoots, on their shoot dates */
  const calendar = eventsFor('production', { batches: visibleShoots, items: [] })

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const clientCount = new Set(visibleShoots.map(s => s.client_id)).size
  const summary = shoots === null
    ? 'Every filming day, from the first plan to the footage handed over.'
    : `${plural(visibleShoots.length, 'shoot')} across ${plural(clientCount, 'client')} · updates the moment anyone moves one`

  // the whole page hangs off the viewer, so a missing account is not a slower
  // load — it is a different screen, and saying so beats a skeleton forever
  if (!loading && !viewer) return <AccountUnavailable />

  return (
    <div className="flex flex-col gap-4">
      {viewer && shoots !== null && <GettingStarted role={role} page="production" />}

      <PageTitle
        title="Shoots"
        summary={summary}
        actions={canPlan ? (
          <Button className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90"
            onClick={() => setPlanOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New shoot plan
          </Button>
        ) : undefined}
      />

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[13px] text-muted-foreground">
          One card per shoot. Open a card for the plan, who has read it, and the go-ahead. <HelpHint term="shoot" /> <HelpHint term="shoot_plan" />
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* By stage answers "where is each shoot against the playbook";
              By date answers "what is happening on Thursday". Same shoots. */}
          <ViewSwitch
            label="How to show the shoots"
            value={view}
            onChange={setView}
            options={[
              { value: 'stage', label: 'By stage', icon: Kanban },
              { value: 'date', label: 'By date', icon: CalendarDays },
            ]}
          />
          <BoardFilters clients={clientRows} people={peopleRows} value={chosen}
            onClient={filter.setClient} onPerson={filter.setPerson} onClear={filter.clear} />
          <div className="relative">
            <Search className="absolute left-4 top-[15px] h-4 w-4 text-muted-foreground" aria-hidden />
            <Input value={search} onChange={e => setSearch(e.target.value)}
              aria-label="Search shoots"
              placeholder="Search shoots…"
              className="h-11 w-56 rounded-full border-border bg-surface pl-11" />
          </div>
        </div>
      </div>

      {filterNote && <p className="text-[13px] text-muted-foreground">{filterNote}</p>}

      {needsSchema && (
        <div className="rounded-card bg-tint-amber p-5 text-[15px]">
          This part of the app isn&rsquo;t switched on yet. Send this to your developer —
          shoots are missing their status.
        </div>
      )}

      {!viewer || shoots === null || today === null ? (
        <div className="flex gap-3.5 overflow-x-hidden" role="status" aria-busy="true" aria-label="Loading the shoots">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-72 min-w-[200px] flex-1 rounded-card" />)}
        </div>
      ) : view === 'date' ? (
        <WorkCalendar
          events={calendar}
          viewer={viewer}
          view={range as CalendarView}
          onViewChange={setRange}
          onMove={moveEvent}
          undatedLabel="No date yet"
          legend={
            <p className="text-[15px] text-muted-foreground">
              Each shoot sits on its shoot date. Drag one to another day to move it — a booked
              shoot moves from its own page, with a reason.
            </p>
          }
        />
      ) : (
        <ShootStageBoard
          shoots={visibleShoots}
          itemCounts={itemCountByShoot}
          plans={planByShoot}
          names={teamNames}
          role={viewer.role}
          viewerId={viewer.id}
          today={today}
          onMove={moveShoot}
          busyId={stageBusy}
          laneEmpty={label => filteredEmpty(label, chosen, filterNames)}
        />
      )}

      {/* the SHOOT PLAN — making it sets up the shoot; the plan then lives on
          the shoot's page with its canvas, checklist and sign-off */}
      <NewShootPlanDialog
        open={planOpen}
        onOpenChange={setPlanOpen}
        onCreated={() => setView('stage')}
        clients={clients}
        batches={shoots ?? []}
        briefedBatchIds={[...planByShoot.keys()]}
        team={team}
      />
    </div>
  )
}
