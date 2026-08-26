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
export function TurnChip({ status, item, viewer, ownerName, turns, brief }: {
  status: ItemStatus
  item: ActingItem
  viewer: { id: string; role: Role }
  ownerName?: string
  /** whose turn each status is. A brief hands over to nobody at the end, so
   *  Production passes BRIEF_STATUS_TURN — otherwise a booked shoot would sit
   *  there waiting on a scheduler who is never coming. */
  turns?: Record<ItemStatus, Role | null>
  /** a shoot brief cannot be claimed — only an account manager picks it up */
  brief?: boolean
}) {
  const turn = whoseTurn(status, item, viewer, turns)
  if (turn.hat === null) return null

  // UNASSIGNED FIRST: an open item is nobody's turn yet. An editor wears the
  // editor hat on every unowned draft, so `mine` is true there too — asking
  // it first made every open draft on the board read "Your turn".
  if (turn.unassigned) {
    return (
      <span className="rounded-full border border-dashed border-zinc-300 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
        {brief ? 'Unassigned — an account manager will pick it up' : 'Unassigned — anyone can take it'}
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
      Waiting on {ownerName ?? `the ${HAT_WORD[turn.hat] ?? turn.hat.replace('_', ' ')}`}
    </span>
  )
}
