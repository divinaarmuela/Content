/**
 * TAGS ON A CARD'S FILES (the owner, 28 Oct 2026: "allow to add a tag in the editor files anytime … or if the file has
 * been posted through our app it marks as posted automatically").
 *
 * Two kinds, one row of chips:
 *   - a person's tag — any word, added or taken off at any time. It belongs to the VIDEO, not one cut of it: written on
 *     every version of the asset, so a new version keeps the tags the last one had;
 *   - "Posted", worked out — never stored — from the posts booked through the app: a post that went out with this file
 *     on it. The same file (its address), the same Drive file, or the same name and size (Karly uploads the finished
 *     file again in the Schedule window, so the address differs but the bytes do not).
 * Pure: the files and the posts are handed in.
 */
import { assetIdOf, finalFilesOf, type FinalFile } from './final-files-core'

export const POSTED_TAG = 'Posted'
export const SCHEDULED_TAG = 'Scheduled'
export const MAX_TAGS = 12
export const MAX_TAG_LENGTH = 30

/** a tag as typed, made tidy: spaces collapsed, at most 30 characters; null when nothing is left */
export function cleanTag(raw: unknown): string | null {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH).trim()
  return t ? t : null
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** a file's own tags, cleaned and without repeats */
export function tagsOfFile(f: { tags?: unknown }): string[] {
  const out: string[] = []
  for (const raw of Array.isArray(f.tags) ? f.tags : []) {
    const t = cleanTag(raw)
    if (t && !out.some(x => same(x, t))) out.push(t)
  }
  return out.slice(0, MAX_TAGS)
}

/** a video's tags: every tag any of its versions carries */
export function tagsOfAsset(item: { final_files?: unknown }, assetId: string): string[] {
  const out: string[] = []
  for (const f of finalFilesOf(item)) if (assetIdOf(f) === assetId) for (const t of tagsOfFile(f)) if (!out.some(x => same(x, t))) out.push(t)
  return out
}

/** the card's files with a tag put on (or taken off) every version of one video */
export function withAssetTag(files: readonly FinalFile[], assetId: string, tag: string, on: boolean): FinalFile[] {
  const all = finalFilesOf({ final_files: files })
  const now = tagsOfAsset({ final_files: files }, assetId)
  const next = on ? (now.some(x => same(x, tag)) ? now : [...now, tag].slice(0, MAX_TAGS)) : now.filter(x => !same(x, tag))
  return all.map(f => (assetIdOf(f) === assetId ? { ...f, tags: next } : f))
}

/** every tag used on the card — offered when someone adds one, so "Ad" is not also "ad" and "Ads" */
export function tagsOnCard(item: { final_files?: unknown }): string[] {
  const out: string[] = []
  for (const f of finalFilesOf(item)) for (const t of tagsOfFile(f)) if (!out.some(x => same(x, t))) out.push(t)
  return out
}

export type PostLike = {
  id: string
  stage?: unknown
  status?: unknown
  published_at?: unknown
  cancelled?: unknown
  scheduled_for?: unknown
  slides?: unknown
}
type Slide = { url?: unknown; name?: unknown; bytes?: unknown; drive_file_id?: unknown }

/** a post that went out through the app — not one booked for later, not one cancelled */
export function wentOut(p: PostLike): boolean {
  if (p.cancelled || p.stage === 'cancelled') return false
  return p.stage === 'posted' || p.status === 'published' || !!p.published_at
}

/** a post booked to go out through the app and not gone yet */
export function bookedNotGone(p: PostLike): boolean {
  if (p.cancelled || p.stage === 'cancelled' || wentOut(p)) return false
  return p.stage === 'booked'
}

/** is this slide that file? */
export function slideIsFile(s: Slide, f: Pick<FinalFile, 'url' | 'name' | 'size' | 'drive_file_id'>): boolean {
  if (typeof s.url === 'string' && s.url === f.url) return true
  if (typeof s.drive_file_id === 'string' && s.drive_file_id && s.drive_file_id === f.drive_file_id) return true
  return typeof s.bytes === 'number' && s.bytes > 0 && s.bytes === f.size && typeof s.name === 'string' && s.name === f.name
}

/** which of the card's files went out in a post through the app, and when */
export function postedFiles(item: { final_files?: unknown }, posts: readonly PostLike[]): Map<string, { post_id: string; at: string | null }> {
  return filesIn(item, posts.filter(wentOut))
}

/** which of the card's files are booked in a post through the app that has not gone yet — the soonest one each */
export function scheduledFiles(item: { final_files?: unknown }, posts: readonly PostLike[]): Map<string, { post_id: string; at: string | null }> {
  return filesIn(item, posts.filter(bookedNotGone))
}

function filesIn(item: { final_files?: unknown }, gone: readonly PostLike[]): Map<string, { post_id: string; at: string | null }> {
  const out = new Map<string, { post_id: string; at: string | null }>()
  for (const f of finalFilesOf(item)) {
    for (const p of gone) {
      const slides = Array.isArray(p.slides) ? (p.slides as Slide[]) : []
      if (!slides.some(s => s && slideIsFile(s, f))) continue
      const at = typeof p.published_at === 'string' ? p.published_at : typeof p.scheduled_for === 'string' ? p.scheduled_for : null
      const had = out.get(f.id)
      if (!had || String(at ?? '') < String(had.at ?? '')) out.set(f.id, { post_id: p.id, at })
    }
  }
  return out
}

/**
 * The chips on one video: "Posted" first when the app posted it (or someone said so), then the person's tags.
 * `auto` says the Posted chip was worked out — it cannot be taken off by hand.
 */
export function chipsOf(item: { final_files?: unknown }, assetId: string, currentFileId: string | null, posted: Map<string, unknown>, scheduled: Map<string, { at: string | null }> = new Map()): { tag: string; auto: boolean; older?: boolean; at?: string | null }[] {
  const mine = tagsOfAsset(item, assetId)
  const versions = finalFilesOf(item).filter(f => assetIdOf(f) === assetId)
  const thisCut = !!currentFileId && posted.has(currentFileId)
  const anEarlierCut = !thisCut && versions.some(f => posted.has(f.id))
  const chips: { tag: string; auto: boolean; older?: boolean; at?: string | null }[] = []
  if (thisCut || anEarlierCut) chips.push({ tag: POSTED_TAG, auto: true, ...(anEarlierCut ? { older: true } : {}) })
  // SCHEDULED, BY ITSELF (the owner, 28 Oct 2026: "are there any current that will marked as scheduled?") — this cut is
  // booked in a post through the app that has not gone yet; it becomes Posted when the post goes out
  const booked = currentFileId ? scheduled.get(currentFileId) : undefined
  if (booked) chips.push({ tag: SCHEDULED_TAG, auto: true, at: booked.at })
  const autoTags = chips.map(c => c.tag.toLowerCase())
  for (const t of mine) if (!autoTags.includes(t.toLowerCase())) chips.push({ tag: t, auto: false })
  return chips
}
