/**
 * WHAT A CARD SHOWS, WHAT A CARD OFFERS, WHAT THE OVERVIEW COUNTS.
 *
 * The three work pages and the Overview all draw the same card and the same
 * five columns (`board-core`). This is the pure half of drawing them: the
 * lines on a card, the one control it carries for this viewer, the status a
 * drop lands on, the LANES each page arranges the columns into, the filters
 * the Overview's tiles link into, and the tiles themselves. No I/O, no React
 * — the pages hand rows in and markup out.
 *
 * Nothing here decides what is LEGAL. Every offer comes from `workflow-core`
 * through `board-core`, exactly as the buttons on the item page do; this file
 * only says how to word it and where to put it.
 */

import { postedLine, readPostedSlides } from './posted-slides-core'
import {
  actingRoles, availableTransitionsAs, presentTransitions, whoseTurn, STATUS_LABELS,
  type ActingViewer, type Hat, type ItemStatus,
} from './workflow-core'
import {
  BOARD_COLUMNS, boardColumn, canMoveTo, columnOf, type BoardColumnKey,
} from './board-core'
import { linkLabel, versionWord } from './card-link-core'
import { askedIdsOf, askedWords, waitingOnViewer } from './asked-core'
import { STATUS_TURN } from './workflow-core'
import {
  awaitsClientPostApproval, mayApprovePost, parseApprovalState,
} from './posting-approval-core'
import type { Role } from './identity-core'

/** Everything a card is drawn from — the row plus its joins. */
export type BoardViewCard = {
  /** true when the card exists only to hold a post made on the Schedule page */
  adhoc_post?: boolean | null
  id: string
  title: string
  status: ItemStatus
  client_id: string
  clients?: { name: string } | null
  work_kinds?: { name: string; slug?: string; color?: string } | null
  link_url?: string | null
  link_kind?: string | null
  /** what needs doing — the requirement, in the manager's words */
  brief?: string | null
  owner_id: string | null
  scheduler_ids?: unknown
  due_date: string | null
  /** the playbook's delivery date: when the final first reached the client */
  delivered_at?: string | null
  current_version_number?: number | null
  /** which of the card's files have gone out (`posted-slides-core`) */
  posted_slides?: unknown
  /** what the manager said needs changing, the last time it was sent back */
  change_note?: string | null
  client_approval_required?: boolean
  /** somebody tagged the viewer here and it is not answered */
  my_open_task?: boolean
  /** the people ASKED for the next thing on this card, when anybody was
   *  (`asked-core`). While it is set they are the queue — the Overview and
   *  the "your turn" treatment count the card for them and nobody else. */
  asked_ids?: unknown
  asked_at?: string | null
  /** when the row last changed — every status move bumps it */
  updated_at?: string | null
  /** when the status last changed, on rows that record it separately */
  status_changed_at?: string | null
  /** the FINAL POST's gate (`posting-approval-core`) — a post built from this
   *  piece may be sitting at 'pending' waiting on somebody's yes. It is the
   *  item's own column, so the card gets it for free off a '*' row. */
  posting_approval_state?: unknown
  /** …and whether the CLIENT was the one asked, which decides whose wait the
   *  card names when the viewer is not the one deciding */
  posting_client_required?: unknown
  /** the shoot this card came from (`batch_id`), and its name when the page
   *  has it — an editor is told which shoot's footage this is */
  batch_id?: string | null
  shoot_title?: string | null
  /** THE VIDEO EDITORS SOP: the holder acknowledges a card the day it lands,
   *  and flags a deadline risk the moment they see one. Read off the card's
   *  activity by the page (`card-flag-core.flagsOf`). */
  acknowledged?: boolean
  risk?: string | null
}

/** who is looking: their role, and whether they hold the quality hat */
export type BoardViewer = ActingViewer

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "12 Sep" from a `YYYY-MM-DD` or ISO string — no locale, no clock. */
export function shortDate(iso: string | null | undefined): string | null {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const month = MONTHS[Number(m[2]) - 1]
  if (!month) return null
  return `${Number(m[3])} ${month}`
}

/** Two letters for a person, for the avatar. */
export function initialsOf(name: string | null | undefined): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

export type CardLines = {
  client: string
  title: string
  /** the kind of work, in the team's own word — null when the card has none */
  kind: string | null
  /** where the work lives, with the label the chip wears */
  link: { url: string; label: string } | null
  /** what needs doing, as plain text — null when nobody has said */
  brief: string | null
  /** "2 of 4 posted" while a piece is part-way out; null otherwise */
  posted: string | null
  /** "Sent to client 11 Sept" — the playbook's delivery date, once stamped */
  delivered: string | null
  /** who is holding it: a name, "You", or "Nobody yet" */
  assignee: string
  assigneeId: string | null
  /** "Due 12 Sep", "Due today", "Overdue · 3 Sep" — null when there is no date */
  due: string | null
  /** true when the date has arrived and the card is not posted */
  dueNow: boolean
  /** "version 2" */
  version: string
  /** the stage in words, for a column that holds more than one */
  stage: string
  /** the manager's words on a card that came back — null otherwise */
  changeNote: string | null
  /** "With Divina to check" — who was actually asked, beside who holds it.
   *  Null when nobody was asked in particular. */
  asked: string | null
}

