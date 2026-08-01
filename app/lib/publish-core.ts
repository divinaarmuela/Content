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
 *  often bites, because a carousel with a stray video is silently rejected. */
export const PLATFORM_RULES: Record<Platform, {
  captionMax: number
  images: number
  videos: number
  documents: number
  mixed: boolean
  requiresMedia: boolean
}> = {
  instagram: { captionMax: 2200,  images: 10, videos: 1, documents: 0, mixed: false, requiresMedia: true  },
  tiktok:    { captionMax: 2200,  images: 35, videos: 1, documents: 0, mixed: false, requiresMedia: true  },
  twitter:   { captionMax: 280,   images: 4,  videos: 1, documents: 0, mixed: false, requiresMedia: false },
  linkedin:  { captionMax: 3000,  images: 20, videos: 1, documents: 1, mixed: false, requiresMedia: false },
  facebook:  { captionMax: 63206, images: 10, videos: 1, documents: 0, mixed: false, requiresMedia: false },
  threads:   { captionMax: 500,   images: 10, videos: 1, documents: 0, mixed: false, requiresMedia: false },
  youtube:   { captionMax: 5000,  images: 0,  videos: 1, documents: 0, mixed: false, requiresMedia: true  },
  pinterest: { captionMax: 500,   images: 1,  videos: 1, documents: 0, mixed: false, requiresMedia: true  },
  bluesky:   { captionMax: 300,   images: 4,  videos: 1, documents: 0, mixed: false, requiresMedia: false },
  reddit:    { captionMax: 40000, images: 1,  videos: 1, documents: 0, mixed: false, requiresMedia: false },
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
    if (images > r.images) {
      issues.push({ platform: p, problem: `${images} images; ${p} allows ${r.images}` })
    }
    if (videos > r.videos) {
      issues.push({ platform: p, problem: `${videos} videos; ${p} allows ${r.videos}` })
    }
    if (docs > r.documents) {
      issues.push({
        platform: p,
        problem: r.documents === 0
          ? `${p} does not accept documents`
          : `${docs} documents; ${p} allows ${r.documents}`,
      })
    }
    if (!r.mixed && images > 0 && videos > 0) {
      issues.push({ platform: p, problem: `${p} cannot mix images and video in one post` })
    }
  }
  return issues
}

/** The exact body POST /posts expects. */
export type ZernioPostBody = {
  content: string
  platforms: { platform: Platform; accountId: string }[]
  mediaItems?: MediaItem[]
  scheduledFor?: string
  timezone?: string
  publishNow?: boolean
}

export function buildPostBody(input: {
  caption: string
  media: MediaItem[]
  targets: { platform: Platform; accountId: string }[]
  scheduledFor?: string | null
  timezone?: string
}): ZernioPostBody {
  const body: ZernioPostBody = {
    content: input.caption,
    platforms: input.targets.map(t => ({ platform: t.platform, accountId: t.accountId })),
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
