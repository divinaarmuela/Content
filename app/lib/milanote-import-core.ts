/**
 * MILANOTE → OUR BOARDS, THE CONVERSION (the owner, 20 Oct 2026, for Renée: "everything needs to be there and we
 * can edit it"; docs/MILANOTE_MERGE.md). Pure: a Milanote board tree in, our canvas cards out.
 *
 * One of our team boards holds a whole Milanote tree: a child board is a `board` tile and its contents are the cards
 * whose `parent` is that tile. Every card keeps its Milanote id as its own id and in `mn`, so the import re-runs
 * without doubling. Places and sizes are Milanote's own, measured on screen: one Milanote unit is 9 px, a card is
 * `width × 9 − 2` px wide, and a card with no width is Milanote's default of 34 units.
 */
import { htmlText, milanoteToHtml } from './canvas-rich-core'
import { providerFor } from './link-preview-core'
import type { CanvasCard } from './batch-brief-core'

export const MN_UNIT = 9
export const MN_DEFAULT_W = 34

/** a Milanote width (units) in our pixels */
export function mnWidth(units: unknown, fallback = MN_DEFAULT_W): number {
  const n = Number(units)
  const u = Number.isFinite(n) && n > 0 ? n : fallback
  return Math.max(40, Math.round(u * MN_UNIT - 2))
}

/** Milanote's named colours, as its palette draws them */
export const MN_COLOURS: Record<string, string> = {
  RED: '#f28b82', ORANGE: '#f6b26b', YELLOW: '#fde68a', GREEN: '#a8d5a2', CYAN: '#9fe0e8', BLUE: '#9cc3f0',
  DEEP_BLUE: '#3d5a98', PINK: '#f4a6c1', BROWN: '#8b5e3c', GREY: '#d9d9d9', PURPLE: '#c3a6f0', BLACK: '#2b2b2b',
}