/** The lines on a card, one each. */
export function cardLines(
  card: BoardViewCard,
  opts: { names?: Map<string, string>; today: string; viewerId?: string },
): CardLines {
  const names = opts.names ?? new Map<string, string>()
  const posted = columnOf(card.status) === 'posted'
  const dueKey = card.due_date ? card.due_date.slice(0, 10) : null
  const dueNow = !!dueKey && dueKey <= opts.today && !posted
  const dueText = shortDate(card.due_date)
  const due = !dueText
    ? null
    : dueKey === opts.today
      ? 'Due today'
      : dueNow
        ? `Overdue · ${dueText}`
        : `Due ${dueText}`
  const assignee = !card.owner_id
    ? 'Nobody yet'
    : card.owner_id === opts.viewerId
      ? 'You'
      : names.get(card.owner_id) ?? 'Assigned'
  const cameBack = card.status === 'revision_required' || card.status === 'client_changes_requested'
  return {
    client: card.clients?.name ?? '—',
    title: card.title,
    // an uploaded post is a "Post", whatever kind the upload was filed under
    // — the owner, 8 Sep 2026: "I'm just doing something to get approved,
    // what is this tag Video edit doing there"
    kind: (card as { adhoc_post?: unknown }).adhoc_post === true ? 'Post' : (card.work_kinds?.name ?? null),
    link: card.link_url ? { url: card.link_url, label: linkLabel(card.link_kind) } : null,
    brief: card.brief?.trim() ? card.brief.trim() : null,
    posted: postedLine(readPostedSlides(card.posted_slides)),
    // DELIVERED is the moment the final was sent to the client (the
    // playbook: "that's the moment our obligation is met"), so the card says
    // it in those words and keeps saying it through Ready to post and Posted
    delivered: card.delivered_at && shortDate(card.delivered_at) ? `Sent to client ${shortDate(card.delivered_at)}` : null,
    assignee,
    assigneeId: card.owner_id ?? null,
    due,
    dueNow,
    version: versionWord(card.current_version_number),
    stage: STATUS_LABELS[card.status],
    changeNote: cameBack && card.change_note?.trim() ? card.change_note.trim() : null,
    // "With you to check" rather than your own name back at you
    asked: askedWords(
      card,
      opts.viewerId ? new Map(names).set(opts.viewerId, 'you') : names,
      STATUS_TURN,
    ),
  }
}

/**
 * The one thing a person can DO to a card from the board.
 *
 * `transition` is a plain move through the funnel — one tap, nothing asked.
 * `send_back` is the same move with the one extra the route needs: what to
 * change, asked for on the card rather than on another page.
 *
 * THE CARD NEVER ASKS ANYONE TO POST. A card is a link and what needs doing;
 * the scheduler takes those and does the posting on the Schedule page (or
 * wherever they post). Back on the board the card just moves — Ready to post
 * → Posted — with no channel, no time and no live link asked for. Real
 * posting lives in `/dashboard/social/schedule` and `/api/social/publish`.
 */
export type CardAction =
  | { kind: 'transition'; to: ItemStatus; label: string }
  | { kind: 'send_back'; to: 'revision_required'; label: string }
  | { kind: 'post_approval'; to: 'approve' | 'request_changes'; label: string }

/**
 * A POST WAITING ON THIS PERSON, SAID WHERE THEY ALREADY ARE.
 *
 * `posting_approval_state === 'pending'` used to be reachable only through
 * the email and the bell: the board card and the side panel both drew
 * nothing, so an account manager who came to their work any other way never
 * learnt there was a post to answer. These are the same two answers the
 * composer offers, worded once, and they hit the same route.
 */
export const POST_WAITING_LINE = 'A post is waiting on your OK'
export const POST_APPROVE_LABEL = 'Approve the post'
export const POST_CHANGES_LABEL = 'Ask for a change'
/** …and the same wait, seen by somebody who is not the one deciding. */
export const POST_WAITING_CLIENT = 'A post is waiting on the client'
export const POST_WAITING_MANAGER = 'A post is waiting on an account manager'

/**
 * The one line a card says about a post waiting on somebody — whoever is
 * looking. Null when no post on this card is waiting on anyone.
 */
