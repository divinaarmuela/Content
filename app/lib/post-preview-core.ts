/**
 * SEEING THE POST AS EACH NETWORK WILL SHOW IT — the pure half.
 *
 * Nobody should have to imagine what a post will look like. This module turns
 * the post that ALREADY EXISTS (the composer's own caption, media, channels
 * and per-network options) into one small description per network, and the
 * one frame component draws that description. Adding a network is a row in
 * `PREVIEW_SPECS`, not another branch of JSX.
 *
 * Three rules it is held to:
 *
 *  1. IT INVENTS NO RULES. Every refusal it reports comes from
 *     `publish-core` — `validatePost` and `optionProblems`, the same
 *     functions the publisher runs on the way out. Nothing here decides
 *     whether a post is legal; it only says, in the network's own frame,
 *     what the rule already said.
 *  2. THE FOLD IS A LOOK, NOT A LIMIT. Where a network writes "… more" is
 *     how its own app DISPLAYS a caption; it is not a provider rule and it
 *     never blocks anything. The caption limits that DO block are
 *     `PLATFORM_RULES[p].captionMax`, and those arrive as problems.
 *  3. THE CLIENT'S COPY CARRIES NOTHING INTERNAL. `forClient` is the only
 *     way a preview reaches the portal, and it drops the account id, the
 *     refusals and the notes — see `CLIENT_PREVIEW_FIELDS`.
 */

import { isTrialTarget, trialWords } from './trial-reel-core'
import {
  PLATFORM_RULES, autoKindFor, isPlatform, networkName, validatePost,
  type MediaType, type Platform, type PostKind, type PostOptions,
} from './publish-core'

/** What a post type is CALLED on screen — one spelling, everywhere. */
export const POST_KIND_WORD: Record<PostKind, string> = {
  feed: 'Feed post', reel: 'Reel', story: 'Story', carousel: 'Carousel',
}

/** One piece of media, as the frame needs it. */
export type PreviewMedia = {
  url: string
  type: MediaType
  name?: string
}

/**
 * What one network's frame looks like.
 *
 * `aspect` is a CSS aspect-ratio string, one per post type, so the picture is
 * cropped on screen the way the network will crop it.
 *
 * `fold` is how many letters that network's app shows before it folds the
 * rest behind its "more" link — 0 means the network shows NO writing at all
 * on that kind of post (an Instagram or Facebook Story), which is the one
 * fold that changes what a person should do. These numbers are what each
 * app does today, read off the apps; they are display, never a refusal, and
 * are deliberately kept out of every check.
 */
export type PreviewSpec = {
  /** the frame's shape, per post type */
  aspect: Record<PostKind, string>
  /** letters shown before the fold, per post type; 0 = no writing at all */
  fold: Record<PostKind, number>
  /** the words this network writes on the fold */
  more: string
  /** the caption sits ABOVE the picture (LinkedIn, Facebook, X) or under it */
  captionAbove: boolean
  /** a row of dots under a post of several slides */
  dots: boolean
  /** a first comment appears under the post */
  firstComment: boolean
  /** a place appears under the handle */
  place: boolean
  /** a headline sits over the words */
  title: boolean
  /** a link in the caption gets its own card under the post */
  linkCard: boolean
}

const everyKind = (v: string): Record<PostKind, string> =>
  ({ feed: v, reel: v, story: v, carousel: v })
const everyFold = (n: number): Record<PostKind, number> =>
  ({ feed: n, reel: n, story: n, carousel: n })

/**
 * THE ONE TABLE. A new network is a row here.
 *
 * Keyed by the same `Platform` the publisher uses, so a network that can be
 * posted to and a network that can be previewed can never drift apart —
 * `everyNetworkHasAFrame` in the tests holds them together.
 */
