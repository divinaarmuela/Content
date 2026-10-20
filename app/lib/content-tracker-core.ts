/**
 * THE CONTENT TRACKER (the owner, 20 Oct 2026: "on the side links lets add a posted page which fetches everything
 * that's posted from zernio make it a nice page … create a post page called content tracker … month basis client
 * data for the posts"). Every post Zernio knows went live in a month — booked through this app or posted straight
 * on the network — per client, with its numbers. Zernio's `/analytics` list is the source (it covers posts made
 * outside the app; `/posts` does not). Pure: the route fetches, this shapes.
 */

export type TrackerPlatform = 'instagram' | 'tiktok' | 'linkedin' | 'facebook' | 'youtube' | 'twitter' | 'threads' | 'pinterest' | string

export type TrackerMetrics = {
  views: number
  reach: number
  likes: number
  comments: number
  shares: number
  saves: number
}

export type TrackerPost = TrackerMetrics & {
  id: string
  clientId: string | null
  platform: TrackerPlatform
  account: string | null
  accountId: string | null
  publishedAt: string
  url: string | null
  thumbnail: string | null
  kind: string
  caption: string
  /** posted through the app (Zernio) or straight on the network */
  via: 'app' | 'native'
  engagementRate: number | null
}

export type ClientMonth = TrackerMetrics & {
  clientId: string | null
  posts: number
  byPlatform: Record<string, number>
  engagementRate: number | null
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {})

/** what the post was, in the words the team uses */
export function kindOf(platform: string, mediaType: unknown, productType: unknown, itemCount: number): string {
  const p = String(productType ?? '').toUpperCase()
  const m = String(mediaType ?? '').toLowerCase()
  if (p === 'REELS') return 'Reel'
  if (p === 'STORY') return 'Story'
  if (itemCount > 1 || m === 'carousel') return platform === 'tiktok' ? 'Photo post' : 'Carousel'
  if (m === 'video') return platform === 'youtube' ? 'Video' : platform === 'instagram' ? 'Reel' : 'Video'
  if (m === 'image' || m === 'photo') return 'Photo'
  if (m === 'text' || !m) return 'Text'
  return m.charAt(0).toUpperCase() + m.slice(1)
}

/**
 * One row per network a Zernio analytics entry went out on. An entry names its networks in `platforms`; one with
 * none is read off its own `platform`. `clientOf` maps a Zernio account id to our client.
 */