/** any of Milanote's ways of saying a colour — "#eb728f", "ORANGE", { value: "#df1e03" }, { color: "GREY" } */
export function mnHex(c: unknown): string | undefined {
  if (!c) return undefined
  if (typeof c === 'string') {
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase()
    if (/^#[0-9a-f]{3}$/i.test(c)) return ('#' + c.slice(1).split('').map(x => x + x).join('')).toLowerCase()
    return MN_COLOURS[c.toUpperCase()]
  }
  if (typeof c === 'object') {
    const o = c as Record<string, unknown>
    return mnHex(o.value) ?? mnHex(o.color)
  }
  return undefined
}

export type MnElement = {
  _id: string
  elementType: string
  location?: { parentId?: string; section?: string; position?: { x?: number; y?: number; index?: number; score?: number } }
  content?: Record<string, unknown>
  meta?: { createdTime?: number }
}

/** where a file Milanote held now lives in our storage: the milanote_media row id → url */
export type MediaUrls = ReadonlyMap<string, string>

export type ConvertContext = {
  /** every Milanote element by id */
  elements: Readonly<Record<string, MnElement>>
  /** element id → its children */
  kids: ReadonlyMap<string, MnElement[]>
  media: MediaUrls
  /** a Milanote board that is its OWN team board elsewhere → that team board's id (drawn here as a board link) */
  boardTarget: ReadonlyMap<string, string>
}

export function kidsIndex(elements: Readonly<Record<string, MnElement>>): Map<string, MnElement[]> {
  const kids = new Map<string, MnElement[]>()
  for (const e of Object.values(elements)) {
    const p = e.location?.parentId
    if (!p) continue
    const list = kids.get(p) ?? []
    list.push(e)
    kids.set(p, list)
  }
  return kids
}

const order = (e: MnElement) => e.location?.position?.score ?? e.location?.position?.index ?? 0
const plain = (raw: unknown) => htmlText(milanoteToHtml(raw)).trim()
const shown = (c: Record<string, unknown>, key = 'caption') => (c.showCaption === false ? '' : plain(c[key]))

export type ConvertResult = {
  cards: CanvasCard[]
  /** element types met and how many became a card */
  met: Record<string, number>
  made: Record<string, number>
  /** what had no card, and why */
  skipped: { id: string; type: string; why: string }[]
  /** comment threads, with where they sit, to pin to the nearest card */
  threads: { threadId: string; board: string | null; x: number; y: number; card?: string }[]
}

/**
 * The cards of one Milanote board and everything inside it. `rootId`'s own children sit at the top level of the team
 * board; a child board becomes a board tile and its contents point at it with `parent`.
 */
export function convertTree(rootId: string, ctx: ConvertContext): ConvertResult {
  const out: CanvasCard[] = []
  const met: Record<string, number> = {}
  const made: Record<string, number> = {}
  const skipped: ConvertResult['skipped'] = []
  const threads: ConvertResult['threads'] = []
  let z = 1
  const put = (type: string, c: CanvasCard) => {
    made[type] = (made[type] ?? 0) + 1
    out.push(c)
    // a comment thread Milanote pinned to this card itself comes with it, on this card
    for (const k of ctx.kids.get(c.id) ?? []) {
      if (k.elementType === 'COMMENT_THREAD') threads.push({ threadId: String((k.content ?? {}).threadId ?? k._id), board: c.parent ?? null, x: c.x, y: c.y, card: c.id })
    }
  }

  /** one board's children: `parent` is the tile they sit in (absent at the root) */
  const walkBoard = (boardId: string, parent: string | undefined) => {
    const children = [...(ctx.kids.get(boardId) ?? [])].sort((a, b) => order(a) - order(b))
    // Milanote's unsorted pile (a board's INBOX, not in a column) is stacked to the left of the board
    let inboxY = 0
    for (const e of children) {
      const sec = e.location?.section
      let at: { x: number; y: number }
      if (sec === 'CANVAS') at = { x: Math.round((e.location?.position?.x ?? 0) * MN_UNIT), y: Math.round((e.location?.position?.y ?? 0) * MN_UNIT) }
      else { at = { x: -420, y: inboxY }; inboxY += 220 }
      convert(e, at, parent, undefined, undefined)
    }
  }

  const convert = (e: MnElement, at: { x: number; y: number }, parent: string | undefined, col: string | undefined, ord: number | undefined) => {
    const t = e.elementType
    met[t] = (met[t] ?? 0) + 1
    const c = (e.content ?? {}) as Record<string, unknown>
    const base = {
      id: e._id, mn: e._id, x: at.x, y: at.y, z: z++,
      ...(parent ? { parent } : {}),
      ...(col ? { col, ord } : {}),
    }
    switch (t) {
      case 'CARD': {
        const html = milanoteToHtml(c.textContent)
        const bg = mnHex((c.background as Record<string, unknown> | undefined)?.color ?? c.color)
        return put(t, { ...base, kind: 'note', w: mnWidth(c.width), html, text: htmlText(html), ...(bg ? { hex: bg } : {}) } as CanvasCard)
      }
      case 'IMAGE': {
        const img = (c.image ?? {}) as Record<string, unknown>
        const url = ctx.media.get(`${e._id}_image`) ?? (typeof img.original === 'string' && img.original.startsWith('https://') ? img.original : undefined)
        if (!url) return skipped.push({ id: e._id, type: t, why: 'no picture' })
        const file = (c.file ?? {}) as Record<string, unknown>
        const caption = shown(c)
        return put(t, { ...base, kind: 'image', w: mnWidth(c.width), url, name: String(file.filename ?? 'Image').slice(0, 200), ...(caption ? { caption } : {}) } as CanvasCard)
      }
      case 'LINK': {
        const link = (c.link ?? {}) as Record<string, unknown>
        const url = String(c.url ?? link.url ?? '')
        if (!/^https?:\/\//i.test(url)) return skipped.push({ id: e._id, type: t, why: 'no address' })
        const secure = url.replace(/^http:\/\//i, 'https://')
        const p = providerFor(secure)
        const thumb = ctx.media.get(`${e._id}_link`)
        const title = String(c.title ?? link.title ?? '').trim()
        const caption = shown(c)
        return put(t, {
          ...base, kind: 'link', w: mnWidth(c.width), url: secure,
          ...(title ? { title: title.slice(0, 300) } : {}),
          ...(thumb ? { thumb } : {}),
          ...(p ? { provider: p.name, media: p.media } : {}),
          ...(caption ? { caption } : {}),
        } as CanvasCard)
      }
      case 'COLUMN': {
        const hex = mnHex((c.background as Record<string, unknown> | undefined)?.color ?? c.color)
        put(t, { ...base, kind: 'column', w: mnWidth(c.width), name: String(c.title ?? '').trim() || 'Untitled', ...(hex ? { hex } : {}), ...(c.collapsed === true ? { collapsed: true } : {}) } as CanvasCard)
        // its cards, in Milanote's order, inside it
        const inside = [...(ctx.kids.get(e._id) ?? [])].sort((a, b) => order(a) - order(b))
        inside.forEach((k, i) => convert(k, at, parent, e._id, i))
        return
      }
      case 'BOARD': {
        const target = ctx.boardTarget.get(e._id)
        const name = String(c.title ?? '').trim() || 'Board'
        const hex = mnHex(c.color)
        const look = { ...(hex ? { hex } : {}), ...boardIcon(c), w: col ? mnWidth(c.width, 30) : BOARD_TILE_W }
        if (target) return put(t, { ...base, kind: 'boardlink', name, target, ...look } as CanvasCard)
        put(t, { ...base, kind: 'board', name, ...look } as CanvasCard)
        // its contents open inside the tile
        walkBoard(e._id, e._id)
        return
      }
      case 'ALIAS': {
        const to = String(c.linkTo ?? '')
        const target = ctx.boardTarget.get(to)
        if (!target) return skipped.push({ id: e._id, type: t, why: 'links to a board not brought over' })
        const hex = mnHex(c.originalColor)
        const icon = boardIcon({ icon: c.originalIcon })
        return put(t, { ...base, kind: 'boardlink', w: col ? mnWidth(c.width, 30) : BOARD_TILE_W, name: String(c.originalTitle ?? 'Board').trim(), target, ...(hex ? { hex } : {}), ...icon } as CanvasCard)
      }
      case 'TASK_LIST': {
        const tasks = [...(ctx.kids.get(e._id) ?? [])].filter(k => k.elementType === 'TASK').sort((a, b) => order(a) - order(b))
        let items = tasks.map(k => ({ id: k._id, text: plain((k.content ?? {}).textContent).slice(0, 1000), done: (k.content ?? {}).isComplete === true }))
        if (!items.length) items = taskItemsOf(c.textContent)
        met.TASK = (met.TASK ?? 0) + tasks.length
        const title = c.showTitle === false ? '' : String(c.title ?? '').trim()
        return put(t, { ...base, kind: 'todo', w: mnWidth(c.width), items: items.filter(i => i.text).slice(0, 100), ...(title ? { name: title } : {}) } as CanvasCard)
      }
      case 'TASK': return // drawn by its list
      case 'TABLE': {
        const data = ((c.tableContent as Record<string, unknown> | undefined)?.data ?? []) as { value?: unknown; background?: string }[][]
        const rows = data.map(r => (Array.isArray(r) ? r : []).map(cell => milanoteToHtml(cell?.value ?? '')))
        const header = Array.isArray(data[0]) && data[0].some(cell => String(cell?.background ?? '').includes('HEADER'))
        const title = c.showTitle ? String(c.title ?? '').trim() : ''
        return put(t, { ...base, kind: 'table', w: mnWidth(c.width, 51), rows, ...(header ? { header: true } : {}), ...(title ? { name: title } : {}) } as CanvasCard)
      }
      case 'COLOR_SWATCH': {
        // the colour, wherever Milanote kept it: its own field, the swatch's text ("#F4C578"), or its picture's colour
        const blocks = ((c.textContent as { blocks?: { text?: string }[] } | undefined)?.blocks ?? []).map(x => x.text ?? '').join(' ')
        const hexInText = (blocks || plain(c.textContent)).match(/#[0-9a-f]{6}/i)?.[0]
        const hex = mnHex(c.color) ?? mnHex(hexInText) ?? mnHex(((c.image as { colors?: string[] } | undefined)?.colors ?? [])[0])
        if (!hex) return skipped.push({ id: e._id, type: t, why: 'no colour' })
        const name = shown(c)
        return put(t, { ...base, kind: 'swatch', w: mnWidth(c.width, 16), hex, ...(name ? { name } : {}) } as CanvasCard)
      }
      case 'DOCUMENT': {
        const html = milanoteToHtml(c.textContent)
        return put(t, { ...base, kind: 'document', w: mnWidth(c.width), name: String(c.title ?? '').trim() || 'Untitled document', html, text: htmlText(html) } as CanvasCard)
      }
      case 'FILE': {
        const f = (c.file ?? {}) as Record<string, unknown>
        const url = ctx.media.get(`${e._id}_file`) ?? (typeof f.url === 'string' ? f.url : '')
        if (!url.startsWith('https://')) return skipped.push({ id: e._id, type: t, why: 'no file' })
        return put(t, {
          ...base, kind: 'file', w: mnWidth(c.width),
          file: { url, name: String(f.filename ?? 'File'), ...(Number(f.size) > 0 ? { size: Number(f.size) } : {}), ...(f.mime ? { mime: String(f.mime) } : {}) },
          name: String(f.filename ?? 'File'),
        } as CanvasCard)
      }
      case 'LINE': {
        const line = lineOf(e, ctx)
        return put(t, { ...base, kind: 'arrow', w: 120, ...line } as CanvasCard)
      }
      case 'COMMENT_THREAD':
        threads.push({ threadId: String(c.threadId ?? e._id), board: parent ?? null, x: at.x, y: at.y })
        return
      default:
        // SKELETON (a board this login cannot read), ANNOTATION (a freehand drawing)
        return skipped.push({ id: e._id, type: t, why: t === 'ANNOTATION' ? 'a freehand drawing' : 'not readable from this account' })
    }
  }

  walkBoard(rootId, undefined)
  // a line's joined ends need their cards; one whose card did not come over keeps its free point
  const ids = new Set(out.map(c => c.id))
  for (const c of out) {
    if (c.kind !== 'arrow') continue
    if (c.from && !ids.has(c.from)) delete c.from
    if (c.to && !ids.has(c.to)) delete c.to
  }
  return { cards: out, met, made, skipped, threads }
}

/** Milanote draws a board on the canvas as an 88 px tile: a coloured square, its name under it (measured on screen,
 *  Luxe laser, 20 Oct 2026); inside a column, as a row */
export const BOARD_TILE_W = 88

/** a board's own picture: its cover image, else its icon (an svg icon's png) */
function boardIcon(c: Record<string, unknown>): { icon_url?: string } {
  const img = c.image as { regular?: string; large?: string } | undefined
  const icon = c.icon as { png?: string } | null | undefined
  const url = img?.regular ?? img?.large ?? icon?.png
  return typeof url === 'string' && url.startsWith('https://') ? { icon_url: url } : {}
}

/** a V2 task list keeps its tasks in its own text */
function taskItemsOf(doc: unknown): { id: string; text: string; done: boolean }[] {
  const items: { id: string; text: string; done: boolean }[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const node = n as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }
    if (node.type === 'taskItem') {
      items.push({ id: String(node.attrs?.taskId ?? items.length), text: plain({ type: 'doc', content: node.content ?? [] }).slice(0, 1000), done: node.attrs?.checked === true })
      return
    }
    for (const k of node.content ?? []) walk(k)
  }
  walk(doc)
  return items
}

/** A Milanote line: joined to cards where it was snapped to them, free points where not; its curve, label, ends. */
export function lineOf(e: MnElement, ctx: Pick<ConvertContext, 'elements'>): Partial<CanvasCard> {
  const c = (e.content ?? {}) as Record<string, unknown>
  const pos = e.location?.position ?? {}
  const end = (k: 'start' | 'end') => (c[k] ?? {}) as { x?: number; y?: number; elementId?: string | null; snapped?: boolean }
  const s = end('start'), f = end('end')
  const px = (p: { x?: number; y?: number }) => ({ x: Math.round(((pos.x ?? 0) + (p.x ?? 0)) * MN_UNIT), y: Math.round(((pos.y ?? 0) + (p.y ?? 0)) * MN_UNIT) })
  const a = px(s), b = px(f)
  const from = s.elementId && ctx.elements[s.elementId] ? s.elementId : undefined
  const to = f.elementId && ctx.elements[f.elementId] ? f.elementId : undefined
  // Milanote's curve: a handle a share of the way along, pushed off to the side
  const ctl = c.control as { perpMag?: number; parallelRatio?: number } | undefined
  let cx: number | undefined, cy: number | undefined
  if (ctl && Number.isFinite(ctl.perpMag) && Number.isFinite(ctl.parallelRatio)) {
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const r = ctl.parallelRatio as number, m = (ctl.perpMag as number) * MN_UNIT
    cx = Math.round(a.x + dx * r + (-dy / len) * m)
    cy = Math.round(a.y + dy * r + (dx / len) * m)
  }
  const colour = mnHex(c.color)
  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(colour ? { hex: colour } : {}),
    line: {
      fx: a.x, fy: a.y, tx: b.x, ty: b.y,
      ...(cx !== undefined && cy !== undefined ? { cx, cy } : {}),
      ...(c.lineLabelEnabled && c.lineLabel ? { label: String(c.lineLabel) } : {}),
      start: c.startStyle === 'ARROW' ? 'arrow' : 'none',
      end: c.endStyle === 'ARROW' ? 'arrow' : 'none',
      ...(c.lineStyle === 'DASHED' || c.lineStyle === 'DOTTED' ? { dashed: true } : {}),
      ...(Number(c.lineWeight) > 0 ? { weight: Number(c.lineWeight) } : {}),
    },
  }
}

/** the card a comment thread sits nearest to, on its own board */
export function nearestCard(cards: readonly CanvasCard[], board: string | null, x: number, y: number): string | null {
  let best: { id: string; d: number } | null = null
  for (const c of cards) {
    if ((c.parent ?? null) !== board || c.col || c.kind === 'arrow') continue
    const cx = c.x + c.w / 2, cy = c.y + 60
    const d = Math.hypot(cx - x, cy - y)
    if (!best || d < best.d) best = { id: c.id, d }
  }
  return best?.id ?? null
}

/** names compared loosely: "WATERSIDE" is Waterside, "Cecconis" is Cecconi's Toorak & Flinders */
export function sameClient(a: string, b: string): boolean {
  const n = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '')
  const x = n(a), y = n(b)
  if (!x || !y) return false
  return x === y || (x.length > 3 && y.includes(x)) || (y.length > 3 && x.includes(y))
}
