import { STATUS_LABELS, type ItemStatus, ITEM_STATUSES } from './workflow-core'

/**
 * What a notification row SAYS, and where it GOES.
 *
 * The Notifications page printed the raw database event name under every
 * subject, in mono, uppercase: `job assigned`, `transition internal review`,
 * `batch wrapped`, `prospect auto ingested`. The last one is not English. And
 * only `content_item` rows were clickable, so every shoot, intake and lead
 * notification was a dead row — distinguishable only by a near-invisible
 * chevron.
 *
 * Both problems are data problems, so both are solved here, in a pure module
 * the page renders and the tests can sweep.
 */

const isStatus = (s: string): s is ItemStatus =>
  (ITEM_STATUSES as readonly string[]).includes(s)

/**
 * Split `transition_internal_review_approved_for_scheduling` into its two
 * statuses. The event name concatenates them with an underscore and both
 * halves contain underscores, so it can only be read by trying every status
 * as a prefix — which is exactly what the list is for.
 */
export function splitTransition(rest: string): { from: ItemStatus; to: ItemStatus } | null {
  for (const from of ITEM_STATUSES) {
    if (!rest.startsWith(`${from}_`)) continue
    const to = rest.slice(from.length + 1)
    if (isStatus(to)) return { from, to }
  }
  return null
}

/** Fixed events, in the recipient's words rather than the system's. */
const PLAIN: Record<string, string> = {
  job_assigned: 'Assigned to you',
  schedule_handoff: 'Ready for you to schedule',
  publish_queued: 'Queued to go out',
  client_comment: 'The client left a comment',
  comment_assigned: 'Someone tagged you — waiting on you',
  approval_note: 'A note came with the approval',
  due_reminder: 'Due soon',
  prospect_auto_ingested: 'A new enquiry became a client',
  intake_submitted: 'A client filled in their intake form',
  shoot_proposed: 'A shoot date was proposed',
  shoot_confirmed_client: 'A shoot date was confirmed',
  shoot_cancelled_client: 'A shoot was cancelled',
  social_connect_invite: 'Asked to connect a social account',
  booking_new_team: 'Someone booked a session',
  booking_confirmed: 'A booking was confirmed',
  booking_paid_no_slot: 'A booking was paid but has no slot',
}

/**
 * One line of English for any event name. Unknown events fall back to the
 * subject line the email used, never to the raw enum: a word nobody wrote for
 * a person to read should not reach one.
 */
export function eventWords(eventType: string): string | null {
  if (PLAIN[eventType]) return PLAIN[eventType]

  if (eventType.startsWith('transition_')) {
    const pair = splitTransition(eventType.slice('transition_'.length))
    return pair ? `Moved to ${STATUS_LABELS[pair.to]}` : 'Moved to the next stage'
  }
  // shoots kept the database's old name for themselves ("batch")
  if (eventType.startsWith('batch_') || eventType.startsWith('shoot_')) {
    return 'A shoot moved on'
  }
  return null
}

/**
 * Where a row points. Every entity type gets a destination — a notification
 * you cannot open is a notification that wasted your attention.
 */
export function notificationHref(entityType: string, entityId: string): string | null {
  // entity ids carry suffixes like "#v2" / "#<owner>" for dedupe
  const id = (entityId ?? '').split('#')[0]
  const isUuid = /^[0-9a-f-]{36}$/i.test(id)

  switch (entityType) {
    case 'content_item': return isUuid ? `/dashboard/production/${id}` : null
    case 'batch':
    case 'shoot': return isUuid ? `/dashboard/production/shoots/${id}` : null
    case 'shoot_proposal': return '/dashboard/production/proposals'
    case 'client': return isUuid ? `/dashboard/clients/${id}` : '/dashboard/clients'
    case 'intake': return isUuid ? `/dashboard/clients/${id}/intake` : '/dashboard/clients'
    case 'lead':
    case 'prospect': return '/dashboard/leads'
    case 'booking': return '/dashboard/bookings'
    case 'social_account': return isUuid ? `/dashboard/social/${id}` : '/dashboard/social'
    default: return null
  }
}

/**
 * The failed-email badge used to read "email failed" with no explanation and
 * no retry, so the reader could not tell whether the client had been told.
 */
export const EMAIL_FAILED_WORDS = 'Email didn’t send — they haven’t been told'
