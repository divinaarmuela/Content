/**
 * EDIT ROUNDS — VERSION 1, VERSION 2, VERSION 3 (the owner, 16 Sep 2026:
 * "once we upload the Drive it downloads and is shown as version 1; when
 * it gets sent back to the editor from any point they upload the same
 * Drive link but have to re-download for version 2, because comments will
 * be there; or sometimes they upload a different Drive link — doesn't
 * matter").
 *
 * A round is counted on the card by HAND-INS of the finished edit: the
 * first finished link the editor sends is version 1; after a send-back (by
 * the quality reviewer, the manager or the client) the next hand-in — the
 * same link again, or a different one — is version 2, and so on. The pull
 * tags each new file with the round it came in with, so the same folder
 * holds version 1's files and version 2's side by side, each with its own
 * comments and ticks.
 */
export const SENT_BACK_STATUSES: readonly string[] = ['revision_required', 'client_changes_requested']

export function roundOf(item: { edit_round?: unknown } | null | undefined): number {
  const n = Number(item?.edit_round)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

/** the round the next hand-in opens */
export function nextRound(item: { edit_round?: unknown }): number {
  return roundOf(item) + 1
}

/** the round a hand-in belongs to: the next one when the card was sent
 *  back, the current one otherwise (a first hand-in is version 1) */
export function handInRound(item: { edit_round?: unknown; status?: unknown }): number {
  return SENT_BACK_STATUSES.includes(String(item.status ?? '')) ? nextRound(item) : roundOf(item)
}

export function roundLabel(n: number): string {
  return `Version ${n}`
}

/** the rounds present in a set of files, newest first — a file with no round is round 1 */
export function roundsOf(files: readonly { version?: number | null }[]): number[] {
  const set = new Set<number>()
  for (const f of files) set.add(typeof f.version === 'number' && f.version >= 1 ? f.version : 1)
  return [...set].sort((a, b) => b - a)
}

export function fileRound(f: { version?: number | null }): number {
  return typeof f.version === 'number' && f.version >= 1 ? f.version : 1
}

/**
 * THE VERSION TABS ON THE CARD PAGE (the owner, 16 Sep 2026: "when they
 * upload the finished edit, on the left there should automatically be a
 * Version 1 tab they can switch between — the folder to work from, and the
 * submitted final edit — how else can they see it?").
 *
 * A card's pull rows are its finished edits' files, each remembering the
 * round it arrived with: one tab per round, newest first, whichever link
 * that round came from. A row pulled as a folder to work from is never a
 * version; an older row that never said what it was counts only when it is
 * the card's finished link today.
 */
export type VersionTab<F extends { version?: number | null } = { version?: number | null }> = {
  round: number
  /** the link that round was handed in as (the latest, when it was pasted twice) */
  folderUrl: string
  files: F[]
  /** its files are still coming */
  inFlight: boolean
}

export function finishedVersionsOf<F extends { version?: number | null }>(
  rows: readonly { kind?: string | null; scope_id?: string | null; folder_id?: string | null; folder_url?: string | null; status?: string | null; purpose?: string | null; files?: unknown; started_at?: string | null }[],
  opts: { itemId: string; finishedFolderId: string | null; filesOf: (row: { files?: unknown }) => F[] },
): VersionTab<F>[] {
  const mine = rows
    .filter(r => r.kind === 'item' && r.scope_id === opts.itemId)
    .filter(r => r.purpose === 'finished' || (!r.purpose && !!opts.finishedFolderId && r.folder_id === opts.finishedFolderId))
    .sort((a, b) => String(a.started_at ?? '').localeCompare(String(b.started_at ?? '')))
  const byRound = new Map<number, VersionTab<F>>()
  for (const r of mine) {
    const inFlight = ['queued', 'listing', 'copying'].includes(String(r.status ?? ''))
    for (const f of opts.filesOf(r)) {
      const round = fileRound(f)
      const tab = byRound.get(round) ?? { round, folderUrl: String(r.folder_url ?? ''), files: [], inFlight: false }
      tab.files.push(f)
      tab.folderUrl = String(r.folder_url ?? '') || tab.folderUrl
      tab.inFlight = tab.inFlight || inFlight
      byRound.set(round, tab)
    }
    // a link still being read has no files yet — the tab is there, empty, with its bar
    if (inFlight && opts.filesOf(r).length === 0) {
      const round = 0
      if (!byRound.has(round)) byRound.set(round, { round, folderUrl: String(r.folder_url ?? ''), files: [], inFlight: true })
    }
  }
  // a tab for the empty in-flight row takes the round after the newest known one
  const empty = byRound.get(0)
  if (empty) {
    byRound.delete(0)
    const next = Math.max(0, ...byRound.keys()) + 1
    if (!byRound.has(next)) byRound.set(next, { ...empty, round: next })
  }
  return [...byRound.values()].sort((a, b) => b.round - a.round)
}
