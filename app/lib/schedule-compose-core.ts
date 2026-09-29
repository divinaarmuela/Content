/**
 * THE NEW POST WINDOW'S RULES, WITH NO SCREEN ATTACHED.
 *
 * The composer is the one place in the app where a person's choices turn into
 * something a client's account will actually show, so the decisions inside it
 * — what a channel will take, what the clock says, which file is in the post
 * and what the button at the bottom does next — are here, pure and tested,
 * rather than tangled into JSX where they can only be checked by clicking.
 *
 * Three rules this file exists to keep true:
 *
 *  1. NOTHING IS OFFERED THAT THE PROVIDER CANNOT DO. `moreOptionsFor` reads
 *     what `publish-core`'s `toPlatformData` actually sends. A row for
 *     "Add location" would be a control that silently does nothing, which is
 *     worse than not having it.
 *  2. THE LIMITS ARE SAID IN WORDS, NOT ENFORCED IN SILENCE. `limitsLine` is
 *     the sentence under the media tray; the refusal itself is
 *     `validateComposition`, and both read `PLATFORM_RULES`.
 *  3. THE CLOCK IS THE CLIENT'S. `splitClock` and `joinClock` are inverses
 *     through the client's zone, so 6:30 pm on the picker is 6:30 pm for the
 *     audience, whatever time it is where the person clicking is sitting.
 */

import {
  asOrganizationUrn, cleanPollOptions, cleanVolume, COMMERCIAL_CONTENT_LABELS,
  DEFAULT_YOUTUBE_CATEGORY, isPageId, isOrganizationUrn, kindTakesLocation,
  networkName, PLATFORM_RULES, POLL_DURATIONS, POLL_OPTIONS_MAX, POLL_QUESTION_MAX,
  POLL_OPTION_MAX, CARD_TEXT_MAX, CAROUSEL_CARDS_MAX,
  TIKTOK_CONSENT_LINE, TIKTOK_CONSENT_TICK,
  TIKTOK_PRIVACY_LABELS, TIKTOK_PRIVACY_LEVELS, YOUTUBE_CATEGORIES,
  YOUTUBE_VISIBILITY_LABELS,
  type CommercialContentType, type FacebookCarouselCard, type InstagramAudio,
  type LinkedInPoll, type Platform, type PollDuration, type PostKind, type PostOptions,
  type TikTokPrivacy, type TrialGraduation, type UserTag, type YoutubeVisibility,
} from './publish-core'
import { NETWORK_LABEL } from './publish-core'
import { reorder, type Slide, type SlideSource } from './version-files-core'
import { fromZonedInput, wallTimeIn } from './timezone-core'
import type { PostAutomation } from './comment-automation-core'

/* ── the composition being edited ───────────────────────────────────────── */

/**
 * Per-channel extras — everything one channel may be set to do differently.
 *
 * EVERY NAME HERE IS THE `PostOptions` NAME. That is not a style choice: the
 * last round of this feature lost four settings between the window and the
 * provider because the composer, the stored blob and the publisher each spelled
 * them their own way and one hand-written copy step forgot a line. There is now
 * one spelling and one copy step (`optionsFromExtras`), and the compile-time
 * check below refuses a field that is not a real posting option.
 *
 * `slides` is the single exception, and it is handled explicitly everywhere.
 */
export type ChannelExtras = {
  caption?: string
  /** stored as a plain string; it IS a `PostKind` */
  kind?: string
  firstComment?: string
  collaborators?: string[]
  shareToFeed?: boolean
  /** the numeric Facebook Page id of the place — Instagram only */
  locationId?: string
  /* Instagram */
  trialGraduation?: TrialGraduation
  audioName?: string
  /** milliseconds into the video the Reel cover is taken from */
  thumbOffset?: number
  /** people tagged in the post — usernames; feed pictures carry a centre point */
  userTags?: UserTag[]
  isAiGenerated?: boolean
  commentsEnabled?: boolean
  muteAudio?: boolean
  isPaidPartnership?: boolean
  brandedContentSponsors?: string[]
  /** a track from Instagram's own catalogue, on a Reel */
  audio?: InstagramAudio
  /* Facebook and LinkedIn: only these countries see it */
  geoCountries?: string[]
  /* YouTube, and a Facebook Reel's title */
  title?: string
  visibility?: YoutubeVisibility
  madeForKids?: boolean
  tags?: string[]
  categoryId?: string
  playlistId?: string
  containsSyntheticMedia?: boolean
  /** YouTube's custom thumbnail — it rides on the media, not the settings */
  thumbnailUrl?: string
  /* LinkedIn */
  organizationUrn?: string
  disableLinkPreview?: boolean
  documentTitle?: string
  /** a question and two to four answers, instead of a post */
  poll?: LinkedInPoll
  /** somebody else's LinkedIn post, with our caption on top of it */
  reshareUrl?: string
  /* Facebook */
  pageId?: string
  facebookDraft?: boolean
  /** a link under each picture — Facebook's clickable carousel */
  carouselCards?: FacebookCarouselCard[]
  /** where the "See more" card at the end goes */
  carouselLink?: string
  /** Facebook's own number for a big-text background, on a text-only post */
  textFormatPresetId?: string
  /* TikTok */
  privacyLevel?: TikTokPrivacy
  allowComment?: boolean
  allowDuet?: boolean
  allowStitch?: boolean
  commercialContentType?: CommercialContentType
  videoMadeWithAi?: boolean
  tiktokDraft?: boolean
  autoAddMusic?: boolean
  videoCoverTimestampMs?: number
  videoCoverImageUrl?: string
  photoCoverIndex?: number
  tiktokDescription?: string
  tiktokConsent?: boolean
  /** this channel's OWN media, replacing the shared set for it alone. The
   *  window does not edit this; it carries it so a save cannot lose it. */
  slides?: Slide[]
}

/**
 * Every key `ChannelExtras` has, listed once so nothing can be forwarded by
 * hand and forgotten.
 *
 * The map is typed `Record<keyof ChannelExtras, true>`, so adding a field to
 * the type above and not to this list is a TYPE ERROR, not a setting that
 * silently never reaches the provider — which is exactly how `locationId`,
 * `firstComment`, `collaborators` and `shareToFeed` were lost last round.
 */
