/**
 * PRODUCED · DELIVERED · PUBLISHED, per client, this month — pure.
 *
 * The Team's Playbook counts exactly three stages and asks that the same
 * three words be used everywhere: produced (finished internally, not yet
 * sent), delivered (the final sent to the client — "the moment our
 * obligation is met"), published (live). The Overview says them per client
 * against what the month's agreement promised, so a shortfall is visible
 * now rather than relitigated at month eight.
 *
 * What counts, and where each number is read from:
 * - produced: the card first reached the quality check or anything after
 *   it. Read from the activity log's status changes (every transition writes
 *   one, `workflow.ts`), earliest per card; a card with no such row but a
 *   delivery stamp counts from that stamp.
 * - delivered: `content_items.delivered_at`, stamped once when the final
 *   first reached the client.
 * - published: the status change to `published` in the activity log,
 *   earliest per card.
 * - contracted: the month's `monthly_commitments` quotas, summed.
 *
 * Every stamp is placed in a month on the CLIENT's calendar, the same way
 * the Posts this month ledger does it.
 */

export type StageItem = {
  id: string
  client_id: string | null
  status?: string | null
  delivered_at?: string | null
}

export type StageActivity = {
  entity_type?: string | null
  entity_id?: string | null
  action?: string | null
  new_value?: string | null
  created_at?: string | null
}

export type StageClient = { id: string; name: string; timezone?: string | null }

export type StageCommitment = {
  client_id?: string | null
  month?: number | null
  year?: number | null
  reel_quota?: number | null
  carousel_quota?: number | null
  story_quota?: number | null
  static_quota?: number | null
  video_quota?: number | null
  other_quota?: number | null
}

export type ClientStagesRow = {
  client_id: string
  client_name: string
  /** the month's promised total, or null when no agreement line exists */
  contracted: number | null
  produced: number
  delivered: number
  published: number
}

/** A card is produced once it has reached the quality check or gone past it. */
export const PRODUCED_STATUSES: readonly string[] = [
  'quality_check', 'client_review', 'client_changes_requested', 'approved_for_scheduling', 'scheduled', 'published',
]

/** "2026-09" for an instant, on this zone's calendar; null for a bad date. */
export function monthKeyIn(iso: string | number | Date | null | undefined, tz: string): string | null {
  if (iso === null || iso === undefined || iso === '') return null
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(d)
    const year = parts.find(p => p.type === 'year')?.value
    const month = parts.find(p => p.type === 'month')?.value
    return year && month ? `${year}-${month}` : null
  } catch {
    return null
  }
}

const QUOTA_KEYS = ['reel_quota', 'carousel_quota', 'story_quota', 'static_quota', 'video_quota', 'other_quota'] as const

/** The month's promised total for one client, or null with no commitment row. */
export function contractedFor(rows: readonly StageCommitment[], clientId: string, monthKey: string): number | null {
  const [y, m] = monthKey.split('-').map(Number)
  const mine = rows.filter(r => r.client_id === clientId && Number(r.year) === y && Number(r.month) === m)
  if (mine.length === 0) return null
  return mine.reduce((sum, r) => sum + QUOTA_KEYS.reduce((n, k) => n + (Number(r[k]) || 0), 0), 0)
}

/** The earliest status change per card into any of `statuses`. */
function earliestInto(activity: readonly StageActivity[], statuses: readonly string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const a of activity) {
    if (a.entity_type !== 'content_item' || a.action !== 'status_change') continue
    const to = String(a.new_value ?? '')
    if (!statuses.includes(to)) continue
    const id = String(a.entity_id ?? '')
    const at = String(a.created_at ?? '')
    if (!id || !at) continue
    const had = out.get(id)
    if (!had || at < had) out.set(id, at)
  }
  return out
}

export function monthStages(input: {
  now: string | Date
  items: readonly StageItem[]
  activity: readonly StageActivity[]
  clients: readonly StageClient[]
  commitments: readonly StageCommitment[]
  /** null = every client (a super admin); a list = the clients this person runs */
  clientIds: readonly string[] | null
  defaultTz: string
}): ClientStagesRow[] {
  const produced = earliestInto(input.activity, PRODUCED_STATUSES)
  const published = earliestInto(input.activity, ['published'])
  const byClient = new Map<string, { produced: number; delivered: number; published: number }>()
  const zoneOf = new Map(input.clients.map(c => [c.id, c.timezone || input.defaultTz]))
  const bump = (id: string, key: 'produced' | 'delivered' | 'published') => {
    const row = byClient.get(id) ?? { produced: 0, delivered: 0, published: 0 }
    row[key] += 1
    byClient.set(id, row)
  }
  for (const it of input.items) {
    const cid = String(it.client_id ?? '')
    if (!cid) continue
    if (input.clientIds !== null && !input.clientIds.includes(cid)) continue
    const tz = zoneOf.get(cid) ?? input.defaultTz
    const thisMonth = monthKeyIn(input.now, tz)
    if (!thisMonth) continue
    const producedAt = produced.get(it.id) ?? it.delivered_at ?? null
    if (producedAt && monthKeyIn(producedAt, tz) === thisMonth) bump(cid, 'produced')
    if (it.delivered_at && monthKeyIn(it.delivered_at, tz) === thisMonth) bump(cid, 'delivered')
    const publishedAt = published.get(it.id) ?? null
    if (publishedAt && monthKeyIn(publishedAt, tz) === thisMonth) bump(cid, 'published')
  }
  const rows: ClientStagesRow[] = []
  for (const c of input.clients) {
    if (input.clientIds !== null && !input.clientIds.includes(c.id)) continue
    const tz = c.timezone || input.defaultTz
    const thisMonth = monthKeyIn(input.now, tz)
    const counts = byClient.get(c.id) ?? { produced: 0, delivered: 0, published: 0 }
    const contracted = thisMonth ? contractedFor(input.commitments, c.id, thisMonth) : null
    if (contracted === null && counts.produced === 0 && counts.delivered === 0 && counts.published === 0) continue
    rows.push({ client_id: c.id, client_name: c.name, contracted, ...counts })
  }
  return rows.sort((a, b) => a.client_name.localeCompare(b.client_name))
}

/** "3 of 4 delivered · 5 produced · 2 published" — the same three words everywhere. */
export function stagesLine(row: ClientStagesRow): string {
  const delivered = row.contracted !== null ? `${row.delivered} of ${row.contracted} delivered` : `${row.delivered} delivered`
  return `${delivered} · ${row.produced} produced · ${row.published} published`
}

/** Behind: the month has a promise and delivery is short of it with the month more than two-thirds gone. */
export function stagesTone(row: ClientStagesRow, now: string | Date, tz: string): 'green' | 'amber' | 'muted' {
  if (row.contracted === null || row.contracted === 0) return 'muted'
  if (row.delivered >= row.contracted) return 'green'
  const d = new Date(now)
  const day = Number(new Intl.DateTimeFormat('en-CA', { timeZone: tz, day: '2-digit' }).format(d))
  return day > 20 ? 'amber' : 'muted'
}

export const NO_STAGES_THIS_MONTH = 'Nothing produced, delivered or published this month yet.'
