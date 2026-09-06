/**
 * Pure shoot-brief lifecycle — no I/O, mirroring workflow-core.ts.
 *
 * A batch IS the shoot brief: it is planned (brief), its date is locked
 * (locked — the explicit commitment that opens production), it happens
 * (shot), and eventually it is wrapped. Content items may only be created
 * under a locked or shot brief; anyone who makes work — editors and up — can
 * go around the gate for genuinely ad-hoc work, but must say why, and the
 * reason is logged.
 */

import type { Role } from './identity-core'
import { planLines, type PlanLine } from './deliverable-group-core'

export const BATCH_STATUSES = ['brief', 'locked', 'shot', 'wrapped'] as const
export type BatchStatus = (typeof BATCH_STATUSES)[number]

export type BatchTransitionRule = { roles: Role[]; label: string }

/** The four stages, in the words the team uses for them. Lives here, with the
 *  states themselves, so the shoots page and the calendars cannot drift into
 *  two vocabularies for one status. */
export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  brief: 'In planning', locked: 'Booked', shot: 'Shot', wrapped: 'Closed',
}

export const BATCH_TRANSITIONS: Partial<Record<BatchStatus, Partial<Record<BatchStatus, BatchTransitionRule>>>> = {
  brief: {
    // booking = committing to the date. One action, one word, everywhere.
    locked: { roles: ['editor', 'account_manager'], label: 'Book the shoot' },
  },
  locked: {
    brief: { roles: ['account_manager'], label: 'Undo the booking' },
    // kept for the data model; the surfaces DERIVE "Shot" from the calendar
    // (shoot-lifecycle-core) instead of offering this as a button
    shot: { roles: ['editor', 'account_manager'], label: 'Mark as shot' },
    wrapped: { roles: ['account_manager'], label: 'Close shoot' },
  },
  shot: {
    wrapped: { roles: ['account_manager'], label: 'Close shoot' },
  },
  // a shoot wrapped by mistake must be recoverable — without this edge a
  // mis-click freezes it forever (no route can move it, no items can be filed)
  wrapped: {
    shot: { roles: ['account_manager'], label: 'Reopen shoot' },
  },
}

export type BatchTransitionCheck =
  | { ok: true; rule: BatchTransitionRule }
  | { ok: false; reason: string }

export function checkBatchTransition(role: Role, from: BatchStatus, to: BatchStatus): BatchTransitionCheck {
  const rule = BATCH_TRANSITIONS[from]?.[to]
  if (!rule) return { ok: false, reason: `No transition from ${from} to ${to}` }
  if (role === 'super_admin') return { ok: true, rule }
  if (!rule.roles.includes(role)) {
    return { ok: false, reason: `${role} may not perform "${rule.label}"` }
  }
  return { ok: true, rule }
}

/** Transitions a role can perform from a status (for rendering buttons). */
export function availableBatchTransitions(role: Role, from: BatchStatus): { to: BatchStatus; label: string }[] {
  const out: { to: BatchStatus; label: string }[] = []
  for (const [to, rule] of Object.entries(BATCH_TRANSITIONS[from] ?? {})) {
    if (!rule) continue
    if (role === 'super_admin' || rule.roles.includes(role)) {
      out.push({ to: to as BatchStatus, label: rule.label })
    }
  }
  return out
}

/** Locking is a commitment — it needs something to commit to. */
export function batchSatisfiesLock(b: { title?: string | null; shoot_date?: string | null }): boolean {
  if (!b.title || !String(b.title).trim()) return false
  const d = String(b.shoot_date ?? '').trim()
  return d !== '' && !Number.isNaN(new Date(d).getTime())
}

/**
 * The production gate: may this person create content items here?
 *  - under a locked, shot or WRAPPED brief: any item-creating role (editor+).
 *    Wrapped stays open on purpose: footage gets cut months later, and that
 *    work counts toward the month it goes live, not the shoot's month
 *  - under a brief still being planned: nobody — the point of the stage
 *  - with NO batch at all: editors and up, WITH a stated reason (supers
 *    included — auditability is the point, not trust). Footage often arrives
 *    without a shoot, and the editor is who has it.
 */
