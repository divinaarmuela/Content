/**
 * FINISHED WORK HANDED IN AS FILES (the owner, 17 Sep 2026: "designers are
 * the same as editors but they only upload files — not Drive links — and
 * make sure version and all checks out as this would be from files").
 *
 * A designer's card carries its finished work on the card itself: the files
 * uploaded to our storage, each stamped with the round it arrived in. They
 * play the same part a finished Drive link plays on an editor's card — the
 * hand-in the quality check needs, the versions on the card and the portal,
 * the pictures the client approves and comments on — so everything that
 * reads "is there a finished edit?" reads these too.
 *
 * Pure: the shape, the rules, and the same PullFile shape the tiles and the
 * version tabs already draw, so no page learns a second kind of file.
 */
import { finishedEditOf } from './card-link-core'
import { fileRound, handInRound, roundOf, SENT_BACK_STATUSES } from './edit-round-core'
import { kindOf } from './files-core'

export type FinalFile = {
  id: string
  name: string
  url: string
  mime: string
  size: number | null
  /** the card's round this file was handed in with */
  version: number
  uploaded_at: string
  by?: string | null
  /** THE ASSET THIS FILE IS A VERSION OF (22 Sep 2026). The first upload of a piece IS its asset (no
   *  asset_id: the file's own id stands). A replacement carries the asset's id, so "Clip 3, v1 → v2" is
   *  a fact and not a guess from file names. */
  asset_id?: string
  /** the file this one took the place of */
  replaces?: string | null
  /** DROPPED FROM THIS VERSION ON (22 Sep 2026): the asset is out of the card from round N; its earlier
   *  files stay, so the client's earlier version still shows it with what was said on it */
  retired_round?: number | null
}

export function finalFilesOf(item: { final_files?: unknown } | null | undefined): FinalFile[] {
  const raw = item?.final_files
  if (!Array.isArray(raw)) return []
  return raw.filter((f): f is FinalFile =>
    !!f && typeof f === 'object' && typeof (f as FinalFile).id === 'string' && typeof (f as FinalFile).url === 'string' && /^https:\/\//.test((f as FinalFile).url))
    .map(f => ({ ...f, name: String(f.name || 'A file'), mime: String(f.mime || ''), size: typeof f.size === 'number' ? f.size : null, version: fileRound(f) }))
}

/** the files handed in for one round */
export function finalFilesForRound(item: { final_files?: unknown }, round: number): FinalFile[] {
  return finalFilesOf(item).filter(f => f.version === round)
}

/**
 * IS THERE A FINISHED PIECE TO CHECK? A finished Drive link, or files handed
 * in for the round the card is on — after a send-back, that is the next
 * round, so last round's files do not count as this round's hand-in.
 */
export function hasFinishedWork(item: { link_url?: string | null; link_kind?: string | null; raw_assets_url?: string | null; link_final?: boolean | null; adhoc_post?: boolean | null; final_files?: unknown; edit_round?: unknown; status?: unknown; change_assets?: unknown; change_note_at?: unknown; client_round?: unknown; client_rounds?: unknown }): boolean {
  const round = handInRound(item)
  const sentBack = SENT_BACK_STATUSES.includes(String(item.status ?? ''))
  // not sent back: a finished link, or any file handed in, is a finished piece
  if (!sentBack) return finishedEditOf(item) !== null || currentFiles(item).length > 0
  // SENT BACK: the next version is files. Named assets → every one of them replaced. None named (the
  // whole card) → at least one new file for the round.
  const named = changeAssetsOf(item)
  if (named.length > 0 && currentFiles(item).length > 0) return stillToReplace(item).length === 0
  const since = String((item as { change_note_at?: unknown }).change_note_at ?? '')
  return currentFiles(item).some(f => (since ? f.uploaded_at > since : f.version === round && round > 1) || f.retired_round === round)
}

/** the id a fresh upload gets — stable, safe in a URL and a key */
export function finalFileId(): string {
  const bytes = new Uint8Array(9)
  crypto.getRandomValues(bytes)
  return `f_${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`
}

/** the list with these added for this round — a file already there (same url) is not doubled */
export function withFinalFiles(list: readonly FinalFile[], added: readonly { name: string; url: string; mime: string; size: number | null }[], round: number, by: string | null, now: string): FinalFile[] {
  const have = new Set(list.map(f => f.url))
  const fresh = added.filter(a => !have.has(a.url)).map(a => ({ id: finalFileId(), name: a.name, url: a.url, mime: a.mime, size: a.size, version: round, uploaded_at: now, by }))
  return [...list, ...fresh]
}

export function withoutFinalFile(list: readonly FinalFile[], id: string): FinalFile[] {
  return list.filter(f => f.id !== id)
}

/** the files as the tiles, the version tabs and the review page already read them */
export function finalFilesAsPulls(item: { final_files?: unknown }): { id: string; name: string; mime: string; size: number | null; done: number; url: string; status: 'done'; version: number; upload_id: null; parts: never[] }[] {
  return finalFilesOf(item).map(f => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, done: f.size ?? 0, url: f.url, status: 'done' as const, version: f.version, upload_id: null, parts: [] }))
}

