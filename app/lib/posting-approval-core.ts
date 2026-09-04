/**
 * Final-post approval — the pure state machine, no I/O.
 *
 * The asset approval earlier in the funnel signs off the WORK. Nobody, until
 * this module, ever signed off the POST: the caption, the platform and the
 * hour were all set at scheduling time and went straight to the queue. This
 * is the owner's rule made code: "when scheduling we also need approval in
 * terms of what it would look like — captions etc."
 *
 * The state lives in content_items.posting_approval_state:
 *
 *   null      — the gate has never been used on this item. Everything behaves
 *               exactly as it did before the column existed; a database the
 *               migration has not reached yet reads the same way.
 *   'pending' — sent for approval; queueing is blocked.
 *   'approved'— signed off; queueing is open.
 *   'changes' — the approver asked for changes; the scheduler edits and
 *               re-sends.
 *   'draft'   — reserved: being prepared, treated like null for blocking.
 *
 * The server enforces these rules; the posting card draws them. Both read
 * this one module, so the button and the write can never disagree.
 */
import type { Role } from './identity-core'

export const POSTING_APPROVAL_STATES = ['draft', 'pending', 'approved', 'changes'] as const
export type PostingApprovalState = (typeof POSTING_APPROVAL_STATES)[number]

/**
 * Read the column TOLERANTLY: an absent column, a null, or a value written by
 * something newer than this build all degrade to null — which means "the gate
 * is not in use", today's behaviour. Same posture as portal-data's degrading
 * client select: a missing migration must never break the page.
 */
export function parseApprovalState(v: unknown): PostingApprovalState | null {
  return POSTING_APPROVAL_STATES.includes(v as PostingApprovalState)
    ? (v as PostingApprovalState)
    : null
}

/** Is queueing to a live account blocked right now? Returns the sentence the
 *  refusal wears, or null when the queue is open. Null/absent state = open —
 *  an item that was never sent for post approval queues exactly as it always
 *  has. */
export function publishBlockReason(state: unknown): string | null {
  const s = parseApprovalState(state)
  if (s === null || s === 'approved') return null
  return s === 'pending'
    ? 'Waiting on final approval — the post was sent for sign-off and nobody has approved it yet'
    : s === 'changes'
      ? 'Changes were asked for on this post — update it and send it for approval again'
      : 'Send the post for approval first'
}

export type ApprovalAction = 'send' | 'approve' | 'request_changes' | 'reset'

/**
 * The machine's edges. `from` is what the row holds now (null = never used).
 * Returns the next state, or an error sentence when the move makes no sense.
 *
 *   send:            null | 'draft' | 'changes' | 'pending' → 'pending'
 *                    (re-sending a pending post is idempotent, not an error —
 *                    a double-click must not scold anyone)
 *   approve:         'pending' → 'approved'
 *   request_changes: 'pending' → 'changes'
 *   reset:           anything → 'draft'
 *                    (the post the answer belonged to is gone — see below)
 *
 * Approving something that was never sent is refused: an approval must be an
 * answer to a question somebody asked.
 */
export function nextApprovalState(
  from: unknown, action: ApprovalAction,
): { ok: true; state: PostingApprovalState } | { ok: false; reason: string } {
  const s = parseApprovalState(from)
  switch (action) {
    case 'send':
      if (s === 'approved') {
        return { ok: false, reason: 'This post is already approved — it can be queued as it is' }
      }
      return { ok: true, state: 'pending' }
    case 'approve':
      if (s !== 'pending') {
        return {
          ok: false,
          reason: s === 'approved'
            ? 'This post is already approved'
            : 'Nothing is waiting for approval on this post',
        }
      }
      return { ok: true, state: 'approved' }
    case 'request_changes':
      if (s !== 'pending') {
        return { ok: false, reason: 'Nothing is waiting for approval on this post' }
      }
      return { ok: true, state: 'changes' }
    case 'reset':
      // The answer belonged to a POST, not to the item: cancel that post and
      // the yes (or the ask, or the changes asked for) has nothing left to be
      // about. Leaving it standing would let the next post on the same item
      // inherit an approval nobody gave for its words and pictures — and let
      // the ad-hoc composer publish through a gate that only looks open.
      //
      // Always succeeds. Resetting something already at 'draft' or never
      // used is not an error, it is a no-op, and a cancel must never fail
      // because of tidying up after itself.
      return { ok: true, state: 'draft' }
  }
}

