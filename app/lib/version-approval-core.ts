import { fileRound } from './edit-round-core'

/**
 * APPROVED CLIPS CARRY FORWARD (the owner, 17 Sep 2026: "sometimes all
 * versions are approved and sometimes they are not — if it's approved it goes
 * into the next version; editors upload Drive links and designers upload
 * files; if it's approved then all good").
 *
 * The client approves clip by clip on their portal. When the card is sent
 * back and the next version is handed in, the clips they already approved
 * are not asked for again: they are CARRIED into the next version as already
 * good, shown with their tick, and the editor or designer hands in only what
 * needed changing. A carried clip is the same file, under the same id, from
 * the round it was approved in. A clip handed in again in the new round (the
 * same id) is not carried — the new one stands in its place.
 *
 * Once every clip in a version is approved — its own and the carried ones —
 * the version is good to accept, and the card says so.
 *
 * Pure: the page, the portal and the share link all read the same rules.
 */
export type Versioned = { id: string; version?: number | null }

export function approvedIdSet(approvals: readonly { file_id: string }[]): Set<string> {
  return new Set(approvals.map(a => a.file_id))
}

/** the approved files from earlier rounds that this round shows as already
 *  good — each once, from its latest round, never one this round hands in itself */
export function carriedInto<F extends Versioned>(all: readonly F[], round: number, approved: ReadonlySet<string>): (F & { carried_from: number })[] {
  const own = new Set(all.filter(f => fileRound(f) === round).map(f => f.id))
  const seen = new Set<string>()
  return all
    .filter(f => fileRound(f) < round && approved.has(f.id) && !own.has(f.id))
    .sort((a, b) => fileRound(b) - fileRound(a))
    .filter(f => { if (seen.has(f.id)) return false; seen.add(f.id); return true })
    .map(f => ({ ...f, carried_from: fileRound(f) }))
}

/** the version's whole set: what it hands in, plus what it carries */
export function versionSet<F extends Versioned>(all: readonly F[], round: number, approved: ReadonlySet<string>): (F & { carried_from?: number })[] {
  return [...carriedInto(all, round, approved), ...all.filter(f => fileRound(f) === round)]
}

export type VersionProgress = { approved: number; total: number; carried: number; allApproved: boolean; words: string | null }

export function versionProgress(files: readonly { id: string; carried_from?: number | null }[], approved: ReadonlySet<string>): VersionProgress {
  const total = files.length
  const carried = files.filter(f => typeof f.carried_from === 'number').length
  const done = files.filter(f => approved.has(f.id)).length
  const allApproved = total > 0 && done >= total
  const noun = (n: number) => (n === 1 ? 'clip' : 'clips')
  let words: string | null = null
  if (total === 0) words = null
  else if (allApproved) words = `All ${total} ${noun(total)} approved by the client — this version is good to go`
  else if (done > 0) words = `${done} of ${total} ${noun(total)} approved by the client · ${total - done} still to review`
  else words = null
  if (words && carried > 0) words += ` · ${carried} carried over from an earlier version`
  return { approved: done, total, carried, allApproved, words }
}

/** the note on a carried clip */
export function carriedWords(from: number | null | undefined): string | null {
  return typeof from === 'number' ? `Approved in Version ${from} — carried over` : null
}
