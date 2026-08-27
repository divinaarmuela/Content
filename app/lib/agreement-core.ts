/**
 * Pure client-agreement logic — no I/O.
 *
 * The agreement is the standing deal ("20 graphics and 8 reels a month, plus
 * these retained services"); monthly_commitments rows are per-month
 * overrides; content items are the delivery. This module normalises what a
 * browser sends, resolves the effective quota for a month, and counts
 * progress against it — all testable without a database.
 */

import { DEFAULT_TZ, monthInZone } from './timezone-core'

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

/**
 * Which month an item counts toward: the month it went LIVE if it has, else
 * its shoot's month, then its due date, then when it was created. Footage shot
 * in August and posted in November is November's delivery.
 *
 * The month is counted on the CLIENT's calendar. A post that goes out at
 * 11 pm on 31 August in Melbourne is 1 September in UTC — and counting it as
 * September's would take a delivered item off the August quota the client was
 * actually promised, on the one night of the month it matters. `due_date` is a
 * plain calendar date with no zone at all, so it is read as written.
 */
export function monthOfItem(
  item: { published_at?: string | null; due_date?: string | null; created_at?: string | null },
  batch: { month?: number | null; year?: number | null } | null,
  tz: string = DEFAULT_TZ,
): { month: number; year: number } | null {
  const from = (iso: string) => monthInZone(iso, tz)
  /** a bare 'YYYY-MM-DD' names a month outright — no instant, no zone, no
   *  chance of a due date on the 1st being dragged back into last month */
  const fromCalendarDate = (value: string) => {
    const m = /^(\d{4})-(\d{2})/.exec(value.trim())
    return m ? { month: Number(m[2]), year: Number(m[1]) } : from(value)
  }
  if (item.published_at) { const m = from(item.published_at); if (m) return m }
  if (batch?.month && batch?.year) return { month: batch.month, year: batch.year }
  if (item.due_date) { const m = fromCalendarDate(item.due_date); if (m) return m }
  if (item.created_at) { const m = from(item.created_at); if (m) return m }
  return null
}

/** Delivered = LIVE for the client. The agreement is what the client got,
 *  not what was approved — an approved reel nobody posted is not a reel
 *  delivered. Planned = exists at all. */
const DELIVERED_STATUSES = new Set(['published'])

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
  // whole items only: nobody owes 0.3 of a reel on day 1 — a fractional
  // expectation made every client read "behind" the moment a month began
  const expected = Math.floor(quota * frac)
  if (expected <= 0) return 'on_track'          // start of month — nothing due yet
  if (delivered >= expected) return 'on_track'
  return delivered >= expected * 0.75 ? 'tight' : 'behind'
}

/**
 * The slice of a month the agreement was actually live for — what pacing
 * should measure against. A client signed on the 20th owes work across the
 * remaining days, not the whole month; one whose agreement starts after this
 * month owes nothing yet (null). No/invalid start date = live all month.
 */
export function agreementMonthWindow(
  startDate: string | null | undefined,
  month: number,
  year: number,
  today: { day: number; daysInMonth: number },
): { dayOfMonth: number; daysInMonth: number } | null {
  const full = { dayOfMonth: today.day, daysInMonth: today.daysInMonth }
  if (!startDate) return full
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(startDate))
  if (!m) return full
  const [sy, sm, sd] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (sy > year || (sy === year && sm > month)) return null       // not started yet
  if (sy < year || sm < month) return full                        // started earlier
  // starts inside this month: the window runs from the start day to month end
  const windowDays = Math.max(1, today.daysInMonth - (sd - 1))
  const elapsed = Math.max(0, Math.min(windowDays, today.day - sd + 1))
  return { dayOfMonth: elapsed, daysInMonth: windowDays }
}

/** When did an item go live? The earliest published schedule entry — set
 *  by Save live, by "posted without a link", and by auto-publish. */
export function liveAtFromEntries(entries: { published_at?: string | null }[] | null | undefined): string | null {
  const dates = (entries ?? []).map(e => e?.published_at).filter((d): d is string => Boolean(d)).sort()
  return dates[0] ?? null
}

/** planned = exists; in_production = not yet approved; approved = signed off,
 *  waiting for a slot; scheduled = booked, not live; posted = live (this is
 *  what "delivered" means). in_production + approved + scheduled + posted = planned. */
export type MonthlyProgress = EffectiveQuota & {
  planned: number
  delivered: number
  in_production: number
  approved: number
  scheduled: number
  posted: number
}

export function computeMonthlyProgress(
  items: { content_type: string; status: string; batch_id?: string | null; published_at?: string | null; due_date?: string | null; created_at?: string | null }[],
  batchesById: Map<string, { month?: number | null; year?: number | null }>,
  month: number,
  year: number,
  quotas: EffectiveQuota[],
  /** the client's zone — which month a published item lands in is decided on
   *  their calendar, not the server's */
  tz: string = DEFAULT_TZ,
): MonthlyProgress[] {
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)
  const planned = new Map<string, number>()
  const approved = new Map<string, number>()
  const scheduled = new Map<string, number>()
  const posted = new Map<string, number>()
  for (const item of items) {
    const batch = item.batch_id ? batchesById.get(item.batch_id) ?? null : null
    const m = monthOfItem(item, batch, tz)
    if (!m || m.month !== month || m.year !== year) continue
    bump(planned, item.content_type)
    if (item.status === 'approved_for_scheduling') bump(approved, item.content_type)
    else if (item.status === 'scheduled') bump(scheduled, item.content_type)
    else if (DELIVERED_STATUSES.has(item.status)) bump(posted, item.content_type)
  }
  return quotas.map(q => {
    const p = planned.get(q.type) ?? 0
    const a = approved.get(q.type) ?? 0
    const s = scheduled.get(q.type) ?? 0
    const d = posted.get(q.type) ?? 0
    return { ...q, planned: p, delivered: d, in_production: p - a - s - d, approved: a, scheduled: s, posted: d }
  })
}
