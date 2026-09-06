import { breadcrumbs, countLabel, type Crumb, type Inside } from './board-canvas-core'

/**
 * Boards inside a shoot's board — the pure half.
 *
 * A shoot's board is one flat array of cards (`canvas_cards`). A board tile
 * is a card of kind `board`, and the cards inside it are the cards whose
 * `parent` is that tile's id. Nothing else: no second table, no claim, no
 * id to race for — the board exists the moment its tile does, and two people
 * who open the same tile see the same children because they read the same
 * array. Depth is unlimited; every walk here carries a `seen` set so a cycle
 * in the data stops the walk, never the page.
 */

export type BoardCard = {
  id: string
  kind: string
  name?: string
  parent?: string
}

/** The shoot's own board, the one with no tile. */
export const ROOT_BOARD_NAME = 'Shoot brief'

const parentOf = (c: BoardCard) => c.parent ?? null

/** The cards shown when this board is open (`null` = the shoot's own board). */
export function childrenOf<T extends BoardCard>(cards: readonly T[], boardId: string | null): T[] {
  return cards.filter(c => parentOf(c) === boardId)
}

/** What a tile says: one level down, arrows are lines not cards. */
export function insideOf(cards: readonly BoardCard[], boardId: string): Inside {
  let n = 0
  let boards = 0
  for (const c of cards) {
    if (parentOf(c) !== boardId) continue
    if (c.kind === 'board') boards += 1
    else if (c.kind !== 'arrow') n += 1
  }
  return { cards: n, boards }
}

/** "3 cards", "2 boards", "3 cards · 2 boards", "Empty". */
export const insideLabel = (cards: readonly BoardCard[], boardId: string) => countLabel(insideOf(cards, boardId))

/** Every card nested under a board, to any depth — the tile itself excluded. */
export function descendantsOf(cards: readonly BoardCard[], boardId: string): string[] {
  const byParent = new Map<string, BoardCard[]>()
  for (const c of cards) {
    const p = parentOf(c)
    if (!p) continue
    const list = byParent.get(p)
    if (list) list.push(c); else byParent.set(p, [c])
  }
  const out: string[] = []
  const seen = new Set<string>([boardId])
  const stack = [boardId]
  while (stack.length) {
    for (const c of byParent.get(stack.pop()!) ?? []) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      out.push(c.id)
      if (c.kind === 'board') stack.push(c.id)
    }
  }
  return out
}

export type TrailCrumb = Omit<Crumb, 'id'> & { id: string | null }

/** Root first, the open board last. The root is always there, so the strip
 *  has somewhere to go back to; an unknown board id shows as just the root. */
export function boardTrail(cards: readonly BoardCard[], boardId: string | null): TrailCrumb[] {
  const root: TrailCrumb = { id: null, name: ROOT_BOARD_NAME }
  if (!boardId) return [root]
  const tiles = cards
    .filter(c => c.kind === 'board')
    .map(c => ({ id: c.id, name: c.name || 'Board', parent_board_id: c.parent ?? null }))
  return [root, ...breadcrumbs(boardId, tiles)]
}

/** Deleting a tile deletes what is inside it. Say so, in numbers, before
 *  it happens; `null` means nothing is inside and no question is needed. */
export function deleteWarning(cards: readonly BoardCard[], tile: BoardCard): string | null {
  if (tile.kind !== 'board') return null
  const ids = new Set(descendantsOf(cards, tile.id))
  let n = 0
  let boards = 0
  for (const c of cards) {
    if (!ids.has(c.id)) continue
    if (c.kind === 'board') boards += 1
    else if (c.kind !== 'arrow') n += 1
  }
  if (n === 0 && boards === 0) return null
  return `Everything inside “${tile.name || 'Board'}” goes with it: ${countLabel({ cards: n, boards }).toLowerCase()}.`
}

/** Drop every card whose board is gone — a card pointing at a tile that no
 *  longer exists, or at something that is not a tile, has nowhere to be
 *  shown. Cascades to any depth. */
export function pruneOrphans<T extends BoardCard>(cards: readonly T[]): T[] {
  const byId = new Map(cards.map(c => [c.id, c]))
  const alive = new Map<string, boolean>()
  const isAlive = (c: T): boolean => {
    const p = parentOf(c)
    if (!p) return true
    const cached = alive.get(c.id)
    if (cached !== undefined) return cached
    alive.set(c.id, false) // a cycle resolves to "gone"
    const tile = byId.get(p)
    const ok = !!tile && tile.kind === 'board' && isAlive(tile)
    alive.set(c.id, ok)
    return ok
  }
  return cards.filter(isAlive)
}

/** Where to stand after the cards change: the board you were in if it still
 *  exists, otherwise the shoot's own board. */
export function stillThere(cards: readonly BoardCard[], boardId: string | null): string | null {
  if (!boardId) return null
  return cards.some(c => c.id === boardId && c.kind === 'board') ? boardId : null
}

export type Box = { x: number; y: number; w: number; h: number }

/** How far apart two cards sit when one is placed beside the other. */
export const PLACE_GAP = 16

const overlaps = (a: Box, b: Box, gap: number) =>
  a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y

/**
 * Where a new card goes: the spot the person is looking at (`want`) if it is
 * free, otherwise the nearest free spot around it, searched in rings on the
 * board's 8px grid. This is what let "Board" appear to make only one board:
 * every tile landed on the centre of the screen, on top of the last one,
 * and the pile looked like a single tile. Pure — the caller measures the
 * cards that are on the board and hands their boxes in.
 */
export function freeSpot(want: { x: number; y: number }, size: { w: number; h: number }, taken: readonly Box[], gap = PLACE_GAP): { x: number; y: number } {
  const snap = (n: number) => Math.round(n / 8) * 8
  const fits = (x: number, y: number) => !taken.some(t => overlaps({ x, y, w: size.w, h: size.h }, t, gap))
  const start = { x: snap(want.x), y: snap(want.y) }
  if (fits(start.x, start.y)) return start
  // rings of candidates, nearest first; the step is a card's width or
  // height so the search lands beside a neighbour, not a pixel past it
  const stepX = size.w + gap
  const stepY = size.h + gap
  for (let ring = 1; ring <= 12; ring++) {
    const cands: { x: number; y: number; d: number }[] = []
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue
        const x = snap(start.x + i * stepX)
        const y = snap(start.y + j * stepY)
        cands.push({ x, y, d: Math.hypot(i * stepX, j * stepY) })
      }
    }
    // to the right and below before up and left: the way a page reads
    cands.sort((a, b) => a.d - b.d || (a.x + a.y) - (b.x + b.y))
    for (const c of cands) if (fits(c.x, c.y)) return { x: c.x, y: c.y }
  }
  return start
}
