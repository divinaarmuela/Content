/**
 * COPY AND PASTE CARDS — the pure half (Renee, 24 Nov 2026: "copy paste function on shoot brief doesn't work … would
 * be good to select and copy then paste"; the owner, the same day: a board tile brings what is inside it).
 *
 * Pick cards, Ctrl+C, then Ctrl+V on the same board, a board inside it, another shoot's brief or a team board — they
 * are all the same canvas and the same card shape. The copy rides the system clipboard under our own type, so it
 * outlives the page it was made on; other apps are handed the cards' words as plain text.
 *
 *   • a board tile is copied with everything inside it, to any depth;
 *   • a column is copied with the cards in it;
 *   • a line is copied only when every card it joins is copied too — a line to nowhere is noise, and the server
 *     would drop it anyway (applyCanvasOp);
 *   • every copy gets a new id, so nothing pasted can ever write over the original.
 *
 * Uploaded pictures and files are not duplicated: the copy points at the same stored file, exactly as Duplicate
 * always has. Comments stay with the original card.
 */
import { CANVAS_MAX_CARDS, sanitiseCanvasCards, type CanvasCard } from './batch-brief-core'
import { descendantsOf } from './shoot-board-core'

/** the clipboard type the copy travels under — ours, so nothing else mistakes it for text */
export const COPY_MIME = 'application/x-mdm-canvas-cards'

export type CopiedCards = { from: string; cards: CanvasCard[] }

/** The cards a copy of `ids` takes, in the board's own order. */
export function cardsToCopy(cards: readonly CanvasCard[], ids: readonly string[]): CanvasCard[] {
  const byId = new Map(cards.map(c => [c.id, c]))
  const take = new Set<string>()
  const queue = ids.filter(id => byId.has(id) && byId.get(id)!.kind !== 'arrow')
  while (queue.length) {
    const id = queue.pop()!
    if (take.has(id)) continue
    take.add(id)
    const card = byId.get(id)!
    // a board is its contents; a column is the cards in it (which may themselves be boards)
    if (card.kind === 'board') for (const d of descendantsOf(cards, id)) if (byId.get(d)?.kind !== 'arrow') queue.push(d)
    if (card.kind === 'column') for (const c of cards) if (c.col === id) queue.push(c.id)
  }
  const picked = new Set(ids)
  for (const c of cards) {
    if (c.kind !== 'arrow') continue
    const joined = [c.from, c.to].filter((e): e is string => !!e)
    if (!joined.every(e => take.has(e))) continue
    // a line between copied cards comes along; a line drawn on its own only when it was picked, or is inside a
    // copied board
    if (joined.length > 0 || picked.has(c.id) || (c.parent && take.has(c.parent))) take.add(c.id)
  }
  return cards.filter(c => take.has(c.id))
}

/** What the clipboard holds. `from` is where the copy was made — a paste in the same place steps aside. */
export function writeCopied(cards: readonly CanvasCard[], from: string): string {
  return JSON.stringify({ mdm: 'canvas-cards', v: 1, from, cards })
}

/** The cards on the clipboard, or null when it holds anything else. Everything read is put through the board's own
 *  sanitiser — the clipboard is outside the app, and what comes off it is not trusted. */
export function readCopied(raw: string | null | undefined): CopiedCards | null {
  if (!raw || raw[0] !== '{') return null
  let data: unknown
  try { data = JSON.parse(raw) } catch { return null }
  const d = data as { mdm?: unknown; v?: unknown; from?: unknown; cards?: unknown } | null
  if (!d || d.mdm !== 'canvas-cards' || d.v !== 1) return null
  const cards = sanitiseCanvasCards(d.cards)
  if (cards.length === 0) return null
  return { from: typeof d.from === 'string' ? d.from : '', cards }
}

/** What another app gets from the same copy: the words on the cards, one card a line. */
export function copiedWords(cards: readonly CanvasCard[]): string {
  return cards
    .filter(c => c.kind !== 'arrow')
    .map(c => (c.text || c.name || c.caption || c.url || '').trim())
    .filter(Boolean)
    .join('\n')
}

