/**
 * The canvas's thinking, with no browser and no database in it.
 *
 * A board is a Milanote-style canvas: things sit where a person put them,
 * at the size they dragged them to, in the colour they picked. Everything
 * that decides WHERE and HOW BIG and WHAT COUNTS lives here as pure
 * functions — the grid, the minimum sizes, the colour tokens, the counts on
 * a board tile, the breadcrumbs, what a valid item is, what a keyboard
 * nudge does, and the little geometry of panning and zooming — so the
 * React side is only pointer events in and PATCHes out, and every rule can
 * be failed by a test rather than by a person.
 *
 * Nothing here imports anything.
 */

/* ── kinds ──────────────────────────────────────────────────────────────── */

export const ITEM_KINDS = ['note', 'image', 'link', 'board', 'heading', 'column'] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

export function isItemKind(v: unknown): v is ItemKind {
  return typeof v === 'string' && (ITEM_KINDS as readonly string[]).includes(v)
}

/** What each kind is called on a button and in a sentence. */
export const KIND_LABEL: Record<ItemKind, string> = {
  note: 'Note', image: 'Image', link: 'Link', board: 'Board', heading: 'Heading', column: 'Column',
}

/* ── the grid and sizes ─────────────────────────────────────────────────── */

/** Items snap lightly to this — enough that two notes line up, not so much
 *  that a person fights it. Canvas units are pixels at zoom 1. */
export const GRID = 16

export type Size = { w: number; h: number }
export type Point = { x: number; y: number }
export type Rect = Point & Size

/** Where a new item lands by default. */
export const DEFAULT_SIZE: Record<ItemKind, Size> = {
  note: { w: 288, h: 176 },
  image: { w: 320, h: 240 },
  link: { w: 288, h: 96 },
  board: { w: 192, h: 192 },
  heading: { w: 960, h: 64 },
  column: { w: 320, h: 480 },
}

/** Nothing collapses to nothing: a note keeps room for a line of text, a
 *  board tile keeps its icon and count, a heading keeps its words. */
export const MIN_SIZE: Record<ItemKind, Size> = {
  note: { w: 160, h: 96 },
  image: { w: 96, h: 96 },
  link: { w: 192, h: 72 },
  board: { w: 144, h: 144 },
  heading: { w: 240, h: 48 },
  column: { w: 224, h: 240 },
}

/** The far edge of a canvas — big enough that nobody hits it, small enough
 *  that a mis-dragged item can be found again. */
export const CANVAS_EXTENT = 20_000

/** Snap a canvas coordinate to the grid. */
export function snap(v: number, grid = GRID): number {
  return Math.round(v / grid) * grid
}

/** Keep a coordinate on the canvas. Positions never go negative — the
 *  origin is the top-left a person pans to, and a hidden negative corner is
 *  where items went to be lost. */
export function clampPosition(p: Point): Point {
  return {
    x: Math.min(CANVAS_EXTENT, Math.max(0, p.x)),
    y: Math.min(CANVAS_EXTENT, Math.max(0, p.y)),
  }
}

/** A size no smaller than the kind's floor and no wider than the canvas. */
export function clampSize(kind: ItemKind, size: Size): Size {
  const min = MIN_SIZE[kind]
  return {
    w: Math.min(CANVAS_EXTENT, Math.max(min.w, size.w)),
    h: Math.min(CANVAS_EXTENT, Math.max(min.h, size.h)),
  }
}

/** Where an item ends up after a drag: snapped, on the canvas. */
export function moveTo(p: Point): Point {
  return clampPosition({ x: snap(p.x), y: snap(p.y) })
}

/** A resize by the corner: snapped, clamped to the kind's minimum. A heading
 *  spans the width it is dragged to and keeps it. */
export function resizeTo(kind: ItemKind, size: Size): Size {
  return clampSize(kind, { w: snap(size.w), h: snap(size.h) })
}

/** The keys that move a selected item, and by how much: a grid step, or
 *  five with shift held. Anything else is not a nudge. */