/** what a PATCH may carry as `final_files`: cleaned, versions kept, new ones stamped with the card's round */
export function sanitiseFinalFiles(raw: unknown, item: { edit_round?: unknown; status?: unknown; client_round?: unknown; client_rounds?: unknown }, by: string | null, now: string): { ok: true; files: FinalFile[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'The finished files are a list' }
  if (raw.length > 200) return { ok: false, error: 'That is too many files on one card — 200 at most' }
  const round = handInRound(item)
  const out: FinalFile[] = []
  const seen = new Set<string>()
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue
    const x = f as Partial<FinalFile>
    const url = String(x.url ?? '').trim()
    if (!/^https:\/\/\S+$/.test(url)) return { ok: false, error: 'A finished file needs its https address' }
    if (seen.has(url)) continue
    seen.add(url)
    const name = String(x.name ?? '').trim().slice(0, 200) || url.split('/').pop() || 'A file'
    const version = typeof x.version === 'number' && x.version >= 1 ? Math.floor(x.version) : round
    out.push({
      id: typeof x.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x.id) ? x.id : finalFileId(),
      name, url, mime: String(x.mime ?? '').slice(0, 100) || (kindOf('', name) === 'image' ? 'image/*' : kindOf('', name) === 'video' ? 'video/*' : ''),
      size: typeof x.size === 'number' && x.size >= 0 ? x.size : null,
      version, uploaded_at: typeof x.uploaded_at === 'string' ? x.uploaded_at : now, by: typeof x.by === 'string' ? x.by : by,
      ...(typeof x.asset_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x.asset_id) ? { asset_id: x.asset_id } : {}),
      ...(typeof x.replaces === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x.replaces) ? { replaces: x.replaces } : {}),
      ...(typeof x.retired_round === 'number' && x.retired_round >= 1 ? { retired_round: Math.floor(x.retired_round) } : {}),
    })
  }
  return { ok: true, files: out }
}

/**
 * WHOSE HAND-IN IS FILES: everybody's now (the owner, 22 Sep 2026: "when uploading version 1, a popup —
 * upload the file instead of a Drive link — and for new versions"). Files are what let one asset be
 * replaced and the rest carried forward; a folder link is one lump. The one card that stays on its link
 * is a card ALREADY handed in by link and not sent back: its round is a link round and nothing is taken
 * from under it. Its next version, after a send-back, is files.
 */
export function handsInFiles(item: { work_kinds?: { slug?: string | null } | null; final_files?: unknown; link_url?: string | null; link_kind?: string | null; raw_assets_url?: string | null; link_final?: boolean | null; adhoc_post?: boolean | null; edit_round?: unknown; status?: unknown; client_round?: unknown; client_rounds?: unknown }): boolean {
  if (item.work_kinds?.slug === 'graphics' || finalFilesOf(item).length > 0) return true
  const onALinkRound = finishedEditOf(item) !== null && handInRound(item) === roundOf(item)
  return !onALinkRound
}

/* ── ONE ASSET, ITS VERSIONS (22 Sep 2026) ─────────────────────────────────
 * The owner: "lets say 2 get approved, 1 needs changing, so 1 gets sent back …
 * we know which file was replaced, and on the client portal the old version
 * with their comments and the new version near it." A card's files are a set
 * of ASSETS; each asset is a line of versions. Replacing one asset leaves the
 * others exactly as they were — their files, their comments, their approvals.
 */
export function assetIdOf(f: Pick<FinalFile, 'id' | 'asset_id'>): string {
  return f.asset_id || f.id
}

