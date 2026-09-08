/**
 * EVERYTHING WAITING ON A DECISION, IN ONE LIST.
 *
 * The Scheduler board says where every card IS. It does not say which of them
 * are stuck on somebody, and the five or six that are sit scattered across
 * five columns — found by hunting, answered one card at a time. This is the
 * pure half of the list that sits above the board: which cards qualify, what
 * each row says, and which of the two answers this viewer may actually give.
 *
 * NOTHING NEW IS FETCHED and nothing here decides what is LEGAL. Every row is
 * read off a board card the page already holds, and every action comes from
 * the same two places the board's buttons come from — `cardActions`
 * (`workflow-core`'s transitions) and `postApprovalOffer`
 * (`posting-approval-core`'s gate). A row therefore never offers a button the
 * server would refuse; where the viewer may not act, the row says who it is
 * with and offers nothing.
 *
 * The four ways something can be waiting, all four read off the item row:
 *
 *   1. `posting_approval_state === 'pending'` — a POST was sent for its final
 *      sign-off. On this viewer when they may approve it; otherwise the row
 *      names whose it is (the client, or an account manager).
 *   2. a card at `internal_review` / `revision_complete` /
 *      `client_changes_requested` whose turn is this viewer's (`whoseTurn`,
 *      which already answers "somebody was asked" before it answers "your
 *      role") — the manager's check.
 *   3. a card at `client_review` — waiting on the CLIENT. Shown, never
 *      actionable here: the answer is the client's to give, in the portal.
 *   4. `asked_ids` names this person on anything else — they were asked, so
 *      it is theirs whatever the status says (`asked-core`).
 *
 * No I/O, no React, no clock: `today` is passed in.
 */

import {
  askedIdsOf, ASKED_VERB,
} from './asked-core'
import {
  cardActions, postApprovalOffer, postWaitingLine, shortDate,
  POST_WAITING_CLIENT, POST_WAITING_LINE,
  type BoardViewCard, type BoardViewer, type CardAction,
} from './board-view-core'
import { parseApprovalState } from './posting-approval-core'
import { STATUS_TURN, whoseTurn, type ItemStatus } from './workflow-core'

/** What sort of wait a row is — the four above, in the order they outrank. */
export type WaitingKind = 'post' | 'check' | 'client' | 'asked'

/** Whose answer the row is stuck on. */
export type WaitingWho = 'you' | 'client' | 'manager'

/** Where a press on the row goes. A card opens beside the board; a post opens
 *  the composer on its own preview, which is where the words and the pictures
 *  being approved actually are. */
export type WaitingOpen =
  | { kind: 'card'; id: string }
  | { kind: 'post'; href: string }

export type WaitingRow = {
  /** the item's id — a row is one card, however many ways it is waiting */
  id: string
  clientId: string
  /** the client's name, for the tinted chip */
  client: string
  title: string
  kind: WaitingKind
  /** what is being asked and who it waits on, in one plain line */
  line: string
  /** "since Tuesday" — null when nothing dates it */
  since: string | null
  /** true when THIS viewer is the one holding it up */
  onYou: boolean
  who: WaitingWho
  /** the answers this viewer may actually give — empty on an informational row */
  actions: CardAction[]
  open: WaitingOpen
  /** the stamp the sort uses; never shown */
  stamp: string | null
}

/* ── when ──────────────────────────────────────────────────────────────── */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The `YYYY-MM-DD` day of an ISO stamp, or null when it is not one. */
function dayOf(stamp: string | null | undefined): string | null {
  const day = String(stamp ?? '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
  return Math.round((b - a) / 86_400_000)
}

/**
 * "since today" · "since yesterday" · "since Tuesday" · "since 3 Sep".
 *
 * A weekday name only inside the week it still names one day: past six days
 * "Tuesday" stops meaning anything and the date says it instead. Null when
 * there is no usable stamp, so a row draws nothing rather than "since —".
 */
export function sinceWords(stamp: string | null | undefined, today: string): string | null {
  const day = dayOf(stamp)
  if (!day || !dayOf(today)) return null
  const gap = daysBetween(day, today)
  if (gap < 0) return null // dated in the future: say nothing rather than something odd
  if (gap === 0) return 'since today'
  if (gap === 1) return 'since yesterday'
  if (gap <= 6) {
    const at = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)))
    return `since ${WEEKDAYS[at.getUTCDay()]}`
  }
  const short = shortDate(day)
  return short ? `since ${short}` : null
}