export function canCreateItemsUnder(
  batchStatus: BatchStatus | null,
  role: Role,
  adhoc?: { reason: string },
  kindSlug?: string,
): boolean {
  // every TEAM role makes work — the owner's rule, verbatim: "scheduler/editor
  // can create production items too". Only clients never create.
  if (role === 'client') return false
  // a shoot-BRIEF task is how a shoot begins — it may start from nothing
  // (its shoot is created with it) or attach to a still-planning brief.
  //
  // It used to be an account manager's act alone, which made it the one
  // exception to the rule three lines above, and the exception did not earn
  // itself: an editor who knows a shoot is needed had to go and ask somebody
  // to type it. Planning is work like the rest of it, and who a piece of work
  // BELONGS to is answered by assignment on the boards, not by refusing to
  // let somebody write it down. Only clients still never create.
  if (kindSlug === 'shoot_brief') {
    // …or attach to any shoot that is not finished. Restricting it to a
    // still-planning shoot meant that the moment a date was locked the brief
    // could never be raised, and "New brief task" quietly built a SECOND
    // shoot instead of joining the one already there.
    return batchStatus === null || batchStatus !== 'wrapped'
  }
  if (batchStatus === 'locked' || batchStatus === 'shot' || batchStatus === 'wrapped') return true
  if (batchStatus === null) {
    // Editors too, not just managers: plenty of work arrives with no shoot
    // behind it at all — the client sends phone footage, or an old shoot
    // supplies the raws — and the editor is the person who has it. Locking
    // that behind a manager meant either a fake shoot brief or an item that
    // could not be created at all, and the first is worse than the gate.
    //
    // The REASON stays mandatory for everyone, supers included: the point was
    // never trust, it is that "why is there no shoot?" has a recorded answer.
    return Boolean(adhoc?.reason && adhoc.reason.trim())
  }
  return false
}

/** Display helper: a brief with items under way reads as "in production". */
export function isInProduction(b: { status: BatchStatus }, itemCount: number): boolean {
  return (b.status === 'locked' || b.status === 'shot') && itemCount > 0
}

/* ── browser-input sanitisers: never trust a jsonb shape from a client ── */

export type ShotRow = { id: string; text: string; type?: string; qty?: number; done: boolean }

export function sanitiseShotList(raw: unknown): ShotRow[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map(r => ({
      id: String(r.id ?? '').slice(0, 40) || Math.random().toString(36).slice(2, 10),
      text: String(r.text ?? '').slice(0, 300),
      ...(r.type ? { type: String(r.type).slice(0, 20) } : {}),
      ...(Number.isInteger(Number(r.qty)) && Number(r.qty) > 0 ? { qty: Number(r.qty) } : {}),
      done: r.done === true,
    }))
    .filter(r => r.text.trim() !== '')
    .slice(0, 100)
}

/** One line of the plan — one thing coming out of the shoot, one card later. */
export type PlannedDeliverable = PlanLine

/** The plan as lines, whichever shape it was stored in: new `{id, title}`
 *  rows as written, old `{type, qty}` rows expanded ("Reel 1", "Reel 2"). */
export function sanitisePlannedDeliverables(raw: unknown): PlannedDeliverable[] {
  return planLines(raw)
}

export type ReferenceMedia = { kind: 'image' | 'link'; url: string; name?: string; note?: string }