const EXTRA_KEY_MAP: Record<keyof ChannelExtras, true> = {
  caption: true, kind: true, slides: true,
  firstComment: true, collaborators: true, shareToFeed: true, locationId: true,
  trialGraduation: true, audioName: true,
  thumbOffset: true, userTags: true, isAiGenerated: true, commentsEnabled: true,
  muteAudio: true, isPaidPartnership: true, brandedContentSponsors: true,
  audio: true,
  geoCountries: true,
  title: true, visibility: true, madeForKids: true, tags: true,
  categoryId: true, playlistId: true, containsSyntheticMedia: true, thumbnailUrl: true,
  organizationUrn: true, disableLinkPreview: true, documentTitle: true,
  poll: true, reshareUrl: true,
  pageId: true, facebookDraft: true,
  carouselCards: true, carouselLink: true, textFormatPresetId: true,
  privacyLevel: true, allowComment: true, allowDuet: true, allowStitch: true,
  commercialContentType: true, videoMadeWithAi: true, tiktokDraft: true,
  autoAddMusic: true, videoCoverTimestampMs: true, videoCoverImageUrl: true,
  photoCoverIndex: true, tiktokDescription: true, tiktokConsent: true,
}

export const CHANNEL_EXTRA_KEYS =
  Object.keys(EXTRA_KEY_MAP) as (keyof ChannelExtras)[]

/** Compile-time: every extra the window edits (bar the two with a shape of
 *  their own) IS a posting option the publisher knows how to send. */
export const EXTRAS_ARE_POSTING_OPTIONS: (
  Omit<ChannelExtras, 'slides' | 'kind'> extends Partial<PostOptions> ? true : never
) = true

/**
 * One channel's extras as the options the publisher takes.
 *
 * Driven by `CHANNEL_EXTRA_KEYS` rather than written out field by field, so a
 * new setting reaches the provider the moment it exists. `slides` is left
 * behind on purpose: the media a channel posts is applied with that
 * platform's own limits, by the caller that knows them.
 */
export function optionsFromExtras(extras: ChannelExtras | null | undefined): PostOptions {
  const from = (extras ?? {}) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of CHANNEL_EXTRA_KEYS) {
    if (key === 'slides') continue
    const value = from[key]
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && !value.trim()) continue
    if (Array.isArray(value) && value.length === 0) continue
    out[key] = value
  }
  return out as PostOptions
}

/** Everything the window is holding about one post. */
export type ComposerState = {
  /** null until the draft has been written — the window opens before it exists */
  postId: string | null
  itemId: string
  /** the media in the post, in posting order */
  slides: Slide[]
  caption: string
  /** the account ids this goes to */
  channels: string[]
  /** the instant it goes out, or null while nobody has picked one */
  scheduledFor: string | null
  perChannel: Record<string, ChannelExtras>
  /** the comment-to-DM automation, set up while scheduling (comment-automation-core) */
  automation?: PostAutomation | null
  /** has anything changed since the last save */
  dirty: boolean
}

export type ComposerAction =
  | { type: 'loaded'; state: Partial<ComposerState> }
  | { type: 'caption'; caption: string }
  | { type: 'slides'; slides: Slide[] }
  /** a measurement landing on the slides — a fact about the files, not an
   *  edit to the post, so it never makes the window "unsaved" */
  | { type: 'measured'; slides: Slide[] }
  | { type: 'channel'; id: string; on: boolean }
  /** `quiet`: a default being set for the person, not a change they made —
   *  the window does not become "unsaved" over it */
  | { type: 'time'; iso: string | null; quiet?: boolean }
  | { type: 'extra'; channel: string; patch: ChannelExtras }
  | { type: 'saved'; postId?: string | null }
  /** the post's comment-to-DM automation, edited in the window like the caption */
  | { type: 'automation'; automation: PostAutomation | null }

/**
 * The window's opening state.
 *
 * EVERY field the post already holds has to be seeded here, `caption` and
 * `perChannel` included. Leaving them empty and PATCHing them anyway is how a
 * scheduler who opened an approved post to check the time, pressed Schedule,
 * and wiped the caption AND the client's approval in one click — the server
 * reads a caption change as a content change and takes the approval back.
 */
export function initialComposer(input: {
  itemId: string
  postId?: string | null
  slides?: readonly Slide[]
  caption?: string | null
  scheduledFor?: string | null
  channels?: readonly string[]
  perChannel?: Record<string, ChannelExtras> | null
  automation?: PostAutomation | null
}): ComposerState {
  return {
    postId: input.postId ?? null,
    itemId: input.itemId,
    slides: [...(input.slides ?? [])],
    caption: String(input.caption ?? ''),
    channels: [...(input.channels ?? [])],
    scheduledFor: input.scheduledFor ?? null,
    perChannel: { ...(input.perChannel ?? {}) },
    ...(input.automation ? { automation: input.automation } : {}),
    dirty: false,
  }
}

/**
 * Read the `per_channel` blob off a stored post into the shape the window
 * edits, dropping anything that is not one of the fields we send.
 *
 * It has to keep EVERY field the server's own `PerChannel` keeps — `slides`
 * included, which nothing writes today. What this drops, the window sends
 * back as absent: the server then reads that as a content change and takes
 * the client's approval down with it, which is precisely the failure the
 * seeding fix exists to end, surviving in one field.
 */
export function readPerChannel(v: unknown): Record<string, ChannelExtras> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, ChannelExtras> = {}
  for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    out[id] = readChannelExtras(raw)
  }
  return out
}

/** What SHAPE each extra is stored as. Exhaustive on purpose: a new setting
 *  cannot be added to `ChannelExtras` without saying how it is read back. */
const EXTRA_SHAPE: Record<
  keyof ChannelExtras,
  'text' | 'flag' | 'number' | 'list' | 'people' | 'slides' | 'audio' | 'poll' | 'cards'
> = {
  caption: 'text', kind: 'text', slides: 'slides',
  firstComment: 'text', collaborators: 'list', shareToFeed: 'flag', locationId: 'text',
  trialGraduation: 'text', audioName: 'text',
  thumbOffset: 'number', userTags: 'people', isAiGenerated: 'flag', commentsEnabled: 'flag',
  muteAudio: 'flag', isPaidPartnership: 'flag', brandedContentSponsors: 'list',
  audio: 'audio',
  geoCountries: 'list',
  title: 'text', visibility: 'text', madeForKids: 'flag', tags: 'list',
  categoryId: 'text', playlistId: 'text', containsSyntheticMedia: 'flag',
  thumbnailUrl: 'text',
  organizationUrn: 'text', disableLinkPreview: 'flag', documentTitle: 'text',
  poll: 'poll', reshareUrl: 'text',
  pageId: 'text', facebookDraft: 'flag',
  carouselCards: 'cards', carouselLink: 'text', textFormatPresetId: 'text',
  privacyLevel: 'text', allowComment: 'flag', allowDuet: 'flag', allowStitch: 'flag',
  commercialContentType: 'text', videoMadeWithAi: 'flag', tiktokDraft: 'flag',
  autoAddMusic: 'flag', videoCoverTimestampMs: 'number', videoCoverImageUrl: 'text',
  photoCoverIndex: 'number', tiktokDescription: 'text', tiktokConsent: 'flag',
}