/* ── what each row says ────────────────────────────────────────────────── */

/** The manager's check, worded by the stage it is stuck at. */
export const CHECK_LINES: Partial<Record<ItemStatus, string>> = {
  internal_review: 'Waiting on your check',
  revision_complete: 'The changes are in — waiting on your check',
  client_changes_requested: 'The client asked for changes — waiting on you',
}
export const CHECK_LINE_FALLBACK = 'Waiting on you'
/** A piece sitting with the client for their yes. */
export const CLIENT_LINE = 'Waiting on the client'
/** Somebody asked this person for the next thing, wherever the card sits. */
export const ASKED_LINE_FALLBACK = 'You were asked to take a look'

/** "You were asked to check" / "…to post" — the stage's own verb. */
export function askedLine(status: ItemStatus): string {
  const hat = STATUS_TURN[status]
  return hat ? `You were asked ${ASKED_VERB[hat]}` : ASKED_LINE_FALLBACK
}

/** The statuses whose next move is a decision by the team, not by a client. */
export const CHECK_STATUSES: readonly ItemStatus[] =
  ['internal_review', 'revision_complete', 'client_changes_requested']

/* ── one card, weighed ─────────────────────────────────────────────────── */

/** The composer, opened on this post's own preview — the link the approval
 *  email already sends people to, so both land in the same place. */
export function postHref(clientId: string, itemId: string): string {
  return `/dashboard/social/schedule?client=${encodeURIComponent(clientId)}`
    + `&item=${encodeURIComponent(itemId)}`
}

/** The two answers a card row may carry: the move that is the point, and
 *  sending it back with words. Never a post-approval action — a post waiting
 *  its sign-off is its own row, above. */
function cardAnswers(card: BoardViewCard, viewer: BoardViewer): CardAction[] {
  const { primary, more } = cardActions(card, viewer)
  const out: CardAction[] = []
  if (primary && primary.kind !== 'post_approval') out.push(primary)
  const back = more.find(a => a.kind === 'send_back')
  if (back) out.push(back)
  return out
}

/**
 * Is this card waiting on somebody, and what does its row say?
 *
 * Null for a card nobody is held up by — which is most of the board.
 */
export function waitingRow(
  card: BoardViewCard, viewer: BoardViewer, today: string,
): WaitingRow | null {
  const base = {
    id: card.id,
    clientId: card.client_id,
    client: card.clients?.name ?? 'This client',
    title: card.title,
  }

  // 1. THE POST'S OWN GATE — it outranks the card's stage, because a post
  //    sitting unanswered is somebody else already held up.
  if (parseApprovalState(card.posting_approval_state) === 'pending') {
    const offer = postApprovalOffer(card, viewer)
    const line = offer ? POST_WAITING_LINE : postWaitingLine(card, viewer) ?? POST_WAITING_LINE
    return {
      ...base,
      kind: 'post',
      line,
      since: sinceWords(card.updated_at, today),
      onYou: offer !== null,
      who: offer !== null ? 'you' : line === POST_WAITING_CLIENT ? 'client' : 'manager',
      // NO INLINE ANSWER on a post (8 Sep 2026): the yes, the change and
      // "send to the client" are pressed in the composer on Schedule, with
      // the frames in front of the person. The row is the way there.
      actions: [],
      open: { kind: 'post', href: postHref(card.client_id, card.id) },
      stamp: card.updated_at ?? null,
    }
  }

  const stamp = card.status_changed_at ?? card.updated_at ?? null

  // 2. WITH THE CLIENT — shown so nobody has to remember it, never actionable
  //    here: the yes is the client's to give, in their portal.
  if (card.status === 'client_review') {
    return {
      ...base,
      kind: 'client',
      line: CLIENT_LINE,
      since: sinceWords(stamp, today),
      onYou: false,
      who: 'client',
      actions: [],
      open: { kind: 'card', id: card.id },
      stamp,
    }
  }

  // 3. THE TEAM'S OWN DECISION, and it is this viewer's turn. `whoseTurn`
  //    answers "somebody was asked" before it answers "your role", so a card
  //    asked of one manager is not on the other four's lists.
  const turn = whoseTurn(card.status, card, viewer)
  if (CHECK_STATUSES.includes(card.status) && turn.mine) {
    return {
      ...base,
      kind: 'check',
      line: CHECK_LINES[card.status] ?? CHECK_LINE_FALLBACK,
      since: sinceWords(stamp, today),
      onYou: true,
      who: 'you',
      actions: cardAnswers(card, viewer),
      open: { kind: 'card', id: card.id },
      stamp,
    }
  }

  // 4. ASKED, anywhere else — being asked is being assigned, whatever the
  //    stage. The ask's own timestamp dates this one.
  if (askedIdsOf(card).includes(viewer.id)) {
    return {
      ...base,
      kind: 'asked',
      line: askedLine(card.status),
      since: sinceWords(card.asked_at ?? stamp, today),
      onYou: true,
      who: 'you',
      actions: cardAnswers(card, viewer),
      open: { kind: 'card', id: card.id },
      stamp: card.asked_at ?? stamp,
    }
  }

  return null
}

