/**
 * THE EDITOR PREVIEW'S BOARD — lanes and what each card's face says (the owner, 21 Oct 2026: "rebuild … including the
 * buttons passed quality check color graded. give it a new look make it nicer with child pages clear that its being
 * scanned by ai"). Pure; the pages read the rows live and hand them here.
 */
import { currentFiles, isRetiredAt } from './final-files-core'
import { clipApprovalsOf } from './clip-approvals-core'
import { gradedRoundOf } from './colour-grade-core'
import { roundOf } from './edit-round-core'
import type { SeenState } from './drive-scan-core'

export type PreviewLane = { key: string; label: string; statuses: string[]; tone: 'amber' | 'blue' | 'green' | 'surface' }

export const PREVIEW_LANES: PreviewLane[] = [
  { key: 'editing', label: 'Editing', statuses: ['draft_uploaded', 'revision_required', 'revision_complete', 'client_changes_requested'], tone: 'surface' },
  { key: 'qc', label: 'Quality check', statuses: ['quality_check', 'internal_review'], tone: 'amber' },
  { key: 'grade', label: 'Colour grade', statuses: ['colour_grade'], tone: 'blue' },
  { key: 'client', label: 'With client', statuses: ['client_review'], tone: 'blue' },
  { key: 'approved', label: 'Approved', statuses: ['approved_for_scheduling'], tone: 'green' },
]

export function laneOf(status: unknown): PreviewLane | null {
  const s = String(status ?? '')
  return PREVIEW_LANES.find(l => l.statuses.includes(s)) ?? null
}

/** the stepper: where the card is on the road */
export const STEPS = ['Editing', 'Quality check', 'Colour grade', 'With client', 'Approved'] as const
export function stepOf(status: unknown): number {
  const l = laneOf(status)
  return l ? PREVIEW_LANES.indexOf(l) : -1
}

export type CardFace = {
  videos: number
  approved: number
  graded: boolean
  /** files the AI has yet to look at, or is looking at now */
  scanning: number
  /** scanned, waiting for a person to confirm */
  toConfirm: number
  /** found while the card is at the check or with the client — offered later */
  waiting: number
  sources: number
}

/** what a card's face says: its videos, how far along, and what the AI is doing with its Drive links */
export function cardFace(
  item: { id: string; final_files?: unknown; clip_approvals?: unknown; graded_round?: unknown; edit_round?: unknown },
  seen: readonly { item_id: string; state: string }[],
  sources: readonly { item_id: string }[],
): CardFace {
  const round = roundOf(item)
  const live = currentFiles(item).filter(f => !isRetiredAt(f, round))
  const approvedIds = new Set(clipApprovalsOf(item).map(a => a.file_id))
  const mine = seen.filter(s => s.item_id === item.id)
  const count = (states: SeenState[]) => mine.filter(s => (states as string[]).includes(s.state)).length
  return {
    videos: live.length,
    approved: live.filter(f => approvedIds.has(f.id)).length,
    graded: gradedRoundOf(item) === round,
    scanning: count(['new', 'scanning']),
    toConfirm: count(['scanned']),
    waiting: count(['locked']),
    sources: sources.filter(s => s.item_id === item.id).length,
  }
}

/** "checked 20s ago" */
export function agoWords(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return 'not checked yet'
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000))
  if (s < 60) return `checked ${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `checked ${m} min ago`
  return `checked ${Math.round(m / 60)} h ago`
}
