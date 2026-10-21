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

/**
 * A CARD THE EDITOR WORKS ON — what the live Editor shows (board-view-core.pageCards): not archived, not a shoot plan
 * or a designer's graphics, and not a post uploaded straight onto the Schedule page (`adhoc_post`: its card only holds
 * the file; live, 21 Oct 2026, 73 of the preview board's 106 cards were those posts).
 */
export function isEditorCard(item: { archived_at?: unknown; adhoc_post?: unknown }, kindSlug: string | null | undefined): boolean {
  if (item.archived_at) return false
  if (item.adhoc_post === true) return false
  return !['shoot_brief', 'graphics'].includes(kindSlug ?? '')
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

/* ─── what happens next to each video (the owner, 22 Oct 2026: "easy to know exactly v1 etc and know which one to go
 * to grade or not and which one goes to portal") ─────────────────────────────────────────────────────────────── */

export type NextTone = 'muted' | 'amber' | 'blue' | 'green'
export type VideoNext = { words: string; tone: NextTone }

/**
 * ONE VIDEO'S NEXT STEP, in the card's process: with the editor → quality check → colour grade (a video edit) →
 * the client's portal → approved. Pure: the card's stage, whether its kind is graded, whether this round's grade has
 * landed, whether the client approved this video, and whether a new cut of it is waiting in Drive.
 */
export function videoNext(v: {
  status: unknown; needsGrade: boolean; gradedThisRound: boolean; approved: boolean; newInDrive: boolean; gone?: boolean; onCard?: boolean
}): VideoNext {
  if (v.gone) return { words: 'Removed from Drive — the card keeps its copy', tone: 'muted' }
  // a new cut of a video on the card, or a whole new video
  if (v.newInDrive) return { words: v.onCard === false ? 'New video in Drive — confirm it' : 'New cut in Drive — confirm it', tone: 'amber' }
  if (v.approved) return { words: 'Approved by the client', tone: 'green' }
  switch (String(v.status ?? '')) {
    case 'draft_uploaded': case 'revision_required': case 'revision_complete': case 'client_changes_requested':
      return { words: 'With the editor', tone: 'muted' }
    case 'quality_check': case 'internal_review':
      return { words: v.needsGrade ? 'Quality check — then colour grade' : 'Quality check — then the portal', tone: 'amber' }
    case 'colour_grade':
      return v.gradedThisRound ? { words: 'Graded — ready for the portal', tone: 'blue' } : { words: 'Needs colour grade', tone: 'blue' }
    case 'client_review':
      return { words: 'On the client’s portal', tone: 'blue' }
    case 'approved_for_scheduling': case 'scheduled': case 'published':
      return { words: 'Approved', tone: 'green' }
    default:
      return { words: '—', tone: 'muted' }
  }
}

/** a person's initials for a card face: "Ryan Patumaka" → "RP" */
export function initialsOfName(name: string | null | undefined): string {
  const parts = String(name ?? '').trim().split(/[\s@._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}
