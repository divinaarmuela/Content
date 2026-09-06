'use client'

import { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { friendlyError } from '@/app/lib/support-core'
import BoardCanvas from './BoardCanvas'

/**
 * The canvas behind a piece of work — the card's sub-page.
 *
 * Mount it with the item's id and nothing else: the first open makes the
 * board (claimed on `item-<id>`, so two people opening the card at once
 * share one), every later open finds it. The work pages own where this is
 * placed; this component owns only the canvas.
 */
export default function ItemBoard({ itemId, backHref }: {
  itemId: string
  backHref?: { href: string; label: string }
}) {
  const [boardId, setBoardId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setBoardId(null); setError(null)
    fetch('/api/boards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId }),
    })
      .then(async r => {
        const body = await r.json().catch(() => ({})) as { board?: { id: string }; error?: string }
        if (!r.ok || !body.board) throw new Error(body.error ?? 'Could not open the board')
        return body.board.id
      })
      .then(id => { if (!cancelled) setBoardId(id) })
      .catch(e => { if (!cancelled) setError(friendlyError(e instanceof Error ? e.message : String(e), 'The board')) })
    return () => { cancelled = true }
  }, [itemId])

  if (error) {
    return (
      <div className="rounded-card border border-dashed border-border bg-surface px-5 py-10 text-center text-[14px] text-muted-foreground">
        {error}
      </div>
    )
  }
  if (!boardId) return <Skeleton className="h-[70dvh] min-h-[480px] w-full rounded-card" />
  return <BoardCanvas boardId={boardId} backHref={backHref} embedded />
}
