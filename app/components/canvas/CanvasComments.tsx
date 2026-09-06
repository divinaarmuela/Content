'use client'

import { createContext, useContext } from 'react'
import { MessageCircle } from 'lucide-react'
import { badgeLabel } from '../../lib/canvas-comments-core'

/**
 * Comments on the cards of a shoot's planning board — the glue between the
 * canvas (which draws cards and knows nothing about comments) and whoever is
 * showing it (the client's portal, the team's shoot page), which owns the
 * rows and the panel.
 *
 * The canvas is another agent's file. It reads this context in exactly one
 * place — the badge on every card — and the page around it provides the
 * counts and the one callback. No provider, no badge: every other place the
 * canvas is drawn is untouched.
 */
export type CanvasCommentsValue = {
  /** comments per card id — the badge reads its own number */
  counts: Record<string, number>
  /** open the thread for this card */
  open: (cardId: string) => void
  /** the card whose thread is open, for the badge to say so */
  openCardId: string | null
}

const CanvasCommentsContext = createContext<CanvasCommentsValue | null>(null)

export const CanvasCommentsProvider = CanvasCommentsContext.Provider

export function useCanvasComments(): CanvasCommentsValue | null {
  return useContext(CanvasCommentsContext)
}

/**
 * The bubble in a card's corner: how many comments sit on it, and the one
 * tap that opens them. Drawn only inside a provider. A 44px target because
 * it is tapped on phones, and it stops the pointer reaching the canvas — a
 * tap that starts a drag, a selection or a sheet is a tap that never
 * opened anything.
 */
export function CanvasCommentBadge({ cardId }: { cardId: string }) {
  const ctx = useCanvasComments()
  if (!ctx) return null
  const n = ctx.counts[cardId] ?? 0
  const active = ctx.openCardId === cardId
  return (
    <button
      type="button"
      data-comment-badge
      aria-label={badgeLabel(n)}
      title={badgeLabel(n)}
      onPointerDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); ctx.open(cardId) }}
      onDoubleClick={e => e.stopPropagation()}
      className="absolute -right-3 -top-3 z-10 flex h-11 w-11 items-center justify-center"
    >
      <span
        className={
          'flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-full border px-1.5 text-[11px] font-semibold shadow-sm transition-transform hover:scale-110 '
          + (active
            ? 'border-foreground bg-foreground text-background'
            : n > 0
              ? 'border-accent-amber/40 bg-tint-amber text-foreground'
              : 'border-border bg-surface text-muted-foreground')
        }
      >
        <MessageCircle className="h-3.5 w-3.5" />
        {n > 0 && <span className="tabular-nums">{n}</span>}
      </span>
    </button>
  )
}
