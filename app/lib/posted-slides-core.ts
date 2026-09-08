/**
 * A PIECE POSTED IN PARTS.
 *
 * The owner, 9 Sep 2026: "if an item is in Ready to post, sometimes I will
 * only schedule 2 or 3 from those — some items will automatically be posted
 * and one card may be left under Ready to post." A card holds several files;
 * a post takes some of them. So a card is POSTED when every one of its files
 * has gone out — through a post that published, or marked posted by hand —
 * and until then it stays in Ready to post, saying "2 of 4 posted", with only
 * the files still to go offered on the Schedule page.
 *
 * Pure: what is posted, what is still free, and the words. The row on the
 * card (`content_items.posted_slides`) is written by the server from these.
 */

export type PostLike = { status?: unknown; slides?: unknown; publish_job_ids?: unknown }
export type SlideLike = { url: string }

export type PostedSlides = {
  /** the urls that have gone out, by a post or by hand */
  urls: string[]
  posted: number
  total: number
}

const urlsOf = (p: PostLike): string[] =>
  (Array.isArray(p.slides) ? p.slides : [])
    .map(s => (s && typeof s === 'object' ? String((s as { url?: unknown }).url ?? '') : ''))
    .filter(Boolean)

/** urls in a post that is live, booked, or on its way — not free to post again */
export function takenSlideUrls(posts: readonly PostLike[]): Set<string> {
  const out = new Set<string>()
  for (const p of posts) {
    const s = String(p.status ?? '')
    if (s === 'cancelled' || s === 'failed') continue
    for (const u of urlsOf(p)) out.add(u)
  }
  return out
}

/** urls that a post actually PUBLISHED — its own row says so, or one of the
 *  publish jobs it carries has (`publishedJobIds`), which is how the live
 *  system records it */
export function publishedSlideUrls(posts: readonly PostLike[], publishedJobIds: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>()
  for (const p of posts) {
    const jobs = (Array.isArray(p.publish_job_ids) ? p.publish_job_ids : []).map(String)
    const live = String(p.status ?? '') === 'published' || jobs.some(j => publishedJobIds.has(j))
    if (!live) continue
    for (const u of urlsOf(p)) out.add(u)
  }
  return out
}

/** the piece's files that are still free to make a post out of */
export function remainingSlides<T extends SlideLike>(slides: readonly T[], taken: ReadonlySet<string>): T[] {
  return slides.filter(s => !taken.has(s.url))
}

/** what has gone out, against the piece's current files */
export function postedProgress(
  slides: readonly SlideLike[],
  published: ReadonlySet<string>,
  byHand: readonly string[] = [],
): PostedSlides {
  const done = new Set<string>([...published, ...byHand])
  const urls = slides.map(s => s.url).filter(u => done.has(u))
  return { urls, posted: urls.length, total: slides.length }
}

export function fullyPosted(p: PostedSlides | null | undefined): boolean {
  return !!p && p.total > 0 && p.posted >= p.total
}

/** read the row's json back, defensively */
export function readPostedSlides(v: unknown): PostedSlides | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { urls?: unknown; posted?: unknown; total?: unknown }
  const urls = Array.isArray(o.urls) ? o.urls.map(String) : []
  const total = Number(o.total ?? 0)
  const posted = Number(o.posted ?? urls.length)
  if (!Number.isFinite(total) || !Number.isFinite(posted)) return null
  return { urls, posted, total }
}

/** the card's line — only while it is part-way: "2 of 4 posted" */
export function postedLine(p: PostedSlides | null | undefined): string | null {
  if (!p || p.total === 0 || p.posted === 0 || p.posted >= p.total) return null
  return `${p.posted} of ${p.total} posted`
}