/** The values each of the four choices may hold. Anything else stored — by an
 *  older version of the window, or by hand — is dropped rather than sent, so
 *  the provider never sees a word it does not know. */
const ALLOWED: Partial<Record<keyof ChannelExtras, readonly string[]>> = {
  kind: ['feed', 'reel', 'story', 'carousel'],
  trialGraduation: ['MANUAL', 'SS_PERFORMANCE'],
  visibility: ['public', 'private', 'unlisted'],
  privacyLevel: TIKTOK_PRIVACY_LEVELS,
  commercialContentType: ['none', 'brand_organic', 'brand_content'],
}

/**
 * One channel's stored blob, read into the shape the window edits.
 *
 * ONE reader for the window AND the server. What a reader drops, the window
 * sends back as absent — the server then reads that as a content change and
 * takes the client's approval down with it — so two readers that disagree is
 * a bug with a client's approval in it. There is now one.
 */
/** Tagged people as stored: `{ username }`, or a bare username from an
 *  older window. Feed pictures get a centre point, which publish-core keeps
 *  only where Instagram wants one. */
export function readUserTags(value: unknown): UserTag[] {
  if (!Array.isArray(value)) return []
  const out: UserTag[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    const username = String(
      typeof raw === 'string' ? raw : (raw as { username?: unknown } | null)?.username ?? '',
    ).trim().replace(/^@/, '')
    if (!username || seen.has(username)) continue
    seen.add(username)
    out.push({ username, x: 0.5, y: 0.5 })
  }
  return out.slice(0, 20)
}

/**
 * A track as it was stored: the id Instagram needs, and the words the window
 * says it with. No id, no track — a chip with a title and nothing behind it
 * is a Reel that posts in silence.
 */
export function readAudioChoice(value: unknown): InstagramAudio | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const r = value as Record<string, unknown>
  const audioId = String(r.audioId ?? '').trim()
  if (!audioId) return null
  const artist = String(r.artist ?? '').trim()
  const audioVolume = cleanVolume(r.audioVolume)
  const videoVolume = cleanVolume(r.videoVolume)
  return {
    audioId,
    title: String(r.title ?? '').trim() || 'Chosen sound',
    ...(artist ? { artist } : {}),
    ...(audioVolume === null ? {} : { audioVolume }),
    ...(videoVolume === null ? {} : { videoVolume }),
  }
}

/**
 * A poll as it was stored.
 *
 * Kept whole rather than cleaned to death: a half-written poll (a question
 * and one answer) has to survive a save, or somebody loses their work every
 * time the window closes. It is `optionProblems` that refuses to POST one,
 * not this.
 */
export function readPoll(value: unknown): LinkedInPoll | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const r = value as Record<string, unknown>
  const question = String(r.question ?? '').trim().slice(0, POLL_QUESTION_MAX)
  const options = cleanPollOptions(
    (Array.isArray(r.options) ? r.options : []).map(o => String(o ?? '')),
  ).slice(0, POLL_OPTIONS_MAX).map(o => o.slice(0, POLL_OPTION_MAX))
  if (!question && options.length === 0) return null
  const duration = String(r.duration ?? '')
  return {
    question,
    options,
    ...(POLL_DURATIONS.includes(duration as PollDuration)
      ? { duration: duration as PollDuration } : {}),
  }
}

/** The carousel's cards as they were stored, in order, one per picture. A
 *  card with no link at all is dropped: it is a picture nobody can click. */
export function readCarouselCards(value: unknown): FacebookCarouselCard[] {
  if (!Array.isArray(value)) return []
  const out: FacebookCarouselCard[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const r = raw as Record<string, unknown>
    const link = String(r.link ?? '').trim()
    if (!link) continue
    const name = String(r.name ?? '').trim().slice(0, CARD_TEXT_MAX)
    const description = String(r.description ?? '').trim().slice(0, CARD_TEXT_MAX)
    out.push({
      link,
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
    })
  }
  return out.slice(0, CAROUSEL_CARDS_MAX)
}

export function readChannelExtras(raw: unknown): ChannelExtras {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw))
    ? raw as Record<string, unknown> : {}
  const out: Record<string, unknown> = {}
  for (const key of CHANNEL_EXTRA_KEYS) {
    const value = r[key]
    if (value === undefined || value === null) continue
    switch (EXTRA_SHAPE[key]) {
      case 'text': {
        if (typeof value !== 'string') break
        const allowed = ALLOWED[key]
        if (allowed && !allowed.includes(value)) break
        // a place NAME typed into the id box is the mistake people make, and
        // Instagram answers it by refusing the post hours later
        if (key === 'locationId' && !isPageId(value)) break
        // …and a bare id pasted for a company page becomes the URN LinkedIn
        // wants, or nothing: sending the number posts as the person
        if (key === 'organizationUrn') {
          const urn = asOrganizationUrn(value)
          if (!urn) break
          out[key] = urn
          break
        }
        out[key] = key === 'locationId' ? value.trim() : value
        break
      }
      case 'flag':
        if (typeof value === 'boolean') out[key] = value
        break
      case 'number':
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[key] = value
        break
      case 'list': {
        if (!Array.isArray(value)) break
        const list = value.map(String).map(x => x.trim().replace(/^@/, '')).filter(Boolean)
        // three collaborators is Instagram's own ceiling, two sponsors is
        // Instagram's too; tags have no count limit, only a combined
        // length, which the checks report on
        const capped = key === 'collaborators' ? list.slice(0, 3)
          : key === 'brandedContentSponsors' ? list.slice(0, 2)
          : list.slice(0, 50)
        if (capped.length > 0) out[key] = capped
        break
      }
      case 'people': {
        // tagged people: a username each, with a centre point for the kinds
        // that need one (publish-core drops the point where it means nothing)
        if (!Array.isArray(value)) break
        const people = readUserTags(value)
        if (people.length > 0) out[key] = people
        break
      }
      case 'audio': {
        const audio = readAudioChoice(value)
        if (audio) out[key] = audio
        break
      }
      case 'poll': {
        const poll = readPoll(value)
        if (poll) out[key] = poll
        break
      }
      case 'cards': {
        const cards = readCarouselCards(value)
        if (cards.length > 0) out[key] = cards
        break
      }
      case 'slides':
        // carried, not edited: this channel's OWN media set. Dropping it here
        // would silently delete it the first time something writes one, and
        // take the client's approval with it.
        if (Array.isArray(value)) out[key] = value as Slide[]
        break
    }
  }
  return out as ChannelExtras
}

