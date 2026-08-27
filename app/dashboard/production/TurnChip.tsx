'use client'

import { whoseTurn, type ActingItem, type ItemStatus } from '../../lib/workflow-core'
import type { Role } from '../../lib/identity-core'

const HAT_WORD: Record<string, string> = {
  editor: 'editor',
  account_manager: 'account manager',
  client: 'client',
  scheduler: 'scheduler',
}

/**
 * One line answering "is this on me?".
 *
 * A status tells you where a piece of work IS; it does not tell you whether
 * you are the one holding it up. This does, in the three words that matter.
 * A published item has nobody's turn left, so it gets no chip at all.
 */
export function TurnChip({ status, item, viewer, ownerName, turns, brief, openTask }: {
  status: ItemStatus
  item: ActingItem
  viewer: { id: string; role: Role }
  ownerName?: string
  /** whose turn each status is. A brief hands over to nobody at the end, so
   *  Production passes BRIEF_STATUS_TURN — otherwise a booked shoot would sit
   *  there waiting on a scheduler who is never coming. */
  turns?: Record<ItemStatus, Role | null>
  /** a shoot plan cannot be claimed — only an account manager picks it up */
  brief?: boolean
  /** somebody tagged the viewer in a comment here and it is not done yet —
   *  that outranks whose turn the STATUS says it is, because a question with
   *  your name on it is your move whatever the stage */
  openTask?: boolean
}) {
  if (openTask) {
    return (
      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
        Waiting on you — tagged
      </span>
    )
  }
  const turn = whoseTurn(status, item, viewer, turns)
  if (turn.hat === null) return null

  // UNASSIGNED FIRST: an open item is nobody's turn yet. An editor wears the
  // editor hat on every unowned draft, so `mine` is true there too — asking
  // it first made every open draft on the board read "Your turn".
  if (turn.unassigned) {
    // …and say what the viewer can actually DO about it: a brief is assigned
    // by a manager (claim-core refuses to let anyone take one), and the
    // scheduling seat is schedulers-only, not "anyone".
    const word = brief
      ? 'Nobody on it — assign an account manager'
      : turn.hat === 'scheduler'
        ? 'Nobody on it — any scheduler can take it'
        : 'Nobody on it — anyone can take it'
    return (
      <span className="rounded-full border border-dashed border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
        {word}
      </span>
    )
  }
  if (turn.mine) {
    return (
      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
        Your turn
      </span>
    )
  }
  return (
    <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
      {/* ownerName is the item's OWNER. That is only the person holding it up
          while the EDITOR has the turn — at internal_review the move belongs
          to an account manager, and naming the editor there was a lie. */}
      Waiting on {turn.hat === 'editor' && ownerName ? ownerName : `the ${HAT_WORD[turn.hat] ?? turn.hat}`}
    </span>
  )
}
