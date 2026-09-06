'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useRow, useTable } from '@/lib/db-client'
import type { Board, BoardComment, BoardItem } from '@/lib/db-types'
import { friendlyError } from '@/app/lib/support-core'
import {
  visibleCanvasComments, type CanvasItem, type Crumb, type Inside,
} from '@/app/lib/board-canvas-core'

/**
 * One board, live.
 *
 * The rows come straight off the database listener (`board_items` by
 * board_id — an indexed query), so two people on the same canvas see each
 * other's moves as they land. Writes go through the API, which is where
 * the role gate, the client scope and the claim live. Between the pointer
 * going up and the row coming back, the item is drawn where it was dropped
 * (`overrides`), so nothing snaps back and forth while the write is in
 * flight.
 *
 * Breadcrumbs and the counts on nested tiles come from one API read, since
 * they need every board the client has rather than this one.
 */

export type ApiError = { error: string }

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await res.json().catch(() => ({})) as T & Partial<ApiError>
  if (!res.ok) throw new Error(body.error ?? `Could not reach the board (HTTP ${res.status})`)
  return body
}

/** A failure, said in plain words, once. */
export function say(e: unknown, doing: string): void {
  toast.error(friendlyError(e instanceof Error ? e.message : String(e), doing))
}

export type LiveItem = CanvasItem & { updated_at?: string; created_at?: string }

export function useBoard(boardId: string | null, role: string | null) {
  const board = useRow<Board>('boards', boardId)
  const itemsBy = useMemo(() => ({ board_id: boardId ?? '' }), [boardId])
  const live = useTable<BoardItem>('board_items', { by: itemsBy, enabled: !!boardId })
  const thread = useTable<BoardComment>('board_comments', { by: itemsBy, enabled: !!boardId })

  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const [inside, setInside] = useState<Record<string, Inside>>({})
  const [refused, setRefused] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<string, Partial<LiveItem>>>({})

  /** the API's own view: breadcrumbs, nested counts, and whether we may be here at all */
  const refreshMeta = useCallback(async () => {
    if (!boardId) return
    try {
      const snap = await call<{ crumbs: Crumb[]; inside: Record<string, Inside> }>(`/api/boards/${boardId}`)
      setCrumbs(snap.crumbs)
      setInside(snap.inside)
      setRefused(null)
    } catch (e) {
      setRefused(e instanceof Error ? e.message : 'Could not open this board')
    }
  }, [boardId])

  useEffect(() => { void refreshMeta() }, [refreshMeta])
  // nested counts move when an item lands on a child board; a light refresh
  // when this board's own tiles change is enough for "39 cards" to stay honest
  const tileCount = live.rows.filter(r => r.kind === 'board').length
  useEffect(() => { void refreshMeta() }, [tileCount, refreshMeta])

  // an override is done once the live row has caught up with it
  useEffect(() => {
    setOverrides(prev => {
      let changed = false
      const next = { ...prev }
      for (const [id, o] of Object.entries(prev)) {
        const row = live.rows.find(r => r.id === id)
        if (!row) { if (o.updated_at) { delete next[id]; changed = true }; continue }
        if (o.updated_at && row.updated_at >= o.updated_at) { delete next[id]; changed = true }
      }
      return changed ? next : prev
    })
  }, [live.rows])

  const items = useMemo<LiveItem[]>(
    () => live.rows.map(r => ({ ...(r as unknown as LiveItem), ...(overrides[r.id] ?? {}) })),
    [live.rows, overrides],
  )
  const comments = useMemo(
    () => visibleCanvasComments(role ?? 'editor', thread.rows),
    [thread.rows, role],
  )

  /** draw it here now; the row will agree shortly */
  const preview = useCallback((id: string, patch: Partial<LiveItem>) => {
    setOverrides(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), ...patch, updated_at: undefined } }))
  }, [])

  const inflight = useRef(new Map<string, number>())

  const patchItem = useCallback(async (id: string, patch: Record<string, unknown>) => {
    if (!boardId) return
    preview(id, patch as Partial<LiveItem>)
    const seq = (inflight.current.get(id) ?? 0) + 1
    inflight.current.set(id, seq)
    try {
      const { item } = await call<{ item: BoardItem }>(`/api/boards/${boardId}/items/${id}`, {
        method: 'PATCH', body: JSON.stringify(patch),
      })
      // a later write for the same item owns the override now
      if (inflight.current.get(id) === seq) {
        setOverrides(prev => ({ ...prev, [id]: item as unknown as LiveItem }))
      }
    } catch (e) {
      setOverrides(prev => { const next = { ...prev }; delete next[id]; return next })
      say(e, 'The board')
    }
  }, [boardId, preview])

  const addItem = useCallback(async (input: Record<string, unknown>): Promise<BoardItem | null> => {
    if (!boardId) return null
    try {
      const { item } = await call<{ item: BoardItem }>(`/api/boards/${boardId}/items`, {
        method: 'POST', body: JSON.stringify(input),
      })
      return item
    } catch (e) {
      say(e, 'The board')
      return null
    }
  }, [boardId])

  const removeItem = useCallback(async (id: string) => {
    if (!boardId) return
    try {
      await call(`/api/boards/${boardId}/items/${id}`, { method: 'DELETE' })
    } catch (e) {
      say(e, 'The board')
    }
  }, [boardId])

  const makeBoard = useCallback(async (input: { name: string; icon: string; colour: string; at: { x: number; y: number } }) => {
    if (!board.row) return null
    try {
      const made = await call<{ board: Board; tile: BoardItem | null }>('/api/boards', {
        method: 'POST',
        body: JSON.stringify({ ...input, client_id: board.row.client_id, parent_board_id: board.row.id }),
      })
      return made.board
    } catch (e) {
      say(e, 'The board')
      return null
    }
  }, [board.row])

  const renameBoard = useCallback(async (patch: { name?: string; icon?: string; colour?: string }) => {
    if (!boardId) return
    try {
      await call(`/api/boards/${boardId}`, { method: 'PATCH', body: JSON.stringify(patch) })
      void refreshMeta()
    } catch (e) {
      say(e, 'The board')
    }
  }, [boardId, refreshMeta])

  const addComment = useCallback(async (itemId: string, body: string) => {
    if (!boardId) return false
    try {
      await call(`/api/boards/${boardId}/items/${itemId}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
      return true
    } catch (e) {
      say(e, 'Comments')
      return false
    }
  }, [boardId])

  const resolveComment = useCallback(async (itemId: string, id: string) => {
    if (!boardId) return
    try {
      await call(`/api/boards/${boardId}/items/${itemId}/comments`, { method: 'PATCH', body: JSON.stringify({ id }) })
    } catch (e) {
      say(e, 'Comments')
    }
  }, [boardId])

  return {
    board: board.row,
    loading: board.loading || live.loading,
    error: refused ?? board.error ?? live.error,
    items, comments, crumbs, inside,
    preview, patchItem, addItem, removeItem, makeBoard, renameBoard, addComment, resolveComment,
  }
}
