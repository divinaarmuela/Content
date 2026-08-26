/**
 * Pure production-workflow state machine — no imports, fully unit-testable.
 * Encodes doc 1's status funnel (§4), transition permissions (§5, §10), and
 * client-visible label translation. The server engine (workflow.ts) executes
 * these rules; nothing else in the codebase decides what moves where.
 */
import { roleSatisfies, type Role } from './identity-core'

export const ITEM_STATUSES = [
  'draft_uploaded', 'internal_review', 'revision_required', 'revision_complete',
  'client_review', 'client_changes_requested', 'approved_for_scheduling',
  'scheduled', 'published',
] as const
export type ItemStatus = (typeof ITEM_STATUSES)[number]

/** Extra evidence a transition needs before it is legal. */
export type TransitionRequirement = 'reviewable_asset' | 'schedule_entry' | 'live_url'

type TransitionRule = {
  /** who may perform it (super_admin always may, checked separately) */
  roles: Role[]
  requires?: TransitionRequirement
  /** human label for buttons/logs */
  label: string
  /** the same move, said the way a particular hat experiences it — an account
   *  manager clicking "Approve" on the client's behalf is LOGGING the client's
   *  approval, not giving one */
  labelFor?: Partial<Record<Role, string>>
}

/** The funnel. Key: from-status → to-status → rule. Anything absent is illegal. */
export const TRANSITIONS: Partial<Record<ItemStatus, Partial<Record<ItemStatus, TransitionRule>>>> = {
  draft_uploaded: {
    internal_review: { roles: ['editor', 'account_manager'], requires: 'reviewable_asset', label: 'Submit for review' },
  },
  internal_review: {
    revision_required: { roles: ['account_manager'], label: 'Request changes' },
    client_review: { roles: ['account_manager'], label: 'Send to client' },
    approved_for_scheduling: { roles: ['account_manager'], label: 'Approve without client' },
  },
  revision_required: {
    revision_complete: { roles: ['editor'], requires: 'reviewable_asset', label: 'Revisions done' },
  },
  revision_complete: {
    client_review: { roles: ['account_manager'], label: 'Looks good — send to client' },
    revision_required: { roles: ['account_manager'], label: 'Needs more changes' },
    approved_for_scheduling: { roles: ['account_manager'], label: 'Approve without client' },
  },
  client_review: {
    client_changes_requested: {
      roles: ['client', 'account_manager'], label: 'Request changes',
      labelFor: { account_manager: "Log client's changes" },
    },
    approved_for_scheduling: {
      roles: ['client', 'account_manager'], label: 'Approve',
      labelFor: { account_manager: "Log client's approval" },
    },
  },
  client_changes_requested: {
    revision_required: { roles: ['account_manager'], label: 'Send for revision' },
    // the small-fix path: the manager corrected it on the spot — straight
    // back to the client, no assignment ceremony for a one-word change
    client_review: { roles: ['account_manager'], label: 'No edit needed — resend' },
  },
  approved_for_scheduling: {
    scheduled: { roles: ['scheduler'], requires: 'schedule_entry', label: 'Mark scheduled' },
  },
  scheduled: {
    published: { roles: ['scheduler'], requires: 'live_url', label: 'Mark published' },
  },
}

/** Client-visible status labels (doc 1 §4 — internal churn reads as one calm state). */
export const CLIENT_LABELS: Record<ItemStatus, string> = {
  draft_uploaded: 'In production',
  internal_review: 'In production',
  revision_required: 'In production',
  revision_complete: 'In production',
  client_review: 'Needs your review',
  client_changes_requested: 'Changes in progress',
  approved_for_scheduling: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
}

/** Statuses whose items a client may see at all (everything — but only with
 *  the client label); statuses a client may INTERACT with are narrower. */
export const CLIENT_ACTIONABLE: ItemStatus[] = ['client_review']

/** Statuses visible in the scheduler's queue — nothing earlier ever appears. */
export const SCHEDULER_STATUSES: ItemStatus[] = ['approved_for_scheduling', 'scheduled', 'published']

/** What each stage is CALLED on screen — plain words, never the raw status. */
export const STATUS_LABELS: Record<ItemStatus, string> = {
  draft_uploaded: 'Drafting',
  internal_review: 'Ready for review',
  revision_required: 'Being revised',
  revision_complete: 'Revised — check again',
  client_review: 'With client',
  client_changes_requested: 'Client wants changes',
  approved_for_scheduling: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
}

/** One sentence explaining what the stage MEANS, for anyone who is new. */
export const STATUS_MEANING: Record<ItemStatus, string> = {
  draft_uploaded: 'The editor is working on the first cut.',
  internal_review: 'Waiting for an account manager to check it.',
  revision_required: 'Changes were asked for; the editor is making them.',
  revision_complete: 'The changes are in; an account manager needs to look again.',
  client_review: 'Waiting for the client to approve or ask for changes.',
  client_changes_requested: 'An account manager decides: send it for revision, or fix it and resend.',
  approved_for_scheduling: 'Signed off. Needs a posting time.',
  scheduled: 'Posting time is set; waiting to go live.',
  published: 'Live. Nothing left to do.',
}

