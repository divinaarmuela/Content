/**
 * The client portal's pure half — no I/O, unit-tested.
 *
 * What a client sees per status, what the five columns are CALLED on their
 * side, what a card may offer them, where a link goes, and when a swipe is an
 * approval. The server payload (portal-data.ts), the two portal surfaces and
 * the two portal API routes all read from here, so the card that offers
 * Approve and the route that accepts it agree by construction.
 *
 * Words are held to the portal's rules: plain, one sentence per card at most,
 * never a raw status, never internal jargon ("internal review", "revision"),
 * and "media", never "graphic".
 */

import { ITEM_STATUSES, type ItemStatus } from './workflow-core'

// ── the five columns, in the client's words ─────────────────────────────────

export type PortalColumnKey = 'making' | 'checking' | 'your_review' | 'approved' | 'posted'

export type PortalColumn = {
  key: PortalColumnKey
  /** the column's name on the client's board */
  title: string
  /** one plain clause under the name, for a client who has never seen a board */
  hint: string
  statuses: ItemStatus[]
}

/**
 * The same five columns the team's boards use (spec: Draft · Internal check ·
 * With client · Ready to post · Posted), named for what they mean to the
 * person whose work it is. The statuses underneath are identical, so a card
 * is in the same column on both sides of the glass.
 */
export const PORTAL_COLUMNS: PortalColumn[] = [
  { key: 'making', title: 'Being made', hint: 'The team is on it.', statuses: ['draft_uploaded'] },
  {
    key: 'checking', title: 'Being checked', hint: 'A last look before it comes to you.',
    statuses: ['internal_review', 'revision_required', 'revision_complete'],
  },
  {
    key: 'your_review', title: 'Your review', hint: 'Approve it, or ask for a change.',
    statuses: ['client_review', 'client_changes_requested'],
  },
  { key: 'approved', title: 'Approved', hint: 'Waiting for a posting time.', statuses: ['approved_for_scheduling'] },
  // "Done", not "Posted": a wrapped shoot lands here too, and a shoot is
  // never posted — it is finished
  { key: 'posted', title: 'Done', hint: 'Booked in, live, or wrapped.', statuses: ['scheduled', 'published'] },
]

export function portalColumnFor(status: ItemStatus): PortalColumnKey {
  const col = PORTAL_COLUMNS.find(c => c.statuses.includes(status))
  // every status is in exactly one column (pinned by the test); this is the
  // type system's fallback, not a real path
  return col?.key ?? 'making'
}

// ── what the client may see and do ──────────────────────────────────────────

/** Statuses at which the piece has reached the client at least once. Only
 *  these carry media, a link, or a place to comment — a draft nobody has
 *  checked is not theirs to open yet. */
export const CLIENT_FACING_STATUSES: ItemStatus[] = [
  'client_review', 'client_changes_requested', 'approved_for_scheduling', 'scheduled', 'published',
]

export function isClientFacing(status: ItemStatus): boolean {
  return CLIENT_FACING_STATUSES.includes(status)
}

export type PortalActions = {
  /** one tap approves — only while the piece is with them */
  approve: boolean
  /** the smaller, secondary action — opens one box */
  askForChange: boolean
  /** a comment pinned to this card */
  comment: boolean
}

/** What a card offers the client. The API routes consult this too, so a card
 *  that is not with the client cannot be approved by guessing its id. */
export function portalActions(status: ItemStatus): PortalActions {
  const withClient = status === 'client_review'
  return { approve: withClient, askForChange: withClient, comment: isClientFacing(status) }
}

/** What the server says when a client acts on a card that is not with them. */
export const NOT_WITH_YOU = 'This one is not with you right now.'

// ── the one sentence on a card ──────────────────────────────────────────────

/** What the piece is, in the client's words. `null` hides the word entirely
 *  — an internal "other" is not something they ordered. "Image", never
 *  "graphic". */
