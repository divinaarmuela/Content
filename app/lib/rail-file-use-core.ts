/**
 * WHERE EACH APPROVED FILE STANDS (the owner, 30 Oct 2026: "tag with approved but not scheduled … see under approved
 * folder approved but scheduled / posted … so its understanding for the team"). Pure — the rail and the new-post
 * window both read it. Worked out from EVERY post of the client, by the file's address, so a file booked from another
 * piece's post still reads Scheduled.
 *
 *   Posted          — a post holding it went out (stage Posted, or any network live)
 *   Scheduled · day — a post holding it is booked
 *   In post approval — a post holding it is in the quality check, with the client, or ready to book
 *   Not scheduled   — no post holds it (a draft or a cancelled one does not count)
 */

export type FileUse = { kind: 'posted' | 'scheduled' | 'approving'; at: string | null }
/** `urls` are the post's files by any key fileKeys gives — its address, and its name with its size */
export type UsePost = { stage: string | null; live: boolean; at: string | null; urls: readonly string[] }

/** a file's name without the " (3)" a browser adds to a second download of it (as file-tags-core.plainName) */
const plainName = (name: string) => name.replace(/\s*\(\d+\)(?=\.[^.]+$)/, '').trim().toLowerCase()

/**
 * THE KEYS A FILE IS KNOWN BY: its address, and — when it has both — its name and its size. The same video uploaded
 * again into a post has a new address but the same bytes (Jordan Wilson's October Videos, 30 Oct 2026: Video 01 and 02
 * were booked from fresh uploads, and the rail read them "not scheduled"); the editor's badges match the same way.
 */
export function fileKeys(f: { url?: string | null; name?: string | null; bytes?: number | null; size?: number | null }): string[] {
  const keys = f.url ? [f.url] : []
  const size = typeof f.bytes === 'number' ? f.bytes : typeof f.size === 'number' ? f.size : 0
  if (size > 0 && f.name) keys.push(`nb:${plainName(f.name)}|${size}`)
  return keys
}

/** where one file stands, by any of its keys */
export function useOfFile(f: Parameters<typeof fileKeys>[0], uses: ReadonlyMap<string, FileUse>): FileUse | undefined {
  const found = fileKeys(f).map(k => uses.get(k)).filter((u): u is FileUse => !!u)
  return found.sort((a, b) => RANK[b.kind] - RANK[a.kind])[0]
}


const RANK: Record<FileUse['kind'], number> = { posted: 3, scheduled: 2, approving: 1 }

export function fileUses(posts: readonly UsePost[]): Map<string, FileUse> {
  const out = new Map<string, FileUse>()
  for (const p of posts) {
    const kind: FileUse['kind'] | null = p.stage === 'posted' || p.live ? 'posted'
      : p.stage === 'booked' ? 'scheduled'
      : p.stage === 'quality_check' || p.stage === 'with_client' || p.stage === 'ready' ? 'approving'
      : null
    if (!kind) continue
    for (const u of p.urls) {
      const had = out.get(u)
      // the furthest along wins; between two bookings, the sooner; between two posts, the latest
      const better = !had || RANK[kind] > RANK[had.kind]
        || (kind === had.kind && kind === 'scheduled' && String(p.at ?? '') < String(had.at ?? ''))
        || (kind === had.kind && kind === 'posted' && String(p.at ?? '') > String(had.at ?? ''))
      if (better) out.set(u, { kind, at: p.at })
    }
  }
  return out
}

export type UseTone = 'free' | 'scheduled' | 'posted' | 'approving'

const day = (iso: string, tz: string) =>
  new Date(iso).toLocaleDateString('en-AU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' })

/** the words on one file: "Not scheduled", "Scheduled · Sat 7 Nov", "Posted · Sun 1 Nov", "In post approval" */
export function fileTag(use: FileUse | undefined, tz = 'Australia/Melbourne'): { words: string; tone: UseTone } {
  if (!use) return { words: 'Not scheduled', tone: 'free' }
  if (use.kind === 'posted') return { words: use.at ? `Posted · ${day(use.at, tz)}` : 'Posted', tone: 'posted' }
  if (use.kind === 'scheduled') return { words: use.at ? `Scheduled · ${day(use.at, tz)}` : 'Scheduled', tone: 'scheduled' }
  return { words: 'In post approval', tone: 'approving' }
}

/** how a piece's files stand, counted: "2 not scheduled · 3 scheduled · 1 posted" — zeros left out */
export function fileCounts(urls: readonly string[], uses: ReadonlyMap<string, FileUse>): { free: number; approving: number; scheduled: number; posted: number } {
  const n = { free: 0, approving: 0, scheduled: 0, posted: 0 }
  for (const u of urls) {
    const k = uses.get(u)?.kind
    if (k === 'posted') n.posted++
    else if (k === 'scheduled') n.scheduled++
    else if (k === 'approving') n.approving++
    else n.free++
  }
  return n
}

export function fileSummary(urls: readonly string[], uses: ReadonlyMap<string, FileUse>): string {
  const n = fileCounts(urls, uses)
  return [
    n.free ? `${n.free} not scheduled` : null,
    n.approving ? `${n.approving} in post approval` : null,
    n.scheduled ? `${n.scheduled} scheduled` : null,
    n.posted ? `${n.posted} posted` : null,
  ].filter(Boolean).join(' · ')
}

/** RECENTLY APPROVED (the owner, 30 Oct 2026: "always have recently approved assets tab") — the last 30 days */
export const RECENT_DAYS = 30

/** when the piece was approved: the client's latest approval of a clip, else when an approved card last changed */
export function approvedAtOf(item: { clip_approvals?: unknown; status?: unknown; updated_at?: unknown }): string | null {
  const ticks = Array.isArray(item.clip_approvals)
    ? item.clip_approvals.map(a => (a && typeof a === 'object' ? String((a as { at?: unknown }).at ?? '') : '')).filter(Boolean).sort()
    : []
  if (ticks.length) return ticks[ticks.length - 1]
  return ['approved_for_scheduling', 'scheduled', 'published'].includes(String(item.status ?? '')) && typeof item.updated_at === 'string' ? item.updated_at : null
}

export function isRecent(approvedAt: string | null, now: Date, days = RECENT_DAYS): boolean {
  return !!approvedAt && now.getTime() - new Date(approvedAt).getTime() <= days * 86_400_000
}
