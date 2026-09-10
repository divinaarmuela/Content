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

/** What a network is CALLED, once, so no two screens spell X differently.
 *
 *  It lives HERE rather than in the schedule rules because the posting-option
 *  refusals below name the network they are about, and a second spelling of
 *  "TikTok" is exactly how a person ends up reading two names for one thing.
 *  `social-schedule-core` re-exports it, so every existing caller is unmoved. */
export const NETWORK_LABEL: Record<string, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn',
  facebook: 'Facebook', twitter: 'X', x: 'X', youtube: 'YouTube',
  threads: 'Threads', pinterest: 'Pinterest', bluesky: 'Bluesky', reddit: 'Reddit',
}

/** The network's own name, for a sentence a person reads. */
export function networkName(platform: string): string {
  return NETWORK_LABEL[String(platform).toLowerCase()] ?? String(platform)
}

export type MediaItem = {
  url: string
  type: MediaType
  /** a cover picture for THIS file — how YouTube takes a custom thumbnail
   *  (JPEG/PNG/GIF, 1280x720, up to 2 MB; Shorts do not have one) */
  thumbnail?: string
}

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
  /** the per-network posting options the composer collected */
  optionsByPlatform?: Partial<Record<Platform, PostOptions>>
}): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (input.platforms.length === 0) {
    return [{ platform: 'instagram', problem: 'No platform selected' }]
  }

  /**
   * ONE CHANNEL PER NETWORK IN ONE POST.
   *
   * Everything per-channel in this body is keyed by NETWORK — the options,
   * the media override, the words, and TikTok's settings block, which is top
   * level and singular. Two Instagram accounts in one post therefore share
   * one set of answers, and the second account's choices are neither checked
   * nor sent. Refusing it in a sentence is honest; sending it and quietly
   * dropping half of it is not.
   */
  const already = new Set<Platform>()
  const platforms: Platform[] = []
  for (const p of input.platforms) {
    if (already.has(p)) {
      if (!issues.some(i => i.platform === p && i.problem.startsWith('Two '))) {
        issues.push({
          platform: p,
          problem: `Two ${networkName(p)} channels in one post is not something `
            + 'this can send yet — pick one, and make a second post for the other.',
        })
      }
      continue
    }
    already.add(p)
    platforms.push(p)
  }

  for (const p of platforms) {
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
        issues.push({ platform: p, problem: 'A carousel needs at least two slides' })
      } else if (media.length > r.carousel) {
        issues.push({
          platform: p,
          problem: `${media.length} slides; ${p} allows ${r.carousel} in one carousel`,
        })
      }
    }

    // …and everything wrong with the per-network options themselves.
    //
    // Only for a caller that COLLECTS options (the composer's path passes the
    // map, empty entries and all): for one of those, a channel nobody opened
    // still has to answer for TikTok's tick, which is missing precisely when
    // nothing has been touched. A caller that knows nothing about options —
    // the ad-hoc publish endpoint — is judged on the media and the words, as
    // it always was.
    if (input.optionsByPlatform) {
      const options = input.optionsByPlatform[p] ?? {}
      for (const problem of optionProblems(
        p, { ...options, kind: options.kind ?? kind }, media, caption,
      )) {
        issues.push({ platform: p, problem })
      }
    }
  }
  return issues
}

/**
 * Everything wrong with ONE network's posting options, in plain words.
 *
 * Shared deliberately: `validatePost` runs it on the way out and the
 * composer's live check runs the same function while somebody is still
 * typing, so the sentence a person reads before they press the button is the
 * same sentence that would stop the post — never a second, kinder set of
 * rules that lets a doomed post through.
 */
