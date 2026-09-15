/**
 * Pure shoot-brief lifecycle — no I/O, mirroring workflow-core.ts.
 *
 * A batch IS the shoot brief: it is planned (brief), its date is locked
 * (locked — the explicit commitment that opens production), it happens
 * (shot), and eventually it is wrapped. Content items may only be created
 * under a locked or shot brief; anyone who makes work — editors and up — can
 * go around the gate for genuinely ad-hoc work, but must say why, and the
 * reason is logged.
 */

import { SHOOT_BRIEF_SLUG } from './brief-task-core'
import type { Role } from './identity-core'
import { planLines, type PlanLine } from './deliverable-group-core'
import { colourOf, iconOf } from './board-canvas-core'
import { pruneOrphans } from './shoot-board-core'
import { providerFor, youtubeId } from './link-preview-core'

export const BATCH_STATUSES = ['brief', 'locked', 'shot', 'wrapped'] as const
export type BatchStatus = (typeof BATCH_STATUSES)[number]

export type BatchTransitionRule = { roles: Role[]; label: string }

/** The four stages, in the words the team uses for them. Lives here, with the
 *  states themselves, so the shoots page and the calendars cannot drift into
 *  two vocabularies for one status. */
export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  brief: 'In planning', locked: 'Booked', shot: 'Shot', wrapped: 'Closed',
}

export const BATCH_TRANSITIONS: Partial<Record<BatchStatus, Partial<Record<BatchStatus, BatchTransitionRule>>>> = {
  brief: {
    // booking = committing to the date. One action, one word, everywhere.
    locked: { roles: ['editor', 'account_manager'], label: 'Book the shoot' },
  },
  locked: {
    brief: { roles: ['account_manager'], label: 'Undo the booking' },
    // kept for the data model; the surfaces DERIVE "Shot" from the calendar
    // (shoot-lifecycle-core) instead of offering this as a button
    shot: { roles: ['editor', 'account_manager'], label: 'Mark as shot' },
    wrapped: { roles: ['account_manager'], label: 'Close shoot' },
  },
  shot: {
    wrapped: { roles: ['account_manager'], label: 'Close shoot' },
  },
  // a shoot wrapped by mistake must be recoverable — without this edge a
  // mis-click freezes it forever (no route can move it, no items can be filed)
  wrapped: {
    shot: { roles: ['account_manager'], label: 'Reopen shoot' },
  },
}

export type BatchTransitionCheck =
  | { ok: true; rule: BatchTransitionRule }
  | { ok: false; reason: string }

export function checkBatchTransition(role: Role, from: BatchStatus, to: BatchStatus): BatchTransitionCheck {
  const rule = BATCH_TRANSITIONS[from]?.[to]
  if (!rule) return { ok: false, reason: `No transition from ${from} to ${to}` }
  if (role === 'super_admin') return { ok: true, rule }
  if (!rule.roles.includes(role)) {
    return { ok: false, reason: `${role} may not perform "${rule.label}"` }
  }
  return { ok: true, rule }
}

/** Transitions a role can perform from a status (for rendering buttons). */
export function availableBatchTransitions(role: Role, from: BatchStatus): { to: BatchStatus; label: string }[] {
  const out: { to: BatchStatus; label: string }[] = []
  for (const [to, rule] of Object.entries(BATCH_TRANSITIONS[from] ?? {})) {
    if (!rule) continue
    if (role === 'super_admin' || rule.roles.includes(role)) {
      out.push({ to: to as BatchStatus, label: rule.label })
    }
  }
  return out
}

/** Locking is a commitment — it needs something to commit to. */
export function batchSatisfiesLock(b: { title?: string | null; shoot_date?: string | null }): boolean {
  if (!b.title || !String(b.title).trim()) return false
  const d = String(b.shoot_date ?? '').trim()
  return d !== '' && !Number.isNaN(new Date(d).getTime())
}

/**
 * The production gate: may this person create content items here?
 *  - under a locked, shot or WRAPPED brief: any item-creating role (editor+).
 *    Wrapped stays open on purpose: footage gets cut months later, and that
 *    work counts toward the month it goes live, not the shoot's month
 *  - under a brief still being planned: nobody — the point of the stage
 *  - with NO batch at all: editors and up, WITH a stated reason (supers
 *    included — auditability is the point, not trust). Footage often arrives
 *    without a shoot, and the editor is who has it.
 */
