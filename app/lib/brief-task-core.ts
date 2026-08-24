/**
 * Pure shoot-brief-task logic — no I/O.
 *
 * A brief task is a content_item of kind 'shoot_brief' that rides the normal
 * item state machine, wearing its own words: it starts as "Shoot brief",
 * reviews like everything else, and ends "Shoot booked". workflow-core.ts is
 * untouched — nothing else decides what moves where; this only relabels and
 * overrides a handful of edges for one kind.
 */

import type { Role } from './identity-core'
import { checkTransition, TRANSITIONS, type ItemStatus, type TransitionCheck } from './workflow-core'

export const SHOOT_BRIEF_SLUG = 'shoot_brief'

/** What each stage is CALLED for a brief task. */
export const BRIEF_KIND_LABELS: Record<ItemStatus, string> = {
  draft_uploaded: 'Shoot brief',
  internal_review: 'Internal review',
  revision_required: 'Revisions requested',
  revision_complete: 'Revisions done',
  client_review: 'Client review',
  client_changes_requested: 'Client changes',
  approved_for_scheduling: 'Approved — book it',
  scheduled: 'Shoot booked',
  published: 'Shoot booked',
}

/** The status label any surface should show, given the item's kind. */
export function itemStatusLabel(kindSlug: string | null | undefined, status: ItemStatus, fallback: string): string {
  return kindSlug === SHOOT_BRIEF_SLUG ? BRIEF_KIND_LABELS[status] ?? fallback : fallback
}

type Override = { label: string; roles: Role[]; requires?: 'batch_locked' } | { blocked: true }

/** Edges that behave differently for a brief task. Everything else falls
 *  through to checkTransition unchanged. */
const BRIEF_TRANSITION_OVERRIDES: Record<string, Override> = {
  'draft_uploaded>internal_review': { label: 'Submit brief for review', roles: ['editor', 'account_manager'] },
  'revision_required>revision_complete': { label: 'Mark revisions done', roles: ['editor', 'account_manager'] },
  // the content-pipeline words ("Send to client", "Approve for scheduling")
  // read wrong on a shoot PLAN — same edges, plan-shaped language
  'internal_review>client_review': { label: 'Share the plan with the client', roles: ['account_manager'] },
  'revision_complete>client_review': { label: 'Share the plan with the client', roles: ['account_manager'] },
  'client_review>approved_for_scheduling': { label: 'Plan approved — ready to book', roles: ['client', 'account_manager'] },
  'internal_review>approved_for_scheduling': { label: 'Approve the plan', roles: ['account_manager'] },
  'revision_complete>approved_for_scheduling': { label: 'Approve the plan', roles: ['account_manager'] },
  'client_review>client_changes_requested': { label: 'Client wants changes', roles: ['client', 'account_manager'] },
  'client_changes_requested>revision_required': { label: 'Send back for changes', roles: ['account_manager'] },
  'client_changes_requested>client_review': { label: 'Share the updated plan with the client', roles: ['account_manager'] },
  // booking = the date is locked on the shoot; an AM makes the call
  'approved_for_scheduling>scheduled': { label: 'Mark shoot booked', roles: ['account_manager'], requires: 'batch_locked' },
  // a brief never "publishes" — booked is its end state, for everyone
  'scheduled>published': { blocked: true },
}

export type BriefTransitionCheck = TransitionCheck & { requires?: 'batch_locked' }

export function checkBriefTaskTransition(role: Role, from: ItemStatus, to: ItemStatus): BriefTransitionCheck {
  const exists = TRANSITIONS[from]?.[to]
  if (!exists) return { ok: false, reason: `No transition from ${from} to ${to}` }
  const override = BRIEF_TRANSITION_OVERRIDES[`${from}>${to}`]
  if (!override) return checkTransition(role, from, to)
  if ('blocked' in override) {
    return { ok: false, reason: 'A booked shoot is the end of the brief — the content items publish, not the brief' }
  }
  if (role !== 'super_admin' && !override.roles.includes(role)) {
    return { ok: false, reason: `${role} may not perform "${override.label}"` }
  }
  return { ok: true, rule: { ...exists, label: override.label, roles: override.roles }, requires: override.requires }
}

/** A brief may go to review once it has SOMETHING to review: an external
 *  link, or real content on our brief page. */
export function briefSatisfiesSubmission(
  item: { brief_url?: string | null },
  batch: { concept?: string | null; shot_list?: unknown[] | null } | null,
): { ok: true } | { ok: false; missing: string } {
  if (item.brief_url && String(item.brief_url).trim() !== '') return { ok: true }
  if (batch?.concept && String(batch.concept).trim() !== '') return { ok: true }
  if (Array.isArray(batch?.shot_list) && batch.shot_list.length > 0) return { ok: true }
  return { ok: false, missing: 'Add a brief link or fill in the brief page first' }
}
