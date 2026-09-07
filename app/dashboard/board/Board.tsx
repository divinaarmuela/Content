'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { X } from 'lucide-react'
import { BOARD_COLUMNS, columnOf, type BoardColumnKey } from '../../lib/board-core'
import {
  COLUMN_EMPTY, OLDER_POSTS_NOTE, SHOW_LABELS, applyShow, dropOnLane, groupByLane, isAssignedTo, isShowFilter,
  laneOf, pageLanes, reachableLanes,
  type BoardPage, type BoardViewCard, type BoardViewer, type CardAction, type PageLaneKey, type ShowFilter,
} from '../../lib/board-view-core'
import { friendlyError } from '../../lib/support-core'
import { useTable } from '@/lib/db-client'
import type { PostAnalytic, SocialPost } from '@/lib/db-types'
import { boardLine, readPerformance } from '../../lib/post-performance-core'
import { readInteractors, withFromThisPost } from '../../lib/followers-core'
import { postPageHref } from '../../lib/post-page-core'
import { LaneBoard, type Lane } from '../production/LaneBoard'
import { BoardCard, CompactCard } from './BoardCard'
import {
  DeleteDialog, KindDialog, LinkDialog, SendBackDialog, type KindRow,
} from './BoardDialogs'

/**
 * THE ONE BOARD, on all three pages.
 *
 * The five columns arranged into the page's LANES (`pageLanes`): Production
 * draws all five; Editor and Scheduler give room to the stages that person
 * works and fold the rest into one narrow lane — "Done" on Editor, "Coming
 * up" on Scheduler — drawn compact, collapsible to a rail, the choice
 * remembered per page. The restyle's cards; drag between lanes. Every drop
 * asks `dropOnLane` — the same rules as the buttons, a folded lane entered
 * at the first stage inside it the rules allow — and a refused drop snaps
 * back with the machine's plain reason. The keyboard's way is the card's own
 * "Move to…" menu, which offers exactly the columns a drag could reach.
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

/** The columns' empty sentences, defined with the lanes in board-view-core;
 *  re-exported so the Production list, which draws the same five columns,
 *  says the same. */
export { COLUMN_EMPTY }