export function canCreateItemsUnder(
  batchStatus: BatchStatus | null,
  role: Role,
  adhoc?: { reason: string },
  kindSlug?: string,
): boolean {
  // every TEAM role makes work — the owner's rule, verbatim: "scheduler/editor
  // can create production items too". Only clients never create.
  if (role === 'client') return false
  // a shoot-BRIEF task is how a shoot begins — it may start from nothing
  // (its shoot is created with it) or attach to a still-planning brief.
  //
  // It used to be an account manager's act alone, which made it the one
  // exception to the rule three lines above, and the exception did not earn
  // itself: an editor who knows a shoot is needed had to go and ask somebody
  // to type it. Planning is work like the rest of it, and who a piece of work
  // BELONGS to is answered by assignment on the boards, not by refusing to
  // let somebody write it down. Only clients still never create.
  if (kindSlug === 'shoot_brief') {
    // …or attach to any shoot that is not finished. Restricting it to a
    // still-planning shoot meant that the moment a date was locked the brief
    // could never be raised, and "New brief task" quietly built a SECOND
    // shoot instead of joining the one already there.
    return batchStatus === null || batchStatus !== 'wrapped'
  }
  if (batchStatus === 'locked' || batchStatus === 'shot' || batchStatus === 'wrapped') return true
  if (batchStatus === null) {
    // Editors too, not just managers: plenty of work arrives with no shoot
    // behind it at all — the client sends phone footage, or an old shoot
    // supplies the raws — and the editor is the person who has it. Locking
    // that behind a manager meant either a fake shoot brief or an item that
    // could not be created at all, and the first is worse than the gate.
    //
    // The REASON stays mandatory for everyone, supers included: the point was
    // never trust, it is that "why is there no shoot?" has a recorded answer.
    return Boolean(adhoc?.reason && adhoc.reason.trim())
  }
  return false
}

/** Display helper: a brief with items under way reads as "in production". */
export function isInProduction(b: { status: BatchStatus }, itemCount: number): boolean {
  return (b.status === 'locked' || b.status === 'shot') && itemCount > 0
}

/* ── browser-input sanitisers: never trust a jsonb shape from a client ── */

export type ShotRow = { id: string; text: string; type?: string; qty?: number; done: boolean }

export function sanitiseShotList(raw: unknown): ShotRow[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map(r => ({
      id: String(r.id ?? '').slice(0, 40) || Math.random().toString(36).slice(2, 10),
      text: String(r.text ?? '').slice(0, 300),
      ...(r.type ? { type: String(r.type).slice(0, 20) } : {}),
      ...(Number.isInteger(Number(r.qty)) && Number(r.qty) > 0 ? { qty: Number(r.qty) } : {}),
      done: r.done === true,
    }))
    .filter(r => r.text.trim() !== '')
    .slice(0, 100)
}

/** One line of the plan — one thing coming out of the shoot, one card later. */
export type PlannedDeliverable = PlanLine

/** The plan as lines, whichever shape it was stored in: new `{id, title}`
 *  rows as written, old `{type, qty}` rows expanded ("Reel 1", "Reel 2"). */
export function sanitisePlannedDeliverables(raw: unknown): PlannedDeliverable[] {
  return planLines(raw)
}

export type ReferenceMedia = { kind: 'image' | 'link'; url: string; name?: string; note?: string }

