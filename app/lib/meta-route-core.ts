import type { MediaItem, PostOptions, Target } from './publish-core'
import { validatePublish, type GraphErrorDetail, type PublishItem, type PublishRequest } from './meta-ig-core'

/**
 * WHICH ROAD A POST'S INSTAGRAM TAKES — Zernio, or the agency's own Meta app
 * (1 Oct 2026, branch meta-publish). PURE: no I/O, fully unit-tested
 * (tests/meta-route-core.test.ts).
 *
 * The owner's rule: for Meta App Review the agency has to actually USE its
 * own Meta app, starting with PUBLISHING for a client whose Instagram is
 * connected directly — the test client 100M first. Everything else (other
 * clients, other networks) goes through Zernio exactly as it always has.
 *
 * Instagram goes through Meta only when ALL of these hold, and the first one
 * that does not is the reason it does not:
 *   1. the client's switch `clients.instagram_via_meta` is on (off by default;
 *      a super admin turns it on, on the client's Social page);
 *   2. the client has an ACTIVE `meta_ig_accounts` row for THE SAME Instagram
 *      account as the post's Instagram channel (matched on the username — a
 *      second Instagram on the same client is not posted to by mistake);
 *   3. the post asks for nothing this road cannot send yet (collaborators,
 *      tags, a location, a Trial Reel, music, the paid-partnership label…) —
 *      a post that silently lost what somebody chose would be worse than one
 *      that went through Zernio;
 *   4. its files are ones Instagram's own API takes: JPEG pictures, MP4/MOV
 *      video (Meta's content-publishing spec). Zernio converts a PNG on the
 *      way; this road does not, so such a post stays on Zernio.
 *
 * The routing is decided when the post is BOOKED (post-stage
 * defaultQueuePublish), and the Instagram part becomes its own job with
 * `provider: 'meta_ig'`. At its time the switch and the connection are asked
 * again: turned off in between, the job goes through Zernio after all.
 */

export const META_PROVIDER = 'meta_ig'

/** The slice of a `meta_ig_accounts` row the rule reads (never the token). */
export type MetaAccountLite = { id: string; username: string | null; status: string }

export type InstagramRoute =
  | { via: 'meta'; igUserId: string; username: string | null }
  /** `reason` null = the client is not switched on: the ordinary case, nothing to say */
  | { via: 'zernio'; reason: string | null }

/** `@Name ` → `name` */
export function normUsername(u: string | null | undefined): string {
  return String(u ?? '').trim().replace(/^@/, '').toLowerCase()
}

/** A file's extension from its URL's path, lower case, or '' when it has none. */
export function extOf(url: string): string {
  let path = url
  try { path = new URL(url).pathname } catch { /* a bare path */ }
  const last = path.split('/').pop() ?? ''
  const dot = last.lastIndexOf('.')
  return dot > 0 ? last.slice(dot + 1).toLowerCase() : ''
}

const JPEG = ['jpg', 'jpeg']
const VIDEO = ['mp4', 'mov']

/**
 * What this road does not send yet, in the composer's own words. A value at
 * its default (comments on, not AI-made, sound kept) is not a request.
 */
export function unsupportedOptions(o: PostOptions | null | undefined): string[] {
  if (!o) return []
  const out: string[] = []
  if (o.collaborators?.length) out.push('collaborators')
  if (o.userTags?.length) out.push('tagged accounts')
  if (o.locationId?.trim()) out.push('a location')
  if (o.trialGraduation) out.push('a Trial Reel')
  if (o.audioName?.trim()) out.push('a sound name')
  if (o.audio?.audioId?.trim()) out.push('music from Instagram')
  if (o.isPaidPartnership) out.push('the paid-partnership label')
  if (o.brandedContentSponsors?.length) out.push('sponsors')
  if (o.muteAudio) out.push('muted sound')
  if (o.commentsEnabled === false) out.push('comments turned off')
  if (o.isAiGenerated) out.push('the AI-made label')
  if (typeof o.thumbOffset === 'number') out.push('a cover frame time')
  return out
}

/** The first file Instagram's own API would not take, in words — or null. */
export function mediaProblem(media: readonly MediaItem[], options?: PostOptions | null): string | null {
  if (media.length === 0) return 'Instagram needs a picture or a video'
  for (const [i, m] of media.entries()) {
    const ext = extOf(m.url)
    if (m.type === 'document') return 'Instagram does not take documents'
    // no extension: let it through; the job checks the file's own Content-Type before sending
    if (!ext) continue
    if (m.type === 'image' && !JPEG.includes(ext)) {
      return `Instagram's own API takes JPEG pictures only, and file ${i + 1} is ${ext.toUpperCase()}`
    }
    if (m.type === 'video' && !VIDEO.includes(ext)) {
      return `Instagram's own API takes MP4 or MOV video only, and file ${i + 1} is ${ext.toUpperCase()}`
    }
  }
  const cover = options?.thumbnailUrl?.trim()
  if (cover && extOf(cover) && !JPEG.includes(extOf(cover))) {
    return `Instagram's own API takes a JPEG cover only, and this one is ${extOf(cover).toUpperCase()}`
  }
  return null
}

