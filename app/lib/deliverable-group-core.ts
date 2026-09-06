/**
 * The shoot plan's pure logic — no I/O — and what is left of deliverable
 * groups.
 *
 * A GROUP used to be a promise ("5 reels for this client") drawn as one card
 * that filled up, with pieces nested inside it. A card is one deliverable
 * now: the pages draw every piece as its own card and ignore the group it
 * was made in. The group rows still exist and the API still cleans a
 * `planned` list on the way in (plannedFormats / plannedTarget); nothing
 * here draws a quota card any more.
 */

/** One line of a mixed promise: "2 reels", "2 carousels". */
export type PlannedFormat = { type: string; qty: number }

export type DeliverableGroup = {
  id: string
  client_id: string
  batch_id?: string | null
  content_type: string
  title: string
  target: number
  /**
   * A MIX of formats in one card — [{type:'reel',qty:2},{type:'carousel',qty:2}].
   * `target` stays the sum and `content_type` the first/primary type, so a
   * single-format group (this null) behaves exactly as before. The column is
   * added by hand later; every reader tolerates its absence, so until then
   * `planned` is simply null everywhere and groups stay single-format.
   */
  planned?: PlannedFormat[] | null
  /** the kind of work the pieces are; null means a plain content item */
  work_kind_id?: string | null
  work_kinds?: { slug?: string | null; uses_media?: boolean | null; name?: string | null; color?: string | null } | null
  created_by?: string | null
  created_at?: string
}

/**
 * Clean the raw `planned` value into merged {type, qty} rows, or null.
 *
 * Null (and any non-array / empty value) means "not a mix" — the caller then
 * uses the single `content_type` + `target` exactly as before. Duplicate types
 * are summed so "2 reels + 1 reel" is one "3 reels" row, and only whole
 * positive quantities survive.
 */
export function plannedFormats(group: { planned?: PlannedFormat[] | null }): PlannedFormat[] | null {
  const raw = group.planned
  if (!Array.isArray(raw) || raw.length === 0) return null
  const merged = new Map<string, number>()
  for (const r of raw) {
    const type = typeof r?.type === 'string' ? r.type.trim().slice(0, 20) : ''
    const qty = Math.floor(Number(r?.qty))
    if (!type || !Number.isFinite(qty) || qty < 1) continue
    merged.set(type, (merged.get(type) ?? 0) + Math.min(100, qty))
  }
  if (merged.size === 0) return null
  return [...merged.entries()].map(([type, qty]) => ({ type, qty }))
}

/** The pieces promised across every format — the "of 6". */
export function plannedTarget(rows: PlannedFormat[]): number {
  return rows.reduce((s, r) => s + Math.max(0, Math.floor(r.qty || 0)), 0)
}

// ───────────────────────────── the shoot plan ─────────────────────────────
// A plan says what is coming out of the shoot, in plain lines — "Hero reel",
// "Menu carousel", "Chef portrait". One line is one thing to be made, and when
// the shoot is booked each line becomes its own card on the board. There is no
// type dropdown and no quantity: a card is one deliverable, never "2 reels".
//
// Plans written before this rule were stored as [{type, qty}]. Those rows are
// still on real shoots, so they are read as lines — {type:'reel', qty:2} is
// "Reel 1" and "Reel 2" — and nothing that renders a plan (the PDFs, the
// portal, the shoot page) has to know the old shape existed.

/** One thing coming out of the shoot. `id` is stable across edits and
 *  reorders so the card it becomes can be found again. */
export type PlanLine = { id: string; title: string }

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

const LINE_TITLE_MAX = 120
const LINE_ID_MAX = 40
const PLAN_MAX_LINES = 100

/** The word an old {type, qty} row turns into. "image", never "graphic". */
const LEGACY_WORD: Record<string, string> = {
  reel: 'Reel', carousel: 'Carousel', story: 'Story', static: 'Image',
  video: 'Video', other: 'Piece',
}

const safeId = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const id = v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, LINE_ID_MAX)
  return id || null
}

const legacyType = (r: Record<string, unknown>): string =>
  typeof r.type === 'string' ? r.type.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) : ''
const legacyQty = (r: Record<string, unknown>): number => {
  const q = Number(r.qty)
  return Number.isInteger(q) && q > 0 ? Math.min(q, PLAN_MAX_LINES) : 0
}

/**
 * Read a stored `planned_deliverables` value as plan lines.
 *
 * Accepts both shapes and never throws: a `{title}` row is a line as written
 * (an id it lacks is derived from its position); a legacy `{type, qty}` row
 * expands to one line per piece, numbered per type across the whole plan so
 * "2 reels" then "1 reel" reads Reel 1, Reel 2, Reel 3 — and a type with only
 * one piece in the plan keeps its bare name. Junk rows are dropped, titles are
 * trimmed, duplicate ids are made unique, and the plan is capped at 100 lines.
 */
