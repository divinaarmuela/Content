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

import { PORTAL_DELIVERED_LINE } from './deliver-only-core'
import { ITEM_STATUSES, type ItemStatus } from './workflow-core'
import { LINK_LABELS, linkKindOf, type LinkKind } from './card-link-core'
import {
  MISSED_FOR_CLIENT, PORTAL_COLUMN, approveByOf, commentVisibleTo, failedNetworks, liveNetworks, slotMissed,
  type NowLike, type PostState,
} from './post-stage-core'
import { networkName } from './publish-core'
import { normaliseSlides, type Slide } from './version-files-core'

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
    statuses: ['internal_review', 'revision_required', 'revision_complete', 'quality_check', 'colour_grade'],
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
  opts: { postedWhen?: string | null; progress?: string | null; selfPosts?: boolean } = {},
): string {
  if (opts.progress) return opts.progress
  // DELIVER ONLY (the playbook's clients who post their own, 11 Sep 2026):
  // approved means the finals are theirs now, not "we'll book a time"
  if (status === 'approved_for_scheduling' && opts.selfPosts) return PORTAL_DELIVERED_LINE
  switch (status) {
    case 'draft_uploaded':
      return 'Being made now.'
    case 'internal_review':
    case 'revision_required':
    case 'revision_complete':
    case 'quality_check':
    case 'colour_grade':
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

export type PortalLink = { url: string; label: string; provider: LinkKind }

/**
 * Where the work lives. The team's pasted link (`content_items.link_url`,
 * with its stored `link_kind`) is the card's link; the kind is detected by
 * `linkKindOf` in card-link-core, the same rule the route that stores it
 * uses, so the portal and the board never disagree about what a link is.
 * A link is a link — the portal never writes to Drive (CLAUDE.md trap 13).
 * Only https links are offered; a stored kind wins over re-detection.
 */
export function linkFor(url: string | null | undefined, storedKind?: string | null): PortalLink | null {
  const check = linkKindOf(url)
  if (!check.ok) return null
  const kind: LinkKind = storedKind && storedKind in LINK_LABELS ? storedKind as LinkKind : check.kind
  return { url: check.url, label: `Open in ${LINK_LABELS[kind]}`.replace('Open in Link', 'Open the link'), provider: kind }
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
  /** the card on the shoot's planning board this is pinned to — null is the
   *  shoot's (or the piece's) general thread */
  card_id?: string | null
  /** that card in a person's words ("Hero reel image"); set by the server
   *  from the board, so the client never has to work it out */
  card_label?: string | null
}

/**
 * One client-visible comment row, as the client reads it: the team's people
 * keep their names; the client's own portal identity (a hidden team_users row
 * named "<client> (client portal)") reads as the client's company name.
 */
export function toPortalComment(clientName: string) {
  return (c: {
    id: string; created_at: string; body: string; card_id?: string | null
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
      card_id: c.card_id ?? null,
    }
  }
}

// ── ordering and counting ───────────────────────────────────────────────────

/** Cards by column — a shoot card carries its column already, a piece's
 *  follows from its status, and both count the same way. */
export function columnCounts<T extends { column: PortalColumnKey }>(cards: T[]): Record<PortalColumnKey, number> {
  const out = { making: 0, checking: 0, your_review: 0, approved: 0, posted: 0 }
  for (const c of cards) out[c.column] += 1
  return out
}

// ── the four sections of the page ───────────────────────────────────────────

export type PortalSectionKey = 'review' | 'approved' | 'published'

export type PortalSection<T> = {
  key: PortalSectionKey
  /** the heading, in the client's words — the same four words as the hero counters */
  title: string
  /** what an empty section says instead of nothing */
  empty: string
  cards: T[]
}

/**
 * The page reads top to bottom in the order a client cares: what needs THEM,
 * then what is approved and booked, then what is live. The five columns
 * fold into those three:
 *   Needs your review     = with the client for a decision
 *   Approved & scheduled  = approved, and booked in
 *   Published             = live (and a wrapped shoot)
 * NOTHING IN PRODUCTION (the owner, 14 Sep 2026: "let's not show anything
 * that's in production or in process in the client portal"): a piece being
 * made, being checked, or back with the team after the client's notes is
 * not on the client's page at all until it comes to them. A shoot card
 * follows the same rule through its column, so a plan waiting on the client
 * counts as needing their review.
 */
export function portalSections<T extends { column: PortalColumnKey; actions: PortalActions }>(cards: T[]): PortalSection<T>[] {
  // an EDIT is reviewed on its own link, never here (the owner, 22 Sep 2026: "that is for the team")
  const review = cards.filter(c => c.column === 'your_review' && c.actions.approve && !(c as { editing?: boolean }).editing)
  const approved = cards.filter(c => c.column === 'approved')
  const published = cards.filter(c => c.column === 'posted')
  return [
    { key: 'review', title: 'Needs your review', empty: 'Nothing is waiting on you right now.', cards: review },
    { key: 'approved', title: 'Approved & scheduled', empty: 'Nothing approved yet.', cards: approved },
    { key: 'published', title: 'Published', empty: 'Published posts appear here with live links.', cards: published },
  ]
}

/** The three hero counters — the same three words, the same three piles. */
export function sectionCounts<T extends { column: PortalColumnKey; actions: PortalActions }>(cards: T[]): Record<PortalSectionKey, number> {
  const out = { review: 0, approved: 0, published: 0 } as Record<PortalSectionKey, number>
  for (const s of portalSections(cards)) out[s.key] = s.cards.length
  return out
}

/**
 * The four numbers on the hero — and on the section headings, which are the
 * SAME four words, so a client counting "02" finds the section that says it.
 * Pieces count in their section; shoots live in their own section, so they
 * count only where it matters: a plan waiting on the client is a thing
 * waiting on the client, and "Needs your review 00" over a plan asking to
 * be approved would be the page contradicting itself.
 *
 * A FINISHED POST waiting on the client is the same contradiction, and it was
 * left in. The post sits at the very top of the page under "A post waiting on
 * you", while the piece behind it is approved or booked — so it was counted
 * under "Approved & scheduled" and the review counter said 00 over it. It is
 * counted ONCE now: added to review, and taken out of whichever pile its own
 * card was sitting in, so the four numbers still add up to the page.
 */
export function heroCounts<T extends { kind: 'work' | 'shoot' | 'post'; id: string; column: PortalColumnKey; actions: PortalActions }>(
  cards: T[],
  /** the posts waiting on the client (`post_approvals`) — drawn in their own
   *  section above the rest, so they are not among `cards`; were one ever
   *  passed in both, it is still counted once */
  postApprovals: readonly { id: string }[] = [],
): Record<PortalSectionKey, number> {
  // a post card (posting rebuild, 29 Sep 2026) counts exactly as a piece does
  const work = cards.filter(c => c.kind !== 'shoot')
  const counts = sectionCounts(work)
  counts.review += cards.filter(c => c.kind === 'shoot' && c.actions.approve).length

  const waiting = new Set(postApprovals.map(p => p.id))
  if (waiting.size > 0) {
    for (const s of portalSections(work)) {
      counts[s.key] -= s.cards.filter(c => waiting.has(c.id)).length
    }
  }
  counts.review += waiting.size
  return counts
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
  /** the client's answer ON THE SHOOT (13 Sep 2026): the plan is shared from
   *  the shoot page and approved or sent back on the portal, with no plan
   *  document behind it — 'approved' | 'changes' | null (not answered) */
  clientDecision?: string | null
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
  // no plan document: the shoot itself is decided on, until it is approved
  const onShoot = shared && !brief
  const decision = String(f.clientDecision ?? '')
  const decide = planDecidable(shared, brief) || (onShoot && decision !== 'approved')
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
  if (onShoot && decision === 'approved' && shoot !== 'locked') {
    return { column: 'approved', line: 'Plan approved — we’ll confirm the date shortly.', tone: 'green', actions }
  }
  if (onShoot && decision === 'changes') {
    return { column: 'your_review', line: 'We have your notes and we’ll come back with an updated plan. You can approve it here once it is.', tone: undefined, actions }
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


/* ══════════════════════════════════════════════════════════════════════════
 * THE POST, AS THE CLIENT SEES IT (the posting rebuild, 29 Sep 2026).
 *
 * Read docs/posting-rebuild/OWNER_DECISIONS.md and SPEC.md §4.4 first. The old
 * portal worked out where a post was from the EDIT card's fields and showed
 * the LIVE post. That is how a client approved a post nobody had sent them
 * (audit V5, P3), read "Approved — thank you" on a post the team approved
 * (P6), was thanked for a note they never wrote (P13), and approved pictures
 * added after the email went out (P2). The rules now:
 *
 *   1. Where a post is: `social_posts.stage`, and nothing else.
 *   2. What the client sees: a FROZEN version (`post_versions`), never the
 *      working copy. The one exception is a post that is already live on a
 *      network and was never frozen (it went out before versions were kept):
 *      what went out is public, so it is shown as it went.
 *   3. They may answer only a post that is with them, for the version they
 *      were sent, before its "approve by" time.
 *   4. Everything else they see states a fact that is true: who decided, and
 *      where it went.
 * ══════════════════════════════════════════════════════════════════════════ */

/** What one post is, on the client's side. */
export type ClientPostState =
  | 'review'            // with them, theirs to answer
  | 'missed'            // with them, but its approve-by time has gone
  | 'thanks'            // they asked for a change; the team is making it
  | 'updating'          // the team took it back to change it
  | 'you_approved'      // their own yes
  | 'approved_for_you'  // a manager said yes for them (decision 5)
  | 'team_decided'      // they saw an earlier version; the team decided this one (decision 6)
  | 'posted'
  | 'cancelled'

export type ClientPostView = {
  state: ClientPostState
  /** the frozen version the client is shown; null only for a live post that was never frozen */
  version: number | null
  /** may they press Approve or Ask for a change, now */
  canAnswer: boolean
  /** the one line at the top of the page and on the card */
  headline: string
  /** a second, quieter line, or null */
  line: string | null
  tone: PortalCardTone | undefined
  /** where it sits on the portal home — 'checking' is not drawn there */
  column: PortalColumnKey
}

export type ClientPostWords = {
  /** a time in the client's words, in the client's zone ("Thu 10 Sept, 6:00 pm") */
  when?: (iso: string | null | undefined) => string | null
  /** a team member's name, by id (for "Approved by Divina for you") */
  nameOf?: (id: string | null | undefined) => string | null | undefined
}

const firstName = (n: string | null | undefined) => String(n ?? '').trim().split(/\s+/)[0] || null
const listNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`


/** The portal home's column for a stage the client may see (SPEC §4.4: Review · Approved · Going out · Done). */
function homeColumn(post: PostState): PortalColumnKey {
  const c = PORTAL_COLUMN[post.stage]
  if (c === 'review') return 'your_review'
  if (c === 'approved' || c === 'going_out') return 'approved'
  if (c === 'done') return 'posted'
  return 'checking'
}

/** "Goes out Thu 10 Sept, 6:00 pm." or the plain words when there is no time yet. */
function goingOutLine(post: PostState, w: ClientPostWords): string {
  if (post.stage === 'booked') {
    const t = w.when?.(post.booking?.for_time ?? post.scheduled_for)
    return t ? `Goes out ${t}.` : 'Booked in — the posting time is set.'
  }
  return 'The team will book a time for it.'
}

/** Did the client ever have a version of this post in front of them? */
export function clientEverSaw(post: Pick<PostState, 'client_send' | 'last_client_send' | 'approval'>): boolean {
  return !!(post.client_send || post.last_client_send || post.approval?.hat === 'client' || post.approval?.on_behalf_of_client)
}

/**
 * WHAT THE CLIENT SEES OF ONE POST, or null when it is not theirs to see.
 * Everything on the portal — the post page, the home card, the one list of
 * what is waiting — reads this, and the act route asks the same question
 * (`canAnswer`) before it hands the answer to the one writer.
 *
 * Not theirs to see (null): a draft or a check they never had, and a post the
 * team approved without ever sending it (SPEC §4.4). A post that is live is
 * public, so it is always shown.
 */
export function clientPostView(post: PostState, now: NowLike, w: ClientPostWords = {}): ClientPostView | null {
  const view = (
    state: ClientPostState, version: number | null, headline: string, line: string | null,
    tone: PortalCardTone | undefined, canAnswer = false,
  ): ClientPostView => ({
    state, version, canAnswer, headline, line, tone,
    column: state === 'review' || state === 'missed' ? 'your_review'
      : state === 'thanks' || state === 'updating' || state === 'cancelled' ? 'checking'
      : homeColumn(post),
  })

  switch (post.stage) {
    case 'with_client': {
      const send = post.client_send
      // a post at With client that nothing reached is not with them (audit P9)
      if (!send) return null
      if (slotMissed(post, now)) return view('missed', send.version, MISSED_FOR_CLIENT, null, undefined)
      const by = w.when?.(approveByOf(post))
      // the version they were sent is the version they answer — nothing else (audit P2)
      const current = send.version === post.sent_version
      return view('review', send.version, 'Ready for you — approve it, or ask for a change.',
        by ? `Please answer by ${by}.` : null, 'amber', current)
    }
    case 'draft':
    case 'quality_check': {
      const last = post.last_client_send
      if (!last) return null
      // "thanks for your note" only when the note was THEIRS (audit P13)
      if (post.stage === 'draft' && post.changes_asked?.who === 'client') {
        return view('thanks', last.version, 'Thanks — we have your note', 'The team is making the change.', undefined)
      }
      return view('updating', last.version, 'The team is updating this post', 'Nothing for you to do yet.', undefined)
    }
    case 'ready':
    case 'booked': {
      const a = post.approval
      const version = a?.version ?? post.sent_version
      const tone: PortalCardTone = post.stage === 'booked' ? 'blue' : 'green'
      if (a?.hat === 'client' && !a.on_behalf_of_client) {
        return view('you_approved', version, 'You approved this', goingOutLine(post, w), tone)
      }
      if (a?.on_behalf_of_client) {
        // the manager's yes, in the manager's name — never "you approved" (decision 5, audit P6)
        const who = firstName(w.nameOf?.(a.by)) ?? 'the team'
        return view('approved_for_you', version, `Approved by ${who} for you`, goingOutLine(post, w), tone)
      }
      // they had an earlier version; the team decided this one (decision 6)
      if (post.last_client_send) {
        return view('team_decided', version, 'The team decided this one', `Nothing for you to do. ${goingOutLine(post, w)}`, tone)
      }
      // approved by the team and never sent: not the client's (SPEC §4.4)
      return null
    }
    case 'posted': {
      const live = liveNetworks(post).map(networkName)
      const failed = failedNetworks(post).map(networkName)
      return view('posted', post.sent_version,
        live.length > 0 ? `Live on ${listNames(live)}` : 'Live',
        failed.length > 0 ? `Not out yet on ${listNames(failed)}.` : null, 'ink')
    }
    case 'cancelled':
      if (!clientEverSaw(post)) return null
      return view('cancelled', post.last_client_send?.version ?? post.approval?.version ?? post.sent_version,
        'This post was cancelled', 'It will not go out.', undefined)
  }
}

/** The live links, one per network, from the post's own per-network record (audit L1, P5). */
export function postLiveLinks(post: Pick<PostState, 'outcomes'>): { platform: string; network: string; url: string }[] {
  return Object.entries(post.outcomes)
    .filter(([, o]) => (o.status === 'published' || o.status === 'duplicate') && !!o.url && /^https:\/\//i.test(o.url))
    .map(([platform, o]) => ({ platform, network: networkName(platform), url: o.url! }))
}

/** When it went out: the earliest network's time, else the booked time. */
export function postedAt(post: Pick<PostState, 'outcomes' | 'booking' | 'scheduled_for'>): string | null {
  const times = Object.values(post.outcomes)
    .filter(o => (o.status === 'published' || o.status === 'duplicate') && o.at)
    .map(o => o.at!)
    .sort()
  return times[0] ?? post.booking?.for_time ?? post.scheduled_for ?? null
}

/** One square of an Instagram grid preview. */
export type GridTile = { url: string; type: 'image' | 'video' }

type GridPost = {
  id: string
  channels: readonly string[]
  slides: readonly { url: string; type?: string | null }[]
  per_channel: Record<string, { slides?: readonly { url: string; type?: string | null }[] | null } | undefined>
}

/**
 * HOW IT SITS ON THEIR INSTAGRAM (the owner's decision 16): this post's first
 * Instagram picture, then the covers of the eight newest posts already live
 * on Instagram. One builder for the client's review page and the post window.
 * Null when Instagram is not one of the post's channels.
 */
export function instagramGrid(
  post: GridPost,
  others: readonly PostState[],
  platformOf: (accountId: string) => string | null | undefined,
): GridTile[] | null {
  const igOf = (channels: readonly string[]) => channels.find(acc => String(platformOf(acc) ?? '').toLowerCase() === 'instagram') ?? null
  const ig = igOf(post.channels)
  if (!ig) return null
  const own = post.per_channel[ig]?.slides ?? []
  const first = (own.length ? own : post.slides)[0]
  if (!first) return null
  const tile = (s: { url: string; type?: string | null }): GridTile => ({ url: s.url, type: s.type === 'video' ? 'video' : 'image' })
  const live = others
    .filter(p => p.id !== post.id && p.stage === 'posted' && ['published', 'duplicate'].includes(p.outcomes.instagram?.status ?? ''))
    .sort((a, b) => String(postedAt(b) ?? '').localeCompare(String(postedAt(a) ?? '')))
    .slice(0, 8)
    .flatMap(p => {
      const acc = igOf(p.channels)
      const ownSlides = acc ? p.per_channel[acc]?.slides ?? [] : []
      const cover = (ownSlides.length ? ownSlides : p.slides)[0]
      return cover ? [tile(cover)] : []
    })
  return [tile(first), ...live]
}

/**
 * THE ONE LIST OF WHAT IS WAITING ON THE CLIENT (decision 15): every post
 * with them, sent, and still open — the one whose time runs out first on top.
 * A post whose approve-by time has gone is not on it (decision 11).
 */
export function postsWaitingOnClient<P extends PostState>(posts: readonly P[], now: NowLike): P[] {
  const by = (p: PostState) => {
    const t = new Date(approveByOf(p) ?? '').getTime()
    return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER
  }
  return posts
    .filter(p => clientPostView(p, now)?.canAnswer === true)
    .sort((a, b) => by(a) - by(b) || a.id.localeCompare(b.id))
}

/** The posts with the client whose approve-by time went while they waited. */
export function postsMissedByClient<P extends PostState>(posts: readonly P[], now: NowLike): P[] {
  return posts.filter(p => clientPostView(p, now)?.state === 'missed')
}

/* ── the frozen version ─────────────────────────────────────────────────── */

/** A `post_versions` row, as the portal reads it. */
export type FrozenPost = {
  n: number
  slides: Slide[]
  /** per network (by account id): its own kind and its own files, when it has them */
  per_channel: Record<string, { kind: string | null; slides: Slide[] }>
  channels: string[]
  caption: string
  scheduled_for: string | null
  timezone: string | null
  /** frozen by the migration, not at a send — the page says so */
  from_migration: boolean
}

const asObj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null

/** Read a raw `post_versions` row (or, for a live post never frozen, the post's own row). Null when there is none. */
export function readFrozenPost(row: Record<string, unknown> | null | undefined): FrozenPost | null {
  if (!row) return null
  const n = typeof row.n === 'number' ? row.n : typeof row.sent_version === 'number' ? row.sent_version : 0
  const per: FrozenPost['per_channel'] = {}
  for (const [acc, raw] of Object.entries(asObj(row.per_channel) ?? {})) {
    const r = asObj(raw) ?? {}
    per[acc] = { kind: typeof r.kind === 'string' ? r.kind : null, slides: normaliseSlides(r.slides) }
  }
  const rawChannels = Array.isArray(row.channels) ? row.channels : Object.values(asObj(row.channels) ?? {})
  return {
    n,
    slides: normaliseSlides(row.slides),
    per_channel: per,
    channels: rawChannels.filter((x): x is string => typeof x === 'string' && !!x),
    caption: typeof row.caption === 'string' ? row.caption : '',
    scheduled_for: typeof row.scheduled_for === 'string' && row.scheduled_for ? row.scheduled_for : null,
    timezone: typeof row.timezone === 'string' && row.timezone ? row.timezone : null,
    from_migration: row.from_migration === true,
  }
}

/**
 * EVERY FILE THE CLIENT IS ASKED ABOUT, once each: the post's shared files,
 * then any a network has of its own (Instagram's ten beside LinkedIn's
 * fourteen). A note is pinned to a file by its address, so it can be left on
 * any of them (decision 9).
 */
export function reviewFiles(v: Pick<FrozenPost, 'slides' | 'per_channel' | 'channels'>): Slide[] {
  const seen = new Set<string>()
  const out: Slide[] = []
  const add = (s: Slide) => { if (!seen.has(s.url)) { seen.add(s.url); out.push(s) } }
  v.slides.forEach(add)
  for (const acc of v.channels) (v.per_channel[acc]?.slides ?? []).forEach(add)
  return out
}

/** "Carousel · 14 slides", "Reel", "Photo post" — what it is, in one line. */
export function postTypeLine(files: readonly { type?: string | null }[], kinds: readonly (string | null)[] = []): string {
  const n = files.length
  const allVideo = n > 0 && files.every(f => f.type === 'video')
  const kind = kinds.find(k => !!k) ?? null
  const word = kind === 'reel' ? 'Reel' : kind === 'story' ? 'Story'
    : allVideo ? (n > 1 ? 'Videos' : 'Video') : n > 1 ? 'Carousel' : 'Photo post'
  return n > 1 ? `${word} · ${n} ${allVideo ? 'clips' : 'slides'}` : word
}

/* ── notes on a post: per file, the client's thread only ────────────────── */

/** One note as the client reads it. `file_url` null = the whole post. */
export type PortalPostNote = {
  id: string
  created_at: string
  body: string
  author_name: string
  from_team: boolean
  file_url: string | null
}

type NoteRow = {
  id: string; post_id?: string | null; version?: number | null; visibility?: string | null; file_url?: string | null
  body?: string | null; author_name?: string | null; author_role?: string | null; created_at?: string | null
}

/**
 * THE CLIENT'S THREAD ON ONE VERSION (decision 9, audit P10). Only
 * `post_comments` in the Client thread — never a team note, never the edit's
 * `item_comments` — and only this version's, oldest first.
 */
export function clientPostNotes(rows: readonly NoteRow[], postId: string, version: number | null, clientName: string): PortalPostNote[] {
  return rows
    .filter(r => r.post_id === postId && commentVisibleTo(r, 'client') && (version == null || r.version == null || r.version === version))
    .map(r => {
      const fromTeam = String(r.author_role ?? 'client') !== 'client'
      const name = String(r.author_name ?? '').trim()
      return {
        id: r.id,
        created_at: String(r.created_at ?? ''),
        body: String(r.body ?? ''),
        author_name: fromTeam ? (name || 'MD Media') : (name || clientName),
        from_team: fromTeam,
        file_url: r.file_url ?? null,
      }
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** May the client leave a note on this file of this post? Only while it is theirs to answer, only on a file it has. */
export function clientMayNote(view: ClientPostView | null, files: readonly { url: string }[], fileUrl: string | null): boolean {
  if (!view?.canAnswer) return false
  return fileUrl == null || files.some(f => f.url === fileUrl)
}

/* ── addresses ──────────────────────────────────────────────────────────── */

/** THE ONE LINK (decision 15): everything waiting on the client, on one page. (One post's own page is
 *  `portalPostHref` in post-page-core — its review while it is with them, what became of it after.) */
export function portalWaitingPath(token: string): string {
  return `/portal/${encodeURIComponent(token)}/posts`
}

/* ── the edit's card, now that its posts speak for themselves ───────────── */

type PieceRow = { status?: string | null; client_round?: unknown; client_rounds?: unknown }

/** Did the client have a round of this EDIT on their portal? */
export function clientHadEdit(i: PieceRow): boolean {
  return !!(i.client_round || (Array.isArray(i.client_rounds) && i.client_rounds.length > 0))
}

/**
 * HAS THIS PIECE REACHED THE CLIENT? Only then does it carry media, a link, a
 * caption or a thread (audit P7, P8): at their review, after their notes,
 * once they had a round of it, or once it is live. An edit the team approved
 * and never sent them is theirs to see only when its post is.
 */
export function pieceReachedClient(i: PieceRow): boolean {
  const status = String(i.status ?? '')
  if (status === 'client_review' || status === 'client_changes_requested' || status === 'published') return true
  if (status === 'approved_for_scheduling' || status === 'scheduled') return clientHadEdit(i)
  return false
}

/**
 * WHERE THE EDIT'S CARD SITS once the edit is approved (the posting rebuild).
 * Past the edit a piece is its POSTS, each by its own stage, so the edit's
 * card steps aside ('checking' is not drawn) — except when the client
 * approved the edit and no post of it is theirs to see yet, when it says what
 * is true: the team is getting the post ready. A piece with no post at all
 * (from before posts existed) keeps its own status, but only once it reached
 * them. Null: the edit's own column applies.
 */
export function pieceFace(
  i: PieceRow, status: ItemStatus, visiblePosts: number, hasPosts: boolean,
): { column: PortalColumnKey; tone: PortalCardTone | undefined; line: string | null } | null {
  if (status !== 'approved_for_scheduling' && status !== 'scheduled' && status !== 'published') return null
  const hidden = { column: 'checking' as const, tone: undefined, line: null }
  if (hasPosts) {
    if (visiblePosts === 0 && status === 'approved_for_scheduling' && clientHadEdit(i)) {
      return { column: 'approved', tone: 'green', line: 'You approved this — the team is getting the post ready.' }
    }
    return hidden
  }
  return pieceReachedClient({ ...i, status }) ? null : hidden
}