/** the card as it stands: the newest file of every asset, in the order the assets first appeared */
export function currentFiles(item: { final_files?: unknown }): FinalFile[] {
  const latest = new Map<string, FinalFile>()
  for (const f of finalFilesOf(item)) {
    const a = assetIdOf(f), have = latest.get(a)
    if (!have || f.version > have.version || (f.version === have.version && f.uploaded_at > have.uploaded_at)) latest.set(a, f)
  }
  const order = [...new Set(finalFilesOf(item).map(assetIdOf))]
  return order.map(a => latest.get(a)!).filter(Boolean)
}

/** one asset's versions, oldest first */
export function assetHistory(item: { final_files?: unknown }, assetId: string): FinalFile[] {
  return finalFilesOf(item).filter(f => assetIdOf(f) === assetId).sort((a, b) => a.version - b.version || a.uploaded_at.localeCompare(b.uploaded_at))
}

/** which assets the last send-back asked to have changed; empty = the whole card */
export function changeAssetsOf(item: { change_assets?: unknown }): string[] {
  return Array.isArray(item.change_assets) ? item.change_assets.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
}

/** the named assets still waiting for their new version */
export function stillToReplace(item: { final_files?: unknown; change_assets?: unknown; edit_round?: unknown; status?: unknown; change_note_at?: unknown; client_round?: unknown; client_rounds?: unknown }): string[] {
  const round = handInRound(item)
  const since = String(item.change_note_at ?? '')
  const current = new Map(currentFiles(item).map(f => [assetIdOf(f), f]))
  // replaced = a newer cut than the one the send-back was about: uploaded after it (or, without a stamp, in a later round)
  const replaced = (f: FinalFile) => (since ? f.uploaded_at > since : f.version >= round && f.version > 1)
  // a named clip is dealt with by a NEW CUT only — dropping it is not an answer to "change this" (24 Sep 2026:
  // Script 1 and Script 5 of Jordan Wilson's First Shoot were named, dropped, and the card went on to the client)
  return changeAssetsOf(item).filter(a => current.has(a) && !replaced(current.get(a)!))
}

/** may this asset be replaced now: the card was sent back, and this asset was named (or none was) — or a MANAGER
 *  is changing the set while it is with the client (the owner, 22 Sep 2026: "add the version one back, this is the
 *  version 2" on a card already with the client; the client sees the change on the same link, same version) */
export function mayReplaceAsset(item: { final_files?: unknown; change_assets?: unknown; edit_round?: unknown; status?: unknown }, assetId: string, manager = false): boolean {
  if (manager && String(item.status ?? '') === 'client_review') return true
  if (!SENT_BACK_STATUSES.includes(String(item.status ?? ''))) return false
  const named = changeAssetsOf(item)
  return named.length === 0 || named.includes(assetId)
}

/**
 * A NEW VERSION OF ONE ASSET. The new file carries the asset's id and points at the file it replaced.
 * Replaced twice in the same round (the wrong export, then the right one): the round's file is swapped,
 * not stacked — a version is a hand-in, not an attempt.
 */
export function withReplacement(list: readonly FinalFile[], assetId: string, added: { name: string; url: string; mime: string; size: number | null }, round: number, by: string | null, now: string): FinalFile[] {
  const line = list.filter(f => assetIdOf(f) === assetId).sort((a, b) => a.version - b.version)
  const latest = line[line.length - 1]
  if (!latest) return [...list]
  const fresh: FinalFile = { id: finalFileId(), name: added.name, url: added.url, mime: added.mime, size: added.size, version: round, uploaded_at: now, by, asset_id: assetId, replaces: latest.id }
  // appended, never swapped (22 Sep 2026): a cut replaced inside the same version — the quality check's
  // loop — stays on the card as the cut before, with the reviewer's words on it; the client never sees it
  return [...list, fresh]
}

/** what a send-back may name: asset ids that exist on the card, each once */
export function sanitiseChangeAssets(raw: unknown, item: { final_files?: unknown }): string[] {
  const known = new Set(currentFiles(item).filter(f => !f.retired_round).map(assetIdOf))
  return Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === 'string' && known.has(x)))] : []
}

/* ── A LINK CARD'S CLIPS BECOME ITS ASSETS (22 Sep 2026) ───────────────────
 * The owner: "we already have so many existing cards with a Version 1 from a
 * Drive link … can I just swap some of the videos?" A pasted link was one lump
 * — but its clips were copied into our own storage when it was pasted, each
 * under the Drive file's id, and that id is what the comments and approvals
 * already hang off. So the copies are ADOPTED as the card's Version 1 files:
 * the same ids, the same names, our copy's address. From there the card is a
 * files card — one clip is ticked at send-back and replaced in its slot, the
 * rest carry forward with everything said on them. Done once, only when the
 * card has no files of its own yet.
 */
