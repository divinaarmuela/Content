/**
 * Pure shoot-brief-task logic — no I/O.
 *
 * A brief task is a content_item of kind 'shoot_brief' that rides the normal
 * item state machine, wearing its own words: it starts as a brief in progress,
 * reviews like everything else, and ends "Shoot booked". workflow-core.ts is
 * untouched — nothing else decides what moves where; this only relabels and
 * overrides a handful of edges for one kind.
 */

import type { Role } from './identity-core'
import { checkTransitionAs, STATUS_TURN, TRANSITIONS, type ItemStatus, type TransitionCheck } from './workflow-core'

export const SHOOT_BRIEF_SLUG = 'shoot_brief'

/** What each stage is CALLED for a brief task. */
export const BRIEF_KIND_LABELS: Record<ItemStatus, string> = {
  draft_uploaded: 'Brief in progress',
  internal_review: 'Brief ready for review',
  revision_required: 'Brief being revised',
  revision_complete: 'Brief revised — check again',
  client_review: 'Plan with client',
  client_changes_requested: 'Client wants plan changes',
  approved_for_scheduling: 'Plan approved — book the shoot',
  scheduled: 'Shoot booked',
  published: 'Shoot booked',
}

/**
 * Whose move it is on a BRIEF. A brief ends with an account manager booking
 * the shoot — no scheduler ever touches one, and a booked brief is finished.
 */
export const BRIEF_STATUS_TURN: Record<ItemStatus, Role | null> = {
  ...STATUS_TURN,
  approved_for_scheduling: 'account_manager',
  scheduled: null,
  published: null,
}

/** The same explanations, worded for a plan rather than a piece of content. */
export const BRIEF_STATUS_MEANING: Record<ItemStatus, string> = {
  draft_uploaded: 'The brief is still being written.',
  internal_review: 'Waiting for an account manager to check the plan.',
  revision_required: 'Changes were asked for; the brief is being reworked.',
  revision_complete: 'The changes are in; an account manager needs to look again.',
  client_review: 'Waiting for the client to approve the plan or ask for changes.',
  client_changes_requested: 'An account manager decides: rework the plan, or reshare it as is.',
  approved_for_scheduling: 'The plan is signed off. Lock the shoot date, then book it.',
  scheduled: 'The shoot is booked.',
  published: 'The shoot is booked.',
}

/** The status label any surface should show, given the item's kind. */
export function itemStatusLabel(kindSlug: string | null | undefined, status: ItemStatus, fallback: string): string {
  return kindSlug === SHOOT_BRIEF_SLUG ? BRIEF_KIND_LABELS[status] ?? fallback : fallback
}

type Override = { label: string; roles: Role[]; requires?: 'batch_locked' } | { blocked: true }

/** Edges that behave differently for a brief task. Everything else falls
 *  through to checkTransition unchanged. */
export const BRIEF_TRANSITION_OVERRIDES: Record<string, Override> = {
  'draft_uploaded>internal_review': { label: 'Submit brief for review', roles: ['editor', 'account_manager'] },
  'internal_review>revision_required': { label: 'Ask for changes', roles: ['account_manager'] },
  'revision_required>revision_complete': { label: 'Brief revisions done', roles: ['editor', 'account_manager'] },
  // the content-pipeline words ("Send to client", "Approve for scheduling")
  // read wrong on a shoot PLAN — same edges, plan-shaped language
  'internal_review>client_review': { label: 'Share plan with client', roles: ['account_manager'] },
  'revision_complete>client_review': { label: 'Share plan with client', roles: ['account_manager'] },
  'revision_complete>revision_required': { label: 'Ask for more changes', roles: ['account_manager'] },
  // for the team this is a RECORD of what the client said, not their own
  // approval — the plain word read as "I approve this"
  'client_review>approved_for_scheduling': { label: "Log the client's approval", roles: ['client', 'account_manager'] },
  'internal_review>approved_for_scheduling': { label: 'Approve plan without client', roles: ['account_manager'] },
  'revision_complete>approved_for_scheduling': { label: 'Approve plan without client', roles: ['account_manager'] },
  'client_review>client_changes_requested': { label: "Log the client's changes", roles: ['client', 'account_manager'] },
  'client_changes_requested>revision_required': { label: 'Send plan for revision', roles: ['account_manager'] },
  'client_changes_requested>client_review': { label: 'No change needed — reshare', roles: ['account_manager'] },
  // booking = the date is locked on the shoot; an AM makes the call
  'approved_for_scheduling>scheduled': { label: 'Book the shoot', roles: ['account_manager'], requires: 'batch_locked' },
  // a brief never "publishes" — booked is its end state, for everyone
  'scheduled>published': { blocked: true },
}

export type BriefTransitionCheck = TransitionCheck & { requires?: 'batch_locked' }

export function checkBriefTaskTransitionAs(
  roles: readonly Role[], from: ItemStatus, to: ItemStatus,
): BriefTransitionCheck {
  const exists = TRANSITIONS[from]?.[to]
  if (!exists) return { ok: false, reason: `No transition from ${from} to ${to}` }
  const override = BRIEF_TRANSITION_OVERRIDES[`${from}>${to}`]
  if (!override) return checkTransitionAs(roles, from, to)
  if ('blocked' in override) {
    return { ok: false, reason: 'A booked shoot is the end of the brief — the content items publish, not the brief' }
  }
  if (!roles.includes('super_admin') && !override.roles.some(r => roles.includes(r))) {
    return { ok: false, reason: `${roles.join('/') || 'nobody'} may not perform "${override.label}"` }
  }
  // labelFor is left behind: a brief override says the same thing to every hat
  const { labelFor: _drop, ...base } = exists
  return {
    ok: true,
    rule: { ...base, label: override.label, roles: override.roles },
    requires: override.requires,
  }
}

export function checkBriefTaskTransition(role: Role, from: ItemStatus, to: ItemStatus): BriefTransitionCheck {
  return checkBriefTaskTransitionAs([role], from, to)
}

/** Buttons for a brief task — from the FULL set of outgoing edges, judged by
 *  the brief's own rules. Deriving from availableTransitions() first silently
 *  dropped every edge whose base roles differ (an account manager could never
 *  see "Brief revisions done" because the base edge is editors-only). */
export function availableBriefTaskTransitionsAs(
  roles: readonly Role[], from: ItemStatus,
): { to: ItemStatus; label: string }[] {
  const outs = TRANSITIONS[from] ?? {}
  return (Object.keys(outs) as ItemStatus[])
    .map(to => {
      const c = checkBriefTaskTransitionAs(roles, from, to)
      return c.ok ? { to, label: c.rule.label } : null
    })
    .filter((t): t is NonNullable<typeof t> => t !== null)
}

export function availableBriefTaskTransitions(
  role: Role, from: ItemStatus,
): { to: ItemStatus; label: string }[] {
  return availableBriefTaskTransitionsAs([role], from)
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
