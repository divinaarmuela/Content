'use client'

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
import GettingStarted from '../GettingStarted'
import { Board, useBoardParams, type BoardCardRow } from '../board/Board'
import { CardSheet, useCardSheet } from '../board/CardSheet'
import { BoardFilters } from '../board/BoardFilters'
import { useBoardFilters } from '../board/useBoardFilters'
import {
  applyFilters, clientsOnCards, filterWords, filteredEmpty, mayFilterPeople, peopleOnCards, validChoice,
} from '../../lib/people-filter-core'
import { NewCardDialog } from '../board/BoardDialogs'
import { toast } from 'sonner'
import { flagsOf } from '../../lib/card-flag-core'

/**
 * THE EDITOR PAGE: your cards, from draft to the client.
 *
 * One board, holding only the cards assigned to the person looking. The
 * three stages they work — Draft, Internal check, With client — get full
 * lanes; everything past them (Ready to post, Posted) is folded into one
 * narrow "Done" lane, so they still see their work go out the door without
 * two columns sitting empty. A card is one deliverable: what needs doing
 * and one link. Hand it on for
 * checking from the card itself ("Ready for checking"). A card that came
 * back carries what to change, in the manager's words.
 *
 * An account manager looking in sees every card still being made. The rows
 * are live; every move is the ordinary transition route.
 */
export default function EditorPage() {
  const { me, noAccount } = useRole()
  const viewer = useMemo<BoardViewer | null>(
    () => (me && me.role !== 'client' ? { id: me.id, role: me.role, quality_reviewer: me.quality_reviewer === true } : null), [me])
  const live = useWorkRows(viewer)
  const isManager = viewer?.role === 'account_manager' || viewer?.role === 'super_admin'
  /** who may start a card here — managers, and a general user (their own work) */
  const canCreate = isManager || viewer?.role === 'general'
  const team = useTeamMembers(isManager)
  const { column, show, clearShow } = useBoardParams()
  // the card that is open beside the board, named in the address
  const sheet = useCardSheet()
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => { setToday(todayKey()) }, [])
  const [newOpen, setNewOpen] = useState(false)

  /** id → name for everyone on the team, from the rows already on the wire */
  const names = useMemo(
    () => new Map(live.tables.team.rows.map(u => [u.id, u.name || u.email])),
    [live.tables.team.rows])

  const allCards = useMemo(() => {
    if (!viewer) return [] as BoardCardRow[]
    // a shoot plan lives on Production; everything else somebody is making
    // is a card here
    const base = (live.items as unknown as BoardCardRow[]).filter(c => (c.work_kinds?.slug ?? '') !== 'shoot_brief')
    // WHAT THE VIDEO EDITORS SOP ASKS OF A CARD, read off what is already on
    // the wire: which shoot it came from (the shoot board makes these
    // cards), whether the holder acknowledged it, and a standing risk
    const shootTitle = new Map(live.tables.batches.rows.map(b => [b.id, String(b.title ?? '')]))
    const activityByItem = new Map<string, typeof live.tables.activity.rows>()
    for (const a of live.tables.activity.rows) {
      if (a.entity_type !== 'content_item') continue
      const key = String(a.entity_id ?? '')
      activityByItem.set(key, [...(activityByItem.get(key) ?? []), a])
    }
    const rows = base.map(c => {
      const flags = flagsOf(activityByItem.get(c.id) ?? [], viewer.id)
      return {
        ...c,
        shoot_title: c.batch_id ? (shootTitle.get(c.batch_id) ?? null) : null,
        acknowledged: flags.acknowledged,
        risk: flags.risk,
      }
    })
    return pageCards('editor', rows, viewer, today)
  }, [live.items, live.tables.batches.rows, live.tables.activity.rows, viewer, today])
  /* ── who is doing what: the Client and People filters, for managers, super
        admins and the quality reviewer; an editor sees only their own cards
        and has nothing to narrow (the owner, 11 Sep 2026) ── */
  const mayFilter = viewer !== null && mayFilterPeople(viewer)
  const filter = useBoardFilters('editor')
  const who = useMemo(
    () => new Map(live.tables.team.rows.map(u => [u.id, { name: u.name || u.email, role: String(u.role ?? '') }])),
    [live.tables.team.rows])
  const clientNames = useMemo(() => new Map(live.tables.clients.rows.map(c => [c.id, c.name])), [live.tables.clients.rows])
  const clientRows = useMemo(() => clientsOnCards(allCards, clientNames), [allCards, clientNames])
  const peopleRows = useMemo(() => peopleOnCards(allCards, who), [allCards, who])
  const chosen = useMemo(() => ({
    client: mayFilter ? validChoice(filter.client, clientRows) : null,
    person: mayFilter ? validChoice(filter.person, peopleRows) : null,
  }), [mayFilter, filter.client, filter.person, clientRows, peopleRows])
  const filterNames = {
    person: chosen.person ? (who.get(chosen.person)?.name ?? null) : null,
    client: chosen.client ? (clientNames.get(chosen.client) ?? null) : null,
  }
  const cards = useMemo(() => applyFilters(allCards, chosen), [allCards, chosen])

  /** "Acknowledge" — one press, one activity row, and the prompt goes */
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
        title="Editor"
        summary={isManager
          ? 'Everything still being made, In progress to With client, with what is done folded in at the end. Check the work, then send it on for the quality check or send it back.'
          : 'Your cards, the playbook way: In progress, For review, Quality check, With client, For handoff and Done. Acknowledge a new card the day it lands, upload the final export, then press Ready for checking.'}
        actions={viewer && canCreate && (
          <Button onClick={() => setNewOpen(true)}
            className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90">
            <Plus className="h-4 w-4" /> New card
          </Button>
        )}
      />

      {ready && <GettingStarted role={viewer.role} page="editor" />}

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
          kinds={live.tables.workKinds.rows}
          today={today}
          onOpen={c => sheet.open(c.id)}
          initialColumn={column}
          show={show}
          onClearShow={clearShow}
          ariaLabel="Your cards, by stage"
          onAcknowledge={acknowledge}
          filters={mayFilter ? (
            <BoardFilters clients={clientRows} people={peopleRows} value={chosen}
              onClient={filter.setClient} onPerson={filter.setPerson} onClear={filter.clear} />
          ) : undefined}
          filterNote={filterWords(chosen, filterNames, cards.length, allCards.length)}
          laneEmpty={label => filteredEmpty(label, chosen, filterNames)}
        />
      )}

      {/* the card, beside the board — the board stays live behind it */}
      <CardSheet id={sheet.cardId} onClose={sheet.close} simple />

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
