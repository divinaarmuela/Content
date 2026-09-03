/**
 * Pure publishing rules. No I/O, no SDK — unit-tested directly.
 *
 * Everything here answers one question: is this post legal on this platform,
 * and what exact payload does the provider want? Getting it wrong means a
 * failed or mangled post on a client's real account, so the rules are encoded
 * and tested rather than discovered in production.
 */

export type Platform =
  | 'instagram' | 'facebook' | 'tiktok' | 'linkedin' | 'twitter'
  | 'youtube' | 'threads' | 'pinterest' | 'bluesky' | 'reddit'

export type MediaType = 'image' | 'video' | 'document'

export type MediaItem = { url: string; type: MediaType }

/** Per-platform limits.
 *
 *  `images` / `videos` / `documents` are maxima for that kind. `mixed: false`
 *  means images and video cannot appear in the same post — the rule that most
 *  often bites, because a carousel with a stray video is silently rejected.
 *
 *  A CAROUSEL is its own set of limits, not the single-post ones: Instagram
 *  takes 2–10 items in one carousel and they may be images and videos
 *  together, even though the same account may only post ONE video as an
 *  ordinary feed post. `carousel: 0` means the platform has no such thing.
 *  Applying the single-post rules to a carousel is what made a six-card drop
 *  publishable as one photo. */
export const PLATFORM_RULES: Record<Platform, {
  captionMax: number
  images: number
  videos: number
  documents: number
  mixed: boolean
  requiresMedia: boolean
  /** most items in one carousel; 0 = this platform has no carousel */
  carousel: number
  /** may that carousel hold images AND videos together */
  mixedCarousel: boolean
  /** does this platform have Stories at all — the 24-hour kind. Choosing
   *  Story while a channel without them is selected is not a style choice,
   *  it is a post that cannot exist. */
  stories: boolean
  /** does it have a distinct short-form vertical slot — a Reel, a Short. On
   *  a platform without one, a vertical video is simply a video, and offering
   *  "Reel" there would be inventing a format. */
  shortForm: boolean
}> = {
  instagram: { captionMax: 2200,  images: 10, videos: 1, documents: 0, mixed: false, requiresMedia: true,  carousel: 10, mixedCarousel: true,  stories: true,  shortForm: true  },
  tiktok:    { captionMax: 2200,  images: 35, videos: 1, documents: 0, mixed: false, requiresMedia: true,  carousel: 35, mixedCarousel: false, stories: false, shortForm: true  },
  twitter:   { captionMax: 280,   images: 4,  videos: 1, documents: 0, mixed: false, requiresMedia: false, carousel: 4,  mixedCarousel: false, stories: false, shortForm: false },
  linkedin:  { captionMax: 3000,  images: 20, videos: 1, documents: 1, mixed: false, requiresMedia: false, carousel: 20, mixedCarousel: false, stories: false, shortForm: false },
  facebook:  { captionMax: 63206, images: 10, videos: 1, documents: 0, mixed: false, requiresMedia: false, carousel: 10, mixedCarousel: true,  stories: true,  shortForm: true  },
  threads:   { captionMax: 500,   images: 10, videos: 1, documents: 0, mixed: false, requiresMedia: false, carousel: 10, mixedCarousel: true,  stories: false, shortForm: false },
  youtube:   { captionMax: 5000,  images: 0,  videos: 1, documents: 0, mixed: false, requiresMedia: true,  carousel: 0,  mixedCarousel: false, stories: false, shortForm: true  },
  pinterest: { captionMax: 500,   images: 1,  videos: 1, documents: 0, mixed: false, requiresMedia: true,  carousel: 0,  mixedCarousel: false, stories: false, shortForm: false },
  bluesky:   { captionMax: 300,   images: 4,  videos: 1, documents: 0, mixed: false, requiresMedia: false, carousel: 4,  mixedCarousel: false, stories: false, shortForm: false },
  reddit:    { captionMax: 40000, images: 1,  videos: 1, documents: 0, mixed: false, requiresMedia: false, carousel: 0,  mixedCarousel: false, stories: false, shortForm: false },
}

/**
 * The post types this platform actually has.
 *
 * The composer offers one choice per channel rather than one choice for all
 * of them, and a menu is the wrong place to learn that YouTube has no Stories
 * — an option that cannot be chosen never has to be explained.
 */