export function optionProblems(
  platform: Platform,
  o: PostOptions | null | undefined,
  media?: readonly MediaItem[] | null,
  /** the words that would go out on this channel — YouTube's title is taken
   *  from them when nobody writes one, so "no title" and "no caption" are the
   *  same problem said once */
  caption?: string | null,
): string[] {
  const out: string[] = []
  const name = networkName(platform)
  const slides = Array.isArray(media) ? media : []
  if (platform === 'youtube' && !(o?.title?.trim()) && !String(caption ?? '').trim()) {
    out.push('YouTube needs a title — write a caption, or give the video its own title.')
  }
  if (!o) return out

  /* ── the two Story refusals ── */
  if (o.kind === 'story') {
    if (o.locationId && platform === 'instagram') {
      out.push(
        'Instagram refuses a Story with a place on it — take the place off, '
        + 'or make this a feed post.')
    }
    if (o.firstComment?.trim() && (platform === 'instagram' || platform === 'facebook')) {
      out.push(
        `A ${name} Story has no comments, so the first comment would never `
        + 'appear — take it off.')
    }
    if (o.collaborators?.length && platform === 'instagram') {
      out.push(
        'A Story cannot have collaborators — take them off, or make this a '
        + 'feed post or a Reel.')
    }
  }

  /* ── YouTube's three lengths ── */
  if (platform === 'youtube') {
    const title = o.title?.trim() ?? ''
    if (title.length > YOUTUBE_TITLE_MAX) {
      out.push(
        `The YouTube title is ${title.length} letters — YouTube takes ${YOUTUBE_TITLE_MAX}.`)
    }
    const tagLength = tagsLength(o.tags)
    if (tagLength > YOUTUBE_TAGS_MAX) {
      out.push(
        `Those YouTube tags come to ${tagLength} letters together — YouTube `
        + `takes ${YOUTUBE_TAGS_MAX} for the lot.`)
    }
    if ((o.firstComment?.length ?? 0) > YOUTUBE_FIRST_COMMENT_MAX) {
      out.push('The YouTube first comment is too long — YouTube takes 10,000 letters.')
    }
  }

  /* ── TikTok: the tick, and the one combination TikTok will not allow ── */
  if (platform === 'tiktok') {
    if (!o.tiktokConsent) {
      out.push(`Tick the TikTok box to say you have checked the preview — ${TIKTOK_CONSENT_TICK}.`)
    }
    if (o.commercialContentType === 'brand_content'
      && (o.privacyLevel ?? TIKTOK_DEFAULTS.privacy_level) === 'SELF_ONLY') {
      out.push(
        'TikTok does not allow a paid partnership that only the account can '
        + 'see — choose who else can see it, or say it is not a promotion.')
    }
    if ((o.tiktokDescription?.trim().length ?? 0) > TIKTOK_DESCRIPTION_MAX) {
      out.push(`The TikTok description is too long — TikTok takes ${TIKTOK_DESCRIPTION_MAX} letters.`)
    }
    if (typeof o.photoCoverIndex === 'number' && slides.length > 0
      && o.photoCoverIndex >= slides.length) {
      out.push(
        `The TikTok cover is picture ${o.photoCoverIndex + 1}, and this post `
        + `has ${slides.length}.`)
    }
  }

  /* ── LinkedIn: a company page that is not one ── */
  if (platform === 'linkedin' && o.organizationUrn && !isOrganizationUrn(o.organizationUrn)) {
    out.push(
      'That does not look like a company page — pick one from the list, or '
      + 'paste the page id, a plain number.')
  }

  /* ── LinkedIn: a document title with no document on it ── */
  if (platform === 'linkedin' && o.documentTitle?.trim() && slides.length > 0
    && !slides.some(m => m.type === 'document')) {
    out.push('The document name only shows on a PDF post — this one has no PDF in it.')
  }

  return out
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

  /**
   * Only people in these countries see the post — Facebook feed posts,
   * videos and Reels (not Stories) and LinkedIn organization pages (300+
   * followers in the countries). ISO 3166-1 alpha-2 codes, up to 25. Sent as
   * `geoRestriction.countries`.
   */
  geoCountries?: string[]

  /* ── Instagram ─────────────────────────────────────────────────────── */

  /**
   * Trial Reel: show it to people who do NOT follow the account first, and
   * let Instagram (or a person) decide afterwards whether it goes to the
   * followers' feed too. Sent as `trialParams.graduationStrategy`; absent
   * means an ordinary Reel, which is what almost every post wants.
   */
  trialGraduation?: TrialGraduation
  /** The name shown under a Reel for its custom audio. */
  audioName?: string
  /** `false` turns comments off the moment it is published. */
  commentsEnabled?: boolean
  /** Strip the sound before sending — Reels, Stories and video slides. */
  muteAudio?: boolean
  /** The "Paid partnership" label; needs the account connected with Facebook Login. */
  isPaidPartnership?: boolean
  /** Up to two sponsors, Instagram usernames — only with the label above. */
  brandedContentSponsors?: string[]

  /* ── YouTube (and a Facebook Reel, which also carries a title) ─────── */

  /** The video's own headline — NOT the caption. YouTube takes 100
   *  characters; Facebook shows it on a Reel. */
  title?: string
  visibility?: YoutubeVisibility
  madeForKids?: boolean
  /** Search keywords. YouTube counts them TOGETHER: 500 characters for the
   *  lot, not per tag. */
  tags?: string[]
  /** YouTube's numeric category. `DEFAULT_YOUTUBE_CATEGORY` when nobody picks. */
  categoryId?: string
  playlistId?: string
  /** the video is AI-made or materially altered — YouTube's own disclosure */
  containsSyntheticMedia?: boolean

  /* ── LinkedIn ──────────────────────────────────────────────────────── */

  /** Post as a company page rather than the person. */
  organizationUrn?: string
  disableLinkPreview?: boolean
  /** The name shown on a PDF/document post. */
  documentTitle?: string

  /* ── Facebook ──────────────────────────────────────────────────────── */

  /** Which Page it goes to, when the account has more than one. */
  pageId?: string
  /** Save it in Facebook unpublished instead of posting it. */
  facebookDraft?: boolean

  /* ── TikTok ────────────────────────────────────────────────────────────
   *
   * EVERY ONE OF THESE LANDS IN `tiktokSettings`, at the TOP LEVEL of the
   * body — never in `platformSpecificData`. That is Zernio's one special
   * case, and `tiktokSettingsFor` is the only thing that should know it. */

  privacyLevel?: TikTokPrivacy
  allowComment?: boolean
  allowDuet?: boolean
  allowStitch?: boolean
  commercialContentType?: CommercialContentType
  videoMadeWithAi?: boolean
  /** send it to the account's TikTok inbox as a draft instead of posting */
  tiktokDraft?: boolean
  /** photo posts: let TikTok add music */
  autoAddMusic?: boolean
  /** the moment in the video the cover frame is taken from */
  videoCoverTimestampMs?: number
  /** …or a cover picture of our own, which wins over the timestamp */
  videoCoverImageUrl?: string
  /** which picture of a photo post is the cover */
  photoCoverIndex?: number
  /** photo posts carry their own description, up to 4,000 characters */
  tiktokDescription?: string
  /**
   * The operator has ticked TikTok's box.
   *
   * TikTok requires the person publishing to confirm they have seen the
   * preview and agree to TikTok's terms. It is not a setting with a sensible
   * default — it is a statement somebody makes — so a TikTok post is refused
   * until it is ticked, and the flags themselves are always sent true.
   */
  tiktokConsent?: boolean
}

