'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import { BOARD_COLUMNS, columnOf, type BoardColumnKey } from '../../lib/board-core'
import {
  SHOW_LABELS, applyShow, dropAction, isAssignedTo, isShowFilter, moveTargets,
  type BoardViewCard, type BoardViewer, type CardAction, type ShowFilter,
} from '../../lib/board-view-core'
import { friendlyError } from '../../lib/support-core'
import { LaneBoard, type Lane } from '../production/LaneBoard'
import { BoardCard } from './BoardCard'
import {
  DeleteDialog, KindDialog, LinkDialog, SendBackDialog, type KindRow,
} from './BoardDialogs'

/**
 * THE ONE BOARD, on all three pages.
 *
 * Five columns as lanes (or fewer — the page says which), the restyle's
 * cards, drag between columns. Every drop asks `dropAction` — the same rules
 * as the buttons — and a refused drop snaps back with the machine's plain
 * reason. The keyboard's way is the card's own "Move to…" menu, which offers
 * exactly the columns a drag could reach.
 *
 * The board owns the few dialogs a card can open and the fetches they make.
 * The rows come from the page's live listeners, so nothing here reloads:
 * the listener repaints the moment the row lands.
 *
 * Nothing here asks anyone to post. "Booked in" and "Posted" are plain
 * moves — the posting itself happens on the Schedule page, or wherever the
 * scheduler posts, and the card only records that it happened.
 */

export type BoardCardRow = BoardViewCard & {
  work_kinds?: { name: string; slug?: string; color?: string } | null
}

/** What is NOT in a column, in the column's own words. Exported so the
 *  Production list, which draws the same five columns, says the same. */
export const COLUMN_EMPTY: Record<BoardColumnKey, string> = {
  draft: 'Nothing being made.',
  internal_check: 'Nothing waiting on a check.',
  with_client: 'Nothing with a client.',
  ready_to_post: 'Nothing ready to post.',
  posted: 'Nothing booked in or posted.',
}

/**
 * The column and the lens named in the address — `?column=with_client`,
 * `?show=due` — read after mount, because these pages prerender. Clearing
 * the lens rewrites the address without a navigation.
 */
export function useBoardParams(): { column: BoardColumnKey | null; show: ShowFilter | null; clearShow: () => void } {
  const [column, setColumn] = useState<BoardColumnKey | null>(null)
  const [show, setShow] = useState<ShowFilter | null>(null)
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search)
      const c = p.get('column')
      setColumn(BOARD_COLUMNS.some(k => k.key === c) ? (c as BoardColumnKey) : null)
      const s = p.get('show')
      setShow(isShowFilter(s) ? s : null)
    } catch { /* no address to read — the board opens plain */ }
  }, [])
  const clearShow = useCallback(() => {
    setShow(null)
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('show')
      window.history.replaceState(null, '', url.toString())
    } catch { /* the page still clears */ }
  }, [])
  return { column, show, clearShow }
}