export function keyboardNudge(key: string, shift: boolean): Point | null {
  const step = shift ? GRID * 5 : GRID
  switch (key) {
    case 'ArrowLeft': return { x: -step, y: 0 }
    case 'ArrowRight': return { x: step, y: 0 }
    case 'ArrowUp': return { x: 0, y: -step }
    case 'ArrowDown': return { x: 0, y: step }
    default: return null
  }
}

/* ── colour ─────────────────────────────────────────────────────────────── */

/**
 * The swatch row. These are the restyle's own tokens — the tints that turn
 * into 18% overlays in dark mode — so a person picks from six that always
 * read, never from a wheel. The row is stored by NAME; the classes live in
 * the UI beside the other tone maps.
 */
export const CANVAS_COLOURS = ['surface', 'paper', 'blue', 'green', 'amber', 'red', 'ink'] as const
export type CanvasColour = (typeof CANVAS_COLOURS)[number]

export function isCanvasColour(v: unknown): v is CanvasColour {
  return typeof v === 'string' && (CANVAS_COLOURS as readonly string[]).includes(v)
}

/** What each kind wears when nobody chose. */
export const DEFAULT_COLOUR: Record<ItemKind, CanvasColour> = {
  note: 'surface', image: 'surface', link: 'surface', board: 'blue', heading: 'paper', column: 'paper',
}

/** A stored colour, or the kind's default when it is missing or unknown —
 *  a token that stopped existing must never leave an item unreadable. */
export function colourOf(kind: ItemKind, stored: string | null | undefined): CanvasColour {
  return isCanvasColour(stored) ? stored : DEFAULT_COLOUR[kind]
}

/** What a swatch is called when a screen reader lands on it. */
export const COLOUR_LABEL: Record<CanvasColour, string> = {
  surface: 'White', paper: 'Paper', blue: 'Blue', green: 'Green', amber: 'Amber', red: 'Red', ink: 'Ink',
}

/* ── board icons ────────────────────────────────────────────────────────── */

/** The icons a board tile can take. Names, not glyphs: the UI maps them to
 *  lucide icons so the tile is drawn in our line weight, not an emoji's. */
export const BOARD_ICONS = [
  'folder', 'camera', 'film', 'image', 'lightbulb', 'map-pin', 'users', 'star',
  'calendar', 'tag', 'shirt', 'sparkles',
] as const
export type BoardIcon = (typeof BOARD_ICONS)[number]

export const DEFAULT_ICON: BoardIcon = 'folder'

export function isBoardIcon(v: unknown): v is BoardIcon {
  return typeof v === 'string' && (BOARD_ICONS as readonly string[]).includes(v)
}

export function iconOf(stored: string | null | undefined): BoardIcon {
  return isBoardIcon(stored) ? stored : DEFAULT_ICON
}

/* ── the rows, as the core sees them ───────────────────────────────────── */

export type CanvasItem = {
  id: string
  board_id: string
  kind: ItemKind
  x: number
  y: number
  w: number
  h: number
  z: number
  colour: string | null
  text: string | null
  url: string | null
  label: string | null
  child_board_id: string | null
  column_title: string | null
  parent_item_id: string | null
}

export type CanvasBoard = {
  id: string
  client_id: string
  parent_board_id: string | null
  item_id: string | null
  name: string
  icon: string
  colour: string
}

/* ── z order ────────────────────────────────────────────────────────────── */

export function nextZ(items: readonly { z: number }[]): number {
  return items.reduce((m, i) => Math.max(m, i.z), 0) + 1
}

/** Draw order: lowest z first, so the last thing touched is on top. A column
 *  always sits under what is in it, whatever its z says. */
export function drawOrder<T extends { z: number; kind: ItemKind }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const ca = a.kind === 'column' ? 0 : 1
    const cb = b.kind === 'column' ? 0 : 1
    return ca - cb || a.z - b.z
  })
}