/**
 * One reducer, so "is there anything to save" is a fact rather than a guess.
 *
 * `loaded` and `saved` are the two actions that CLEAR `dirty`: one is the
 * server's answer arriving, the other is our own write landing. Everything a
 * person does sets it. Nothing here talks to the network — a save that failed
 * must leave the window dirty, and it does, because only `saved` clears it.
 */
export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case 'loaded':
      return { ...state, ...action.state, dirty: false }
    case 'caption':
      return state.caption === action.caption
        ? state
        : { ...state, caption: action.caption, dirty: true }
    case 'slides':
      return { ...state, slides: [...action.slides], dirty: true }
    case 'measured':
      return { ...state, slides: [...action.slides] }
    case 'channel': {
      const has = state.channels.includes(action.id)
      if (has === action.on) return state
      const channels = action.on
        ? [...state.channels, action.id]
        : state.channels.filter(c => c !== action.id)
      // a channel that is gone takes its own caption and its own first comment
      // with it: leaving them behind would post them again the moment somebody
      // turned the channel back on, which nobody asked for
      const perChannel = { ...state.perChannel }
      if (!action.on) delete perChannel[action.id]
      return { ...state, channels, perChannel, dirty: true }
    }
    case 'time':
      return state.scheduledFor === action.iso
        ? state
        : { ...state, scheduledFor: action.iso, dirty: action.quiet ? state.dirty : true }
    case 'extra': {
      const before = state.perChannel[action.channel] ?? {}
      return {
        ...state,
        perChannel: { ...state.perChannel, [action.channel]: { ...before, ...action.patch } },
        dirty: true,
      }
    }
    case 'automation':
      return { ...state, automation: action.automation, dirty: true }
    case 'saved':
      return {
        ...state,
        postId: action.postId === undefined ? state.postId : action.postId,
        dirty: false,
      }
    default:
      return state
  }
}

/* ── what each channel will take, in words ──────────────────────────────── */

/**
 * What a set of pictures is CALLED on each network.
 *
 * Instagram has carousels and says so; TikTok's several-pictures post is a
 * photo post and calling it a carousel there would be our word, not theirs.
 * The number comes from `PLATFORM_RULES`; only the noun lives here.
 */
const MULTI_WORD: Partial<Record<Platform, string>> = {
  instagram: 'carousel',
  facebook: 'carousel',
  threads: 'carousel',
  tiktok: 'photo post',
}

/**
 * The line under the media tray: "Instagram carousel: up to 10 · TikTok photo
 * post: up to 35".
 *
 * Said for the media that is actually in the post — one video is a different
 * ceiling from twelve pictures, and a single number for both was how a
 * fourteen-minute cut got told it could have nine friends.
 */
export function limitsLine(
  platforms: readonly string[] | null | undefined,
  slides: readonly Slide[] | null | undefined,
): string {
  const list = Array.isArray(slides) ? slides : []
  const lead = list[0]?.type ?? 'image'
  const seen = new Set<string>()
  const parts: string[] = []

  for (const raw of Array.isArray(platforms) ? platforms : []) {
    const platform = String(raw)
    if (seen.has(platform)) continue
    seen.add(platform)
    const rules = PLATFORM_RULES[platform as Platform]
    if (!rules) continue
    const name = NETWORK_LABEL[platform.toLowerCase()] ?? platform

    if (lead === 'video') {
      parts.push(rules.videos === 0
        ? `${name}: pictures only`
        : `${name} video: ${rules.videos === 1 ? 'one at a time' : `up to ${rules.videos}`}`)
      continue
    }
    if (rules.images === 0 && rules.carousel === 0) {
      parts.push(`${name}: video only`)
      continue
    }
    const max = rules.carousel > 0 ? rules.carousel : rules.images
    const word = max > 1 ? (MULTI_WORD[platform as Platform] ?? 'post') : 'post'
    parts.push(`${name} ${word}: up to ${max}`)
  }
  return parts.join(' · ')
}

/* ── the extras the provider actually supports ──────────────────────────── */

export type MoreOptionKey =
  | 'firstComment' | 'collaborators' | 'shareToFeed' | 'location'
  | 'trialReel' | 'audioName'
  | 'igCover' | 'igTagPeople' | 'igComments' | 'igMute' | 'igAi' | 'igPaid' | 'igSponsors'
  | 'igMusic'
  | 'geo'
  | 'ytTitle' | 'ytVisibility' | 'ytCategory' | 'ytPlaylist' | 'ytTags'
  | 'ytKids' | 'ytSynthetic' | 'ytThumbnail'
  | 'liOrganization' | 'liLinkPreview' | 'liDocumentTitle' | 'liPoll' | 'liRepost'
  | 'fbPage' | 'fbTitle' | 'fbDraft' | 'fbCards' | 'fbCardsLink' | 'fbTextBackground'
  | 'ttPrivacy' | 'ttComments' | 'ttDuet' | 'ttStitch' | 'ttCommercial'
  | 'ttAi' | 'ttDraft' | 'ttMusic' | 'ttCover' | 'ttDescription' | 'ttConsent'

/** How a row is drawn. The window has one renderer per kind, so adding a
 *  setting is a row in the table below and nothing else. */
export type OptionControl =
  'text' | 'longText' | 'toggle' | 'select' | 'tags' | 'seconds'
  | 'location' | 'collaborators' | 'consent'
  /** usernames of people tagged in the post — stored as `UserTag`s */
  | 'people'
  /** search Instagram's catalogue, pick one track, set the two volumes */
  | 'music'
  /** a question, two to four answers, and how long it runs */
  | 'poll'
  /** one link, headline and line of words per picture in the post */
  | 'cards'

export type OptionChoice = { value: string; label: string }

/** A list only the network can give us — fetched per account, never guessed. */
export type OptionSource =
  'playlists' | 'organizations' | 'pages' | 'privacy' | 'commercial'

export type MoreOption = {
  key: MoreOptionKey
  label: string
  /** the channels on screen it applies to — the row says which */
  platforms: string[]
  control: OptionControl
  /** the one field on `ChannelExtras` this row writes */
  field: keyof ChannelExtras
  choices?: OptionChoice[]
  source?: OptionSource
  help?: string
  placeholder?: string
  /** what the network does when nobody touches this — so an untouched tick
   *  box shows the truth rather than an empty box that posts as "on" */
  defaultOn?: boolean
}

