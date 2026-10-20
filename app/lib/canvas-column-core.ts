/**
 * MILANOTE'S COLUMNS ON OUR BOARD — the pure half (the owner, 20 Oct 2026: "have we added the columns like how
 * milanote does"; docs/MILANOTE_MERGE.md). A column is a card; a card inside it carries `col` (the column) and `ord`
 * (its place). Dropping a card on a column puts it in at the place it was dropped; dragging one out of a column puts
 * it back on the board where it was let go. Pure: the canvas measures, this decides.
 */
import type { CanvasCard } from './batch-brief-core'

export type ColumnBox = { id: string; x: number; y: number; w: number; h: number; z: number }

/** the kinds that may go in a column — everything but a column (Milanote does not nest them) and an arrow */
export function fitsInColumn(kind: CanvasCard['kind']): boolean {
  return kind !== 'column' && kind !== 'arrow'
}

/** The column under a point on the board, the topmost when two overlap; never the card being moved itself. */
export function columnAt(p: { x: number; y: number }, columns: readonly ColumnBox[], movingId: string): string | null {
  let best: ColumnBox | null = null
  for (const c of columns) {
    if (c.id === movingId) continue
    if (p.x < c.x || p.x > c.x + c.w || p.y < c.y || p.y > c.y + c.h) continue
    if (!best || c.z > best.z) best = c
  }
  return best?.id ?? null
}

/** Where in a column a drop lands: before the first card whose middle is below the point, else at the end. */
export function dropIndex(y: number, children: readonly { top: number; bottom: number }[]): number {
  const i = children.findIndex(c => y < (c.top + c.bottom) / 2)
  return i === -1 ? children.length : i
}

/** The cards in a column, in its order. */
export function columnChildren<T extends Pick<CanvasCard, 'id' | 'col' | 'ord' | 'y'>>(cards: readonly T[], columnId: string): T[] {
  return cards.filter(c => c.col === columnId).sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0) || a.y - b.y)
}

/**
 * Put `movingId` into `columnId` at `index` (counted among the column's OTHER cards). Returns every card whose place
 * changed — the moved one and any sibling renumbered — so only those are saved.
 */
export function placeInColumn(cards: readonly CanvasCard[], movingId: string, columnId: string, index: number): CanvasCard[] {
  const moving = cards.find(c => c.id === movingId)
  if (!moving || !fitsInColumn(moving.kind) || movingId === columnId) return []
  const others = columnChildren(cards, columnId).filter(c => c.id !== movingId)
  const at = Math.max(0, Math.min(index, others.length))
  const order = [...others.slice(0, at), moving, ...others.slice(at)]
  const changed: CanvasCard[] = []
  order.forEach((c, i) => {
    if (c.id === movingId) changed.push({ ...c, col: columnId, ord: i })
    else if (c.ord !== i) changed.push({ ...c, ord: i })
  })
  return changed
}

/** Take a card out of its column and leave it on the board at (x, y). */
export function takeOutOfColumn(card: CanvasCard, x: number, y: number, z: number): CanvasCard {
  const { col: _col, ord: _ord, ...rest } = card
  void _col; void _ord
  return { ...rest, x, y, z }
}

/** A new column, as Milanote makes one: titled "New Column", empty, a column's width. */
export const NEW_COLUMN = { kind: 'column' as const, name: 'New Column', w: 300 }

/** Milanote's column colours (from its colour menu and the boards in the snapshot): none first, then the palette */
export const COLUMN_COLOURS: readonly { name: string; hex: string | undefined }[] = [
  { name: 'None', hex: undefined },
  { name: 'Grey', hex: '#9b9b9b' },
  { name: 'Brown', hex: '#4b3832' },
  { name: 'Red', hex: '#e2574c' },
  { name: 'Orange', hex: '#f0912b' },
  { name: 'Yellow', hex: '#f5cf3d' },
  { name: 'Green', hex: '#5cb85c' },
  { name: 'Teal', hex: '#3fb6b0' },
  { name: 'Blue', hex: '#4a90e2' },
  { name: 'Purple', hex: '#8e6bd6' },
  { name: 'Pink', hex: '#d957c9' },
  { name: 'Black', hex: '#2b2b2b' },
]
