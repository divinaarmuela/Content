import 'server-only'
import {
  parseChunk, parseCommentsChunk, parseLikers, parseMediaId, parseProfile,
  type Interactor, type SourceFollower, type SourceProfile,
} from './followers-core'

/**
 * WHERE THE FOLLOWER LIST COMES FROM.
 *
 * Instagram exposes no follower list to anyone through its own API, so the
 * list is read by a third party that fetches public profiles without a
 * login. The provider sits behind this small interface so it can be swapped
 * (the Apify follower actors were tested and would fit here too) without
 * the job, the routes or the page knowing. Its name never reaches a screen.
 *
 * Today's provider: HikerAPI (https://api.hikerapi.com), key in
 * `HIKER_API_KEY` — server-side only, never sent to a browser.
 *
 *   GET /v1/user/by/username?username=…   → the profile: pk, is_private,
 *                                            follower_count
 *   GET /v1/user/followers/chunk?user_id=…&max_id=…
 *                                          → `[users[], next_max_id | null]`,
 *                                            50 people a page, newest first
 *   GET /v1/media/by/url?url=…             → the post: id (`<pk>_<userpk>`)
 *   GET /v1/media/likers?id=…              → `UserShort[]`, one request
 *   GET /v1/media/comments/chunk?id=…&max_id=…
 *                                          → `[comments[], cursor, …]`, ~15 a
 *                                            page, each with its `user`
 *   header `x-access-key: <key>`
 *
 * Observed live on 7 Sep 2026 (tuple shape; the help page shows an object,
 * and parseChunk reads both). Billing is PER COMPLETED RESPONSE — including
 * a 400/403/404 — so every failure here is final: the caller records it and
 * stops, and nothing retries a request that just cost money to fail.
 */

export type SourceResult<T> = { ok: true; value: T } | { ok: false; error: string }

export interface FollowerSource {
  /** which provider, for the snapshot row — never for a screen */
  readonly name: string
  profile(username: string): Promise<SourceResult<SourceProfile>>
  followers(userPk: string, cursor: string | null): Promise<SourceResult<{ users: SourceFollower[]; next: string | null }>>
  /** the platform's id for a post, from its public URL (one request) */
  mediaId(postUrl: string): Promise<SourceResult<string>>
  /** everybody who liked a post — one request, the platform caps the list */
  likers(mediaId: string): Promise<SourceResult<Interactor[]>>
  /** one page of commenters (about fifteen a page) */
  commenters(mediaId: string, cursor: string | null): Promise<SourceResult<{ people: Interactor[]; next: string | null }>>
}

const BASE = 'https://api.hikerapi.com'
const HTTP_TIMEOUT_MS = 45_000

export function followersEnabled(): boolean {
  return Boolean(process.env.HIKER_API_KEY)
}

/** the configured source, or null when the feature is not switched on */
export function configuredSource(): FollowerSource | null {
  const key = process.env.HIKER_API_KEY
  if (!key) return null
  return hikerSource(key)
}

export function hikerSource(key: string, base: string = BASE): FollowerSource {
  const get = async (path: string, query: Record<string, string>): Promise<SourceResult<unknown>> => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS)
    try {
      const qs = new URLSearchParams(query).toString()
      const res = await fetch(`${base}${path}?${qs}`, {
        headers: { 'x-access-key': key, accept: 'application/json' },
        signal: ctrl.signal,
        cache: 'no-store',
      })
      if (!res.ok) return { ok: false, error: `http_${res.status}` }
      const json = await res.json().catch(() => null)
      if (json === null) return { ok: false, error: 'bad_json' }
      return { ok: true, value: json }
    } catch (e) {
      return { ok: false, error: e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'fetch_failed' }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    name: 'hiker',
    async profile(username) {
      const r = await get('/v1/user/by/username', { username })
      if (!r.ok) return r
      const p = parseProfile(r.value)
      return p ? { ok: true, value: p } : { ok: false, error: 'bad_profile' }
    },
    async followers(userPk, cursor) {
      const r = await get('/v1/user/followers/chunk', cursor ? { user_id: userPk, max_id: cursor } : { user_id: userPk })
      if (!r.ok) return r
      const page = parseChunk(r.value)
      return page ? { ok: true, value: page } : { ok: false, error: 'bad_page' }
    },
    async mediaId(postUrl) {
      const r = await get('/v1/media/by/url', { url: postUrl })
      if (!r.ok) return r
      const id = parseMediaId(r.value)
      return id ? { ok: true, value: id } : { ok: false, error: 'bad_media' }
    },
    async likers(mediaId) {
      const r = await get('/v1/media/likers', { id: mediaId })
      if (!r.ok) return r
      const list = parseLikers(r.value)
      return list ? { ok: true, value: list } : { ok: false, error: 'bad_likers' }
    },
    async commenters(mediaId, cursor) {
      const r = await get('/v1/media/comments/chunk', cursor ? { id: mediaId, max_id: cursor } : { id: mediaId })
      if (!r.ok) return r
      const page = parseCommentsChunk(r.value)
      return page ? { ok: true, value: page } : { ok: false, error: 'bad_comments' }
    },
  }
}