/** The media one channel actually sends: its own set, or the shared one. */
export function mediaForTarget(shared: readonly MediaItem[], target: Pick<Target, 'options'>): MediaItem[] {
  return target.options?.media?.length ? [...target.options.media] : [...shared]
}

/** The rule above, for one Instagram channel. */
export function instagramRoute(input: {
  clientViaMeta: boolean | null | undefined
  /** the client's direct connections */
  metaAccounts: readonly MetaAccountLite[]
  /** the post's Instagram channel, as `social_accounts` knows it */
  channelUsername: string | null | undefined
  options?: PostOptions | null
  /** what this channel sends */
  media: readonly MediaItem[]
}): InstagramRoute {
  if (input.clientViaMeta !== true) return { via: 'zernio', reason: null }
  const active = input.metaAccounts.filter(a => a.status === 'active')
  if (active.length === 0) {
    return { via: 'zernio', reason: input.metaAccounts.length
      ? 'The direct Instagram connection (Meta) needs reconnecting, so this goes through Zernio'
      : 'No Instagram account is connected directly (Meta) for this client, so this goes through Zernio' }
  }
  const want = normUsername(input.channelUsername)
  if (!want) return { via: 'zernio', reason: 'This Instagram channel has no username on record to match to the direct connection, so it goes through Zernio' }
  const match = active.find(a => normUsername(a.username) === want)
  if (!match) {
    return { via: 'zernio', reason: `@${want} is not the Instagram account connected directly (${active.map(a => `@${a.username ?? a.id}`).join(', ')}), so it goes through Zernio` }
  }
  const unsupported = unsupportedOptions(input.options)
  if (unsupported.length) {
    return { via: 'zernio', reason: `Instagram direct (Meta) does not send ${unsupported.join(', ')} yet, so this goes through Zernio` }
  }
  const bad = mediaProblem(input.media, input.options)
  if (bad) return { via: 'zernio', reason: `${bad}, so this goes through Zernio` }
  return { via: 'meta', igUserId: match.id, username: match.username }
}

/** The channel line's mark, for super admins: `null` when there is nothing to say. */
export function routeMark(route: InstagramRoute | null | undefined): string | null {
  if (!route) return null
  if (route.via === 'meta') return 'Instagram · direct (Meta)'
  return route.reason ? `Instagram · Zernio — ${route.reason}` : null
}

/* ── the request Meta gets ─────────────────────────────────────────────── */

export type MetaRequestPlan =
  | { ok: true; req: PublishRequest; firstComment: string | null }
  | { ok: false; reason: string }

/**
 * One job's Instagram target → the container(s) Meta is asked for.
 *
 *   Story          → STORIES (one picture or video; Instagram shows no caption on a Story)
 *   2+ files       → CAROUSEL, in the post's order
 *   one video      → REELS (Instagram's API makes every single video a Reel); share-to-feed as chosen
 *   one picture    → IMAGE
 *
 * The channel's own caption wins over the shared one, as on Zernio.
 */
export function metaRequestFor(input: { caption: string; media: readonly MediaItem[]; options?: PostOptions | null }): MetaRequestPlan {
  const o = input.options ?? {}
  const own = typeof o.caption === 'string' && o.caption.trim() ? o.caption : null
  const text = (own ?? input.caption ?? '').trim()
  const caption = text ? text : undefined
  const media = input.media.filter(m => m.type === 'image' || m.type === 'video')
  if (media.length === 0) return { ok: false, reason: 'Instagram needs a picture or a video' }
  const item = (m: MediaItem): PublishItem => ({ type: m.type === 'video' ? 'video' : 'image', url: m.url })
  let req: PublishRequest
  if (o.kind === 'story') {
    if (media.length !== 1) return { ok: false, reason: 'A Story is one picture or one video' }
    req = { kind: 'STORIES', media: item(media[0]) }
  } else if (media.length >= 2 || o.kind === 'carousel') {
    req = { kind: 'CAROUSEL', items: media.map(item), caption }
  } else if (media[0].type === 'video') {
    req = {
      kind: 'REELS', videoUrl: media[0].url, caption,
      ...(o.thumbnailUrl?.trim() ? { coverUrl: o.thumbnailUrl.trim() } : {}),
      ...(o.shareToFeed === false ? { shareToFeed: false } : {}),
    }
  } else {
    if (o.kind === 'reel') return { ok: false, reason: 'A Reel needs a video' }
    req = { kind: 'IMAGE', imageUrl: media[0].url, caption }
  }
  const invalid = validatePublish(req)
  if (invalid) return { ok: false, reason: invalid }
  const first = o.firstComment?.trim()
  return { ok: true, req, firstComment: first ? first : null }
}