/* ── placing a new item ─────────────────────────────────────────────────── */

/** Where a new item lands: the point asked for, snapped, at the kind's
 *  default size, on top of everything already there. */
export function placeNew(
  kind: ItemKind, at: Point, existing: readonly { z: number }[],
): Rect & { z: number } {
  const p = moveTo(at)
  return { ...p, ...DEFAULT_SIZE[kind], z: nextZ(existing) }
}

/** The centre of the view in canvas units — where a button-made item goes,
 *  so it appears in front of the person and not at (0,0) off screen. */
export function viewCentre(view: View, viewport: Size): Point {
  return screenToCanvas(view, { x: viewport.w / 2, y: viewport.h / 2 })
}

/* ── pan and zoom ───────────────────────────────────────────────────────── */

export type View = { panX: number; panY: number; zoom: number }
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 2
export const ZOOM_STEP = 1.2
export const DEFAULT_VIEW: View = { panX: 0, panY: 0, zoom: 1 }

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
}

/** screen = canvas × zoom + pan */
export function canvasToScreen(view: View, p: Point): Point {
  return { x: p.x * view.zoom + view.panX, y: p.y * view.zoom + view.panY }
}

export function screenToCanvas(view: View, p: Point): Point {
  return { x: (p.x - view.panX) / view.zoom, y: (p.y - view.panY) / view.zoom }
}

/** Zoom about a screen point, so the thing under the cursor stays under the
 *  cursor. `factor` > 1 zooms in. */
export function zoomAt(view: View, factor: number, at: Point): View {
  const zoom = clampZoom(view.zoom * factor)
  if (zoom === view.zoom) return view
  const before = screenToCanvas(view, at)
  return {
    zoom,
    panX: at.x - before.x * zoom,
    panY: at.y - before.y * zoom,
  }
}

export function panBy(view: View, d: Point): View {
  return { ...view, panX: view.panX + d.x, panY: view.panY + d.y }
}

/** A zoom level as a person reads it. */
export function zoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}

/** The view that shows everything on the board, with a margin, no closer
 *  than 1:1. An empty board is the default view. */
export function fitAll(items: readonly Rect[], viewport: Size, margin = 48): View {
  if (!items.length) return DEFAULT_VIEW
  const minX = Math.min(...items.map(i => i.x))
  const minY = Math.min(...items.map(i => i.y))
  const maxX = Math.max(...items.map(i => i.x + i.w))
  const maxY = Math.max(...items.map(i => i.y + i.h))
  const w = maxX - minX + margin * 2
  const h = maxY - minY + margin * 2
  const zoom = clampZoom(Math.min(1, viewport.w / w, viewport.h / h))
  return {
    zoom,
    panX: (viewport.w - (maxX - minX) * zoom) / 2 - minX * zoom,
    panY: (viewport.h - (maxY - minY) * zoom) / 2 - minY * zoom,
  }
}

/* ── columns: the seam the work board hangs off ────────────────────────── */

/** Inside a column, items stack under its title with this rhythm. */
export const COLUMN_HEADER = 56
export const COLUMN_GAP = 12
export const COLUMN_PAD = 12

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

