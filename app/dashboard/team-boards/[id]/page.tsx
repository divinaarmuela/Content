'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useRow } from '@/lib/db-client'
import type { TeamBoard } from '@/lib/db-types'
import PageTitle from '../../ui/PageTitle'
import { useRole } from '../../useRole'
import BriefCanvas, { type CanvasOp } from '../../production/shoots/[id]/BriefCanvas'
import { sanitiseCanvasCards } from '../../../lib/batch-brief-core'
import { cardCountWords, mayEditTeamBoard, teamBoardLink } from '../../../lib/team-board-core'

/**
 * ONE TEAM BOARD (the owner, 21 Sep 2026): the shoot brief's own canvas —
 * pictures, links, notes, arrows, boards inside boards — with nothing around
 * it. Read live, so two people on the same board see each other's cards; an
 * edit is a per-card op the server merges on the row as it stands. No
 * client, no review, no approvals. "Copy board link" copies this address.
 */

type Row = TeamBoard & { canvas_cards?: unknown }

export default function TeamBoardPage() {
  const { id } = useParams<{ id: string }>()
  const { me } = useRole()
  const { row: board, loading } = useRow<Row>('team_boards', id)
  const cards = useMemo(() => sanitiseCanvasCards(board?.canvas_cards), [board?.canvas_cards])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(teamBoardLink(window.location.origin, id))
      toast.success('Board link copied — anyone on the team can open it')
    } catch { toast.error('Could not copy the link') }
  }

  const onOp = async (op: CanvasOp) => {
    const res = await fetch(`/api/production/team-boards/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canvas_op: op }),
    })
    if (!res.ok) {
      toast.error((await res.json().catch(() => ({})))?.error ?? 'Could not save the board')
      return false
    }
    return true
  }

  if (loading) return <div className="flex flex-col gap-4"><Skeleton className="h-8 w-56" /><Skeleton className="h-[60vh] w-full rounded-card" /></div>
  if (!board) {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle title="Board not found" summary="It may have been deleted, or the link is not quite right." />
        <Button asChild variant="outline" className="h-11 w-fit rounded-full px-4 text-[13px] font-semibold"><Link href="/dashboard/team-boards">All boards</Link></Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Link href="/dashboard/team-boards" className="inline-flex min-h-11 w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Boards
      </Link>
      <PageTitle
        title={board.name}
        summary={`${cardCountWords(board.canvas_cards)}. Drop pictures in, paste a link, write a note, draw an arrow. Everyone on the team sees it change as you work.`}
        actions={
          <Button variant="outline" onClick={() => void copyLink()} className="h-11 rounded-full px-4 text-[13px] font-semibold">
            <Link2 className="mr-1.5 h-4 w-4" aria-hidden /> Copy board link
          </Button>
        }
      />
      <BriefCanvas cards={cards} references={[]} canEdit={mayEditTeamBoard(me)} onOp={onOp} />
    </div>
  )
}