/** The cards that would land on the open board itself: the ones whose board was not copied with them. */
function topLevel(cards: readonly CanvasCard[]): CanvasCard[] {
  const ids = new Set(cards.map(c => c.id))
  return cards.filter(c => !c.parent || !ids.has(c.parent))
}

/** The top-left of a copy, as it would land: its loose cards; failing those, the ends of its own lines. */
export function copiedCorner(cards: readonly CanvasCard[]): { x: number; y: number } {
  const ids = new Set(cards.map(c => c.id))
  const top = topLevel(cards)
  const xs: number[] = []; const ys: number[] = []
  // a card in a copied column is placed by the column, not by its own x and y
  for (const c of top) if (c.kind !== 'arrow' && !(c.col && ids.has(c.col))) { xs.push(c.x); ys.push(c.y) }
  if (xs.length === 0) {
    for (const c of top) {
      const l = c.line
      if (l?.fx !== undefined && l.fy !== undefined) { xs.push(l.fx); ys.push(l.fy) }
      if (l?.tx !== undefined && l.ty !== undefined) { xs.push(l.tx); ys.push(l.ty) }
    }
  }
  return { x: xs.length ? Math.min(...xs) : 0, y: ys.length ? Math.min(...ys) : 0 }
}

/**
 * The cards a paste adds. `parent` is the board that is open (null = the top one), `at` where the copy's top-left
 * corner goes, `z` the highest card already there. `top` names the new cards that land on the open board, so the
 * canvas can leave them picked.
 */
export function pasteCards(
  copied: readonly CanvasCard[],
  opts: { parent: string | null; at: { x: number; y: number }; z: number; mint: () => string },
): { cards: CanvasCard[]; top: string[] } {
  const newId = new Map<string, string>()
  for (const c of copied) newId.set(c.id, opts.mint())
  const top = new Set(topLevel(copied).map(c => c.id))
  const corner = copiedCorner(copied)
  const dx = Math.round(opts.at.x - corner.x)
  const dy = Math.round(opts.at.y - corner.y)
  // the loose cards keep their stacking order, above everything already on the board
  const rank = new Map(
    copied.filter(c => top.has(c.id) && c.kind !== 'arrow').sort((a, b) => a.z - b.z).map((c, i) => [c.id, i + 1]),
  )
  const sh = (v: number | undefined, d: number) => (v === undefined ? undefined : Math.round(v + d))

  const cards = copied.map((c): CanvasCard => {
    const { parent, col, ord, from, to, ...rest } = c
    const next: CanvasCard = { ...rest, id: newId.get(c.id)! }
    if (from && newId.has(from)) next.from = newId.get(from)
    if (to && newId.has(to)) next.to = newId.get(to)
    // in its column only if the column came too
    if (col && newId.has(col)) { next.col = newId.get(col); if (ord !== undefined) next.ord = ord }
    if (!top.has(c.id)) {
      next.parent = newId.get(parent!)
      return next
    }
    if (opts.parent) next.parent = opts.parent
    next.x = c.x + dx
    next.y = c.y + dy
    if (c.kind === 'arrow') {
      if (c.line) next.line = { ...c.line, fx: sh(c.line.fx, dx), fy: sh(c.line.fy, dy), tx: sh(c.line.tx, dx), ty: sh(c.line.ty, dy), cx: sh(c.line.cx, dx), cy: sh(c.line.cy, dy) }
      next.x = c.x; next.y = c.y
    } else {
      next.z = opts.z + (rank.get(c.id) ?? 1)
    }
    return next
  })
  return { cards, top: cards.filter((_, i) => top.has(copied[i].id) && copied[i].kind !== 'arrow').map(c => c.id) }
}

/** Is there room? The board's limit is the whole tree's, and the server cuts what is over it without a word — so a
 *  paste that would not fit is refused whole, never saved in part. */
export function pasteFits(onBoard: number, adding: number): boolean {
  return onBoard + adding <= CANVAS_MAX_CARDS
}
