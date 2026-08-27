/**
 * The words the CLIENT reads. Pure — no I/O, so both the server payload and
 * the browser components say exactly the same thing.
 *
 * Two rules the portal is held to:
 *   1. never print a raw database value (content_type, batch status);
 *   2. one word for one pile — everything past the client's approval is
 *      "Approved"; scheduling and publishing are shown as a date or a link
 *      on the card, never as a second status word.
 */

import { DEFAULT_TZ, formatInZone } from './timezone-core'

/** A content type in the client's words. `null` = not a thing they ordered
 *  (an internal "other" bucket) — the caller hides the chip entirely. */
const CONTENT_TYPE_LABELS: Record<string, string> = {
  reel: 'Reel',
  carousel: 'Carousel',
  story: 'Story',
  static: 'Graphic',
  video: 'Video',
}

export function contentTypeLabel(type: string | null | undefined): string | null {
  return CONTENT_TYPE_LABELS[String(type ?? '').toLowerCase()] ?? null
}

/** The same map for the monthly-commitment tiles, which count pieces. */
export function contentTypePlural(type: string | null | undefined): string {
  const one = contentTypeLabel(type)
  return one ? `${one}s` : 'Other pieces'
}

/**
 * The word on a piece's card.
 *
 * Rule 2 above still holds — internal churn is one calm state — but "Approved"
 * on a piece that already has a posting time told the client less than we know.
 * A booked post IS a different thing from an approved one to the person waiting
 * for it: it has a date and a time, and saying so is the whole reassurance.
 * Everything before their approval is unchanged.
 */
export function clientStatusWord(status: string, fallback: string): string {
  return status === 'scheduled' ? 'Scheduled' : fallback
}

/**
 * A posting time in the client's own words, on the client's own clock.
 *
 * "Instagram · 27 Aug" left the client to guess the hour of a post they may
 * want to be ready for. The zone is the CLIENT's, not the reader's and not the
 * agency's: the time is a fact about when the post reaches their audience, and
 * a client in Manila reading "9:00 am" must be reading Manila's nine o'clock.
 * Melbourne used to be hard-coded here on the assumption that every client was
 * one — the default keeps that true for the ones who are.
 */
export function scheduledWhen(
  iso: string | null | undefined,
  tz: string = DEFAULT_TZ,
): string | null {
  return formatInZone(iso, tz, 'full')
}

/**
 * The one extra line a piece earns when it was taken back off the client's
 * desk.
 *
 * A piece sitting with the client for review can be pulled back the moment a
 * new cut is saved on it — the review card vanishes and the piece reappears
 * under "In production". Without a word about it, the client's experience is
 * that something they were asked to approve silently disappeared. This says
 * what happened, in the only terms that matter to them: it's coming back.
 *
 * The rest of the internal churn stays one calm state, as it always has. This
 * fires for exactly one situation — the last thing that happened to this piece
 * was that it left THEIR review.
 */
export const UPDATING_AFTER_REVIEW_LINE =
  'We’re updating this — a new version is on its way'

export type LastStatusChange = {
  old_value?: string | null
  new_value?: string | null
} | null | undefined

export function progressLine(
  status: string | null | undefined, lastChange: LastStatusChange,
): string | null {
  if (status !== 'internal_review') return null
  // read from the item's own history rather than from a flag column: the move
  // is already recorded there, and a second source of truth for the same fact
  // is a second thing to get out of step
  if (String(lastChange?.old_value ?? '') !== 'client_review') return null
  if (String(lastChange?.new_value ?? '') !== 'internal_review') return null
  return UPDATING_AFTER_REVIEW_LINE
}

/** A shoot's stage, for a client who has never been on a film set. */
export const SHOOT_STATUS_LABELS: Record<string, string> = {
  brief: 'Being planned',
  locked: 'Date confirmed',
  shot: 'Filmed',
  wrapped: 'Complete',
}

export const shootStatusLabel = (status: string | null | undefined): string =>
  SHOOT_STATUS_LABELS[String(status ?? '')] ?? 'Being planned'

/** "Priya, your account manager" when we know who that is — the phrase alone
 *  when the client has no manager assigned. */
