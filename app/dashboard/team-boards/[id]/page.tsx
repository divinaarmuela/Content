'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Check, Link2, Send, Undo2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useRow, useTable } from '@/lib/db-client'
import type { Client, TeamBoard, TeamUser } from '@/lib/db-types'
import PageTitle from '../../ui/PageTitle'
import Chip, { type ChipTone } from '../../ui/Chip'
import { useRole } from '../../useRole'
import { personLabel } from '../../../lib/identity-core'
import BriefCanvas, { type CanvasOp } from '../../production/shoots/[id]/BriefCanvas'
import { sanitiseCanvasCards } from '../../../lib/batch-brief-core'
import {
  INTERNAL_BOARD_WORD, REVIEW_NOTE_MAX, TEAM_BOARD_STATUS_LABEL, boardClientName, boardStatusOf, cardCountWords, mayEditTeamBoard,
  mayManageTeamBoards, mayReviewTeamBoard, teamBoardLink, type TeamBoardStatus,
} from '../../../lib/team-board-core'
import { clientLinkWords, mayShareTeamBoard, portalTeamBoardLink } from '../../../lib/team-board-comments-core'
import TeamBoardComments from './TeamBoardComments'

/**
 * ONE INSPO BOARD (the owner, 21–22 Sep 2026): the shoot brief's own canvas
 * — pictures, links, posts with Drive files, notes, arrows, boards inside
 * boards — with the client's name over it and its stage beside that. Read
 * live, so two people on the same board see each other's cards; an edit is
 * a per-card op the server merges on the row as it stands. Anyone on the
 * team sends it to the quality check; the checker or a manager approves it
 * or asks for changes with a note. "Copy board link" copies this address.
 *
 * COMMENTS (22 Sep 2026): every card wears a bubble; its thread opens beside
 * the board, "@" tags a colleague. "Copy client link" (a manager, on a
 * board that names a client) shares the board and copies the client's page
 * for it, where they comment on the same cards.
 */

type Row = TeamBoard & { canvas_cards?: unknown }
const CLIENTS_BY_NAME: ['name', 'asc'][] = [['name', 'asc']]
const STATUS_TONE: Record<TeamBoardStatus, ChipTone> = { draft: 'muted', quality_check: 'amber', changes_requested: 'red', approved: 'green' }
const NO_CLIENT = 'none'

