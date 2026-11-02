/**
 * A CHANNEL'S DEEP ANALYTICS (the owner, 2 Nov 2026: "let's add this in detail, no misses, and LinkedIn too") —
 * Instagram's account numbers, followers, audience, Stories and tagged posts; TikTok's account; Facebook's Page and
 * audience; LinkedIn's page or profile and its followers' make-up. Pure: Zernio's replies in, the page's numbers out.
 *
 * Every address and every field here was read live from Zernio on 2 Nov 2026 (its OpenAPI spec v1.436.0 plus real
 * calls on MD Media's own Instagram, the test accounts, and read-only reads of client pages) — not from memory.
 */

export type Point = { date: string; value: number }
export type Slice = { label: string; value: number; id?: string }

/** Zernio's account-insights envelope (Instagram, TikTok, Facebook, LinkedIn pages all share it):
 *  `{ metrics: { [name]: { total, values?: [{date, value}], breakdowns?: [{dimension, value}] } }, unavailableMetrics?, dataDelay? }` */
export type Envelope = {
  totals: Record<string, number>
  series: Record<string, Point[]>
  breakdowns: Record<string, Slice[]>
  unavailable: string[]
  delay: string | null
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function readEnvelope(body: unknown): Envelope {
  const b = (body ?? {}) as { metrics?: Record<string, unknown>; unavailableMetrics?: unknown; dataDelay?: unknown }
  const out: Envelope = { totals: {}, series: {}, breakdowns: {}, unavailable: [], delay: typeof b.dataDelay === 'string' ? b.dataDelay : null }
  for (const [name, raw] of Object.entries(b.metrics ?? {})) {
    const m = (raw ?? {}) as { total?: unknown; values?: unknown; breakdowns?: unknown }
    out.totals[name] = num(m.total)
    if (Array.isArray(m.values)) {
      out.series[name] = m.values
        .map(v => (v ?? {}) as { date?: unknown; value?: unknown })
        .filter(v => typeof v.date === 'string')
        .map(v => ({ date: String(v.date).slice(0, 10), value: num(v.value) }))
        .sort((x, y) => x.date.localeCompare(y.date))
    }
    if (Array.isArray(m.breakdowns)) out.breakdowns[name] = sortSlices(m.breakdowns)
  }
  if (Array.isArray(b.unavailableMetrics)) {
    out.unavailable = b.unavailableMetrics.map(u => (typeof u === 'string' ? u : String((u as { metric?: unknown })?.metric ?? ''))).filter(Boolean)
  }
  return out
}

/** `[{dimension, value, id?}]` → biggest first. Zernio does not sort them. */
export function sortSlices(list: unknown): Slice[] {
  if (!Array.isArray(list)) return []
  return list
    .map(x => (x ?? {}) as { dimension?: unknown; value?: unknown; id?: unknown })
    .filter(x => x.dimension !== undefined && x.dimension !== null && x.dimension !== '')
    .map(x => ({ label: String(x.dimension), value: num(x.value), ...(typeof x.id === 'string' ? { id: x.id } : {}) }))
    .sort((a, b) => b.value - a.value)
}

/** Demographics `{ age: [...], gender: [...], ... }` → sorted slices per breakdown; empty breakdowns dropped. */
export function readDemographics(body: unknown): Record<string, Slice[]> {
  const d = ((body ?? {}) as { demographics?: Record<string, unknown> }).demographics ?? {}
  const out: Record<string, Slice[]> = {}
  for (const [k, v] of Object.entries(d)) {
    const s = sortSlices(v)
    if (s.length) out[k] = s
  }
  return out
}

/** Facebook's daily values carry Meta's end-of-day stamp — a day LATE (asking 29 Oct–1 Nov gave 30 Oct–2 Nov,
 *  read live 2 Nov 2026). Moved back a day so each value sits on the day it counts. */
export function shiftDays(points: readonly Point[], by: number): Point[] {
  return points.map(p => {
    const d = new Date(`${p.date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + by)
    return { date: d.toISOString().slice(0, 10), value: p.value }
  })
}

/** Account-level numbers reach back at most 90 days a request (toDate − fromDate ≤ 89; a 91-day ask is a 400). A
 *  longer range keeps its LAST 90 days, and says so. */
export function clampRange(range: { from: string; to: string }, maxDays = 90): { from: string; to: string; clamped: boolean } {
  const ms = (d: string) => Date.parse(`${d}T00:00:00Z`)
  const days = Math.round((ms(range.to) - ms(range.from)) / 86_400_000) + 1
  if (!(days > maxDays)) return { ...range, clamped: false }
  const f = new Date(ms(range.to)); f.setUTCDate(f.getUTCDate() - (maxDays - 1))
  return { from: f.toISOString().slice(0, 10), to: range.to, clamped: true }
}

/**
 * A refusal in plain words — what the platform will not give, and what would make it give it. Zernio's own codes,
 * read live: tagged posts and collaborators need an Instagram connected through Facebook Login; 412 is a missing
 * permission (reconnect); 402 the analytics add-on; LinkedIn's company-page call refuses a personal profile.
 */
export function refusalWords(status: number, body: unknown, platform: string): string {
  const b = (body ?? {}) as { code?: unknown; error?: unknown; message?: unknown }
  const code = typeof b.code === 'string' ? b.code : ''
  const said = typeof b.error === 'string' ? b.error : typeof b.message === 'string' ? b.message : ''
  if (/requires?_facebook_login/.test(code) || /Facebook Login/i.test(said)) {
    return 'Instagram only gives this to accounts connected through Facebook Login. Reconnect this Instagram through its Facebook Page to see it.'
  }
  if (status === 412) return `This ${platform} connection is missing the permission for these numbers. Reconnecting the account fixes it.`
  if (status === 402) return 'These numbers need the analytics add-on on the posting service.'
  if (status === 401 || status === 403) return 'The posting service would not let us read these numbers.'
  if (status === 0) return 'The posting service did not answer. Try again in a moment.'
  return said ? `The platform did not give these numbers: ${said.slice(0, 160)}` : 'The platform did not give these numbers.'
}

/** "12.9 s", "4 min 10 s", "38 h" — from milliseconds. */
export function durationWords(ms: number): string {
  if (!(ms > 0)) return '—'
  const s = ms / 1000
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`
  const m = Math.floor(s / 60), r = Math.round(s % 60)
  if (m < 60) return r ? `${m} min ${r} s` : `${m} min`
  const h = s / 3600
  return h < 100 ? `${h.toFixed(1)} h` : `${Math.round(h).toLocaleString('en-AU')} h`
}

/** A fraction (0–1) as "98%"/"1.3%". */
export function pct(fraction: number): string {
  const p = fraction * 100
  return `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)}%`
}

// ── one post's deeper numbers ────────────────────────────────────────────────────────────────────────────────────

/** How long people kept watching: second → share still watching (0–1). Keys are whole seconds; TikTok gives at most
 *  61 points (thinned on long videos), Facebook Reels at most 41 (so only the first 40 s). */
export function readRetention(raw: unknown): { sec: number; share: number }[] {
  if (!raw || typeof raw !== 'object') return []
  return Object.entries(raw as Record<string, unknown>)
    .map(([k, v]) => ({ sec: Number(k), share: num(v) }))
    .filter(p => Number.isFinite(p.sec))
    .sort((a, b) => a.sec - b.sec)
}

/** `{ AU: 0.951, other: 0.014 }` → slices, biggest first (shares 0–1). */
export function readShares(raw: unknown): Slice[] {
  if (!raw || typeof raw !== 'object') return []
  return Object.entries(raw as Record<string, unknown>)
    .map(([label, v]) => ({ label, value: num(v) }))
    .filter(s => s.value > 0)
    .sort((a, b) => b.value - a.value)
}

export type PostDeep = {
  platformPostId: string | null
  avgWatchMs: number
  totalWatchMs: number
  completionRate: number
  profileViews: number
  follows: number
  websiteClicks: number
  replays: number
  durationSec: number | null
  countries: Slice[]
  audienceTypes: Slice[]
  sources: Slice[]
  retention: { sec: number; share: number }[]
}

/** The deeper per-post fields Zernio's /analytics rows carry (filled on TikTok Business connections and Facebook
 *  Reels; `{}`/0 elsewhere). Units read live: watch times in ms, completion and every share 0–1. */
export function readPostDeep(raw: unknown): PostDeep {
  const r = (raw ?? {}) as Record<string, unknown>
  const first = ((Array.isArray(r.platforms) ? r.platforms[0] : Array.isArray(r.platformAnalytics) ? r.platformAnalytics[0] : null) ?? {}) as Record<string, unknown>
  const a = (r.analytics ?? first.analytics ?? {}) as Record<string, unknown>
  return {
    platformPostId: typeof first.platformPostId === 'string' ? first.platformPostId : null,
    avgWatchMs: num(a.igReelsAvgWatchTime),
    totalWatchMs: num(a.igReelsVideoViewTotalTime),
    completionRate: num(a.completionRate),
    profileViews: num(a.profileViews),
    follows: num(a.follows),
    websiteClicks: num(a.websiteClicks),
    replays: num(a.replays),
    durationSec: typeof a.videoDurationSeconds === 'number' ? a.videoDurationSeconds : null,
    countries: readShares(a.audienceCountries),
    audienceTypes: readShares(a.audienceTypes),
    sources: readShares(a.impressionSources),
    retention: readRetention(a.retentionCurve),
  }
}

/** Words for TikTok's view sources and audience types (Zernio's keys, read live). */
export const SOURCE_WORDS: Record<string, string> = {
  forYou: 'For You feed', follow: 'Following feed', personalProfile: 'Their profile', search: 'Search',
  sound: 'Sound page', directMessage: 'Direct messages', other: 'Other',
}
export const AUDIENCE_WORDS: Record<string, string> = {
  follower: 'Followers', nonFollower: 'Not following', newViewer: 'New viewers', returnViewer: 'Returning viewers',
}

// ── which sections a channel has ─────────────────────────────────────────────────────────────────────────────────

export type SectionKey = 'account' | 'followers' | 'audience' | 'stories' | 'tagged' | 'page'

/** The tabs a channel's page shows beside Posts, per network. */
export function sectionsFor(platform: string): { key: SectionKey; label: string }[] {
  switch (platform) {
    case 'instagram': return [
      { key: 'account', label: 'Account' }, { key: 'followers', label: 'Followers' }, { key: 'audience', label: 'Audience' },
      { key: 'stories', label: 'Stories' }, { key: 'tagged', label: 'Tagged' },
    ]
    case 'tiktok': return [{ key: 'account', label: 'Account' }]
    case 'facebook': return [{ key: 'page', label: 'Page' }, { key: 'audience', label: 'Audience' }]
    case 'linkedin': return [{ key: 'page', label: 'Page' }, { key: 'audience', label: 'Followers’ make-up' }]
    default: return []
  }
}