export function adoptedFromPull(pulled: readonly { id: string; name: string; mime?: string | null; size?: number | null; url?: string | null; status?: string; version?: number | null }[], by: string | null, now: string): FinalFile[] {
  return pulled
    .filter(f => f.status === 'done' && !!f.url && /^https:\/\//.test(String(f.url)))
    .map(f => ({ id: f.id, asset_id: f.id, name: f.name, url: String(f.url), mime: String(f.mime ?? ''), size: typeof f.size === 'number' ? f.size : null, version: typeof f.version === 'number' && f.version >= 1 ? f.version : 1, uploaded_at: now, by }))
}

/** a link card with no files of its own is waiting to be adopted */
export function needsAdoption(item: { final_files?: unknown; link_url?: string | null; link_kind?: string | null; raw_assets_url?: string | null; link_final?: boolean | null; adhoc_post?: boolean | null }): boolean {
  return finalFilesOf(item).length === 0 && finishedEditOf(item) !== null
}

/* ── DROPPING A CLIP FROM A VERSION (22 Sep 2026) ──────────────────────────
 * The owner: "Version 1 has a video, but in Version 2 I choose not to have
 * it." The asset is marked out from that round on. Nothing is deleted: its
 * earlier file stays, so the client's Version 1 tab still shows it with every
 * comment. Until the version is handed in it can be brought back.
 */
export function isRetiredAt(f: Pick<FinalFile, 'retired_round'>, round: number): boolean {
  return typeof f.retired_round === 'number' && f.retired_round <= round
}

/** the assets the card carries at a round: the newest file of each, minus the ones dropped by then */
export function liveFilesAt(item: { final_files?: unknown }, round: number): FinalFile[] {
  return currentFiles(item).filter(f => f.version <= round && !isRetiredAt(f, round))
}

/** drop (round) or bring back (null) one asset — on its newest file, the one the card reads */
export function withRetired(list: readonly FinalFile[], assetId: string, round: number | null): FinalFile[] {
  const line = list.filter(f => assetIdOf(f) === assetId).sort((a, b) => a.version - b.version)
  const latest = line[line.length - 1]
  if (!latest) return [...list]
  return list.map(f => (f.id === latest.id ? (round === null ? (({ retired_round: _r, ...rest }) => rest)(f) : { ...f, retired_round: round }) : f))
}

/* ── EVERY DRIVE HAND-IN BECOMES FILES (the owner, 24 Sep 2026: "didnt i tell u track everything as files instead
 * of drive links") ──────────────────────────────────────────────────────────────────────────────────────────────
 * Only a card's FIRST Drive hand-in used to become its files, and only when somebody opened the card. Version 2
 * of Jordan Wilson's First Shoot went in as a Drive folder and stayed a link: the quality check passed the folder
 * and the scheduler was handed the folder, with the Version 1 Script 1 and Script 5 still in it.
 *
 * Every copied hand-in is now merged into the card's files at its round, by the rules a person would use:
 *   - a Drive file already on the card (same id) is the same cut — carried, not re-added;
 *   - a file whose name matches a clip on the card is that clip's next version;
 *   - anything else is a new clip.
 */
function clipKey(name: string): string {
  return String(name ?? '').toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '').replace(/[\s_-]+/g, ' ').trim()
}

export function mergeHandIn(
  list: readonly FinalFile[],
  pulled: readonly { id: string; name: string; mime?: string | null; size?: number | null; url?: string | null; status?: string }[],
  round: number,
  by: string | null,
  now: string,
): { files: FinalFile[]; added: number } {
  const have = new Set(list.map(f => f.id))
  const byName = new Map(currentFiles({ final_files: list }).map(f => [clipKey(f.name), f]))
  const out = [...list]
  let added = 0
  for (const p of pulled) {
    if (p.status !== 'done' || !p.url || !/^https:\/\//.test(String(p.url)) || have.has(p.id)) continue
    const same = byName.get(clipKey(p.name))
    const file: FinalFile = {
      id: p.id, asset_id: same ? assetIdOf(same) : p.id, name: p.name, url: String(p.url),
      mime: String(p.mime ?? ''), size: typeof p.size === 'number' ? p.size : null,
      version: Math.max(1, Math.floor(round)), uploaded_at: now, by,
      ...(same ? { replaces: same.id } : {}),
    }
    out.push(file)
    have.add(p.id)
    added++
  }
  return { files: out, added }
}