type OptionSpec = Omit<MoreOption, 'platforms'> & {
  /** the networks that HAVE this setting */
  on: Platform[]
  /** …and, where it matters, the post types that have it */
  kinds?: PostKind[]
  /** …and whether it is a setting about video or about pictures */
  lead?: 'video' | 'image'
  /**
   * …and the three that only exist on a post with NOTHING attached.
   *
   * A LinkedIn poll, a LinkedIn repost and Facebook's big-text background are
   * all refused outright by the network the moment a picture or a video is on
   * the post. Offering them beside a video is offering a control that can
   * only produce a refusal, so the row goes when there is media — which is
   * exactly when `lead` is known.
   */
  needs?: 'noMedia'
}

const labelChoices = (labels: Record<string, string>): OptionChoice[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }))

/**
 * Every posting option the provider actually takes, in one table.
 *
 * Read straight off what `publish-core` sends. A row for something Zernio
 * does not accept is a control that silently does nothing, which is worse
 * than not having it — and the reverse (a field Zernio takes with no row) is
 * how the first cut of this window offered a fraction of what the networks do.
 *
 * ORDER IS THE ORDER ON SCREEN: the ones people reach for first, then each
 * network's own settings, then the declarations.
 */
const OPTION_SPECS: OptionSpec[] = [
  {
    key: 'firstComment', field: 'firstComment', control: 'text',
    label: 'Add first comment',
    on: ['instagram', 'facebook', 'threads', 'linkedin', 'youtube'],
    placeholder: 'Posted as the first comment — the usual place for hashtags',
  },
  {
    key: 'collaborators', field: 'collaborators', control: 'collaborators',
    label: 'Invite collaborator', on: ['instagram'],
    // a Story has no collaborators: Instagram answers the field with a 400
    kinds: ['feed', 'reel', 'carousel'],
    placeholder: 'Up to three usernames, separated by commas',
  },
  {
    key: 'shareToFeed', field: 'shareToFeed', control: 'toggle',
    label: 'Also show the Reel in the feed', on: ['instagram'],
  },
  {
    key: 'location', field: 'locationId', control: 'location',
    label: 'Add location', on: ['instagram'],
  },
  {
    key: 'trialReel', field: 'trialGraduation', control: 'select',
    label: 'Trial Reel', on: ['instagram'], kinds: ['reel'],
    choices: [
      { value: '', label: 'Off — post it to everyone' },
      { value: 'MANUAL', label: 'Show it to non-followers first — we decide later' },
      { value: 'SS_PERFORMANCE', label: 'Show it to non-followers first — Instagram decides' },
    ],
    help: 'A trial Reel goes to people who do not follow the account yet. It reaches '
      + 'the followers’ feed only once it does well, or once somebody says so.',
  },
  {
    key: 'audioName', field: 'audioName', control: 'text',
    label: 'Name the sound', on: ['instagram'], kinds: ['reel'],
    placeholder: 'What the audio is called on the Reel',
  },
  {
    key: 'igCover', field: 'thumbOffset', control: 'seconds', label: 'Cover frame',
    on: ['instagram'], kinds: ['reel'], lead: 'video',
    help: 'How many seconds into the video the cover picture is taken from. '
      + 'A cover picture chosen in the video editor is used instead when there is one.',
  },
  {
    key: 'igTagPeople', field: 'userTags', control: 'people', label: 'Tag people',
    on: ['instagram'], kinds: ['feed', 'reel', 'carousel'],
    placeholder: 'Instagram usernames, separated by commas',
    help: 'On a picture the tag sits in the middle; on a Reel it is a name under the post.',
  },
  {
    key: 'igComments', field: 'commentsEnabled', control: 'toggle',
    label: 'Allow comments', on: ['instagram'], defaultOn: true,
  },
  {
    key: 'igMute', field: 'muteAudio', control: 'toggle',
    label: 'Mute the sound', on: ['instagram'], lead: 'video',
  },
  {
    key: 'igAi', field: 'isAiGenerated', control: 'toggle',
    label: 'Made with AI', on: ['instagram'],
    help: 'Instagram puts an AI label on the post.',
  },
  {
    key: 'igPaid', field: 'isPaidPartnership', control: 'toggle',
    label: 'Paid partnership', on: ['instagram'],
    help: 'Shows the "Paid partnership" label. The account has to be connected with Facebook Login for Instagram to take it.',
  },
  {
    key: 'igSponsors', field: 'brandedContentSponsors', control: 'tags',
    label: 'Sponsors', on: ['instagram'],
    placeholder: 'Up to two Instagram usernames, separated by commas',
    help: 'Only sent with the Paid partnership label on.',
  },
  {
    key: 'igMusic', field: 'audio', control: 'music',
    label: 'Add music', on: ['instagram'], kinds: ['reel'], lead: 'video',
    placeholder: 'Search Instagram for a song',
    help: 'Music from Instagram’s own catalogue, on a Reel. The account has to be '
      + 'connected through Facebook for Instagram to hand the catalogue over.',
  },

  /* ── YouTube ── */
  {
    key: 'ytTitle', field: 'title', control: 'text', label: 'Video title', on: ['youtube'],
    placeholder: 'Shown above the video',
    help: 'Up to 100 letters. The first line of the caption is used if you leave this empty. '
      + 'A standing-up video of three minutes or less goes out as a Short by itself — '
      + 'there is nothing to switch on.',
  },
  {
    key: 'ytVisibility', field: 'visibility', control: 'select', label: 'Who can watch',
    on: ['youtube'], choices: labelChoices(YOUTUBE_VISIBILITY_LABELS),
  },
  {
    key: 'ytCategory', field: 'categoryId', control: 'select', label: 'Category',
    on: ['youtube'],
    choices: YOUTUBE_CATEGORIES.map(c => ({ value: c.id, label: c.name })),
    help: `Left alone, videos go under ${
      YOUTUBE_CATEGORIES.find(c => c.id === DEFAULT_YOUTUBE_CATEGORY)?.name ?? 'People and blogs'}.`,
  },
  {
    key: 'ytPlaylist', field: 'playlistId', control: 'select', label: 'Add to a playlist',
    on: ['youtube'], source: 'playlists',
  },
  {
    key: 'ytTags', field: 'tags', control: 'tags', label: 'Search tags', on: ['youtube'],
    placeholder: 'Words people might search for, separated by commas',
    help: 'YouTube counts them all together: 500 letters for the lot.',
  },
  {
    key: 'ytKids', field: 'madeForKids', control: 'toggle', label: 'Made for children',
    on: ['youtube'],
    help: 'YouTube turns comments off on videos made for children.',
  },
  {
    key: 'ytSynthetic', field: 'containsSyntheticMedia', control: 'toggle',
    label: 'Made with AI, or changed to look real', on: ['youtube'],
  },
  {
    key: 'ytThumbnail', field: 'thumbnailUrl', control: 'text',
    label: 'Cover picture', on: ['youtube'],
    // YouTube ignores a custom thumbnail on a Short, so the row goes with it
    kinds: ['feed', 'carousel'],
    placeholder: 'Link to the picture',
    help: 'A JPEG, PNG or GIF, 1280 x 720, up to 2 MB. YouTube only takes a custom cover on a phone-verified channel: '
      + 'on an unverified one the video still posts with an ordinary cover, and Zernio stops sending covers to that channel for seven days. '
      + 'Shorts cannot have one.',
  },

  {
    key: 'geo', field: 'geoCountries', control: 'tags',
    label: 'Only show it in these countries', on: ['facebook', 'linkedin'],
    kinds: ['feed', 'reel', 'carousel'],
    placeholder: 'Two-letter country codes, separated by commas: AU, NZ',
    help: 'People outside these countries cannot see the post at all. Up to 25 countries. On LinkedIn it works on a company page with 300 or more followers in those countries.',
  },

  /* ── LinkedIn ── */
  {
    key: 'liOrganization', field: 'organizationUrn', control: 'select',
    label: 'Post as a company page', on: ['linkedin'], source: 'organizations',
  },
  {
    key: 'liLinkPreview', field: 'disableLinkPreview', control: 'toggle',
    label: 'Hide the link preview', on: ['linkedin'],
  },
  {
    key: 'liDocumentTitle', field: 'documentTitle', control: 'text',
    label: 'Name for the PDF', on: ['linkedin'],
    placeholder: 'Shown on the document card',
  },
  {
    key: 'liPoll', field: 'poll', control: 'poll',
    label: 'Ask a poll', on: ['linkedin'], needs: 'noMedia',
    help: 'A question with two to four answers. LinkedIn will not take a poll with a '
      + 'picture or video on the post, and a poll cannot be changed once it is up.',
  },
  {
    key: 'liRepost', field: 'reshareUrl', control: 'text',
    label: 'Repost an existing LinkedIn post', on: ['linkedin'], needs: 'noMedia',
    placeholder: 'Paste the link to the LinkedIn post',
    help: 'The caption becomes the comment above it. A repost cannot carry a '
      + 'picture or video of its own.',
  },

  /* ── Facebook ── */
  {
    key: 'fbPage', field: 'pageId', control: 'select', label: 'Which Page',
    on: ['facebook'], source: 'pages',
  },
  {
    key: 'fbTitle', field: 'title', control: 'text', label: 'Reel title',
    on: ['facebook'], kinds: ['reel'],
  },
  {
    key: 'fbDraft', field: 'facebookDraft', control: 'toggle',
    label: 'Save it in Facebook as a draft instead of posting', on: ['facebook'],
  },
  {
    key: 'fbCards', field: 'carouselCards', control: 'cards',
    label: 'Put a link under each picture', on: ['facebook'], lead: 'image',
    help: 'Facebook turns the pictures into cards people can click. One card per '
      + 'picture, two to twenty of them, pictures only.',
  },
  {
    key: 'fbCardsLink', field: 'carouselLink', control: 'text',
    label: 'Where the See more card goes', on: ['facebook'], lead: 'image',
    placeholder: 'https://…',
    help: 'The last card of the carousel. Facebook uses the first card’s link when '
      + 'you leave this empty.',
  },
  {
    key: 'fbTextBackground', field: 'textFormatPresetId', control: 'text',
    label: 'Big-text background', on: ['facebook'], needs: 'noMedia',
    placeholder: 'Facebook’s preset number',
    help: 'Facebook’s preset number for a large-text background. Text-only posts.',
  },

  /* ── TikTok ── */
  {
    key: 'ttPrivacy', field: 'privacyLevel', control: 'select', label: 'Who can see it',
    on: ['tiktok'], source: 'privacy', choices: labelChoices(TIKTOK_PRIVACY_LABELS),
  },
  {
    key: 'ttComments', field: 'allowComment', control: 'toggle',
    label: 'Allow comments', on: ['tiktok'], defaultOn: true,
  },
  {
    key: 'ttDuet', field: 'allowDuet', control: 'toggle',
    label: 'Allow duets', on: ['tiktok'], defaultOn: true,
  },
  {
    key: 'ttStitch', field: 'allowStitch', control: 'toggle', label: 'Allow stitches',
    on: ['tiktok'], defaultOn: true, lead: 'video',
  },
  {
    key: 'ttCommercial', field: 'commercialContentType', control: 'select',
    label: 'Is this a promotion?', on: ['tiktok'], source: 'commercial',
    choices: labelChoices(COMMERCIAL_CONTENT_LABELS),
    help: 'A paid partnership cannot be posted where only the account itself can see it.',
  },
  {
    key: 'ttAi', field: 'videoMadeWithAi', control: 'toggle',
    label: 'Made with AI', on: ['tiktok'],
  },
  {
    key: 'ttDraft', field: 'tiktokDraft', control: 'toggle',
    label: 'Send it to the TikTok inbox as a draft instead of posting', on: ['tiktok'],
  },
  {
    key: 'ttMusic', field: 'autoAddMusic', control: 'toggle',
    label: 'Let TikTok add music', on: ['tiktok'], lead: 'image',
  },
  {
    key: 'ttCover', field: 'videoCoverTimestampMs', control: 'seconds', label: 'Cover frame',
    on: ['tiktok'], lead: 'video',
    help: 'How many seconds into the video the cover picture is taken from.',
  },
  {
    key: 'ttDescription', field: 'tiktokDescription', control: 'longText',
    label: 'Words for the pictures', on: ['tiktok'], lead: 'image',
    help: 'TikTok shows this under a set of pictures. Up to 4,000 letters.',
  },
  {
    key: 'ttConsent', field: 'tiktokConsent', control: 'consent',
    label: TIKTOK_CONSENT_TICK, on: ['tiktok'], help: TIKTOK_CONSENT_LINE,
  },
]

