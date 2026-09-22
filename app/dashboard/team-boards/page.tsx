'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Link2, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useTable } from '@/lib/db-client'
import type { Client, TeamBoard, TeamUser } from '@/lib/db-types'
import PageTitle from '../ui/PageTitle'
import Lane from '../ui/Lane'
import Chip, { type ChipTone } from '../ui/Chip'
import { useRole } from '../useRole'
import { LoadFailed } from '../NotSetUp'
import { personLabel } from '../../lib/identity-core'
import {
  INTERNAL_BOARD_WORD, TEAM_BOARD_NAME_MAX, TEAM_BOARD_STATUS_LABEL, boardClientName, boardStatusOf, cardCountWords, lanesOf,
  matchesBoardSearch, mayManageTeamBoards, sortTeamBoards, teamBoardLink, teamBoardPath, type TeamBoardStatus,
} from '../../lib/team-board-core'

/**
 * BOARDS — the inspo boards (the owner, 21 Sep 2026: "a boards page, simply
 * for internal, like the board in the shoot brief but for the team to use,
 * and a copy board link feature"; 22 Sep 2026: "this is just inspo boards
 * … allow to edit / add to which client, so it will show the client's name
 * … ensure it goes through the quality check stage and approved —
 * essentially the same stage as the brief flow with less columns").
 *
 * Four columns, the brief flow's shape with fewer stages: Inspo, Quality
 * check, Changes asked, Approved. One tile per board, the client's name on
 * it (or "Internal" for the team's own), newest work first. A manager
 * makes, edits (name and client) and deletes; anyone on the team opens one,
 * works on it, sends it in for its check, and copies its link.
 */

type Row = TeamBoard & { canvas_cards?: unknown }
const CLIENTS_BY_NAME: ['name', 'asc'][] = [['name', 'asc']]
const STATUS_TONE: Record<TeamBoardStatus, ChipTone> = { draft: 'muted', quality_check: 'amber', changes_requested: 'red', approved: 'green' }
/** the Select cannot carry an empty value: the team's own board is "none" */
const NO_CLIENT = 'none'

const when = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'Australia/Melbourne' })
}

