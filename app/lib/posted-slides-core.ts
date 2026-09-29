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

export type PostLike = {
  /** THE post's stage (`social_posts.stage`) — what decides, whenever the row has one */
  stage?: unknown
  /** the legacy column: read ONLY for a row the migration has not given a stage yet */
  status?: unknown
  slides?: unknown
  /** per network: `per_channel[account].slides` — a network with its own files takes those too */
  per_channel?: unknown
  publish_job_ids?: unknown
}
export type SlideLike = { url: string }

export type PostedSlides = {
  /** the urls that have gone out, by a post or by hand */
  urls: string[]
  posted: number
  total: number
  /** the files marked posted BY HAND: when it went out, and the live link if
   *  there was one (the owner, 9 Sep 2026: "how can I mark or put the time
   *  it posted and log it?") */
  /* A LIST, not a map keyed by url: a database key cannot hold `.` or `/`
   * (CLAUDE.md trap 9) — the first write of a url-keyed map was refused. */
  hand?: { url: string; at: string; link: string | null }[]
}

const listOf = (v: unknown): unknown[] =>
  Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v as Record<string, unknown>) : []
const slideUrls = (v: unknown): string[] =>
  listOf(v)
    .map(s => (s && typeof s === 'object' ? String((s as { url?: unknown }).url ?? '') : ''))
    .filter(Boolean)
/** every file the post holds: its shared slides and any network's own */
const urlsOf = (p: PostLike): string[] => {
  const out = new Set(slideUrls(p.slides))
  for (const extras of listOf(p.per_channel)) {
    if (extras && typeof extras === 'object') for (const u of slideUrls((extras as { slides?: unknown }).slides)) out.add(u)
  }
  return [...out]
}

/**
 * THE STAGES THAT HOLD A POST'S FILES (SPEC §4.3, audit S6): once a post is
 * sent for quality check its files are spoken for, until it is cancelled. A
 * draft holds nothing — "a forgotten draft had swallowed the other three"
 * (the owner, 9 Sep 2026) — and a cancelled post gives its files back.
 */
export const STAGES_HOLDING_FILES = ['quality_check', 'with_client', 'ready', 'booked', 'posted'] as const
const STAGES = ['draft', 'quality_check', 'with_client', 'ready', 'booked', 'posted', 'cancelled']
const stageOf = (p: PostLike): string | null => (STAGES.includes(String(p.stage ?? '')) ? String(p.stage) : null)

/**
 * urls in a post that holds them — not free to post again. Read off the
 * post's STAGE: a failed booking comes back to Ready to post and still holds
 * its files (it is re-timed, not remade), and a cancelled post lets them go.
 * The old rule read `status`, which stayed 'scheduled' after a job failed or
 * was cancelled, so the rail kept files nobody could reach (audit S6).
 *
 * A row with no stage yet (before the migration, package P8) is read the old
 * way — booked or published — so the server and the portal behave the same
 * until every row has one.
 */
export function takenSlideUrls(posts: readonly PostLike[]): Set<string> {
  const out = new Set<string>()
  for (const p of posts) {
    const stage = stageOf(p)
    const holds = stage
      ? (STAGES_HOLDING_FILES as readonly string[]).includes(stage)
      : ['scheduled', 'published'].includes(String(p.status ?? ''))
    if (!holds) continue
    for (const u of urlsOf(p)) out.add(u)
  }
  return out
}

/** urls that a post actually PUBLISHED — its stage is Posted, or one of the
 *  publish jobs it carries has (`publishedJobIds`), which is how the live
 *  system records it the moment it happens. A row with no stage yet is read
 *  by its old `status`. */
export function publishedSlideUrls(posts: readonly PostLike[], publishedJobIds: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>()
  for (const p of posts) {
    const jobs = listOf(p.publish_job_ids).map(String)
    const stage = stageOf(p)
    const live = (stage ? stage === 'posted' : String(p.status ?? '') === 'published') || jobs.some(j => publishedJobIds.has(j))
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
  hand: PostedSlides['hand'] = undefined,
): PostedSlides {
  const done = new Set<string>([...published, ...byHand])
  const urls = slides.map(s => s.url).filter(u => done.has(u))
  const out: PostedSlides = { urls, posted: urls.length, total: slides.length }
  if (hand && hand.length > 0) out.hand = hand
  return out
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
  const rawHand = (o as { hand?: unknown }).hand
  const hand: NonNullable<PostedSlides['hand']> = []
  if (Array.isArray(rawHand)) {
    for (const v of rawHand) {
      if (v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string' && typeof (v as { at?: unknown }).at === 'string') {
        hand.push({ url: (v as { url: string }).url, at: (v as { at: string }).at, link: typeof (v as { link?: unknown }).link === 'string' ? (v as { link: string }).link : null })
      }
    }
  }
  return hand.length > 0 ? { urls, posted, total, hand } : { urls, posted, total }
}

/** the card's line — only while it is part-way: "2 of 4 posted" */
export function postedLine(p: PostedSlides | null | undefined): string | null {
  if (!p || p.total === 0 || p.posted === 0 || p.posted >= p.total) return null
  return `${p.posted} of ${p.total} posted`
}

/** the by-hand record for one file, if there is one */
export function handRecord(p: PostedSlides | null | undefined, url: string): { url: string; at: string; link: string | null } | null {
  return p?.hand?.find(h => h.url === url) ?? null
}
