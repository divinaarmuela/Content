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

/** was this round given to the client? the list of rounds given (client_rounds), the last one given
 *  (client_round, older cards), or the card is back FROM the client */
export function roundSeenByClient(item: { edit_round?: unknown; status?: unknown; client_round?: unknown; client_rounds?: unknown }, round = roundOf(item)): boolean {
  if (String(item.status ?? '') === 'client_changes_requested') return true
  if (Array.isArray(item.client_rounds) && item.client_rounds.includes(round)) return true
  return Number(item.client_round) === round
}

/**
 * THE ROUND A HAND-IN BELONGS TO — ONE NUMBER FOR EVERYBODY (the owner, 22 Sep
 * 2026: "one unified status so it does not confuse the team"). A version is a
 * cut the CLIENT was given. The loop between In progress and the quality check
 * stays inside the same version: sent back by the reviewer before the client
 * ever saw it, the next hand-in is still Version 1. Only a round the client has
 * seen opens the next one. A first hand-in is Version 1.
 */
export function handInRound(item: { edit_round?: unknown; status?: unknown; client_round?: unknown; client_rounds?: unknown }): number {
  return SENT_BACK_STATUSES.includes(String(item.status ?? '')) && roundSeenByClient(item) ? nextRound(item) : roundOf(item)
}

/** THE VERSION THE CARD'S FILES SECTION NAMES: the one being made — except while the client's request waits on the
 *  account manager, when nothing new is being made yet and the section shows the version the client answered
 *  (1 Oct 2026: it read "Version 3" over Version 2's files) */
export function shownRound(item: { edit_round?: unknown; status?: unknown; client_round?: unknown; client_rounds?: unknown }): number {
  return String(item.status ?? '') === 'client_changes_requested' ? roundOf(item) : handInRound(item)
}

export function roundLabel(n: number): string {
  return `Version ${n}`
}

/* ── THE VERSION NUMBER IS THE CLIENT'S (the owner, 30 Sep 2026: "make sure the version stays the same until the
 * client — Version 1 comes back, Version 2") ─────────────────────────────────────────────────────────────────────
 * The card counts its hand-ins in rounds (edit_round, each file's `version`), and a round can move without the
 * client — "Start the next version" while the editor still holds the card. The NUMBER everybody reads is the
 * client's: it goes up only when a version went to the client and came back. Internal re-work inside a version
 * reads "Version 1 · draft 2". Derived, never stored: every round, file, comment and approval stays as it is, and
 * the portal (editing-portal-core.clientVersionOf) counts the same way.
 */
const CLIENT_SEEN_STATUSES: readonly string[] = ['client_review', 'client_changes_requested', 'approved_for_scheduling', 'scheduled', 'published']

/** the internal rounds that went to the client, in order — the stamped list; else, on a card from before it was
 *  kept, every round up to the last one stamped (or the card's own, once it has been with the client); else none */
export function clientRoundsForLabels(item: { client_rounds?: unknown; client_round?: unknown; edit_round?: unknown; status?: unknown } | null | undefined): number[] {
  const list = Array.isArray(item?.client_rounds) ? (item!.client_rounds as unknown[]).filter((n): n is number => typeof n === 'number' && n >= 1) : []
  if (list.length > 0) return [...new Set(list)].sort((a, b) => a - b)
  const stamped = Number(item?.client_round)
  const upTo = Number.isFinite(stamped) && stamped >= 1 ? Math.floor(stamped) : CLIENT_SEEN_STATUSES.includes(String(item?.status ?? '')) ? roundOf(item) : 0
  return Array.from({ length: upTo }, (_, i) => i + 1)
}

/** a round as the version everybody reads: the client's number, and which draft of it this round is */
export function versionOfRound(item: Parameters<typeof clientRoundsForLabels>[0], round: number): { n: number; draft: number } {
  const given = clientRoundsForLabels(item)
  const before = given.filter(r => r < round)
  const first = (before[before.length - 1] ?? 0) + 1
  return { n: before.length + 1, draft: Math.max(1, round - first + 1) }
}

