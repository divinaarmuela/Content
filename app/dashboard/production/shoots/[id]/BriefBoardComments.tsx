'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useProductionLive, type ProductionChange } from '../../useProductionLive'
import { CanvasCommentsProvider } from '../../../../components/canvas/CanvasComments'
import CardCommentPanel, { type CardComment } from '../../../../components/canvas/CardCommentPanel'
import type { CanvasCard } from '../../../../lib/batch-brief-core'
import { commentsOnCard, countByCard, findCanvasCard } from '../../../../lib/canvas-comments-core'

type Row = {
  id: string
  created_at: string
  body: string
  card_id?: string | null
  team_users: { name: string | null; role: string | null } | null
}

/** "open this card's thread" — dispatched on window by the thread under the plan */
export const OPEN_CARD_EVENT = 'mdm:open-board-card'

/**
 * THE TEAM'S SIDE OF A CARD'S THREAD.
 *
 * Wraps the shoot's canvas: every card wears a bubble with its comment
 * count, and picking one opens that card's thread beside the board (under
 * it on a phone) — who said it, when, and a box to reply. The rows are the
 * shoot's own comments (`batch_comments`), the ones carrying a `card_id`;
 * the client reads and writes the very same rows on their portal, so a
 * reply here lands on their card and their comment lands on this one.
 * `?card=` in the address opens straight onto that card — the link the
 * manager's email carries.
 */
export default function BriefBoardComments({ batchId, cards, children, className }: {
  batchId: string
  cards: CanvasCard[]
  children: React.ReactNode
  className?: string
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/production/batches/${batchId}/comments`, { cache: 'no-store' })
    if (!res.ok) return
    const json = await res.json()
    setRows(json.comments ?? [])
  }, [batchId])
  useEffect(() => { void load() }, [load])

  // both the team's POST and the client's portal POST announce a change
  // tagged `batch:${batchId}` — refetch only when this thread is the one that moved
  const onLive = useCallback((change?: ProductionChange) => {
    if (!change || change.item_id === `batch:${batchId}`) void load()
  }, [batchId, load])
  useProductionLive(onLive)

  // arrive from the manager's email straight on the card it is about — and
  // from the "on: …" tag in the thread below the plan
  useEffect(() => {
    try {
      const id = new URLSearchParams(window.location.search).get('card')
      if (id) setOpen(id)
    } catch { /* fine */ }
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (id) openThread(id)
    }
    window.addEventListener(OPEN_CARD_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_CARD_EVENT, onOpen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const comments = useMemo<(CardComment & { card_id?: string | null })[]>(() => rows.map(r => {
    const fromClient = r.team_users?.role === 'client'
    return {
      id: r.id,
      created_at: r.created_at,
      body: r.body,
      author_name: fromClient
        ? (r.team_users?.name ?? 'Client').replace(/ \(client portal\)$/, '')
        : r.team_users?.name ?? 'Team',
      from_team: !fromClient,
      card_id: r.card_id ?? null,
    }
  }), [rows])
  const counts = useMemo(() => countByCard(comments), [comments])
  const openCard = useMemo(() => findCanvasCard(cards, open), [cards, open])

  const openThread = useCallback((cardId: string) => {
    setOpen(cardId)
    window.setTimeout(() => {
      if (window.matchMedia('(min-width: 1024px)').matches) return
      panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 50)
  }, [])

  const send = async (body: string): Promise<boolean> => {
    if (!openCard) return false
    const res = await fetch(`/api/production/batches/${batchId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, card_id: openCard.id }),
    })
    if (!res.ok) {
      toast.error((await res.json().catch(() => null))?.error ?? 'Could not send')
      return false
    }
    toast.success('Posted — the client sees it on this card on their portal')
    void load()
    return true
  }

  const ctx = useMemo(() => ({ counts, open: openThread, openCardId: open }), [counts, openThread, open])

  return (
    <CanvasCommentsProvider value={ctx}>
      <div className={cn('grid gap-3', openCard && 'lg:grid-cols-[minmax(0,1fr)_340px]', className)}>
        <div className="min-w-0">{children}</div>
        {openCard && (
          <div ref={panelRef} className="min-w-0">
            <CardCommentPanel
              card={openCard}
              comments={commentsOnCard(openCard.id, comments)}
              onSend={send}
              onClose={() => setOpen(null)}
              viewer="team"
              className="lg:sticky lg:top-4"
            />
          </div>
        )}
      </div>
    </CanvasCommentsProvider>
  )
}