export function availableKinds(platform: Platform, media?: MediaItem[]): PostKind[] {
  const r = PLATFORM_RULES[platform]
  if (!r) return ['feed']
  const kinds: PostKind[] = ['feed']
  if (r.shortForm) kinds.push('reel')
  if (r.stories) kinds.push('story')
  if (r.carousel > 0) kinds.push('carousel')
  // Instagram has no feed video: per Zernio's guide, "any single video
  // publishes as a Reel automatically". Offering "Feed post" for a lone video
  // there is a choice that changes nothing except what the check looks for —
  // which is how a 2 GB landscape master passed as feed and was refused as a
  // Reel. The option goes when it would lie.
  const loneVideo = media?.length === 1 && media[0].type === 'video'
  if (platform === 'instagram' && loneVideo) return kinds.filter(k => k !== 'feed')
  return kinds
}

/**
 * What "Automatic" means on THIS platform.
 *
 * The provider reads the media: one video is short-form, several items are a
 * carousel, anything else is a feed post. Clamped to what the platform has,
 * because the old global guess sent "carousel" to YouTube — a choice nobody
 * made, failing validation for a reason nobody chose.
 */
export function autoKindFor(platform: Platform, media: MediaItem[]): PostKind {
  const guess: PostKind =
    media.length > 1 ? 'carousel'
    : media.length === 1 && media[0].type === 'video' ? 'reel'
    : 'feed'
  const allowed = availableKinds(platform, media)
  return allowed.includes(guess) ? guess : allowed.includes('feed') ? 'feed' : allowed[0]
}

/**
 * A publish job in one of these still owns its content item: 'scheduled'
 * included, because the provider is holding that post until its time.
 *
 * Lives here (rather than in publish.ts, which needs `server-only`) so the
 * pure schedule rules — `mirrorStatus` in particular — can read the same
 * list the publisher does, instead of a second copy that could drift.
 */
export const LIVE_JOB_STATUSES = ['queued', 'publishing', 'scheduled']

export const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_RULES) as Platform[]

export function isPlatform(v: string): v is Platform {
  return Object.prototype.hasOwnProperty.call(PLATFORM_RULES, v)
}

/** Content-type → the media kind the provider expects. */
export function mediaTypeFor(contentType: string): MediaType | null {
  const t = contentType.toLowerCase()
  if (t.startsWith('image/')) return 'image'
  if (t.startsWith('video/')) return 'video'
  if (t === 'application/pdf') return 'document'
  return null
}

export type ValidationIssue = { platform: Platform; problem: string }

/**
 * Check a caption + media set against every target platform.
 *
 * Returns every problem rather than the first, so an editor fixes one post
 * once instead of discovering faults one publish at a time.
 */
export function validatePost(input: {
  caption: string
  media: MediaItem[]
  platforms: Platform[]
  /** intent per platform, when the caller has one */
  kinds?: Partial<Record<Platform, PostKind>>
  /** a channel with its own media is judged on that, not on the shared set */
  mediaByPlatform?: Partial<Record<Platform, MediaItem[]>>
  /** …and likewise its own caption */
  captionByPlatform?: Partial<Record<Platform, string>>
}): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (input.platforms.length === 0) {
    return [{ platform: 'instagram', problem: 'No platform selected' }]
  }

  for (const p of input.platforms) {
    const caption = input.captionByPlatform?.[p] ?? input.caption
    const media = input.mediaByPlatform?.[p] ?? input.media
    const images = media.filter(m => m.type === 'image').length
    const videos = media.filter(m => m.type === 'video').length
    const docs   = media.filter(m => m.type === 'document').length
    const r = PLATFORM_RULES[p]
    if (!r) { issues.push({ platform: p, problem: `Unsupported platform "${p}"` }); continue }

    if (caption.length > r.captionMax) {
      issues.push({
        platform: p,
        problem: `Caption is ${caption.length} characters; ${p} allows ${r.captionMax}`,
      })
    }
    if (r.requiresMedia && media.length === 0) {
      issues.push({ platform: p, problem: `${p} requires at least one image or video` })
    }
    // a carousel is measured as a carousel: one ceiling for the whole set,
    // and — where the platform allows it — no objection to mixing kinds
    const asCarousel = input.kinds?.[p] === 'carousel' && r.carousel > 0
    const imageMax = asCarousel ? r.carousel : r.images
    const videoMax = asCarousel && r.mixedCarousel ? r.carousel : r.videos
    if (images > imageMax) {
      issues.push({ platform: p, problem: `${images} images; ${p} allows ${imageMax}` })
    }
    if (videos > videoMax) {
      issues.push({ platform: p, problem: `${videos} videos; ${p} allows ${videoMax}` })
    }
    if (docs > r.documents) {
      issues.push({
        platform: p,
        problem: r.documents === 0
          ? `${p} does not accept documents`
          : `${docs} documents; ${p} allows ${r.documents}`,
      })
    }
    if (!r.mixed && !(asCarousel && r.mixedCarousel) && images > 0 && videos > 0) {
      issues.push({ platform: p, problem: `${p} cannot mix images and video in one post` })
    }

    // intent-specific rules — a Reel is a single vertical video, a Story is a
    // single item, and a carousel needs more than one
    const kind = input.kinds?.[p]
    if (kind === 'reel') {
      if (videos !== 1) {
        issues.push({ platform: p, problem: 'A Reel needs exactly one video' })
      }
      if (images > 0) {
        issues.push({ platform: p, problem: 'A Reel cannot include still images' })
      }
    }
    if (kind === 'story') {
      // caught before the media rules: "a Story takes one item" is useless
      // advice on a platform that has no Stories to put the item in
      if (!r.stories) {
        issues.push({ platform: p, problem: `${p} has no Stories — pick a different post type for it` })
      } else if (media.length !== 1) {
        issues.push({ platform: p, problem: 'A Story takes exactly one image or video' })
      }
    }
    if (kind === 'carousel') {
      if (r.carousel === 0) {
        issues.push({ platform: p, problem: `${p} does not post carousels` })
      } else if (media.length < 2) {
        issues.push({ platform: p, problem: 'A carousel needs at least two items' })
      } else if (media.length > r.carousel) {
        issues.push({
          platform: p,
          problem: `${media.length} slides; ${p} allows ${r.carousel} in one carousel`,
        })
      }
    }
  }
  return issues
}