export function postWaitingLine(
  card: BoardViewCard, viewer: BoardViewer,
): string | null {
  if (parseApprovalState(card.posting_approval_state) !== 'pending') return null
  if (mayApprovePost(actingRoles(viewer, card))) return POST_WAITING_LINE
  return awaitsClientPostApproval({
    status: card.status,
    posting_approval_state: card.posting_approval_state,
    posting_client_required: card.posting_client_required,
  }) ? POST_WAITING_CLIENT : POST_WAITING_MANAGER
}

export type PostApprovalOffer = {
  /** the plain line naming what is waiting */
  line: string
  /** say yes */
  primary: CardAction
  /** …and ask for a change, which needs words with it */
  changes: CardAction
}

/**
 * Is a post on this card waiting on THIS viewer, and what may they do?
 *
 * Null for everybody else — including the people who sent it, who are
 * waiting rather than deciding.
 */
export function postApprovalOffer(
  card: BoardViewCard, viewer: BoardViewer,
): PostApprovalOffer | null {
  if (parseApprovalState(card.posting_approval_state) !== 'pending') return null
  if (!mayApprovePost(actingRoles(viewer, card))) return null
  return {
    line: POST_WAITING_LINE,
    primary: { kind: 'post_approval', to: 'approve', label: POST_APPROVE_LABEL },
    changes: { kind: 'post_approval', to: 'request_changes', label: POST_CHANGES_LABEL },
  }
}

export const SEND_BACK_LABEL = 'Send back for changes'
/** the editor hands a card on: the machine says "Submit for review", the
 *  card says what happens next in the team's own word for the column */
export const READY_FOR_CHECK_LABEL = 'Ready for checking'
/** the scheduler has booked the post in, wherever they post */
export const BOOKED_LABEL = 'Booked in'
/** the post has gone out */
export const POSTED_LABEL = 'Posted'

const isManagerHat = (hats: readonly Hat[]) =>
  hats.includes('account_manager') || hats.includes('super_admin')

/** The action a legal move `to` becomes on the card, for these hats. */
export function actionFor(to: ItemStatus, label: string, hats: readonly Hat[]): CardAction {
  // a manager sending work back says what to change — the send-back route
  // asks for the words and tells the assignee; "Log the client's changes"
  // from With client is the first half of that same route
  if ((to === 'revision_required' || to === 'client_changes_requested') && isManagerHat(hats)) {
    return { kind: 'send_back', to: 'revision_required', label: SEND_BACK_LABEL }
  }
  // the machine's words are "Submit for review" / "Mark scheduled" / "Mark
  // published"; on the card each move is said as the fact it records
  if (to === 'internal_review') return { kind: 'transition', to, label: READY_FOR_CHECK_LABEL }
  if (to === 'scheduled') return { kind: 'transition', to, label: BOOKED_LABEL }
  if (to === 'published') return { kind: 'transition', to, label: POSTED_LABEL }
  return { kind: 'transition', to, label }
}

const sameAction = (a: CardAction, b: CardAction) => a.kind === b.kind && a.to === b.to

/**
 * The control a card carries for this viewer: one obvious button, and the
 * rest behind "More". Uses the transitions that already exist — nothing a
 * button on the item page would not offer.
 */
export function cardActions(
  card: BoardViewCard, viewer: BoardViewer,
): { primary: CardAction | null; more: CardAction[] } {
  const hats = actingRoles(viewer, card)
  const offered = availableTransitionsAs(hats, card.status)
  const turn = whoseTurn(card.status, card, viewer)
  const { primary, secondary } = presentTransitions(hats, card.status, offered, {
    clientApprovalRequired: card.client_approval_required !== false,
    // an unasked check is nobody's TURN, but the button still belongs to
    // whoever wears the hat: a manager can always pick the empty seat up
    viewerHoldsTurn: turn.mine || (turn.unassigned && turn.may),
  })
  const all: CardAction[] = []
  const push = (a: CardAction) => { if (!all.some(b => sameAction(a, b))) all.push(a) }
  // a post waiting on THIS person outranks any move: it is the one thing on
  // the card that somebody else is held up by
  const waiting = postApprovalOffer(card, viewer)
  const first = waiting
    ? waiting.primary
    : primary ? actionFor(primary.to, primary.label, hats) : null
  if (first) push(first)
  if (waiting) push(waiting.changes)
  if (waiting && primary) push(actionFor(primary.to, primary.label, hats))
  for (const s of secondary) push(actionFor(s.to, s.label, hats))
  // AN UPLOADED POST IS BOOKED ON THE SCHEDULE PAGE and marked posted one
  // file at a time ("Posted by hand"): a whole-card "Booked in" was a 400
  // (no schedule row) or a lie (one of five files booked), and a whole-card
  // "Posted" contradicted the "2 of 5 posted" chip (the audit of 9 Sep 2026)
  const adhoc = (card as { adhoc_post?: unknown }).adhoc_post === true
  const kept = adhoc ? all.filter(a => !(a.kind === 'transition' && (a.to === 'scheduled' || a.to === 'published'))) : all
  // with no filled button, the face shows the constructive answer, not the
  // destructive one: "Log the client's approval" before "Send back for
  // changes" (the audit of 10 Sep 2026)
  const constructive = (a: CardAction) => !(a.kind === 'send_back' || (a.kind === 'transition' && a.to === 'revision_required'))
  const head = first === null ? null : kept.includes(first) ? first : (kept.find(constructive) ?? kept[0] ?? null)
  // the card draws the first of `more` on its face when there is no filled
  // button, so the constructive answers come first in it
  const rest = kept.filter(a => a !== head)
  const more = [...rest.filter(constructive), ...rest.filter(a => !constructive(a))]
  return { primary: head, more }
}