export const PREVIEW_SPECS: Record<Platform, PreviewSpec> = {
  instagram: {
    aspect: { feed: '4 / 5', carousel: '1 / 1', reel: '9 / 16', story: '9 / 16' },
    // a Story shows no writing at all — Instagram simply drops the caption
    fold: { feed: 125, carousel: 125, reel: 125, story: 0 },
    more: 'more',
    captionAbove: false, dots: true, firstComment: true, place: true,
    title: false, linkCard: false,
  },
  facebook: {
    aspect: { feed: '1.91 / 1', carousel: '1 / 1', reel: '9 / 16', story: '9 / 16' },
    fold: { feed: 250, carousel: 250, reel: 250, story: 0 },
    more: 'See more',
    captionAbove: true, dots: true, firstComment: true, place: false,
    title: true, linkCard: true,
  },
  tiktok: {
    aspect: everyKind('9 / 16'),
    fold: everyFold(90),
    more: 'more',
    captionAbove: false, dots: true, firstComment: false, place: false,
    title: false, linkCard: false,
  },
  linkedin: {
    aspect: { feed: '1.91 / 1', carousel: '1 / 1', reel: '9 / 16', story: '1.91 / 1' },
    fold: everyFold(210),
    more: '…see more',
    captionAbove: true, dots: true, firstComment: true, place: false,
    title: false, linkCard: true,
  },
  youtube: {
    aspect: { feed: '16 / 9', carousel: '16 / 9', reel: '9 / 16', story: '16 / 9' },
    fold: everyFold(100),
    more: '…more',
    captionAbove: false, dots: false, firstComment: true, place: false,
    title: true, linkCard: false,
  },
  twitter: {
    aspect: everyKind('16 / 9'),
    // X shows the whole of a 280-character post; nothing is ever folded
    fold: everyFold(280),
    more: 'Show more',
    captionAbove: true, dots: true, firstComment: false, place: false,
    title: false, linkCard: true,
  },
  threads: {
    aspect: { feed: '4 / 5', carousel: '1 / 1', reel: '9 / 16', story: '4 / 5' },
    fold: everyFold(500),
    more: 'more',
    captionAbove: true, dots: true, firstComment: true, place: false,
    title: false, linkCard: true,
  },
  pinterest: {
    aspect: everyKind('2 / 3'),
    fold: everyFold(500),
    more: 'more',
    captionAbove: false, dots: false, firstComment: false, place: false,
    title: true, linkCard: true,
  },
  bluesky: {
    aspect: everyKind('16 / 9'),
    fold: everyFold(300),
    more: 'more',
    captionAbove: true, dots: true, firstComment: false, place: false,
    title: false, linkCard: true,
  },
  reddit: {
    aspect: everyKind('4 / 5'),
    fold: everyFold(400),
    more: 'See more',
    captionAbove: true, dots: false, firstComment: false, place: false,
    title: true, linkCard: true,
  },
}

/** The frame for this network, or null for one we do not draw. */
export function previewSpecFor(platform: string): PreviewSpec | null {
  const key = String(platform).toLowerCase()
  // 'x' is what people call it and 'twitter' is what the publisher calls it
  const p = key === 'x' ? 'twitter' : key
  return isPlatform(p) ? PREVIEW_SPECS[p] : null
}

/** The publisher's name for a network somebody typed a nickname for. */
export function previewPlatform(platform: string): Platform | null {
  const key = String(platform).toLowerCase()
  const p = key === 'x' ? 'twitter' : key
  return isPlatform(p) ? p : null
}

/** The shape this network crops this kind of post to. */
export function previewAspect(platform: string, kind: PostKind): string {
  return previewSpecFor(platform)?.aspect[kind] ?? '1 / 1'
}

export type FoldedCaption = {
  /** what the network shows before the fold */
  shown: string
  /** what it hides behind "more" */
  rest: string
  /** was anything hidden at all */
  folded: boolean
  /** the words the network writes on the fold */
  more: string
}

/**
 * Fold a caption where the network folds it.
 *
 * Broken on a WORD, not mid-syllable: a fold that reads "the new collec… more"
 * looks like a bug rather than like the app. A word longer than the gap is cut
 * where the network would cut it, because pushing the whole word past the fold
 * would show LESS than the network shows.
 *
 * `at` of 0 means the network shows no writing at all: everything is hidden
 * and nothing is shown.
 */
export function foldCaption(text: string, at: number, more = 'more'): FoldedCaption {
  const body = String(text ?? '')
  if (at <= 0) return { shown: '', rest: body, folded: body.length > 0, more }
  if (body.length <= at) return { shown: body, rest: '', folded: false, more }
  const hard = body.slice(0, at)
  const space = hard.lastIndexOf(' ')
  // only step back to a word boundary when the boundary is close; a single
  // 200-letter hashtag string must not collapse the whole preview
  const cut = space > at - 25 && space > 0 ? space : at
  return {
    shown: body.slice(0, cut).trimEnd(),
    rest: body.slice(cut).trimStart(),
    folded: true,
    more,
  }
}

