/**
 * The decisions behind mirroring files into Drive — all of them pure.
 *
 * The folder tree said WHERE a folder goes. This module says which files are
 * worth copying, what they are called once they are there, which month a
 * scheduled piece belongs to, and which people need a permission of their own.
 * None of it does any I/O, so all of it is testable, which matters more here
 * than it did for the folders: a wrong answer from this module is a file in
 * the wrong place (or a permission granted to the wrong person) rather than a
 * folder with an ugly name.
 */
import { slideFileName, slidesOf, type VersionLike } from './version-files-core'

/**
 * Where a mirrored copy lives.
 *
 *  - `item`        the item's own working folder — every file, as it lands
 *  - `final`       the shoot's `03 Final` — the approved cut, once approved
 *  - `scheduled`   `_Scheduled/{YYYY-MM}` — the approved cut, by posting month
 *  - `from_client` `_From client/{YYYY-MM-DD}` — what a client sent us
 *  - `brand`       `_Brand` — logos, fonts, guidelines; no date, no expiry
 *
 * They are separate rows in `drive_files`, not one row that moves, because
 * the same file genuinely exists in several places at once and each copy is
 * reached by a different question. The first three hang off an ITEM; the last
 * two hang off a CLIENT and carry no item at all.
 */
export type MirrorTarget = 'item' | 'final' | 'scheduled' | 'from_client' | 'brand'

export const MIRROR_TARGETS: MirrorTarget[] =
  ['item', 'final', 'scheduled', 'from_client', 'brand']

/** The targets that belong to a client rather than to a piece of work. */
export const CLIENT_TARGETS: MirrorTarget[] = ['from_client', 'brand']

export function isClientTarget(target: MirrorTarget): boolean {
  return CLIENT_TARGETS.includes(target)
}

export function isMirrorTarget(value: unknown): value is MirrorTarget {
  return MIRROR_TARGETS.includes(value as MirrorTarget)
}

/**
 * Hosts that serve a *link*, not a file of ours.
 *
 * A version can carry a pasted Drive folder, a YouTube cut, a Frame.io review
 * link. Downloading one of those and calling the result a mirror would at best
 * store an HTML page under a video's name — so a link-only URL is not
 * mirrored, and that is a correct outcome rather than a failure to report.
 */
const LINK_ONLY_HOSTS = [
  'drive.google.com', 'docs.google.com', 'youtube.com', 'youtu.be',
  'vimeo.com', 'frame.io', 'dropbox.com', 'wetransfer.com', 'loom.com',
]

/**
 * This URL points at a file WE hold, so a copy of it is a real mirror.
 *
 * Deliberately a blocklist over a "is it our bucket" allowlist: the storage
 * backend is R2 *or* Supabase Storage depending on configuration, the public
 * base is an environment variable that changes when a custom domain is put in
 * front of it, and a mirror that silently stopped the day someone moved the
 * bucket would be discovered months later. Anything https that is not a
 * known link host is worth trying; a fetch that comes back wrong fails loudly.
 */