export type DropDecision =
  | { ok: true; action: CardAction; column: BoardColumnKey }
  | { ok: false; reason: string }

/** What a drop onto a column does — the same status a button would reach,
 *  or the machine's plain reason it cannot. */
export const NEEDS_CLIENT_REASON = "This card needs the client's approval first"
export const ADHOC_MOVE_REASON = 'An uploaded post is booked from the Schedule page, and marked posted one file at a time'

/**
 * A card that needs the client cannot be approved past them by a drag any
 * more than by a button — `presentTransitions` hides that button, and this
 * is the same rule for the board.
 */
function needsClientFirst(card: BoardViewCard, to: ItemStatus): boolean {
  return to === 'approved_for_scheduling'
    && card.status !== 'client_review'
    && card.client_approval_required !== false
}

/**
 * A manager dragging a With-client card back to Internal check is sending it
 * back: the machine has no single edge for that (the client's changes are
 * logged first, then the card is sent for revision), but the send-back route
 * walks both steps, so the board offers it as the one move it is.
 */
function sendBackFromClient(card: BoardViewCard, column: BoardColumnKey, hats: readonly Hat[]): boolean {
  return column === 'internal_check' && card.status === 'client_review' && isManagerHat(hats)
}

export function dropAction(card: BoardViewCard, column: BoardColumnKey, viewer: BoardViewer): DropDecision {
  const hats = actingRoles(viewer, card)
  if (sendBackFromClient(card, column, hats)) {
    return { ok: true, action: actionFor('revision_required', SEND_BACK_LABEL, hats), column }
  }
  const d = canMoveTo({ status: card.status }, column, hats)
  if (!d.ok) return { ok: false, reason: d.reason }
  if (needsClientFirst(card, d.to)) return { ok: false, reason: NEEDS_CLIENT_REASON }
  // the same rule `cardActions` keeps: an uploaded post is booked on the
  // Schedule page and marked posted one file at a time — a drag or a "Move
  // to" was still offering the whole-card press (the audit of 10 Sep 2026)
  if ((card as { adhoc_post?: unknown }).adhoc_post === true && (d.to === 'scheduled' || d.to === 'published')) {
    return { ok: false, reason: ADHOC_MOVE_REASON }
  }
  return { ok: true, action: actionFor(d.to, d.label, hats), column }
}

/** The keyboard's version of the drag: every column this card may go to,
 *  worded as "Move to With client — Send to client". */
export function moveTargets(
  card: BoardViewCard, viewer: BoardViewer,
): { column: BoardColumnKey; label: string; action: CardAction }[] {
  const out: { column: BoardColumnKey; label: string; action: CardAction }[] = []
  for (const c of BOARD_COLUMNS) {
    const d = dropAction(card, c.key, viewer)
    if (d.ok) out.push({ column: c.key, label: `Move to ${c.label} — ${d.action.label}`, action: d.action })
  }
  return out
}

export type BoardPage = 'production' | 'editor' | 'scheduler'

/** Is this card assigned to this person — to make, or to post? */
export function isAssignedTo(card: BoardViewCard, viewerId: string): boolean {
  if (card.owner_id === viewerId || card.my_open_task === true) return true
  const ids = Array.isArray(card.scheduler_ids) ? card.scheduler_ids.map(String) : []
  return ids.includes(viewerId)
}

/** How long a posted card stays on the board, in days. */
export const POSTED_DAYS = 14

/** `YYYY-MM-DD` shifted by `days` — no clock, no zone. */
function shiftDay(key: string, days: number): string {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return key
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)).toISOString().slice(0, 10)
}

/**
 * Is this card still board work — not posted, or posted within the last
 * `days`?
 *
 * A board is what is happening now, not the archive: a card that went out a
 * month ago is still a record — on the client's page, on its own page by
 * link, in search — but it leaves Posted so the column says what went out
 * lately. The moment counted is the status change when the row records one,
 * else the row's last update (every move bumps it). A posted card with no
 * timestamp at all stays: nothing is hidden on a guess.
 */