/** The first link in some writing — what a network would draw a card for. */
export function firstLinkIn(text: string | null | undefined): string | null {
  const m = String(text ?? '').match(/https?:\/\/[^\s<>"')]+/i)
  return m ? m[0] : null
}

/** One channel, as the preview needs to know it. */
export type PreviewChannel = {
  /** the account row's id — internal, and never handed to a client */
  id: string
  platform: string
  /** the handle people see, without the @ */
  handle?: string | null
  /** the account's display name */
  name?: string | null
  avatarUrl?: string | null
  /** this channel's own posting options, exactly as the composer holds them */
  options?: PostOptions | null
  /** this channel's own media, when it has its own set */
  media?: readonly PreviewMedia[] | null
  /**
   * The NAME of the place this post is tagged to.
   *
   * Never the id. `locationId` is a numeric Facebook Page id — the only thing
   * Instagram's API takes — and a number on a preview is not a place anybody
   * recognises. The composer holds the client's saved places by name and
   * passes the name it matched; an id nobody has a name for shows no place at
   * all, which is honest.
   */
  placeName?: string | null
}

export type PreviewInput = {
  caption: string
  media: readonly PreviewMedia[]
  channels: readonly PreviewChannel[]
}

/**
 * One network's frame, fully worked out. Everything the component draws is
 * on this object, so the component itself knows nothing about any network.
 */
export type NetworkPreview = {
  /** internal — the account this frame is of */
  accountId: string
  platform: Platform
  /** the network's own name: "Instagram", "X" */
  network: string
  /** "@handle", or the account's name when there is no handle */
  handle: string
  name: string
  avatarUrl: string | null
  kind: PostKind
  kindWord: string
  aspect: string
  media: PreviewMedia[]
  /** how many slides this network is being given */
  slides: number
  /** does this network draw carousel dots for them */
  dots: boolean
  caption: FoldedCaption | null
  captionAbove: boolean
  title: string | null
  firstComment: string | null
  place: string | null
  link: string | null
  /** "Trial Reel · non-followers first, …" when this Instagram Reel is one, else null */
  trial: string | null
  /** why this network would REFUSE the post — publish-core's own sentences */
  problems: string[]
  /** true things worth knowing that are not refusals */
  notes: string[]
}

export type PostPreview = {
  networks: NetworkPreview[]
  /** every refusal across every network, in order — the composer already
   *  shows these; the preview marks the tab they belong to */
  problems: string[]
}

/** What this network will actually publish, chosen or worked out. */
export function previewKind(
  platform: string, options: PostOptions | null | undefined, media: readonly PreviewMedia[],
): PostKind {
  const p = previewPlatform(platform)
  if (!p) return 'feed'
  const picked = options?.kind
  if (picked) return picked
  return autoKindFor(p, media.map(m => ({ url: m.url, type: m.type })))
}

/**
 * Build the preview for a whole post — one frame per selected channel.
 *
 * The refusals come from ONE run of `validatePost` over the same maps the
 * publisher builds (`problemsWith` in social-schedule.ts is the model), so a
 * sentence on a tab here is the sentence that would stop the post.
 */
export function buildPostPreview(input: PreviewInput): PostPreview {
  const channels = (input.channels ?? []).filter(c => c && previewPlatform(c.platform))
  if (channels.length === 0) return { networks: [], problems: [] }

  const shared = (input.media ?? []).map(m => ({ ...m }))
  const caption = String(input.caption ?? '')

  const platforms: Platform[] = []
  const kinds: Partial<Record<Platform, PostKind>> = {}
  const mediaByPlatform: Partial<Record<Platform, { url: string; type: MediaType }[]>> = {}
  const captionByPlatform: Partial<Record<Platform, string>> = {}
  const optionsByPlatform: Partial<Record<Platform, PostOptions>> = {}

  for (const c of channels) {
    const p = previewPlatform(c.platform)!
    platforms.push(p)
    const own = c.options ?? {}
    const ownMedia = c.media?.length ? c.media : null
    const kind = previewKind(p, own, ownMedia ?? shared)
    kinds[p] = kind
    if (ownMedia) mediaByPlatform[p] = ownMedia.map(m => ({ url: m.url, type: m.type }))
    if (own.caption?.trim()) captionByPlatform[p] = own.caption
    // every channel gets an entry, empty or not: TikTok's tick is missing
    // exactly when nobody has opened the options
    optionsByPlatform[p] = { ...own, kind }
  }

  const issues = validatePost({
    caption,
    media: shared.map(m => ({ url: m.url, type: m.type })),
    platforms,
    kinds,
    mediaByPlatform,
    captionByPlatform,
    optionsByPlatform,
  })

  const networks = channels.map(c => {
    const platform = previewPlatform(c.platform)!
    const spec = PREVIEW_SPECS[platform]
    const own = c.options ?? {}
    const media = (c.media?.length ? c.media : shared).map(m => ({ ...m }))
    const kind = kinds[platform] ?? 'feed'
    const words = own.caption?.trim() ? own.caption : caption
    const fold = spec.fold[kind]
    const handle = String(c.handle ?? '').trim()
    const name = String(c.name ?? '').trim()

    const notes: string[] = []
    if (fold === 0 && words.trim()) {
      notes.push(
        `${networkName(platform)} shows no writing on a Story — this caption will not appear. `
        + 'Put the words into the picture or the video itself.')
    }
    const rules = PLATFORM_RULES[platform]
    if (rules && !rules.requiresMedia && media.length === 0) {
      notes.push('No picture or video on this one — it goes out as words alone.')
    }

    return {
      accountId: c.id,
      platform,
      network: networkName(platform),
      handle: handle ? `@${handle.replace(/^@/, '')}` : (name || networkName(platform)),
      name: name || handle || networkName(platform),
      avatarUrl: c.avatarUrl ? String(c.avatarUrl) : null,
      kind,
      kindWord: POST_KIND_WORD[kind],
      aspect: spec.aspect[kind],
      media,
      slides: media.length,
      dots: spec.dots && media.length > 1,
      caption: fold === 0 && !words.trim() ? null : foldCaption(words, fold, spec.more),
      captionAbove: spec.captionAbove,
      title: spec.title ? (own.title?.trim() || null) : null,
      firstComment: spec.firstComment ? (own.firstComment?.trim() || null) : null,
      place: spec.place ? (String(c.placeName ?? '').trim() || null) : null,
      link: spec.linkCard && own.disableLinkPreview !== true ? firstLinkIn(words) : null,
      trial: isTrialTarget(platform, { kind, trialGraduation: own.trialGraduation }) ? trialWords(own.trialGraduation) : null,
      problems: issues.filter(i => i.platform === platform).map(i => i.problem),
      notes,
    } satisfies NetworkPreview
  })

  return { networks, problems: issues.map(i => i.problem) }
}

/* ── the client's copy ──────────────────────────────────────────────────── */

/**
 * The fields a client may see. Anything not on this list never leaves the
 * building — `noInternalFieldsReachTheClient` in the tests reads this list
 * and the function below together, so adding a field to `NetworkPreview`
 * cannot quietly add it to the portal.
 */
export const CLIENT_PREVIEW_FIELDS = [
  'platform', 'network', 'handle', 'name', 'avatarUrl',
  'kind', 'kindWord', 'aspect', 'media', 'slides', 'dots',
  'caption', 'captionAbove', 'title', 'firstComment', 'place', 'link', 'trial',
] as const

export type ClientPreview = Pick<NetworkPreview, (typeof CLIENT_PREVIEW_FIELDS)[number]>

/**
 * The same frame, stripped for the client's portal.
 *
 * Gone: the account id (an internal row id), the refusals and the notes.
 * A refusal is the agency's problem to fix before it asks anybody anything —
 * a client being shown "Tick the TikTok box" is being handed our homework.
 */
export function forClient(n: NetworkPreview): ClientPreview {
  return {
    platform: n.platform,
    network: n.network,
    handle: n.handle,
    name: n.name,
    avatarUrl: n.avatarUrl,
    kind: n.kind,
    kindWord: n.kindWord,
    aspect: n.aspect,
    media: n.media.map(m => ({ url: m.url, type: m.type, ...(m.name ? { name: m.name } : {}) })),
    slides: n.slides,
    dots: n.dots,
    caption: n.caption,
    captionAbove: n.captionAbove,
    title: n.title,
    firstComment: n.firstComment,
    place: n.place,
    link: n.link,
    trial: n.trial,
  }
}

/** Every frame of a post, stripped for the client. */
export function clientPreviews(preview: PostPreview): ClientPreview[] {
  return preview.networks.map(forClient)
}

/** The words over the preview: what a person is looking at. */
export const PREVIEW_INTRO =
  'This is how the post will look to the people who see it.'

/** …and the client's version of the same sentence. */
export const CLIENT_PREVIEW_INTRO =
  'Here is your post, exactly as it will look when it goes out.'

/** The tab a network wears when something on it would stop the post. */
export function tabTone(n: { problems?: readonly string[] }): 'ok' | 'problem' {
  return (n.problems?.length ?? 0) > 0 ? 'problem' : 'ok'
}
