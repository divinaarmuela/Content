/**
 * COMMENTS ON THE PLAN'S OWN WORDS (29 Oct 2026, the owner with a video of Google Docs: "idk how u will do this but we need
 * this robust feature"; Manal on StretchWorks' November plan). A client — or the team — selects some words of the shoot
 * plan and comments on exactly those: the comment remembers WHICH part of the plan (`anchor_part`) and WHAT words
 * (`anchor_quote`), is drawn beside them with the words lit up, takes replies (`parent_id`) and is resolved when dealt
 * with. Pure: the batch and the comments are handed in.
 */
import { sanitiseCanvasCards, sanitisePlannedDeliverables, sanitiseShotList, type CanvasCard } from './batch-brief-core'
import { findCanvasCard } from './canvas-comments-core'
import { sanitiseScripts, scriptWords } from './script-core'

/** the parts of a plan words can be picked from — the ones the client's portal shows, and the plan's own boxes; and
 *  (29 Oct 2026, "same goes for boards") a card of a board, a shoot's or a team board's */
const PART = /^(objective|concept|talent|props_wardrobe|editor_priorities|location|deliverable:[A-Za-z0-9_-]{1,60}|shot:[A-Za-z0-9_-]{1,60}|script:[A-Za-z0-9_-]{1,60}|card:[A-Za-z0-9_-]{1,40})$/
export const MAX_QUOTE = 300
export const ANCHOR_GONE = 'Those words have changed since — select them again and comment.'

type PlanLike = {
  objective?: string | null; concept?: string | null; talent?: string | null; props_wardrobe?: string | null
  editor_priorities?: string | null; location?: string | null
  planned_deliverables?: unknown; shot_list?: unknown; scripts?: unknown; canvas_cards?: unknown
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' }
const plain = (html: string) => html
  .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITY[e] ?? '')

/**
 * THE WORDS OF A BOARD CARD — what a person can select and comment on: its words (a note, a heading, a document), its
 * name (a to-do list, a board), a link's title, the caption under a picture, a clip or a link, and a to-do's rows. The
 * same words the card's comment panel draws, so what is selected is what the server finds.
 */
export function cardWords(card: Pick<CanvasCard, 'kind' | 'text' | 'name' | 'title' | 'caption' | 'items'> & { html?: string } | null | undefined): string {
  if (!card) return ''
  const words = card.text?.trim() ? card.text : (card.html ? plain(card.html) : '')
  return [
    card.kind === 'todo' || card.kind === 'board' || card.kind === 'column' ? card.name : '',
    words,
    card.kind === 'link' ? card.title : '',
    card.caption,
    ...(card.kind === 'todo' ? (card.items ?? []).map(i => i.text) : []),
  ].map(x => String(x ?? '').trim()).filter(Boolean).join('\n')
}

/** the words of one part of the plan, as written now; null for a part that is not on it */
export function planPartText(b: PlanLike, part: string): string | null {
  if (!PART.test(part)) return null
  const [kind, key] = part.split(':')
  if (kind === 'deliverable') return sanitisePlannedDeliverables(b.planned_deliverables).find(d => d.id === key)?.title ?? null
  if (kind === 'shot') return sanitiseShotList(b.shot_list).find(s => s.id === key)?.text ?? null
  if (kind === 'card') {
    const card = findCanvasCard(sanitiseCanvasCards(b.canvas_cards), key)
    return card ? cardWords(card) : null
  }
  if (kind === 'script') {
    // the words as the portal draws them (script-core.scriptWords) — what a person selects is what they read
    const s = sanitiseScripts(b.scripts).find(x => x.id === key)
    const w = s ? scriptWords([s])[0] : null
    return w ? [w.heading, ...w.lines].join('\n') : null
  }
  const v = (b as Record<string, unknown>)[kind]
  return typeof v === 'string' ? v : null
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** a picked part and its words, checked against the plan as it is: the words must still be in that part */
export function checkAnchor(b: PlanLike, part: unknown, quote: unknown): { ok: true; part: string; quote: string } | { ok: false; error: string } | null {
  if (part == null && quote == null) return null
  const p = String(part ?? '')
  const q = squash(String(quote ?? '')).slice(0, MAX_QUOTE)
  if (!PART.test(p) || !q) return { ok: false, error: 'Select some words of the plan to comment on.' }
  const text = planPartText(b, p)
  if (text == null || !squash(text).toLowerCase().includes(q.toLowerCase())) return { ok: false, error: ANCHOR_GONE }
  return { ok: true, part: p, quote: q }
}

/**
 * The words of a part, cut into plain pieces and lit ones: each comment's quote is found (spaces counted loosely, case
 * ignored) and marked with the comment's id. A quote no longer in the words marks nothing — its thread still shows,
 * with its own words, so nothing said is lost.
 */
export function markQuotes(text: string, anchors: readonly { id: string; quote: string }[]): { text: string; ids: string[] }[] {
  const t = String(text ?? '')
  const lower = t.toLowerCase()
  const marks: { a: number; b: number; id: string }[] = []
  for (const an of anchors) {
    const words = squash(an.quote).toLowerCase().split(' ').filter(Boolean)
    if (!words.length) continue
    const re = new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
    const m = re.exec(lower)
    if (m) marks.push({ a: m.index, b: m.index + m[0].length, id: an.id })
  }
  if (!marks.length) return [{ text: t, ids: [] }]
  const cuts = [...new Set([0, t.length, ...marks.flatMap(m => [m.a, m.b])])].sort((x, y) => x - y)
  const out: { text: string; ids: string[] }[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1]
    if (b <= a) continue
    out.push({ text: t.slice(a, b), ids: marks.filter(m => m.a <= a && m.b >= b).map(m => m.id) })
  }
  return out
}