/**
 * What happens to the state when the POST changes — the caption is edited, or
 * a new version replaces the media.
 *
 * Only an APPROVED post falls back to 'pending': the yes was given to words
 * and pictures that no longer exist, so it has to be asked for again. A post
 * still pending shows the approver the latest content anyway, and a 'changes'
 * post being edited is exactly what was asked for. Returns null when nothing
 * should change (including when the column does not exist).
 */
export function stateAfterPostEdit(current: unknown): PostingApprovalState | null {
  return parseApprovalState(current) === 'approved' ? 'pending' : null
}

/** May these hats SEND a post for approval? The scheduling hat (whoever was
 *  handed it, whatever their title), the item's owner (who wears 'editor'),
 *  or a super admin. */
export function maySendPostApproval(hats: readonly Role[]): boolean {
  return hats.includes('scheduler') || hats.includes('editor') || hats.includes('super_admin')
}

/** May these hats APPROVE the post (or ask for changes)? The client's account
 *  manager or a super admin — the client's own yes arrives through the portal
 *  wearing the client hat. */
export function mayApprovePost(hats: readonly Role[]): boolean {
  return hats.includes('account_manager') || hats.includes('super_admin') || hats.includes('client')
}

/** The chip a queue row or an item header wears — or null for a post the gate
 *  has never touched (most of them; the chip must not shout about a feature
 *  nobody used). */
export function approvalChip(
  state: unknown,
): { label: string; tone: 'waiting' | 'approved' | 'changes' } | null {
  switch (parseApprovalState(state)) {
    case 'pending': return { label: 'Waiting on approval', tone: 'waiting' }
    case 'approved': return { label: 'Approved to post', tone: 'approved' }
    case 'changes': return { label: 'Changes requested', tone: 'changes' }
    default: return null
  }
}

/** The words on the posting card's disabled queue button. */
export const WAITING_LINE = 'Waiting on final approval'
/** …and on its primary before anything was sent. */
export const SEND_LABEL = 'Send the post for approval'

/**
 * Does this row belong in the client portal's "posts waiting on you" pile?
 * True only when the whole chain holds: the gate is pending, the client was
 * explicitly asked (the toggle), and the item is past asset approval. A
 * database without the columns answers false for every row.
 */
export function awaitsClientPostApproval(row: {
  status?: string | null
  posting_approval_state?: unknown
  posting_client_required?: unknown
}): boolean {
  return parseApprovalState(row.posting_approval_state) === 'pending'
    && row.posting_client_required === true
    && ['approved_for_scheduling', 'scheduled'].includes(String(row.status ?? ''))
}

/**
 * What the posting card should DO about the gate, for one viewer.
 *
 * Only consulted once the card KNOWS the gate exists (the columns are on the
 * database — the server says so); until then the card behaves as it always
 * has and never draws any of this.
 *
 *   'send'    — nothing sent yet: the primary action is "Send the post for
 *               approval", and the queue button waits behind it
 *   'resend'  — changes came back; edit, then send again
 *   'waiting' — sent; this viewer can only wait (queue disabled)
 *   'decide'  — sent; THIS viewer is an approver: Approve / Request changes
 *   'open'    — approved: queue as normal
 */
export type ApprovalStep = 'send' | 'resend' | 'waiting' | 'decide' | 'open'

export function approvalStep(state: unknown, hats: readonly Role[]): ApprovalStep {
  const s = parseApprovalState(state)
  if (s === 'approved') return 'open'
  if (s === 'pending') return mayApprovePost(hats) ? 'decide' : 'waiting'
  if (s === 'changes') return 'resend'
  // null or 'draft': the gate exists and nothing has been sent
  return 'send'
}