export type TrialGraduation = 'MANUAL' | 'SS_PERFORMANCE'
export type YoutubeVisibility = 'public' | 'private' | 'unlisted'
export type CommercialContentType = 'none' | 'brand_organic' | 'brand_content'
export type TikTokPrivacy = TikTokSettings['privacy_level']

/* ── the numbers and the words each network attaches to those fields ────── */

export const YOUTUBE_TITLE_MAX = 100
/** all the tags together, not each one */
export const YOUTUBE_TAGS_MAX = 500
export const YOUTUBE_FIRST_COMMENT_MAX = 10_000
export const TIKTOK_DESCRIPTION_MAX = 4000

/** The YouTube categories anybody here posts into, by their plain name. The
 *  ids are YouTube's and cannot be invented; the names are what a person
 *  picks from. */
export const YOUTUBE_CATEGORIES: { id: string; name: string }[] = [
  { id: '1', name: 'Film and animation' },
  { id: '2', name: 'Cars and vehicles' },
  { id: '10', name: 'Music' },
  { id: '15', name: 'Pets and animals' },
  { id: '17', name: 'Sport' },
  { id: '20', name: 'Gaming' },
  { id: '22', name: 'People and blogs' },
  { id: '23', name: 'Comedy' },
  { id: '24', name: 'Entertainment' },
  { id: '25', name: 'News and politics' },
  { id: '26', name: 'How-to and style' },
  { id: '27', name: 'Education' },
  { id: '28', name: 'Science and technology' },
]

/** What a video is filed under when nobody chooses — YouTube's own default. */
export const DEFAULT_YOUTUBE_CATEGORY = '22'

export const YOUTUBE_VISIBILITY_LABELS: Record<YoutubeVisibility, string> = {
  public: 'Anyone can watch',
  unlisted: 'Only people with the link',
  private: 'Only the account',
}

/** Who can see a TikTok post, in TikTok's words rather than its constants. */
export const TIKTOK_PRIVACY_LABELS: Record<TikTokPrivacy, string> = {
  PUBLIC_TO_EVERYONE: 'Everyone',
  FOLLOWER_OF_CREATOR: 'Followers',
  MUTUAL_FOLLOW_FRIENDS: 'Friends — people they follow back',
  SELF_ONLY: 'Only the account itself',
}

/** The fallback list when the account's own allowed values cannot be read.
 *  TikTok decides per account which of these a creator may use, so the live
 *  list from the provider always wins over this one. */
export const TIKTOK_PRIVACY_LEVELS = Object.keys(TIKTOK_PRIVACY_LABELS) as TikTokPrivacy[]

export const COMMERCIAL_CONTENT_LABELS: Record<CommercialContentType, string> = {
  none: 'Not a promotion',
  brand_organic: 'Promoting our own brand',
  brand_content: 'Paid partnership',
}