/** where a page remembers that its folded lane is shut */
const FOLD_KEY = (page: BoardPage) => `mdm:board:${page}:folded-shut`

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
  cards, viewer, page, names, kinds, today, onOpen, initialColumn, show, onClearShow,
  postingToday, connectedClientIds, ariaLabel,
}: {
  cards: BoardCardRow[]
  viewer: BoardViewer
  /** which page this is — it decides the lanes (`pageLanes`) */
  page: BoardPage
  names: Map<string, string>
  kinds: readonly KindRow[]
  today: string
  /** a press on a card — the page opens it beside the board (`CardSheet`) */
  onOpen: (card: BoardCardRow) => void
  /** the column to open on a phone — mapped to the lane it sits in here */
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
  const [over, setOver] = useState<PageLaneKey | null>(null)
  const [linkFor, setLinkFor] = useState<BoardCardRow | null>(null)
  const [kindFor, setKindFor] = useState<BoardCardRow | null>(null)
  const [sendBackFor, setSendBackFor] = useState<BoardCardRow | null>(null)
  const [deleteFor, setDeleteFor] = useState<BoardCardRow | null>(null)
  /** a drag is not a press: browsers do not fire click after a drop, but a
   *  drag that ends where it began can — so a card that was just dragged
   *  stays shut until the next tick */
  const justDragged = useRef(false)
  const open = useCallback((card: BoardViewCard) => {
    if (justDragged.current) return
    const row = cards.find(c => c.id === card.id)
    onOpen(row ?? (card as BoardCardRow))
  }, [cards, onOpen])

  /** the folded lane, shut to a rail or open — remembered per page */
  const [foldShut, setFoldShut] = useState(false)
  useEffect(() => {
    try { setFoldShut(localStorage.getItem(FOLD_KEY(page)) === '1') } catch { /* open by default */ }
  }, [page])
  const toggleFold = useCallback(() => {
    setFoldShut(shut => {
      try { localStorage.setItem(FOLD_KEY(page), shut ? '0' : '1') } catch { /* the choice lasts the session */ }
      return !shut
    })
  }, [page])

  const isManager = viewer.role === 'account_manager' || viewer.role === 'super_admin'
  const canEdit = useCallback((c: BoardCardRow) => isManager || isAssignedTo(c, viewer.id), [isManager, viewer.id])

  /** how each posted card did — "42 interactions · +12 followers" — live off
   *  the per-post cache, so the line moves when the sweep writes */
  const hasPosted = useMemo(() => cards.some(c => c.status === 'published'), [cards])
  const { rows: analyticRows } = useTable<PostAnalytic>('post_analytics', { enabled: hasPosted })
  const statsByItem = useMemo(() => {
    const out = new Map<string, string>()
    const sorted = [...analyticRows].sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
    for (const r of sorted) {
      if (!r.item_id || out.has(r.item_id)) continue
      // …plus who followed from this post, off the same row
      const line = withFromThisPost(boardLine(readPerformance(r.performance)), readInteractors(r.interactors)?.followed)
      if (line) out.set(r.item_id, line)
    }
    return out
  }, [analyticRows])

  /** …and where that line GOES: the post's own page. A card that carried
   *  several posts links to the one that actually went out last. */
  const { rows: postRows } = useTable<SocialPost>('social_posts', { enabled: hasPosted })
  const postByItem = useMemo(() => {
    const out = new Map<string, string>()
    const sent = [...postRows]
      .filter(p => (Array.isArray(p.publish_job_ids) ? p.publish_job_ids.length : 0) > 0)
      .sort((a, b) => (b.scheduled_for ?? b.created_at ?? '').localeCompare(a.scheduled_for ?? a.created_at ?? ''))
    for (const p of sent) if (p.item_id && !out.has(p.item_id)) out.set(p.item_id, p.id)
    return out
  }, [postRows])

  const shown = useMemo(
    () => applyShow(cards, show ?? null, { viewer, today, postingToday, connectedClientIds }),
    [cards, show, viewer, today, postingToday, connectedClientIds],
  )

  const laneLayout = useMemo(() => pageLanes(page), [page])
  const grouped = useMemo(() => groupByLane(laneLayout, shown), [laneLayout, shown])

  /** the lanes a drag may land on right now */
  const reachable = useMemo(
    () => new Set<PageLaneKey>(dragging ? reachableLanes(page, dragging, viewer) : []),
    [dragging, page, viewer],
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

  const drop = (laneKey: PageLaneKey) => {
    const card = dragging
    setDragging(null)
    setOver(null)
    if (!card) return
    const lane = laneLayout.find(l => l.key === laneKey)
    if (!lane) return
    const d = dropOnLane(card, lane, viewer)
    // a refused move snaps back: nothing changed, and the reason is said
    if (!d.ok) { toast.error(d.reason); return }
    act(card, d.action)
  }

  const lanes: Lane[] = grouped.map(({ lane, cards: inLane }) => {
    const key = lane.key
    const active = dragging !== null && reachable.has(key)
    const dropLabel = dragging && active ? dropOnLane(dragging, lane, viewer) : null
    const zone = (
      <div
        role="list"
        aria-label={`${lane.label} — drop a card here to move it`}
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
              justDragged.current = true
              setDragging(c)
            }}
            onDragEnd={() => {
              setDragging(null); setOver(null)
              setTimeout(() => { justDragged.current = false }, 0)
            }}
            className={dragging?.id === c.id ? 'opacity-50' : ''}
          >
            {lane.folded ? (
              // compact: title, client, stage — open the card to act on it
              <CompactCard card={c} today={today} onOpen={open} />
            ) : (
              <BoardCard
                card={c}
                viewer={viewer}
                names={names}
                today={today}
                busy={busyId === c.id}
                canEdit={canEdit(c)}
                onOpen={open}
                onAction={act}
                onMove={act}
                onLink={setLinkFor}
                onKind={setKindFor}
                // the DELETE route is manager-only, so the menu entry is too —
                // a person never sees a button the server would refuse
                canDelete={isManager}
                onDelete={setDeleteFor}
                stats={statsByItem.get(c.id) ?? null}
                statsHref={postByItem.has(c.id) ? postPageHref(postByItem.get(c.id)!) : null}
              />
            )}
          </div>
        ))}
        {inLane.length === 0 && (
          <div className="rounded-inner border border-dashed border-border px-3 py-7 text-center text-[13px] text-muted-foreground">
            {dropLabel?.ok ? `Drop here — ${dropLabel.action.label}` : lane.empty}
          </div>
        )}
      </div>
    )
    // Posted keeps the last two weeks; the rest are records on the client's page
    const holdsPosted = lane.columns.includes('posted')
    return {
      key,
      title: lane.label,
      count: inLane.length,
      empty: lane.empty,
      cards: [],
      replace: zone,
      footer: holdsPosted ? (
        <p className="px-1 pt-1 text-[12px] text-muted-foreground">{OLDER_POSTS_NOTE}</p>
      ) : undefined,
      hint: lane.columns.length === 1
        ? <span className="sr-only">{BOARD_COLUMNS.find(c => c.key === lane.columns[0])?.meaning}</span>
        : <span className="sr-only">{lane.columns.map(c => BOARD_COLUMNS.find(b => b.key === c)?.label).join(', ')}</span>,
      folded: lane.folded,
      collapsed: lane.folded ? foldShut : undefined,
      onToggle: lane.folded ? toggleFold : undefined,
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

      <LaneBoard
        lanes={lanes}
        initialLane={initialColumn ? laneOf(page, initialColumn) : undefined}
        ariaLabel={ariaLabel}
      />

      <LinkDialog card={linkFor} onClose={() => setLinkFor(null)} />
      <KindDialog card={kindFor} kinds={kinds} onClose={() => setKindFor(null)} />
      <SendBackDialog card={sendBackFor} viewer={viewer} onClose={() => setSendBackFor(null)} />
      {/* the live listener drops the row once the server has removed it */}
      <DeleteDialog card={deleteFor} onClose={() => setDeleteFor(null)} />
    </div>
  )
}
