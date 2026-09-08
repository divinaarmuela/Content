'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { BOARD_COLUMNS, columnOf } from '../../lib/board-core'
import type { BoardViewCard, BoardViewer, CardAction } from '../../lib/board-view-core'
import { friendlyError } from '../../lib/support-core'
import { PostChangesDialog, PostedElsewhereDialog, SendBackDialog } from './BoardDialogs'

/**
 * ANSWERING A CARD — the one place the three answers are performed.
 *
 * A plain move goes through the ordinary transition route; sending a card
 * back asks for the words first (`SendBackDialog`); the post's own gate is
 * approved outright or sent back with a note (`PostChangesDialog`), through
 * the same `posting-approval` route the composer and the item page use.
 *
 * The board owned all of this. The "Waiting on you" list above the Scheduler
 * board gives the same two answers, so it lives here instead of being written
 * a second time — one route, one toast, one dialog, whichever surface pressed
 * the button.
 */
export function useCardActs<T extends BoardViewCard>(viewer: BoardViewer, onDone?: () => void): {
  /** the card being written right now, so its buttons can wait */
  busyId: string | null
  /** perform one answer */
  act: (card: T, action: CardAction) => void
  /** the two dialogs the answers open — render this once */
  dialogs: React.ReactNode
} {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [sendBackFor, setSendBackFor] = useState<T | null>(null)
  const [postChangesFor, setPostChangesFor] = useState<T | null>(null)
  const [postedFor, setPostedFor] = useState<T | null>(null)

  /** one move through the ordinary transition route */
  const transition = useCallback(async (card: T, to: string, label: string) => {
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
      onDone?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move it')
    } finally {
      setBusyId(null)
    }
  }, [onDone])

  /** the yes on a post that was waiting — nothing to type, so no dialog */
  const approvePost = useCallback(async (card: T) => {
    setBusyId(card.id)
    try {
      const res = await fetch(`/api/production/items/${card.id}/posting-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(friendlyError(body.error ?? 'Could not approve the post', 'this page'))
      }
      toast.success('Approved — whoever built this post has been told, and it can be booked in now')
      onDone?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not approve the post')
    } finally {
      setBusyId(null)
    }
  }, [onDone])

  const act = useCallback((card: T, action: CardAction) => {
    switch (action.kind) {
      case 'send_back': setSendBackFor(card); return
      // the post's own gate — the same route the composer and the item page
      // use, never a second one
      case 'post_approval':
        if (action.to === 'request_changes') setPostChangesFor(card)
        else void approvePost(card)
        return
      case 'transition':
        // "Posted" needs to know where it went out before the machine will
        // take the move — asked in a dialog, then moved (see BoardDialogs)
        if (action.to === 'published') { setPostedFor(card); return }
        void transition(card, action.to, action.label)
    }
  }, [transition, approvePost])

  const dialogs = (
    <>
      <SendBackDialog card={sendBackFor} viewer={viewer} onClose={() => setSendBackFor(null)} onSent={onDone} />
      <PostChangesDialog card={postChangesFor} onClose={() => setPostChangesFor(null)} />
      <PostedElsewhereDialog card={postedFor} onClose={() => setPostedFor(null)} onPosted={onDone} />
    </>
  )

  return { busyId, act, dialogs }
}