export function recentlyPosted(
  card: Pick<BoardViewCard, 'status' | 'updated_at' | 'status_changed_at'>, today: string, days = POSTED_DAYS,
): boolean {
  if (columnOf(card.status) !== 'posted') return true
  const stamp = card.status_changed_at ?? card.updated_at
  const day = typeof stamp === 'string' ? stamp.slice(0, 10) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return true
  return day >= shiftDay(today, -days)
}

/**
 * THE CARDS A PAGE SHOWS — and nobody is left with work they cannot see.
 *
 * Production is every card the person may see. Scheduler is the same set —
 * the whole flow, so the scheduler sees what is coming — and its lanes say
 * what is ready. Editor is the cards assigned to the viewer (an editor's
 * whole world) — or, for a manager looking in, everything still being made.
 * Assigned means shown, whatever the kind.
 *
 * On every page, Posted keeps only what went out in the last `POSTED_DAYS`
 * (`recentlyPosted`); older posts are records, not board work. Pass `today`
 * to apply the cut — nothing here reads a clock, so without a date nothing
 * is cut.
 */
export function pageCards<T extends BoardViewCard>(
  page: BoardPage, cards: readonly T[], viewer: BoardViewer, today?: string | null,
): T[] {
  const mine = (c: T) => isAssignedTo(c, viewer.id)
  /**
   * Media uploaded straight onto the Schedule page to be posted is a POST,
   * not production work — it keeps its card for the file and the numbers,
   * and stays off all three boards.
   *
   * ONE EXCEPTION, and only on the Scheduler board: a post on such a card
   * that is waiting on THIS person's yes. The gate is reachable from the
   * bell and the email, and from nowhere else; a manager who works from the
   * board would otherwise be holding somebody up with nothing on any screen
   * to press. It leaves again the moment they answer.
   */
  // Media uploaded straight onto the Schedule page is a POST, not production
  // work, so it stays off these boards — EXCEPT while it is waiting on a
  // person. A scheduler's upload goes to internal check for a manager, and
  // hiding it there meant the thing needing a decision appeared nowhere at
  // all: not in Draft, not in Internal check, not in anyone's list. It shows
  // while it waits, and leaves again the moment it is answered.
  //
  // THE FINAL SHAPE (8 Sep 2026): a piece uploaded for posting lives on the
  // POST APPROVAL board — every column, from the scheduler's Draft through
  // the manager's Internal check and the client's With client to Ready to
  // post and Posted — and on no other board. Production and Editor are for
  // production work, which it is not.
  const work = (c: T) => (c as { adhoc_post?: unknown }).adhoc_post !== true || page === 'scheduler'
  const fresh = (c: T) => work(c) && (!today || recentlyPosted(c, today))
  if (page === 'editor') {
    // a general user's Editor page is their own cards too — the making is
    // theirs, the checking is the manager's
    if (viewer.role === 'editor' || viewer.role === 'general') return cards.filter(c => mine(c) && fresh(c))
    // a manager on the Editor page sees the making, not the posting
    return cards.filter(c => fresh(c)
      && (mine(c) || (columnOf(c.status) !== 'ready_to_post' && columnOf(c.status) !== 'posted')))
  }
  return cards.filter(fresh)
}

/** A lane is one column, or several columns folded into one narrow strip. */
export type PageLaneKey = BoardColumnKey | 'done' | 'coming_up'

/** What is NOT in a lane, in the lane's own words. */
export const LANE_EMPTY: Record<PageLaneKey, string> = {
  draft: 'Nothing being made.',
  internal_check: 'Nothing waiting on a check.',
  quality_check: 'Nothing waiting on a quality check.',
  with_client: 'Nothing with a client.',
  ready_to_post: 'Nothing ready to post.',
  posted: 'Nothing booked in or posted.',
  done: 'Nothing done yet.',
  coming_up: 'Nothing coming up.',
}

/** The five columns' own empty sentences — the Production list draws them too. */
export const COLUMN_EMPTY: Record<BoardColumnKey, string> = {
  draft: LANE_EMPTY.draft,
  internal_check: LANE_EMPTY.internal_check,
  quality_check: LANE_EMPTY.quality_check,
  with_client: LANE_EMPTY.with_client,
  ready_to_post: LANE_EMPTY.ready_to_post,
  posted: LANE_EMPTY.posted,
}

/** The line under Posted: where the cards that left the board went. */
export const OLDER_POSTS_NOTE = "Older posts are on the client's page."

export type PageLane = {
  key: PageLaneKey
  /** what the lane is called on screen */
  label: string
  /** the columns inside, in board order */
  columns: BoardColumnKey[]
  /** a folded lane is narrow, its cards compact, and it collapses to a rail */
  folded: boolean
  /** what is NOT here, in the lane's own words */
  empty: string
}