/** Whose move it is at each stage — the hat, not the person. */
export const STATUS_TURN: Record<ItemStatus, Role | null> = {
  draft_uploaded: 'editor',
  internal_review: 'account_manager',
  revision_required: 'editor',
  revision_complete: 'account_manager',
  client_review: 'client',
  client_changes_requested: 'account_manager',
  approved_for_scheduling: 'scheduler',
  scheduled: 'scheduler',
  published: null,
}

/** The fields of an item that decide which hats a viewer wears on it. */
export type ActingItem = { owner_id?: string | null; scheduler_ids?: unknown }

/** scheduler_ids as it is meant: a list of user ids. Anything else is none. */
export function schedulerIdsOf(item: { scheduler_ids?: unknown }): string[] {
  return Array.isArray(item.scheduler_ids) ? item.scheduler_ids.map(String) : []
}

/**
 * The hats a viewer wears ON THIS ITEM.
 *
 * The one rule: editing and scheduling are ASSIGNMENT hats, not job titles.
 * Being an editor does not let you act on someone else's item; being handed
 * an item does let you act on it, whatever your title. Account manager is the
 * exception — reviewing IS the job, and it is not per-item.
 */
export function actingRoles(viewer: { id: string; role: Role }, item: ActingItem): Role[] {
  if (viewer.role === 'client') return ['client']
  if (viewer.role === 'super_admin') return ['super_admin']

  const roles: Role[] = []
  if (viewer.role === 'account_manager') roles.push('account_manager')

  const owner = item.owner_id
  // the open pool for an unowned item is editors and AMs; a scheduler picking
  // up someone else's draft is not a thing
  if (owner === viewer.id || (!owner && roleSatisfies(viewer.role, 'editor'))) roles.push('editor')

  const ids = schedulerIdsOf(item)
  // handed the item = the hat, whatever the title; nobody handed it = the
  // schedulers can pick it up
  if (ids.includes(viewer.id) || (ids.length === 0 && viewer.role === 'scheduler')) roles.push('scheduler')

  const order: Role[] = ['account_manager', 'editor', 'scheduler']
  return order.filter(r => roles.includes(r))
}

export type TransitionCheck =
  | { ok: true; rule: TransitionRule }
  | { ok: false; reason: string }

/** Is `from → to` legal for someone wearing ANY of these hats? super_admin may
 *  perform any defined transition (doc: admin can override statuses) but never
 *  an undefined one. */
export function checkTransitionAs(roles: readonly Role[], from: ItemStatus, to: ItemStatus): TransitionCheck {
  const rule = TRANSITIONS[from]?.[to]
  if (!rule) return { ok: false, reason: `No transition from ${from} to ${to}` }
  if (roles.includes('super_admin')) return { ok: true, rule }
  if (!rule.roles.some(r => roles.includes(r))) {
    return { ok: false, reason: `${roles.join('/') || 'nobody'} may not perform "${rule.label}"` }
  }
  return { ok: true, rule }
}

/** The label a rule wears for these hats. The client's own words win when the
 *  viewer IS the client; otherwise the first hat with wording of its own. */
function labelFor(rule: TransitionRule, roles: readonly Role[]): string {
  if (!rule.labelFor) return rule.label
  if (roles.includes('client') && rule.labelFor.client) return rule.labelFor.client
  for (const r of roles) {
    const l = rule.labelFor[r]
    if (l) return l
  }
  return rule.label
}

/** Transitions available to these hats from a given status (for buttons). */
export function availableTransitionsAs(
  roles: readonly Role[], from: ItemStatus,
): { to: ItemStatus; label: string; requires?: TransitionRequirement }[] {
  const outs = TRANSITIONS[from] ?? {}
  return (Object.entries(outs) as [ItemStatus, TransitionRule][])
    .filter(([, rule]) => roles.includes('super_admin') || rule.roles.some(r => roles.includes(r)))
    .map(([to, rule]) => ({ to, label: labelFor(rule, roles), requires: rule.requires }))
}

/** Single-hat wrappers — the shape the rest of the app already speaks. */
export function checkTransition(role: Role, from: ItemStatus, to: ItemStatus): TransitionCheck {
  return checkTransitionAs([role], from, to)
}

export function availableTransitions(role: Role, from: ItemStatus): { to: ItemStatus; label: string; requires?: TransitionRequirement }[] {
  return availableTransitionsAs([role], from)
}

/** The one move that IS the point at each stage — everything else is a detour. */
export const PRIMARY_ACTION: Partial<Record<ItemStatus, ItemStatus>> = {
  draft_uploaded: 'internal_review',
  internal_review: 'client_review',
  revision_required: 'revision_complete',
  revision_complete: 'client_review',
  client_review: 'approved_for_scheduling',
  client_changes_requested: 'revision_required',
  approved_for_scheduling: 'scheduled',
  scheduled: 'published',
}

