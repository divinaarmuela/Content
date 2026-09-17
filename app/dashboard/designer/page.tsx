'use client'

import { managesClients, personLabel } from '../../lib/identity-core'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus } from 'lucide-react'
import { pageCards, type BoardViewer } from '../../lib/board-view-core'
import { useWorkRows } from '../useLiveWork'
import { useRole } from '../useRole'
import PageTitle from '../ui/PageTitle'
import { todayKey } from '../ui/tone'
import { AccountUnavailable } from '../production/shoot-ui'
import { useTeamMembers } from '../production/workHooks'
import { Board, useBoardParams, type BoardCardRow } from '../board/Board'
import { useRouter } from 'next/navigation'
import { readCardParam } from '../../lib/card-sheet-core'
import { BoardFilters } from '../board/BoardFilters'
import { useBoardFilters } from '../board/useBoardFilters'
import {
  applyFilters, clientsOnCards, filterWords, filteredEmpty, mayFilterPeople, peopleOnCards, validChoice,
} from '../../lib/people-filter-core'
import { NewCardDialog } from '../board/BoardDialogs'
import { toast } from 'sonner'
import { flagsOf } from '../../lib/card-flag-core'
import { EDITOR_LANE_WORDS, reviewerNameOf } from '../../lib/editor-sop-core'

/**
 * THE DESIGNER PAGE (the owner, 17 Sep 2026: "another page called Designer —
 * the same as editors, but they only upload files, not Drive links, and
 * versions and all check out as this would be from files").
 *
 * The Editor page's board, on the graphics cards only. A card is the same
 * card: the same five columns, the same quality check and portal, the same
 * page when pressed. What differs is the hand-in — a designer uploads the
 * finished files onto the card (final-files-core), and each upload after a
 * send-back is the next version.
 *
 * It mirrors app/dashboard/editor/page.tsx on purpose: that file is pinned
 * by a dozen tests, and this one filters the same rows to one kind of work.
 */