const laneOfColumn = (key: BoardColumnKey): PageLane => ({
  key, label: boardColumn(key).label, columns: [key], folded: false, empty: LANE_EMPTY[key],
})

/**
 * THE EDITOR'S OWN NAMES FOR THE SAME COLUMNS (the Video Editors SOP: In
 * Progress → For Review → For Handoff → Done). The columns, the statuses
 * and the moves are identical to every other page; only the words on the
 * lane headers change, so an editor reads their SOP on their own board and
 * a manager looking at the same card sees it in the same place.
 */
export const EDITOR_LANE_LABELS: Partial<Record<BoardColumnKey, string>> = {
  draft: 'In progress',
  internal_check: 'For review',
  quality_check: 'Quality check',
  with_client: 'With client',
  ready_to_post: 'For handoff',
  posted: 'Done',
}

/**
 * HOW EACH PAGE ARRANGES THE FIVE COLUMNS.
 *
 * The five stages are one board — the same card is in the same column on
 * every screen — but a page gives room to the stages its person works and
 * FOLDS the rest into one narrow lane, rather than drawing three columns
 * that sit empty for them:
 *
 * - Production: all five, one lane each.
 * - Editor: Draft · Internal check · With client, then "Done" — every card
 *   in Ready to post or Posted, folded.
 * - Scheduler: "Coming up" — every card in Draft, Internal check or With
 *   client, folded — then Ready to post · Posted.
 *
 * A folded lane is a real drop target (`dropOnLane`), and its cards wear the
 * stage chip because it always holds more than one stage.
 */
export function pageLanes(page: BoardPage): PageLane[] {
  // FIVE COLUMNS ON EVERY PAGE — the owner's standing rule, and the spec's.
  // Work needs an internal check and the client's word whoever is looking at
  // it, so no page hides those stages: an editor watches their card go to the
  // client and out the door, a scheduler sees what is coming before it is
  // ready. What differs per page is WHICH CARDS are shown (pageCards) and
  // which button each role gets, never which stages exist.
  const lanes = BOARD_COLUMNS.map(c => laneOfColumn(c.key))
  if (page !== 'editor') return lanes
  return lanes.map(l => ({
    ...l,
    label: EDITOR_LANE_LABELS[l.key as BoardColumnKey] ?? l.label,
    // the editor's part is done once the card is handed on: Done is a
    // narrow rail, not a working column
    folded: l.key === 'posted',
  }))
}

/** The lane a column sits in on this page — how a `?column=` link lands. */
export function laneOf(page: BoardPage, column: BoardColumnKey): PageLaneKey {
  return pageLanes(page).find(l => l.columns.includes(column))!.key
}

/** Group cards by lane, every lane present (empty arrays included), in
 *  board order. Input order within a lane is preserved. */
export function groupByLane<T extends { status: ItemStatus }>(
  lanes: readonly PageLane[], cards: readonly T[],
): { lane: PageLane; cards: T[] }[] {
  const buckets = new Map<PageLaneKey, T[]>(lanes.map(l => [l.key, []]))
  const laneByColumn = new Map<BoardColumnKey, PageLaneKey>(
    lanes.flatMap(l => l.columns.map((c): [BoardColumnKey, PageLaneKey] => [c, l.key])))
  for (const card of cards) {
    const key = laneByColumn.get(columnOf(card.status))
    if (key) buckets.get(key)!.push(card)
  }
  return lanes.map(l => ({ lane: l, cards: buckets.get(l.key)! }))
}

export type LaneDropDecision =
  | { ok: true; action: CardAction; column: BoardColumnKey; lane: PageLaneKey }
  | { ok: false; reason: string }

/**
 * What a drop onto a LANE does. A one-column lane is that column's drop. A
 * folded lane means "move to the FIRST stage inside it the rules allow", in
 * board order — the same `dropAction` the columns use, tried in turn. When
 * none is allowed the refusal is plain words: "Already in Done" when the
 * card sits in the lane already (dropping it where it is), else the first
 * column's own reason.
 */
export function dropOnLane(card: BoardViewCard, lane: PageLane, viewer: BoardViewer): LaneDropDecision {
  let reason: string | null = null
  for (const column of lane.columns) {
    const d = dropAction(card, column, viewer)
    if (d.ok) return { ok: true, action: d.action, column, lane: lane.key }
    if (reason === null) reason = d.reason
  }
  if (lane.columns.includes(columnOf(card.status))) return { ok: false, reason: `Already in ${lane.label}` }
  return { ok: false, reason: reason ?? `Already in ${lane.label}` }
}