/** The one sentence and the one tick TikTok requires before a post goes out. */
export const TIKTOK_CONSENT_LINE =
  'TikTok asks whoever posts to confirm they have seen how it will look and '
  + 'agree to TikTok’s terms — including its music rules for the sound on it.'
export const TIKTOK_CONSENT_TICK =
  'I’ve checked the preview and agree to TikTok’s terms'

export type UserTag = { username: string; x?: number; y?: number }

/** Is `v` a Facebook Page id — digits, nothing else? The whole validation
 *  there is: a name typed into the box is the mistake to catch, and it is
 *  caught by the shape. */
export function isPageId(v: string | null | undefined): boolean {
  return /^\d{5,25}$/.test(String(v ?? '').trim())
}

/** Is `v` a LinkedIn company page — `urn:li:organization:<digits>`?
 *
 *  LinkedIn's lists sometimes hand back a bare numeric id, and a person with
 *  a company page open in another tab will paste whatever they see. Neither
 *  is refused by LinkedIn with an explanation; the post simply does not
 *  appear as the company. `asOrganizationUrn` turns a bare number into the
 *  real thing; anything else is dropped rather than sent. */
export function isOrganizationUrn(v: string | null | undefined): boolean {
  return /^urn:li:organization:\d+$/.test(String(v ?? '').trim())
}

/** …the same value as a URN, when it can be one. */
export function asOrganizationUrn(v: string | null | undefined): string | null {
  const value = String(v ?? '').trim()
  if (isOrganizationUrn(value)) return value
  if (/^\d+$/.test(value)) return `urn:li:organization:${value}`
  return null
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

  // per network: a YouTube Short is not a Reel — three minutes, vertical,
  // and YouTube picks its cover (Zernio's YouTube guide, read 10 Sep 2026)
  const reelOn = Object.entries(input.kinds ?? {}).filter(([, k]) => k === 'reel').map(([p]) => p)
  if (reelOn.some(p => p !== 'youtube')) {
    warnings.push(
      `Reels should be ${REEL_REQUIREMENTS.aspect} (${REEL_REQUIREMENTS.resolution}), ` +
      `up to ${REEL_REQUIREMENTS.maxSeconds}s, ${REEL_REQUIREMENTS.formats}.`
    )
  }
  if ((input.kinds ?? {}).tiktok === 'carousel' || (('tiktok' in (input.kinds ?? {})) && input.media.length > 0 && input.media.every(m => m.type === 'image'))) {
    warnings.push(
      `TikTok shows a photo post's title as the first ${TIKTOK_PHOTO_TITLE_MAX} characters of the caption with the hashtags taken out`
      + `${input.caption.trim() ? ` — here "${tiktokPhotoTitle(input.caption)}"` : ''}. The whole caption goes under it as the description.`,
    )
  }
  if (reelOn.includes('youtube')) {
    warnings.push(
      'A YouTube Short is a vertical 9:16 video of up to 3 minutes — YouTube decides it is a Short from the file. '
      + 'Shorts cannot be given a cover picture; YouTube chooses a frame.'
    )
  }

  const videos = input.media.filter(m => m.type === 'video').length
  if (videos > 0 && kinds.includes('story')) {
    warnings.push('Only the first 60 seconds of a video will be used for a Story.')
  }

  return warnings
}

/**
 * Which networks accept each provider field.
 *
 * This is not tidiness. Meta answers an unknown field with a 400 naming it,
 * so a YouTube title sent to Instagram is not ignored — it is a post that
 * never happens, hours after anybody was watching. One table, read by
 * `toPlatformData`, is the whole guard.
 */
const FIELD_PLATFORMS: Record<string, Platform[]> = {
  // Facebook's guide has no `shareToFeed` and no `thumbOffset` — Meta answers
  // an unknown field with a 400 (the docs audit of 10 Sep 2026)
  shareToFeed: ['instagram'],
  firstComment: ['instagram', 'facebook', 'threads', 'linkedin', 'youtube'],
  collaborators: ['instagram'],
  instagramThumbnail: ['instagram'],
  thumbOffset: ['instagram'],
  geoRestriction: ['facebook', 'linkedin'],
  isAiGenerated: ['instagram'],
  userTags: ['instagram'],
  locationId: ['instagram'],
  trialParams: ['instagram'],
  audioName: ['instagram'],
  commentsEnabled: ['instagram'],
  muteAudio: ['instagram'],
  isPaidPartnership: ['instagram'],
  brandedContentSponsors: ['instagram'],
  title: ['youtube', 'facebook'],
  visibility: ['youtube'],
  madeForKids: ['youtube'],
  categoryId: ['youtube'],
  playlistId: ['youtube'],
  containsSyntheticMedia: ['youtube'],
  organizationUrn: ['linkedin'],
  disableLinkPreview: ['linkedin'],
  documentTitle: ['linkedin'],
  pageId: ['facebook'],
  facebookSettings: ['facebook'],
}

