/**
 * A VERSION HANDED IN FROM GOOGLE DRIVE, KEPT AS FILES (the owner, 30 Sep 2026: "bring back the Drive link
 * feature — submission for new versions — make sure it uses the id … use the id to keep track of the version so
 * the portal can see previous versions with the comments like how we have now"; and "we have cards that already
 * have files only with no Drive link — make sure the card supports Drive link submission from now on").
 *
 * WHAT CAME BEFORE, AND WHY IT WENT (83efd377, 9d9c1635, 25 Sep 2026). The editor's finished-edit box saved a
 * Drive link AS the finished edit (`link_final`), and the card, the quality check and the scheduler were handed
 * the live folder. A folder is one lump that keeps changing under everyone: Jordan Wilson's Version 2 went to the
 * scheduler with Version 1's Script 1 and Script 5 still in it. So the link was refused as a hand-in and the
 * finished work became uploaded files — each an asset with its own line of versions.
 *
 * WHAT THIS BRINGS BACK is only the good half: the editor POINTS at the files in Drive instead of uploading them
 * from their computer. The link is never saved as the finished edit. The background copy the old link used
 * (drive-pull.ts, the `drive-pull-folder` Inngest job) reads each picked file by its Drive id and copies it into
 * our storage; when every picked file has landed, the copies go onto the card as ordinary finished files at the
 * round the card is on — exactly what an upload makes (final-files-core: `withFinalFiles` for a new piece,
 * `withReplacement` for the next version of a piece) — each one recording the Drive file id it came from. From
 * there nothing downstream can tell the difference: the version tabs, the send-back of chosen assets, the quality
 * check, the client's "New cut / Before", their comments and approvals, the hand-over to posting.
 *
 * THE DRIVE ID IS THE THREAD between versions: the same Drive file handed in again unchanged is the same cut
 * (carried, never copied twice); the same Drive file changed is that piece's next version; a new Drive file is a
 * new piece unless the editor says which piece it replaces.
 *
 * Google Drive is READ here and nowhere written (CLAUDE.md trap 13). Pure: no I/O.
 */
import { driveTargetOf } from './card-link-core'
import { LOCKED_STATUSES, LOOKING_STATUSES, assetIdOf, clipKey, currentFiles, finalFilesOf, mayReplaceAsset, withFinalFiles, withReplacement, withRetired, type FinalFile } from './final-files-core'
import { fileRound } from './edit-round-core'
import { formatBytes, formatLeft, type PullFile, type PullRow } from './drive-pull-core'

/** the most files one hand-in may pick — a card's set, never a camera card's dump */
export const MAX_HANDIN_FILES = 60

/** the words for a link the connected Drive cannot read (the owner's own wording, 30 Sep 2026) */
export const NOT_SHARED_WORDS = 'This link isn’t shared with MD Media’s Drive — share it with the agency’s Drive account (or set it to anyone with the link), then try again.'

/** the Drive file or folder a pasted link points at: /file/d/<id>, /drive/folders/<id>, open?id=<id>, uc?id=<id> */
export function driveLinkTarget(raw: unknown): { ok: true; id: string; kind: 'folder' | 'file'; url: string } | { ok: false; error: string } {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, error: 'Paste the Google Drive link first' }
  let url: URL
  try { url = new URL(text) } catch { return { ok: false, error: 'That does not look like a link — paste the full address, starting with https://' } }
  if (url.protocol !== 'https:' || !['drive.google.com', 'docs.google.com'].includes(url.hostname.toLowerCase())) {
    return { ok: false, error: 'That is not a Google Drive link — paste the link to the file or the folder in Drive' }
  }
  const target = driveTargetOf(text)
  if (!target) return { ok: false, error: 'That Drive link does not name a file or a folder — open the file or folder in Drive and copy its link' }
  return { ok: true, id: target.id, kind: target.kind, url: url.toString().slice(0, 2000) }
}

/** ONE ROW PER LINK PER CARD for hand-ins, apart from the card's folder-to-work-from row (drive-pull-core.pullId):
 *  the same folder as the footage and the finished work never share a row, and a later round's hand-in from the
 *  same link reuses what is already copied */
export function handInPullId(driveId: string, cardId: string): string {
  return `handin-${driveId}@${cardId}`
}