/** The lanes on this page a drag may land on right now. */
export function reachableLanes(page: BoardPage, card: BoardViewCard, viewer: BoardViewer): PageLaneKey[] {
  return pageLanes(page).filter(l => dropOnLane(card, l, viewer).ok).map(l => l.key)
}

/**
 * The lens an Overview tile opens the board through. A tile never shows a
 * number without a way to act on it, so each count is also a filter here.
 */
export type ShowFilter = 'mine' | 'due' | 'back' | 'decide' | 'today' | 'account'

export const SHOW_FILTERS: readonly ShowFilter[] = ['mine', 'due', 'back', 'decide', 'today', 'account']

export function isShowFilter(v: unknown): v is ShowFilter {
  return typeof v === 'string' && (SHOW_FILTERS as readonly string[]).includes(v)
}

/** What the board says it is showing, in a few words. */
export const SHOW_LABELS: Record<ShowFilter, string> = {
  mine: 'Assigned to you',
  due: 'Due now',
  back: 'Came back for changes',
  decide: 'Needs your decision',
  today: 'Going out today',
  account: 'Waiting on an account',
}

export const DECIDE_STATUSES: readonly ItemStatus[] = ['internal_review', 'revision_complete', 'client_changes_requested']
/** a check with nobody named: on the board's lens, but on nobody's "yours" count */
export function nobodyAskedYet(card: BoardViewCard): boolean {
  return askedIdsOf(card as never).length === 0
}
export const CAME_BACK_STATUSES: readonly ItemStatus[] = ['revision_required', 'client_changes_requested']

export type ShowContext = {
  viewer: BoardViewer
  today: string
  /** ids of cards with a post going out today */
  postingToday?: ReadonlySet<string>
  /** clients with at least one connected channel */
  connectedClientIds?: ReadonlySet<string>
}

/** Does this card pass the filter? */
export function matchesShow(card: BoardViewCard, show: ShowFilter, ctx: ShowContext): boolean {
  switch (show) {
    case 'mine': return card.owner_id === ctx.viewer.id
    case 'due': {
      const key = card.due_date ? card.due_date.slice(0, 10) : null
      return !!key && key <= ctx.today && columnOf(card.status) !== 'posted'
    }
    case 'back': return CAME_BACK_STATUSES.includes(card.status)
    // "Needs your decision" means YOURS. When somebody was asked in
    // particular, the card is on their list and on nobody else's; with
    // nobody asked, every manager on the client is still the audience, as
    // before (`waitingOnViewer`).
    case 'decide':
      return DECIDE_STATUSES.includes(card.status) && waitingOnViewer(card, ctx.viewer.id)
    case 'today': return ctx.postingToday?.has(card.id) ?? false
    case 'account':
      return card.status === 'approved_for_scheduling'
        && !(ctx.connectedClientIds?.has(card.client_id) ?? false)
  }
}

export function applyShow<T extends BoardViewCard>(cards: readonly T[], show: ShowFilter | null, ctx: ShowContext): T[] {
  if (!show) return [...cards]
  return cards.filter(c => matchesShow(c, show, ctx))
}

/** The address of a board, opened on a column or through a filter. */
export function boardHref(
  page: 'production' | 'editor' | 'scheduler',
  opts: { column?: BoardColumnKey; show?: ShowFilter } = {},
): string {
  const params = new URLSearchParams()
  if (opts.column) params.set('column', opts.column)
  if (opts.show) params.set('show', opts.show)
  const q = params.toString()
  return `/dashboard/${page}${q ? `?${q}` : ''}`
}

/** One tile on the Overview: a title, a tone, some numbers, one link. */
export type OverviewTile = {
  key: string
  title: string
  tone: 'amber' | 'blue' | 'green' | 'paper'
  href: string
  actionLabel: string
  stats: { value: number | string; label: string }[]
}

export type OverviewInput = {
  viewer: BoardViewer
  /** the cards this person may see — assets only, already scoped */
  cards: readonly BoardViewCard[]
  today: string
  postingToday?: ReadonlySet<string>
  connectedClientIds?: ReadonlySet<string>
  clientCount?: number
  leadsWeek?: number
  mayLeads?: boolean
}

const count = (cards: readonly BoardViewCard[], pred: (c: BoardViewCard) => boolean) =>
  cards.filter(pred).length

/**
 * "What is on me today", per role. Every tile links into the cards it counts.
 */