export function sanitiseReferenceMedia(raw: unknown): ReferenceMedia[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map(r => ({
      kind: (r.kind === 'link' ? 'link' : 'image') as 'image' | 'link',
      url: String(r.url ?? '').slice(0, 2000),
      ...(r.name ? { name: String(r.name).slice(0, 200) } : {}),
      ...(r.note ? { note: String(r.note).slice(0, 300) } : {}),
    }))
    .filter(r => /^https:\/\//.test(r.url))
    .slice(0, 60)
}

/* ── the brief canvas: freeform cards on a pan/zoom board ── */

export const CANVAS_CARD_KINDS = ['note', 'image', 'link', 'label', 'arrow', 'mockup', 'todo', 'board'] as const
export const MOCKUP_PLATFORMS = [
  'ig_post', 'ig_reel', 'ig_story', 'ig_carousel', 'linkedin',
  'youtube', 'yt_short', 'tiktok', 'facebook', 'pinterest',
] as const
export const CANVAS_NOTE_COLORS = [
  'paper', 'yellow', 'orange', 'red', 'pink', 'purple', 'blue', 'teal', 'green', 'ink',
] as const
/** Text size on a note or a heading. Absent = 'md', which is exactly the
 *  size every board drawn before this field existed renders at, so old
 *  boards look the same. (Divina, 13 Sep 2026: "I can't change … text
 *  width and size".) */
/** TEXT COLOUR on a note or a heading (the owner, 13 Sep 2026: "the text
 *  color changing, where is that option — the option you gave is for the
 *  box"). Absent = the box decides (dark on a light box, light on ink). */
export const CANVAS_TEXT_COLORS = ['ink', 'grey', 'red', 'amber', 'green', 'blue', 'white'] as const
export type CanvasTextColor = (typeof CANVAS_TEXT_COLORS)[number]
export function textColorOf(card: { text_color?: string | null } | null | undefined): CanvasTextColor | null {
  const v = card?.text_color
  return (CANVAS_TEXT_COLORS as readonly string[]).includes(String(v)) ? (v as CanvasTextColor) : null
}

/** THE KINDS WITH WORDS OF THEIR OWN — a note, a heading, a to-do and, since
 *  14 Sep 2026 (the owner: "allow the board to have toolbar too like size
 *  texts etc"), a board tile, whose name is its words. Only these carry a
 *  text size, a text colour and an alignment. */
export const TEXT_STYLED_KINDS = ['note', 'label', 'todo', 'board'] as const
export function hasTextStyle(kind: string | null | undefined): boolean {
  return (TEXT_STYLED_KINDS as readonly string[]).includes(String(kind ?? ''))
}

/** WHERE THE WORDS SIT in a note, a heading or a to-do (the owner, 13 Sep
 *  2026: "allow alignment, either left, middle or right"). Absent = left —
 *  except on a board tile, whose name has always sat in the middle. */
export const CANVAS_TEXT_ALIGNS = ['left', 'center', 'right'] as const
export type CanvasTextAlign = (typeof CANVAS_TEXT_ALIGNS)[number]
export function defaultAlignOf(kind: string | null | undefined): CanvasTextAlign {
  return kind === 'board' ? 'center' : 'left'
}
/** Are the card's words bold? Only the kinds with words of their own. */
export function textBoldOf(card: { bold?: boolean | null; kind?: string | null } | null | undefined): boolean {
  return card?.bold === true && hasTextStyle(card?.kind)
}

export function textAlignOf(card: { align?: string | null; kind?: string | null } | null | undefined): CanvasTextAlign {
  const v = card?.align
  return (CANVAS_TEXT_ALIGNS as readonly string[]).includes(String(v)) ? (v as CanvasTextAlign) : defaultAlignOf(card?.kind)
}

export const CANVAS_TEXT_SIZES = ['sm', 'md', 'lg', 'xl'] as const
export type CanvasTextSize = (typeof CANVAS_TEXT_SIZES)[number]
export const TEXT_SIZE_LABEL: Record<CanvasTextSize, string> = { sm: 'Small', md: 'Normal', lg: 'Large', xl: 'Heading' }
/** a note's words, in px — md is today's 13px */
export const NOTE_FONT_PX: Record<CanvasTextSize, number> = { sm: 12, md: 13, lg: 17, xl: 22 }
/** a section heading's words, in px — md is today's 15px */
export const LABEL_FONT_PX: Record<CanvasTextSize, number> = { sm: 12, md: 15, lg: 19, xl: 24 }
export function textSizeOf(card: { size?: string | null } | null | undefined): CanvasTextSize {
  const v = card?.size
  return (CANVAS_TEXT_SIZES as readonly string[]).includes(String(v)) ? (v as CanvasTextSize) : 'md'
}
/** the next size up or down, stopping at the ends */
export function stepTextSize(size: CanvasTextSize, dir: 1 | -1): CanvasTextSize {
  const i = CANVAS_TEXT_SIZES.indexOf(size)
  return CANVAS_TEXT_SIZES[Math.min(CANVAS_TEXT_SIZES.length - 1, Math.max(0, i + dir))]
}
const CANVAS_BOUND = 20_000
/** across the WHOLE tree — a shoot with a few boards inside boards is still
 *  one array, so the cap is the shoot's, not one board's */
const CANVAS_MAX_CARDS = 600

export type CanvasCard = {
  id: string
  kind: (typeof CANVAS_CARD_KINDS)[number]
  x: number
  y: number
  w: number
  /** the height the person dragged the card to. Absent = the card is as
   *  tall as what is in it, which is how every board drawn before this
   *  field existed still renders. Some kinds never carry one (a heading is
   *  its text; a mockup is its platform's frame; an arrow has no box). */
  h?: number
  z: number
  text?: string
  url?: string
  name?: string
  color?: (typeof CANVAS_NOTE_COLORS)[number]
  /** note / label — how big the words are; absent = 'md' (today's size) */
  size?: CanvasTextSize
  /** note / heading — the words' own colour; absent = the box decides */
  text_color?: CanvasTextColor
  /** note / heading / to-do — left, centre or right; absent = left */
  align?: CanvasTextAlign
  /** BOLD WORDS (the owner, 15 Sep 2026: "add a Bold text feature on the shoot
   *  brief board") — a note, a heading, a to-do or a board's name, in bold */
  bold?: boolean
  /** arrow endpoints — ids of the two cards it connects */
  from?: string
  to?: string
  /** mockup frame — which platform chrome wraps the image */
  platform?: (typeof MOCKUP_PLATFORMS)[number]
  /** carousel mockup — every slide, in order (url stays = slide 1) */
  urls?: string[]
  /** todo card — its checklist rows */
  items?: { id: string; text: string; done: boolean }[]
  /** link card — what the link actually is, so the card can SHOW it rather
   *  than name it. Resolved once when the link is dropped and stored on the
   *  card: the board must not make a network request per card on every open,
   *  and a preview that disappears when a provider rate-limits us is worse
   *  than one that is a few weeks stale. */
  thumb?: string
  title?: string
  provider?: string
  media?: 'video' | 'image' | 'page'
  /** the provider's own URL for the post when the pasted one was a share
   *  short link with no id (vm.tiktok.com) — what lets the card play */
  canonical?: string
  /** false only when the provider said the post cannot be framed */
  embeddable?: false
  /** the account the post belongs to, when the provider said ("@handle") */
  author?: string
  /** a plain mp4 of the post on the provider's CDN (a Pinterest video pin)
   *  — played in place like one of our own files */
  video?: string
  /** what the team says about a picture, a clip or a link — written under
   *  the media on the card, shown the same way on the client portal */
  caption?: string
  /** mockup frame — the real post it was made from. The frame keeps its
   *  platform chrome; the post's media, mark, account and caption fill it. */
  link_url?: string
  /** mockup frame — what that link resolved to, the same shape a link card
   *  stores flat */
  preview?: LinkPreviewFields
  /** board tile — its look. The names are board-canvas-core's palette and
   *  icon set, validated there, so a tile reads in both themes. */
  icon?: string
  colour?: string
  /** the board tile this card lives inside; absent = the shoot's own board.
   *  One flat array, boards to any depth: a board is nothing more than its
   *  tile, and its contents are the cards that point at it. */
  parent?: string
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** A resolved link, as a card stores it. */
export type LinkPreviewFields = {
  thumb?: string
  title?: string
  provider?: string
  media?: 'video' | 'image' | 'page'
  canonical?: string
  embeddable?: false
  author?: string
  video?: string
}

/** The preview fields out of an untrusted record. The thumbnail is drawn as
 *  an <img src> and the video as a <video src>, so both go through the same
 *  https-only gate the card's own url does — a preview is not a reason to
 *  relax it. */
export function sanitisePreviewFields(r: Record<string, unknown>): LinkPreviewFields {
  return {
    ...(String(r.thumb ?? '').startsWith('https://') ? { thumb: String(r.thumb).slice(0, 2000) } : {}),
    ...(String(r.video ?? '').startsWith('https://') ? { video: String(r.video).slice(0, 2000) } : {}),
    ...(r.title ? { title: String(r.title).slice(0, 200) } : {}),
    ...(r.provider ? { provider: String(r.provider).slice(0, 40) } : {}),
    ...(['video', 'image', 'page'].includes(String(r.media ?? ''))
      ? { media: String(r.media) as LinkPreviewFields['media'] } : {}),
    ...(String(r.canonical ?? '').startsWith('https://') ? { canonical: String(r.canonical).slice(0, 2000) } : {}),
    ...(r.embeddable === false ? { embeddable: false as const } : {}),
    ...(r.author ? { author: String(r.author).slice(0, 80) } : {}),
  }
}

/**
 * Which mock-up frame a pasted post belongs in. A Reel is a Reel, a Short is
 * a Short; a plain Instagram post or a carousel both come back as a post
 * (a URL cannot tell them apart). `null` for a link no frame fits — X, a
 * blog — which stays a link card.
 */
export function mockupPlatformFor(url: string): NonNullable<CanvasCard['platform']> | null {
  const p = providerFor(url)
  if (!p) return null
  let path = ''
  try { path = new URL(url).pathname } catch { return null }
  switch (p.name) {
    case 'Instagram':
      if (/^\/(reel|reels)\//.test(path)) return 'ig_reel'
      if (/^\/stories\//.test(path)) return 'ig_story'
      return 'ig_post'
    case 'TikTok': return 'tiktok'
    case 'YouTube': return youtubeId(url) ? (/\/shorts\//.test(path) ? 'yt_short' : 'youtube') : null
    case 'LinkedIn': return 'linkedin'
    case 'Facebook': return 'facebook'
    // a pin, or a pin.it share code that the route resolves to one
    case 'Pinterest': return 'pinterest'
    default: return null
  }
}

/**
 * The narrowest a card may be made without a word of its text being cut:
 * the widest word, at the kind's font size, plus its padding. An estimate
 * from character counts (no canvas on the server), erring wide, so a
 * heading never breaks mid-word and a note never shows half a word.
 */
export function longestWordWidth(kind: CanvasCard['kind'], text: string | undefined, size: CanvasTextSize = 'md'): number {
  if (!text) return 0
  // px per character, erring wide: a heading is mono, upper-case, widely
  // tracked; a note is 13px proportional text — both scaled by the text size
  const scale = kind === 'label' ? LABEL_FONT_PX[size] / LABEL_FONT_PX.md : NOTE_FONT_PX[size] / NOTE_FONT_PX.md
  const perChar = (kind === 'label' ? 11.5 : 8) * scale
  const pad = kind === 'label' ? 0 : 26
  let longest = 0
  for (const word of text.split(/\s+/)) longest = Math.max(longest, word.length)
  return Math.min(longest, 40) * perChar + pad
}

/** The floor for a card's width: its kind's minimum, or its widest word if
 *  that is wider. */
export function minCardWidth(kind: CanvasCard['kind'], text?: string, size: CanvasTextSize = 'md'): number {
  return Math.max(CANVAS_SIZE_LIMITS[kind].minW, Math.round(longestWordWidth(kind, text, size)))
}

/* ── card sizes: what the corner handle may do to each kind ── */

export type CardSizeLimits = { minW: number; maxW: number; minH: number | null; maxH: number }

/** Per-kind minimums so nothing collapses to nothing, and generous maximums.
 *  `minH: null` means the kind has no height of its own — it is width-only
 *  and `h` is dropped on the way in. */
export const CANVAS_SIZE_LIMITS: Record<CanvasCard['kind'], CardSizeLimits> = {
  note:   { minW: 160, maxW: 1200, minH: 80,  maxH: 2400 },
  todo:   { minW: 160, maxW: 1200, minH: 80,  maxH: 2400 },
  image:  { minW: 120, maxW: 1200, minH: 90,  maxH: 2400 },
  link:   { minW: 120, maxW: 1200, minH: 90,  maxH: 2400 },
  board:  { minW: 140, maxW: 1200, minH: 140, maxH: 2400 },
  // a heading is as tall as its text; a mockup is its platform's frame,
  // which follows the width; an arrow is two endpoints, not a box
  label:  { minW: 120, maxW: 1200, minH: null, maxH: 2400 },
  mockup: { minW: 120, maxW: 1200, minH: null, maxH: 2400 },
  arrow:  { minW: 120, maxW: 1200, minH: null, maxH: 2400 },
}

/** Does this kind remember a height at all? */
export function cardTakesHeight(kind: CanvasCard['kind']): boolean {
  return CANVAS_SIZE_LIMITS[kind].minH !== null
}

/** Clamp a size into its kind's box. A height on a width-only kind, or a
 *  height that is not a number, comes back as `undefined` (= follow content). */
export function clampCardSize(
  kind: CanvasCard['kind'], w: number, h?: number | null,
): { w: number; h?: number } {
  const lim = CANVAS_SIZE_LIMITS[kind]
  const cw = clamp(Math.round(Number(w)) || 240, lim.minW, lim.maxW)
  if (lim.minH === null || h === undefined || h === null) return { w: cw }
  const n = Math.round(Number(h))
  if (!Number.isFinite(n) || n <= 0) return { w: cw }
  return { w: cw, h: clamp(n, lim.minH, lim.maxH) }
}

/** One step of a corner drag, in world pixels. `start` is the box at
 *  pointerdown — the height MEASURED from the DOM when the card had none
 *  of its own — and `lockAspect` (Shift) keeps start's shape: the width
 *  leads and the height follows it, so a picture stays the picture. */
export function resizeCard(
  kind: CanvasCard['kind'],
  start: { w: number; h: number },
  dx: number, dy: number,
  lockAspect = false,
  /** the card's words: the width never goes under its widest one */
  text?: string,
  /** the words' size — a heading-sized word is wider */
  size: CanvasTextSize = 'md',
): { w: number; h?: number } {
  const lim = CANVAS_SIZE_LIMITS[kind]
  const minW = Math.min(minCardWidth(kind, text, size), lim.maxW)
  if (lim.minH === null) return { w: clamp(Math.round(start.w + dx) || 240, minW, lim.maxW) }
  if (lockAspect && start.w > 0 && start.h > 0) {
    const ratio = start.h / start.w
    // the width is clamped first, then the height derived from it, then
    // clamped again — if the height clamp bites, the width follows it back
    let w = clamp(Math.round(start.w + dx), minW, lim.maxW)
    let h = clamp(Math.round(w * ratio), lim.minH, lim.maxH)
    if (Math.round(w * ratio) !== h) w = clamp(Math.round(h / ratio), minW, lim.maxW)
    return { w, h }
  }
  // a pull past zero is a card at its minimum, not a card without a height
  return {
    w: clamp(Math.round(start.w + dx), minW, lim.maxW),
    h: clamp(Math.round(start.h + dy), lim.minH, lim.maxH),
  }
}

export function sanitiseCanvasCards(raw: unknown): CanvasCard[] {
  if (!Array.isArray(raw)) return []
  // hard input bound before any per-item work — a giant payload can't OOM us
  const input = raw.length > CANVAS_MAX_CARDS * 4 ? raw.slice(0, CANVAS_MAX_CARDS * 4) : raw
  const byId = new Map<string, CanvasCard>()
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const kind = String(r.kind ?? '')
    if (!(CANVAS_CARD_KINDS as readonly string[]).includes(kind)) continue
    const x = Number(r.x); const y = Number(r.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const url = String(r.url ?? '').slice(0, 2000)
    if ((kind === 'image' || kind === 'link') && !url.startsWith('https://')) continue
    // a mockup may exist as an empty frame awaiting its image
    const from = String(r.from ?? '').slice(0, 40)
    const to = String(r.to ?? '').slice(0, 40)
    if (kind === 'arrow' && (!from || !to || from === to)) continue
    const platform = String(r.platform ?? '')
    if (kind === 'mockup' && !(MOCKUP_PLATFORMS as readonly string[]).includes(platform)) continue
    const id = String(r.id ?? '').slice(0, 40) || Math.random().toString(36).slice(2, 10)
    const color = String(r.color ?? '')
    const parent = String(r.parent ?? '').slice(0, 40)
    const card: CanvasCard = {
      id,
      kind: kind as CanvasCard['kind'],
      x: clamp(Math.round(x), -CANVAS_BOUND, CANVAS_BOUND),
      y: clamp(Math.round(y), -CANVAS_BOUND, CANVAS_BOUND),
      ...clampCardSize(kind as CanvasCard['kind'], Number(r.w), typeof r.h === 'number' || typeof r.h === 'string' ? Number(r.h) : undefined),
      z: clamp(Math.round(Number(r.z)) || 0, 0, 1_000_000),
      ...(kind === 'note' || kind === 'label'
        ? { text: String(r.text ?? '').slice(0, kind === 'label' ? 120 : 4000) }
        : {}),
      ...(kind === 'mockup' && r.text ? { text: String(r.text).slice(0, 500) } : {}),
      ...(kind === 'image' || kind === 'link' ? { url } : {}),
      ...(kind === 'mockup' && url.startsWith('https://') ? { url } : {}),
      ...(kind === 'mockup' && Array.isArray(r.urls)
        ? (() => {
            const urls = r.urls
              .map(u => String(u ?? '').slice(0, 2000))
              .filter(u => u.startsWith('https://'))
              .slice(0, 10)
            return urls.length > 0 ? { urls } : {}
          })()
        : {}),
      ...(r.name ? { name: String(r.name).slice(0, 200) } : {}),
      ...(kind === 'board'
        ? {
            name: String(r.name ?? '').trim().slice(0, 80) || 'Board',
            icon: iconOf(typeof r.icon === 'string' ? r.icon : undefined),
            colour: colourOf('board', typeof r.colour === 'string' ? r.colour : undefined),
          }
        : {}),
      // a card can only live inside a board tile, and never inside itself
      ...(parent && parent !== id ? { parent } : {}),
      // a link's resolved preview. The thumbnail is rendered as an <img src>,
      // so it goes through the same https-only gate the card's own url does —
      // a preview is not a reason to relax it.
      ...(kind === 'link' ? sanitisePreviewFields(r) : {}),
      // what the team wrote under the media — a picture, a clip or a link
      ...((kind === 'image' || kind === 'link') && typeof r.caption === 'string' && r.caption.trim()
        ? { caption: r.caption.trim().slice(0, 1000) } : {}),
      // a mock-up made from a real post: the link, and what it resolved to
      ...(kind === 'mockup' && String(r.link_url ?? '').startsWith('https://')
        ? {
            link_url: String(r.link_url).slice(0, 2000),
            ...(r.preview && typeof r.preview === 'object'
              ? (() => {
                  const p = sanitisePreviewFields(r.preview as Record<string, unknown>)
                  return Object.keys(p).length ? { preview: p } : {}
                })()
              : {}),
          }
        : {}),
      ...((CANVAS_NOTE_COLORS as readonly string[]).includes(color)
        ? { color: color as CanvasCard['color'] }
        : {}),
      // text size on the kinds that carry words of their own (TEXT_STYLED_KINDS);
      // anything else, or an unknown value, is simply 'md' by absence
      ...(hasTextStyle(kind) && (CANVAS_TEXT_SIZES as readonly string[]).includes(String(r.size ?? ''))
        ? { size: String(r.size) as CanvasTextSize }
        : {}),
      ...(hasTextStyle(kind) && (CANVAS_TEXT_COLORS as readonly string[]).includes(String(r.text_color ?? ''))
        ? { text_color: String(r.text_color) as CanvasTextColor }
        : {}),
      ...(hasTextStyle(kind) && (CANVAS_TEXT_ALIGNS as readonly string[]).includes(String(r.align ?? ''))
        ? { align: String(r.align) as CanvasTextAlign }
        : {}),
      ...(hasTextStyle(kind) && r.bold === true ? { bold: true } : {}),
      ...(kind === 'arrow' ? { from, to } : {}),
      ...(kind === 'mockup' ? { platform: platform as CanvasCard['platform'] } : {}),
      ...(kind === 'todo'
        ? {
            items: (Array.isArray(r.items) ? r.items : [])
              .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
              .map(t => ({
                id: String(t.id ?? '').slice(0, 40) || Math.random().toString(36).slice(2, 10),
                text: String(t.text ?? '').slice(0, 200),
                done: t.done === true,
              }))
              .slice(0, 30),
          }
        : {}),
    }
    byId.set(card.id, card) // dedupe by id, keep-last
  }
  return [...byId.values()].slice(0, CANVAS_MAX_CARDS)
}

/** Per-card merge: upserts win by id, then removes drop theirs. This is what
 *  makes concurrent editors last-write-wins per CARD, not per board. */
export function applyCanvasOp(
  current: unknown,
  op: { upsert?: unknown; remove?: unknown },
): CanvasCard[] {
  const byId = new Map(sanitiseCanvasCards(current).map(c => [c.id, c]))
  for (const card of sanitiseCanvasCards(op.upsert)) byId.set(card.id, card)
  const removes = Array.isArray(op.remove) ? op.remove.slice(0, 200) : []
  for (const id of removes) byId.delete(String(id ?? '').slice(0, 40))
  // an arrow with a missing endpoint is noise — deleting a card takes its
  // arrows with it, whoever deleted it
  const solid = new Set([...byId.values()].filter(c => c.kind !== 'arrow').map(c => c.id))
  for (const c of [...byId.values()]) {
    if (c.kind === 'arrow' && (!solid.has(c.from ?? '') || !solid.has(c.to ?? ''))) byId.delete(c.id)
  }
  // deleting a board tile deletes everything inside it, to any depth, whoever
  // deleted it and whatever the client sent — a card whose board is gone has
  // nowhere to be shown
  return pruneOrphans([...byId.values()]).slice(0, CANVAS_MAX_CARDS)
}

/** First-open seeding: the existing reference images laid out as a grid.
 *  DETERMINISTIC ids — two people opening at once persist mergeable sets,
 *  never duplicates. In-memory until the first user action. */
export function seedCardsFromReferences(refs: ReferenceMedia[]): CanvasCard[] {
  if (refs.length === 0) return []
  const cards: CanvasCard[] = [{
    id: 'seed-label', kind: 'label', text: 'REFERENCES', x: 0, y: -48, w: 240, z: 0,
  }]
  const COL_W = 240 + 16
  const colHeights = [0, 0, 0]
  refs.slice(0, CANVAS_MAX_CARDS - 1).forEach((ref, i) => {
    const col = colHeights.indexOf(Math.min(...colHeights))
    const estHeight = ref.kind === 'image' ? 240 : 64
    cards.push({
      id: `seed-${i}-${ref.url.slice(-24).replace(/[^\w-]/g, '-')}`,
      kind: ref.kind === 'image' ? 'image' : 'link',
      x: col * COL_W,
      y: colHeights[col],
      w: 240,
      z: i + 1,
      url: ref.url,
      ...(ref.name ? { name: ref.name } : {}),
    })
    colHeights[col] += estHeight + 16
  })
  return cards
}

/** Who hears about a brief's lifecycle moments. */
export const BATCH_TRANSITION_NOTIFICATIONS: Record<string, ('owner_editor' | 'account_managers')[]> = {
  'brief>locked': ['owner_editor', 'account_managers'],
  'locked>shot': ['account_managers'],
}

/**
 * May this shoot be deleted, and what happens to what is under it.
 *
 * Deleting used to be refused the moment a shoot had ANY content item — which
 * in practice meant the moment its plan was written, since a shoot plan is
 * itself an item. So the only deletable shoot was one nobody had started, and
 * a shoot booked by mistake became permanent as soon as somebody described it.
 * The delete option simply vanished from the menu, with nothing to say why.
 *
 * The task quota card already solved this properly: detach the pieces first,
 * then delete the promise, so real work is never orphaned into a deleted
 * parent — it becomes a plain card and lives on. A shoot is the same shape of
 * thing and gets the same treatment.
 *
 * The one genuine stop is work that has left the building. A published or
 * scheduled piece is a commitment to the client's audience, and the shoot is
 * the record of where it came from; that is what "wrap it" is for.
 */
export type ShootDeletion =
  | { allowed: true; detaching: number; removing: number; consequence: string }
  | { allowed: false; reason: string }

/**
 * The plan's OWN card (the old flow's "shoot brief" task) is not work — it
 * is the shoot, described as a card. It goes with the shoot. Left behind it
 * read "Plan being written" on the Overview and Team activity for a shoot
 * that no longer existed (the owner, 13 Sep 2026: "there is deleted data
 * here?"). Deliverable cards are kept, as before.
 */
export function shootDeletion(
  items: readonly { status: string; kind?: string | null }[],
): ShootDeletion {
  const live = items.filter(i => i.status === 'published' || i.status === 'scheduled')
  if (live.length > 0) {
    return {
      allowed: false,
      reason: live.length === 1
        ? 'One piece from this shoot is already scheduled or live. Wrap the shoot instead — deleting it would lose where that post came from.'
        : `${live.length} pieces from this shoot are already scheduled or live. Wrap the shoot instead — deleting it would lose where those posts came from.`,
    }
  }
  const briefs = items.filter(i => i.kind === SHOOT_BRIEF_SLUG).length
  const n = items.length - briefs
  return {
    allowed: true,
    detaching: n,
    removing: briefs,
    consequence: n === 0
      ? 'Nothing is attached to it, so nothing else changes.'
      : n === 1
      ? 'Its one piece is kept and stays on the board as its own card — only the shoot goes.'
      : `Its ${n} pieces are kept and stay on the board as their own cards — only the shoot goes.`,
  }
}

/**
 * BOLD WORDS INSIDE A NOTE (the owner, 15 Sep 2026, a photo of a script on a
 * note with "HOOK:" highlighted: "this is the part where they wanted to just
 * make it bold — when they highlight it"). A run of words between ** and **
 * is bold; everything else is plain. The marks live in the note's text, so
 * the PDF, the portal and an old browser still read the words.
 */
export type BoldRun = { text: string; bold: boolean }

export function boldRuns(text: string | null | undefined): BoldRun[] {
  const s = String(text ?? '')
  const out: BoldRun[] = []
  const re = /\*\*([^*\n][^*]*?)\*\*/g
  let at = 0
  for (const m of s.matchAll(re)) {
    const i = m.index ?? 0
    if (i > at) out.push({ text: s.slice(at, i), bold: false })
    out.push({ text: m[1], bold: true })
    at = i + m[0].length
  }
  if (at < s.length) out.push({ text: s.slice(at), bold: false })
  return out
}

/**
 * Bold the highlighted words, or un-bold them when they already are. Hands
 * back the new text and where the highlight lands, so the caret stays on
 * the same words. Whitespace at the edges of the highlight is left outside
 * the marks, so "**word **" never happens.
 */
export function toggleBoldSelection(text: string, start: number, end: number): { text: string; start: number; end: number } {
  const [a, b] = start <= end ? [start, end] : [end, start]
  if (a === b) return { text, start: a, end: b }
  // already wrapped: **word** around the highlight, or the highlight includes the marks
  if (text.slice(a - 2, a) === '**' && text.slice(b, b + 2) === '**') {
    return { text: text.slice(0, a - 2) + text.slice(a, b) + text.slice(b + 2), start: a - 2, end: b - 2 }
  }
  const picked = text.slice(a, b)
  if (picked.startsWith('**') && picked.endsWith('**') && picked.length >= 4) {
    return { text: text.slice(0, a) + picked.slice(2, -2) + text.slice(b), start: a, end: b - 4 }
  }
  const lead = picked.length - picked.trimStart().length
  const trail = picked.length - picked.trimEnd().length
  const core = picked.slice(lead, picked.length - trail)
  if (!core) return { text, start: a, end: b }
  const next = text.slice(0, a + lead) + '**' + core + '**' + text.slice(b - trail)
  return { text: next, start: a + lead, end: a + lead + core.length + 4 }
}

/**
 * BOLD THE WORDS SOMEBODY HIGHLIGHTED ON THE SHOWN CARD (the owner, 15 Sep
 * 2026: "not the whole card — it's just the text — make it dynamic"). The
 * highlight comes from the page as plain words; this finds them in the
 * card's text and wraps them in ** — or unwraps them when they already are.
 * Null when the words are not in the text (a highlight across two cards).
 */
export function boldWordsIn(text: string, picked: string): string | null {
  const words = String(picked ?? '').replace(/\s+$/, '').replace(/^\s+/, '')
  if (!words) return null
  const wrapped = `**${words}**`
  const already = text.indexOf(wrapped)
  if (already >= 0) return text.slice(0, already) + words + text.slice(already + wrapped.length)
  const at = text.indexOf(words)
  if (at < 0) return null
  // inside a bold run already: leave it
  const before = text.lastIndexOf('**', at)
  if (before >= 0 && boldRuns(text).some(r => r.bold && r.text.includes(words))) return null
  return text.slice(0, at) + wrapped + text.slice(at + words.length)
}

/**
 * BOLD AS A SWITCH WHILE TYPING (the owner, 15 Sep 2026: "when Bold is live at
 * the top, then we start typing bold — and once we unclick, it's unbold").
 * With nothing highlighted, pressing Bold opens a bold run at the caret
 * (**|**) so the next words land inside it; pressing again with the caret
 * at the closing marks steps out of the run, so typing is plain again. Says
 * whether the switch is now on.
 */
export function boldModeToggle(text: string, caret: number): { text: string; caret: number; on: boolean } {
  const at = Math.max(0, Math.min(text.length, caret))
  if (text.slice(at, at + 2) === '**') return { text, caret: at + 2, on: false }
  return { text: text.slice(0, at) + '****' + text.slice(at), caret: at + 2, on: true }
}

/** Is the caret inside an open bold run — the switch is on? */
export function inBoldRun(text: string, caret: number): boolean {
  const before = text.slice(0, Math.max(0, Math.min(text.length, caret)))
  const opens = (before.match(/\*\*/g) ?? []).length
  return opens % 2 === 1
}
