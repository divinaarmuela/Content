'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus } from 'lucide-react'
import { pageCards, pageColumns, type BoardViewer } from '../../lib/board-view-core'
import { useWorkRows } from '../useLiveWork'
import { useRole } from '../useRole'
import PageTitle from '../ui/PageTitle'
import { todayKey } from '../ui/tone'
import { AccountUnavailable } from '../production/shoot-ui'
import { useTeamMembers } from '../production/workHooks'
import GettingStarted from '../GettingStarted'
import { Board, useBoardParams, type BoardCardRow } from '../board/Board'
import { CardSheet, useCardSheet } from '../board/CardSheet'
import { NewCardDialog } from '../board/BoardDialogs'

/**
 * THE EDITOR PAGE: your cards, from draft to the client.
 *
 * One board, all five columns — Draft to Posted — holding only the cards
 * assigned to the person looking, so they see their work all the way out.
 * A card is one deliverable: what needs doing and one link. Hand it on for
 * checking from the card itself ("Ready for checking"). A card that came
 * back carries what to change, in the manager's words.
 *
 * An account manager looking in sees every card still being made. The rows
 * are live; every move is the ordinary transition route.
 */
export default function EditorPage() {
  const { me, noAccount } = useRole()
  const viewer = useMemo<BoardViewer | null>(
    () => (me && me.role !== 'client' ? { id: me.id, role: me.role } : null), [me])
  const live = useWorkRows(viewer)
  const isManager = viewer?.role === 'account_manager' || viewer?.role === 'super_admin'
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

  const cards = useMemo(() => {
    if (!viewer) return [] as BoardCardRow[]
    // a shoot plan lives on Production; everything else somebody is making
    // is a card here
    const rows = (live.items as unknown as BoardCardRow[]).filter(c => (c.work_kinds?.slug ?? '') !== 'shoot_brief')
    return pageCards('editor', rows, viewer)
  }, [live.items, viewer])

  const columns = useMemo(() => (viewer ? pageColumns('editor', viewer, cards) : []), [viewer, cards])
  const ready = viewer !== null && !live.loading && today !== null

  if (noAccount) return <AccountUnavailable />

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Editor"
        summary={isManager
          ? 'Everything still being made, Draft to With client. Check the work at its link, then send it on or send it back.'
          : 'Your cards, Draft to Posted. Each one says what needs doing and where the work lives — add the link, then press Ready for checking.'}
        actions={viewer && (
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
          columns={columns}
          names={names}
          kinds={live.tables.workKinds.rows}
          today={today}
          onOpen={c => sheet.open(c.id)}
          initialColumn={column}
          show={show}
          onClearShow={clearShow}
          ariaLabel="Your cards, by stage"
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