export type PlanComment = {
  id: string; created_at: string; body: string
  anchor_part?: string | null; anchor_quote?: string | null; parent_id?: string | null; resolved?: boolean | null
}
export type PlanThread<C extends PlanComment> = { root: C; replies: C[] }

/** the comments on the plan's words, as threads — a reply under its first comment, oldest first; open ones first */
export function planThreads<C extends PlanComment>(rows: readonly C[]): PlanThread<C>[] {
  const roots = rows.filter(r => !r.parent_id && r.anchor_part && r.anchor_quote)
  return roots
    .map(root => ({ root, replies: rows.filter(r => r.parent_id === root.id).sort((a, b) => a.created_at.localeCompare(b.created_at)) }))
    .sort((a, b) => Number(!!a.root.resolved) - Number(!!b.root.resolved) || a.root.created_at.localeCompare(b.root.created_at))
}

/** the threads on one part of the plan */
export function threadsOn<C extends PlanComment>(threads: readonly PlanThread<C>[], part: string): PlanThread<C>[] {
  return threads.filter(t => t.root.anchor_part === part)
}

/**
 * WHAT THE GENERAL THREAD SHOWS: a first comment, never a reply (a reply sits under its own), and never one on the
 * plan's words (drawn under those words). A comment on a board card's words stays — it is still that card's comment.
 * A card's RESOLVED thread does not: it is folded away in that card's own panel, and here it read struck through with
 * its replies missing (30 Oct 2026)
 */
export function inGeneralThread(c: { parent_id?: string | null; anchor_part?: string | null; card_id?: string | null; resolved?: boolean | null }): boolean {
  return !c.parent_id && (!c.anchor_part || !!c.card_id) && !(c.card_id && c.resolved)
}

/**
 * WHOLE WORDS (30 Oct 2026: a drag that began mid-word quoted "hen the wide"). The selected words, grown out to the
 * whole words at either end, read in `text` — the words the selection was made in. Unchanged when not found there.
 */
export function snapToWords(text: string, quote: string): string {
  const flat = text.replace(/\s+/g, ' ')
  const q = quote.replace(/\s+/g, ' ').trim()
  const at = q ? flat.indexOf(q) : -1
  if (at < 0) return q
  const inWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}'’_-]/u.test(ch)
  let s = at
  let e = at + q.length
  while (s > 0 && inWord(flat[s - 1]) && inWord(flat[s])) s--
  while (e < flat.length && inWord(flat[e]) && inWord(flat[e - 1])) e++
  return flat.slice(s, e)
}

/** a plan's words thread or a reply in one — kept off the board's cards and the general thread */
export function onPlanWords(c: { parent_id?: string | null; anchor_part?: string | null; card_id?: string | null }): boolean {
  return !c.card_id && (!!c.anchor_part || !!c.parent_id)
}

/**
 * THE THREADS ON ONE BOARD CARD (29 Oct 2026): every first comment on the card is a thread, with its replies under it
 * and Resolve, as on the plan — on the selected words when it was made on them. Open ones in the order they were made.
 */
export function cardThreads<C extends PlanComment & { card_id?: string | null }>(rows: readonly C[], cardId: string): PlanThread<C>[] {
  const on = rows.filter(r => r.card_id === cardId)
  return on.filter(r => !r.parent_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(root => ({ root, replies: on.filter(r => r.parent_id === root.id).sort((a, b) => a.created_at.localeCompare(b.created_at)) }))
}