/**
 * The whole list: every card waiting on somebody, this viewer's own first and
 * the longest wait at the top of each half.
 */
export function waitingRows(
  cards: readonly BoardViewCard[], viewer: BoardViewer, today: string,
): WaitingRow[] {
  const rows: WaitingRow[] = []
  for (const c of cards) {
    const row = waitingRow(c, viewer, today)
    if (row) rows.push(row)
  }
  return rows.sort((a, b) => {
    if (a.onYou !== b.onYou) return a.onYou ? -1 : 1
    // oldest first: the thing somebody has been waiting longest for
    const at = a.stamp ?? ''
    const bt = b.stamp ?? ''
    if (at !== bt) return at < bt ? -1 : 1
    return a.title.localeCompare(b.title)
  })
}

/** How many of these are actually on this person. */
export function countOnYou(rows: readonly WaitingRow[]): number {
  return rows.filter(r => r.onYou).length
}

/**
 * The heading, which is the count — "3 waiting on you". When nothing is on
 * this person but something is still out with somebody else, the heading says
 * that instead of a zero.
 */
export function waitingTitle(rows: readonly WaitingRow[]): string {
  const mine = countOnYou(rows)
  const others = rows.length - mine
  const thing = (n: number) => (n === 1 ? '1' : String(n))
  if (mine === 0 && others === 0) return 'Nothing is waiting'
  if (mine === 0) return `${thing(others)} waiting on someone else`
  const head = `${thing(mine)} waiting on you`
  return others === 0 ? head : `${head} · ${thing(others)} with someone else`
}

/**
 * The two halves: what this person can answer, and what is out with somebody
 * else.
 *
 * A list of twenty rows where five can be answered rebuilds the hunt it was
 * meant to end, so the screen leads with the answerable ones and folds the
 * rest away — present, counted, one press from being read, never in the way.
 */
export function splitWaiting(rows: readonly WaitingRow[]): {
  yours: WaitingRow[]
  others: WaitingRow[]
} {
  return {
    yours: rows.filter(r => r.onYou),
    others: rows.filter(r => !r.onYou),
  }
}

/** What the folded half is called — "2 more, with the client". */
export function othersLabel(others: readonly WaitingRow[]): string {
  if (others.length === 0) return ''
  const withClient = others.every(r => r.who === 'client')
  const who = withClient ? 'with the client' : 'with somebody else'
  return others.length === 1 ? `1 more, ${who}` : `${others.length} more, ${who}`
}

/** The sentence under an empty list — never drawn, since the section hides
 *  itself, but the words exist so a caller that wants them has them. */
export const WAITING_EMPTY = 'Nothing is waiting on a decision.'