export function amPhrase(amName?: string | null): string {
  const n = (amName ?? '').trim()
  return n ? `${n}, your account manager` : 'your account manager'
}

/** The same person, mid-sentence, with the commas a clause needs. */
export function amClause(amName?: string | null): string {
  const n = (amName ?? '').trim()
  return n ? `${n}, your account manager,` : 'your account manager'
}

/** What approving actually causes — stated before the click, not after. */
export const approveConsequence = (amName?: string | null) =>
  `Approving sends it to scheduling — ${amClause(amName)} will book the posting time.`

export const approvePlanConsequence =
  'Approving confirms the shoot plan — we’ll lock in the date.'

export const APPROVED_TOAST = 'Approved — it’s off to scheduling.'
export const PLAN_APPROVED_TOAST = 'Plan approved — thank you.'
export const changesSentToast = (amName?: string | null) => `Sent to ${amPhrase(amName)}.`

/**
 * What a shoot plan's card should say about the client's own decision.
 *
 * Acting on a plan used to leave no trace. "Request changes" sent the note and
 * the card carried on inviting the same decision until a reload, after which
 * it said nothing at all about it; "Approve the plan" left the card reading
 * "Being planned", which is what it said before. The client's own action is
 * the one thing a portal must always be able to show back to them.
 *
 * Read from the brief task's status, because that is where the decision
 * actually lives — plus the shoot's own status for the last step, since the
 * date being locked is what "we'll confirm the date shortly" was promising.
 */
export type PlanState =
  /** it is the client's move: the two buttons belong on the card */
  | 'awaiting_you'
  /** they asked for changes and we are making them */
  | 'changes_sent'
  /** approved, date not locked yet */
  | 'approved'
  /** approved and booked */
  | 'date_confirmed'
  /** nothing to say — an unshared plan, or one that never reached them */
  | null

export function planState(
  briefStatus: string | null | undefined,
  shootStatus: string | null | undefined,
  sharedWithClient: boolean,
): PlanState {
  // a plan they were never shown is not a plan they have a view on
  if (!sharedWithClient) return null
  const booked = shootStatus === 'locked' || shootStatus === 'shot' || shootStatus === 'wrapped'
  switch (String(briefStatus ?? '')) {
    case 'client_review':
      return 'awaiting_you'
    case 'client_changes_requested':
    case 'revision_required':
    case 'revision_complete':
      return 'changes_sent'
    case 'approved_for_scheduling':
    case 'scheduled':
    case 'published':
      return booked ? 'date_confirmed' : 'approved'
    default:
      // draft_uploaded / internal_review / no brief at all: still ours. A
      // booked shoot still says so — that is a fact about their diary.
      return booked ? 'date_confirmed' : null
  }
}

/** The line the card shows for each of those, in the client's own terms. */
export const PLAN_STATE_LINE: Record<Exclude<PlanState, null>, string> = {
  awaiting_you: 'This plan is with you. Approve it, or tell us what to change.',
  changes_sent: 'We’ve got your notes — we’ll come back with an updated plan.',
  approved: 'Approved ✓ — we’ll confirm the date shortly.',
  date_confirmed: 'Approved ✓ — the date is confirmed.',
}

/**
 * A plan can be approved AND come with something to say — "yes, and please
 * start after nine". The client has just typed that note and pressed a button;
 * the card has to show back that BOTH things happened, or the note looks like
 * it went nowhere.
 *
 * Only the freshly approved state says it. A confirmed date is a bigger fact
 * about their diary than a note they wrote a week ago, so it keeps its own line.
 */
export const PLAN_APPROVED_WITH_NOTE_LINE = 'Approved ✓ — with your note'

export function planStateLine(state: Exclude<PlanState, null>, withNote = false): string {
  return withNote && state === 'approved' ? PLAN_APPROVED_WITH_NOTE_LINE : PLAN_STATE_LINE[state]
}

/** Approving a plan while saying something — the quiet third move on the card,
 *  and what the box invites them to write in it. A shoot is a day in their
 *  diary, so the question is about the day. */
export const APPROVE_PLAN_WITH_NOTE = 'Approve with a note'
export const PLAN_NOTE_PLACEHOLDER = 'Anything we should know before the day?'