/**
 * Which of the composer's "More options" are real for these channels.
 *
 * Only the selected networks' settings, and only the ones this post can carry:
 * "Add location" goes the moment the post is a Story, because Instagram
 * REFUSES a Story with a place on it rather than ignoring it, and "Allow
 * stitches" goes on a set of pictures, which nobody can stitch.
 *
 * @param kind the post type currently chosen, when one is
 * @param lead what the post is MADE of — 'video' or 'image' — when that is
 *   known. Unknown shows everything, rather than hiding a setting somebody is
 *   looking for.
 */
export function moreOptionsFor(
  platforms: readonly string[] | null | undefined,
  kind?: PostKind | null,
  lead?: 'video' | 'image' | null,
): MoreOption[] {
  const list = [...new Set((Array.isArray(platforms) ? platforms : []).map(p => String(p)))]
  const out: MoreOption[] = []
  for (const spec of OPTION_SPECS) {
    if (spec.key === 'location' && !kindTakesLocation(kind ?? undefined)) continue
    if (spec.kinds && kind && !spec.kinds.includes(kind)) continue
    if (spec.lead && lead && spec.lead !== lead) continue
    // media on the post at all is what these three cannot survive
    if (spec.needs === 'noMedia' && lead) continue
    const on = list.filter(p => (spec.on as string[]).includes(p))
    if (on.length === 0) continue
    const rest = { ...spec } as Partial<OptionSpec>
    delete rest.on; delete rest.kinds; delete rest.lead; delete rest.needs
    out.push({ ...(rest as Omit<MoreOption, 'platforms'>), platforms: on })
  }
  return out
}