export function Board({
  cards, viewer, columns, names, kinds, today, initialColumn, show, onClearShow,
  postingToday, connectedClientIds, ariaLabel,
}: {
  cards: BoardCardRow[]
  viewer: BoardViewer
  columns: BoardColumnKey[]
  names: Map<string, string>
  kinds: readonly KindRow[]
  today: string
  /** the column to open on a phone */
  initialColumn?: BoardColumnKey | null
  /** the Overview's lens, if the person came through one */
  show?: ShowFilter | null
  onClearShow?: () => void
  /** the Overview's two lenses: cards posting today, clients with a channel */
  postingToday?: ReadonlySet<string>
  connectedClientIds?: ReadonlySet<string>
  ariaLabel: string
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dragging, setDragging] = useState<BoardCardRow | null>(null)
  const [over, setOver] = useState<BoardColumnKey | null>(null)
  const [linkFor, setLinkFor] = useState<BoardCardRow | null>(null)
  const [kindFor, setKindFor] = useState<BoardCardRow | null>(null)
  const [sendBackFor, setSendBackFor] = useState<BoardCardRow | null>(null)
  const [deleteFor, setDeleteFor] = useState<BoardCardRow | null>(null)

  const isManager = viewer.role === 'account_manager' || viewer.role === 'super_admin'
  const canEdit = useCallback((c: BoardCardRow) => isManager || isAssignedTo(c, viewer.id), [isManager, viewer.id])

  const shown = useMemo(
    () => applyShow(cards, show ?? null, { viewer, today, postingToday, connectedClientIds }),
    [cards, show, viewer, today, postingToday, connectedClientIds],
  )

  /** the columns a drag may land on right now */
  const reachable = useMemo(
    () => (dragging ? new Set(moveTargets(dragging, viewer).map(t => t.column)) : new Set<BoardColumnKey>()),
    [dragging, viewer],
  )

  /** one move through the ordinary transition route */
  const transition = useCallback(async (card: BoardCardRow, to: string, label: string) => {
    setBusyId(card.id)
    try {
      const res = await fetch(`/api/production/items/${card.id}/transition`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(friendlyError(body.error ?? 'Could not move it', 'this page'))
      }
      const column = BOARD_COLUMNS.find(c => c.key === columnOf(to as BoardViewCard['status']))
      toast.success(`${label} — now in ${column?.label ?? 'its new column'}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move it')
    } finally {
      setBusyId(null)
    }
  }, [])

  /** every press on a card comes through here — a plain move, or the one
   *  dialog that asks what needs changing */
  const act = useCallback((card: BoardCardRow, action: CardAction) => {
    switch (action.kind) {
      case 'send_back': setSendBackFor(card); return
      case 'transition': void transition(card, action.to, action.label)
    }
  }, [transition])

  const drop = (column: BoardColumnKey) => {
    const card = dragging
    setDragging(null)
    setOver(null)
    if (!card) return
    const d = dropAction(card, column, viewer)
    // a refused move snaps back: nothing changed, and the reason is said
    if (!d.ok) { toast.error(d.reason); return }
    act(card, d.action)
  }

  const lanes: Lane[] = columns.map(key => {
    const column = BOARD_COLUMNS.find(c => c.key === key)!
    const inLane = shown.filter(c => columnOf(c.status) === key)
    const active = dragging !== null && reachable.has(key)
    const zone = (
      <div
        role="list"
        aria-label={`${column.label} — drop a card here to move it`}
        onDragOver={e => { if (dragging) { e.preventDefault(); if (over !== key) setOver(key) } }}
        onDragLeave={() => { if (over === key) setOver(null) }}
        onDrop={e => { e.preventDefault(); drop(key) }}
        className={`flex min-h-[120px] flex-col gap-2.5 rounded-inner transition-colors ${
          dragging
            ? active
              ? over === key ? 'bg-tint-green ring-2 ring-accent-green' : 'bg-tint-green'
              : 'opacity-60'
            : ''
        }`}
      >
        {inLane.map(c => (
          <div
            key={c.id}
            role="listitem"
            draggable={!busyId}
            onDragStart={e => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', c.id)
              setDragging(c)
            }}
            onDragEnd={() => { setDragging(null); setOver(null) }}
            className={dragging?.id === c.id ? 'opacity-50' : ''}
          >
            <BoardCard
              card={c}
              viewer={viewer}
              names={names}
              today={today}
              busy={busyId === c.id}
              canEdit={canEdit(c)}
              onAction={act}
              onMove={act}
              onLink={setLinkFor}
              onKind={setKindFor}
              // the DELETE route is manager-only, so the menu entry is too —
              // a person never sees a button the server would refuse
              canDelete={isManager}
              onDelete={setDeleteFor}
            />
          </div>
        ))}
        {inLane.length === 0 && (
          <div className="rounded-inner border border-dashed border-border px-3 py-7 text-center text-[13px] text-muted-foreground">
            {dragging && active ? `Drop here — ${moveTargets(dragging, viewer).find(t => t.column === key)?.action.label ?? ''}` : COLUMN_EMPTY[key]}
          </div>
        )}
      </div>
    )
    return {
      key,
      title: column.label,
      count: inLane.length,
      empty: COLUMN_EMPTY[key],
      cards: [],
      replace: zone,
      hint: <span className="sr-only">{column.meaning}</span>,
    }
  })

  return (
    <div className="flex flex-col gap-3">
      {show && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <span>Showing <span className="font-semibold text-foreground">{SHOW_LABELS[show]}</span> — {shown.length} of {cards.length}</span>
          {onClearShow && (
            <Button variant="outline" size="sm" onClick={onClearShow}
              className="h-9 rounded-full border-border bg-surface px-3 text-[13px] font-semibold">
              <X className="h-3.5 w-3.5" /> Show all
            </Button>
          )}
        </div>
      )}

      <LaneBoard lanes={lanes} initialLane={initialColumn ?? undefined} ariaLabel={ariaLabel} />

      <LinkDialog card={linkFor} onClose={() => setLinkFor(null)} />
      <KindDialog card={kindFor} kinds={kinds} onClose={() => setKindFor(null)} />
      <SendBackDialog card={sendBackFor} viewer={viewer} onClose={() => setSendBackFor(null)} />
      {/* the live listener drops the row once the server has removed it */}
      <DeleteDialog card={deleteFor} onClose={() => setDeleteFor(null)} />
    </div>
  )
}