/* ── holding a job until its time ──────────────────────────────────────── */

/**
 * Instagram's API has no scheduling: a container is published when it is
 * published. So a Meta job is not handed over at booking the way a Zernio
 * job is — it waits in 'queued' until its time. The dispatcher (every 10
 * minutes) passes it along once its time is within the lead, and the publish
 * function sleeps the rest (app/inngest/functions.ts publishPost).
 */
export const META_DISPATCH_LEAD_MS = 12 * 60_000
/** the longest the publish function sleeps for a held job; further out, the dispatcher brings it back later */
export const META_SLEEP_MAX_MS = 20 * 60_000

export function metaHold(
  job: { provider?: string | null; scheduled_for?: string | null },
  now: number,
): { held: false } | { held: true; until: string } {
  if (job.provider !== META_PROVIDER || !job.scheduled_for) return { held: false }
  const t = Date.parse(job.scheduled_for)
  if (!Number.isFinite(t) || t <= now) return { held: false }
  return { held: true, until: new Date(t).toISOString() }
}

/** Should the dispatcher hand this queued job over now? Everything but a Meta job far from its time. */
export function dueForDispatch(job: { provider?: string | null; scheduled_for?: string | null }, now: number): boolean {
  const h = metaHold(job, now)
  return !h.held || Date.parse(h.until) - now <= META_DISPATCH_LEAD_MS
}

/* ── what a Meta job remembers, so a retry never publishes twice ───────── */

export type MetaJobState = {
  ig_user_id: string
  username?: string | null
  /** the carousel's item containers, in order, as they are made */
  children?: string[]
  /** the container media_publish is called with — written BEFORE that call */
  creation_id?: string | null
  media_id?: string | null
  permalink?: string | null
  published_at?: string | null
  first_comment_id?: string | null
  first_comment_error?: string | null
}

export function readMetaJobState(v: unknown): MetaJobState | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.ig_user_id !== 'string' || !o.ig_user_id) return null
  const str = (x: unknown) => (typeof x === 'string' && x ? x : null)
  return {
    ig_user_id: o.ig_user_id,
    username: str(o.username),
    children: Array.isArray(o.children) ? o.children.map(String) : [],
    creation_id: str(o.creation_id),
    media_id: str(o.media_id),
    permalink: str(o.permalink),
    published_at: str(o.published_at),
    first_comment_id: str(o.first_comment_id),
    first_comment_error: str(o.first_comment_error),
  }
}

/* ── Meta's refusals, in words a person can act on ─────────────────────── */

/**
 * Error codes and subcodes from Meta's published content-publishing error
 * list. NOT seen live yet (nothing has been published through this road for
 * real): where a code is not here, Meta's own sentence is used.
 */
const SUBCODE_WORDS: Record<number, string> = {
  2207003: 'Instagram took too long to download the file — try again',
  2207004: 'the picture is too big for Instagram (8 MB at most)',
  2207005: 'Instagram does not take this picture format — it needs a JPEG',
  2207009: 'the picture is a shape Instagram does not take (between 4:5 and 1.91:1)',
  2207026: 'Instagram does not take this video — it needs MP4 or MOV (H.264, AAC sound)',
  2207027: 'Instagram had not finished processing the media',
  2207042: "the account has reached Instagram's limit of posts in 24 hours",
  2207052: 'Instagram could not fetch the file from its link',
}
const TRANSIENT_CODES = [1, 2, 4, 17, 32, 341, 613]
const TRANSIENT_SUBCODES = [2207003, 2207027]

export type MetaErrorLike = { message: string; status?: number; detail?: GraphErrorDetail | null }

/** retry: worth another go in a few minutes (a network hiccup, Meta busy); words: the sentence on the post. */
export function metaFailure(e: MetaErrorLike): { retry: boolean; words: string } {
  const d = e.detail ?? null
  const msg = String(e.message ?? '').trim() || 'unknown error'
  const prefix = 'Instagram (direct, Meta): '
  if (d?.code === 190) {
    return { retry: false, words: `${prefix}the connection has expired or was removed — reconnect it with "Connect Instagram directly (Meta)" on the client's Social page` }
  }
  if (/publishing limit is reached/i.test(msg)) return { retry: false, words: prefix + msg }
  const still = /still processing/i.test(msg)
  // our own sentences carry no status: only "could not reach" (the network) and "still processing" are worth
  // another go; "not connected", "could not process the media (ERROR)" are not
  const retry = still
    || /^could not reach instagram/i.test(msg)
    || (typeof e.status === 'number' && (e.status >= 500 || e.status === 429))
    || d?.transient === true
    || (d?.code != null && TRANSIENT_CODES.includes(d.code))
    || (d?.subcode != null && TRANSIENT_SUBCODES.includes(d.subcode))
  const said = (d?.subcode != null && SUBCODE_WORDS[d.subcode]) || d?.userMessage || msg
  return { retry: Boolean(retry), words: prefix + said }
}