export function centreOf(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/** The column an item was dropped on: the one whose rectangle holds the
 *  item's centre. Topmost wins when columns overlap. A column is never
 *  inside a column. */
export function columnUnder<T extends CanvasItem>(item: Rect & { kind: ItemKind }, items: readonly T[]): T | null {
  if (item.kind === 'column') return null
  const c = centreOf(item)
  const hits = items.filter(i => i.kind === 'column' && pointInRect(c, i))
  if (!hits.length) return null
  return hits.reduce((top, i) => (i.z > top.z ? i : top))
}

/** The items that belong to a column, in the order they are stacked. */
export function itemsInColumn<T extends CanvasItem>(column: { id: string }, items: readonly T[]): T[] {
  return items.filter(i => i.parent_item_id === column.id).sort((a, b) => a.y - b.y || a.z - b.z)
}

/**
 * Lay a column's members out as a stack: full width inside the padding, one
 * under the next, the column grown to hold them. Returns only what changed,
 * so a caller writes the smallest patch — and nothing at all when the
 * stack was already right.
 */
export function stackInColumn<T extends CanvasItem>(
  column: T, members: readonly T[],
): { column: Partial<T> & { id: string }; items: (Partial<T> & { id: string })[] } {
  const innerW = Math.max(MIN_SIZE.note.w, column.w - COLUMN_PAD * 2)
  let y = column.y + COLUMN_HEADER
  const items: (Partial<T> & { id: string })[] = []
  for (const m of members) {
    const h = Math.max(MIN_SIZE[m.kind].h, m.h)
    const next = { x: column.x + COLUMN_PAD, y, w: innerW, h, parent_item_id: column.id }
    const changed: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(next)) {
      if ((m as unknown as Record<string, unknown>)[k] !== v) changed[k] = v
    }
    if (Object.keys(changed).length) items.push({ id: m.id, ...(changed as Partial<T>) })
    y += h + COLUMN_GAP
  }
  const needed = Math.max(MIN_SIZE.column.h, y - column.y + COLUMN_PAD)
  const col = { id: column.id } as Partial<T> & { id: string }
  if (needed > column.h) (col as Record<string, unknown>).h = snap(needed + GRID - 1)
  return { column: col, items }
}

/** Moving a column carries its stack with it. */
export function carryStack<T extends CanvasItem>(
  column: T, to: Point, members: readonly T[],
): (Partial<T> & { id: string })[] {
  const dx = to.x - column.x
  const dy = to.y - column.y
  if (!dx && !dy) return []
  return members.map(m => ({ id: m.id, x: m.x + dx, y: m.y + dy } as Partial<T> & { id: string }))
}

/* ── counts and breadcrumbs ─────────────────────────────────────────────── */

export type Inside = { cards: number; boards: number }

/** What a board holds, one level down: cards are everything that is not a
 *  board tile or a column; boards are the tiles. */
export function countInside(boardId: string, items: readonly { board_id: string; kind: string }[]): Inside {
  let cards = 0
  let boards = 0
  for (const i of items) {
    if (i.board_id !== boardId) continue
    if (i.kind === 'board') boards += 1
    else if (i.kind !== 'column') cards += 1
  }
  return { cards, boards }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "39 cards", "3 boards", "39 cards · 3 boards", "Empty". */
export function countLabel(inside: Inside): string {
  const parts: string[] = []
  if (inside.cards) parts.push(plural(inside.cards, 'card', 'cards'))
  if (inside.boards) parts.push(plural(inside.boards, 'board', 'boards'))
  return parts.length ? parts.join(' · ') : 'Empty'
}

export type Crumb = { id: string; name: string }

/** Root first, this board last. A cycle in the data (a board that is its
 *  own ancestor) stops the walk rather than the page. */
export function breadcrumbs(
  boardId: string, boards: readonly Pick<CanvasBoard, 'id' | 'name' | 'parent_board_id'>[],
): Crumb[] {
  const byId = new Map(boards.map(b => [b.id, b]))
  const trail: Crumb[] = []
  const seen = new Set<string>()
  let cur = byId.get(boardId)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    trail.unshift({ id: cur.id, name: cur.name })
    cur = cur.parent_board_id ? byId.get(cur.parent_board_id) : undefined
  }
  return trail
}

/** Every board under this one, at any depth — what deleting it takes with it. */
export function descendantBoardIds(
  boardId: string, boards: readonly Pick<CanvasBoard, 'id' | 'parent_board_id'>[],
): string[] {
  const out: string[] = []
  const queue = [boardId]
  const seen = new Set<string>([boardId])
  while (queue.length) {
    const id = queue.shift()!
    for (const b of boards) {
      if (b.parent_board_id === id && !seen.has(b.id)) { seen.add(b.id); out.push(b.id); queue.push(b.id) }
    }
  }
  return out
}

