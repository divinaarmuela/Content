/**
 * EDIT ROUNDS — VERSION 1, VERSION 2, VERSION 3 (the owner, 16 Sep 2026:
 * "once we upload the Drive it downloads and is shown as version 1; when
 * it gets sent back to the editor from any point they upload the same
 * Drive link but have to re-download for version 2, because comments will
 * be there; or sometimes they upload a different Drive link — doesn't
 * matter").
 *
 * A round is counted on the card: it starts at 1 and goes up by one the
 * moment the card is sent back — by the quality reviewer, the manager or
 * the client. Everything the editor hands in after that is the new round:
 * the pull tags each new file with it, so the same folder holds version 1's
 * files and version 2's side by side, each with its own comments and ticks.
 */
export const SENT_BACK_STATUSES: readonly string[] = ['revision_required', 'client_changes_requested']

export function roundOf(item: { edit_round?: unknown } | null | undefined): number {
  const n = Number(item?.edit_round)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

/** the round a send-back opens */
export function nextRound(item: { edit_round?: unknown }): number {
  return roundOf(item) + 1
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