export default function TeamBoardsPage() {
  const router = useRouter()
  const { me } = useRole()
  const manager = mayManageTeamBoards(me)
  const { rows, loading, error } = useTable<Row>('team_boards')
  const { rows: team } = useTable<TeamUser>('team_users')
  const { rows: clients } = useTable<Client>('clients', { orderBy: CLIENTS_BY_NAME })
  const nameOf = (uid: string | null | undefined) => { const u = team.find(t => t.id === uid); return u ? personLabel(u.name, u.email) : null }
  const clientOf = (b: Row) => boardClientName(b, clients)

  const [search, setSearch] = useState('')
  const [making, setMaking] = useState(false)
  const [newName, setNewName] = useState('')
  const [newClient, setNewClient] = useState(NO_CLIENT)
  const [editing, setEditing] = useState<Row | null>(null)
  const [editName, setEditName] = useState('')
  const [editClient, setEditClient] = useState(NO_CLIENT)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)

  const boards = useMemo(
    () => sortTeamBoards(rows).filter(b => matchesBoardSearch(b, nameOf(b.created_by), search, clientOf(b))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, search, team, clients])
  const lanes = useMemo(() => lanesOf(boards), [boards])

  const copyLink = async (b: Row) => {
    try {
      await navigator.clipboard.writeText(teamBoardLink(window.location.origin, b.id))
      toast.success('Board link copied — anyone on the team can open it')
    } catch { toast.error('Could not copy the link') }
  }

  const create = async () => {
    const name = newName.trim()
    if (!name) { toast.error('Give the board a name'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/production/team-boards', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, client_id: newClient === NO_CLIENT ? null : newClient }),
      })
      const json = await res.json().catch(() => ({})) as { board?: { id: string }; error?: string }
      if (!res.ok || !json.board) throw new Error(json.error ?? 'Could not make the board')
      setMaking(false); setNewName(''); setNewClient(NO_CLIENT)
      router.push(teamBoardPath(json.board.id))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not make the board') } finally { setBusy(false) }
  }

  const saveEdit = async () => {
    if (!editing) return
    const name = editName.trim()
    if (!name) { toast.error('A board needs a name'); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/production/team-boards/${editing.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, client_id: editClient === NO_CLIENT ? null : editClient }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not save it')
      toast.success('Board saved')
      setEditing(null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save it') } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      const res = await fetch(`/api/production/team-boards/${deleting.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not delete it')
      toast.success(`“${deleting.name}” deleted`)
      setDeleting(null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not delete it') } finally { setBusy(false) }
  }

  const clientPicker = (id: string, value: string, onChange: (v: string) => void) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>For which client</Label>
      <Select value={value} onValueChange={v => v && onChange(v)}>
        <SelectTrigger id={id} className="h-11"><SelectValue placeholder="Pick a client" /></SelectTrigger>
        <SelectContent className="bg-popover">
          <SelectItem value={NO_CLIENT}>{INTERNAL_BOARD_WORD} — the team’s own</SelectItem>
          {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )

  const tile = (b: Row) => {
    const client = clientOf(b)
    const status = boardStatusOf(b)
    return (
      <li key={b.id} className="flex flex-col gap-2.5 rounded-card border border-border bg-card p-4">
        <Link href={teamBoardPath(b.id)} className="flex min-h-11 flex-col gap-1">
          {/* the client's name leads the tile — the board is theirs (22 Sep 2026) */}
          <span className={`font-mono text-[10.5px] uppercase tracking-wider ${client ? 'text-accent-blue-deep' : 'text-muted-foreground'}`}>{client ?? INTERNAL_BOARD_WORD}</span>
          <span className="text-[16px] font-semibold leading-snug">{b.name}</span>
          <span className="text-[13px] text-muted-foreground">{cardCountWords(b.canvas_cards)}</span>
        </Link>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip tone={STATUS_TONE[status]}>{TEAM_BOARD_STATUS_LABEL[status]}</Chip>
          {status === 'changes_requested' && b.review_note && <span className="truncate text-[12px] text-muted-foreground" title={b.review_note}>“{b.review_note}”</span>}
        </div>
        <p className="text-[12px] text-muted-foreground">
          {nameOf(b.created_by) ? `Made by ${nameOf(b.created_by)}` : 'Made'} {when(b.created_at)}
          {b.updated_at && b.updated_at !== b.created_at ? ` · last worked on ${when(b.updated_at)}${nameOf(b.updated_by) ? ` by ${nameOf(b.updated_by)}` : ''}` : ''}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <Button asChild className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90">
            <Link href={teamBoardPath(b.id)}>Open</Link>
          </Button>
          <Button variant="outline" onClick={() => void copyLink(b)} className="h-11 rounded-full px-4 text-[13px] font-semibold" aria-label={`Copy board link for ${b.name}`}>
            <Link2 className="h-4 w-4" aria-hidden /><span className="sr-only sm:not-sr-only sm:ml-1.5">Copy board link</span>
          </Button>
          {manager && (
            <>
              <Button variant="ghost" size="icon" className="ml-auto h-11 w-11 rounded-full text-muted-foreground" aria-label={`Edit ${b.name}`}
                onClick={() => { setEditing(b); setEditName(b.name); setEditClient(b.client_id ?? NO_CLIENT) }}><Pencil className="h-4 w-4" aria-hidden /></Button>
              <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full text-muted-foreground hover:text-accent-red-deep" aria-label={`Delete ${b.name}`}
                onClick={() => setDeleting(b)}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </>
          )}
        </div>
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Boards"
        summary="Inspo boards — one per client, the same canvas as a shoot’s plan. Make one, fill it, send it to the quality check, and it is approved or comes back with a note. Copy its link to point someone at it."
        actions={manager ? (
          <Button onClick={() => setMaking(true)} className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90">
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New board
          </Button>
        ) : undefined}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search boards, clients, or who made them…" className="h-11 max-w-xs rounded-full bg-surface px-4" aria-label="Search boards" />
        {!manager && <span className="text-[13px] text-muted-foreground">An account manager or a super admin makes new boards.</span>}
      </div>

      {error ? (
        <LoadFailed what="the boards" detail={error} onRetry={() => window.location.reload()} />
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-card" />)}</div>
      ) : boards.length === 0 ? (
        <div className="rounded-card border border-dashed border-border p-10 text-center text-[14px] text-muted-foreground">
          {search.trim() ? `No board matches “${search.trim()}”.` : manager ? 'No boards yet. Make the first one with New board.' : 'No boards yet. An account manager or a super admin can make one.'}
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start" aria-label="The boards, by stage">
          {lanes.map(lane => (
            <Lane key={lane.status} title={lane.label} count={lane.boards.length} muted={lane.boards.length === 0} className="lg:min-w-0">
              {lane.boards.length === 0
                ? <p className="rounded-card border border-dashed border-border p-4 text-[13px] text-muted-foreground">Nothing here.</p>
                : <ul className="flex flex-col gap-3" aria-label={`${lane.label} boards`}>{lane.boards.map(tile)}</ul>}
            </Lane>
          ))}
        </div>
      )}

      <Dialog open={making} onOpenChange={o => { if (!busy) setMaking(o) }}>
        <DialogContent className="bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New board</DialogTitle>
            <DialogDescription>A blank canvas. Say which client it is for, or keep it as the team’s own.</DialogDescription>
          </DialogHeader>
          <form onSubmit={e => { e.preventDefault(); void create() }} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-name">Name</Label>
              <Input id="board-name" autoFocus value={newName} maxLength={TEAM_BOARD_NAME_MAX} onChange={e => setNewName(e.target.value)} placeholder="October campaign ideas" className="h-11" />
            </div>
            {clientPicker('board-client', newClient, setNewClient)}
            <Button type="submit" disabled={busy} className="h-11 rounded-full bg-foreground text-[13px] font-semibold text-background hover:bg-foreground/90">{busy ? 'Making…' : 'Make the board'}</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={o => { if (!o && !busy) setEditing(null) }}>
        <DialogContent className="bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit the board</DialogTitle>
            <DialogDescription>Its name, and which client it is for. Its link stays the same.</DialogDescription>
          </DialogHeader>
          <form onSubmit={e => { e.preventDefault(); void saveEdit() }} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-rename">Name</Label>
              <Input id="board-rename" autoFocus value={editName} maxLength={TEAM_BOARD_NAME_MAX} onChange={e => setEditName(e.target.value)} className="h-11" />
            </div>
            {clientPicker('board-edit-client', editClient, setEditClient)}
            <Button type="submit" disabled={busy} className="h-11 rounded-full bg-foreground text-[13px] font-semibold text-background hover:bg-foreground/90">{busy ? 'Saving…' : 'Save'}</Button>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={o => { if (!o && !busy) setDeleting(null) }}>
        <AlertDialogContent className="bg-popover">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this board?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.name}” and everything on it ({cardCountWords(deleting?.canvas_cards).toLowerCase()}) goes for everyone. It cannot be undone, and its link stops working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={e => { e.preventDefault(); void remove() }} disabled={busy} className="bg-accent-red hover:bg-accent-red/90">{busy ? 'Deleting…' : 'Delete the board'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
