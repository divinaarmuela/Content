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
