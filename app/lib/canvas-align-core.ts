/**
 * CARDS LINE UP WITH EACH OTHER AS YOU DRAG (Divina, 13 Nov 2026: "ALSO! autoalignment pleaseee — my slight OCD is
 * tweaking every time I can't align items"). The boards settled a dropped card onto an 8px grid, which keeps things
 * tidy but does not line one card up with ANOTHER: two cards could sit 3px apart for ever.
 *
 * While a card is dragged, its left edge, centre and right edge are compared with every other card's, and the same
 * for top, middle and bottom. The nearest line within reach wins and the card is pulled onto it; a guide is drawn
 * where they meet. Each direction is decided on its own, so a card can line up sideways with one card and up-and-down
 * with another. Pure: boxes in, a position and the guides out.
 */

export type AlignBox = { x: number; y: number; w: number; h: number }

export type Aligned = {
  x: number
  y: number
  /** where the upright guide is drawn (a world x), or null when nothing lined up sideways */
  guideX: number | null
  /** where the level guide is drawn (a world y), or null when nothing lined up up-and-down */
  guideY: number | null
}

/** how close, in screen pixels, an edge must come before it is pulled onto another card's line */
export const ALIGN_REACH_PX = 6

const lines = (start: number, size: number): [number, number, number] => [start, start + size / 2, start + size]

/** the smallest move that puts one of `mine` onto one of `theirs`, within `reach`; null when none is that close */
function nearest(mine: readonly number[], theirs: readonly number[], reach: number): { by: number; at: number } | null {
  let best: { by: number; at: number } | null = null
  for (const m of mine) {
    for (const t of theirs) {
      const by = t - m
      if (Math.abs(by) <= reach && (best === null || Math.abs(by) < Math.abs(best.by))) best = { by, at: t }
    }
  }
  return best
}

/**
 * Where the dragged card should sit. `reach` is in the board's own units: pass ALIGN_REACH_PX divided by the zoom,
 * so the pull feels the same however far in or out the board is.
 */
export function alignTo(moving: AlignBox, others: readonly AlignBox[], reach: number): Aligned {
  if (others.length === 0 || !(reach > 0)) return { x: moving.x, y: moving.y, guideX: null, guideY: null }
  const xs = others.flatMap(o => lines(o.x, o.w))
  const ys = others.flatMap(o => lines(o.y, o.h))
  const sx = nearest(lines(moving.x, moving.w), xs, reach)
  const sy = nearest(lines(moving.y, moving.h), ys, reach)
  return {
    x: sx ? moving.x + sx.by : moving.x,
    y: sy ? moving.y + sy.by : moving.y,
    guideX: sx ? sx.at : null,
    guideY: sy ? sy.at : null,
  }
}
