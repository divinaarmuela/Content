import { fileRound, handInRound, roundOf } from './edit-round-core'
import { clipApprovalsOf, qcApprovalsOf } from './clip-approvals-core'
import { finalFilesForRound, finalFilesOf } from './final-files-core'

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

/** THE CLIPS THAT LEFT (the owner, 17 Sep 2026: "approved assets don't get
 *  sent back to editors — approved goes into handover with the same card
 *  data"): the ids a send-back moved onto a handover card. They are out of
 *  the editor's version from then on — not carried, not shown, not shared. */
export function movedIdSet(item: { split_out?: unknown } | null | undefined): Set<string> {
  const raw = item?.split_out
  return new Set(Array.isArray(raw) ? raw.map(String) : [])
}

/** the approved files from earlier rounds that this round shows as already
 *  good — each once, from its latest round, never one this round hands in itself,
 *  never one that left on a handover card */
export function carriedInto<F extends Versioned>(all: readonly F[], round: number, approved: ReadonlySet<string>, moved: ReadonlySet<string> = new Set()): (F & { carried_from: number })[] {
  const own = new Set(all.filter(f => fileRound(f) === round).map(f => f.id))
  const seen = new Set<string>()
  return all
    .filter(f => fileRound(f) < round && approved.has(f.id) && !own.has(f.id) && !moved.has(f.id))
    .sort((a, b) => fileRound(b) - fileRound(a))
    .filter(f => { if (seen.has(f.id)) return false; seen.add(f.id); return true })
    .map(f => ({ ...f, carried_from: fileRound(f) }))
}

/** the version's whole set: what it hands in, plus what it carries — minus what left */
export function versionSet<F extends Versioned>(all: readonly F[], round: number, approved: ReadonlySet<string>, moved: ReadonlySet<string> = new Set()): (F & { carried_from?: number })[] {
  return [...carriedInto(all, round, approved, moved), ...all.filter(f => fileRound(f) === round && !moved.has(f.id))]
}

/** THE SPLIT AT SEND-BACK: the approved clips go to handover, the rest stay */
export function splitApproved<F extends { id: string }>(version: readonly F[], approved: ReadonlySet<string>): { handoff: F[]; remaining: F[] } {
  return { handoff: version.filter(f => approved.has(f.id)), remaining: version.filter(f => !approved.has(f.id)) }
}

/** the to-the-client card's title: the part that passed the quality check */
export function toClientTitle(title: string, round: number): string {
  return `${String(title ?? '').trim() || 'Untitled'} — passed quality check, Version ${round}`
}

/** the handover card's title: the same card, said to be the approved part */
export function handoffTitle(title: string, round: number): string {
  return `${String(title ?? '').trim() || 'Untitled'} — approved from Version ${round}`
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

/** THE CLIPS THAT NEED CHANGING (the owner, 18 Sep 2026: "if it's sent back,
 *  a badge for the person editing that it needs changing, so they know"): on
 *  a card sent back, every clip of the version that went to the client and
 *  did not come back approved. Approved ones left for handover or wear their
 *  tick; the rest are the work. */
export const SENT_BACK = ['revision_required', 'client_changes_requested'] as const
export function needsChangingIds(
  card: { status?: unknown },
  version: readonly { id: string }[],
  approved: ReadonlySet<string>,
): Set<string> {
  if (!(SENT_BACK as readonly string[]).includes(String(card.status ?? ''))) return new Set()
  return new Set(version.filter(f => !approved.has(f.id)).map(f => f.id))
}
export const NEEDS_CHANGING = 'Needs changing'

/**
 * THE NEXT VERSION IS NOT IN YET (the owner, 18 Sep 2026: "when it's sent back,
 * on the main view there is a submit for quality check button like they have
 * yet to upload it — why is there a button there?"). On a sent-back card the
 * submit waits until the new version is on the card: files for the round the
 * send-back opened, or — on a link card — the finished-edit link saved again
 * since the send-back (the same link is fine; saving it is the hand-in that
 * pulls the new cut). Not sent back → nothing pending.
 */
export function newVersionPending(card: {
  status?: unknown; edit_round?: unknown; final_files?: unknown; link_url?: unknown
  link_saved_at?: unknown; change_note_at?: unknown; work_kinds?: { slug?: string | null } | null
}): boolean {
  if (!(SENT_BACK as readonly string[]).includes(String(card.status ?? ''))) return false
  const round = handInRound(card as never)
  if (finalFilesForRound(card as never, round).length > 0) return false
  const filesCard = finalFilesOf(card as never).length > 0 || card.work_kinds?.slug === 'graphics'
  if (filesCard) return true
  if (!String(card.link_url ?? '').trim()) return true
  const saved = typeof card.link_saved_at === 'string' ? card.link_saved_at : ''
  const asked = typeof card.change_note_at === 'string' ? card.change_note_at : ''
  return !saved || (!!asked && saved < asked)
}

/** the words on the greyed button and under it */
export function newVersionWords(card: Parameters<typeof newVersionPending>[0]): string {
  const round = handInRound(card as never)
  const filesCard = finalFilesOf(card as never).length > 0 || card.work_kinds?.slug === 'graphics'
  return filesCard ? `Upload Version ${round} first` : `Save the Version ${round} link first — the same link is fine`
}

/** A TEAM APPROVAL IS FOR THE CLIENT'S STAGE ONLY (the owner, 18 Sep 2026:
 *  "why can the AM click approve in quality check?"): the manager ticks a clip
 *  for the client when the client told them in person — so only while the
 *  card is with the client. Before that the quality check is the road. */
export const WITH_CLIENT = ['client_review', 'client_changes_requested'] as const
export function mayApproveForClient(card: { status?: unknown }): boolean {
  return (WITH_CLIENT as readonly string[]).includes(String(card.status ?? ''))
}

/**
 * WHAT THE STAGE BUTTONS ACT ON (the owner, 18 Sep 2026: "what if some assets
 * passed the quality review and some need sending back — what will the pass
 * button do?"). Once assets have moved on one by one, the card-level buttons
 * act on THE REST: "Passed quality check" passes the rest to the client, "Log
 * the client's approval" accepts the rest, "Send back" sends the rest back.
 * The buttons say so, with the count, whenever something already moved on.
 */
export function versionRest(
  card: { status?: unknown; edit_round?: unknown; clip_approvals?: unknown; qc_approvals?: unknown; split_out?: unknown },
  all: readonly Versioned[],
): { total: number; movedOn: number; rest: number } {
  const round = fileRound({ version: roundOf(card as never) })
  const moved = movedIdSet(card)
  const approved = approvedIdSet(clipApprovalsOf(card as never))
  const here = versionSet(all, round, approved, moved)
  const movedOn = all.filter(f => fileRound(f) === round && moved.has(f.id)).length
  const status = String(card.status ?? '')
  const done = status === 'quality_check'
    ? approvedIdSet(qcApprovalsOf(card as never))
    : (WITH_CLIENT as readonly string[]).includes(status) ? approved : new Set<string>()
  const rest = here.filter(f => !done.has(f.id)).length
  return { total: here.length + movedOn, movedOn, rest }
}

/** the button's words once something moved on: "…— the 2 clips left" */
export function withRestWords(label: string, counts: { movedOn: number; rest: number }): string {
  if (counts.movedOn === 0 || counts.rest === 0) return label
  return `${label} — the ${counts.rest} ${counts.rest === 1 ? 'clip' : 'clips'} left`
}