export default function DesignerPage() {
  const { me, noAccount } = useRole()
  const viewer = useMemo<BoardViewer | null>(
    () => (me && me.role !== 'client' ? { id: me.id, role: me.role, quality_reviewer: me.quality_reviewer === true } : null), [me])
  const live = useWorkRows(viewer)
  const isManager = viewer?.role === 'account_manager' || viewer?.role === 'super_admin'
  const canCreate = isManager || viewer?.role === 'general' || viewer?.role === 'editor'
  const team = useTeamMembers(isManager)
  const { column, show, clearShow } = useBoardParams()
  const router = useRouter()
  useEffect(() => {
    try {
      const id = readCardParam(window.location.search)
      if (id) router.replace(`/dashboard/editor/${id}`)
    } catch { /* no address to read */ }
  }, [router])
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => { setToday(todayKey()) }, [])
  const [newOpen, setNewOpen] = useState(false)

  const names = useMemo(
    () => new Map(live.tables.team.rows.map(u => [u.id, personLabel(u.name, u.email)])),
    [live.tables.team.rows])
  const managersOf = useMemo(() => {
    const byClient = new Map<string, string[]>()
    const role = new Map(live.tables.team.rows.map(u => [u.id, u.role]))
    for (const a of live.tables.assignments.rows) {
      if (!managesClients(role.get(a.team_user_id))) continue
      const name = names.get(a.team_user_id)
      if (name) byClient.set(a.client_id, [...(byClient.get(a.client_id) ?? []), name])
    }
    return (clientId: string) => byClient.get(clientId) ?? []
  }, [live.tables.assignments.rows, live.tables.team.rows, names])

  const allCards = useMemo(() => {
    if (!viewer) return [] as BoardCardRow[]
    // the graphics cards only — the designer's kind of work
    const base = (live.items as unknown as BoardCardRow[]).filter(c => (c.work_kinds?.slug ?? '') === 'graphics')
    const shootTitle = new Map(live.tables.batches.rows.map(b => [b.id, String(b.title ?? '')]))
    const shootDate = new Map(live.tables.batches.rows.map(b => [b.id, (b as { shoot_date?: string | null }).shoot_date ?? null]))
    const activityByItem = new Map<string, typeof live.tables.activity.rows>()
    for (const a of live.tables.activity.rows) {
      if (a.entity_type !== 'content_item') continue
      const key = String(a.entity_id ?? '')
      activityByItem.set(key, [...(activityByItem.get(key) ?? []), a])
    }
    const reviewerName = reviewerNameOf(live.tables.team.rows as never)
    const rows = base.map(c => {
      const flags = flagsOf(activityByItem.get(c.id) ?? [], viewer.id)
      return {
        ...c,
        reviewer_name: reviewerName,
        shoot_title: c.batch_id ? (shootTitle.get(c.batch_id) ?? null) : null,
        shoot_date: c.batch_id ? (shootDate.get(c.batch_id) ?? null) : null,
        finals_in: null,
        acknowledged: flags.acknowledged,
        risk: flags.risk,
      }
    })
    return pageCards('editor', rows, viewer, today)
  }, [live.items, live.tables.batches.rows, live.tables.activity.rows, live.tables.team.rows, viewer, today])
  const mayFilter = viewer !== null && mayFilterPeople(viewer)
  const filter = useBoardFilters('designer')
  const who = useMemo(
    () => new Map(live.tables.team.rows.map(u => [u.id, { name: personLabel(u.name, u.email), role: String(u.role ?? '') }])),
    [live.tables.team.rows])
  const clientNames = useMemo(() => new Map(live.tables.clients.rows.map(c => [c.id, c.name])), [live.tables.clients.rows])
  const clientRows = useMemo(() => clientsOnCards(allCards, clientNames), [allCards, clientNames])
  const peopleRows = useMemo(() => peopleOnCards(allCards, who), [allCards, who])
  const chosen = useMemo(() => ({
    client: mayFilter ? validChoice(filter.client, clientRows) : null,
    person: mayFilter ? validChoice(filter.person, peopleRows) : null,
    files: mayFilter ? filter.files ?? null : null,
    version: mayFilter ? filter.version ?? null : null,
  }), [mayFilter, filter.client, filter.person, filter.files, filter.version, clientRows, peopleRows])
  const filterNames = {
    person: chosen.person ? (who.get(chosen.person)?.name ?? null) : null,
    client: chosen.client ? (clientNames.get(chosen.client) ?? null) : null,
  }
  const cards = useMemo(() => applyFilters(allCards, chosen), [allCards, chosen])

  const acknowledge = async (card: BoardCardRow) => {
    try {
      const res = await fetch(`/api/production/items/${card.id}/flag`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'acknowledged' }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not acknowledge it')
      toast.success('Acknowledged — the team knows you are on it')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not acknowledge it')
    }
  }

  const ready = viewer !== null && !live.loading && today !== null
  if (noAccount) return <AccountUnavailable />

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Designer"
        summary={isManager
          ? `Every graphics card still being made, in the five columns: ${EDITOR_LANE_WORDS}. A designer uploads the finished files onto the card; the rest is the editors’ road.`
          : `Your graphics cards, in five columns: ${EDITOR_LANE_WORDS}. Acknowledge a new card the day it lands, upload the finished files, tick the quality check, submit — it goes straight to the quality reviewer.`}
        actions={viewer && canCreate && (
          <Button onClick={() => setNewOpen(true)}
            className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90">
            <Plus className="h-4 w-4" /> New card
          </Button>
        )}
      />

      {!ready ? (
        <div className="grid gap-3.5 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-card" />)}
        </div>
      ) : (
        <Board
          cards={cards}
          viewer={viewer}
          page="editor"
          names={names}
          managersOf={managersOf}
          kinds={live.tables.workKinds.rows}
          today={today}
          onOpen={c => router.push(`/dashboard/editor/${c.id}`)}
          initialColumn={column}
          show={show}
          onClearShow={clearShow}
          ariaLabel="Your graphics cards, by stage"
          onAcknowledge={acknowledge}
          filters={mayFilter ? (
            <BoardFilters clients={clientRows} people={peopleRows} value={chosen}
              onClient={filter.setClient} onPerson={filter.setPerson} onClear={filter.clear}
              onFiles={filter.setFiles} onVersion={filter.setVersion} />
          ) : undefined}
          filterNote={filterWords(chosen, filterNames, cards.length, allCards.length)}
          laneEmpty={label => filteredEmpty(label, chosen, filterNames)}
        />
      )}

      {viewer && (
        <NewCardDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          clients={live.tables.clients.rows.filter(c => ((c as { status?: string | null }).status ?? 'active') === 'active').map(c => ({ id: c.id, name: c.name }))}
          kinds={live.tables.workKinds.rows}
          team={team}
          viewer={{ ...viewer, name: me?.name }}
          simple
          defaultKind="Graphics"
          filesOnly
        />
      )}
    </div>
  )
}