/**
 * Per-platform posting options.
 *
 * `kind` is ours: the provider infers Reel vs feed post from the media (a
 * single video becomes a Reel), and only Stories are set explicitly. Carrying
 * an intent lets us validate it — asking for a Reel with a photo attached is a
 * mistake worth catching before it is sent, not after.
 */
export type PostKind = 'feed' | 'reel' | 'story' | 'carousel'

export type PostOptions = {
  kind?: PostKind
  /**
   * This channel's OWN media, replacing the shared set for this channel only
   * — Zernio's `customMedia`. The reason it exists: a twelve-minute cut for
   * YouTube and a ninety-second one for Instagram used to be two posts.
   */
  media?: MediaItem[]
  /** …and its own caption — `customContent`. X takes 280 characters where
   *  LinkedIn takes 3,000, and one caption cannot serve both. */
  caption?: string
  /** X Premium only: lift the 140-second / 512 MB cap. Sent as `longVideo`. */
  longVideo?: boolean
  /** Reels: also show in the main feed. */
  shareToFeed?: boolean
  /** Posted automatically once the post is live — the usual place for hashtags. */
  firstComment?: string
  /** Up to 3 usernames (Business/Creator accounts only). */
  collaborators?: string[]
  /** Custom Reel cover image. */
  thumbnailUrl?: string
  /** Milliseconds into the video to take the thumbnail from. */
  thumbOffset?: number
  isAiGenerated?: boolean
  /**
   * Tag accounts in the post.
   *
   * Positioning is the only placement the API offers, and it is inconsistent:
   * feed images REQUIRE x/y (0–1 from top-left), Stories accept them, and
   * Reels/videos ignore them and tag by username only. Link stickers, polls,
   * questions and countdowns cannot be placed at all — an Instagram Graph API
   * limitation, so no provider can offer them.
   */
  userTags?: UserTag[]
  /**
   * Tag the post to a place — Instagram only, sent as `locationId`.
   *
   * It is a NUMERIC FACEBOOK PAGE ID, not a place name and not an Instagram
   * handle: Instagram's own location index is the set of Facebook Pages, and
   * neither the Graph API nor Zernio exposes a place SEARCH, so the id has to
   * be known in advance (which is why a client keeps a saved list of theirs).
   *
   * Feed posts, Reels and carousels take it. STORIES DO NOT — Instagram
   * rejects the post rather than ignoring the field — so `toPlatformData`
   * drops it there rather than sending a post that cannot exist.
   */
  locationId?: string
}

export type UserTag = { username: string; x?: number; y?: number }

