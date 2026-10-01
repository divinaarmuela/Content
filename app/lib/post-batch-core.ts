/**
 * A CARD'S POSTS, AS A BATCH — pure rules, no I/O, no `server-only`.
 *
 * The owner, 1 Oct 2026, after a live walk: a card with 8 approved clips was handed to a scheduler and
 * became ONE draft post with ONE clip; the other seven were only on Schedule's media rail. "The posting
 * side must get THE CARD ITSELF, as a batch, with less manual work." So:
 *
 *   1. Handing an approved card over makes ONE DRAFT PER APPROVED FILE ("WALK TEST · 1 of 8" …), each
 *      assigned to the scheduler. A card of pictures meant as one carousel (content type carousel or
 *      graphic, or nothing but pictures) stays ONE draft with every picture, in order.
 *   2. Every draft has an id worked out from the card, the version and the file (`batchDraftId`), and
 *      is created with a claim on that id — a second hand-over, a retry or the automatic hand-over
 *      landing beside a manual one can never make the same draft twice. Never check-then-write.
 *   3. APPROVE ONCE: the client already approved these files on the editing portal, so a batch draft's
 *      steps are "Team only" (draft → quality check of caption, channels and time → ready → booked) —
 *      unless the client's own "This client signs off every post" switch is on
 *      (`clients.client_approval_required`, social-schedule-core `clientSignsOffEveryPost`).
 *   4. Post approval draws the posts sharing a batch key together (`groupBatches`), and the batch
 *      planner sets channels once, spreads the times (`spreadTimes`) and lists the captions, then calls
 *      the ordinary per-post save and Send for quality check for each — no second state machine.
 *
 * The server half is app/lib/post-batch.ts; the one writer of a post's stage is still post-stage.ts.
 */

import { postSlides, type Slide } from './version-files-core'
import { clientSignsOffEveryPost } from './social-schedule-core'
import { formatInZone, fromZonedInput, safeZone } from './timezone-core'
import type { ApprovalSteps } from './post-stage-core'

/* ── the batch a post belongs to ────────────────────────────────────────── */

/** What `social_posts.batch` holds: which card and version, where in the batch, and the post's own title. */
export type PostBatch = {
  /** `<item id>_v<round>` — every post of one hand-over shares it */
  key: string
  item_id: string
  round: number
  /** 1-based place in the batch */
  index: number
  total: number
  /** "WALK TEST · 1 of 8" — or the card's title alone for a batch of one */
  title: string
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null)

/** Read `social_posts.batch` tolerantly; null for a post that is not part of a batch. */
export function readPostBatch(v: unknown): PostBatch | null {
  if (!isObj(v)) return null
  const key = typeof v.key === 'string' && v.key ? v.key : null
  const index = posInt(v.index)
  const total = posInt(v.total)
  if (!key || index == null || total == null) return null
  return {
    key,
    item_id: typeof v.item_id === 'string' ? v.item_id : '',
    round: posInt(v.round) ?? 1,
    index,
    total,
    title: typeof v.title === 'string' ? v.title : '',
  }
}

export const batchKey = (itemId: string, round: number) => `${itemId}_v${Math.max(1, Math.floor(round) || 1)}`

/** "WALK TEST · 3 of 8"; a batch of one is just the card's title. */
export function batchTitle(cardTitle: string | null | undefined, index: number, total: number): string {
  const title = String(cardTitle ?? '').trim() || 'Untitled'
  return total > 1 ? `${title} · ${index} of ${total}` : title
}

/** The group's line on Post approval: "WALK TEST · 8 posts". */
export function batchGroupTitle(cardTitle: string | null | undefined, count: number): string {
  const title = String(cardTitle ?? '').trim() || 'Untitled'
  return `${title} · ${count} post${count === 1 ? '' : 's'}`
}

/** The card title a batch post's own title was made from ("WALK TEST · 1 of 8" → "WALK TEST"). */
export function cardTitleOf(batch: Pick<PostBatch, 'title' | 'total'>): string {
  return batch.total > 1 ? batch.title.replace(/ · \d+ of \d+$/, '') : batch.title
}

/* ── which drafts a hand-over makes ─────────────────────────────────────── */

/** Content types whose files are ONE post — the pictures of a carousel, a set of graphics. */
export const ONE_POST_TYPES: readonly string[] = ['carousel', 'graphic', 'graphics']

/**
 * One post for all of them, or one per file?
 *   carousel / graphic(s) — one post: the pictures were made to be swiped through together;
 *   nothing but pictures  — one post, for the same reason;
 *   anything with a video — one post per file: eight clips are eight Reels.
 */
