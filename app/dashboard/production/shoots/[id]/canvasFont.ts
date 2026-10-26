import type React from 'react'
import { FONT_STACK, fontOf, type CanvasCard } from '../../../../lib/batch-brief-core'

/** A card with a typeface of its own (26 Oct 2026): the card and everything in
 *  it — a heading's mono, a column's serif title, a note's rich text — read
 *  the one font. It is a variable, so a card inside a column that picked its
 *  own font sets --cf again and wins for itself. */
export const FONT_CLASS = '![font-family:var(--cf)] [&_*]:![font-family:var(--cf)]'
export function fontVars(card: Pick<CanvasCard, 'font' | 'kind'>): React.CSSProperties {
  const f = fontOf(card)
  return f ? ({ '--cf': FONT_STACK[f] } as React.CSSProperties) : {}
}