/** Is `v` a Facebook Page id — digits, nothing else? The whole validation
 *  there is: a name typed into the box is the mistake to catch, and it is
 *  caught by the shape. */
export function isPageId(v: string | null | undefined): boolean {
  return /^\d{5,25}$/.test(String(v ?? '').trim())
}

/** May a post of this kind carry a place at all? */
export function kindTakesLocation(kind: PostKind | undefined): boolean {
  return kind !== 'story'
}

/** Do coordinates make any difference for this kind of post? */
export function tagsAcceptCoordinates(kind: PostKind | undefined): boolean {
  return kind !== 'reel'
}

export type Target = { platform: Platform; accountId: string; options?: PostOptions }

/** Media rules that apply to a particular kind of post, beyond the platform's
 *  general limits. Duration and aspect ratio cannot be checked here — they
 *  need the file — so they are documented for the UI to surface. */
export const REEL_REQUIREMENTS = {
  // Meta's published Reels spec — fifteen minutes, not the 90s that Zernio's
  // guide still quotes. See media-fit-core for the full set.
  maxSeconds: 15 * 60,
  aspect: '9:16 vertical',
  resolution: '1080 x 1920',
  maxMB: 300,
  formats: 'MP4 or MOV, H.264, 30fps',
} as const

export const STORY_REQUIREMENTS = {
  maxSeconds: 60,
  aspect: '9:16 vertical',
  resolution: '1080 x 1920',
  maxImageMB: 8,
  maxVideoMB: 100,
  formats: 'JPEG/PNG images, MP4/MOV video',
} as const

/**
 * Advisories: true things the operator should know that are not reasons to
 * block publishing.
 *
 * The important one is the caption. Instagram does not display text on a
 * Story, so a caption written here is silently discarded — the post succeeds
 * and the words simply never appear. Surfacing that before it is sent is the
 * difference between a mistake and a puzzle.
 */
export function postWarnings(input: {
  caption: string
  media: MediaItem[]
  kinds?: Partial<Record<Platform, PostKind>>
}): string[] {
  const warnings: string[] = []
  const kinds = Object.values(input.kinds ?? {})

  if (kinds.includes('story')) {
    if (input.caption.trim()) {
      warnings.push(
        'Instagram does not show captions on Stories — this text will not appear. ' +
        'Put any wording into the image or video itself.'
      )
    }
    warnings.push(
      `Stories should be ${STORY_REQUIREMENTS.aspect} (${STORY_REQUIREMENTS.resolution}), ` +
      `video up to ${STORY_REQUIREMENTS.maxSeconds}s.`
    )
    warnings.push('Link stickers, polls and countdowns cannot be added by any API — those need a manual post.')
  }

  if (kinds.includes('reel')) {
    warnings.push(
      `Reels should be ${REEL_REQUIREMENTS.aspect} (${REEL_REQUIREMENTS.resolution}), ` +
      `up to ${REEL_REQUIREMENTS.maxSeconds}s, ${REEL_REQUIREMENTS.formats}.`
    )
  }

  const videos = input.media.filter(m => m.type === 'video').length
  if (videos > 0 && kinds.includes('story')) {
    warnings.push('Only the first 60 seconds of a video will be used for a Story.')
  }

  return warnings
}

/** Translate our options into the provider's field names.
 *
 *  `contentType` is the one field that differs by platform, and Zernio's
 *  guides are precise about it:
 *   - Instagram: only "story" exists. A lone video is a Reel with no field at
 *     all, and Meta 400s an unknown field verbatim — so nothing is sent for it.
 *   - Facebook: "reel" and "story" both exist, and the DEFAULT is a feed
 *     video. Choosing Reel used to send nothing, so a Facebook "Reel" went out
 *     as an ordinary feed video every time. */