const KIND_WORDS: Record<string, string> = {
  reel: 'Reel', carousel: 'Carousel', story: 'Story', static: 'Image', video: 'Video', image: 'Image',
}

export function kindWord(contentType: string | null | undefined): string | null {
  return KIND_WORDS[String(contentType ?? '').toLowerCase()] ?? null
}

/**
 * The single sentence under a card's title. At most one — a board is read at
 * a glance, and a card that needs a paragraph has failed.
 *
 * `postedWhen` is the booked posting time already formatted for the client
 * (see portal-words' scheduledWhen); `progress` is the one line portal-words
 * adds when a piece was pulled back out of their review, which outranks the
 * column's stock sentence because it answers "where did it go?".
 */
export function cardLine(
  status: ItemStatus,
  opts: { postedWhen?: string | null; progress?: string | null } = {},
): string {
  if (opts.progress) return opts.progress
  switch (status) {
    case 'draft_uploaded':
      return 'Being made now.'
    case 'internal_review':
    case 'revision_required':
    case 'revision_complete':
      return 'Getting a last check before it comes to you.'
    case 'client_review':
      return 'Ready for you — open it, then approve or ask for a change.'
    case 'client_changes_requested':
      return 'We have your notes and we’re making the changes.'
    case 'approved_for_scheduling':
      return 'Approved — we’ll book a posting time.'
    case 'scheduled':
      return opts.postedWhen ? `Going out ${opts.postedWhen}.` : 'Booked in — the posting time is set.'
    case 'published':
      return 'Live.'
  }
}

// ── the link on a card ──────────────────────────────────────────────────────

export type PortalLink = { url: string; label: string; provider: 'drive' | 'dropbox' | 'other' }

/**
 * Where the work lives. A pasted Google Drive or Dropbox link is labelled as
 * such; anything else is "the file". A link is a link — the portal never
 * writes to Drive (CLAUDE.md trap 13). Only https links are offered.
 */
export function linkFor(url: string | null | undefined): PortalLink | null {
  const raw = (url ?? '').trim()
  if (!raw) return null
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const is = (h: string) => host === h || host.endsWith(`.${h}`)
  if (is('drive.google.com') || is('docs.google.com')) {
    return { url: raw, label: 'Open in Google Drive', provider: 'drive' }
  }
  if (is('dropbox.com')) return { url: raw, label: 'Open in Dropbox', provider: 'dropbox' }
  return { url: raw, label: 'Open the file', provider: 'other' }
}

// ── the card's colour ───────────────────────────────────────────────────────

export type PortalCardTone = 'amber' | 'green' | 'blue' | 'ink'

/**
 * The colour of a card is the thing that needs the client. Amber is "your
 * call", green is approved, blue is booked, ink is live; everything else is
 * a plain card, so the one waiting on them is obvious from across the room.
 * "We're making your changes" is deliberately NOT red — on the client's side
 * that is reassurance, not an alarm.
 */
export function portalCardTone(status: ItemStatus): PortalCardTone | undefined {
  switch (status) {
    case 'client_review': return 'amber'
    case 'approved_for_scheduling': return 'green'
    case 'scheduled': return 'blue'
    case 'published': return 'ink'
    default: return undefined
  }
}

// ── the swipe ───────────────────────────────────────────────────────────────

/** How far a finger has to travel, in px, before letting go approves. */
export const SWIPE_APPROVE_PX = 96

/**
 * On a phone, swiping the card from the right approves it: the finger lands
 * on the right and travels left, so `dx` is negative. A drag that is mostly
 * vertical is a scroll, never an approval, whatever its width — a client
 * flicking down the board must not approve a reel on the way past.
 */
export function swipeToApprove(dx: number, dy: number, threshold = SWIPE_APPROVE_PX): boolean {
  if (dx > -threshold) return false
  return Math.abs(dy) < Math.abs(dx) / 2
}