export function overviewTiles(input: OverviewInput): OverviewTile[] {
  const { viewer, cards, today } = input
  const ctx: ShowContext = {
    viewer, today, postingToday: input.postingToday, connectedClientIds: input.connectedClientIds,
  }
  const inColumn = (key: BoardColumnKey) => count(cards, c => columnOf(c.status) === key)

  if (viewer.role === 'editor') {
    const mine = cards.filter(c => matchesShow(c, 'mine', ctx))
    return [
      {
        key: 'assigned', title: 'Assigned to you', tone: 'green',
        href: boardHref('editor'), actionLabel: 'Editor',
        stats: [{ value: count(mine, c => columnOf(c.status) !== 'posted'), label: 'to work on' }],
      },
      {
        key: 'due', title: 'Due now', tone: 'amber',
        href: boardHref('editor', { show: 'due' }), actionLabel: 'See them',
        stats: [{ value: count(mine, c => matchesShow(c, 'due', ctx)), label: 'due today or overdue' }],
      },
      {
        key: 'back', title: 'Came back for changes', tone: 'paper',
        href: boardHref('editor', { show: 'back' }), actionLabel: 'See them',
        stats: [{ value: count(mine, c => matchesShow(c, 'back', ctx)), label: 'to change' }],
      },
    ]
  }

  if (viewer.role === 'scheduler') {
    return [
      {
        key: 'ready', title: 'Ready to post', tone: 'green',
        href: boardHref('scheduler', { column: 'ready_to_post' }), actionLabel: 'Scheduler',
        // a post somebody was asked to book in is theirs to book in; with
        // nobody asked, the column is still the whole queue
        stats: [{
          value: count(cards, c => columnOf(c.status) === 'ready_to_post' && waitingOnViewer(c, viewer.id)),
          label: 'to book in',
        }],
      },
      {
        key: 'today', title: 'Going out today', tone: 'blue',
        href: boardHref('scheduler', { show: 'today' }), actionLabel: 'See them',
        stats: [{ value: count(cards, c => matchesShow(c, 'today', ctx)), label: 'posting today' }],
      },
      {
        key: 'account', title: 'Waiting on an account', tone: 'amber',
        href: boardHref('scheduler', { show: 'account' }), actionLabel: 'See them',
        stats: [{ value: count(cards, c => matchesShow(c, 'account', ctx)), label: 'with no channel connected' }],
      },
    ]
  }

  // HONEST COUNTS (the owner, 11 Sep 2026): a check nobody was asked for
  // is not "waiting on you" — it is waiting on somebody, and says so on its
  // own line. The tile still opens the lens that shows both.
  const decide: OverviewTile = {
    key: 'decide', title: 'Needs your decision', tone: 'amber',
    // the deciding board is Post approval: Shoots holds filming days only
    // (the owner, 11 Sep 2026: "it's confusing")
    href: boardHref('scheduler', { show: 'decide' }), actionLabel: 'Decide',
    stats: [
      { value: count(cards, c => matchesShow(c, 'decide', ctx) && !nobodyAskedYet(c)), label: 'waiting on you' },
      { value: count(cards, c => matchesShow(c, 'decide', ctx) && nobodyAskedYet(c)), label: 'nobody asked yet' },
    ],
  }
  // THE QUALITY CHECK, for the people who run it: what is waiting on the
  // quality reviewer, and how much of it nobody was asked to look at
  const quality: OverviewTile = {
    key: 'quality', title: 'Quality check', tone: 'amber',
    href: boardHref('scheduler', { column: 'quality_check' }), actionLabel: 'See them',
    stats: [
      { value: count(cards, c => c.status === 'quality_check'), label: 'waiting on a quality reviewer' },
      { value: count(cards, c => c.status === 'quality_check' && nobodyAskedYet(c)), label: 'not asked to anyone' },
    ],
  }
  const withClients: OverviewTile = {
    key: 'with_client', title: 'With clients', tone: 'blue',
    href: boardHref('scheduler', { column: 'with_client' }), actionLabel: 'See them',
    stats: [{ value: count(cards, c => c.status === 'client_review'), label: 'waiting on a client' }],
  }
  const clients: OverviewTile = {
    key: 'clients', title: 'Your clients', tone: 'green',
    href: '/dashboard/clients', actionLabel: 'Clients',
    stats: [{ value: input.clientCount ?? 0, label: 'you look after' }],
  }

  if (viewer.role === 'super_admin') {
    const tiles: OverviewTile[] = [
      {
        key: 'glance', title: 'The agency at a glance', tone: 'paper',
        href: boardHref('scheduler'), actionLabel: 'Board',
        stats: BOARD_COLUMNS.map(c => ({ value: inColumn(c.key), label: c.label.toLowerCase() })),
      },
      decide, quality, withClients,
    ]
    if (input.mayLeads !== false) {
      tiles.push({
        key: 'leads', title: 'Leads · 7 days', tone: 'green',
        href: '/dashboard/leads', actionLabel: 'Leads',
        stats: [{ value: input.leadsWeek ?? 0, label: 'new leads' }],
      })
    } else {
      tiles.push(clients)
    }
    return tiles
  }

  // account manager
  return [clients, decide, quality, withClients]
}
