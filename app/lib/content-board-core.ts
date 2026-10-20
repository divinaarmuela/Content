/**
 * THE CONTENT TRACKER, OUR OWN WAY (the owner, 20 Oct 2026: "create our own just pull post analytics for each client
 * regarding reels story etc published or scheduled so we can read nicely … so anyone knows what's going on").
 *
 * One item per piece of content in Zernio for the month — a post on three networks is one item — either PUBLISHED
 * through Zernio (with its numbers, summed across its networks) or SCHEDULED there and still to go. A client's own
 * posts on the network are not ours and are left out (Pattons, 20 Oct 2026). Pure: the route fetches, this shapes.
 */

import { monthKey } from './content-tracker-core'

export type ItemKind = 'reel' | 'story' | 'graphic' | 'text'
export const KINDS: readonly ItemKind[] = ['reel', 'story', 'graphic', 'text']
export const KIND_WORDS: Record<ItemKind, { one: string; many: string }> = {
  reel: { one: 'Reel', many: 'Reels' },
  story: { one: 'Story', many: 'Stories' },
  graphic: { one: 'Graphic', many: 'Graphics' },
  text: { one: 'Text post', many: 'Text posts' },
}

export type ItemMetrics = { views: number; likes: number; comments: number; shares: number; saves: number }

export type BoardItem = ItemMetrics & {
  key: string
  clientId: string | null
  kind: ItemKind
  state: 'published' | 'scheduled'
  at: string
  caption: string
  thumbnail: string | null
  /** the networks it goes or went to, each with its live link once published */
  networks: { platform: string; url: string | null }[]
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {})
const listOf = (raw: unknown): unknown[] => (Array.isArray(obj(raw).posts) ? obj(raw).posts as unknown[] : Array.isArray(raw) ? raw : [])
const accountIdOf = (v: unknown): string | null => str(v) ?? str(obj(v)._id)

function kindOfPublished(p: Record<string, unknown>): ItemKind {
  const product = String(p.mediaProductType ?? '').toUpperCase()
  const media = String(p.mediaType ?? '').toLowerCase()
  const items = Array.isArray(p.mediaItems) ? p.mediaItems.length : 0
  if (product === 'STORY') return 'story'
  if (product === 'REELS' || media === 'video') return 'reel'
  if (media === 'image' || media === 'photo' || media === 'carousel' || items > 0) return 'graphic'
  return 'text'
}

/**
 * Zernio's analytics list → published items. Each network of a post comes back as its own entry carrying the same
 * `latePostId`; they are one item, numbers summed. An entry with no `latePostId` was posted by the client on the
 * network — not ours, left out.
 */
export function publishedItems(raw: unknown, clientOf: (accountId: string | null) => string | null): BoardItem[] {
  const groups = new Map<string, BoardItem>()
  for (const r of listOf(raw)) {
    const p = obj(r)
    const late = str(p.latePostId)
    const at = str(p.publishedAt)
    if (!late || !at || (p.status && p.status !== 'published')) continue
    const plats = (Array.isArray(p.platforms) && p.platforms.length ? p.platforms : [{ platform: p.platform, platformPostUrl: p.platformPostUrl, analytics: p.analytics }]).map(obj)
    let item = groups.get(late)
    if (!item) {
      item = {
        key: `p:${late}`, clientId: null, kind: kindOfPublished(p), state: 'published', at,
        caption: (str(p.content) ?? '').trim(),
        thumbnail: str(p.thumbnailUrl) ?? str(obj((p.mediaItems as unknown[] | undefined)?.[0]).thumbnail),
        networks: [], views: 0, likes: 0, comments: 0, shares: 0, saves: 0,
      }
      groups.set(late, item)
    }
    if (at < item.at) item.at = at
    if (!item.thumbnail) item.thumbnail = str(p.thumbnailUrl)
    // a story on one network beside a reel on another: the reel is what the piece is
    if (item.kind === 'text' || (item.kind === 'story' && kindOfPublished(p) !== 'story')) item.kind = kindOfPublished(p)
    for (const x of plats) {
      if (x.status && x.status !== 'published') continue
      const platform = String(x.platform ?? p.platform ?? '').toLowerCase()
      if (!platform || item.networks.some(n => n.platform === platform)) continue
      item.clientId = item.clientId ?? clientOf(accountIdOf(x.accountId))
      item.networks.push({ platform, url: str(x.platformPostUrl) ?? str(p.platformPostUrl) })
      const a = obj(x.analytics ?? p.analytics)
      item.views += num(a.views) || num(a.impressions)
      item.likes += num(a.likes)
      item.comments += num(a.comments)
      item.shares += num(a.shares)
      item.saves += num(a.saves)
    }
  }
  return [...groups.values()]
}