export function isMirrorableUrl(url: string | null | undefined): boolean {
  const raw = String(url ?? '').trim()
  if (!/^https:\/\//i.test(raw)) return false
  let host: string
  try {
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    return false
  }
  return !LINK_ONLY_HOSTS.some(h => host === h || host.endsWith(`.${h}`))
}

/**
 * A readable file name from a storage URL.
 *
 * `objectKey()` prefixes every upload with `{millis}-{random}-` to make it
 * collision-proof. That prefix is ours, not the user's, and a Drive folder
 * full of `1755043200000-k3f9a1-Hook_cut.mp4` is a folder nobody can read —
 * so it comes back off. A name we cannot recover falls back to something
 * honest rather than to an empty string.
 */
export function fileNameFromUrl(url: string | null | undefined): string {
  const raw = String(url ?? '').trim()
  let last = raw
  try {
    last = new URL(raw).pathname.split('/').filter(Boolean).pop() ?? ''
  } catch {
    last = raw.split('?')[0].split('/').filter(Boolean).pop() ?? ''
  }
  let name = last
  try { name = decodeURIComponent(last) } catch { /* a stray % — keep it raw */ }
  // strip our own {millis}-{random}- prefix, and only ours
  name = name.replace(/^\d{10,}-[a-z0-9]{4,10}-/i, '')
  name = name.replace(/[/\\]/g, '').trim()
  return name || 'file'
}

/**
 * `v3 - Hook cut.mp4`.
 *
 * The version number LEADS so the folder sorts into the order the cuts were
 * made — which is the order anyone reviewing them wants. The editor's own
 * file name is kept after it, because "v3" alone tells you nothing about what
 * you are opening.
 */
export function versionFileName(
  versionNumber: number, originalName: string | null | undefined,
): string {
  const n = Number.isFinite(versionNumber) && versionNumber > 0
    ? Math.floor(versionNumber) : 1
  const name = String(originalName ?? '').trim() || 'file'
  return `v${n} - ${name}`
}

export type ScheduleEntryLike = { scheduled_at?: string | null }

/**
 * The month a piece is filed under: the EARLIEST date anything is scheduled
 * for.
 *
 * An item posts to four platforms across a fortnight, and two of those dates
 * can straddle a month boundary. One file cannot live in two months, so it
 * lives in the month the piece first goes out — the month it belongs to in
 * everybody's head. Entries with no date do not vote; no dates at all means
 * no month, which means nothing is copied yet.
 */
export function earliestScheduledMonth(
  entries: ScheduleEntryLike[] | null | undefined,
): string | null {
  const times = (entries ?? [])
    .map(e => String(e?.scheduled_at ?? '').trim())
    .filter(Boolean)
    .map(s => ({ s, t: new Date(s).getTime() }))
    .filter(x => Number.isFinite(x.t))
  if (times.length === 0) return null
  times.sort((a, b) => a.t - b.t)
  const d = new Date(times[0].t)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// ── what never made it ────────────────────────────────────────────────────

/**
 * The self-healing pass, as arithmetic.
 *
 * Every mirror starts life as a queue call made on the side of a request that
 * has already answered the browser. On a serverless platform that is exactly
 * the moment the function can be frozen, and a queue call that never left is a
 * file that never reaches Drive — silently, with nothing anywhere recording
 * that it was meant to. `after()` closes that window for new uploads; it does
 * nothing for the files already missing, and nothing for a queue call that
 * failed for any other reason.
 *
 * So the sweep does not track intentions at all. It recomputes what SHOULD be
 * in an item's folder from the item itself — its job-pack assets, and every
 * slide of every version — subtracts what `drive_files` says is actually
 * there, and asks for the difference. Idempotent by construction: a file
 * already recorded is never in the answer, and the `(source_url, target)`
 * claim catches anything queued twice in the gap between two runs.
 *
 * Pure, so the arithmetic is testable without a database or a Drive.
 */
export type SweepVersion = VersionLike & { version_number?: number | null }

export type SweepItem = {
  id: string
  /** content_items.raw_assets, as it is stored */
  raw_assets?: { url?: string | null; name?: string | null }[] | null
  versions?: SweepVersion[] | null
}

export type WantedFile = {
  item_id: string
  source_url: string
  name: string
  target: MirrorTarget
}

/**
 * Every file that belongs in this item's own Drive folder, named exactly as
 * the live mirror callers name it — `mirrorRawAssets` for the job pack,
 * `mirrorVersionSlides` for the cuts. The names have to agree: a sweep that
 * invented its own would fill the folder with second copies under new names
 * the first time it ran.
 */
export function wantedItemFiles(item: SweepItem): WantedFile[] {
  const out: WantedFile[] = []
  const seen = new Set<string>()
  const add = (source_url: string, name: string) => {
    if (!isMirrorableUrl(source_url) || seen.has(source_url)) return
    seen.add(source_url)
    out.push({ item_id: item.id, source_url, name, target: 'item' })
  }

  for (const a of item.raw_assets ?? []) {
    const url = String(a?.url ?? '')
    add(url, String(a?.name ?? '').trim() || fileNameFromUrl(url))
  }

  // newest version last is irrelevant to correctness — every version's slides
  // belong in the folder, and each carries its own version number in its name
  for (const v of item.versions ?? []) {
    const slides = slidesOf(v).filter(s => isMirrorableUrl(s.url))
    const n = Number(v?.version_number ?? 0)
    slides.forEach((s, i) => {
      // through fileNameFromUrl either way: a version stored as a bare
      // `file_url` has no name of its own, so slidesOf recovers one from the
      // URL — complete with the `{millis}-{random}-` collision prefix that
      // objectKey put there. That prefix is ours, not the editor's, and a
      // repair pass is not the place to start writing it into folder listings.
      add(s.url, slideFileName(n, i, fileNameFromUrl(s.name || s.url), slides.length))
    })
  }
  return out
}

/**
 * The files that should be in Drive and are not, capped.
 *
 * `mirrored` is the set of `source_url`s that `drive_files` holds WITH a
 * `drive_file_id` — a claim whose upload never finished is deliberately not in
 * it, because that is precisely the row a retry is allowed to take back.
 *
 * The cap is a spend bound, not a correctness one: whatever is left over is
 * still missing at the next run, and the run after that, until it is done.
 */
export function missingItemMirrors(
  items: SweepItem[] | null | undefined,
  mirrored: Iterable<string>,
  cap = 100,
): WantedFile[] {
  const limit = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : 0
  if (limit === 0) return []
  const have = new Set<string>(mirrored)
  const out: WantedFile[] = []
  const seen = new Set<string>()
  for (const item of items ?? []) {
    for (const f of wantedItemFiles(item)) {
      if (have.has(f.source_url) || seen.has(f.source_url)) continue
      seen.add(f.source_url)
      out.push(f)
      if (out.length >= limit) return out
    }
  }
  return out
}

// ── who needs a permission of their own ───────────────────────────────────

export type MemberLike = {
  email?: string | null
  role?: string | null
  active_status?: boolean | null
}

/**
 * A test account. NEVER shared with, under any circumstances.
 *
 * `.invalid` is reserved by RFC 2606 precisely so it can never resolve, and
 * this codebase uses it for exactly that — the whole test suite is addressed
 * there so a test run can never email a real person. A Drive permission is
 * not an email, but `sendNotificationEmail=false` is a request, not a
 * guarantee, and a folder full of a client's raw footage is not the thing to
 * find that out on.
 */
export function isTestAddress(email: string | null | undefined): boolean {
  return /\.invalid$/i.test(String(email ?? '').trim())
}

export function emailDomain(email: string | null | undefined): string | null {
  const parts = String(email ?? '').trim().toLowerCase().split('@')
  return parts.length === 2 && parts[1] ? parts[1] : null
}

/**
 * The team members who need an explicit permission on the root folder.
 *
 * The rule is "who is NOT already covered". A Workspace domain share covers
 * everyone at that domain, so those people need nothing; a personal Gmail
 * account grants no domain share at all, so everyone does. Three exclusions
 * on top:
 *
 *  - **clients never get one.** The tree holds every client's raw footage,
 *    and a client with writer access to the root would see all of it. Clients
 *    have the portal; that is the whole point of the portal.
 *  - the connected account itself — it already owns the folder, and granting
 *    an owner a writer permission is at best a no-op.
 *  - `.invalid` test addresses, always.
 */
export function membersNeedingPermission(
  members: MemberLike[] | null | undefined,
  opts: { sharingDomain?: string | null; accountEmail?: string | null },
): string[] {
  const domain = String(opts.sharingDomain ?? '').trim().toLowerCase() || null
  const owner = String(opts.accountEmail ?? '').trim().toLowerCase()
  const out = new Set<string>()
  for (const m of members ?? []) {
    if (m?.active_status === false) continue
    if (String(m?.role ?? '') === 'client') continue
    const email = String(m?.email ?? '').trim().toLowerCase()
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue
    if (isTestAddress(email)) continue
    if (email === owner) continue
    // already covered by the domain-wide writer grant
    if (domain && emailDomain(email) === domain) continue
    out.add(email)
  }
  return [...out].sort()
}

export type PermissionLike = {
  id?: string | null
  emailAddress?: string | null
  type?: string | null
  role?: string | null
}

export type MemberDiff = {
  add: string[]
  remove: { id: string; email: string }[]
  keep: string[]
}

/**
 * What to change on the root folder so its people match the team.
 *
 * Reconciliation, not a delta of the last change: it is given the whole
 * desired set and the whole live set, so running it twice does nothing the
 * second time and running it after a week of missed events still lands in the
 * right place. That is what makes it safe to call from a route, a connect
 * callback and a button on a settings card.
 *
 * Only `type: 'user'` permissions are ever touched, and never the OWNER — an
 * owner permission cannot be deleted anyway, and asking is a 403 that would
 * abort the rest of the reconcile. A domain permission is likewise left
 * completely alone: it is the thing covering everyone this function decided
 * not to grant.
 */
export function memberPermissionDiff(
  desired: string[],
  existing: PermissionLike[] | null | undefined,
): MemberDiff {
  const want = new Set(desired.map(e => e.trim().toLowerCase()).filter(Boolean))
  const have = new Map<string, string>()
  const remove: { id: string; email: string }[] = []

  for (const p of existing ?? []) {
    if (String(p?.type ?? '') !== 'user') continue
    if (String(p?.role ?? '') === 'owner') continue
    const email = String(p?.emailAddress ?? '').trim().toLowerCase()
    const id = String(p?.id ?? '').trim()
    if (!email || !id) continue
    if (want.has(email)) {
      // a duplicate grant for someone we want is still a grant — keep the
      // first, and let the extras fall through to removal
      if (have.has(email)) remove.push({ id, email })
      else have.set(email, id)
    } else {
      remove.push({ id, email })
    }
  }

  return {
    add: [...want].filter(e => !have.has(e)).sort(),
    remove,
    keep: [...have.keys()].sort(),
  }
}

/** The Integrations card's member line. Plain counting, plainly said. */
export function sharingSummary(
  domain: string | null | undefined, personalCount: number,
): string {
  const n = Math.max(0, Math.floor(personalCount || 0))
  const people = `${n} personal account${n === 1 ? '' : 's'}`
  if (domain) {
    return n === 0
      ? `Shared with everyone at ${domain}.`
      : `Shared with ${domain} + ${people}.`
  }
  return n === 0
    ? 'Not shared with anyone yet — this is a personal Google account, so each person needs their own access.'
    : `Shared with ${people}.`
}

// ── the item card's one line ──────────────────────────────────────────────

export type MirrorProgress = {
  /** files on this item that a mirror would copy */
  total: number
  /** files already recorded in drive_files */
  done: number
  copying: boolean
  /** null when there is nothing to say */
  line: string | null
}

/**
 * "Mirrored to Drive · 7 files" / "Copying to Drive… 5 of 7".
 *
 * Counted from what is actually recorded, never from "we sent the event" — an
 * event that was sent and dropped (an un-synced Inngest function does exactly
 * that) would otherwise read as done forever. Anything short of the full
 * count reads as still copying, which is true whether the job is running, is
 * queued, or has quietly failed; the honest word for all three is "not yet".
 */
export function mirrorProgress(total: number, done: number): MirrorProgress {
  const t = Math.max(0, Math.floor(total || 0))
  const d = Math.min(t, Math.max(0, Math.floor(done || 0)))
  if (t === 0) return { total: 0, done: 0, copying: false, line: null }
  if (d >= t) {
    return {
      total: t, done: d, copying: false,
      line: `Mirrored to Drive · ${t} file${t === 1 ? '' : 's'}`,
    }
  }
  return { total: t, done: d, copying: true, line: `Copying to Drive… ${d} of ${t}` }
}

// ── resumable upload arithmetic ───────────────────────────────────────────

/**
 * Drive's rule: every chunk but the last must be a multiple of 256 KB.
 *
 * 8 MB is 32 of those. Large enough that a 2 GB master is 250 requests rather
 * than 8000, small enough that a serverless function never holds a meaningful
 * fraction of the file in memory — which is the whole reason this is a
 * resumable upload and not a single POST.
 */
export const CHUNK_MULTIPLE = 256 * 1024
export const CHUNK_SIZE = 32 * CHUNK_MULTIPLE

/** `bytes 0-8388607/2000000000` — the header that tells Drive where a chunk
 *  sits. Inclusive END, which is the off-by-one this function exists to
 *  contain. */
export function contentRange(start: number, endExclusive: number, total: number): string {
  return `bytes ${start}-${endExclusive - 1}/${total}`
}

/** The "how much of this do you have?" probe range — a star for the part
 *  that is not being sent, then the total. */
export function statusRange(total: number): string {
  return `bytes */${total}`
}

/**
 * How many bytes Drive says it already holds, from a 308's `Range` header.
 *
 * `bytes=0-42` means 43 bytes are in, so the next chunk starts at 43 — the
 * header is an inclusive range of what IS there, not an offset of what is
 * next. No header at all means it has nothing, which is how Drive answers a
 * session that received no bytes.
 */
export function receivedBytes(rangeHeader: string | null | undefined): number {
  const m = /bytes=(\d+)-(\d+)/.exec(String(rangeHeader ?? '').trim())
  if (!m) return 0
  return Number(m[2]) + 1
}
