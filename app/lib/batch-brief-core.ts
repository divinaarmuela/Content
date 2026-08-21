/**
 * Pure shoot-brief lifecycle — no I/O, mirroring workflow-core.ts.
 *
 * A batch IS the shoot brief: it is planned (brief), its date is locked
 * (locked — the explicit commitment that opens production), it happens
 * (shot), and eventually it is wrapped. Content items may only be created
 * under a locked or shot brief; an account manager can go around the gate
 * for genuinely ad-hoc work, but must say why, and the reason is logged.
 */

import type { Role } from './identity-core'

export const BATCH_STATUSES = ['brief', 'locked', 'shot', 'wrapped'] as const
export type BatchStatus = (typeof BATCH_STATUSES)[number]

export type BatchTransitionRule = { roles: Role[]; label: string }

export const BATCH_TRANSITIONS: Partial<Record<BatchStatus, Partial<Record<BatchStatus, BatchTransitionRule>>>> = {
  brief: {
    locked: { roles: ['editor', 'account_manager'], label: 'Lock shoot date' },
  },
  locked: {
    brief: { roles: ['account_manager'], label: 'Unlock' },
    shot: { roles: ['editor', 'account_manager'], label: 'Mark as shot' },
    wrapped: { roles: ['account_manager'], label: 'Wrap shoot' },
  },
  shot: {
    wrapped: { roles: ['account_manager'], label: 'Wrap shoot' },
  },
}

export type BatchTransitionCheck =
  | { ok: true; rule: BatchTransitionRule }
  | { ok: false; reason: string }

export function checkBatchTransition(role: Role, from: BatchStatus, to: BatchStatus): BatchTransitionCheck {
  const rule = BATCH_TRANSITIONS[from]?.[to]
  if (!rule) return { ok: false, reason: `No transition from ${from} to ${to}` }
  if (role === 'super_admin') return { ok: true, rule }
  if (!rule.roles.includes(role)) {
    return { ok: false, reason: `${role} may not perform "${rule.label}"` }
  }
  return { ok: true, rule }
}

/** Transitions a role can perform from a status (for rendering buttons). */
export function availableBatchTransitions(role: Role, from: BatchStatus): { to: BatchStatus; label: string }[] {
  const out: { to: BatchStatus; label: string }[] = []
  for (const [to, rule] of Object.entries(BATCH_TRANSITIONS[from] ?? {})) {
    if (!rule) continue
    if (role === 'super_admin' || rule.roles.includes(role)) {
      out.push({ to: to as BatchStatus, label: rule.label })
    }
  }
  return out
}

/** Locking is a commitment — it needs something to commit to. */
export function batchSatisfiesLock(b: { title?: string | null; shoot_date?: string | null }): boolean {
  if (!b.title || !String(b.title).trim()) return false
  const d = String(b.shoot_date ?? '').trim()
  return d !== '' && !Number.isNaN(new Date(d).getTime())
}

/**
 * The production gate: may this person create content items here?
 *  - under a locked or shot brief: any item-creating role (editor+)
 *  - under a brief/wrapped one: nobody — the point of the stage
 *  - with NO batch at all: account managers and up only, WITH a stated
 *    reason (supers included — auditability is the point, not trust)
 */
export function canCreateItemsUnder(
  batchStatus: BatchStatus | null,
  role: Role,
  adhoc?: { reason: string },
): boolean {
  if (role === 'client' || role === 'scheduler') return false
  if (batchStatus === 'locked' || batchStatus === 'shot') return true
  if (batchStatus === null) {
    if (role !== 'account_manager' && role !== 'super_admin') return false
    return Boolean(adhoc?.reason && adhoc.reason.trim())
  }
  return false
}

/** Display helper: a brief with items under way reads as "in production". */
export function isInProduction(b: { status: BatchStatus }, itemCount: number): boolean {
  return (b.status === 'locked' || b.status === 'shot') && itemCount > 0
}

/** Who hears about a brief's lifecycle moments. */
export const BATCH_TRANSITION_NOTIFICATIONS: Record<string, ('owner_editor' | 'account_managers')[]> = {
  'brief>locked': ['owner_editor', 'account_managers'],
  'locked>shot': ['account_managers'],
}