/** One network's block of settings in the window — its own heading, so nobody
 *  has to work out which "Who can see it" belongs to which channel. */
export type OptionGroup = { platform: string | null; label: string; options: MoreOption[] }

/**
 * The rows, grouped the way they are read: the handful that apply to more than
 * one selected network first, then one block per network.
 */
export function groupOptions(options: readonly MoreOption[] | null | undefined): OptionGroup[] {
  const list = Array.isArray(options) ? options : []
  const shared = list.filter(o => o.platforms.length > 1)
  const groups: OptionGroup[] = shared.length > 0
    ? [{ platform: null, label: 'Every channel that has it', options: shared }]
    : []
  for (const option of list) {
    if (option.platforms.length !== 1) continue
    const platform = option.platforms[0]
    let group = groups.find(g => g.platform === platform)
    if (!group) {
      group = { platform, label: networkName(platform), options: [] }
      groups.push(group)
    }
    group.options.push(option)
  }
  return groups
}

/* ── naming an extra AFTER the post has gone out ────────────────────────── */

/**
 * WHAT ONE EXTRA IS CALLED, for a screen that reads a post BACK.
 *
 * The composer names every setting once, in `OPTION_SPECS` above, and that is
 * the only place a name for one may come from. A page that reads the stored
 * `per_channel` blob and turns `firstComment` into words by pulling the key
 * apart is inventing vocabulary the composer never used — the two then drift,
 * and the person who ticked "Allow duets" reads "Allow Duet" somewhere else
 * and wonders whether they are the same setting. They are; there is one name
 * for it, and it is the row's own label.
 *
 * A handful of fields have no row because the window edits them elsewhere: a
 * channel's own caption, its own pictures, the post type, the cover the image
 * editor saved. Those are named here, beside the specs, rather than in a page.
 * Anything with neither answers `null`, and a screen draws nothing — silence
 * is better than a database key on a page.
 *
 * `platform` matters for the one field two networks share: `title` is "Video
 * title" on YouTube and "Reel title" on Facebook.
 */
const EXTRAS_WITHOUT_A_ROW: Partial<Record<keyof ChannelExtras, string>> = {
  caption: 'Its own caption',
  kind: 'Post type',
  slides: 'Its own pictures',
  videoCoverImageUrl: 'Cover picture',
  photoCoverIndex: 'Which picture is the cover',
}

function specFor(field: keyof ChannelExtras, platform?: string | null): OptionSpec | undefined {
  const on = String(platform ?? '').toLowerCase()
  const specs = OPTION_SPECS.filter(s => s.field === field)
  return specs.find(s => (s.on as string[]).includes(on)) ?? specs[0]
}

export function extraLabel(field: keyof ChannelExtras, platform?: string | null): string | null {
  return specFor(field, platform)?.label ?? EXTRAS_WITHOUT_A_ROW[field] ?? null
}

/**
 * What one extra's VALUE says, in the words the composer offered.
 *
 * A select's stored value is the network's own code — `SS_PERFORMANCE`, a
 * YouTube category number — and the composer already holds the sentence
 * somebody picked, so that sentence is what is read back. A tick box reads
 * Yes or No; a list reads as its words; everything else is what was typed.
 */
export function extraValueWords(
  field: keyof ChannelExtras,
  value: unknown,
  platform?: string | null,
): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) {
    const words = value.map(v => String(v ?? '').trim()).filter(Boolean)
    return words.length > 0 ? words.join(', ') : null
  }
  const text = String(value).trim()
  if (!text) return null
  return specFor(field, platform)?.choices?.find(c => c.value === text)?.label ?? text
}

/* ── the places a client tags posts at ──────────────────────────────────── */

/**
 * One saved place: what the team calls it, and the id Instagram wants.
 *
 * The id is a NUMERIC FACEBOOK PAGE ID. Instagram's own location index IS the
 * set of Facebook Pages, and neither the Graph API nor Zernio exposes a place
 * search — so there is no way to look one up while writing a post. A client
 * therefore keeps their handful of places once, and the composer picks from
 * that list.
 */
export type SavedLocation = { name: string; pageId: string }

/** Where a person finds that number. One sentence, no jargon, because whoever
 *  reads it has never heard of a Page ID and should not have to care. */
export const PAGE_ID_HELP =
  'Open the place’s Facebook Page, go to About, and copy the number next to '
  + 'Page ID. It is a long number — not the @name.'

/** Read a saved list out of whatever the database handed back, dropping
 *  anything that is not a name and a plain number. A half-typed row saved by
 *  accident must never become a post that Instagram refuses. */
export function readLocations(v: unknown): SavedLocation[] {
  if (!Array.isArray(v)) return []
  const out: SavedLocation[] = []
  const seen = new Set<string>()
  for (const raw of v) {
    const row = (raw ?? {}) as { name?: unknown; pageId?: unknown; page_id?: unknown }
    const pageId = String(row.pageId ?? row.page_id ?? '').trim()
    const name = String(row.name ?? '').trim()
    if (!name || !isPageId(pageId) || seen.has(pageId)) continue
    seen.add(pageId)
    out.push({ name: name.slice(0, 80), pageId })
  }
  return out.slice(0, 50)
}

/* ── the clock ──────────────────────────────────────────────────────────── */

export type Meridiem = 'am' | 'pm'

/** A time as the picker holds it: a day, and a 12-hour clock beside it. */
export type ClockValue = {
  /** 'YYYY-MM-DD' in the CLIENT's zone */
  dayKey: string
  /** 1–12 */
  hour12: number
  minute: number
  meridiem: Meridiem
}

export const HOURS_12 = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

const pad = (n: number) => String(n).padStart(2, '0')

/** 24-hour → the 12-hour clock a person reads. */
export function to12(hour24: number): { hour12: number; meridiem: Meridiem } {
  const h = ((Math.trunc(hour24) % 24) + 24) % 24
  return { hour12: ((h + 11) % 12) + 1, meridiem: h < 12 ? 'am' : 'pm' }
}