export default function TeamBoardPage() {
  const { id } = useParams<{ id: string }>()
  const { me } = useRole()
  const { row: board, loading } = useRow<Row>('team_boards', id)
  const { rows: clients } = useTable<Client>('clients', { orderBy: CLIENTS_BY_NAME })
  const { rows: team } = useTable<TeamUser>('team_users')
  const cards = useMemo(() => sanitiseCanvasCards(board?.canvas_cards), [board?.canvas_cards])
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const status = boardStatusOf(board)
  const client = board ? boardClientName(board, clients) : null
  const manager = mayManageTeamBoards(me)
  const reviewer = mayReviewTeamBoard(me)
  const nameOf = (uid: string | null | undefined) => { const u = team.find(t => t.id === uid); return u ? personLabel(u.name, u.email) : null }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(teamBoardLink(window.location.origin, id))
      toast.success('Board link copied — anyone on the team can open it')
    } catch { toast.error('Could not copy the link') }
  }
  // THE CLIENT'S LINK (22 Sep 2026): shares the board (a manager's switch) and copies the client's page for it
  const clientRow = board?.client_id ? clients.find(c => c.id === board.client_id) ?? null : null
  const copyClientLink = async () => {
    const token = clientRow?.share_token
    if (!token) { toast.error('This client has no portal link yet — make one on their client page first'); return }
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

  const stageWords = status === 'approved'
    ? `Approved${nameOf(board.reviewed_by) ? ` by ${nameOf(board.reviewed_by)}` : ''}. Working on it again puts it back to Inspo.`
    : status === 'quality_check'
      ? `In the quality check${nameOf(board.submitted_by) ? ` — sent by ${nameOf(board.submitted_by)}` : ''}.`
      : status === 'changes_requested'
        ? `Changes asked${nameOf(board.reviewed_by) ? ` by ${nameOf(board.reviewed_by)}` : ''}${board.review_note ? `: “${board.review_note}”` : '.'}`
        : 'Inspo — drop pictures in, paste a link or a Drive file on a post, write a note, draw an arrow. Send it to the quality check when it is ready.'

  return (
    <div className="flex flex-col gap-3">
      <Link href="/dashboard/team-boards" className="inline-flex min-h-11 w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Boards
      </Link>
      {/* the client's name over the board — the board is theirs (22 Sep 2026) */}
      <p className={`font-mono text-[11px] uppercase tracking-wider ${client ? 'text-accent-blue-deep' : 'text-muted-foreground'}`}>{client ?? INTERNAL_BOARD_WORD}</p>
      <PageTitle
        title={board.name}
        summary={`${cardCountWords(board.canvas_cards)}. ${stageWords}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={STATUS_TONE[status]}>{TEAM_BOARD_STATUS_LABEL[status]}</Chip>
            {/* the stage's one or two buttons: send in; approve or ask for changes */}
            {mayEditTeamBoard(me) && (status === 'draft' || status === 'changes_requested') && (
              <Button disabled={busy} onClick={() => void patch({ status: 'quality_check' }, 'Sent to the quality check')} className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90">
                <Send className="mr-1.5 h-4 w-4" aria-hidden /> Send to quality check
              </Button>
            )}
            {reviewer && status === 'quality_check' && (
              <>
                <Button disabled={busy} onClick={() => void patch({ status: 'approved' }, 'Board approved')} className="h-11 rounded-full bg-accent-green px-4 text-[13px] font-semibold text-ink hover:bg-accent-green/90">
                  <Check className="mr-1.5 h-4 w-4" aria-hidden /> Approve
                </Button>
                <Button disabled={busy} variant="outline" onClick={() => { setNote(''); setAsking(true) }} className="h-11 rounded-full px-4 text-[13px] font-semibold">
                  <Undo2 className="mr-1.5 h-4 w-4" aria-hidden /> Ask for changes
                </Button>
              </>
            )}
            <Button variant="outline" onClick={() => void copyLink()} className="h-11 rounded-full px-4 text-[13px] font-semibold">
              <Link2 className="mr-1.5 h-4 w-4" aria-hidden /> Copy board link
            </Button>
            {mayShareTeamBoard(me, board) && (
              <Button variant="outline" disabled={busy} onClick={() => void copyClientLink()} className="h-11 rounded-full px-4 text-[13px] font-semibold"
                title={board.shared_with_client ? 'The client can open this board and comment on its cards' : 'Share the board with the client and copy their link'}>
                <Users className="mr-1.5 h-4 w-4" aria-hidden /> {board.shared_with_client ? 'Copy client link' : 'Share with client'}
              </Button>
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
        <BriefCanvas cards={cards} references={[]} canEdit={mayEditTeamBoard(me)} onOp={onOp} />
      </TeamBoardComments>

      <Dialog open={asking} onOpenChange={o => { if (!busy) setAsking(o) }}>
        <DialogContent className="bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ask for changes</DialogTitle>
            <DialogDescription>Say what should change. The board goes back to the team with your words on it.</DialogDescription>
          </DialogHeader>
          <form onSubmit={e => { e.preventDefault(); void patch({ status: 'changes_requested', note }, 'Sent back with your note').then(ok => { if (ok) setAsking(false) }) }} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-note">What should change</Label>
              <textarea id="board-note" autoFocus value={note} maxLength={REVIEW_NOTE_MAX} onChange={e => setNote(e.target.value)} rows={4}
                className="w-full rounded-inner border border-border bg-surface px-3 py-2 text-[14px] outline-none focus:border-accent-blue/50" />
            </div>
            <Button type="submit" disabled={busy || !note.trim()} className="h-11 rounded-full bg-foreground text-[13px] font-semibold text-background hover:bg-foreground/90">{busy ? 'Sending…' : 'Send it back'}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