export function toPlatformData(o: PostOptions, platform?: Platform): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  if (o.kind === 'story') out.contentType = 'story'
  if (o.kind === 'reel' && platform === 'facebook') out.contentType = 'reel'
  // an unknown field is a 400 from Meta, so this goes only where it exists
  if (o.longVideo && platform === 'twitter') out.longVideo = true
  if (o.shareToFeed !== undefined) out.shareToFeed = o.shareToFeed
  if (o.firstComment) out.firstComment = o.firstComment
  if (o.collaborators?.length) out.collaborators = o.collaborators.slice(0, 3)
  if (o.thumbnailUrl) out.instagramThumbnail = o.thumbnailUrl
  if (typeof o.thumbOffset === 'number') out.thumbOffset = o.thumbOffset
  if (o.isAiGenerated) out.isAiGenerated = true
  // Instagram only, and never on a Story: Instagram REFUSES a Story carrying
  // a location rather than ignoring it, so sending it there would turn a
  // harmless extra into a post that never goes out.
  if (o.locationId && platform === 'instagram' && kindTakesLocation(o.kind)) {
    const id = String(o.locationId).trim()
    if (isPageId(id)) out.locationId = id
  }

  if (o.userTags?.length) {
    const withCoords = tagsAcceptCoordinates(o.kind)
    out.userTags = o.userTags
      .filter(t => t.username?.trim())
      .map(t => {
        const username = t.username.trim().replace(/^@/, '')
        // Reels ignore coordinates entirely; sending them is noise at best
        if (!withCoords || t.x === undefined || t.y === undefined) return { username }
        return {
          username,
          x: Math.min(1, Math.max(0, t.x)),
          y: Math.min(1, Math.max(0, t.y)),
        }
      })
  }

  return Object.keys(out).length > 0 ? out : null
}

/** The exact body POST /posts expects. */
export type ZernioPostBody = {
  content: string
  platforms: {
    platform: Platform
    accountId: string
    platformSpecificData?: Record<string, unknown>
    /** replaces `mediaItems` for this platform only */
    customMedia?: MediaItem[]
    /** replaces `content` for this platform only */
    customContent?: string
  }[]
  mediaItems?: MediaItem[]
  scheduledFor?: string
  timezone?: string
  publishNow?: boolean
  /** TikTok's mandatory settings — top level, NOT platformSpecificData; Zernio
   *  calls that out as the one special case */
  tiktokSettings?: TikTokSettings
}

export type TikTokSettings = {
  privacy_level: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY'
  allow_comment: boolean
  allow_duet: boolean
  allow_stitch: boolean
  content_preview_confirmed: boolean
  express_consent_given: boolean
  /** send to the Creator Inbox for review instead of publishing */
  draft?: boolean
}

/**
 * What every TikTok post carries unless told otherwise.
 *
 * Zernio marks all six of these REQUIRED, and we were sending none of them —
 * every TikTok target in every post this app has ever made went out without
 * the block TikTok insists on. A public post that allows comments, duets and
 * stitches is what an agency posting for a brand means by "post it"; the two
 * consent flags are TikTok's legal requirement that the operator has seen the
 * preview and agreed to publish, which pressing Publish is.
 */
export const TIKTOK_DEFAULTS: TikTokSettings = {
  privacy_level: 'PUBLIC_TO_EVERYONE',
  allow_comment: true,
  allow_duet: true,
  allow_stitch: true,
  content_preview_confirmed: true,
  express_consent_given: true,
}

export function buildPostBody(input: {
  caption: string
  media: MediaItem[]
  targets: Target[]
  scheduledFor?: string | null
  timezone?: string
}): ZernioPostBody {
  const body: ZernioPostBody = {
    content: input.caption,
    platforms: input.targets.map(t => {
      const data = t.options ? toPlatformData(t.options, t.platform) : null
      return {
        platform: t.platform,
        accountId: t.accountId,
        ...(data ? { platformSpecificData: data } : {}),
        ...(t.options?.media?.length ? { customMedia: t.options.media } : {}),
        ...(t.options?.caption?.trim() ? { customContent: t.options.caption } : {}),
      }
    }),
  }
  if (input.media.length > 0) body.mediaItems = input.media
  if (input.targets.some(t => t.platform === 'tiktok')) body.tiktokSettings = { ...TIKTOK_DEFAULTS }
  if (input.scheduledFor) {
    body.scheduledFor = input.scheduledFor
    body.timezone = input.timezone ?? 'Australia/Melbourne'
  } else {
    body.publishNow = true
  }
  return body
}

/**
 * Classify a provider response so the caller knows whether the post exists.
 *
 * The critical case is 409: the provider's content-hash layer has already
 * created this post within the last 24 hours. That is a SUCCESS from our point
 * of view — the client's account has the post — and must never be retried,
 * or we would spin forever on a post that already went out.
 */
export type PublishOutcome =
  | { kind: 'published'; postId: string; replayed: boolean }
  | { kind: 'duplicate'; postId: string | null }
  | { kind: 'retryable'; message: string }
  | { kind: 'permanent'; message: string }

