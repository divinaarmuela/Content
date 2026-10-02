/**
 * THE SPLIT (docs/COLOUR_GRADE_SPLIT_SPEC.md C6–C9, the owner, 2 Oct 2026: "approved videos from the client gets sent
 * to the handover … unapproved videos goes back and notify the editor … its like a fresh card but the title says round
 * 2"). Pure: what a split of this card would do, the Round N card's title and words. No I/O — split.ts does the work.
 */
import { clipApprovalsOf } from './clip-approvals-core'
import { assetIdOf, versionSnapshot } from './final-files-core'
import { roundOf } from './edit-round-core'

/** a card the client is looking at, or has asked changes on, is one a split may act on */
export const SPLIT_STATUSES = ['client_review', 'client_changes_requested'] as const

export type SplitVideo = { id: string; asset_id: string; name: string; url: string | null }

export type SplitPlan =
  | { kind: 'all'; round: number; approved: SplitVideo[]; open: [] }
  | { kind: 'none'; round: number; approved: []; open: SplitVideo[] }
  | { kind: 'split'; round: number; approved: SplitVideo[]; open: SplitVideo[] }

type SplitItem = { status?: unknown; final_files?: unknown; clip_approvals?: unknown; edit_round?: unknown; split_at?: unknown }

/** the videos the client was shown at this version, each approved or not — or the reason there is nothing to split */
export function splitPlan(item: SplitItem): SplitPlan | { kind: 'refused'; reason: string } {
  if (!SPLIT_STATUSES.includes(String(item.status ?? '') as never)) return { kind: 'refused', reason: 'Only a card with the client can be split' }
  const round = roundOf(item as never)
  const shown = versionSnapshot(item as never, round)
  if (shown.length === 0) return { kind: 'refused', reason: 'There are no videos on this card to split' }
  const ticked = new Set(clipApprovalsOf(item as never).map(a => a.file_id))
  const video = (f: { id: string; name: string; url?: string | null }): SplitVideo => ({ id: f.id, asset_id: assetIdOf(f as never), name: f.name, url: f.url ?? null })
  const approved = shown.filter(f => ticked.has(f.id)).map(video)
  const open = shown.filter(f => !ticked.has(f.id)).map(video)
  if (open.length === 0) return { kind: 'all', round, approved, open: [] }
  if (approved.length === 0) return { kind: 'none', round, approved: [], open }
  return { kind: 'split', round, approved, open }
}

/** "September Videos - Justin" → "September Videos - Justin · Round 2"; a Round 2 card split again → "· Round 3" */
export function roundTitle(title: string | null | undefined, splitRound: number | null | undefined): string {
  const base = String(title ?? '').replace(/\s*·\s*Round \d+\s*$/i, '').trim() || 'Untitled'
  const n = (Number.isInteger(Number(splitRound)) && Number(splitRound) >= 2 ? Number(splitRound) : 1) + 1
  return `${base} · Round ${n}`
}

/** the round number the new card is */
export function nextSplitRound(splitRound: number | null | undefined): number {
  const n = Number(splitRound)
  return (Number.isInteger(n) && n >= 2 ? n : 1) + 1
}

/** the unapproved videos as the Round N card's files to work from — the editor sees and plays what the client did not approve */
export function notApprovedFiles(open: readonly SplitVideo[]): { url: string; name: string }[] {
  return open.filter(v => !!v.url).map(v => ({ url: v.url!, name: `Not approved — ${v.name}` }))
}

/** each thing the client said on an unapproved video, as a note on the Round N card, naming the video */
export function carriedNotes(open: readonly SplitVideo[], notes: readonly ClipNote[]): string[] {
  const out: string[] = []
  for (const v of open) {
    for (const n of notes) {
      if (n.visibility !== 'client' || n.video_file_id !== v.id) continue
      const said = String(n.body ?? '').trim()
      if (said) out.push(`The client on ${v.name}: ${said}`)
    }
  }
  return out
}

export type ClipNote = { video_file_id?: string | null; body?: string | null; visibility?: string | null }

/** what the editor reads on the Round N card: which videos, and what the client said on each */
export function roundNote(open: readonly SplitVideo[], notes: readonly ClipNote[], approvedCount: number): string {
  const lines = open.map(v => {
    const said = notes.filter(n => n.visibility === 'client' && n.video_file_id === v.id).map(n => String(n.body ?? '').trim()).filter(Boolean)
    return `• ${v.name}${said.length ? ` — the client said: ${said.join(' / ')}` : ''}`
  })
  return [
    `The client did not approve ${open.length === 1 ? 'this video' : `these ${open.length} videos`}${approvedCount ? ` (the ${approvedCount} they approved went to handover)` : ''}:`,
    ...lines,
    'Upload a new Google Drive link with the new versions of these videos, then submit.',
  ].join('\n')
}