/** Tags as YouTube wants them: no blanks, no duplicates, no leading hash. */
export function cleanTags(tags: readonly string[] | null | undefined): string[] {
  const out: string[] = []
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = String(raw).trim().replace(/^#/, '')
    if (tag && !out.includes(tag)) out.push(tag)
  }
  return out
}

/** How long YouTube counts a set of tags as being: the tags plus the commas
 *  between them, which is the count that refuses a post. */
export function tagsLength(tags: readonly string[] | null | undefined): number {
  const list = cleanTags(tags)
  return list.length === 0 ? 0 : list.join(',').length
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
  /** write a field only where the network HAS it. A caller that names no
   *  platform gets the unguarded shape — every real caller names one. */
  const put = (field: string, value: unknown) => {
    if (!platform || (FIELD_PLATFORMS[field] ?? []).includes(platform)) out[field] = value
  }
  if (o.kind === 'story') out.contentType = 'story'
  if (o.kind === 'reel' && platform === 'facebook') out.contentType = 'reel'
  // an unknown field is a 400 from Meta, so this goes only where it exists
  if (o.longVideo && platform === 'twitter') out.longVideo = true
  if (o.shareToFeed !== undefined) put('shareToFeed', o.shareToFeed)
  // a Story has no comments to put a first comment under: Facebook refuses
  // it, and Instagram simply never posts it
  if (o.firstComment && o.kind !== 'story') put('firstComment', o.firstComment)
  // a Story has no collaborators either — Meta answers the field with a 400
  // and the post never goes out, exactly as it does for a location
  if (o.collaborators?.length && o.kind !== 'story') {
    put('collaborators', o.collaborators.slice(0, 3))
  }
  if (o.thumbnailUrl) put('instagramThumbnail', o.thumbnailUrl)
  if (typeof o.thumbOffset === 'number') put('thumbOffset', o.thumbOffset)
  if (o.isAiGenerated) put('isAiGenerated', true)
  if (o.geoCountries?.length && o.kind !== 'story') {
    const countries = cleanCountries(o.geoCountries)
    if (countries.length) put('geoRestriction', { countries })
  }
  // the rest of Instagram's own switches (docs.zernio.com/platforms/instagram,
  // read 10 Sep 2026): each travels only when it says something the network
  // would not do on its own
  if (o.commentsEnabled === false) put('commentsEnabled', false)
  if (o.muteAudio) put('muteAudio', true)
  if (o.isPaidPartnership) {
    put('isPaidPartnership', true)
    const sponsors = (o.brandedContentSponsors ?? []).map(s => String(s).trim().replace(/^@/, '')).filter(Boolean)
    if (sponsors.length) put('brandedContentSponsors', sponsors.slice(0, 2))
  }

  /* ── Instagram: a trial Reel, and the name of its sound ── */
  // both are Reel settings; a carousel or a Story carrying them is a 400
  // 'reel' and nothing else: a post that was a Reel when this was set and is
  // saved as a carousel later would otherwise still send it, and Instagram
  // answers that with a 400
  if (o.trialGraduation && o.kind === 'reel') {
    put('trialParams', { graduationStrategy: o.trialGraduation })
  }
  if (o.audioName?.trim() && o.kind === 'reel') {
    put('audioName', o.audioName.trim())
  }

  /* ── YouTube ── */
  if (o.title?.trim()) {
    // Facebook takes a title on a Reel only; YouTube takes one on everything
    if (platform !== 'facebook' || o.kind === 'reel') {
      put('title', o.title.trim().slice(0, YOUTUBE_TITLE_MAX))
    }
  }
  if (o.visibility) put('visibility', o.visibility)
  if (o.madeForKids !== undefined) put('madeForKids', o.madeForKids)
  // YouTube tags are NOT here: Zernio reads `tags` at the top of the body
  // only, and named the misplaced field in `warnings` while every tag ever
  // typed was dropped (the research of 10 Sep 2026) — `buildPostBody` sets it
  if (o.categoryId) put('categoryId', String(o.categoryId))
  if (o.playlistId) put('playlistId', String(o.playlistId))
  if (o.containsSyntheticMedia) put('containsSyntheticMedia', true)

  /* ── LinkedIn ── */
  // a bare id pasted into the box is the mistake people make, and LinkedIn
  // answers it by refusing the post rather than by asking
  if (isOrganizationUrn(o.organizationUrn)) {
    put('organizationUrn', String(o.organizationUrn).trim())
  }
  if (o.disableLinkPreview !== undefined) put('disableLinkPreview', o.disableLinkPreview)
  if (o.documentTitle?.trim()) put('documentTitle', o.documentTitle.trim())

  /* ── Facebook ── */
  if (o.pageId) put('pageId', String(o.pageId))
  // Zernio nests Facebook's draft flag one level down, under its own key
  if (o.facebookDraft) put('facebookSettings', { draft: true })
  // Instagram only, and never on a Story: Instagram REFUSES a Story carrying
  // a location rather than ignoring it, so sending it there would turn a
  // harmless extra into a post that never goes out.
  if (o.locationId && platform === 'instagram' && kindTakesLocation(o.kind)) {
    const id = String(o.locationId).trim()
    if (isPageId(id)) out.locationId = id
  }

  if (o.userTags?.length) {
    const withCoords = tagsAcceptCoordinates(o.kind)
    put('userTags', o.userTags
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
      }))
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
  /** YouTube search tags — top level too, so one set serves every YouTube
   *  channel in the body (one per post today) */
  tags?: string[]
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
  /** none / our own brand / a paid partnership — TikTok's disclosure */
  commercial_content_type?: CommercialContentType
  video_made_with_ai?: boolean
  /** photo posts: let TikTok add music */
  auto_add_music?: boolean
  /** the moment the cover frame is taken from */
  video_cover_timestamp_ms?: number
  /** …or a cover picture of our own */
  video_cover_image_url?: string
  /** which picture of a photo post is the cover */
  photo_cover_index?: number
  media_type?: 'video' | 'photo'
  /** a photo post's own description */
  description?: string
}

