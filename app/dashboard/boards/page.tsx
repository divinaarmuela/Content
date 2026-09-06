'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useTable } from '@/lib/db-client'
import type { Board, Client } from '@/lib/db-types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { friendlyError } from '@/app/lib/support-core'
import {
  colourOf, countLabel, iconOf, type Inside,
} from '@/app/lib/board-canvas-core'
import PageTitle from '../ui/PageTitle'
import { useRole } from '../useRole'
import { COLOUR_CLASS, ICON } from './canvasTone'
import NewBoardDialog from './NewBoardDialog'

/**
 * BOARDS — a client's canvases, one tile each, and the button that makes
 * another. Pick the client, open a board, or make one; the canvas behind a
 * piece of work is reached from the card, not from here.
 */

const CLIENTS_BY_NAME: ['name', 'asc'][] = [['name', 'asc']]
const LAST_CLIENT = 'md-boards-client'

/** `useSearchParams` needs a Suspense boundary above it or the build
 *  refuses to prerender the page; the skeleton is what shows for that instant. */
export default function BoardsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full rounded-card" />}>
      <BoardsInner />
    </Suspense>
  )
}

function BoardsInner() {
  const router = useRouter()
  const search = useSearchParams()
  const { role } = useRole()
  const clients = useTable<Client>('clients', { orderBy: CLIENTS_BY_NAME })
  const [clientId, setClientId] = useState<string>(search.get('client') ?? '')
  const [boards, setBoards] = useState<Board[] | null>(null)
  const [inside, setInside] = useState<Record<string, Inside>>({})
  const [error, setError] = useState<string | null>(null)
  const [making, setMaking] = useState(false)

  useEffect(() => {
    if (clientId) return
    try {
      const saved = localStorage.getItem(LAST_CLIENT)
      if (saved) setClientId(saved)
    } catch { /* fine */ }
  }, [clientId])
  useEffect(() => {
    if (!clientId && clients.rows.length === 1) setClientId(clients.rows[0].id)
  }, [clientId, clients.rows])

  const load = useCallback(async () => {
    if (!clientId) { setBoards(null); return }
    setError(null)
    try {
      const res = await fetch(`/api/boards?clientId=${encodeURIComponent(clientId)}`)
      const body = await res.json().catch(() => ({})) as { boards?: Board[]; inside?: Record<string, Inside>; error?: string }
      if (!res.ok) throw new Error(body.error ?? 'Could not load the boards')
      setBoards(body.boards ?? [])
      setInside(body.inside ?? {})
      try { localStorage.setItem(LAST_CLIENT, clientId) } catch { /* fine */ }
    } catch (e) {
      setBoards([])
      setError(friendlyError(e instanceof Error ? e.message : String(e), 'Boards'))
    }
  }, [clientId])
  useEffect(() => { void load() }, [load])

  const client = useMemo(() => clients.rows.find(c => c.id === clientId) ?? null, [clients.rows, clientId])
  const canDraw = role !== null && role !== 'client'

  return (
    <div className="dbx-boards">
      <PageTitle
        title="Boards"
        summary="A free canvas for each client: notes, images, links and boards inside boards."
        actions={
          <>
            <Select value={clientId} onValueChange={v => { setClientId(v); router.replace(`/dashboard/boards?client=${v}`) }}>
              <SelectTrigger className="h-11 min-w-[220px] rounded-full" aria-label="Client">
                <SelectValue placeholder="Pick a client" />
              </SelectTrigger>
              <SelectContent>
                {clients.rows.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {canDraw && <Button onClick={() => setMaking(true)} disabled={!clientId}>New board</Button>}
          </>
        }
      />

      {!clientId ? (
        <div className="rounded-card border border-dashed border-border bg-surface px-5 py-14 text-center text-[14px] text-muted-foreground">
          Pick a client to see their boards.
        </div>
      ) : boards === null ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2].map(i => <Skeleton key={i} className="aspect-square rounded-card" />)}
        </div>
      ) : error ? (
        <div className="rounded-card border border-dashed border-border bg-surface px-5 py-10 text-center text-[14px] text-muted-foreground">{error}</div>
      ) : boards.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border bg-surface px-5 py-14 text-center">
          <p className="text-[17px] font-semibold">No boards for {client?.name ?? 'this client'} yet</p>
          <p className="max-w-xs text-[13px] text-muted-foreground">A board is a canvas: put a shoot concept, a location list and the links to the raw files on it, and make boards inside it as it grows.</p>
          {canDraw && <Button onClick={() => setMaking(true)}>Make the first one</Button>}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {boards.map(b => {
            const Icon = ICON[iconOf(b.icon)]
            return (
              <li key={b.id}>
                <Link
                  href={`/dashboard/boards/${b.id}`}
                  className={cn('flex aspect-square flex-col items-center justify-center gap-2 rounded-card p-4 text-center transition-shadow hover:shadow-md', COLOUR_CLASS[colourOf('board', b.colour)])}
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-card bg-surface/70 dark:bg-foreground/10">
                    <Icon className="h-7 w-7" />
                  </div>
                  <p className="line-clamp-2 text-[15px] font-semibold leading-tight">{b.name}</p>
                  <p className="text-[12px] text-muted-foreground">{countLabel(inside[b.id] ?? { cards: 0, boards: 0 })}</p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <NewBoardDialog
        open={making}
        onOpenChange={setMaking}
        onSubmit={async v => {
          const res = await fetch('/api/boards', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...v, client_id: clientId }),
          })
          const body = await res.json().catch(() => ({})) as { board?: Board; error?: string }
          if (!res.ok || !body.board) { toast.error(friendlyError(body.error, 'Boards')); return }
          router.push(`/dashboard/boards/${body.board.id}`)
        }}
      />
    </div>
  )
}
