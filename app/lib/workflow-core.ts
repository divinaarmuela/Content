/**
 * Pure production-workflow state machine — no imports, fully unit-testable.
 * Encodes doc 1's status funnel (§4), transition permissions (§5, §10), and
 * client-visible label translation. The server engine (workflow.ts) executes
 * these rules; nothing else in the codebase decides what moves where.
 */
import type { Role } from './identity-core'

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
}

/** The funnel. Key: from-status → to-status → rule. Anything absent is illegal. */
export const TRANSITIONS: Partial<Record<ItemStatus, Partial<Record<ItemStatus, TransitionRule>>>> = {
  draft_uploaded: {
    internal_review: { roles: ['editor', 'account_manager'], requires: 'reviewable_asset', label: 'Submit for internal review' },
  },
  internal_review: {
    revision_required: { roles: ['account_manager'], label: 'Request revisions' },
    client_review: { roles: ['account_manager'], label: 'Send to client' },
    approved_for_scheduling: { roles: ['account_manager'], label: 'Approve for scheduling' }, // client approval bypass
  },
  revision_required: {
    revision_complete: { roles: ['editor'], requires: 'reviewable_asset', label: 'Mark revision complete' },
  },
  revision_complete: {
    client_review: { roles: ['account_manager'], label: 'Send to client' },
    revision_required: { roles: ['account_manager'], label: 'Request further revisions' },
    approved_for_scheduling: { roles: ['account_manager'], label: 'Approve for scheduling' },
  },
  client_review: {
    client_changes_requested: { roles: ['client', 'account_manager'], label: 'Request changes' },
    approved_for_scheduling: { roles: ['client', 'account_manager'], label: 'Approve' },
  },
  client_changes_requested: {
    revision_required: { roles: ['account_manager'], label: 'Assign changes to editor' },
    // the small-fix path: the manager corrected it on the spot — straight
    // back to the client, no assignment ceremony for a one-word change
    client_review: { roles: ['account_manager'], label: 'Fixed — send back to client' },
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

export type TransitionCheck =
  | { ok: true; rule: TransitionRule }
  | { ok: false; reason: string }

/** Is `from → to` legal for this role? super_admin may perform any defined
 *  transition (doc: admin can override statuses) but never an undefined one. */
export function checkTransition(role: Role, from: ItemStatus, to: ItemStatus): TransitionCheck {
  const rule = TRANSITIONS[from]?.[to]
  if (!rule) return { ok: false, reason: `No transition from ${from} to ${to}` }
  if (role === 'super_admin') return { ok: true, rule }
  if (!rule.roles.includes(role)) {
    return { ok: false, reason: `${role} may not perform "${rule.label}"` }
  }
  return { ok: true, rule }
}

/** Transitions available to a role from a given status (for rendering buttons). */
export function availableTransitions(role: Role, from: ItemStatus): { to: ItemStatus; label: string; requires?: TransitionRequirement }[] {
  const outs = TRANSITIONS[from] ?? {}
  return (Object.entries(outs) as [ItemStatus, TransitionRule][])
    .filter(([, rule]) => role === 'super_admin' || rule.roles.includes(role))
    .map(([to, rule]) => ({ to, label: rule.label, requires: rule.requires }))
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