/* ── links ──────────────────────────────────────────────────────────────── */

/** Only http(s) goes on a canvas: `javascript:` and friends are not links. */
export function isSafeUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2048) return false
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

export type LinkService = 'drive' | 'dropbox' | 'other'

/** Where a pasted link points. A Drive link is read as a link and nothing
 *  more — the app never writes to Drive (trap 13). */
export function linkService(url: string): LinkService {
  let host = ''
  try { host = new URL(url).hostname.toLowerCase() } catch { return 'other' }
  if (host === 'drive.google.com' || host === 'docs.google.com' || host.endsWith('.google.com') && host.startsWith('drive')) return 'drive'
  if (host === 'dropbox.com' || host.endsWith('.dropbox.com')) return 'dropbox'
  return 'other'
}

export const SERVICE_LABEL: Record<LinkService, string> = {
  drive: 'Google Drive', dropbox: 'Dropbox', other: 'Link',
}

/** The label a link shows when the person did not type one. */
export function defaultLinkLabel(url: string): string {
  const service = linkService(url)
  if (service !== 'other') return SERVICE_LABEL[service]
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'Link' }
}

/* ── rich text ──────────────────────────────────────────────────────────── */

/**
 * A note is a heading, bold, bullets and a highlight — Milanote's
 * workhorse, and nothing more. The editor produces HTML; this keeps only
 * those tags, drops every attribute, and closes what it keeps, so what is
 * stored can be rendered without a second thought. Text is escaped on the
 * way through.
 */
const ALLOWED_TAGS = new Set(['h3', 'p', 'br', 'b', 'strong', 'ul', 'li', 'mark', 'div', 'i', 'em'])
const VOID_TAGS = new Set(['br'])

export function sanitizeRichText(html: string): string {
  const out: string[] = []
  const open: string[] = []
  const re = /<\/?([a-zA-Z0-9]+)[^>]*>|[^<]+|</g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const tok = m[0]
    if (tok === '<') { out.push('&lt;'); continue }
    if (tok[0] !== '<') { out.push(escapeText(tok)); continue }
    const name = m[1].toLowerCase()
    const closing = tok[1] === '/'
    if (!ALLOWED_TAGS.has(name)) continue
    if (VOID_TAGS.has(name)) { out.push('<br>'); continue }
    if (closing) {
      const at = open.lastIndexOf(name)
      if (at === -1) continue
      // close everything opened after it, then it
      while (open.length > at) out.push(`</${open.pop()}>`)
    } else {
      open.push(name)
      out.push(`<${name}>`)
    }
  }
  while (open.length) out.push(`</${open.pop()}>`)
  return out.join('')
}