/** what one hand-in asked for, kept on the card (content_items.drive_handins) */
export type DriveHandIn = {
  /** the pull row's id and when it was asked: a later hand-in through the same link is a new record */
  id: string
  pull_id: string
  link: string
  /** the Drive file ids picked, in the order the editor put them — each once */
  drive_ids: string[]
  /** the names Drive gave them when picked, for the words while copying */
  names?: Record<string, string>
  /** drive id → the piece (asset id) it is the next version of, or 'new'. Absent → decided by the Drive id, then the name */
  map?: Record<string, string>
  /** the version the card was on when it was asked */
  round: number
  by: string | null
  /** the asker was a manager — who may change files the quality check or the client is looking at */
  manager?: boolean
  requested_at: string
  status: 'copying' | 'done' | 'failed'
  settled_at?: string | null
  /** the version the files went on as */
  settled_round?: number | null
  /** the card's file ids this hand-in made */
  file_ids?: string[]
  /** Drive ids that were already on the card unchanged — carried, not copied again */
  carried?: string[]
  /** Drive ids left out, with why */
  skipped?: { drive_id: string; why: string }[]
  /** THE WHOLE LINK IS THE VERSION (30 Sep 2026): every file in it, matched to the card's pieces by Drive id then
   *  name; a piece not in it is dropped from this version (kept in the ones before) */
  whole?: boolean
  /** the pieces dropped from this version because they were not in the link */
  retired?: string[]
  /** of file_ids, the ones that are new pieces (the rest are new cuts of pieces already on the card) */
  new_ids?: string[]
  error?: string | null
}

export function driveHandInsOf(item: { drive_handins?: unknown } | null | undefined): DriveHandIn[] {
  const raw = item?.drive_handins
  if (!Array.isArray(raw)) return []
  return raw.filter((h): h is DriveHandIn => !!h && typeof h === 'object' && typeof (h as DriveHandIn).id === 'string' && Array.isArray((h as DriveHandIn).drive_ids))
}

/** the hand-in still copying, if any — the newest */
export function pendingHandIn(item: { drive_handins?: unknown } | null | undefined): DriveHandIn | null {
  const list = driveHandInsOf(item)
  const last = list[list.length - 1]
  return last && last.status === 'copying' ? last : null
}

/** the newest hand-in, whatever became of it — what the card's line reads */
export function latestHandIn(item: { drive_handins?: unknown } | null | undefined): DriveHandIn | null {
  const list = driveHandInsOf(item)
  return list[list.length - 1] ?? null
}

/** the Drive ids a version was made from — "which files did Version 2 come from" */
export function driveIdsOfRound(item: { final_files?: unknown }, round: number): string[] {
  return [...new Set(finalFilesOf(item).filter(f => f.version === round && typeof f.drive_file_id === 'string').map(f => f.drive_file_id as string))]
}

/**
 * WHAT A HAND-IN MAY PICK: known ids from the listing, each once, in the order given, at most MAX_HANDIN_FILES.
 * A picked id the listing does not hold is refused — the editor picks from what Drive showed.
 */
export function sanitisePicked(raw: unknown, listed: readonly { id: string }[]): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'Pick at least one file' }
  const known = new Set(listed.map(f => f.id))
  const ids: string[] = []
  for (const x of raw) {
    const id = String(x ?? '')
    if (!known.has(id)) return { ok: false, error: 'One of those files is not in that Drive link any more — list it again' }
    if (!ids.includes(id)) ids.push(id)
  }
  if (ids.length > MAX_HANDIN_FILES) return { ok: false, error: `That is too many files for one hand-in — ${MAX_HANDIN_FILES} at most` }
  return { ok: true, ids }
}

/** what a map may say: a picked id → a piece on the card now, or 'new' */
export function sanitiseMap(raw: unknown, ids: readonly string[], item: { final_files?: unknown }): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const pieces = new Set(currentFiles(item).filter(f => !f.retired_round).map(assetIdOf))
  const out: Record<string, string> = {}
  for (const id of ids) {
    const v = String((raw as Record<string, unknown>)[id] ?? '')
    if (v === 'new' || pieces.has(v)) out[id] = v
  }
  return out
}

/** MAY A HAND-IN BE STARTED NOW — the same three rules a save of the file list follows (final-files-core
 *  finalFilesChangeRefusal), said before anything is copied rather than after */
export function handInRefusal(item: { status?: unknown }, manager: boolean): string | null {
  const status = String(item.status ?? '')
  if (LOCKED_STATUSES.includes(status)) return 'These files are approved — a change is a new version, sent back through the check and the client'
  if (LOOKING_STATUSES.includes(status) && !manager) return 'The quality check or the client is looking at these files — only a manager can change them now'
  return null
}

