import type { CanvasCard } from './batch-brief-core'

/**
 * THE SHOOT BRIEF, ON PAPER (Renee, 25 Nov 2026: "the shoot brief needs to be printable … im gonna try print this
 * today" — the Alia event brief, whose whole plan is its board: 16 columns, a beat table and 76 pictures. The plan
 * PDF carries the nine fields and none of the board, so it printed a page of dress code and props.)
 *
 * A board is a wall, and a wall does not fit a page: shrunk to A4 its words are too small to read. So the board is
 * READ INTO A DOCUMENT instead, in the order a person reads it:
 *
 *   - each COLUMN is a section, its cards in their own order; columns are read down each lane, lanes left to right;
 *   - a card lying loose on the board goes with the column it sits BESIDE — the nearest one to its left that starts
 *     at or above it (a column's reference pictures are laid out to its right, down to the next column below). A
 *     loose card hard up against a column on its RIGHT is that column's opening line instead;
 *   - a board tile (a board inside the board) follows the section it sits with, as a section of its own;
 *   - what sits beside no column opens the document.
 *
 * Pure: no I/O, nothing drawn. `ShootPrintSheet` draws what this returns.
 */

export type PrintBlock =
  | { kind: 'words'; id: string; text: string; html?: string; label?: boolean }
  | { kind: 'picture'; id: string; url: string; caption?: string }
  | { kind: 'post'; id: string; thumb?: string; author?: string; words?: string; link?: string; platform?: string }
  | { kind: 'table'; id: string; rows: string[][]; header: boolean }
  | { kind: 'todo'; id: string; name?: string; items: { text: string; done: boolean }[] }
  | { kind: 'link'; id: string; url: string; title?: string }
  | { kind: 'file'; id: string; name: string; url: string }

export type PrintSection = {
  id: string
  title: string
  /** 0 = the shoot's own board; 1 = a board inside it; and so on */
  depth: number
  /** words, tables, to-dos, links — read top to bottom */
  blocks: PrintBlock[]
  /** pictures and posts — drawn as a grid under the words */
  pictures: PrintBlock[]
}

/** how far below a column's top a card may start and still be "at or above" it */
const ABOVE_SLACK = 64
/** columns whose left edges are this close are one lane */
const LANE = 150
/** a loose card this close to a column on its right is that column's opening line */
const RIGHT_GAP = 100
/** cards within this much of each other vertically are one row when read left to right */
const ROW = 150

const DEFAULT_W = 240
const widthOf = (c: CanvasCard) => (Number.isFinite(c.w) && c.w > 0 ? c.w : DEFAULT_W)

function reading(a: CanvasCard, b: CanvasCard, originY = 0): number {
  const ra = Math.floor((a.y - originY) / ROW), rb = Math.floor((b.y - originY) / ROW)
  return ra - rb || a.x - b.x || a.y - b.y
}

/**
 * COLUMNS, LANE BY LANE. A brief's columns are stacked down the board in lanes — VID 1 to VID 4 down the left, VID 5
 * to VID 9 down the next, the interviews off to the right — so they are read down each lane, lanes left to right. A
 * plain row of columns is one lane each, which is left to right as well.
 */
export function byLane(columns: readonly CanvasCard[]): CanvasCard[] {
  const sorted = [...columns].sort((a, b) => a.x - b.x || a.y - b.y)
  const lanes: CanvasCard[][] = []
  for (const c of sorted) {
    const lane = lanes[lanes.length - 1]
    if (lane && c.x - lane[0].x <= LANE) lane.push(c)
    else lanes.push([c])
  }
  return lanes.flatMap(l => l.sort((a, b) => a.y - b.y || a.x - b.x))
}