export function classifyResponse(
  status: number,
  body: unknown
): PublishOutcome {
  const b = (body ?? {}) as Record<string, unknown>
  const post = (b.post ?? b.existingPost ?? {}) as Record<string, unknown>
  const postId = typeof post._id === 'string' ? post._id : null

  if (status === 200 && b.existingPost) {
    // same x-request-id inside the ~5 minute window — our own retry
    return { kind: 'published', postId: postId ?? '', replayed: true }
  }
  if (status >= 200 && status < 300) {
    if (!postId) return { kind: 'retryable', message: 'Provider returned no post id' }
    return { kind: 'published', postId, replayed: false }
  }
  if (status === 409) {
    return { kind: 'duplicate', postId }
  }
  if (status === 429 || status >= 500) {
    return { kind: 'retryable', message: messageFrom(b, `Provider error ${status}`) }
  }
  // 400/401/403/404 — bad payload, bad key, unknown account. Retrying cannot help.
  return { kind: 'permanent', message: messageFrom(b, `Provider rejected the post (${status})`) }
}

function messageFrom(b: Record<string, unknown>, fallback: string): string {
  for (const k of ['error', 'message', 'detail']) {
    const v = b[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return fallback
}

/**
 * What the provider's per-platform results actually say, in one line.
 *
 * A four-channel post that lands on three and fails on one comes back as
 * `partial`, and the reconcile used to store exactly that word: "Provider
 * reported the post as partial after creation". The per-platform rows — which
 * channel, and the platform's own reason — were in the same response and
 * thrown away, so a post that was LIVE on YouTube read as a failure with no
 * reason anyone could act on.
 *
 * Pure. The row shape is Zernio's, kept loose: `platform`/`name`, `status`,
 * `errorMessage`/`error`, `platformPostUrl`.
 */
export type RemotePlatformRow = {
  platform?: string; name?: string; status?: string
  errorMessage?: string | null; error?: string | null
  platformPostUrl?: string | null
}

/**
 * A "failure" that is a wait.
 *
 * Zernio reports a TikTok upload that TikTok is still processing as
 * `status: "failed"` with this message and `tiktokTerminalDeferred: true`,
 * keeps checking, and flips it to published when TikTok finishes — a 2 GB
 * master took 63 minutes and went live. Reading that row as failed marked a
 * post that was going to succeed as one that had not, and offered a retry
 * that would have posted the video twice, which the message itself warns of.
 */
export function isStillProcessing(row: RemotePlatformRow): boolean {
  return /still processing/i.test(String(row.errorMessage ?? row.error ?? ''))
}

export function describeRemoteOutcome(
  overall: string, rows: RemotePlatformRow[] | null | undefined,
): {
  error: string; permalink: string | null
  livePlatforms: string[]; failedPlatforms: string[]; pendingPlatforms: string[]
} {
  const list = Array.isArray(rows) ? rows : []
  const name = (r: RemotePlatformRow) => String(r.platform ?? r.name ?? 'a channel').toLowerCase()
  const LIVE = ['published', 'posted', 'success']
  const live = list.filter(r => LIVE.includes(String(r.status ?? '').toLowerCase()))
  const pending = list.filter(r => isStillProcessing(r)
    || ['pending', 'processing', 'publishing'].includes(String(r.status ?? '').toLowerCase()))
  const failed = list.filter(r => String(r.status ?? '').toLowerCase() === 'failed' && !isStillProcessing(r))
  const reasons = failed.map(r => {
    const why = String(r.errorMessage ?? r.error ?? '').trim()
    return why ? `${name(r)}: ${why}` : `${name(r)}: no reason given`
  })
  const permalink = list.find(r => r.platformPostUrl)?.platformPostUrl ?? null

  const waiting = pending.length
    ? ` Still going out on ${pending.map(name).join(', ')} — the platform is processing it; do not resend.`
    : ''
  let error: string
  if (live.length > 0 && (reasons.length > 0 || pending.length > 0)) {
    error = `Went out on ${live.map(name).join(', ')}.`
      + (reasons.length ? ` Did not go out on ${reasons.join('; ')}.` : '')
      + waiting
  } else if (reasons.length > 0) {
    error = `Did not go out — ${reasons.join('; ')}.${waiting}`
  } else if (pending.length > 0) {
    error = waiting.trim()
  } else {
    error = `Provider reported the post as ${overall} after creation`
  }
  return {
    error, permalink,
    livePlatforms: live.map(name), failedPlatforms: failed.map(name), pendingPlatforms: pending.map(name),
  }
}
