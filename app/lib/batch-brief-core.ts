/**
 * Pure shoot-brief lifecycle — no I/O, mirroring workflow-core.ts.
 *
 * A batch IS the shoot brief: it is planned (brief), its date is locked
 * (locked — the explicit commitment that opens production), it happens
 * (shot), and eventually it is wrapped. Content items may only be created
 * under a locked or shot brief; an account manager can go around the gate
 * for genuinely ad-hoc work, but must say why, and the reason is logged.
 */

import type { Role } from './identity-core'

export const BATCH_STATUSES = ['brief', 'locked', 'shot', 'wrapped'] as const
export type BatchStatus = (typeof BATCH_STATUSES)[number]

export type BatchTransitionRule = { roles: Role[]; label: string }

export const BATCH_TRANSITIONS: Partial<Record<BatchStatus, Partial<Record<BatchStatus, BatchTransitionRule>>>> = {
  brief: {
    locked: { roles: ['editor', 'account_manager'], label: 'Lock shoot date' },
  },
  locked: {
    brief: { roles: ['account_manager'], label: 'Unlock' },
    shot: { roles: ['editor', 'account_manager'], label: 'Mark as shot' },
    wrapped: { roles: ['account_manager'], label: 'Wrap shoot' },
  },
  shot: {
    wrapped: { roles: ['account_manager'], label: 'Wrap shoot' },
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
 *  - with NO batch at all: account managers and up only, WITH a stated
 *    reason (supers included — auditability is the point, not trust)
 */
export function canCreateItemsUnder(
  batchStatus: BatchStatus | null,
  role: Role,
  adhoc?: { reason: string },
  kindSlug?: string,
): boolean {
  if (role === 'client' || role === 'scheduler') return false
  // a shoot-BRIEF task is how a shoot begins — it may start from nothing
  // (its shoot is created with it) or attach to a still-planning brief;
  // account managers own that act
  if (kindSlug === 'shoot_brief') {
    if (role !== 'account_manager' && role !== 'super_admin') return false
    // …or attach to any shoot that is not finished. Restricting it to a
    // still-planning shoot meant that the moment a date was locked the brief
    // could never be raised, and "New brief task" quietly built a SECOND
    // shoot instead of joining the one already there.
    return batchStatus === null || batchStatus !== 'wrapped'
  }
  if (batchStatus === 'locked' || batchStatus === 'shot' || batchStatus === 'wrapped') return true
  if (batchStatus === null) {
    if (role !== 'account_manager' && role !== 'super_admin') return false
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

export type PlannedDeliverable = { type: string; qty: number }

export function sanitisePlannedDeliverables(raw: unknown): PlannedDeliverable[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map(r => ({ type: String(r.type ?? '').slice(0, 20), qty: Number(r.qty) }))
    .filter(r => r.type !== '' && Number.isInteger(r.qty) && r.qty > 0 && r.qty <= 500)
    .slice(0, 20)
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
