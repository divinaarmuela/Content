/**
 * THE SCHEDULE PAGE'S THREE VIEWS — pure, no I/O.
 *
 * There used to be two pages for one job. The Scheduler page held a board and
 * a posting calendar behind its own pills; the Schedule page under Social held
 * the same posting calendar with the composer on it. The same calendar was
 * reachable three ways, and the owner's words for it were "this page will be
 * too confusing".
 *
 * So there is ONE page now — `/dashboard/social/schedule`, the address that is
 * already in emails, notifications and the portal — with three views on its own
 * pill rail:
 *
 *   calendar   the week, the media rail and the composer (what it always was)
 *   board      the five lanes, exactly as the Scheduler page drew them
 *   approvals  everything sitting with a person, in one list
 *
 * This file holds the parts of that which are rules rather than pixels: what
 * the views are called, how one is read off an address, and what counts as
 * "waiting on someone". Nothing here reads a clock, a browser or a database.
 */

import { columnOf, type BoardColumnKey } from './board-core'
import { parseApprovalState } from './posting-approval-core'
import type { ItemStatus } from './workflow-core'

/** The page itself — `SCHEDULE_PAGE` in page-access-core, repeated here so a
 *  pure module can build an address without importing the access model. */
export const SCHEDULE_HREF = '/dashboard/social/schedule'

export const SCHEDULE_VIEWS = ['calendar', 'board', 'approvals'] as const
export type ScheduleView = (typeof SCHEDULE_VIEWS)[number]

/** The view somebody lands on when they have never chosen one: the calendar,
 *  because that is what this address has always opened on. */
export const DEFAULT_SCHEDULE_VIEW: ScheduleView = 'calendar'

/** Where the choice is remembered, per person, in their own browser. */
export const SCHEDULE_VIEW_KEY = 'md-schedule-page-view'

/** Read `?view=` tolerantly: anything we do not recognise is not a view. */
export function parseScheduleView(v: unknown): ScheduleView | null {
  const s = String(v ?? '').trim().toLowerCase()
  return (SCHEDULE_VIEWS as readonly string[]).includes(s) ? (s as ScheduleView) : null
}

/**
 * The address of one view, with anything else the link has to carry.
 *
 * `?view=` is always written out, even for the calendar: a link that means
 * "the calendar" must beat whatever this person looked at last, which is
 * exactly the rule `restoredChoice` applies.
 */
export function scheduleViewHref(
  view: ScheduleView,
  extra: Record<string, string | null | undefined> = {},
): string {
  const params = new URLSearchParams({ view })
  for (const [key, value] of Object.entries(extra)) {
    if (value !== null && value !== undefined && value !== '') params.set(key, value)
  }
  return `${SCHEDULE_HREF}?${params.toString()}`
}

/**
 * The Scheduler page's old addresses, and the view each one meant.
 *
 * `/dashboard/scheduler` was the board; `/dashboard/scheduler/calendar` was
 * the posting calendar. Both are kept as permanent redirects so old links,
 * emails and bookmarks land on the same thing they always did.
 */
export const OLD_SCHEDULER_VIEWS: Record<string, ScheduleView> = {
  '/dashboard/scheduler': 'board',
  '/dashboard/scheduler/calendar': 'calendar',
}

/* ────────────────────────────────────────────────────────────────────────
   APPROVALS — everything waiting on a person.
   ──────────────────────────────────────────────────────────────────────── */

/**
 * What a row is waiting on. Three real, different waits — not three names for
 * one:
 *
 *   post    the POST was sent for sign-off: the words, the picture and the
 *           hour, as they would go out. Opens the composer on its preview.
 *   client  the WORK is with the client — they are reading it, or they asked
 *           for a change. Opens the card.
 *   check   the work is waiting on somebody here to check it. Opens the card.
 */
export type ApprovalKind = 'post' | 'client' | 'check'

export type ApprovalItem = {
  id: string
  client_id?: string | null
  title?: string | null
  status?: string | null
  content_type?: string | null
  updated_at?: string | null
  posting_approval_state?: unknown
}