/**
 * IS IT THE SAME CUT? Only when Drive PROVES it (30 Sep 2026: an editor re-exports a clip over itself in the same
 * folder — same Drive id, new bytes — and the old rule, which fell back to the size, could keep the old cut and
 * miss the fix). Proof, strongest first: the same checksum; the same head revision; the same change time. When
 * Drive told us none of these (a public folder view), it is a NEW cut: a repeated version is harmless, a missed fix
 * is not. Sizes are never proof.
 */
export function sameDriveCut(
  a: { md5?: string | null; revision?: string | null; modified?: string | null },
  b: { md5?: string | null; revision?: string | null; modified?: string | null },
): boolean {
  if (a.md5 && b.md5) return a.md5 === b.md5
  if (a.revision && b.revision) return a.revision === b.revision
  if (a.modified && b.modified) return a.modified === b.modified
  return false
}

/** the same Drive file, not changed since the copy on the card was made */
function sameCut(f: FinalFile, driveId: string, copy: { modified?: string | null; md5?: string | null; revision?: string | null; url?: string | null }): boolean {
  const idMatches = f.drive_file_id === driveId || (!f.drive_file_id && f.id === driveId)   // a copy adopted from an old link keeps the Drive id as its own
  if (!idMatches) return false
  // this very copy is on the card already — the pull reuses a copy only when Drive proved the cut (drive-pull listInto)
  if (copy.url && f.url === copy.url) return true
  return sameDriveCut({ md5: f.drive_md5, revision: f.drive_revision, modified: f.drive_modified }, copy)
}

/** may this piece take a new version in this hand-in: the rules the Replace button follows (mayReplaceAsset), or
 *  its newest file is this very version's, not yet gone to anyone — the "Replace again" of the same hand-in */
function mayTakeNewVersion(item: { final_files?: unknown; change_assets?: unknown; edit_round?: unknown; status?: unknown }, f: FinalFile, round: number, manager: boolean): boolean {
  return mayReplaceAsset(item, assetIdOf(f), manager) || f.version === round
}

/**
 * THE PIECE A PICKED FILE BELONGS TO, as a person would say it — for the popup's default and the server alike:
 *   1. the editor said (map);
 *   2. the same Drive file is already a piece on the card;
 *   3. a piece of the same name (Script 3.mp4 → Script 3);
 *   4. on a card sent back with pieces named, the named pieces not yet matched, in order;
 *   5. otherwise a new piece.
 */
export function defaultMap(
  picked: readonly { id: string; name: string }[],
  item: { final_files?: unknown; change_assets?: unknown; status?: unknown },
): Record<string, string> {
  const current = currentFiles(item).filter(f => !f.retired_round)
  const taken = new Set<string>()
  const out: Record<string, string> = {}
  const named = Array.isArray(item.change_assets) ? (item.change_assets as unknown[]).map(String) : []
  for (const p of picked) {
    const base = p.name.split('/').pop() || p.name
    const hit = current.find(f => !taken.has(assetIdOf(f)) && (f.drive_file_id === p.id || (!f.drive_file_id && f.id === p.id)))
      ?? current.find(f => !taken.has(assetIdOf(f)) && clipKey(f.name) === clipKey(base))
    if (hit) { out[p.id] = assetIdOf(hit); taken.add(assetIdOf(hit)); continue }
    out[p.id] = 'new'
  }
  // a named piece nobody matched takes the next unmatched pick, in order
  const openNamed = named.filter(a => !taken.has(a) && current.some(f => assetIdOf(f) === a))
  for (const p of picked) {
    if (openNamed.length === 0) break
    if (out[p.id] !== 'new') continue
    const a = openNamed.shift()!
    out[p.id] = a
    taken.add(a)
  }
  return out
}

/** the copy of one picked file for this hand-in: the one tagged with the hand-in's round, else the newest done */
export function copyFor(files: readonly PullFile[], driveId: string, round: number): PullFile | null {
  const line = files.filter(f => f.id === driveId)
  return line.find(f => fileRound(f) === round && f.status !== 'waiting') ?? [...line].sort((a, b) => fileRound(b) - fileRound(a))[0] ?? null
}

export type MergeResult =
  | { ok: true; files: FinalFile[]; added: string[]; carried: string[]; skipped: { drive_id: string; why: string }[]; retired?: string[]; fresh?: string[] }
  | { ok: false; error: string; failed: string[] }

