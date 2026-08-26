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