/**
 * One TikTok target's options as the settings block TikTok insists on.
 *
 * The defaults are what an agency means by "post it", so a post with nothing
 * touched still carries a legal, complete block. The two consent flags are
 * always true — they are what the operator's tick asserts, and a post whose
 * tick is missing is refused by `optionProblems` rather than sent with them
 * quietly false, which TikTok would reject anyway.
 *
 * A cover PICTURE beats a cover MOMENT: sending both is ambiguous, and the
 * picture is the more deliberate of the two.
 */
export function tiktokSettingsFor(
  o?: PostOptions | null,
  /** the post's caption and whether this is a PHOTO post: TikTok shows the
   *  first 90 characters of `content` as a photo post's title with the
   *  hashtags stripped, and the whole caption belongs in `description` —
   *  which the app never copied there (the docs audit of 10 Sep 2026) */
  post?: { caption?: string | null; photo?: boolean },
): TikTokSettings {
  const opts = o ?? {}
  const settings: TikTokSettings = {
    ...TIKTOK_DEFAULTS,
    ...(opts.privacyLevel ? { privacy_level: opts.privacyLevel } : {}),
    ...(opts.allowComment !== undefined ? { allow_comment: opts.allowComment } : {}),
    ...(opts.allowDuet !== undefined ? { allow_duet: opts.allowDuet } : {}),
    ...(opts.allowStitch !== undefined ? { allow_stitch: opts.allowStitch } : {}),
  }
  if (opts.commercialContentType) settings.commercial_content_type = opts.commercialContentType
  if (opts.videoMadeWithAi) settings.video_made_with_ai = true
  if (opts.tiktokDraft) settings.draft = true
  if (opts.autoAddMusic !== undefined) settings.auto_add_music = opts.autoAddMusic
  if (opts.videoCoverImageUrl?.trim()) {
    settings.video_cover_image_url = opts.videoCoverImageUrl.trim()
  } else if (typeof opts.videoCoverTimestampMs === 'number'
    && Number.isFinite(opts.videoCoverTimestampMs) && opts.videoCoverTimestampMs >= 0) {
    settings.video_cover_timestamp_ms = Math.round(opts.videoCoverTimestampMs)
  }
  if (typeof opts.photoCoverIndex === 'number' && Number.isFinite(opts.photoCoverIndex)
    && opts.photoCoverIndex >= 0) {
    settings.photo_cover_index = Math.trunc(opts.photoCoverIndex)
  }
  if (opts.tiktokDescription?.trim()) {
    settings.description = opts.tiktokDescription.trim().slice(0, TIKTOK_DESCRIPTION_MAX)
  } else if (post?.photo && post.caption?.trim()) {
    settings.description = post.caption.trim().slice(0, TIKTOK_DESCRIPTION_MAX)
  }
  if (post?.photo) settings.media_type = 'photo'
  return settings
}