export function trackerPosts(raw: unknown, clientOf: (accountId: string | null) => string | null): TrackerPost[] {
  const list = Array.isArray(obj(raw).posts) ? obj(raw).posts as unknown[] : Array.isArray(raw) ? raw as unknown[] : []
  const out: TrackerPost[] = []
  const seen = new Set<string>()
  for (const r of list) {
    const p = obj(r)
    const id = str(p._id) ?? str(p.id)
    const publishedAt = str(p.publishedAt) ?? str(p.scheduledFor)
    if (!id || !publishedAt || (p.status && p.status !== 'published')) continue
    const items = Array.isArray(p.mediaItems) ? p.mediaItems as unknown[] : []
    const caption = (str(p.content) ?? '').trim()
    const platforms = Array.isArray(p.platforms) && p.platforms.length
      ? p.platforms as unknown[]
      : [{ platform: p.platform, accountId: null, platformPostUrl: p.platformPostUrl, analytics: p.analytics, status: 'published' }]
    for (const x of platforms) {
      const pl = obj(x)
      if (pl.status && pl.status !== 'published') continue
      const platform = String(pl.platform ?? p.platform ?? 'unknown').toLowerCase()
      const accountId = str(pl.accountId)
      const key = `${id}:${platform}:${accountId ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      const a = obj(pl.analytics ?? p.analytics)
      const views = num(a.views) || num(a.impressions)
      const rate = typeof a.engagementRate === 'number' && Number.isFinite(a.engagementRate) ? a.engagementRate : null
      out.push({
        id: key,
        clientId: clientOf(accountId),
        platform,
        account: str(pl.accountUsername),
        accountId,
        publishedAt,
        url: str(pl.platformPostUrl) ?? str(p.platformPostUrl),
        thumbnail: str(p.thumbnailUrl) ?? str(obj(items[0]).thumbnail),
        kind: kindOf(platform, p.mediaType, p.mediaProductType, items.length),
        caption,
        via: str(p.latePostId) ? 'app' : 'native',
        engagementRate: rate,
        views,
        reach: num(a.reach),
        likes: num(a.likes),
        comments: num(a.comments),
        shares: num(a.shares),
        saves: num(a.saves),
      })
    }
  }
  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

/** 'YYYY-MM' of an instant, in the agency's zone */
export function monthKey(iso: string, tz = 'Australia/Melbourne'): string | null {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(new Date(t))
  const y = parts.find(x => x.type === 'year')?.value
  const m = parts.find(x => x.type === 'month')?.value
  return y && m ? `${y}-${m}` : null
}

/** the first and last day of a month, as Zernio's fromDate/toDate take them (a day either side, so the zone never
 *  drops a post at the edge — `inMonth` trims) */
export function monthRange(month: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2])
  if (mo < 1 || mo > 12) return null
  const from = new Date(Date.UTC(y, mo - 1, 0))
  const to = new Date(Date.UTC(y, mo, 1))
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

export function inMonth(posts: readonly TrackerPost[], month: string): TrackerPost[] {
  return posts.filter(p => monthKey(p.publishedAt) === month)
}

/** the month before or after, 'YYYY-MM' */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function monthWords(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const ZERO: TrackerMetrics = { views: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0 }

/** engagement per view, as a percent — likes, comments, shares and saves over views */
export function engagement(m: TrackerMetrics): number | null {
  if (!m.views) return null
  return Math.round(((m.likes + m.comments + m.shares + m.saves) / m.views) * 1000) / 10
}

export function totals(posts: readonly TrackerPost[]): TrackerMetrics & { posts: number; engagementRate: number | null } {
  const t = { ...ZERO }
  for (const p of posts) for (const k of Object.keys(ZERO) as (keyof TrackerMetrics)[]) t[k] += p[k]
  return { ...t, posts: posts.length, engagementRate: engagement(t) }
}

/** each client's month: posts, per network, numbers — busiest first; posts on accounts no client holds come last */
export function byClient(posts: readonly TrackerPost[]): ClientMonth[] {
  const groups = new Map<string | null, TrackerPost[]>()
  for (const p of posts) groups.set(p.clientId, [...(groups.get(p.clientId) ?? []), p])
  const out: ClientMonth[] = []
  for (const [clientId, list] of groups) {
    const byPlatform: Record<string, number> = {}
    for (const p of list) byPlatform[p.platform] = (byPlatform[p.platform] ?? 0) + 1
    const t = totals(list)
    out.push({ clientId, byPlatform, ...t })
  }
  return out.sort((a, b) => Number(a.clientId === null) - Number(b.clientId === null) || b.posts - a.posts || b.views - a.views)
}

/** the networks in the order the page draws them */
export const PLATFORM_ORDER = ['instagram', 'tiktok', 'facebook', 'linkedin', 'youtube', 'twitter', 'threads', 'pinterest']
export function platformsIn(posts: readonly { platform: string }[]): string[] {
  const have = new Set(posts.map(p => p.platform))
  return [...PLATFORM_ORDER.filter(p => have.has(p)), ...[...have].filter(p => !PLATFORM_ORDER.includes(p)).sort()]
}

/** 12.4k, 3.1M */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k`
  return String(n)
}

/* ── THE TRACKER: the team's sheet, one row per client per month ─────────────────────────────────────────────── */

/** one piece of content — a post counted once however many networks it went to */
export type PieceKind = 'graphic' | 'reel' | 'story' | 'text'
export type Piece = { key: string; clientId: string | null; kind: PieceKind; linkedin: boolean; at: string; state: 'posted' | 'booked' }

/** a Zernio account id, given as a string or as `{ _id }` */
export function accountIdOf(v: unknown): string | null {
  return str(v) ?? str(obj(v)._id)
}

/**
 * WHAT ZERNIO SAYS WAS PUBLISHED (the owner, 20 Oct 2026: "didn't i tell u to get from zernio whats published") —
 * every published post, booked through the app or not. The networks of one Zernio post (`latePostId`) are one
 * piece. `skip` is for a caller that counts some posts another way; the tracker passes none.
 */
export function piecesFromZernio(raw: unknown, clientOf: (accountId: string | null) => string | null, skip: ReadonlySet<string> = new Set()): Piece[] {
  const list = Array.isArray(obj(raw).posts) ? obj(raw).posts as unknown[] : []
  const groups = new Map<string, Piece>()
  for (const r of list) {
    const p = obj(r)
    const id = str(p._id)
    const at = str(p.publishedAt)
    const late = str(p.latePostId)
    // ONLY WHAT WENT OUT THROUGH ZERNIO (`latePostId`): a connected account's own posts are synced into this list
    // too — Pattons' 17 Instagram posts since July, none of them ours (the owner, 20 Oct 2026: "how come we have
    // pattons … we posted it?")
    if (!id || !at || !late || (p.status && p.status !== 'published') || skip.has(late)) continue
    const plats = Array.isArray(p.platforms) && p.platforms.length ? p.platforms as unknown[] : [{ platform: p.platform, accountId: null }]
    const first = obj(plats[0])
    const platform = String(first.platform ?? p.platform ?? '').toLowerCase()
    const items = Array.isArray(p.mediaItems) ? p.mediaItems.length : 0
    const product = String(p.mediaProductType ?? '').toUpperCase()
    const media = String(p.mediaType ?? '').toLowerCase()
    const kind: PieceKind = product === 'STORY' ? 'story'
      : media === 'video' || product === 'REELS' ? 'reel'
        : media === 'image' || media === 'photo' || media === 'carousel' || items > 0 ? 'graphic' : 'text'
    const key = late
    const linkedin = plats.some(x => String(obj(x).platform ?? '').toLowerCase() === 'linkedin') || platform === 'linkedin'
    const had = groups.get(key)
    if (had) { had.linkedin = had.linkedin || linkedin; if (at > had.at) had.at = at; continue }
    groups.set(key, { key: `z:${key}`, clientId: clientOf(accountIdOf(first.accountId)), kind, linkedin, at, state: 'posted' })
  }
  return [...groups.values()]
}

/** the app's own posts that are Booked in or Posted: one piece each, and a story beside it when some of its
 *  channels post it as one */
export function piecesFromApp(
  posts: readonly { id: string; client_id: string; stage: string; scheduled_for?: string | null; slides?: unknown; channels?: unknown; per_channel?: unknown }[],
  platformOf: (accountId: string) => string | null,
): Piece[] {
  const out: Piece[] = []
  for (const p of posts) {
    if ((p.stage !== 'booked' && p.stage !== 'posted') || !p.scheduled_for) continue
    const channels = (Array.isArray(p.channels) ? p.channels : []).map(String)
    const per = obj(p.per_channel)
    const story = (c: string) => obj(per[c]).kind === 'story'
    const slides = Array.isArray(p.slides) ? p.slides.map(obj) : []
    const video = slides.some(s => s.type === 'video')
    const linkedin = channels.some(c => platformOf(c) === 'linkedin')
    const state = p.stage === 'posted' ? 'posted' as const : 'booked' as const
    const base = { clientId: p.client_id, linkedin, at: p.scheduled_for, state }
    if (channels.length === 0 || channels.some(c => !story(c))) {
      out.push({ ...base, key: `a:${p.id}`, kind: slides.length === 0 ? 'text' : video ? 'reel' : 'graphic' })
    }
    if (channels.some(story)) out.push({ ...base, key: `a:${p.id}:story`, kind: 'story', linkedin: false })
  }
  return out
}

/**
 * THE POSTS WAITING IN ZERNIO (GET /posts?status=scheduled), as pieces: the sheet's "Scheduled" for a month is what
 * Zernio has for it, gone out or still to go (the owner, 20 Oct 2026: "do u even read what the column says"). A post
 * on several networks is one piece; a story is one when any network posts it as a story.
 */
export function piecesFromZernioScheduled(raw: unknown, clientOf: (accountId: string | null) => string | null): Piece[] {
  const list = Array.isArray(obj(raw).posts) ? obj(raw).posts as unknown[] : Array.isArray(raw) ? raw as unknown[] : []
  const out: Piece[] = []
  for (const r of list) {
    const p = obj(r)
    const id = str(p._id) ?? str(p.id)
    const at = str(p.scheduledFor)
    if (!id || !at || (p.status && p.status !== 'scheduled')) continue
    const plats = (Array.isArray(p.platforms) ? p.platforms : []).map(obj)
    const clientId = plats.map(x => clientOf(accountIdOf(x.accountId))).find(Boolean) ?? null
    const items = (Array.isArray(p.mediaItems) ? p.mediaItems : []).map(obj)
    const story = plats.some(x => String(obj(x.platformSpecificData).contentType ?? '').toLowerCase() === 'story')
    const feed = plats.some(x => String(obj(x.platformSpecificData).contentType ?? '').toLowerCase() !== 'story')
    const linkedin = plats.some(x => String(x.platform ?? '').toLowerCase() === 'linkedin')
    const kind: PieceKind = items.length === 0 ? 'text' : items.some(m => m.type === 'video') ? 'reel' : 'graphic'
    if (feed || plats.length === 0) out.push({ key: `zs:${id}`, clientId, kind, linkedin, at, state: 'booked' })
    if (story) out.push({ key: `zs:${id}:story`, clientId, kind: 'story', linkedin: false, at, state: 'booked' })
  }
  return out
}

/** each client's last post waiting in Zernio (GET /posts?status=scheduled): how far ahead they are covered */
export function scheduledUntilByClient(raw: unknown, clientOf: (accountId: string | null) => string | null): Map<string, string> {
  const list = Array.isArray(obj(raw).posts) ? obj(raw).posts as unknown[] : Array.isArray(raw) ? raw as unknown[] : []
  const out = new Map<string, string>()
  for (const r of list) {
    const p = obj(r)
    const at = str(p.scheduledFor)
    if (!at || (p.status && p.status !== 'scheduled')) continue
    for (const x of Array.isArray(p.platforms) ? p.platforms as unknown[] : []) {
      const c = clientOf(accountIdOf(obj(x).accountId))
      if (c && (!out.has(c) || at > out.get(c)!)) out.set(c, at)
    }
  }
  return out
}

export type TrackerInput = {
  required_graphics?: number | null
  required_reels?: number | null
  notes?: string | null
  responsible?: string | null
  in_asana?: boolean | null
}
export type TrackerStatus = 'Complete' | 'In progress' | 'Not started' | 'No target set'

export type TrackerLine = {
  clientId: string
  graphics: { required: number | null; scheduled: number }
  reels: { required: number | null; scheduled: number }
  stories: number
  linkedin: number
  /** the last post waiting in Zernio — how far ahead the client is covered; else the last one published */
  scheduledUntil: string | null
  status: TrackerStatus
  needed: string | null
  notes: string
  responsible: string
  inAsana: boolean
  /** the targets were carried from last month, not typed for this one */
  carried: boolean
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/**
 * One client's month, as the sheet has it. Targets are this month's own, else last month's carried over (a client's
 * package rarely changes month to month). "Scheduled" counts what Zernio says was published in the month.
 */
export function trackerLine(
  clientId: string,
  pieces: readonly Piece[],
  month: string,
  row: TrackerInput | null | undefined,
  previous: TrackerInput | null | undefined,
  defaultResponsible = '',
  scheduledUntil: string | null = null,
): TrackerLine {
  const all = pieces.filter(p => p.clientId === clientId)
  const mine = all.filter(p => monthKey(p.at) === month)
  const count = (k: PieceKind) => mine.filter(p => p.kind === k).length
  const own = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const reqG = own(row?.required_graphics) ?? own(previous?.required_graphics)
  const reqR = own(row?.required_reels) ?? own(previous?.required_reels)
  const carried = (own(row?.required_graphics) === null && own(previous?.required_graphics) !== null)
    || (own(row?.required_reels) === null && own(previous?.required_reels) !== null)
  const graphics = { required: reqG, scheduled: count('graphic') }
  const reels = { required: reqR, scheduled: count('reel') }
  const short: string[] = []
  if (reqG !== null && graphics.scheduled < reqG) short.push(plural(reqG - graphics.scheduled, 'graphic'))
  if (reqR !== null && reels.scheduled < reqR) short.push(plural(reqR - reels.scheduled, 'reel'))
  const status: TrackerStatus = reqG === null && reqR === null ? 'No target set'
    : short.length === 0 ? 'Complete'
      : graphics.scheduled + reels.scheduled === 0 ? 'Not started' : 'In progress'
  return {
    clientId, graphics, reels,
    stories: count('story'),
    linkedin: mine.filter(p => p.linkedin).length,
    scheduledUntil: scheduledUntil ?? all.map(p => p.at).sort().pop() ?? null,
    status,
    needed: short.length ? short.join(', ') : null,
    notes: row?.notes ?? '',
    responsible: row?.responsible ?? defaultResponsible,
    inAsana: row?.in_asana === true,
    carried,
  }
}

/** a person's edit to a row, made safe: whole numbers 0 to 999, short text, a yes or no */
export function sanitiseTrackerPatch(raw: unknown): TrackerInput {
  const r = obj(raw)
  const out: TrackerInput = {}
  for (const k of ['required_graphics', 'required_reels'] as const) {
    if (!(k in r)) continue
    const v = r[k]
    if (v === null || v === '') { out[k] = null; continue }
    const n = Math.round(Number(v))
    if (Number.isFinite(n) && n >= 0 && n <= 999) out[k] = n
  }
  for (const k of ['notes', 'responsible'] as const) {
    if (k in r) out[k] = typeof r[k] === 'string' ? (r[k] as string).trim().slice(0, k === 'notes' ? 1000 : 120) : null
  }
  if ('in_asana' in r) out.in_asana = r.in_asana === true
  return out
}

export const trackerRowId = (clientId: string, month: string) => `${clientId}__${month}`

/** the sheet's order: unfinished first, then complete, then no target */
export function trackerOrder(a: TrackerLine, b: TrackerLine, name: (id: string) => string): number {
  const rank: Record<TrackerStatus, number> = { 'Not started': 0, 'In progress': 1, Complete: 2, 'No target set': 3 }
  return rank[a.status] - rank[b.status] || name(a.clientId).localeCompare(name(b.clientId))
}
