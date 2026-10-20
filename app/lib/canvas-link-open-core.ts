/**
 * A LINK ON THE BOARD OPENS ITS PAGE (Manal, 20 Oct 2026, a video of the shoot board: a pasted link "becomes
 * instagram video … it should take them to the actual link in new tab").
 *
 * A pasted Instagram, TikTok or YouTube link becomes a post on the board (its picture, its video), and a plain link a
 * link card; neither opened the link (a link card only with Ctrl/Cmd held, a post never). Now a click on either opens
 * the real link in a new tab — except a click on something of the card's own (its play button, the sound switch, a
 * box being typed in), the click that ends a drag, and a click while the card is being edited. Pure.
 */
import type { CanvasCard } from './batch-brief-core'

/** the link a card stands for: a link card's address, a post's own link — https only */
export function cardLinkOf(card: Pick<CanvasCard, 'kind' | 'url' | 'link_url'>): string | undefined {
  const raw = card.kind === 'link' ? card.url : card.kind === 'mockup' ? card.link_url : undefined
  return typeof raw === 'string' && /^https:\/\//i.test(raw) ? raw : undefined
}

/** the card's own controls, which keep their own click */
export const OWN_CONTROLS = 'button, a, video, audio, input, textarea, select, [contenteditable="true"], [role="button"], [data-no-open]'

/** Does this click open the card's link? */
export function opensOnClick(target: { closest?: (sel: string) => unknown } | null, opts: { dragged: boolean; editing: boolean }): boolean {
  if (opts.dragged || opts.editing) return false
  return !target?.closest?.(OWN_CONTROLS)
}
