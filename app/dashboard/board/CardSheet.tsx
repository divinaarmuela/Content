'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import CardDetail from '../production/[id]/CardDetail'
import { isDismissSwipe, readCardParam, withCardParam } from '../../lib/card-sheet-core'

/**
 * THE CARD, BESIDE THE BOARD.
 *
 * A press on a board card slides this in from the right — the board stays
 * where it was, still live, still visible behind the panel. Inside is
 * `CardDetail` in its sheet layout: the same hooks, the same moves and the
 * same conversation as the full page, so a move made here repaints the card
 * behind it and a colleague's comment lands while the panel is open.
 *
 * Esc and a press on the backdrop close it (Radix). On a phone, so does a
 * swipe to the right: the panel follows the thumb and lets go past 80px.
 * The full page is one tap away for anyone who wants the room.
 */
export function CardSheet({ id, onClose }: {
  /** the open card, or null for shut */
  id: string | null
  onClose: () => void
}) {
  // the swipe: where the touch began, how far it has come
  const start = useRef<{ x: number; y: number } | null>(null)
  const [dx, setDx] = useState(0)
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY }
    setDx(0)
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current) return
    const t = e.touches[0]
    const x = t.clientX - start.current.x
    const y = t.clientY - start.current.y
    // only a sideways drag moves the panel; a scroll is a scroll
    setDx(x > 0 && Math.abs(x) > Math.abs(y) ? x : 0)
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = start.current
    start.current = null
    const t = e.changedTouches[0]
    if (s && t && isDismissSwipe(t.clientX - s.x, t.clientY - s.y)) onClose()
    setDx(0)
  }

  return (
    <Sheet open={id !== null} onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent
        side="right"
        hideClose
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => { start.current = null; setDx(0) }}
        style={dx > 0 ? { transform: `translateX(${dx}px)`, transition: 'none' } : undefined}
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px] data-[state=open]:animate-sheet-in-right data-[state=closed]:animate-sheet-out-right"
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">Card</SheetTitle>
        {id && <CardDetail key={id} id={id} layout="sheet" onClose={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

/**
 * Which card is open, kept in the address as `?card=<id>` — so a link to a
 * card lands on it open, a refresh reopens it, and Back closes it. Written
 * with replaceState: no navigation, no scroll jump, the board never
 * remounts.
 */
export function useCardSheet(): { cardId: string | null; open: (id: string) => void; close: () => void } {
  const [cardId, setCardId] = useState<string | null>(null)

  // read after mount — these pages prerender; then follow Back / Forward
  useEffect(() => {
    const read = () => {
      try { setCardId(readCardParam(window.location.search)) } catch { /* no address to read */ }
    }
    read()
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [])

  const write = useCallback((id: string | null) => {
    try {
      window.history.replaceState(window.history.state, '', withCardParam(window.location.href, id))
    } catch { /* the sheet still opens */ }
  }, [])
  const open = useCallback((id: string) => { setCardId(id); write(id) }, [write])
  const close = useCallback(() => { setCardId(null); write(null) }, [write])

  return { cardId, open, close }
}
