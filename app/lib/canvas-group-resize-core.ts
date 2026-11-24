/**
 * RESIZE A BUNCH OF CARDS TOGETHER — the pure half (Renee, 24 Nov 2026: "an option to select a bunch of items and
 * resize, now we can select all to move but not resize").
 *
 * The picked cards grow or shrink as ONE PICTURE: every card by the same factor, and the gaps between them with it,
 * measured from the top-left corner of the box around them. That is what keeps a laid-out moodboard laid out — a
 * resize that changed each card's size but left them where they were would pile them up or scatter them.
 *
 *   • a card that owns a height (a picture, a note somebody stretched) scales both ways;
 *   • a card whose height follows its words only changes width — its height stays its content's, never a number;
 *   • a line joining two cards is left alone: it follows its cards. A line drawn on its own, picked with the cards,
 *     is stretched with them;
 *   • a card inside a column is left alone — the column places it, and sizes it;
 *   • the whole group stops at the first card that reaches its smallest size, so the group keeps its shape rather
 *     than some cards shrinking on while others have stopped.
 *
 * The words on a card do not change size (that is the toolbar's A− / A+), so a group of notes made much narrower
 * grows taller, and tightly packed notes can end up overlapping.
 */
import { CANVAS_SIZE_LIMITS, clampCardSize, minCardWidth, textSizeOf, type CanvasCard } from './batch-brief-core'

export type CardBox = { w: number; h: number }
export type GroupBox = { x: number; y: number; w: number; h: number }

/** Biggest a group may be made in one pull — far past any real need, and well inside the sanitiser's own limits. */
const MAX_FACTOR = 8

/** the cards a group resize moves and sizes: not lines, not cards a column places */
const sizable = (c: CanvasCard) => c.kind !== 'arrow' && !c.col
/** a line drawn on its own — its ends are points on the board, not cards */
const freeLine = (c: CanvasCard) => c.kind === 'arrow' && !c.from && !c.to && !!c.line

const wordsOf = (c: CanvasCard) => (c.kind === 'todo' || c.kind === 'board' ? c.name : c.text)

/** The box around the picked cards, by their sizes AS DRAWN (`drawn`: measured from the page — a note's height is
 *  its words', which no stored number says). Null when nothing picked can be resized. */
export function groupBoxOf(cards: readonly CanvasCard[], drawn: ReadonlyMap<string, CardBox>): GroupBox | null {
  const own = cards.filter(sizable)
  if (own.length === 0) return null
  const x = Math.min(...own.map(c => c.x))
  const y = Math.min(...own.map(c => c.y))
  const right = Math.max(...own.map(c => c.x + (drawn.get(c.id)?.w ?? c.w)))
  const bottom = Math.max(...own.map(c => c.y + (drawn.get(c.id)?.h ?? c.h ?? 0)))
  return { x, y, w: right - x, h: bottom - y }
}

/** How small and how big the group may go: it stops at the first card to reach its own smallest size. */
export function groupScaleRange(cards: readonly CanvasCard[], drawn: ReadonlyMap<string, CardBox>): { min: number; max: number } {
  let min = 0.05
  for (const c of cards.filter(sizable)) {
    const lim = CANVAS_SIZE_LIMITS[c.kind]
    min = Math.max(min, Math.min(1, minCardWidth(c.kind, wordsOf(c), textSizeOf(c)) / Math.max(1, c.w)))
    if (c.h !== undefined && lim.minH !== null) min = Math.max(min, Math.min(1, lim.minH / Math.max(1, c.h)))
  }
  void drawn
  return { min, max: MAX_FACTOR }
}

/**
 * The picked cards at `factor` times their size, from the top-left of the box around them. Only the cards that
 * changed come back, ready to save.
 */
export function scaleGroup(cards: readonly CanvasCard[], drawn: ReadonlyMap<string, CardBox>, factor: number): CanvasCard[] {
  const box = groupBoxOf(cards, drawn)
  if (!box || !Number.isFinite(factor)) return []
  const range = groupScaleRange(cards, drawn)
  const f = Math.min(range.max, Math.max(range.min, factor))
  if (f === 1) return []
  const px = (v: number) => Math.round(box.x + (v - box.x) * f)
  const py = (v: number) => Math.round(box.y + (v - box.y) * f)
  const out: CanvasCard[] = []
  for (const c of cards) {
    if (freeLine(c)) {
      const l = c.line!
      const sx = (v: number | undefined) => (v === undefined ? undefined : px(v))
      const sy = (v: number | undefined) => (v === undefined ? undefined : py(v))
      out.push({ ...c, line: { ...l, fx: sx(l.fx), fy: sy(l.fy), tx: sx(l.tx), ty: sy(l.ty), cx: sx(l.cx), cy: sy(l.cy) } })
      continue
    }
    if (!sizable(c)) continue
    const size = clampCardSize(c.kind, c.w * f, c.h === undefined ? undefined : c.h * f)
    const { h: _old, ...rest } = c
    void _old
    const next: CanvasCard = { ...rest, x: px(c.x), y: py(c.y), w: size.w, ...(size.h !== undefined ? { h: size.h } : {}) }
    if (next.x !== c.x || next.y !== c.y || next.w !== c.w || next.h !== c.h) out.push(next)
  }
  return out
}

/** PLUS AND MINUS (the owner, 25 Nov 2026: "when selecting all should just be plus or minus so it resizes"): one
 *  press of the toolbar's + makes the picked cards a quarter bigger; − is its exact undo. */
export function groupStepFactor(dir: 1 | -1): number {
  return dir === 1 ? 1.25 : 0.8
}