function escapeText(s: string): string {
  // entities that arrived as entities stay as they are
  return s.replace(/&(?![a-zA-Z#0-9]+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The words of a note without its markup — for a count, a title, a search. */
export function plainText(html: string): string {
  return html
    .replace(/<\/(h3|p|li|div)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/* ── validation ─────────────────────────────────────────────────────────── */

export const MAX_TEXT = 20_000
export const MAX_LABEL = 120
export const MAX_NAME = 80

export type ItemInput = {
  kind: unknown
  x?: unknown; y?: unknown; w?: unknown; h?: unknown
  colour?: unknown
  text?: unknown
  url?: unknown
  label?: unknown
  child_board_id?: unknown
  column_title?: unknown
  parent_item_id?: unknown
}

export type ValidItem = {
  kind: ItemKind
  x: number; y: number; w: number; h: number
  colour: CanvasColour | null
  text: string | null
  url: string | null
  label: string | null
  child_board_id: string | null
  column_title: string | null
  parent_item_id: string | null
}

export type Validated = { ok: true; item: ValidItem } | { ok: false; reason: string }

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const idish = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : null)

/**
 * A new item, checked. Every failure is a sentence a person can act on —
 * it is what the button under the form will say.
 */
export function validateItem(input: ItemInput, at?: Point): Validated {
  if (!isItemKind(input.kind)) return { ok: false, reason: 'Pick what to add: a note, an image, a link, a board, a heading or a column' }
  const kind = input.kind
  const pos = moveTo({ x: num(input.x, at?.x ?? 0), y: num(input.y, at?.y ?? 0) })
  const size = resizeTo(kind, {
    w: num(input.w, DEFAULT_SIZE[kind].w), h: num(input.h, DEFAULT_SIZE[kind].h),
  })
  const colour = input.colour == null || input.colour === '' ? null
    : isCanvasColour(input.colour) ? input.colour : DEFAULT_COLOUR[kind]
  const base: ValidItem = {
    kind, ...pos, ...size, colour,
    text: null, url: null, label: null, child_board_id: null, column_title: null,
    parent_item_id: idish(input.parent_item_id),
  }
  switch (kind) {
    case 'note': {
      const text = typeof input.text === 'string' ? sanitizeRichText(input.text.slice(0, MAX_TEXT)) : ''
      return { ok: true, item: { ...base, text } }
    }
    case 'heading': {
      const text = str(input.text, MAX_LABEL)
      if (!text) return { ok: false, reason: 'Give the heading some words' }
      return { ok: true, item: { ...base, text } }
    }
    case 'column': {
      const title = str(input.column_title, MAX_LABEL)
      if (!title) return { ok: false, reason: 'Give the column a title' }
      return { ok: true, item: { ...base, column_title: title, parent_item_id: null } }
    }
    case 'image': {
      if (!isSafeUrl(input.url)) return { ok: false, reason: 'That image did not upload — try dropping it again' }
      return { ok: true, item: { ...base, url: input.url, label: str(input.label, MAX_LABEL) || null } }
    }
    case 'link': {
      if (!isSafeUrl(input.url)) return { ok: false, reason: 'Paste a full link, starting with https://' }
      const label = str(input.label, MAX_LABEL) || defaultLinkLabel(input.url)
      return { ok: true, item: { ...base, url: input.url, label } }
    }
    case 'board': {
      const child = idish(input.child_board_id)
      if (!child) return { ok: false, reason: 'That board does not exist yet' }
      return { ok: true, item: { ...base, child_board_id: child, label: str(input.label, MAX_NAME) || null } }
    }
  }
}

/**
 * A change to an item that already exists: only the fields that may move
 * after the fact, each cleaned. Position and size are snapped and clamped;
 * an unknown colour becomes the kind's default; a kind never changes.
 */
export function validatePatch(
  current: CanvasItem, patch: Record<string, unknown>,
): { ok: true; patch: Partial<CanvasItem> } | { ok: false; reason: string } {
  const out: Partial<CanvasItem> = {}
  const kind = current.kind
  if ('x' in patch || 'y' in patch) {
    const p = moveTo({ x: num(patch.x, current.x), y: num(patch.y, current.y) })
    out.x = p.x; out.y = p.y
  }
  if ('w' in patch || 'h' in patch) {
    const s = resizeTo(kind, { w: num(patch.w, current.w), h: num(patch.h, current.h) })
    out.w = s.w; out.h = s.h
  }
  if ('z' in patch) out.z = Math.max(0, Math.floor(num(patch.z, current.z)))
  if ('colour' in patch) out.colour = patch.colour == null ? null : colourOf(kind, patch.colour as string)
  if ('text' in patch) {
    if (kind === 'note') out.text = sanitizeRichText(String(patch.text ?? '').slice(0, MAX_TEXT))
    else if (kind === 'heading') {
      const t = str(patch.text, MAX_LABEL)
      if (!t) return { ok: false, reason: 'A heading needs some words' }
      out.text = t
    } else return { ok: false, reason: `A ${KIND_LABEL[kind].toLowerCase()} has no text to change` }
  }
  if ('label' in patch) {
    if (kind === 'note' || kind === 'heading' || kind === 'column') return { ok: false, reason: `A ${KIND_LABEL[kind].toLowerCase()} has no label` }
    out.label = str(patch.label, MAX_LABEL) || (kind === 'link' && current.url ? defaultLinkLabel(current.url) : null)
  }
  if ('url' in patch) {
    if (kind !== 'link' && kind !== 'image') return { ok: false, reason: `A ${KIND_LABEL[kind].toLowerCase()} has no link to change` }
    if (!isSafeUrl(patch.url)) return { ok: false, reason: 'Paste a full link, starting with https://' }
    out.url = patch.url
  }
  if ('column_title' in patch) {
    if (kind !== 'column') return { ok: false, reason: 'Only a column has a title' }
    const t = str(patch.column_title, MAX_LABEL)
    if (!t) return { ok: false, reason: 'A column needs a title' }
    out.column_title = t
  }
  if ('parent_item_id' in patch) {
    if (kind === 'column') return { ok: false, reason: 'A column cannot go inside a column' }
    out.parent_item_id = idish(patch.parent_item_id)
  }
  if (!Object.keys(out).length) return { ok: false, reason: 'Nothing to change' }
  return { ok: true, patch: out }
}

export type BoardInput = { name?: unknown; icon?: unknown; colour?: unknown }

/** A board's name, icon and colour, cleaned: a nameless board is refused,
 *  an unknown icon or colour falls back rather than failing. */
export function validateBoard(input: BoardInput): { ok: true; name: string; icon: BoardIcon; colour: CanvasColour } | { ok: false; reason: string } {
  const name = str(input.name, MAX_NAME)
  if (!name) return { ok: false, reason: 'Give the board a name' }
  return { ok: true, name, icon: iconOf(input.icon as string), colour: colourOf('board', input.colour as string) }
}

/* ── comments ───────────────────────────────────────────────────────────── */

export type CommentRole = 'client' | 'scheduler' | 'editor' | 'account_manager' | 'super_admin'

export type CanvasComment = {
  id: string
  board_id: string
  item_id: string
  author_id: string | null
  author_name: string
  author_role: string
  body: string
  created_at: string
  resolved_at: string | null
}

export const MAX_COMMENT = 4000

/**
 * Who reads which comments on a canvas item.
 *
 * A client's comment is for the account manager (the spec: the client is
 * talking to their manager, not to the room), so editors and schedulers
 * never see one. A client sees only what clients wrote — the team's own
 * notes to each other stay on the team's side.
 */
export function visibleCanvasComments<T extends Pick<CanvasComment, 'author_role'>>(
  role: CommentRole | string, comments: readonly T[],
): T[] {
  if (role === 'account_manager' || role === 'super_admin') return [...comments]
  if (role === 'client') return comments.filter(c => c.author_role === 'client')
  return comments.filter(c => c.author_role !== 'client')
}

/** A comment's words, cleaned; empty is refused with the reason to show. */
export function validateComment(body: unknown): { ok: true; body: string } | { ok: false; reason: string } {
  const text = str(body, MAX_COMMENT)
  if (!text) return { ok: false, reason: 'Write the comment first' }
  return { ok: true, body: text }
}

/** Newest last, so a panel reads like a conversation. */
export function commentsFor<T extends Pick<CanvasComment, 'item_id' | 'created_at'>>(itemId: string, comments: readonly T[]): T[] {
  return comments.filter(c => c.item_id === itemId).sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** "3 comments", "1 comment", "" — what the control on an item says. */
export function commentCountLabel(n: number): string {
  return n ? plural(n, 'comment', 'comments') : ''
}

/** When a comment was left, as a person says it, relative to `now`. */
export function whenLabel(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const mins = Math.round((now.getTime() - t) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  return new Date(t).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

/* ── the board behind a card ───────────────────────────────────────────── */

/** One board per piece of work, by construction: its id is derived from the
 *  item's, so a claim on that id is the only way to make it. */
export function itemBoardId(itemId: string): string {
  return `item-${itemId}`
}