/** One card as what is printed for it, or null for a card paper cannot carry (an arrow, an empty note). */
export function printBlock(c: CanvasCard): PrintBlock | null {
  switch (c.kind) {
    case 'note':
    case 'label':
    case 'document': {
      const text = String(c.text ?? '').trim()
      const html = typeof c.html === 'string' && c.html.trim() ? c.html : undefined
      if (!text && !html) return null
      return { kind: 'words', id: c.id, text, ...(html ? { html } : {}), ...(c.kind === 'label' ? { label: true } : {}) }
    }
    case 'image':
      return c.url ? { kind: 'picture', id: c.id, url: c.url, ...(c.caption?.trim() ? { caption: c.caption.trim() } : {}) } : null
    case 'mockup': {
      const thumb = c.url || c.urls?.[0] || c.preview?.thumb || undefined
      const words = String(c.text ?? c.preview?.title ?? '').trim() || undefined
      const link = c.link_url?.trim() || undefined
      if (!thumb && !words && !link) return null
      return { kind: 'post', id: c.id, ...(thumb ? { thumb } : {}), ...(c.preview?.author ? { author: c.preview.author } : {}),
        ...(words ? { words } : {}), ...(link ? { link } : {}), ...(c.platform ? { platform: c.platform } : {}) }
    }
    case 'link': {
      if (!c.url) return null
      if (c.thumb) {
        return { kind: 'post', id: c.id, thumb: c.thumb, ...(c.author ? { author: c.author } : {}),
          ...(String(c.title ?? c.caption ?? '').trim() ? { words: String(c.title ?? c.caption).trim() } : {}), link: c.url }
      }
      return { kind: 'link', id: c.id, url: c.url, ...(c.title?.trim() ? { title: c.title.trim() } : {}) }
    }
    case 'table': {
      const rows = (Array.isArray(c.rows) ? c.rows : []).filter(r => Array.isArray(r) && r.length > 0)
      return rows.length > 0 ? { kind: 'table', id: c.id, rows, header: c.header === true } : null
    }
    case 'todo': {
      const items = (c.items ?? []).filter(i => String(i.text ?? '').trim()).map(i => ({ text: String(i.text).trim(), done: i.done === true }))
      if (items.length === 0 && !c.name?.trim()) return null
      return { kind: 'todo', id: c.id, ...(c.name?.trim() ? { name: c.name.trim() } : {}), items }
    }
    case 'file':
      return c.file?.url ? { kind: 'file', id: c.id, name: c.file.name || 'File', url: c.file.url } : null
    default:
      return null // arrow, swatch, boardlink, column, board: not a block of their own
  }
}

const isPicture = (b: PrintBlock) => b.kind === 'picture' || b.kind === 'post'

/**
 * The column a loose card sits beside, or null. See the rule at the top of this file.
 */
export function columnBeside(card: CanvasCard, columns: readonly CanvasCard[]): { column: CanvasCard; side: 'left' | 'right' } | null {
  const cw = widthOf(card)
  const left = columns.filter(col => col.x <= card.x && col.y <= card.y + ABOVE_SLACK)
  let best: CanvasCard | null = null
  if (left.length > 0) {
    const laneX = Math.max(...left.map(c => c.x))
    const lane = left.filter(c => laneX - c.x <= LANE)
    best = lane.reduce((a, b) => (b.y > a.y ? b : a))
  }
  // hard up against a column on the right, level with it: that column's opening line
  const right = columns
    .filter(col => col.x >= card.x + cw - 8 && col.x - (card.x + cw) <= RIGHT_GAP && Math.abs(col.y - card.y) <= ROW)
    .sort((a, b) => a.x - b.x)[0]
  if (right) {
    const gapLeft = best ? card.x - (best.x + widthOf(best)) : Infinity
    if (right.x - (card.x + cw) < gapLeft) return { column: right, side: 'right' }
  }
  return best ? { column: best, side: 'left' } : null
}

/**
 * The whole board as sections, in reading order. `boardName` titles what sits beside no column.
 */
