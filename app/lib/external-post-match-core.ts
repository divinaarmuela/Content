/**
 * Matching a hand-posted link to the post the platform already knows about.
 *
 * When a scheduler posts on Instagram themselves and then pastes the live URL
 * onto the item card, nothing in this app ever spoke to the provider about that
 * post — there is no `publish_jobs` row, no `provider_post_id`, and therefore
 * no way for the analytics cache to find its numbers. The provider does know
 * about it: its background sync lists posts made directly on the platform as
 * "external posts", with their own `_id` and their public URL.
 *
 * So the join is the URL. This module is that join, and it is pure: no
 * provider, no database, no clock unless one is handed in.
 *
 * Two rules:
 *
 *   1. **The shortcode is the identity.** `instagram.com/p/ABC` and
 *      `instagram.com/reel/ABC/?utm_source=ig_web_copy_link` are the same post
 *      — Instagram serves a Reel under both paths and appends tracking to
 *      whatever the "Copy link" button produced. Comparing URLs as strings
 *      would match neither, and a scheduler who pasted a perfectly good link
 *      would be told their post could not be found.
 *   2. **Never guess between two.** The time-window fallback exists for the
 *      post recorded with NO url at all ("Mark as posted" on a Story). It
 *      answers only when exactly one post could possibly be meant; two
 *      candidates is silence, because attaching the wrong post's numbers to a
 *      client's item is worse than attaching none.
 */

/** The platforms whose URLs we can read the identity out of. */
export type MatchablePlatform = 'instagram' | 'facebook' | 'tiktok' | 'linkedin'

/** Host prefixes that mean the same site: mobile links, the www, the m. */
const HOST_PREFIX = /^(www|m|mobile|web)\./

/** A post's identity, as far as a URL can tell us. */
export type CanonicalKey = string

/** Case-preserving: a shortcode is base64-ish and `AbC` is not `abc`. */
function segmentsOf(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean)
}

/** The segment AFTER the first of `markers`, when there is one. */
function afterMarker(segments: string[], markers: string[]): string | null {
  for (let i = 0; i < segments.length - 1; i++) {
    if (markers.includes(segments[i].toLowerCase())) return segments[i + 1] || null
  }
  return null
}

/** Which platform a public post URL belongs to, or null for anything else. */
export function platformOfUrl(raw: unknown): MatchablePlatform | null {
  const url = parseUrl(raw)
  if (!url) return null
  const host = url.hostname.toLowerCase()
  if (host.includes('instagram.com')) return 'instagram'
  if (host.includes('tiktok.com')) return 'tiktok'
  if (host.includes('linkedin.com') || host.includes('lnkd.in')) return 'linkedin'
  if (host.includes('facebook.com') || host.includes('fb.com') || host.includes('fb.watch')) {
    return 'facebook'
  }
  return null
}

function parseUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text) return null
  // people paste `instagram.com/p/ABC` as often as they paste the whole thing
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`
  try {
    return new URL(withScheme)
  } catch {
    return null
  }
}

/**
 * One post URL, reduced to the thing that identifies the post.
 *
 * Query strings and fragments go (they are tracking, added by whichever button
 * copied the link), `www.`/`m.` goes, the trailing slash goes, and where the
 * platform puts a stable id in the path that id becomes the whole key — so
 * `/p/ABC`, `/reel/ABC` and `/tv/ABC` are one post, which is what Instagram
 * itself thinks.
 *
 * Returns null for anything with no path to identify — a bare profile URL is
 * not a post, and treating it as one would make every post by that account
 * look like the same post.
 */
export function canonicalPostKey(raw: unknown): CanonicalKey | null {
  const url = parseUrl(raw)
  if (!url) return null
  const host = url.hostname.toLowerCase().replace(HOST_PREFIX, '')
  const segments = segmentsOf(url)
  const platform = platformOfUrl(url.href)

  if (platform === 'instagram') {
    const code = afterMarker(segments, ['p', 'reel', 'reels', 'tv'])
    return code ? `instagram:${code}` : fallbackKey(host, segments)
  }

  if (platform === 'tiktok') {
    const id = afterMarker(segments, ['video', 'photo'])
    if (id) return `tiktok:${id}`
    // vm.tiktok.com/ZMabc123 — a short link that never resolves locally, but
    // two copies of the same short link are still the same post
    if (/^(vm|vt)\./.test(url.hostname.toLowerCase()) && segments[0]) {
      return `tiktok:short:${segments[0]}`
    }
    return fallbackKey(host, segments)
  }

  if (platform === 'linkedin') {
    // both spellings carry the activity id: the canonical
    // /feed/update/urn:li:activity:123 and the shareable
    // /posts/some-slug-activity-123-AbCd
    const urn = /urn:li:(?:activity|share|ugcpost):(\d+)/i.exec(url.href)
    if (urn) return `linkedin:${urn[1]}`
    const slug = /activity[-:](\d{6,})/i.exec(url.pathname)
    if (slug) return `linkedin:${slug[1]}`
    return fallbackKey(host, segments)
  }

  if (platform === 'facebook') {
    // Facebook is the one platform that puts the id in the QUERY string, so
    // stripping the query wholesale would erase the identity
    const last = segments[segments.length - 1]?.toLowerCase() ?? ''
    if (last === 'permalink.php' || last === 'story.php' || last === 'photo.php') {
      const id = url.searchParams.get('story_fbid') || url.searchParams.get('fbid')
      if (id) return `facebook:${id}`
    }
    const id = afterMarker(segments, ['posts', 'videos', 'photos', 'reel', 'reels', 'permalink'])
    if (id) return `facebook:${id}`
    return fallbackKey(host, segments)
  }

  return fallbackKey(host, segments)
}

/** Host plus path, for a platform whose shape we do not know. */
function fallbackKey(host: string, segments: string[]): CanonicalKey | null {
  if (segments.length === 0) return null
  return `${host}/${segments.join('/')}`
}

/** Do two links point at the same post? */
export function sameProviderPost(a: unknown, b: unknown): boolean {
  const ka = canonicalPostKey(a)
  const kb = canonicalPostKey(b)
  return Boolean(ka && kb && ka === kb)
}

/* ── the provider's external posts ────────────────────────────────────── */

/**
 * One row of the provider's `/analytics` list.
 *
 * Deliberately loose: this is a vendor shape, it is read defensively
 * everywhere else in this codebase, and a renamed key must degrade to "no
 * match" rather than throw inside a cron.
 */
export type ExternalPost = Record<string, unknown>

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

function rows(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter(r => r && typeof r === 'object') as Record<string, unknown>[]
    : []
}

/** The list endpoint's rows, however the body wraps them. */
export function externalPostsOf(raw: unknown): ExternalPost[] {
  if (Array.isArray(raw)) return rows(raw)
  if (!raw || typeof raw !== 'object') return []
  const body = raw as Record<string, unknown>
  for (const key of ['posts', 'data', 'analytics', 'results', 'items']) {
    const found = rows(body[key])
    if (found.length) return found
  }
  return []
}

/** Only the ones the platform made, not the ones we published. */
export function onlyExternal(posts: ExternalPost[]): ExternalPost[] {
  return posts.filter(p => p.isExternal === true || p.isExternal === 'true')
}

/** The provider's own post id — the key `post_analytics` is stored under. */
export function externalPostId(post: ExternalPost | null | undefined): string | null {
  if (!post) return null
  return str(post._id) || str(post.id) || str(post.postId) || null
}

/** Every public URL this post row carries, post-level and per-platform. */
export function externalPostUrls(post: ExternalPost | null | undefined): string[] {
  if (!post) return []
  const out: string[] = []
  const take = (row: Record<string, unknown>) => {
    for (const key of ['platformPostUrl', 'publishedUrl', 'postUrl', 'permalink', 'url']) {
      const value = str(row[key])
      if (value) out.push(value)
    }
  }
  take(post)
  for (const key of ['platforms', 'platformAnalytics']) {
    for (const row of rows(post[key])) take(row)
  }
  return [...new Set(out)]
}

export function externalPostPlatform(post: ExternalPost | null | undefined): string | null {
  if (!post) return null
  const direct = str(post.platform).toLowerCase()
  if (direct) return direct
  for (const key of ['platforms', 'platformAnalytics']) {
    for (const row of rows(post[key])) {
      const name = str(row.platform).toLowerCase() || str(row.name).toLowerCase()
      if (name) return name
    }
  }
  // last resort: the URL says which platform it is
  for (const url of externalPostUrls(post)) {
    const p = platformOfUrl(url)
    if (p) return p
  }
  return null
}

export function externalPostProfileId(post: ExternalPost | null | undefined): string | null {
  if (!post) return null
  return str(post.profileId) || str(post.profile_id) || null
}

export function externalPostPublishedAt(post: ExternalPost | null | undefined): string | null {
  if (!post) return null
  return str(post.publishedAt) || str(post.published_at) || str(post.createdAt) || null
}

/** The public link to show, when we found the post but our own row had none. */
export function externalPostUrl(post: ExternalPost | null | undefined): string | null {
  return externalPostUrls(post)[0] ?? null
}

/* ── the match ────────────────────────────────────────────────────────── */

/**
 * What we know about the schedule entry, for the fallback.
 *
 * `at` is the entry's own date — when the scheduler says it went out. Without
 * it the fallback cannot run at all, which is correct: "some post on Instagram
 * by this client" is not an identification.
 */
export type MatchHint = {
  platform?: string | null
  profileId?: string | null
  /** the schedule entry's published_at / scheduled_at */
  at?: string | null
  /** half-width of the fallback window, in hours */
  windowHours?: number
}

export type ExternalMatch = {
  post: ExternalPost
  providerPostId: string
  /** 'url' — the link identified it. 'window' — one post, right time, right
   *  account, and nothing else it could have been. */
  matchedBy: 'url' | 'window'
}

const HOUR = 3600_000

/**
 * The provider post a hand-posted item refers to, or null.
 *
 * The URL decides whenever there is one. The ±6h window is the fallback for
 * "Mark as posted" (a Story, or a post whose link nobody pasted) and for a
 * link the platform has since rewritten — and it answers only when exactly one
 * post fits, so it can be wrong by omission but never by substitution.
 */
export function matchExternalPost(
  liveUrl: string | null | undefined,
  externalPosts: ExternalPost[] | null | undefined,
  hint: MatchHint = {},
): ExternalMatch | null {
  const posts = (externalPosts ?? []).filter(p => p && typeof p === 'object')
  if (posts.length === 0) return null

  const key = canonicalPostKey(liveUrl)
  if (key) {
    for (const post of posts) {
      const hit = externalPostUrls(post).some(u => canonicalPostKey(u) === key)
      if (!hit) continue
      const id = externalPostId(post)
      if (id) return { post, providerPostId: id, matchedBy: 'url' }
    }
  }

  // ── the fallback ───────────────────────────────────────────────────────
  const at = hint.at ? new Date(hint.at).getTime() : NaN
  if (!Number.isFinite(at)) return null
  const platform = (hint.platform || platformOfUrl(liveUrl) || '').toLowerCase()
  if (!platform) return null
  const window = (hint.windowHours ?? 6) * HOUR

  const candidates = posts.filter(post => {
    if (!externalPostId(post)) return false
    if (externalPostPlatform(post) !== platform) return false
    if (hint.profileId) {
      const profile = externalPostProfileId(post)
      // a row that names a DIFFERENT client's profile is not a candidate; a row
      // that names none is (the list is already scoped to our own API key)
      if (profile && profile !== hint.profileId) return false
    }
    const when = new Date(externalPostPublishedAt(post) ?? '').getTime()
    if (!Number.isFinite(when)) return false
    return Math.abs(when - at) <= window
  })

  if (candidates.length !== 1) return null
  const post = candidates[0]
  return { post, providerPostId: externalPostId(post)!, matchedBy: 'window' }
}
