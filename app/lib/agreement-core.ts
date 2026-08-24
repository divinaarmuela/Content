/**
 * Pure client-agreement logic — no I/O.
 *
 * The agreement is the standing deal ("20 graphics and 8 reels a month, plus
 * these retained services"); monthly_commitments rows are per-month
 * overrides; content items are the delivery. This module normalises what a
 * browser sends, resolves the effective quota for a month, and counts
 * progress against it — all testable without a database.
 */

export const CONTENT_TYPES = ['reel', 'carousel', 'story', 'static', 'video', 'other'] as const
export type ContentType = (typeof CONTENT_TYPES)[number]

/** One label map for every surface: agreement tab, brief captions, board strip. */
export const TYPE_LABELS: Record<ContentType, string> = {
  static: 'Graphics',
  reel: 'Reels',
  carousel: 'Carousels',
  story: 'Stories',
  video: 'Video',
  other: 'Other',
}

export type DeliverableLine = { type: ContentType; label: string; monthly_qty: number }
export type RetainedService = { key: string; label: string; note: string; active: boolean }

export const RETAINED_SERVICE_CATALOG: { key: string; label: string }[] = [
  { key: 'manychat', label: 'ManyChat automation' },
  { key: 'edm', label: 'EDM / email marketing' },
  { key: 'content_production', label: 'Content production' },
  { key: 'creator_seeding', label: 'Creator seeding' },
  { key: 'paid_social_strategy', label: 'Paid social strategy' },
  { key: 'weekly_reporting', label: 'Weekly reporting' },
  { key: 'quarterly_brand_strategy_review', label: 'Quarterly brand & strategy review' },
]

export function normaliseDeliverableLines(raw: unknown): { lines: DeliverableLine[] } | { error: string } {
  if (!Array.isArray(raw)) return { lines: [] }
  const seen = new Set<string>()
  const lines: DeliverableLine[] = []
  for (const item of raw) {
    const r = (item ?? {}) as Record<string, unknown>
    const type = String(r.type ?? '')
    if (!(CONTENT_TYPES as readonly string[]).includes(type)) {
      return { error: `Unknown deliverable type "${type}"` }
    }
    if (seen.has(type)) return { error: `Duplicate line for ${TYPE_LABELS[type as ContentType]}` }
    seen.add(type)
    const qty = Number(r.monthly_qty)
    if (!Number.isInteger(qty) || qty < 0) {
      return { error: `${TYPE_LABELS[type as ContentType]} needs a whole number of items per month` }
    }
    const label = String(r.label ?? '').trim() || TYPE_LABELS[type as ContentType]
    lines.push({ type: type as ContentType, label: label.slice(0, 60), monthly_qty: qty })
  }
  return { lines }
}

export function normaliseServices(raw: unknown): { services: RetainedService[] } | { error: string } {
  if (!Array.isArray(raw)) return { services: [] }
  const services: RetainedService[] = []
  for (const item of raw) {
    const r = (item ?? {}) as Record<string, unknown>
    const key = String(r.key ?? '').trim()
    const known = RETAINED_SERVICE_CATALOG.some(c => c.key === key)
    if (!known && !key.startsWith('custom:')) return { error: `Unknown service "${key}"` }
    const label = String(r.label ?? '').trim()
    if (!label) return { error: 'A service needs a name' }
    services.push({
      key: key.slice(0, 80),
      label: label.slice(0, 80),
      note: String(r.note ?? '').slice(0, 300),
      active: r.active !== false,
    })
  }
  return { services }
}

/** monthly_commitments column names per type, as the table spells them. */
const COMMITMENT_COLUMNS: Record<ContentType, string> = {
  reel: 'reel_quota', carousel: 'carousel_quota', story: 'story_quota',
  static: 'static_quota', video: 'video_quota', other: 'other_quota',
}

export type EffectiveQuota = { type: ContentType; label: string; quota: number }

/** A commitments row (this month's override) beats the agreement's default,
 *  per type, only where the row exists. */
export function effectiveQuotas(
  lines: DeliverableLine[],
  commitmentRow: Record<string, unknown> | null,
): EffectiveQuota[] {
  const out: EffectiveQuota[] = []
  const byType = new Map(lines.map(l => [l.type, l]))
  for (const type of CONTENT_TYPES) {
    const line = byType.get(type)
    const overrideRaw = commitmentRow?.[COMMITMENT_COLUMNS[type]]
    const override = typeof overrideRaw === 'number' && overrideRaw > 0 ? overrideRaw : null
    const quota = override ?? line?.monthly_qty ?? 0
    if (quota > 0) out.push({ type, label: line?.label ?? TYPE_LABELS[type], quota })
  }
  return out
}

/** Which month an item counts toward: its shoot's month first, then its due
 *  date, then when it was created. */
export function monthOfItem(
  item: { due_date?: string | null; created_at?: string | null },
  batch: { month?: number | null; year?: number | null } | null,
): { month: number; year: number } | null {
  if (batch?.month && batch?.year) return { month: batch.month, year: batch.year }
  const from = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : { month: d.getUTCMonth() + 1, year: d.getUTCFullYear() }
  }
  if (item.due_date) { const m = from(item.due_date); if (m) return m }
  if (item.created_at) { const m = from(item.created_at); if (m) return m }
  return null
}

/** Delivered = past the client's approval; planned = exists at all. */
const DELIVERED_STATUSES = new Set(['approved_for_scheduling', 'scheduled', 'published'])

export type PaceStatus = 'met' | 'on_track' | 'tight' | 'behind'

/** Is this line keeping pace for the month? Compares what's delivered against
 *  what a linear burn-down would expect by this day. `met` once the whole
 *  quota is delivered; `behind` when well under the expected line. Pure. */
export function paceStatus(
  delivered: number, quota: number, dayOfMonth: number, daysInMonth: number,
): PaceStatus {
  if (quota <= 0) return 'met'
  if (delivered >= quota) return 'met'
  const frac = Math.min(1, Math.max(0, dayOfMonth / Math.max(1, daysInMonth)))
  const expected = quota * frac
  if (expected <= 0) return 'on_track'          // start of month — nothing due yet
  if (delivered >= expected) return 'on_track'
  return delivered >= expected * 0.75 ? 'tight' : 'behind'
}

export type MonthlyProgress = EffectiveQuota & { planned: number; delivered: number }

export function computeMonthlyProgress(
  items: { content_type: string; status: string; batch_id?: string | null; due_date?: string | null; created_at?: string | null }[],
  batchesById: Map<string, { month?: number | null; year?: number | null }>,
  month: number,
  year: number,
  quotas: EffectiveQuota[],
): MonthlyProgress[] {
  const planned = new Map<string, number>()
  const delivered = new Map<string, number>()
  for (const item of items) {
    const batch = item.batch_id ? batchesById.get(item.batch_id) ?? null : null
    const m = monthOfItem(item, batch)
    if (!m || m.month !== month || m.year !== year) continue
    planned.set(item.content_type, (planned.get(item.content_type) ?? 0) + 1)
    if (DELIVERED_STATUSES.has(item.status)) {
      delivered.set(item.content_type, (delivered.get(item.content_type) ?? 0) + 1)
    }
  }
  return quotas.map(q => ({
    ...q,
    planned: planned.get(q.type) ?? 0,
    delivered: delivered.get(q.type) ?? 0,
  }))
}