export function printSections(cards: readonly CanvasCard[], boardName = 'On the board'): PrintSection[] {
  const ids = new Set(cards.map(c => c.id))
  const out: PrintSection[] = []
  const seen = new Set<string>()

  const level = (parent: string | null, depth: number, title: string) => {
    const here = cards.filter(c => (parent === null ? !c.parent || !ids.has(c.parent) : c.parent === parent) && c.kind !== 'arrow')
    const columns = byLane(here.filter(c => c.kind === 'column'))
    const colIds = new Set(columns.map(c => c.id))
    const inside = (id: string) => here.filter(c => c.col === id).sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0) || a.y - b.y)
    const loose = here.filter(c => c.kind !== 'column' && (!c.col || !colIds.has(c.col)))

    const opening = new Map<string, CanvasCard[]>()
    const beside = new Map<string, CanvasCard[]>()
    const alone: CanvasCard[] = []
    for (const c of loose) {
      const at = columnBeside(c, columns)
      if (!at) { alone.push(c); continue }
      const into = at.side === 'right' ? opening : beside
      into.set(at.column.id, [...(into.get(at.column.id) ?? []), c])
    }

    const section = (id: string, name: string, list: CanvasCard[], tiles: CanvasCard[]) => {
      const blocks: PrintBlock[] = []
      const pictures: PrintBlock[] = []
      for (const c of list) {
        if (c.kind === 'board') { tiles.push(c); continue }
        const b = printBlock(c)
        if (!b) continue
        ;(isPicture(b) ? pictures : blocks).push(b)
      }
      if (blocks.length > 0 || pictures.length > 0) out.push({ id, title: name, depth, blocks, pictures })
    }
    const openTiles = (tiles: CanvasCard[]) => {
      for (const t of tiles.sort((a, b) => reading(a, b))) {
        if (seen.has(t.id)) continue
        seen.add(t.id)
        level(t.id, depth + 1, t.name?.trim() || 'Board')
      }
    }

    // what sits beside no column opens this board
    const firstTiles: CanvasCard[] = []
    section(`${parent ?? 'top'}:alone`, title, alone.sort((a, b) => reading(a, b)), firstTiles)
    openTiles(firstTiles)

    for (const col of columns) {
      const tiles: CanvasCard[] = []
      const list = [
        ...(opening.get(col.id) ?? []).sort((a, b) => reading(a, b)),
        ...inside(col.id),
        ...(beside.get(col.id) ?? []).sort((a, b) => reading(a, b, col.y)),
      ]
      section(col.id, col.name?.trim() || 'Untitled column', list, tiles)
      openTiles(tiles)
    }
  }

  level(null, 0, boardName)
  return out
}

/** What the sheet says it holds, for the button's own line: "16 sections · 76 pictures". */
export function printCounts(sections: readonly PrintSection[]): { sections: number; pictures: number } {
  return { sections: sections.length, pictures: sections.reduce((n, s) => n + s.pictures.length, 0) }
}

/* ── THE BOARD AS IT LOOKS (Renee, 25 Nov 2026, after printing the document: "we need it to be landscape … and
 *    similar to the one on screen too") — the wall itself on one sheet, shrunk to fit, beside the document above. ── */

export type PrintBox = { x: number; y: number; w: number; h: number }

/** The box around every card on the board; null for an empty board. */
export function boardBounds(boxes: readonly PrintBox[]): PrintBox | null {
  if (boxes.length === 0) return null
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y))
  const r = Math.max(...boxes.map(b => b.x + b.w)), bt = Math.max(...boxes.map(b => b.y + b.h))
  return { x, y, w: r - x, h: bt - y }
}

/** a board of three cards is not blown up to fill the sheet */
const MAX_PRINT_SCALE = 2

/** How much the board is shrunk to fit the page, and where its top-left corner lands so it sits in the middle. */
export function fitBoardToPage(board: PrintBox, page: { w: number; h: number }): { scale: number; left: number; top: number } {
  const scale = Math.min(page.w / Math.max(board.w, 1), page.h / Math.max(board.h, 1), MAX_PRINT_SCALE)
  return { scale, left: (page.w - board.w * scale) / 2, top: (page.h - board.h * scale) / 2 }
}
