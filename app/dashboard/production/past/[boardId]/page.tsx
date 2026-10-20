'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { useRow, useTable } from '@/lib/db-client'
import type { Client, TeamBoard, TeamUser } from '@/lib/db-types'
import TeamBoardComments from '../../../team-boards/[id]/TeamBoardComments'
import PageTitle from '../../../ui/PageTitle'
import { useRole } from '../../../useRole'
import BriefCanvas, { type CanvasOp } from '../../shoots/[id]/BriefCanvas'
import { sanitiseCanvasCards } from '../../../../lib/batch-brief-core'
import { mayEditTeamBoard } from '../../../../lib/team-board-core'
import { clientLinkWords, mayShareTeamBoard, portalTeamBoardLink } from '../../../../lib/team-board-comments-core'

/**
 * A PAST SHOOT PLAN FROM MILANOTE, OPENED ON SHOOTS (the owner, 20 Oct 2026: "if i said that then why past shoot
 * plans when clicked it took me to boards"). The plan lives inside its client's board — the import put each client's
 * whole Milanote tree there — and this page opens it where the person asked for it: on Shoots, inside the plan,
 * editable, saved to that same board. One record, two ways in; never a copy.
 */
type Row = TeamBoard & { canvas_cards?: unknown }

export default function PastShootPlanPage() {
  const { boardId } = useParams<{ boardId: string }>()
  const [tile, setTile] = useState<string | null>(null)
  useEffect(() => { try { setTile(new URLSearchParams(window.location.search).get('board')) } catch { /* no address */ } }, [])
  const { me } = useRole()
  const { row: board, loading } = useRow<Row>('team_boards', boardId)
  const { rows: clients } = useTable<Client>('clients')
  const { rows: team } = useTable<TeamUser>('team_users')
  const cards = useMemo(() => sanitiseCanvasCards(board?.canvas_cards), [board?.canvas_cards])
  const plan = tile ? cards.find(c => c.id === tile) : null
  const client = board?.client_id ? clients.find(c => c.id === board.client_id)?.name ?? null : null

  // ON THE CLIENT'S PORTAL, OR NOT (the owner, 20 Oct 2026: "that feature and copy portal link") — the same two
  // presses as the board's own page; sharing emails nobody
  const [busy, setBusy] = useState(false)
  const clientRow = board?.client_id ? clients.find(c => c.id === board.client_id) ?? null : null
  const share = async (on: boolean, done: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/production/team-boards/${boardId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shared_with_client: on }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not save that')
      toast.success(done)
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save that'); return false } finally { setBusy(false) }
  }
  const copyClientLink = async () => {
    const token = clientRow?.share_token
    if (!token) { toast.error('This client has no portal yet — make one on their client page first'); return }
    if (board?.shared_with_client !== true && !(await share(true, 'On the client’s portal'))) return
    try {
      await navigator.clipboard.writeText(portalTeamBoardLink(window.location.origin, token, boardId))
      toast.success(clientLinkWords(client))
    } catch { toast.error('Shared, but the link could not be copied — press the button again') }
  }

  const onOp = async (op: CanvasOp) => {
    const res = await fetch(`/api/production/team-boards/${boardId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canvas_op: op }),
    })
    if (!res.ok) { toast.error((await res.json().catch(() => ({})))?.error ?? 'Could not save the plan'); return false }
    return true
  }

  const back = (
    <Link href="/dashboard/production?past=1" className="inline-flex min-h-11 w-fit items-center gap-1.5 text-secondary-13 text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Past shoot plans
    </Link>
  )
  if (loading) return <div className="flex flex-col gap-4">{back}<Skeleton className="h-8 w-56" /><Skeleton className="h-[60vh] w-full rounded-card" /></div>
  if (!board) {
    return <div className="flex flex-col gap-4">{back}<PageTitle title="Shoot plan not found" summary="It may have been deleted, or the link is not quite right." /></div>
  }
  return (
    <div className="flex flex-col gap-4">
      {back}
      <PageTitle
        title={plan?.name ?? board.name}
        summary={`A past shoot plan from Milanote${client ? ` · ${client}` : ''}. Edit it here; it is the same plan as on ${board.name}'s board.${board.shared_with_client ? ' On the client’s portal.' : ''}`}
        actions={mayShareTeamBoard(me, board) ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void copyClientLink()} className="h-11 rounded-full border-border bg-surface px-4 text-[13px] font-semibold">
              <Link2 className="h-4 w-4" aria-hidden /> Copy client link
            </Button>
            {board.shared_with_client ? (
              <Button variant="ghost" disabled={busy} onClick={() => void share(false, 'Taken off the client’s portal — they will not see it there')}
                className="h-11 rounded-full px-4 text-[13px] font-semibold text-muted-foreground">Take it off the client’s portal</Button>
            ) : (
              <Button variant="ghost" disabled={busy} onClick={() => void share(true, 'On the client’s portal — nobody was emailed')}
                className="h-11 rounded-full px-4 text-[13px] font-semibold text-muted-foreground">Put it on the client’s portal</Button>
            )}
          </div>
        ) : undefined}
      />
      {/* the board's own comments — on any card, @-tagging the team; the same thread as on the board's page */}
      <TeamBoardComments boardId={boardId} cards={cards} team={team}>
        <BriefCanvas cards={cards} references={[]} canEdit={mayEditTeamBoard(me)} onOp={onOp} initialBoard={tile} rootName={board.name} />
      </TeamBoardComments>
    </div>
  )
}
