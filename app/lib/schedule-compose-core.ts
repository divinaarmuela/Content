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
  isPageId, kindTakesLocation, PLATFORM_RULES, type Platform, type PostKind,
} from './publish-core'
import { NETWORK_LABEL, type SocialPostStatus } from './social-schedule-core'
import { reorder, type Slide } from './version-files-core'
import { fromZonedInput, wallTimeIn } from './timezone-core'

/* ── the composition being edited ───────────────────────────────────────── */

/** Per-channel extras. Only the ones the provider takes — see `moreOptionsFor`. */
export type ChannelExtras = {
  caption?: string
  kind?: string
  firstComment?: string
  collaborators?: string[]
  shareToFeed?: boolean
  /** the numeric Facebook Page id of the place — Instagram only */
  locationId?: string
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
  /** has anything changed since the last save */
  dirty: boolean
}

export type ComposerAction =
  | { type: 'loaded'; state: Partial<ComposerState> }
  | { type: 'caption'; caption: string }
  | { type: 'slides'; slides: Slide[] }
  | { type: 'channel'; id: string; on: boolean }
  | { type: 'time'; iso: string | null }
  | { type: 'extra'; channel: string; patch: ChannelExtras }
  | { type: 'saved'; postId?: string | null }

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
}): ComposerState {
  return {
    postId: input.postId ?? null,
    itemId: input.itemId,
    slides: [...(input.slides ?? [])],
    caption: String(input.caption ?? ''),
    channels: [...(input.channels ?? [])],
    scheduledFor: input.scheduledFor ?? null,
    perChannel: { ...(input.perChannel ?? {}) },
    dirty: false,
  }
}

/** Read the `per_channel` blob off a stored post into the shape the window
 *  edits, dropping anything that is not one of the fields we send. */
export function readPerChannel(v: unknown): Record<string, ChannelExtras> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, ChannelExtras> = {}
  for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const extras: ChannelExtras = {}
    if (typeof r.caption === 'string') extras.caption = r.caption
    if (typeof r.kind === 'string') extras.kind = r.kind
    if (typeof r.firstComment === 'string') extras.firstComment = r.firstComment
    if (typeof r.shareToFeed === 'boolean') extras.shareToFeed = r.shareToFeed
    if (typeof r.locationId === 'string') extras.locationId = r.locationId
    if (Array.isArray(r.collaborators)) {
      extras.collaborators = r.collaborators.map(String).filter(Boolean).slice(0, 3)
    }
    out[id] = extras
  }
  return out
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
        : { ...state, scheduledFor: action.iso, dirty: true }
    case 'extra': {
      const before = state.perChannel[action.channel] ?? {}
      return {
        ...state,
        perChannel: { ...state.perChannel, [action.channel]: { ...before, ...action.patch } },
        dirty: true,
      }
    }
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

export type MoreOptionKey = 'firstComment' | 'collaborators' | 'shareToFeed' | 'location'

export type MoreOption = {
  key: MoreOptionKey
  label: string
  /** the channels on screen it applies to — the row says which */
  platforms: string[]
}

/**
 * Which of the composer's "More options" are real for these channels.
 *
 * Read straight off what `toPlatformData` sends. Location and product tags
 * are in Later's window and not in ours, because Zernio takes neither: a row
 * that collects something the provider will never receive is a lie the person
 * only finds out about after the post is live.
 */
const OPTION_PLATFORMS: Record<MoreOptionKey, Platform[]> = {
  firstComment: ['instagram', 'facebook', 'threads'],
  collaborators: ['instagram'],
  shareToFeed: ['instagram', 'facebook'],
  location: ['instagram'],
}
const OPTION_LABEL: Record<MoreOptionKey, string> = {
  firstComment: 'Add first comment',
  collaborators: 'Invite collaborator',
  shareToFeed: 'Also show the Reel in the feed',
  location: 'Add location',
}