/** TikTok's photo-post title: the first 90 characters of the caption, with
 *  hashtags and links stripped — what the network does to `content`. */
export const TIKTOK_PHOTO_TITLE_MAX = 90
export function tiktokPhotoTitle(caption: string | null | undefined): string {
  return String(caption ?? '').replace(/#[^\s#]+/g, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, TIKTOK_PHOTO_TITLE_MAX)
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

/**
 * What a YouTube post carries when nobody opens its options.
 *
 * YouTube will not take a video without a title, a category and an answer to
 * the made-for-children question, and none of the three is a decision an
 * agency makes per post. The title is the caption's first line — the words
 * already written — and anything actually chosen in the window wins over all
 * of it.
 *
 * WHO CAN WATCH IS NOT IN HERE, deliberately. A channel that publishes its
 * uploads privately by default would start publishing them to the world
 * because of a default WE invented; that is the provider's decision unless
 * somebody in the window makes it.
 */
export function youtubeDefaults(caption: string | null | undefined): Record<string, unknown> {
  const first = String(caption ?? '').split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? ''
  return {
    ...(first ? { title: first.slice(0, YOUTUBE_TITLE_MAX) } : {}),
    categoryId: DEFAULT_YOUTUBE_CATEGORY,
    madeForKids: false,
  }
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
      const chosen = t.options ? toPlatformData(t.options, t.platform) : null
      // YouTube refuses a video with no title and no category, so a post
      // nobody opened the options for still carries both — under whatever
      // was actually chosen, never over it
      const data = t.platform === 'youtube'
        ? { ...youtubeDefaults(t.options?.caption?.trim() || input.caption), ...(chosen ?? {}) }
        : chosen
      /**
       * A YOUTUBE THUMBNAIL RIDES ON THE MEDIA, NOT ON THE SETTINGS.
       *
       * Zernio takes it as `mediaItems[].thumbnail`, so the only way to give
       * one channel its own cover picture without changing everybody's is to
       * hand YouTube its own copy of the media with the thumbnail on it.
       * Shorts have no custom thumbnail at all — YouTube ignores it there —
       * so nothing is attached to one.
       */
      const media = t.options?.media?.length ? t.options.media : input.media
      const wantsThumb = t.platform === 'youtube' && t.options?.thumbnailUrl?.trim()
        && t.options?.kind !== 'reel' && media.length > 0
      const customMedia = wantsThumb
        ? media.map((m, i) => (i === 0 ? { ...m, thumbnail: t.options!.thumbnailUrl!.trim() } : m))
        : t.options?.media?.length ? t.options.media : null

      return {
        platform: t.platform,
        accountId: t.accountId,
        ...(data && Object.keys(data).length > 0 ? { platformSpecificData: data } : {}),
        ...(customMedia ? { customMedia } : {}),
        ...(t.options?.caption?.trim() ? { customContent: t.options.caption } : {}),
      }
    }),
  }
  if (input.media.length > 0) body.mediaItems = input.media
  // TikTok's block is TOP LEVEL and there is exactly one of it, so a body
  // with two TikTok accounts in it carries the first one's settings. Nothing
  // in this app targets two TikTok accounts from one post today; if it ever
  // does, the post has to be split rather than the second one's choices
  // silently thrown away.
  const tiktok = input.targets.find(t => t.platform === 'tiktok')
  if (tiktok) {
    const ttMedia = tiktok.options?.media?.length ? tiktok.options.media : input.media
    const photo = ttMedia.length > 0 && ttMedia.every(m => m.type === 'image')
    body.tiktokSettings = tiktokSettingsFor(tiktok.options, { caption: tiktok.options?.caption ?? input.caption, photo })
  }
  // YouTube's tags ride at the top level as well — inside the platform entry
  // Zernio ignores them and says so in `warnings` (10 Sep 2026)
  const youtube = input.targets.find(t => t.platform === 'youtube' && t.options?.tags?.length)
  if (youtube) {
    const tags = cleanTags(youtube.options!.tags)
    if (tags.length) body.tags = tags
  }
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
  /** `platforms`: the provider's per-channel rows when it sent them — a
   *  207 "partial" carries one live channel and one refused in the same body */
  | { kind: 'published'; postId: string; replayed: boolean; platforms?: RemotePlatformRow[] }
  | { kind: 'duplicate'; postId: string | null }
  | { kind: 'retryable'; message: string }
  | { kind: 'permanent'; message: string; postId?: string | null; platforms?: RemotePlatformRow[] }

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
    // 207 IS A 2XX AND IT MEANS "CREATED BUT NOT PUBLISHED": every one of
    // Zernio's platform guides says to branch on `post.status` as well as the
    // code. A post that failed on every channel was being recorded as posted
    // until the next sweep (the docs audit of 10 Sep 2026).
    const rows = Array.isArray(post.platforms) ? post.platforms as RemotePlatformRow[] : []
    const said = String(post.status ?? '').toLowerCase()
    if (said === 'failed') {
      const why = rows.map(r => String(r.errorMessage ?? r.error ?? '').trim()).find(Boolean)
        ?? messageFrom(b, 'The provider could not publish it')
      return { kind: 'permanent', message: platformErrorWords(why), postId, platforms: rows }
    }
    return { kind: 'published', postId, replayed: false, ...(rows.length ? { platforms: rows } : {}) }
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

