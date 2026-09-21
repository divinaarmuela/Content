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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useTable } from '@/lib/db-client'
import type { TeamBoard, TeamUser } from '@/lib/db-types'
import PageTitle from '../ui/PageTitle'
import { useRole } from '../useRole'
import { LoadFailed } from '../NotSetUp'
import { personLabel } from '../../lib/identity-core'
import {
  TEAM_BOARD_NAME_MAX, cardCountWords, matchesBoardSearch, mayManageTeamBoards, sortTeamBoards, teamBoardLink, teamBoardPath,
} from '../../lib/team-board-core'

/**
 * BOARDS — the team's own canvases (the owner, 21 Sep 2026: "a boards page,
 * simply for internal, like the board in the shoot brief but for the team to
 * use, and a copy board link feature"). One tile per board, newest work
 * first. A manager makes, renames and deletes; anyone on the team opens one,
 * works on it, and copies its link. No client, no shoot, no approvals.
 */

type Row = TeamBoard & { canvas_cards?: unknown }

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
  const nameOf = (uid: string | null | undefined) => { const u = team.find(t => t.id === uid); return u ? personLabel(u.name, u.email) : null }

  const [search, setSearch] = useState('')
  const [making, setMaking] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<Row | null>(null)
  const [renameTo, setRenameTo] = useState('')
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)

  const boards = useMemo(
    () => sortTeamBoards(rows).filter(b => matchesBoardSearch(b, nameOf(b.created_by), search)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, search, team])

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
      const res = await fetch('/api/production/team-boards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const json = await res.json().catch(() => ({})) as { board?: { id: string }; error?: string }
      if (!res.ok || !json.board) throw new Error(json.error ?? 'Could not make the board')
      setMaking(false); setNewName('')
      router.push(teamBoardPath(json.board.id))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not make the board') } finally { setBusy(false) }
  }

  const rename = async () => {
    if (!renaming) return
    const name = renameTo.trim()
    if (!name) { toast.error('A board needs a name'); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/production/team-boards/${renaming.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not rename it')
      toast.success('Board renamed')
      setRenaming(null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not rename it') } finally { setBusy(false) }
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

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Boards"
        summary="The team’s own canvases — pictures, links, notes and arrows, the same board as a shoot’s plan. Internal only. Open one, work on it, and copy its link to point someone at it."
        actions={manager ? (
          <Button onClick={() => setMaking(true)} className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90">
            <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New board
          </Button>
        ) : undefined}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search boards, or who made them…" className="h-11 max-w-xs rounded-full bg-surface px-4" aria-label="Search boards" />
        {!manager && <span className="text-[13px] text-muted-foreground">An account manager or a super admin makes new boards.</span>}
      </div>

      {error ? (
        <LoadFailed what="the boards" detail={error} onRetry={() => window.location.reload()} />
      ) : loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-card" />)}</div>
      ) : boards.length === 0 ? (
        <div className="rounded-card border border-dashed border-border p-10 text-center text-[14px] text-muted-foreground">
          {search.trim() ? `No board matches “${search.trim()}”.` : manager ? 'No boards yet. Make the first one with New board.' : 'No boards yet. An account manager or a super admin can make one.'}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="The team’s boards">
          {boards.map(b => (
            <li key={b.id} className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
              <Link href={teamBoardPath(b.id)} className="flex min-h-11 flex-col gap-1">
                <span className="text-[16px] font-semibold leading-snug">{b.name}</span>
                <span className="text-[13px] text-muted-foreground">{cardCountWords(b.canvas_cards)}</span>
              </Link>
              <p className="text-[12px] text-muted-foreground">
                {nameOf(b.created_by) ? `Made by ${nameOf(b.created_by)}` : 'Made'} {when(b.created_at)}
                {b.updated_at && b.updated_at !== b.created_at ? ` · last worked on ${when(b.updated_at)}${nameOf(b.updated_by) ? ` by ${nameOf(b.updated_by)}` : ''}` : ''}
              </p>
              <div className="mt-auto flex flex-wrap items-center gap-2">
                <Button asChild className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90">
                  <Link href={teamBoardPath(b.id)}>Open</Link>
                </Button>
                <Button variant="outline" onClick={() => void copyLink(b)} className="h-11 rounded-full px-4 text-[13px] font-semibold">
                  <Link2 className="mr-1.5 h-4 w-4" aria-hidden /> Copy board link
                </Button>
                {manager && (
                  <>
                    <Button variant="ghost" size="icon" className="ml-auto h-11 w-11 rounded-full text-muted-foreground" aria-label={`Rename ${b.name}`}
                      onClick={() => { setRenaming(b); setRenameTo(b.name) }}><Pencil className="h-4 w-4" aria-hidden /></Button>
                    <Button variant="ghost" size="icon" className="h-11 w-11 rounded-full text-muted-foreground hover:text-accent-red-deep" aria-label={`Delete ${b.name}`}
                      onClick={() => setDeleting(b)}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={making} onOpenChange={o => { if (!busy) setMaking(o) }}>
        <DialogContent className="bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New board</DialogTitle>
            <DialogDescription>A blank canvas for the team. Anyone on the team can open it and work on it.</DialogDescription>
          </DialogHeader>
          <form onSubmit={e => { e.preventDefault(); void create() }} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-name">Name</Label>
              <Input id="board-name" autoFocus value={newName} maxLength={TEAM_BOARD_NAME_MAX} onChange={e => setNewName(e.target.value)} placeholder="October campaign ideas" className="h-11" />
            </div>
            <Button type="submit" disabled={busy} className="h-11 rounded-full bg-foreground text-[13px] font-semibold text-background hover:bg-foreground/90">{busy ? 'Making…' : 'Make the board'}</Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!renaming} onOpenChange={o => { if (!o && !busy) setRenaming(null) }}>
        <DialogContent className="bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename the board</DialogTitle>
            <DialogDescription>Its link stays the same.</DialogDescription>
          </DialogHeader>
          <form onSubmit={e => { e.preventDefault(); void rename() }} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="board-rename">Name</Label>
              <Input id="board-rename" autoFocus value={renameTo} maxLength={TEAM_BOARD_NAME_MAX} onChange={e => setRenameTo(e.target.value)} className="h-11" />
            </div>
            <Button type="submit" disabled={busy} className="h-11 rounded-full bg-foreground text-[13px] font-semibold text-background hover:bg-foreground/90">{busy ? 'Saving…' : 'Save the name'}</Button>
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