export type ApprovalRow = {
  itemId: string
  clientId: string
  title: string
  kind: ApprovalKind
  /** what is being waited for, in one plain phrase */
  what: string
  /** who it is sitting with */
  who: string
  status: string
  updatedAt: string
}

/** The three groups, in the order the view draws them. */
export const APPROVAL_GROUPS: { kind: ApprovalKind; label: string; blurb: string }[] = [
  {
    kind: 'post',
    label: 'Posts sent for approval',
    blurb: 'The words, the picture and the time, waiting on a yes.',
  },
  {
    kind: 'client',
    label: 'With the client',
    blurb: 'The client is looking at it, or has asked for a change.',
  },
  {
    kind: 'check',
    label: 'Waiting on a check',
    blurb: 'Made, and waiting on somebody here before the client sees it.',
  },
]

const KIND_ORDER: Record<ApprovalKind, number> = { post: 0, client: 1, check: 2 }

/** The words on a row, per status. */
function wordsFor(kind: ApprovalKind, status: string): { what: string; who: string } {
  if (kind === 'post') {
    return { what: 'Sent for approval', who: 'Waiting on an approver' }
  }
  if (kind === 'client') {
    return status === 'client_changes_requested'
      ? { what: 'The client asked for a change', who: 'Waiting on us' }
      : { what: 'Sent to the client', who: 'Waiting on the client' }
  }
  return { what: 'Ready for a check', who: 'Waiting on an account manager' }
}

/**
 * Which of the three waits an item is in, or null when it is not waiting on
 * anybody.
 *
 * A POST sent for sign-off wins over where the card sits: it is the more
 * specific question, and the person answering it is being asked about the
 * post, not the piece. Nothing is ever listed twice.
 */
export function approvalKindOf(item: ApprovalItem): ApprovalKind | null {
  if (parseApprovalState(item.posting_approval_state) === 'pending') return 'post'
  const status = String(item.status ?? '')
  if (!status) return null
  const column: BoardColumnKey | undefined = columnOf(status as ItemStatus)
  if (column === 'with_client') return 'client'
  if (status === 'internal_review') return 'check'
  return null
}

/**
 * Everything waiting on a person, newest first inside each group.
 *
 * `clientId` narrows it to one client — the calendar's "Waiting for approval"
 * chip links here for the client whose week is on screen, and the number on
 * the chip is this list's length for that client, never a second count.
 */
export function approvalRows(
  items: readonly ApprovalItem[],
  opts: { clientId?: string | null } = {},
): ApprovalRow[] {
  const only = opts.clientId ?? null
  const rows: ApprovalRow[] = []
  for (const item of items) {
    const clientId = String(item.client_id ?? '')
    if (only && clientId !== only) continue
    const kind = approvalKindOf(item)
    if (!kind) continue
    const status = String(item.status ?? '')
    rows.push({
      itemId: item.id,
      clientId,
      title: String(item.title ?? '').trim() || 'Untitled',
      kind,
      status,
      updatedAt: String(item.updated_at ?? ''),
      ...wordsFor(kind, status),
    })
  }
  return rows.sort((a, b) =>
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || b.updatedAt.localeCompare(a.updatedAt)
    || a.title.localeCompare(b.title))
}

/** How many things are waiting — the chip's number and the pill's badge, off
 *  the one list so they cannot disagree. */
export function approvalCount(
  items: readonly ApprovalItem[], opts: { clientId?: string | null } = {},
): number {
  return approvalRows(items, opts).length
}

/** What one row opens: the composer on the post's preview, or the card. */
export function approvalRowHref(row: ApprovalRow): string {
  return row.kind === 'post'
    ? scheduleViewHref('calendar', { client: row.clientId, item: row.itemId })
    : scheduleViewHref('board', { client: row.clientId, card: row.itemId })
}

/** Nothing is waiting — said per group, and once for the whole view. */
export const APPROVALS_EMPTY = 'Nothing is waiting on anybody.'
