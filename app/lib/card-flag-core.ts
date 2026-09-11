/**
 * THE TWO FLAGS AN EDITOR RAISES ON A CARD — pure.
 *
 * The Video Editors SOP: "Acknowledge new editing tasks the same day they're
 * assigned" and "Flag any deadline risk early, the moment you see it, not on
 * the due date". Neither moves the card; both are lines in its history that
 * the board reads back ("Acknowledged", a red "Deadline at risk" chip).
 */
import type { Role } from './identity-core'
import { blockerNeed, qcComplete, type BlockerNeed } from './editor-sop-core'

export const FLAG_KINDS = ['acknowledged', 'deadline_risk', 'qc_done', 'handover_drive', 'handover_source', 'blocked', 'unblocked'] as const
export type FlagKind = (typeof FLAG_KINDS)[number]

export const RISK_NOTE_MAX = 500

/** Who may raise a flag: the card's holder, or a manager on their behalf. */
export function mayFlag(viewer: { id: string; role: Role }, ownerId: string | null): boolean {
  if (viewer.role === 'super_admin' || viewer.role === 'account_manager') return true
  return !!ownerId && ownerId === viewer.id
}

export type FlagCheck =
  | { ok: true; kind: FlagKind; note: string; ticks: string[]; need: BlockerNeed | null }
  | { ok: false; reason: string; status: 400 | 403 }

export function flagCheck(input: {
  kind: unknown; note: unknown; ticks?: unknown; need?: unknown
  viewer: { id: string; role: Role }; ownerId: string | null
}): FlagCheck {
  const kind = String(input.kind ?? '')
  if (!(FLAG_KINDS as readonly string[]).includes(kind)) return { ok: false, reason: 'Say what you are flagging', status: 400 }
  if (!mayFlag(input.viewer, input.ownerId)) {
    return { ok: false, reason: 'Only the person holding this card, or a manager, can flag it', status: 403 }
  }
  const note = String(input.note ?? '').trim().slice(0, RISK_NOTE_MAX)
  if (kind === 'deadline_risk' && !note) return { ok: false, reason: 'Say in a line why the date is at risk', status: 400 }
  const ticks = Array.isArray(input.ticks) ? input.ticks.map(String) : []
  // §4: every check ticked, or it does not count
  if (kind === 'qc_done' && !qcComplete(ticks)) return { ok: false, reason: 'Tick every check before you submit', status: 400 }
  const need = kind === 'blocked' ? (blockerNeed(input.need)?.key ?? null) : null
  if (kind === 'blocked' && !need) return { ok: false, reason: 'Pick what you need from the list', status: 400 }
  if (kind === 'blocked' && !note) return { ok: false, reason: 'Say in a line what is blocked', status: 400 }
  return { ok: true, kind: kind as FlagKind, note, ticks, need }
}

/** Read the flags back off a card's activity rows: has THIS person
 *  acknowledged it, and is a deadline risk standing (raised after the last
 *  time the card was assigned, or ever when nothing says otherwise). */
export function flagsOf(
  rows: readonly { action: string; actor_id?: string | null; detail?: string | null; created_at?: string | null }[],
  viewerId: string,
): { acknowledged: boolean; risk: string | null } {
  let acknowledged = false
  let risk: { note: string; at: string } | null = null
  for (const r of rows) {
    if (r.action === 'acknowledged' && r.actor_id === viewerId) acknowledged = true
    if (r.action === 'deadline_risk') {
      const at = String(r.created_at ?? '')
      if (!risk || at > risk.at) risk = { note: String(r.detail ?? '').trim(), at }
    }
  }
  return { acknowledged, risk: risk ? (risk.note || 'Deadline at risk') : null }
}

/** The chip on the card: "Deadline at risk", or the editor's own words cut short. */
export function riskChip(risk: string | null): string | null {
  if (!risk) return null
  const words = risk.trim()
  return words.length > 48 ? `At risk: ${words.slice(0, 45).trimEnd()}…` : `At risk: ${words}`
}