export type Presented = { to: ItemStatus; label: string }

/**
 * Split the legal moves into one obvious button and the rest.
 *
 * A screen full of equal-weight buttons makes every move look like a decision.
 * Only the person whose turn it is gets a primary; everyone else gets choices
 * they may take, none of them urged.
 */
export function presentTransitions(
  roles: readonly Role[],
  from: ItemStatus,
  transitions: Presented[],
  ctx: { clientApprovalRequired: boolean; viewerIsOwner: boolean },
  /** whose turn each status is. A brief hands over to nobody at the end — its
   *  surfaces pass BRIEF_STATUS_TURN so the account manager who must book the
   *  shoot gets the button, instead of a scheduler who will never come. */
  turns: Record<ItemStatus, Role | null> = STATUS_TURN,
): { primary: Presented | null; secondary: Presented[] } {
  const visible = transitions
    .filter(t => !(t.to === 'approved_for_scheduling' && from !== 'client_review' && ctx.clientApprovalRequired))
    .map(t => (
      ctx.viewerIsOwner && t.to === 'revision_required' && (from === 'internal_review' || from === 'revision_complete')
        ? { ...t, label: 'Send back to myself' }
        : t
    ))

  const turn = turns[from]
  const holdsTurn = roles.includes('super_admin') || (turn !== null && roles.includes(turn))
  const wanted = PRIMARY_ACTION[from]
  const primary = holdsTurn && wanted ? visible.find(t => t.to === wanted) ?? null : null

  return { primary, secondary: visible.filter(t => t !== primary) }
}

/** Whose move is it, is it mine, and is the seat empty? `turns` is the same
 *  optional vocabulary presentTransitions takes — a brief hands the last two
 *  stages to nobody, so its surfaces pass BRIEF_STATUS_TURN and stop reporting
 *  an empty scheduler seat on a shoot that no scheduler will ever touch. */
export function whoseTurn(
  status: ItemStatus, item: ActingItem, viewer: { id: string; role: Role },
  turns: Record<ItemStatus, Role | null> = STATUS_TURN,
): { hat: Role | null; mine: boolean; unassigned: boolean } {
  const hat = turns[status]
  const mine = hat !== null && (actingRoles(viewer, item).includes(hat) || viewer.role === 'super_admin')
  const unassigned = hat === 'editor'
    ? !item.owner_id
    : hat === 'scheduler'
      ? schedulerIdsOf(item).length === 0
      : false
  return { hat, mine, unassigned }
}

/** Doc 1 §11: an item can only be submitted when a reviewable asset exists —
 *  an uploaded file OR a Drive link — and the Dropbox master is archived. */
export function versionSatisfiesSubmission(v: { file_url?: string; drive_url?: string; dropbox_url?: string }): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = []
  if (!v.file_url?.trim() && !v.drive_url?.trim()) missing.push('an uploaded file or a Drive review link')
  if (!v.dropbox_url?.trim()) missing.push('the Dropbox master link')
  return missing.length === 0 ? { ok: true } : { ok: false, missing }
}

/** Notification fan-out per transition (doc 1 §10 trigger map). The server
 *  resolves audiences to concrete people. */
export type Audience = 'account_managers' | 'owner_editor' | 'schedulers' | 'client_users' | 'assigned_schedulers'
export const TRANSITION_NOTIFICATIONS: Partial<Record<`${ItemStatus}>${ItemStatus}`, Audience[]>> = {
  // 'owner_editor' is the item's OWNER whatever their role (anyone can carry a
  // task) — every move an item makes reaches the person assigned to it, and
  // never anyone merely of the same role. The actor is always skipped, so an
  // owner acting on their own item is not self-notified.
  'draft_uploaded>internal_review': ['account_managers'],
  'internal_review>revision_required': ['owner_editor'],
  'revision_required>revision_complete': ['account_managers'],
  'revision_complete>revision_required': ['owner_editor'],
  'internal_review>client_review': ['client_users', 'account_managers', 'owner_editor'],
  'revision_complete>client_review': ['client_users', 'account_managers', 'owner_editor'],
  'client_review>client_changes_requested': ['account_managers'], // NEVER the editor directly
  'client_changes_requested>revision_required': ['owner_editor'],
  'client_changes_requested>client_review': ['client_users', 'account_managers', 'owner_editor'],
  // approving never blasts every scheduler — 'assigned_schedulers' is only the
  // people already on THIS item's scheduler_ids (set by the explicit 'Hand to
  // a scheduler' action); with none assigned, no scheduler hears anything
  'client_review>approved_for_scheduling': ['account_managers', 'owner_editor', 'assigned_schedulers'],
  'internal_review>approved_for_scheduling': ['account_managers', 'owner_editor', 'assigned_schedulers'],
  'revision_complete>approved_for_scheduling': ['account_managers', 'owner_editor', 'assigned_schedulers'],
  'approved_for_scheduling>scheduled': ['account_managers', 'owner_editor'],
  'scheduled>published': ['account_managers', 'owner_editor', 'assigned_schedulers'],
}
