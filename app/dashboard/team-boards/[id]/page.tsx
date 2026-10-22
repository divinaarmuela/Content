'use client'

import { ensureClientPortal } from '../../ui/ensurePortal'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Link2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useRow, useTable } from '@/lib/db-client'
import type { Client, TeamBoard, TeamUser } from '@/lib/db-types'
import PageTitle from '../../ui/PageTitle'
import { useRole } from '../../useRole'
import BriefCanvas, { type CanvasOp } from '../../production/shoots/[id]/BriefCanvas'
import { sanitiseCanvasCards } from '../../../lib/batch-brief-core'
import {
  INTERNAL_BOARD_WORD, boardClientName, cardCountWords, mayEditTeamBoard, mayManageTeamBoards, teamBoardLink,
} from '../../../lib/team-board-core'
import { clientLinkWords, mayShareTeamBoard, portalTeamBoardLink } from '../../../lib/team-board-comments-core'
import TeamBoardComments from './TeamBoardComments'
import { NotifyClientButton } from '../../board/NotifyClientDialog'

/**
 * ONE BOARD (the owner, 21–22 Sep 2026): the shoot brief's own canvas —
 * pictures, links, posts with Drive files, notes, arrows, boards inside
 * boards — with the client's name over it. Read live, so two people on the
 * same board see each other's cards; an edit is a per-card op the server
 * merges on the row as it stands. "Copy board link" copies this address.
 *
 * NO STAGES (the owner, 22 Oct 2026: "I don't think we need quality check
 * and inspo or changes asked for boards — this is just internal for us to
 * work"): no stage chip, no Send to quality check, no Approve, no Ask for
 * changes. The board is the team's working space and nothing more.
 *
 * COMMENTS (22 Sep 2026): every card wears a bubble; its thread opens beside
 * the board, "@" tags a colleague. "Copy client link" (a manager, on a
 * board that names a client) shares the board and copies the client's page
 * for it, where they comment on the same cards.
 */

type Row = TeamBoard & { canvas_cards?: unknown }
const CLIENTS_BY_NAME: ['name', 'asc'][] = [['name', 'asc']]
const NO_CLIENT = 'none'

