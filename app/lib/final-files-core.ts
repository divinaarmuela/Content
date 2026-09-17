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
import { fileRound, handInRound } from './edit-round-core'
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
export function hasFinishedWork(item: { link_url?: string | null; link_kind?: string | null; raw_assets_url?: string | null; link_final?: boolean | null; adhoc_post?: boolean | null; final_files?: unknown; edit_round?: unknown; status?: unknown }): boolean {
  if (finishedEditOf(item) !== null) return true
  return finalFilesForRound(item, handInRound(item)).length > 0
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
export function sanitiseFinalFiles(raw: unknown, item: { edit_round?: unknown; status?: unknown }, by: string | null, now: string): { ok: true; files: FinalFile[] } | { ok: false; error: string } {
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
    })
  }
  return { ok: true, files: out }
}

/** the kind of work whose hand-in is files: graphics */
export function handsInFiles(item: { work_kinds?: { slug?: string | null } | null; final_files?: unknown }): boolean {
  return item.work_kinds?.slug === 'graphics' || finalFilesOf(item).length > 0
}
