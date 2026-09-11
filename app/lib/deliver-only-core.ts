/**
 * DELIVER ONLY — the client posts their own content. Pure.
 *
 * The Team's Playbook: "Some clients post and schedule their own after we
 * have delivered the assets (example Bond Street)." Delivered is the point
 * at which the work leaves our hands in finished form. For such a client
 * the card's journey ENDS at the client's approval: the finals are theirs
 * to download on the portal, nobody on the team schedules them, and the
 * card sits in a Delivered column rather than Ready to post. The owner,
 * 11 Sep 2026: "sometimes we simply just edit for the client and send them
 * the edits instead — it won't go to scheduler".
 *
 * Two switches, one answer: the client's own setting
 * (`clients.posts_own_content`) and the card's word on it
 * (`content_items.deliver_only`: true / false / null = follow the client).
 */

import type { ItemStatus } from './workflow-core'

export type DeliverOnlyCard = {
  status?: ItemStatus | string
  deliver_only?: unknown
}
export type DeliverOnlyClient = { posts_own_content?: unknown } | null | undefined

/** Does this card end at the client's approval? The card's own word wins;
 *  with none, the client's setting decides. */
export function deliverOnly(card: DeliverOnlyCard | null | undefined, client: DeliverOnlyClient): boolean {
  const own = card?.deliver_only
  if (own === true) return true
  if (own === false) return false
  return client?.posts_own_content === true
}

/** Approved AND deliver-only: the card is delivered, and stays so. A card
 *  that went on to be booked or posted (a manager marked a file posted by
 *  hand) is past this and is read by its status as before. */
export function isDelivered(card: DeliverOnlyCard | null | undefined, client: DeliverOnlyClient): boolean {
  return deliverOnly(card, client) && card?.status === 'approved_for_scheduling'
}

/** What the Schedule page says when somebody tries to book such a piece. */
export const DELIVER_ONLY_REASON = 'This client posts their own content — it is delivered, not scheduled here'

/** The card's history line, and the drawer's chip. */
export const DELIVERED_LINE = 'Delivered — the client posts this themselves'
export const DELIVER_ONLY_CHIP = 'Client posts it'

/** The activity action the workflow writes when a deliver-only card is
 *  approved — what the history reads back as DELIVERED_LINE. */
export const DELIVERED_ACTION = 'delivered_self_posted'

/** The words on the client's own card once it is theirs to post. */
export const PORTAL_DELIVERED_LINE = 'Approved — yours to post. Download the finals below.'

/** The stage word in a deliver-only card's emails and history once the
 *  client has approved it: never "Ready to post" — nobody here posts it
 *  (the live role-play of 11 Sep 2026 read "Menu graphic D — now Ready to
 *  post" to the AM, the editor and Joy for a card that was delivered). */
export const DELIVERED_STAGE_WORD = 'Delivered'
export function stageWordFor(to: ItemStatus | string, selfPosts: boolean, fallback: string): string {
  return selfPosts && to === 'approved_for_scheduling' ? DELIVERED_STAGE_WORD : fallback
}