/** …and back. 12 am is midnight, 12 pm is noon — the one place this always
 *  goes wrong if it is written inline. */
export function to24(hour12: number, meridiem: Meridiem): number {
  const h = ((Math.trunc(hour12) - 1 + 12) % 12) + 1
  if (meridiem === 'am') return h === 12 ? 0 : h
  return h === 12 ? 12 : h + 12
}

/**
 * THE CALENDAR'S DAY, IN ONE FRAME OF REFERENCE.
 *
 * react-day-picker builds every cell as a LOCAL-midnight Date, and hands the
 * same back on a click. The picker used to read that Date with `getUTC*` —
 * which, for any browser east of Greenwich, is the day before. Melbourne is
 * ten hours east: a click on the 15th stored the 14th, the highlight
 * followed the wrong key, and "today" could not be picked at all because
 * yesterday-at-six had already gone (the owner, 9 Sep 2026: "the calendar
 * cursor on the popup is not showing on the right day"). Both directions
 * are local now, and a round trip is pinned in the tests.
 *
 * A day KEY is 'YYYY-MM-DD' in the client's zone; the Date that carries it
 * across the calendar is local noon, which no daylight-saving change can
 * push onto another day.
 */
export function dayKeyToCalendarDate(key: string | null | undefined): Date | undefined {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return undefined
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}
export function calendarDateToDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Read an instant as the picker's fields, in the client's zone. */
export function splitClock(
  iso: string | number | Date | null | undefined, tz: string,
): ClockValue | null {
  if (iso === null || iso === undefined) return null
  const w = wallTimeIn(iso, tz)
  if (!w) return null
  const { hour12, meridiem } = to12(w.hour)
  return {
    dayKey: `${w.year}-${pad(w.month)}-${pad(w.day)}`,
    hour12,
    minute: w.minute,
    meridiem,
  }
}

/** …and write them back as an instant. Null when the fields do not name a
 *  real time, so a bad value can never be saved as "now". */
export function joinClock(value: ClockValue | null | undefined, tz: string): string | null {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value.dayKey ?? ''))) return null
  const hour = to24(value.hour12, value.meridiem)
  const minute = Math.min(59, Math.max(0, Math.trunc(value.minute)))
  return fromZonedInput(`${value.dayKey}T${pad(hour)}:${pad(minute)}`, tz)
}

/** "Tue 8 Sep · 6:30 pm" — the label on the header's time pill. */
export function clockPillLabel(
  iso: string | null | undefined, tz: string,
): string {
  const v = splitClock(iso, tz)
  if (!v) return 'Pick a time'
  const [y, m, d] = v.dayKey.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short',
  }).replace(/,/g, '')
  return `${day} · ${v.hour12}:${pad(v.minute)} ${v.meridiem}`
}

/* ── the media picker's selection rules ─────────────────────────────────── */

/** Where a file in the picker's left pane came from. */
export type MediaSource = 'approved' | SlideSource

export type PickerFile = Slide & {
  source: MediaSource
  /** the Drive file id, for a Drive row — nothing else needs an id */
  driveId?: string
}

/** Is this file already in the post? Matched on URL: the same picture added
 *  twice is one picture, not a two-slide carousel of itself. */
export function inPost(post: readonly Slide[] | null | undefined, url: string): boolean {
  return (Array.isArray(post) ? post : []).some(s => s.url === url)
}

/**
 * Drop a file into the post at `at` (the end when not given).
 *
 * A file already in the post MOVES to the drop position rather than being
 * added again — dragging something you already have somewhere else is a
 * reorder, and treating it as an add is how a carousel ends up with the same
 * slide twice.
 */
export function addToPost(
  post: readonly Slide[] | null | undefined,
  file: Slide,
  at?: number,
): Slide[] {
  const list = Array.isArray(post) ? [...post] : []
  const existing = list.findIndex(s => s.url === file.url)
  if (existing >= 0) {
    return at === undefined ? list : moveInPost(list, existing, at)
  }
  const index = at === undefined ? list.length : Math.min(list.length, Math.max(0, at))
  list.splice(index, 0, { ...file })
  return list
}

export function removeFromPost(
  post: readonly Slide[] | null | undefined, url: string,
): Slide[] {
  return (Array.isArray(post) ? post : []).filter(s => s.url !== url)
}

export function moveInPost(
  post: readonly Slide[] | null | undefined, from: number, to: number,
): Slide[] {
  return reorder(Array.isArray(post) ? post : [], from, to)
}

/** Replace the file in one slot — dropping onto an occupied slot, as the
 *  design has it. Out-of-range slots leave the post alone. */
export function replaceInPost(
  post: readonly Slide[] | null | undefined, at: number, file: Slide,
): Slide[] {
  const list = Array.isArray(post) ? [...post] : []
  if (!Number.isInteger(at) || at < 0 || at >= list.length) return list
  // the file being dropped may already be somewhere else in the post; it
  // cannot be in two places, so it leaves its old slot
  const elsewhere = list.findIndex((s, i) => s.url === file.url && i !== at)
  list[at] = { ...file }
  return elsewhere >= 0 ? list.filter((_, i) => i !== elsewhere) : list
}

/** The sentence in the picker's footer (29 Sep 2026). The post is its own
 *  thing: a file added here belongs to THIS post, and the quality check sees
 *  it before anyone else does. It no longer makes a new version of the edit
 *  card or sends anything to the client (audit V7, V13). */
export const POST_MEDIA_NOTICE =
  'Files you add here belong to this post only. The quality check sees them before the client does.'

/** …and the one over the tray. */
export const PICKER_HELP = 'Drag files from the library into the post. Drag to reorder.'

/** What the left pane says under the grid. */
export const PICKER_LIBRARY_HELP =
  'Faded ones are already in the post. Drag a file to the right to add it.'

/*
 * THE OLD FOOTER IS GONE (29 Sep 2026). `footerActions`, `approvalLine`,
 * `composerWait`, `mediaApprovalBadge`, `APPROVAL_LINE`, `SEND_FOR_REVIEW`,
 * `sentForReviewLine` and `outcomeWords` read the post's old `status` and the
 * edit card's approval, which is how one window said "waiting on you" while
 * the client had the post and offered no way back from a cancelled one (audit
 * W2, W5, B5). The post window's buttons are `postActions` (post-stage-core)
 * and its words are post-window-core's, read from `social_posts.stage`.
 */

/** "1 hour 30 minutes", "10 minutes", "45 seconds" — for a limit a person
 *  holds a file up against, so a half hour must not vanish. */
export function durationWords(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s} ${s === 1 ? 'second' : 'seconds'}`
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`)
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`)
  return parts.join(' ')
}
