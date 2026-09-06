/**
 * An Instagram video, on the board, from a pasted link.
 *
 * Instagram's own embed will not play a Reel in place, and every public
 * "fixer" proxy died in September 2026. What does work is the owner's own
 * Apify account: an actor that reads a public post and hands back the
 * post's mp4 on Instagram's CDN. That URL is SIGNED AND EXPIRES within
 * hours, so it is never baked into a card — the board asks for it when a
 * card is looked at, and the answer is cached server-side for a while.
 *
 * Everything decidable without the network is here, so it can be tested.
 * The owner's rule: the service's name never appears in the UI.
 */

import { isInstagramCdnUrl, isPlayableFile } from './link-preview-core'

/** How long a resolved video URL is trusted before it is asked for again.
 *  Instagram signs these for hours, not days; four is short enough that a
 *  card rarely shows a dead link and long enough that one board open a
 *  dozen times in an afternoon costs one run, not twelve. */
export const VIDEO_TTL_MS = 4 * 60 * 60 * 1000
/** After this many failures in a row the shortcode is left alone for a
 *  day — a private post, a removed post, or a broken actor should not
 *  cost a run on every scroll. */
export const FAIL_LIMIT = 3
export const BACKOFF_MS = 24 * 60 * 60 * 1000
/** A `force` re-ask (the stored URL 403'd on playback) is honoured only
 *  when the cache is older than this — two viewers hitting an expired
 *  link at once must not mean two runs. */
export const FORCE_MIN_AGE_MS = 15 * 60 * 1000

export type InstagramVideoRow = {
  id: string
  video: string | null
  poster: string | null
  caption: string | null
  author: string | null
  duration: number | null
  fetched_at: string
  expires_at: string | null
  fail_count: number
  last_error: string | null
  updated_at?: string
}

/** Only an https mp4 on Instagram's own CDN is ever played. */
export function isInstagramVideoUrl(url: unknown): url is string {
  return typeof url === 'string' && isInstagramCdnUrl(url) && isPlayableFile(url)
}

export type CacheDecision = 'serve' | 'backoff' | 'fetch'

/** What to do with what is stored: serve it, leave the post alone, or ask. */
export function cacheDecision(
  row: InstagramVideoRow | null, now: number, force = false,
): CacheDecision {
  if (!row) return 'fetch'
  const fetched = Date.parse(row.fetched_at)
  if (row.video && row.expires_at) {
    const fresh = Date.parse(row.expires_at) > now
    if (fresh && !(force && now - fetched > FORCE_MIN_AGE_MS)) return 'serve'
    return 'fetch'
  }
  // a stored failure
  if (row.fail_count >= FAIL_LIMIT && now - fetched < BACKOFF_MS) return 'backoff'
  return 'fetch'
}

/** One item as the actor returns it — only the fields the board uses. */
export type ActorItem = {
  type?: string
  videoUrl?: string
  displayUrl?: string
  caption?: string
  ownerUsername?: string
  videoDuration?: number
}

export function fromActorItem(item: unknown): Omit<InstagramVideoRow, 'id' | 'fetched_at' | 'expires_at' | 'fail_count' | 'last_error'> | null {
  if (!item || typeof item !== 'object') return null
  const it = item as ActorItem
  if (!isInstagramVideoUrl(it.videoUrl)) return null
  return {
    video: it.videoUrl,
    poster: typeof it.displayUrl === 'string' && /^https:\/\//.test(it.displayUrl) ? it.displayUrl : null,
    caption: typeof it.caption === 'string' ? it.caption.slice(0, 2200) : null,
    author: typeof it.ownerUsername === 'string' ? it.ownerUsername.slice(0, 80) : null,
    duration: typeof it.videoDuration === 'number' ? it.videoDuration : null,
  }
}

/** The body the actor takes for one post. */
export function actorInput(postUrl: string): Record<string, unknown> {
  return { directUrls: [postUrl], resultsType: 'posts', resultsLimit: 1, addParentData: false }
}

/** What the browser is told. Never the token, never the service. */
export type VideoAnswer =
  | { video: string; poster: string | null; caption: string | null; author: string | null; duration: number | null }
  | { video: null; reason: 'off' | 'not_video' | 'unavailable' }