/** Zernio's scheduled posts (GET /posts?status=scheduled) → scheduled items */
export function scheduledItems(raw: unknown, clientOf: (accountId: string | null) => string | null): BoardItem[] {
  const out: BoardItem[] = []
  for (const r of listOf(raw)) {
    const p = obj(r)
    const id = str(p._id) ?? str(p.id)
    const at = str(p.scheduledFor)
    if (!id || !at || (p.status && p.status !== 'scheduled')) continue
    const plats = (Array.isArray(p.platforms) ? p.platforms : []).map(obj)
    const media = (Array.isArray(p.mediaItems) ? p.mediaItems : []).map(obj)
    const storyOn = (x: Record<string, unknown>) => String(obj(x.platformSpecificData).contentType ?? '').toLowerCase() === 'story'
    const kind: ItemKind = plats.length > 0 && plats.every(storyOn) ? 'story'
      : media.length === 0 ? 'text' : media.some(m => m.type === 'video') ? 'reel' : 'graphic'
    out.push({
      key: `s:${id}`,
      clientId: plats.map(x => clientOf(accountIdOf(x.accountId))).find(Boolean) ?? null,
      kind, state: 'scheduled', at,
      caption: (str(p.content) ?? '').trim(),
      thumbnail: str(media[0]?.thumbnail) ?? (media[0]?.type === 'image' ? str(media[0]?.url) : null),
      networks: [...new Set(plats.map(x => String(x.platform ?? '').toLowerCase()).filter(Boolean))].map(platform => ({ platform, url: null })),
      views: 0, likes: 0, comments: 0, shares: 0, saves: 0,
    })
  }
  return out
}

export function itemsInMonth(items: readonly BoardItem[], month: string): BoardItem[] {
  return items.filter(i => monthKey(i.at) === month)
}

export type KindCount = { published: number; scheduled: number }

export type ClientBoard = {
  clientId: string
  counts: Record<ItemKind, KindCount>
  published: number
  scheduled: number
  networks: Record<string, number>
  metrics: ItemMetrics
  /** likes, comments, shares and saves over views, as a percent */
  engagement: number | null
  /** the last post still waiting in Zernio, any month */
  scheduledUntil: string | null
  /** the next post to go, any month */
  next: string | null
  top: BoardItem | null
  items: BoardItem[]
}

const ZERO_COUNTS = (): Record<ItemKind, KindCount> =>
  ({ reel: { published: 0, scheduled: 0 }, story: { published: 0, scheduled: 0 }, graphic: { published: 0, scheduled: 0 }, text: { published: 0, scheduled: 0 } })

/** a client's month: what is out, what is coming, by kind and network, and how it did */
export function clientBoard(clientId: string, month: readonly BoardItem[], waitingAnyMonth: readonly BoardItem[], now = Date.now()): ClientBoard {
  const items = month.filter(i => i.clientId === clientId).sort((a, b) => a.at.localeCompare(b.at))
  const counts = ZERO_COUNTS()
  const networks: Record<string, number> = {}
  const metrics: ItemMetrics = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 }
  for (const i of items) {
    counts[i.kind][i.state]++
    for (const n of i.networks) networks[n.platform] = (networks[n.platform] ?? 0) + 1
    if (i.state === 'published') for (const k of Object.keys(metrics) as (keyof ItemMetrics)[]) metrics[k] += i[k]
  }
  const waiting = waitingAnyMonth.filter(i => i.clientId === clientId).map(i => i.at).sort()
  const upcoming = waiting.filter(t => Date.parse(t) >= now)
  const published = items.filter(i => i.state === 'published')
  return {
    clientId, counts, networks, metrics,
    published: published.length,
    scheduled: items.length - published.length,
    engagement: metrics.views ? Math.round(((metrics.likes + metrics.comments + metrics.shares + metrics.saves) / metrics.views) * 1000) / 10 : null,
    scheduledUntil: waiting.pop() ?? null,
    next: upcoming[0] ?? null,
    top: [...published].sort((a, b) => b.views - a.views)[0] ?? null,
    items,
  }
}

/** busiest first */
export function boardOrder(a: ClientBoard, b: ClientBoard): number {
  return (b.published + b.scheduled) - (a.published + a.scheduled) || b.metrics.views - a.metrics.views
}

/** how far ahead a client is covered, in words, from today */
export function coverWords(until: string | null, now = Date.now()): { text: string; tone: 'good' | 'soon' | 'none' } {
  if (!until) return { text: 'Nothing scheduled ahead', tone: 'none' }
  const days = Math.floor((Date.parse(until) - now) / 86_400_000)
  if (days < 0) return { text: 'Nothing scheduled ahead', tone: 'none' }
  const date = new Date(until).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'Australia/Melbourne' })
  return { text: `Scheduled until ${date}`, tone: days < 7 ? 'soon' : 'good' }
}