export function batchMode(contentType: string | null | undefined, slides: readonly Pick<Slide, 'type'>[]): 'one' | 'each' {
  const t = String(contentType ?? '').trim().toLowerCase()
  if (ONE_POST_TYPES.includes(t)) return 'one'
  if (slides.length > 0 && slides.every(s => s.type !== 'video')) return 'one'
  return 'each'
}

/** A short, stable tag for one file (FNV-1a over its URL, base 36) — the same file always gives the same tag. */
export function slideTag(url: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/**
 * THE DRAFT'S ID: card, version and file — so the claim that creates it is the duplicate guard.
 * Only RTDB-safe characters (trap 9): the item id is a uuid, the rest is ours.
 */
export function batchDraftId(itemId: string, round: number, tag: string): string {
  return `batch_${itemId}_v${Math.max(1, Math.floor(round) || 1)}_${tag}`.replace(/[.#$[\]/]/g, '_')
}

export type PlannedDraft = { id: string; slides: Slide[]; batch: PostBatch }

/**
 * THE DRAFTS A HAND-OVER MAKES, in order.
 *
 * `filesCard`: the card was handed in as files (final_files) — each one a finished piece. An older
 * media-version card keeps the one-post rule it always had (`postSlides`: a Reel version's second
 * slide is its cover still, not a second Reel).
 */
export function planBatch(input: {
  itemId: string
  title: string | null | undefined
  round: number
  contentType: string | null | undefined
  slides: readonly Slide[]
  filesCard: boolean
}): PlannedDraft[] {
  const round = Math.max(1, Math.floor(Number(input.round)) || 1)
  const key = batchKey(input.itemId, round)
  // the same file twice is one file
  const seen = new Set<string>()
  const files = input.slides.filter(s => s && s.url && !seen.has(s.url) && (seen.add(s.url), true))
  if (files.length === 0) return []
  const one = (slides: Slide[]): PlannedDraft[] => (slides.length === 0 ? [] : [{
    id: batchDraftId(input.itemId, round, 'all'),
    slides,
    batch: { key, item_id: input.itemId, round, index: 1, total: 1, title: batchTitle(input.title, 1, 1) },
  }])
  if (!input.filesCard) return one(postSlides(input.contentType, files))
  if (batchMode(input.contentType, files) === 'one') return one(files)
  return files.map((s, i) => ({
    id: batchDraftId(input.itemId, round, slideTag(s.url)),
    slides: [s],
    batch: { key, item_id: input.itemId, round, index: i + 1, total: files.length, title: batchTitle(input.title, i + 1, files.length) },
  }))
}

/**
 * APPROVE ONCE (the owner, 1 Oct 2026). The client approved these files on the editing portal, so a
 * post made from them is checked by the team (caption, channels, time) and goes to Ready to post —
 * unless the client signs off every post, when it goes to them after the check as every post does.
 */
export function batchApprovalSteps(client: { client_approval_required?: unknown } | null | undefined): ApprovalSteps {
  return clientSignsOffEveryPost(client) ? 'team_then_client' : 'team'
}

/* ── the automatic hand-over ────────────────────────────────────────────── */

/**
 * WHO A CARD IS HANDED TO THE MOMENT IT IS APPROVED — empty when it is not handed automatically.
 *
 * Only a piece of work reaching `approved_for_scheduling`, only when the client has somebody set under
 * "Who schedules for this client" (`clients.default_scheduler_ids`), never a card the client posts
 * themselves (deliver only), never a Schedule upload (`adhoc_post`: its post already exists), and never
 * when the caller hands it over itself (the Hand to… popup's "approve and hand"). The people: the ones
 * picked with the approval, else the ones already on the card, else the client's schedulers.
 */
export function autoHandoverTargets(input: {
  to: string
  workCard: boolean
  selfPosts: boolean
  adhoc: boolean
  callerHandsOver: boolean
  clientSchedulers: readonly string[]
  picked?: readonly string[] | null
  onCard?: readonly string[] | null
}): string[] {
  if (input.to !== 'approved_for_scheduling') return []
  if (!input.workCard || input.selfPosts || input.adhoc || input.callerHandsOver) return []
  if (input.clientSchedulers.length === 0) return []
  const clean = (l: readonly string[] | null | undefined) => [...new Set((l ?? []).filter(x => typeof x === 'string' && x))]
  const picked = clean(input.picked)
  if (picked.length > 0) return picked.slice(0, 20)
  const onCard = clean(input.onCard)
  if (onCard.length > 0) return onCard.slice(0, 20)
  return clean(input.clientSchedulers).slice(0, 20)
}

/** The edit card's notice after a hand-over: "Handed to Test Scheduler — 8 draft posts on Post approval". */
export function handoverNotice(name: string | null | undefined, posts: number): string {
  const who = String(name ?? '').trim() || 'the scheduler'
  if (posts <= 0) return `Handed to ${who}.`
  return `Handed to ${who} — ${posts} draft post${posts === 1 ? '' : 's'} on Post approval`
}

/* ── Post approval: drawing a batch together ────────────────────────────── */

export type BatchGroup<T> =
  | { kind: 'post'; item: T }
  | { kind: 'batch'; key: string; title: string; items: T[] }

/**
 * The cards of one lane, with the posts of one batch drawn together — at the place the first of
 * them stood, in batch order. A batch with only one post left in the lane is an ordinary card.
 */
export function groupBatches<T>(list: readonly T[], batchOf: (t: T) => PostBatch | null | undefined): BatchGroup<T>[] {
  const counts = new Map<string, number>()
  for (const t of list) { const b = batchOf(t); if (b) counts.set(b.key, (counts.get(b.key) ?? 0) + 1) }
  const out: BatchGroup<T>[] = []
  const at = new Map<string, Extract<BatchGroup<T>, { kind: 'batch' }>>()
  for (const t of list) {
    const b = batchOf(t)
    if (!b || (counts.get(b.key) ?? 0) < 2) { out.push({ kind: 'post', item: t }); continue }
    let g = at.get(b.key)
    if (!g) {
      g = { kind: 'batch', key: b.key, title: batchGroupTitle(cardTitleOf(b), counts.get(b.key)!), items: [] }
      at.set(b.key, g)
      out.push(g)
    }
    g.items.push(t)
  }
  for (const g of at.values()) g.items.sort((a, b) => (batchOf(a)?.index ?? 0) - (batchOf(b)?.index ?? 0))
  return out
}

/* ── the batch planner ──────────────────────────────────────────────────── */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** `YYYY-MM-DD` plus `days`, on the calendar (no clock, no zone). */
export function addDays(day: string, days: number): string | null {
  const m = DAY_RE.exec(String(day ?? '').trim())
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/**
 * SPREAD THE TIMES: "one a day at 9:00 am from Monday" — `count` posting times, `everyDays` apart, at
 * the same wall-clock time in the client's zone (a daylight-saving change keeps 9:00 am at 9:00 am).
 * Null for each when the date or the time cannot be read.
 */
export function spreadTimes(input: { start: string; time: string; count: number; everyDays?: number; zone?: string | null }): (string | null)[] {
  const count = Math.max(0, Math.min(200, Math.floor(input.count) || 0))
  const every = Math.max(1, Math.min(31, Math.floor(input.everyDays ?? 1) || 1))
  const zone = safeZone(input.zone ?? null)
  const time = String(input.time ?? '').trim()
  const ok = DAY_RE.test(String(input.start ?? '').trim()) && TIME_RE.test(time)
  return Array.from({ length: count }, (_, i) => {
    if (!ok) return null
    const day = addDays(input.start, i * every)
    return day ? fromZonedInput(`${day}T${time}`, zone) : null
  })
}

/** "One a day at 9:00 am from Mon 5 Oct" — what the planner will do, said before it is done. */
export function spreadWords(input: { start: string; time: string; count: number; everyDays?: number; zone?: string | null }): string | null {
  const times = spreadTimes({ ...input, count: Math.max(1, input.count) })
  const first = times[0]
  if (!first) return null
  const zone = safeZone(input.zone ?? null)
  const every = Math.max(1, Math.floor(input.everyDays ?? 1) || 1)
  const cadence = every === 1 ? 'One a day' : every === 7 ? 'One a week' : `One every ${every} days`
  return `${cadence} at ${formatInZone(first, zone, 'time')} from ${formatInZone(first, zone, 'date')}`
}

/** What the planner saves on one post — only the fields the person set. */
export type PlannedSave = { postId: string; channels?: string[]; scheduled_for?: string; caption?: string }

/**
 * THE PLANNER'S SAVES, one per draft in batch order: the channels chosen once for all, the spread
 * times, and each post's caption from the list. A field left empty is not sent, so it leaves the
 * post's own value alone. Only drafts are planned — a post already sent is kept as it was sent.
 */
export function plannerSaves(
  posts: readonly { id: string; stage: string }[],
  plan: { channels?: readonly string[] | null; times?: readonly (string | null)[] | null; captions?: readonly (string | null | undefined)[] | null },
): PlannedSave[] {
  const out: PlannedSave[] = []
  posts.forEach((p, i) => {
    if (p.stage !== 'draft') return
    const save: PlannedSave = { postId: p.id }
    if (plan.channels && plan.channels.length > 0) save.channels = [...plan.channels]
    const t = plan.times?.[i]
    if (t) save.scheduled_for = t
    const c = plan.captions?.[i]
    if (typeof c === 'string') save.caption = c
    out.push(save)
  })
  return out
}