export function planLines(raw: unknown): PlanLine[] {
  if (!Array.isArray(raw)) return []
  const rows = raw.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
  // how many pieces each legacy type has in total, so numbering is decided once
  const legacyTotal = new Map<string, number>()
  for (const r of rows) {
    if (typeof r.title === 'string') continue
    const type = legacyType(r)
    const qty = legacyQty(r)
    if (type && qty > 0) legacyTotal.set(type, (legacyTotal.get(type) ?? 0) + qty)
  }
  const seen = new Set<string>()
  const counter = new Map<string, number>()
  const out: PlanLine[] = []
  const push = (id: string, title: string) => {
    if (out.length >= PLAN_MAX_LINES) return
    let unique = id
    for (let n = 2; seen.has(unique); n++) unique = `${id}-${n}`
    seen.add(unique)
    out.push({ id: unique, title })
  }
  rows.forEach((r, index) => {
    if (typeof r.title === 'string') {
      const title = r.title.trim().slice(0, LINE_TITLE_MAX)
      if (title) push(safeId(r.id) ?? `line-${index + 1}`, title)
      return
    }
    const type = legacyType(r)
    const qty = legacyQty(r)
    if (!type || qty < 1) return
    const word = LEGACY_WORD[type] ?? cap(type)
    for (let i = 0; i < qty; i++) {
      const n = (counter.get(type) ?? 0) + 1
      counter.set(type, n)
      push(`${type}-${n}`, (legacyTotal.get(type) ?? 0) > 1 ? `${word} ${n}` : word)
    }
  })
  return out
}

/** True when the stored value is still the old {type, qty} shape. */
export function isLegacyPlan(raw: unknown): boolean {
  return Array.isArray(raw) && raw.some(r =>
    !!r && typeof r === 'object' && typeof (r as Record<string, unknown>).title !== 'string'
    && typeof (r as Record<string, unknown>).type === 'string')
}

/** A fresh line id for the browser to mint — short, key-safe, no crypto needed. */
export function newLineId(): string {
  return `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Move the line at `from` to sit at `to`; anything out of range is a no-op. */
export function moveLine<T>(lines: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= lines.length || to >= lines.length) return lines
  const next = [...lines]
  const [line] = next.splice(from, 1)
  next.splice(to, 0, line)
  return next
}

/**
 * The plan in one sentence: "3 things from this shoot: Hero reel, Menu
 * carousel, Chef portrait". Empty plan, empty string. Long plans name the
 * first six and count the rest.
 */
export function planSummary(lines: PlanLine[]): string {
  const clean = lines.filter(l => l.title.trim())
  if (clean.length === 0) return ''
  const names = clean.slice(0, 6).map(l => l.title.trim())
  const more = clean.length - names.length
  const list = more > 0 ? `${names.join(', ')} and ${more} more` : names.join(', ')
  return clean.length === 1 ? `One thing from this shoot: ${list}` : `${clean.length} things from this shoot: ${list}`
}

/** What a card's title says it is, so the board's format chips and the
 *  client's agreement count it — "other" when the title says nothing. */
export function contentTypeFromTitle(title: string): string {
  const t = title.toLowerCase()
  if (/\breels?\b/.test(t)) return 'reel'
  if (/\bcarousels?\b/.test(t)) return 'carousel'
  if (/\bstor(y|ies)\b/.test(t)) return 'story'
  if (/\b(videos?|films?|clips?|bts)\b/.test(t)) return 'video'
  if (/\b(images?|photos?|portraits?|stills?|pictures?|graphics?|posts?|tiles?)\b/.test(t)) return 'static'
  return 'other'
}

/**
 * The id of the card a plan line becomes on a given shoot — the SAME id every
 * time, which is what lets booking be repeated (undo, book again; two people
 * booking at once) without a second card: the write is a claim on this id,
 * and a claim on a row that already exists stands down.
 *
 * UUID-shaped because every link in the app (`notificationHref`) only opens
 * an item whose id looks like one. 128 bits from four seeded 32-bit hashes of
 * the shoot id and line id; the version/variant nibbles are stamped so the
 * result reads as a v4 UUID to anything that checks.
 */
export function planCardId(batchId: string, lineId: string): string {
  const hex = hash128(`${batchId}:${lineId}`).map(n => n.toString(16).padStart(8, '0')).join('')
  const variant = (8 + (parseInt(hex[16], 16) & 3)).toString(16)
  const s = hex.slice(0, 12) + '4' + hex.slice(13, 16) + variant + hex.slice(17, 32)
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`
}

/** cyrb128 — a small, well-mixed 128-bit string hash (public domain). */
function hash128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

/** One card a plan will make: the row's identity and the words on it. */
export type PlanCard = {
  id: string
  line_id: string
  client_id: string
  batch_id: string
  title: string
  content_type: string
}

/**
 * The cards a plan makes when the shoot is booked — one per line, in the
 * plan's order, each with the id `planCardId` gives it. This is the whole
 * "what will happen" of booking, with no I/O, so the shoot page can say it
 * and the server can do it from the same list.
 */
export function planCards(shoot: { id: string; client_id: string }, raw: unknown): PlanCard[] {
  return planLines(raw).map(line => ({
    id: planCardId(shoot.id, line.id),
    line_id: line.id,
    client_id: shoot.client_id,
    batch_id: shoot.id,
    title: line.title,
    content_type: contentTypeFromTitle(line.title),
  }))
}