/** "Version 1", or "Version 1 · draft 2" for re-work inside a version the client has not been given yet */
export function versionLabel(item: Parameters<typeof clientRoundsForLabels>[0], round: number): string {
  const v = versionOfRound(item, round)
  return v.draft > 1 ? `Version ${v.n} · draft ${v.draft}` : `Version ${v.n}`
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
  opts: { itemId: string; finishedFolderId: string | null; filesOf: (row: { files?: unknown }) => F[]; currentRound?: number | null },
): VersionTab<F>[] {
  const mine = rows
    .filter(r => r.kind === 'item' && r.scope_id === opts.itemId)
    // a row pulled as the folder to work from counts too when that same link
    // is the card's finished edit today (16 Sep 2026)
    .filter(r => r.purpose === 'finished' || (!!opts.finishedFolderId && r.folder_id === opts.finishedFolderId))
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
  // THE SAME FILE ONCE (18 Sep 2026): a stale failed pull and the good one
  // both carry the file — the version counts it once, the good copy wins
  for (const tab of byRound.values()) {
    const good = (f: F) => String((f as { status?: unknown }).status ?? '') === 'done' && !!(f as { url?: unknown }).url
    const best = new Map<string, F>()
    for (const f of tab.files) {
      const id = String((f as { id?: unknown }).id ?? '')
      if (!id) continue
      const prev = best.get(id)
      if (!prev || (!good(prev) && good(f))) best.set(id, f)
    }
    tab.files = tab.files.filter(f => { const id = String((f as { id?: unknown }).id ?? ''); return !id || best.get(id) === f })
  }
  // a tab for the empty in-flight row is the card's OWN round — the hand-in
  // being copied is the round the card is on, never a guessed "next" (the
  // owner, 16 Sep 2026: "why is Version 2 already there while I'm uploading
  // version 1?")
  const empty = byRound.get(0)
  if (empty) {
    byRound.delete(0)
    const own = typeof opts.currentRound === 'number' && opts.currentRound >= 1 ? opts.currentRound : Math.max(0, ...byRound.keys()) + 1
    if (!byRound.has(own)) byRound.set(own, { ...empty, round: own })
    else byRound.set(own, { ...byRound.get(own)!, inFlight: true })
  }
  return [...byRound.values()].sort((a, b) => b.round - a.round)
}

/**
 * MAY THE EDITOR START THE NEXT VERSION THEMSELVES? (the owner, 24 Sep 2026:
 * "they just wanna upload version 2 with the new files".)
 *
 * Only WHILE THE EDITOR HOLDS THE CARD (29 Sep 2026: Real Deal's "September
 * 18th" sat in the quality check as Version 2 with only Version 1's files on
 * it — the button had been pressed after the hand-in, with nothing logged).
 * Once a round is handed over — the quality check, the client, approved,
 * booked in, posted — that round is what the next person is looking at, and
 * its number must not move under them.
 *
 * And never where the round moves by itself: a card back FROM the client
 * already hands in as the next version (`handInRound`), so a press there would
 * skip one (Version 1 → Version 3).
 *
 * So, all of:
 *   - the card is with the editor: being made, or sent back by the quality check;
 *   - this round has actually been handed in (a finished link, or files);
 *   - the next hand-in is not already the next version on its own.
 * No I/O.
 */
export const EDITOR_HOLDS_STATUSES: readonly string[] = ['draft_uploaded', 'revision_required']

type RoundItem = { status?: unknown; edit_round?: unknown; client_round?: unknown; client_rounds?: unknown }

function nextRoundRefusal(item: RoundItem, handedIn: boolean): string | null {
  const status = String(item.status ?? '')
  if (['scheduled', 'published'].includes(status)) return 'Booked in or already posted — the files are the channel’s now.'
  if (handInRound(item) !== roundOf(item)) return `Back from the client — what you hand in now is ${versionLabel(item, handInRound(item))} by itself.`
  if (!EDITOR_HOLDS_STATUSES.includes(status)) return `${versionLabel(item, roundOf(item))} is handed over — it can only move once the card is back with you.`
  if (!handedIn) return `Nothing handed in for ${versionLabel(item, roundOf(item))} yet — replace those files instead.`
  return null
}

export function mayStartNextRound(input: { item: RoundItem; handedIn: boolean }): boolean {
  return nextRoundRefusal(input.item, input.handedIn) === null
}

/** what the button says, and why it is off when it is */
export function nextRoundWords(input: { item: RoundItem; handedIn: boolean }): {
  label: string
  why: string | null
} {
  // the next round inside the SAME version until the client has it (30 Sep 2026): "Start Version 1 · draft 2"
  return { label: `Start ${versionLabel(input.item, handInRound(input.item) + 1)}`, why: nextRoundRefusal(input.item, input.handedIn) }
}