/**
 * THE PROVIDER'S DOCUMENTED ERRORS, AS A PERSON WOULD SAY THEM — with what to
 * do. Read off the "Common errors" tables of Zernio's TikTok, Instagram,
 * Facebook and LinkedIn guides on 10 Sep 2026. Anything not listed is
 * returned as the provider wrote it.
 */
const PLATFORM_ERROR_WORDS: readonly [RegExp, string][] = [
  [/at capacity|active user quota/i, 'TikTok is at capacity for new posting accounts right now — it clears within a few hours. Move the post later, or turn on "Send it to the TikTok inbox as a draft" in More options, which is not affected.'],
  [/too many posts in the last 24 hours/i, 'This account has hit TikTok\'s daily limit for posts made through apps. Wait for the day to roll over, or post it in the TikTok app.'],
  [/5 pending drafts/i, 'TikTok allows five waiting drafts per account per day. Finish or discard some in the TikTok app — waiting does not free the slot.'],
  [/timeout waiting for platform/i, 'The network took too long to process the upload, which is normal for a big video. Check the post again in a few minutes before doing anything.'],
  [/privacy level .* not available/i, 'That privacy setting is not one this TikTok account allows. Open More options and pick one of the offered ones.'],
  [/spam_risk|potentially risky/i, 'TikTok\'s moderation flagged this post. Review the caption and video — moderation through apps is stricter than in the TikTok app.'],
  [/duplicate content|duplicate of urn/i, 'The network sees this as a repeat of a recent post. Change the caption or the media, then send it again.'],
  [/download failed|cannot process video from this url|unable to fetch video|media fetch failed/i, 'The network could not download the file. Attach it again from the library and try once more.'],
  [/missing required tiktok permissions|reconnect with all required scopes/i, 'TikTok needs the account reconnected with every permission granted. Use the connect link.'],
  [/access token expired|tokens? expired|please reconnect/i, 'The account\'s connection has run out. Reconnect it from the Schedule page, then send the post again.'],
  [/maximum of 100 posts per day/i, 'Instagram allows 100 posts per account per day, every kind counted. Move this one to tomorrow.'],
  [/blocked your request/i, 'Instagram blocked the request as automation. Wait a while, vary the content, then try again.'],
  [/photos should be smaller than 4mb/i, 'Facebook takes pictures up to 4 MB as JPEG or PNG. Attach a smaller export.'],
  [/missing or invalid image file/i, 'Facebook could not read the picture. Attach it again as a JPEG or PNG under 4 MB.'],
  [/confirm your identity/i, 'Facebook wants the Page owner to confirm their identity in the Facebook app before it publishes. Ask them to open the Page in the app and complete it, then send again.'],
  [/max retries reached|preflight checks/i, 'The network refused it three times running, which is usually temporary. Send it again in a little while.'],
  [/cannot mix media types/i, 'LinkedIn takes pictures, one video or one document in a post — never together. Split them into separate posts.'],
  [/video processing failed/i, 'LinkedIn could not process the video: it needs H.264, within the length limit, and a shape between 1:2.4 and 2.4:1.'],
  [/trial reels require/i, 'Instagram only allows Trial Reels on accounts with 1,000 or more followers. Change the type to Reel and send it again.'],
]

/** Two-letter country codes, upper case, de-duplicated, at most 25. */
export function cleanCountries(list: readonly string[] | null | undefined): string[] {
  const out: string[] = []
  for (const raw of list ?? []) {
    const code = String(raw ?? '').trim().toUpperCase()
    if (/^[A-Z]{2}$/.test(code) && !out.includes(code)) out.push(code)
  }
  return out.slice(0, 25)
}

export function platformErrorWords(message: string | null | undefined): string {
  const text = String(message ?? '').trim()
  for (const [re, words] of PLATFORM_ERROR_WORDS) if (re.test(text)) return words
  return text
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
  /** `isDraft: true` — handed to the creator's inbox / Publishing Tools, not live */
  platformSpecificData?: { isDraft?: boolean } | null
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
