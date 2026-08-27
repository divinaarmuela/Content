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
}> = {
  instagram: { captionMax: 2200,  images: 10, videos: 1, documents: 0, mixed: false, requiresMedia: true,  carousel: 10, mixedCarousel: true  },
  tiktok:    { captionMax: 2200,  images: 35, videos: 1, documents: 0, mixed: false, requiresMedia: true,  carousel: 35, mixedCarousel: false },
  twitter:   { captionMax: 280,   images: 4,  videos: 1, documents: 0, mixed: false, requiresMedia: false, carousel: 4,  mixedCarousel: false },
  linkedin:  { captionMax: 3000,  images: 20, videos: 1, documents: 1, mixed: false, requiresMedia: false, carousel: 20, mixedCarousel: false },
  facebook:  { captionMax: 63206, images: 10, videos: 1, documents: 0, mixed: false, requiresMedia: false, carousel: 10, mixedCarousel: true  },
  threads:   { captionMax: 500,   images: 10, videos: 1, documents: 0, mixed: false, requiresMedia: false, carousel: 10, mixedCarousel: true  },
  youtube:   { captionMax: 5000,  images: 0,  videos: 1, documents: 0, mixed: false, requiresMedia: true,  carousel: 0,  mixedCarousel: false },
  pinterest: { captionMax: 500,   images: 1,  videos: 1, documents: 0, mixed: false, requiresMedia: true,  carousel: 0,  mixedCarousel: false },
  bluesky:   { captionMax: 300,   images: 4,  videos: 1, documents: 0, mixed: false, requiresMedia: false, carousel: 4,  mixedCarousel: false },
  reddit:    { captionMax: 40000, images: 1,  videos: 1, documents: 0, mixed: false, requiresMedia: false, carousel: 0,  mixedCarousel: false },
}

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
}): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const images = input.media.filter(m => m.type === 'image').length
  const videos = input.media.filter(m => m.type === 'video').length
  const docs   = input.media.filter(m => m.type === 'document').length

  if (input.platforms.length === 0) {
    return [{ platform: 'instagram', problem: 'No platform selected' }]
  }

  for (const p of input.platforms) {
    const r = PLATFORM_RULES[p]
    if (!r) { issues.push({ platform: p, problem: `Unsupported platform "${p}"` }); continue }

    if (input.caption.length > r.captionMax) {
      issues.push({
        platform: p,
        problem: `Caption is ${input.caption.length} characters; ${p} allows ${r.captionMax}`,
      })
    }
    if (r.requiresMedia && input.media.length === 0) {
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
    if (kind === 'story' && input.media.length !== 1) {
      issues.push({ platform: p, problem: 'A Story takes exactly one image or video' })
    }
    if (kind === 'carousel') {
      if (r.carousel === 0) {
        issues.push({ platform: p, problem: `${p} does not post carousels` })
      } else if (input.media.length < 2) {
        issues.push({ platform: p, problem: 'A carousel needs at least two items' })
      } else if (input.media.length > r.carousel) {
        issues.push({
          platform: p,
          problem: `${input.media.length} slides; ${p} allows ${r.carousel} in one carousel`,
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
}

export type UserTag = { username: string; x?: number; y?: number }

/** Do coordinates make any difference for this kind of post? */
export function tagsAcceptCoordinates(kind: PostKind | undefined): boolean {
  return kind !== 'reel'
}

export type Target = { platform: Platform; accountId: string; options?: PostOptions }

/** Media rules that apply to a particular kind of post, beyond the platform's
 *  general limits. Duration and aspect ratio cannot be checked here — they
 *  need the file — so they are documented for the UI to surface. */
export const REEL_REQUIREMENTS = {
  maxSeconds: 90,
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

/** Translate our options into the provider's field names. */
export function toPlatformData(o: PostOptions): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  if (o.kind === 'story') out.contentType = 'story'
  if (o.shareToFeed !== undefined) out.shareToFeed = o.shareToFeed
  if (o.firstComment) out.firstComment = o.firstComment
  if (o.collaborators?.length) out.collaborators = o.collaborators.slice(0, 3)
  if (o.thumbnailUrl) out.instagramThumbnail = o.thumbnailUrl
  if (typeof o.thumbOffset === 'number') out.thumbOffset = o.thumbOffset
  if (o.isAiGenerated) out.isAiGenerated = true

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
  }[]
  mediaItems?: MediaItem[]
  scheduledFor?: string
  timezone?: string
  publishNow?: boolean
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
      const data = t.options ? toPlatformData(t.options) : null
      return {
        platform: t.platform,
        accountId: t.accountId,
        ...(data ? { platformSpecificData: data } : {}),
      }
    }),
  }
  if (input.media.length > 0) body.mediaItems = input.media
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