/** How far the card follows the finger: only leftwards, and never off-screen. */
export function swipeOffset(dx: number, max = 160): number {
  if (dx >= 0) return 0
  return Math.max(dx, -max)
}

// ── comments pinned to a card ───────────────────────────────────────────────

export type PortalCardComment = {
  id: string
  created_at: string
  body: string
  author_name: string
  from_team: boolean
}

/**
 * One client-visible comment row, as the client reads it: the team's people
 * keep their names; the client's own portal identity (a hidden team_users row
 * named "<client> (client portal)") reads as the client's company name.
 */
export function toPortalComment(clientName: string) {
  return (c: {
    id: string; created_at: string; body: string
    team_users?: { name?: string | null; role?: string | null } | null
  }): PortalCardComment => {
    const role = c.team_users?.role ?? 'client'
    const fromTeam = role !== 'client'
    return {
      id: c.id,
      created_at: c.created_at,
      body: c.body,
      author_name: fromTeam ? (c.team_users?.name ?? 'MD Media') : clientName,
      from_team: fromTeam,
    }
  }
}

// ── ordering and counting ───────────────────────────────────────────────────

/** Within a column, the card waiting on the client comes first; then newest
 *  first, so the top of every column is the freshest thing in it. */
export function sortForColumn<T extends { status: ItemStatus; updated_at: string }>(cards: T[]): T[] {
  return [...cards].sort((a, b) => {
    const aWait = a.status === 'client_review' ? 0 : 1
    const bWait = b.status === 'client_review' ? 0 : 1
    if (aWait !== bWait) return aWait - bWait
    return b.updated_at.localeCompare(a.updated_at)
  })
}

/** Cards by column — a shoot card carries its column already, a piece's
 *  follows from its status, and both count the same way. */
export function columnCounts<T extends { column: PortalColumnKey }>(cards: T[]): Record<PortalColumnKey, number> {
  const out = { making: 0, checking: 0, your_review: 0, approved: 0, posted: 0 }
  for (const c of cards) out[c.column] += 1
  return out
}

/** How many cards are actually waiting on the client — the number the page
 *  leads with. */
export function waitingOnYou<T extends { actions: PortalActions }>(cards: T[]): number {
  return cards.filter(c => c.actions.approve).length
}

// ── the client's brand on the page ──────────────────────────────────────────

/** The client's logo, from the profile the team keeps: the first logo file
 *  with an https link. Nothing else on the page is ever a logo. */