export default function TeamBoardPage() {
  // ?board=<tile> — open inside that board (a past brief from Milanote, linked from Shoots, 20 Oct 2026)
  const [openAt, setOpenAt] = useState<string | null>(null)
  useEffect(() => { try { setOpenAt(new URLSearchParams(window.location.search).get('board')) } catch { /* no address */ } }, [])

  const { id } = useParams<{ id: string }>()
  const { me } = useRole()
  const { row: board, loading } = useRow<Row>('team_boards', id)
  const { rows: clients } = useTable<Client>('clients', { orderBy: CLIENTS_BY_NAME })
  const { rows: team } = useTable<TeamUser>('team_users')
  const cards = useMemo(() => sanitiseCanvasCards(board?.canvas_cards), [board?.canvas_cards])
  const [busy, setBusy] = useState(false)
  const client = board ? boardClientName(board, clients) : null
  const manager = mayManageTeamBoards(me)

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(teamBoardLink(window.location.origin, id))
      toast.success('Board link copied — anyone on the team can open it')
    } catch { toast.error('Could not copy the link') }
  }
  // THE CLIENT'S LINK (22 Sep 2026): shares the board (a manager's switch) and copies the client's page for it
  const clientRow = board?.client_id ? clients.find(c => c.id === board.client_id) ?? null : null
  const copyClientLink = async () => {
    // a client with no portal gets one in this same press (20 Oct 2026), the full one-link portal
    const hadPortal = !!clientRow?.share_token
    const token = clientRow ? await ensureClientPortal(clientRow.id, clientRow.share_token) : null
    if (!token) { toast.error(clientRow ? 'Could not make their portal just now — try again' : 'This board is not for a client'); return }
    if (!hadPortal) toast.success(`${client ?? 'The client'} has a portal now — nobody was emailed`)
    const ok = board?.shared_with_client === true ? true : await patch({ shared_with_client: true }, 'Shared with the client')
    if (!ok) return
    try {
      await navigator.clipboard.writeText(portalTeamBoardLink(window.location.origin, token, id))
      toast.success(clientLinkWords(client))
    } catch { toast.error('Shared, but the link could not be copied — press the button again') }
  }

  const patch = async (body: Record<string, unknown>, done: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/production/team-boards/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not save that')
      toast.success(done)
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save that'); return false } finally { setBusy(false) }
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
      {/* the client's name over the board — the board is theirs (22 Sep 2026) */}
      <p className={`font-mono text-[11px] uppercase tracking-wider ${client ? 'text-accent-blue-deep' : 'text-muted-foreground'}`}>{client ?? INTERNAL_BOARD_WORD}</p>
      <PageTitle
        title={board.name}
        summary={`${cardCountWords(board.canvas_cards)}. Drop pictures in, paste a link or a Drive file on a post, write a note, draw an arrow.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void copyLink()} className="h-11 rounded-full px-4 text-[13px] font-semibold">
              <Link2 className="mr-1.5 h-4 w-4" aria-hidden /> Copy board link
            </Button>
            {mayShareTeamBoard(me, board) && (
              <Button variant="outline" disabled={busy} onClick={() => void copyClientLink()} className="h-11 rounded-full px-4 text-[13px] font-semibold"
                title={board.shared_with_client ? 'The client can open this board and comment on its cards' : 'Share the board with the client and copy their link'}>
                <Users className="mr-1.5 h-4 w-4" aria-hidden /> {!clientRow?.share_token ? 'Make their portal and share' : board.shared_with_client ? 'Copy client link' : 'Share with client'}
              </Button>
            )}
            {/* TAKE IT OFF THE PORTAL (3 Oct 2026: "with editing, designing, shoot and board we can take it off the portal?") —
                the same switch Share with client turned on; the client no longer sees the board, nothing is deleted */}
            {mayShareTeamBoard(me, board) && board.shared_with_client && (
              <Button variant="ghost" disabled={busy} onClick={() => void patch({ shared_with_client: false }, 'Taken off the client’s portal — they will not see it there')}
                className="h-11 rounded-full px-4 text-[13px] font-semibold text-muted-foreground" data-board-unshare>
                Take it off the client’s portal
              </Button>
            )}
            {/* NOTIFY THE CLIENT (2 Oct 2026): sharing emails nobody; this press emails the board's own link */}
            {mayShareTeamBoard(me, board) && board.shared_with_client && board.client_id && (
              <NotifyClientButton clientId={board.client_id} tab="boards" id={board.id} className="h-11 rounded-full px-4 text-[13px] font-semibold" />
            )}
          </div>
        }
      />
      {/* which client — a manager changes it here, without leaving the board (22 Sep 2026) */}
      {manager && (
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="board-client" className="text-[13px] text-muted-foreground">For</Label>
          <Select value={board.client_id ?? NO_CLIENT} onValueChange={v => { if (v && v !== (board.client_id ?? NO_CLIENT)) void patch({ client_id: v === NO_CLIENT ? null : v }, v === NO_CLIENT ? 'Now the team’s own board' : 'Client saved') }}>
            <SelectTrigger id="board-client" className="h-11 w-64 rounded-full bg-surface"><SelectValue placeholder="Pick a client" /></SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value={NO_CLIENT}>{INTERNAL_BOARD_WORD} — the team’s own</SelectItem>
              {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <TeamBoardComments boardId={id} cards={cards} team={team}>
        <BriefCanvas cards={cards} references={[]} canEdit={mayEditTeamBoard(me)} onOp={onOp} initialBoard={openAt} rootName={board?.name} />
      </TeamBoardComments>
    </div>
  )
}