/**
 * @param kind the post type currently chosen, when one is — a Story is the
 *   one case where Instagram REFUSES a location rather than ignoring it, so
 *   the row goes away rather than offering a field that breaks the post.
 */
export function moreOptionsFor(
  platforms: readonly string[] | null | undefined,
  kind?: PostKind | null,
): MoreOption[] {
  const list = [...new Set((Array.isArray(platforms) ? platforms : []).map(p => String(p)))]
  return (Object.keys(OPTION_PLATFORMS) as MoreOptionKey[])
    .filter(key => key !== 'location' || kindTakesLocation(kind ?? undefined))
    .map(key => ({
      key,
      label: OPTION_LABEL[key],
      platforms: list.filter(p => (OPTION_PLATFORMS[key] as string[]).includes(p)),
    }))
    .filter(o => o.platforms.length > 0)
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

/** Quarter hours: nobody schedules a post for 6:07. */
export const MINUTE_STEPS = [0, 15, 30, 45]
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
export type MediaSource = 'approved' | 'drive' | 'upload'

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

/** The sentence in the picker's footer. The whole new-version rule, said the
 *  way the mockup says it. */
export const NEW_VERSION_NOTICE =
  'Uploads and Drive files are added to this item as a new version and need '
  + "the client's approval before the post can be sent."

/** …and the one over the tray. */
export const PICKER_HELP = 'Drag files from the library into the post. Drag to reorder.'

/** What the left pane says under the grid. */
export const PICKER_LIBRARY_HELP =
  'Faded ones are already in the post. Drag a file to the right to add it.'

/* ── the footer ─────────────────────────────────────────────────────────── */

/** The plain sentence on the footer's state pill. */
export const APPROVAL_LINE: Record<SocialPostStatus, string> = {
  draft: 'Needs approval before it can post',
  pending: 'Waiting for approval',
  approved: 'Approved — ready to go out',
  changes: 'Changes asked for',
  scheduled: 'Booked in with the channel',
  published: 'Posted',
  failed: 'Did not go out',
  cancelled: 'Cancelled',
}

export type FooterActionKey = 'send' | 'draft' | 'direct' | 'schedule' | 'now' | 'none'

export type FooterAction = { key: FooterActionKey; label: string }

/**
 * What the button at the bottom of the window does next.
 *
 * The split button, exactly as the owner ruled it:
 *
 *  before approval  → "Send for approval", with "Save as draft" in the menu,
 *                     and "Schedule without approval" ONLY for somebody who
 *                     could have approved it (the client's account manager, a
 *                     super admin). A scheduler never sees an option they
 *                     would be refused.
 *  after approval   → "Schedule", with "Post now" in the menu, and only for
 *                     the people who may publish.
 *  once it is booked in or finished → nothing to press.
 *
 * Hiding the option is presentation; the refusal itself lives in
 * `scheduleWithoutApproval` and `assertMayPublish` on the server.
 */
export function footerActions(input: {
  status: SocialPostStatus
  /** may this person approve the final post (account manager, super admin) */
  mayApprove: boolean
  /** may this person book a post in with the channel at all */
  mayPublish: boolean
}): { primary: FooterAction; menu: FooterAction[] } {
  const { status, mayApprove, mayPublish } = input

  if (status === 'approved') {
    return mayPublish
      ? { primary: { key: 'schedule', label: 'Schedule' }, menu: [{ key: 'now', label: 'Post now' }] }
      : { primary: { key: 'none', label: 'Approved — a scheduler books it in' }, menu: [] }
  }
  if (status === 'scheduled' || status === 'published'
    || status === 'failed' || status === 'cancelled') {
    return { primary: { key: 'none', label: APPROVAL_LINE[status] }, menu: [] }
  }

  const menu: FooterAction[] = [{ key: 'draft', label: 'Save as draft' }]
  if (mayApprove) menu.push({ key: 'direct', label: 'Schedule without approval' })
  return {
    primary: { key: 'send', label: status === 'pending' ? 'Send again' : 'Send for approval' },
    menu,
  }
}