export function brandLogoUrl(profile: unknown): string | null {
  const files = (profile as { logo_files?: unknown } | null)?.logo_files
  if (!Array.isArray(files)) return null
  for (const f of files) {
    const url = String((f as { url?: unknown })?.url ?? '').trim()
    if (/^https:\/\//i.test(url)) return url
  }
  return null
}

/** The empty board, in as many words as it needs and no more. */
export const EMPTY_BOARD_LINE =
  'Nothing here yet. When the team sends you something, it appears on this board with a link — and you approve it with one tap.'

/** Every status has a column — exported so the test can say so in one line. */
export const ALL_STATUSES: readonly ItemStatus[] = ITEM_STATUSES

// ── the shoot plan ──────────────────────────────────────────────────────────

/**
 * Whether the client may decide on a shoot plan: only a plan the team has
 * SHARED, whose brief is sitting at client_review. Approving something you
 * were never shown is not a decision, and a plan at any other stage is not
 * theirs to move. portal-data derives the plan card's actions from this and
 * the act route checks the same rule on the brief item.
 */
export function planDecidable(
  sharedWithClient: boolean,
  briefStatus: string | null | undefined,
): boolean {
  return sharedWithClient === true && String(briefStatus ?? '') === 'client_review'
}

/**
 * ONE SHOOT IS ONE CARD, from booked to wrapped.
 *
 * The portal used to show a shoot as several things — a booking, a plan, a
 * wrap — and nothing said they were the same day. A card is a THING, never a
 * stage: the stage is the column the card sits in and the one line on it.
 * This is the whole rule, from the three facts a shoot has: whether its plan
 * was shared, where the plan's brief is, and where the shoot itself is.
 */
export type ShootFacts = {
  sharedWithClient: boolean
  /** the brief item's status, when the shoot has one */
  briefStatus: string | null | undefined
  /** the batch's own status: brief · locked · shot · wrapped */
  shootStatus: string | null | undefined
  /** the shoot date, already written for a person ("Thu 17 Sep"), or null */
  dateLabel?: string | null
}

export type ShootStanding = {
  column: PortalColumnKey
  line: string
  tone: PortalCardTone | undefined
  actions: PortalActions
}

export function shootStanding(f: ShootFacts): ShootStanding {
  const shoot = String(f.shootStatus ?? 'brief')
  const brief = String(f.briefStatus ?? '')
  const shared = f.sharedWithClient === true
  const decide = planDecidable(shared, brief)
  const actions: PortalActions = { approve: decide, askForChange: decide, comment: shared }
  const on = f.dateLabel ? ` on ${f.dateLabel}` : ''
  const forDay = f.dateLabel ? ` for ${f.dateLabel}` : ''

  // the day itself is over: the card says so, whatever the plan's paperwork says
  if (shoot === 'wrapped') {
    return { column: 'posted', line: `Wrapped${on} — the footage is being turned into your content.`, tone: 'ink', actions }
  }
  if (shoot === 'shot') {
    return { column: 'approved', line: `Filmed${on} — being edited now.`, tone: 'blue', actions }
  }
  // the plan is theirs to decide on
  if (decide) {
    return { column: 'your_review', line: 'Your plan is ready to look at — approve it, or ask for a change.', tone: 'amber', actions }
  }
  if (shared && ['client_changes_requested', 'revision_required', 'revision_complete'].includes(brief)) {
    return { column: 'your_review', line: 'We have your notes and we’ll come back with an updated plan.', tone: undefined, actions }
  }
  // booked: the date is the fact that matters
  if (shoot === 'locked') {
    return { column: 'approved', line: f.dateLabel ? `Booked${forDay}.` : 'Booked — the date is confirmed.', tone: 'blue', actions }
  }
  if (shared && ['approved_for_scheduling', 'scheduled', 'published'].includes(brief)) {
    return { column: 'approved', line: 'Plan approved — we’ll confirm the date shortly.', tone: 'green', actions }
  }
  return { column: 'making', line: `Being planned${forDay}.`, tone: undefined, actions }
}

/** The client's PDF of a shared plan, from the share link. The signed-in
 *  portal has no token and so no PDF — the route is token-gated by design. */
export function planPdfHref(token: string | null | undefined, batchId: string): string | null {
  if (!token) return null
  return `/api/portal/shoot-pdf?token=${encodeURIComponent(token)}&id=${encodeURIComponent(batchId)}`
}

/** What the card says back the moment the client acts, before the reload
 *  confirms it — a pressed button must never look like nothing happened. */
export function actedLine(kind: 'work' | 'shoot', action: 'approve' | 'request_changes'): string {
  if (kind === 'shoot') {
    return shootStanding({
      sharedWithClient: true, shootStatus: 'brief',
      briefStatus: action === 'approve' ? 'approved_for_scheduling' : 'client_changes_requested',
    }).line
  }
  return cardLine(action === 'approve' ? 'approved_for_scheduling' : 'client_changes_requested')
}

/** A shoot date for a person, from the plain `YYYY-MM-DD` the row carries.
 *  Parsed as a calendar day, never as midnight UTC, so the day cannot slip. */
export function shootDayLabel(d: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '')
  if (!m) return null
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  // spelled out rather than Intl: ICU builds disagree ("Thu, 17 Sept" on
  // some), and a date on a card must read the same on every machine
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`
}