/**
 * THE HAND-IN ONTO THE CARD. All or nothing: a picked file that did not copy stops the lot, named — never a half
 * version. Otherwise each picked file, in the editor's order:
 *   - the same Drive file unchanged on the piece it belongs to → carried (nothing copied, nothing added);
 *   - a piece it belongs to that may take a new version → that piece's next version (withReplacement);
 *   - a piece it belongs to that may NOT (not asked to change) → left out, and said why;
 *   - no piece → a new piece (withFinalFiles).
 * Every new file records the Drive id it came from and `source: 'drive'`.
 */
export function mergeDriveHandIn(
  list: readonly FinalFile[],
  pulled: readonly PullFile[],
  handIn: Pick<DriveHandIn, 'drive_ids' | 'map' | 'names' | 'round' | 'by' | 'manager' | 'whole'>,
  item: { final_files?: unknown; change_assets?: unknown; edit_round?: unknown; status?: unknown },
  round: number,
  now: string,
): MergeResult {
  const copies = handIn.drive_ids.map(d => ({ d, c: copyFor(pulled, d, handIn.round) }))
  const failed = copies.filter(x => !x.c || x.c.status !== 'done' || !x.c.url || !/^https:\/\//.test(String(x.c.url)))
  if (failed.length > 0) {
    const names = failed.map(x => x.c?.name ?? handIn.names?.[x.d] ?? x.d)
    const why = failed.map(x => x.c?.error).find(Boolean)
    return {
      ok: false,
      failed: failed.map(x => x.d),
      error: `Nothing was handed in — ${names.length === 1 ? 'this file' : `${names.length} files`} could not be copied from Drive: ${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}${why ? ` (${why})` : ''}. Try again.`.slice(0, 500),
    }
  }
  const manager = handIn.manager === true
  const whole = handIn.whole === true
  let files = [...list]
  const added: string[] = [], carried: string[] = [], skipped: { drive_id: string; why: string }[] = [], retired: string[] = [], fresh: string[] = []
  const used = new Set<string>()
  for (const { d, c } of copies) {
    const copy = c as PullFile
    // a piece dropped from THIS version and back in the folder is brought back, not made again
    const current = currentFiles({ final_files: files }).filter(f => !f.retired_round || (whole && f.retired_round === round))
    const base = copy.name.split('/').pop() || copy.name
    const said = handIn.map?.[d]
    let piece: FinalFile | null = null
    if (said && said !== 'new') piece = current.find(f => assetIdOf(f) === said) ?? null
    if (!said) {
      piece = current.find(f => !used.has(assetIdOf(f)) && (f.drive_file_id === d || (!f.drive_file_id && f.id === d)))
        ?? current.find(f => !used.has(assetIdOf(f)) && clipKey(f.name) === clipKey(base))
        ?? null
    }
    const extra = { source: 'drive' as const, drive_file_id: d, drive_modified: copy.modified ?? null, ...(copy.md5 ? { drive_md5: copy.md5 } : {}), ...(copy.revision ? { drive_revision: copy.revision } : {}) }
    const file = { name: base, url: String(copy.url), mime: copy.mime, size: copy.size }
    if (piece) {
      const a = assetIdOf(piece)
      used.add(a)
      if (piece.retired_round === round) files = withRetired(files, a, null)
      if (sameCut(piece, d, copy)) { carried.push(d); continue }
      // THE WHOLE FOLDER IS THE VERSION (the owner, 30 Sep 2026: "submit the Drive link again and all will become
      // Version 2"): a changed file is its piece's new cut, whoever asked for what
      if (!whole && !mayTakeNewVersion(item, piece, round, manager)) {
        skipped.push({ drive_id: d, why: `${piece.name} was not asked to change — it stays as it is` })
        continue
      }
      files = withReplacement(files, a, file, round, handIn.by, now)
      const made = files[files.length - 1]
      files[files.length - 1] = { ...made, ...extra }
      added.push(made.id)
      continue
    }
    // not a piece yet: the same Drive file already handed in at this very version is not doubled
    const dup = files.find(f => f.version === round && sameCut(f, d, copy))
    if (dup) { used.add(assetIdOf(dup)); carried.push(d); continue }
    const before = files.length
    files = withFinalFiles(files, [file], round, handIn.by, now)
    if (files.length === before) {   // this exact copy is on the card already
      const same = files.find(f => f.url === file.url)
      if (same) used.add(assetIdOf(same))
      carried.push(d)
      continue
    }
    files[files.length - 1] = { ...files[files.length - 1], ...extra }
    added.push(files[files.length - 1].id)
    fresh.push(files[files.length - 1].id)
  }
  // …and a piece no longer in the folder is out of this version — kept, with everything said on it, in the ones before
  if (whole) {
    for (const f of currentFiles({ final_files: files })) {
      const a = assetIdOf(f)
      if (used.has(a) || f.retired_round || added.includes(f.id)) continue
      files = withRetired(files, a, round)
      retired.push(a)
    }
  }
  return { ok: true, files, added, carried, skipped, retired, fresh }
}

/** the hand-in record, settled */
export function settledHandIn(h: DriveHandIn, result: MergeResult, round: number, now: string): DriveHandIn {
  if (!result.ok) return { ...h, status: 'failed', error: result.error, settled_at: now }
  return { ...h, status: 'done', error: null, settled_at: now, settled_round: round, file_ids: result.added, carried: result.carried, skipped: result.skipped, ...(result.retired?.length ? { retired: result.retired } : {}), new_ids: result.fresh ?? [] }
}

/** the card's list with this record put in its place (by id), or appended */
export function withHandIn(list: readonly DriveHandIn[], h: DriveHandIn): DriveHandIn[] {
  const i = list.findIndex(x => x.id === h.id)
  const out = i < 0 ? [...list, h] : list.map((x, k) => (k === i ? h : x))
  // a card keeps its last 50 hand-ins — the files themselves carry their Drive ids for ever
  return out.slice(-50)
}

/**
 * THE LINE ON THE CARD while a hand-in is on its way ("Copying 3 of 8 from Drive…"), from the pull row the page
 * watches live. Counts only the files this hand-in picked.
 */
export function handInWords(row: PullRow | null | undefined, h: DriveHandIn | null, nowMs: number): { tone: 'working' | 'done' | 'failed'; words: string } | null {
  if (!h) return null
  if (h.status === 'failed') return { tone: 'failed', words: h.error ?? 'The Drive hand-in stopped — try again.' }
  if (h.status === 'done') {
    const n = h.file_ids?.length ?? 0
    const kept = h.carried?.length ?? 0
    const left = h.skipped?.length ?? 0
    const dropped = h.retired?.length ?? 0
    // "4 files handed in — 1 new, 3 updated" (the owner, 30 Sep 2026)
    const total = n + kept
    const fresh = Math.min(n, h.new_ids?.length ?? 0)
    const head = `${total} ${total === 1 ? 'file' : 'files'} handed in — ${[`${fresh} new`, `${n - fresh} updated`, kept ? `${kept} unchanged` : ''].filter(Boolean).join(', ')}`
    return { tone: 'done', words: [head, left ? `${left} left out (${h.skipped![0].why})` : '', dropped ? `${dropped} no longer in the folder — left out of this version, kept in the ones before` : ''].filter(Boolean).join(' · ') }
  }
  if (!row) return { tone: 'working', words: 'Waiting to start copying from Google Drive…' }
  if (row.status === 'unreadable') return { tone: 'failed', words: NOT_SHARED_WORDS }
  if (row.status === 'failed') return { tone: 'failed', words: row.error ? `The copy from Drive stopped: ${row.error}` : 'The copy from Drive stopped — try again.' }
  const picked = new Set(h.drive_ids)
  const mine = (Array.isArray(row.files) ? row.files as PullFile[] : []).filter(f => picked.has(f.id)).map(f => copyFor(row.files as PullFile[], f.id, h.round)).filter((f, i, a): f is PullFile => !!f && a.findIndex(g => g?.id === f.id) === i)
  const total = h.drive_ids.length
  const done = mine.filter(f => f.status === 'done').length
  if (row.status === 'queued') return { tone: 'working', words: 'Waiting to start copying from Google Drive…' }
  if (row.status === 'listing') return { tone: 'working', words: 'Reading Google Drive…' }
  if (row.status === 'done') return { tone: 'working', words: `Copied all ${total} — putting them on the card…` }
  const bytes = mine.reduce((n, f) => n + (f.size ?? 0), 0)
  const landed = mine.reduce((n, f) => n + Math.min(f.done, f.size ?? f.done), 0)
  const started = row.started_at ? Date.parse(row.started_at) : NaN
  const rate = Number.isFinite(started) && landed > 0 ? landed / Math.max(1, (nowMs - started) / 1000) : null
  const left = rate && bytes > landed ? formatLeft((bytes - landed) / rate) : null
  return { tone: 'working', words: [`Copying ${Math.min(done + 1, total)} of ${total} from Google Drive…`, bytes > 0 ? `${formatBytes(landed)} of ${formatBytes(bytes)}` : '', left ?? ''].filter(Boolean).join(' · ') }
}
