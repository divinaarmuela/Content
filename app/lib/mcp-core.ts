/**
 * The connector's pure half: what a question may ask for and how an answer is shaped. No I/O.
 * Everything here is READ ONLY by construction: it only turns rows into words.
 */
import type { AnalyticsPost } from './social-analytics-core'

export const MAX_DAYS = 92
export const MAX_ROWS = 100

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** the days a question covers, or the reason it cannot be answered */
export function readRange(from: unknown, to: unknown): { ok: true; from: string; to: string } | { ok: false; reason: string } {
  if (typeof from !== 'string' || typeof to !== 'string' || !DAY.test(from) || !DAY.test(to)) {
    return { ok: false, reason: 'Give the days as YYYY-MM-DD, for example from 2026-11-01 to 2026-11-23.' }
  }
  const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { ok: false, reason: 'One of those days is not a real date.' }
  if (b < a) return { ok: false, reason: 'The last day is before the first day.' }
  if ((b - a) / 86_400_000 > MAX_DAYS) return { ok: false, reason: `That is more than ${MAX_DAYS} days. Ask for a shorter stretch.` }
  return { ok: true, from, to }
}

/** the client a name or id points at: an exact id, an exact name, or the one name that contains the words */
export function findClient<T extends { id: string; name?: string | null }>(clients: readonly T[], asked: unknown):
  { ok: true; client: T } | { ok: false; reason: string } {
  const q = typeof asked === 'string' ? asked.trim().toLowerCase() : ''
  if (!q) return { ok: false, reason: 'Say which client.' }
  const byId = clients.find(c => c.id.toLowerCase() === q)
  if (byId) return { ok: true, client: byId }
  const exact = clients.filter(c => (c.name ?? '').trim().toLowerCase() === q)
  if (exact.length === 1) return { ok: true, client: exact[0] }
  const near = clients.filter(c => (c.name ?? '').toLowerCase().includes(q))
  if (near.length === 1) return { ok: true, client: near[0] }
  if (near.length > 1) return { ok: false, reason: `More than one client matches: ${near.slice(0, 8).map(c => c.name).join(', ')}. Say which.` }
  return { ok: false, reason: `No client is called "${String(asked).trim()}". Use list_clients to see their names.` }
}

const STAGE_WORDS: Record<string, string> = {
  draft: 'Draft', quality_check: 'At the quality check', with_client: 'With the client', ready: 'Ready to post',
  booked: 'Booked in', posted: 'Posted', cancelled: 'Cancelled',
}
export const STAGES = Object.keys(STAGE_WORDS)
export const stageWord = (stage: unknown): string => STAGE_WORDS[String(stage)] ?? String(stage ?? 'unknown')

export type PostRowLike = {
  id: string; client_id?: string | null; stage?: string | null; scheduled_for?: string | null; caption?: string | null
  channels?: unknown; slides?: unknown; timezone?: string | null
}

/** one post on the schedule, as a question's answer: no file addresses, no ids beyond its own */
export function schedulePost(p: PostRowLike, clientName: string | null, networkOf: (accountId: string) => string | null) {
  const channels = Array.isArray(p.channels) ? p.channels.map(String) : []
  const slides = Array.isArray(p.slides) ? p.slides as { type?: string }[] : []
  return {
    id: p.id,
    client: clientName,
    stage: stageWord(p.stage),
    goes_out: p.scheduled_for ?? null,
    time_zone: p.timezone ?? 'Australia/Melbourne',
    networks: [...new Set(channels.map(networkOf).filter((x): x is string => !!x))],
    files: slides.length,
    videos: slides.filter(s => s?.type === 'video').length,
    caption: (p.caption ?? '').slice(0, 600),
  }
}

/** the posts between two instants, by stage if asked, soonest first, capped */
export function pickSchedule<T extends PostRowLike>(rows: readonly T[], o: { fromMs: number; toMs: number; clientId?: string | null; stage?: string | null }): T[] {
  return rows
    .filter(p => !o.clientId || p.client_id === o.clientId)
    .filter(p => !o.stage || p.stage === o.stage)
    .filter(p => { const t = p.scheduled_for ? Date.parse(p.scheduled_for) : NaN; return Number.isFinite(t) && t >= o.fromMs && t <= o.toMs })
    .sort((a, b) => String(a.scheduled_for).localeCompare(String(b.scheduled_for)))
    .slice(0, MAX_ROWS)
}

/** one published post and its numbers */
export function publishedPost(p: AnalyticsPost, clientName: string | null) {
  const m = p.metrics
  return {
    client: clientName,
    network: p.platform,
    published: p.publishedAt,
    kind: p.mediaType,
    link: p.url,
    caption: (p.content ?? '').slice(0, 400),
    views: m.views, reach: m.reach, likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saves,
    engagement: m.likes + m.comments + m.shares + m.saves,
    numbers_last_read: p.updatedAt,
  }
}
export type PublishedRow = ReturnType<typeof publishedPost>

export const SORTS = ['views', 'reach', 'engagement', 'likes', 'comments', 'shares', 'saves', 'newest'] as const
export type SortKey = typeof SORTS[number]

export function sortPublished(rows: readonly PublishedRow[], by: SortKey): PublishedRow[] {
  const list = [...rows]
  if (by === 'newest') return list.sort((a, b) => String(b.published).localeCompare(String(a.published)))
  return list.sort((a, b) => b[by] - a[by])
}

/** totals per client, most viewed first */
export function totalsByClient(rows: readonly PublishedRow[]) {
  const by = new Map<string, { client: string; posts: number; views: number; reach: number; engagement: number }>()
  for (const r of rows) {
    const k = r.client ?? 'Unknown'
    const t = by.get(k) ?? { client: k, posts: 0, views: 0, reach: 0, engagement: 0 }
    t.posts += 1; t.views += r.views; t.reach += r.reach; t.engagement += r.engagement
    by.set(k, t)
  }
  return [...by.values()].sort((a, b) => b.views - a.views)
}
