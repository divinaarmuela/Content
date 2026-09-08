'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { clientTone } from '../../lib/post-page-core'
import {
  othersLabel, splitWaiting, waitingRows, waitingTitle, type WaitingRow,
} from '../../lib/waiting-core'
import type { BoardViewer, CardAction } from '../../lib/board-view-core'
import type { BoardCardRow } from '../board/Board'
import { useCardActs } from '../board/useCardActs'
import Chip from '../ui/Chip'
import TintCard from '../ui/TintCard'

/**
 * WAITING ON YOU — everything stuck on a decision, above the board.
 *
 * The board says where every card is. It does not say which of them somebody
 * is held up by, and the five or six that are sit spread across five columns.
 * This is that pile, in one place, with the two answers on each row: approve,
 * or send it back with what should change.
 *
 * Every row and every button comes from `waiting-core`, which reads the same
 * rules the board's own buttons read — so nothing here offers a press the
 * server would refuse. A row the viewer cannot answer (it is with the client,
 * or with another manager) carries no buttons and says whose it is.
 *
 * The rows come off the page's live listener, so the list empties itself as
 * things are answered: answering clears `asked_ids` and moves the state in
 * the same write, and the row simply stops qualifying.
 *
 * Presentation only. No fetches of its own — the two answers go through
 * `useCardActs`, the same routes and the same send-back dialog as the board.
 */
export default function WaitingOnYou({ cards, viewer, today, onOpenCard }: {
  cards: readonly BoardCardRow[]
  viewer: BoardViewer
  today: string
  /** open the card beside the board — the same sheet a board card opens */
  onOpenCard: (id: string) => void
}) {
  const rows = useMemo(() => waitingRows(cards, viewer, today), [cards, viewer, today])
  const byId = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards])
  const { busyId, act, dialogs } = useCardActs<BoardCardRow>(viewer)

  // nothing waiting: the section is not there at all, rather than an empty box
  if (rows.length === 0) return null

  const { yours, others } = splitWaiting(rows)
  const item = (row: WaitingRow) => (
    <li key={row.id}>
      <WaitingItem
        row={row}
        busy={busyId === row.id}
        onOpen={() => { if (row.open.kind === 'card') onOpenCard(row.open.id) }}
        onAction={action => {
          const card = byId.get(row.id)
          if (card) act(card, action)
        }}
      />
    </li>
  )

  return (
    <TintCard tone={yours.length > 0 ? 'amber' : 'surface'} title={waitingTitle(rows)}>
      {yours.length > 0 && <ul className="flex flex-col gap-2.5">{yours.map(item)}</ul>}
      {others.length > 0 && (
        // what is out with somebody else: counted and one press away, never in
        // front of the things this person can actually answer. Open already
        // when there is nothing of theirs to hide it behind.
        <details open={yours.length === 0} className="group">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-[13px] font-semibold text-foreground underline-offset-4 hover:underline">
            {othersLabel(others)}
            <span aria-hidden className="ml-1.5 transition-transform group-open:rotate-90">›</span>
          </summary>
          <ul className="flex flex-col gap-2.5 pt-1.5">{others.map(item)}</ul>
        </details>
      )}
      {dialogs}
    </TintCard>
  )
}

/**
 * ONE ROW: the client, the piece, what is being asked — and the answers.
 *
 * The words are the press that opens the thing itself: a card opens beside
 * the board, a post opens the composer on its own preview, which is where the
 * caption and the pictures being approved actually are. The answers sit
 * beside them on a wide screen and beneath them on a phone, each a full 44px
 * target.
 */
function WaitingItem({ row, busy, onOpen, onAction }: {
  row: WaitingRow
  busy: boolean
  onOpen: () => void
  onAction: (action: CardAction) => void
}) {
  const words = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={clientTone(row.clientId)}>{row.client}</Chip>
        <span className="min-w-0 break-words text-[15px] font-semibold text-foreground">{row.title}</span>
      </div>
      <p className="text-[13px] text-muted-foreground">
        {row.line}
        {row.since && <span className="whitespace-nowrap"> {row.since}</span>}
      </p>
    </>
  )

  return (
    <div className="flex flex-col gap-2.5 rounded-inner border border-border bg-surface p-3 sm:flex-row sm:items-center sm:gap-3">
      {row.open.kind === 'post' ? (
        <Link
          href={row.open.href}
          className="flex min-w-0 flex-1 flex-col gap-1.5 text-left underline-offset-4 hover:underline"
        >
          {words}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 flex-col gap-1.5 text-left underline-offset-4 hover:underline"
        >
          {words}
        </button>
      )}
      {row.actions.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-2">
          {row.actions.map((action, i) => (
            <Button
              key={`${action.kind}-${action.to}`}
              variant={i === 0 ? 'default' : 'outline'}
              disabled={busy}
              onClick={() => onAction(action)}
              className={i === 0
                ? 'h-11 rounded-full px-4 text-[13px] font-semibold'
                : 'h-11 rounded-full border-border bg-surface px-4 text-[13px] font-semibold'}
            >
              {busy && i === 0 ? 'Saving…' : action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