export function sanitiseReferenceMedia(raw: unknown): ReferenceMedia[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map(r => ({
      kind: (r.kind === 'link' ? 'link' : 'image') as 'image' | 'link',
      url: String(r.url ?? '').slice(0, 2000),
      ...(r.name ? { name: String(r.name).slice(0, 200) } : {}),
      ...(r.note ? { note: String(r.note).slice(0, 300) } : {}),
    }))
    .filter(r => /^https:\/\//.test(r.url))
    .slice(0, 60)
}

/* ── the brief canvas: freeform cards on a pan/zoom board ── */

export const CANVAS_CARD_KINDS = ['note', 'image', 'link', 'label', 'arrow', 'mockup', 'todo'] as const
export const MOCKUP_PLATFORMS = [
  'ig_post', 'ig_reel', 'ig_story', 'ig_carousel', 'linkedin',
  'youtube', 'yt_short', 'tiktok', 'facebook',
] as const
export const CANVAS_NOTE_COLORS = [
  'paper', 'yellow', 'orange', 'red', 'pink', 'purple', 'blue', 'teal', 'green', 'ink',
] as const
const CANVAS_BOUND = 20_000
const CANVAS_MAX_CARDS = 200

export type CanvasCard = {
  id: string
  kind: (typeof CANVAS_CARD_KINDS)[number]
  x: number
  y: number
  w: number
  z: number
  text?: string
  url?: string
  name?: string
  color?: (typeof CANVAS_NOTE_COLORS)[number]
  /** arrow endpoints — ids of the two cards it connects */
  from?: string
  to?: string
  /** mockup frame — which platform chrome wraps the image */
  platform?: (typeof MOCKUP_PLATFORMS)[number]
  /** carousel mockup — every slide, in order (url stays = slide 1) */
  urls?: string[]
  /** todo card — its checklist rows */
  items?: { id: string; text: string; done: boolean }[]
  /** link card — what the link actually is, so the card can SHOW it rather
   *  than name it. Resolved once when the link is dropped and stored on the
   *  card: the board must not make a network request per card on every open,
   *  and a preview that disappears when a provider rate-limits us is worse
   *  than one that is a few weeks stale. */
  thumb?: string
  title?: string
  provider?: string
  media?: 'video' | 'image' | 'page'
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function sanitiseCanvasCards(raw: unknown): CanvasCard[] {
  if (!Array.isArray(raw)) return []
  // hard input bound before any per-item work — a giant payload can't OOM us
  const input = raw.length > CANVAS_MAX_CARDS * 4 ? raw.slice(0, CANVAS_MAX_CARDS * 4) : raw
  const byId = new Map<string, CanvasCard>()
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const kind = String(r.kind ?? '')
    if (!(CANVAS_CARD_KINDS as readonly string[]).includes(kind)) continue
    const x = Number(r.x); const y = Number(r.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const url = String(r.url ?? '').slice(0, 2000)
    if ((kind === 'image' || kind === 'link') && !url.startsWith('https://')) continue
    // a mockup may exist as an empty frame awaiting its image
    const from = String(r.from ?? '').slice(0, 40)
    const to = String(r.to ?? '').slice(0, 40)
    if (kind === 'arrow' && (!from || !to || from === to)) continue
    const platform = String(r.platform ?? '')
    if (kind === 'mockup' && !(MOCKUP_PLATFORMS as readonly string[]).includes(platform)) continue
    const id = String(r.id ?? '').slice(0, 40) || Math.random().toString(36).slice(2, 10)
    const color = String(r.color ?? '')
    const card: CanvasCard = {
      id,
      kind: kind as CanvasCard['kind'],
      x: clamp(Math.round(x), -CANVAS_BOUND, CANVAS_BOUND),
      y: clamp(Math.round(y), -CANVAS_BOUND, CANVAS_BOUND),
      w: clamp(Math.round(Number(r.w)) || 240, 120, 1200),
      z: clamp(Math.round(Number(r.z)) || 0, 0, 1_000_000),
      ...(kind === 'note' || kind === 'label'
        ? { text: String(r.text ?? '').slice(0, kind === 'label' ? 120 : 4000) }
        : {}),
      ...(kind === 'mockup' && r.text ? { text: String(r.text).slice(0, 500) } : {}),
      ...(kind === 'image' || kind === 'link' ? { url } : {}),
      ...(kind === 'mockup' && url.startsWith('https://') ? { url } : {}),
      ...(kind === 'mockup' && Array.isArray(r.urls)
        ? (() => {
            const urls = r.urls
              .map(u => String(u ?? '').slice(0, 2000))
              .filter(u => u.startsWith('https://'))
              .slice(0, 10)
            return urls.length > 0 ? { urls } : {}
          })()
        : {}),
      ...(r.name ? { name: String(r.name).slice(0, 200) } : {}),
      // a link's resolved preview. The thumbnail is rendered as an <img src>,
      // so it goes through the same https-only gate the card's own url does —
      // a preview is not a reason to relax it.
      ...(kind === 'link'
        ? {
            ...(String(r.thumb ?? '').startsWith('https://')
              ? { thumb: String(r.thumb).slice(0, 2000) } : {}),
            ...(r.title ? { title: String(r.title).slice(0, 200) } : {}),
            ...(r.provider ? { provider: String(r.provider).slice(0, 40) } : {}),
            ...(['video', 'image', 'page'].includes(String(r.media ?? ''))
              ? { media: String(r.media) as CanvasCard['media'] } : {}),
          }
        : {}),
      ...((CANVAS_NOTE_COLORS as readonly string[]).includes(color)
        ? { color: color as CanvasCard['color'] }
        : {}),
      ...(kind === 'arrow' ? { from, to } : {}),
      ...(kind === 'mockup' ? { platform: platform as CanvasCard['platform'] } : {}),
      ...(kind === 'todo'
        ? {
            items: (Array.isArray(r.items) ? r.items : [])
              .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
              .map(t => ({
                id: String(t.id ?? '').slice(0, 40) || Math.random().toString(36).slice(2, 10),
                text: String(t.text ?? '').slice(0, 200),
                done: t.done === true,
              }))
              .slice(0, 30),
          }
        : {}),
    }
    byId.set(card.id, card) // dedupe by id, keep-last
  }
  return [...byId.values()].slice(0, CANVAS_MAX_CARDS)
}

/** Per-card merge: upserts win by id, then removes drop theirs. This is what
 *  makes concurrent editors last-write-wins per CARD, not per board. */
export function applyCanvasOp(
  current: unknown,
  op: { upsert?: unknown; remove?: unknown },
): CanvasCard[] {
  const byId = new Map(sanitiseCanvasCards(current).map(c => [c.id, c]))
  for (const card of sanitiseCanvasCards(op.upsert)) byId.set(card.id, card)
  const removes = Array.isArray(op.remove) ? op.remove.slice(0, 200) : []
  for (const id of removes) byId.delete(String(id ?? '').slice(0, 40))
  // an arrow with a missing endpoint is noise — deleting a card takes its
  // arrows with it, whoever deleted it
  const solid = new Set([...byId.values()].filter(c => c.kind !== 'arrow').map(c => c.id))
  for (const c of [...byId.values()]) {
    if (c.kind === 'arrow' && (!solid.has(c.from ?? '') || !solid.has(c.to ?? ''))) byId.delete(c.id)
  }
  return [...byId.values()].slice(0, CANVAS_MAX_CARDS)
}

/** First-open seeding: the existing reference images laid out as a grid.
 *  DETERMINISTIC ids — two people opening at once persist mergeable sets,
 *  never duplicates. In-memory until the first user action. */
export function seedCardsFromReferences(refs: ReferenceMedia[]): CanvasCard[] {
  if (refs.length === 0) return []
  const cards: CanvasCard[] = [{
    id: 'seed-label', kind: 'label', text: 'REFERENCES', x: 0, y: -48, w: 240, z: 0,
  }]
  const COL_W = 240 + 16
  const colHeights = [0, 0, 0]
  refs.slice(0, CANVAS_MAX_CARDS - 1).forEach((ref, i) => {
    const col = colHeights.indexOf(Math.min(...colHeights))
    const estHeight = ref.kind === 'image' ? 240 : 64
    cards.push({
      id: `seed-${i}-${ref.url.slice(-24).replace(/[^\w-]/g, '-')}`,
      kind: ref.kind === 'image' ? 'image' : 'link',
      x: col * COL_W,
      y: colHeights[col],
      w: 240,
      z: i + 1,
      url: ref.url,
      ...(ref.name ? { name: ref.name } : {}),
    })
    colHeights[col] += estHeight + 16
  })
  return cards
}

/** Who hears about a brief's lifecycle moments. */
export const BATCH_TRANSITION_NOTIFICATIONS: Record<string, ('owner_editor' | 'account_managers')[]> = {
  'brief>locked': ['owner_editor', 'account_managers'],
  'locked>shot': ['account_managers'],
}

/**
 * May this shoot be deleted, and what happens to what is under it.
 *
 * Deleting used to be refused the moment a shoot had ANY content item — which
 * in practice meant the moment its plan was written, since a shoot plan is
 * itself an item. So the only deletable shoot was one nobody had started, and
 * a shoot booked by mistake became permanent as soon as somebody described it.
 * The delete option simply vanished from the menu, with nothing to say why.
 *
 * The task quota card already solved this properly: detach the pieces first,
 * then delete the promise, so real work is never orphaned into a deleted
 * parent — it becomes a plain card and lives on. A shoot is the same shape of
 * thing and gets the same treatment.
 *
 * The one genuine stop is work that has left the building. A published or
 * scheduled piece is a commitment to the client's audience, and the shoot is
 * the record of where it came from; that is what "wrap it" is for.
 */
export type ShootDeletion =
  | { allowed: true; detaching: number; consequence: string }
  | { allowed: false; reason: string }

export function shootDeletion(
  items: readonly { status: string }[],
): ShootDeletion {
  const live = items.filter(i => i.status === 'published' || i.status === 'scheduled')
  if (live.length > 0) {
    return {
      allowed: false,
      reason: live.length === 1
        ? 'One piece from this shoot is already scheduled or live. Wrap the shoot instead — deleting it would lose where that post came from.'
        : `${live.length} pieces from this shoot are already scheduled or live. Wrap the shoot instead — deleting it would lose where those posts came from.`,
    }
  }
  const n = items.length
  return {
    allowed: true,
    detaching: n,
    consequence: n === 0
      ? 'Nothing is attached to it, so nothing else changes.'
      : n === 1
      ? 'Its one piece is kept and stays on the board as its own card — only the shoot goes.'
      : `Its ${n} pieces are kept and stay on the board as their own cards — only the shoot goes.`,
  }
}
