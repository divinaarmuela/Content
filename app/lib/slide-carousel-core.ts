/**
 * The arithmetic behind a carousel viewer.
 *
 * A carousel is three small decisions repeated: which slide comes next, was
 * that drag a swipe or a scroll, and has the client actually looked at all of
 * them yet. All three used to live inside a component, where the only way to
 * check them was to open a browser and flick at it.
 *
 * Pure: no DOM, no React. `SlideCarousel` is the shell around this.
 */

/** A drag shorter than this is a tap, a tremor, or the start of a scroll. */
export const SWIPE_THRESHOLD_PX = 40

/** Clamp into range, so a stale index (slides changed under us) still points
 *  at a slide that exists. An empty set has no valid index — 0 is the answer
 *  a caller can render nothing from. */
export function clampIndex(index: number, total: number): number {
  if (!Number.isFinite(index) || !Number.isFinite(total) || total <= 0) return 0
  return Math.min(Math.max(Math.floor(index), 0), Math.floor(total) - 1)
}

/**
 * Forward one, wrapping.
 *
 * Wrapping rather than stopping: a client on the last card of a six-card post
 * pressing › expects to come round to the first, the way the feed itself
 * behaves. One slide means there is nowhere to go.
 */
export function nextIndex(current: number, total: number): number {
  if (!Number.isFinite(total) || total <= 1) return 0
  const n = Math.floor(total)
  return (clampIndex(current, n) + 1) % n
}

/** Back one, wrapping the other way. */
export function prevIndex(current: number, total: number): number {
  if (!Number.isFinite(total) || total <= 1) return 0
  const n = Math.floor(total)
  return (clampIndex(current, n) - 1 + n) % n
}

export type SwipeDecision = 'next' | 'prev' | 'none'

/**
 * Was that a swipe, and which way?
 *
 * Dragging LEFT (a negative dx) pulls the next slide in from the right, which
 * is the direction every gallery on a phone already moves. A drag that is more
 * vertical than horizontal is the page being scrolled and must never turn the
 * carousel — that is the bug that makes a feed unusable on a phone.
 */
export function swipeDecision(
  dx: number, dy: number, threshold: number = SWIPE_THRESHOLD_PX,
): SwipeDecision {
  const x = Number(dx)
  const y = Number(dy)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'none'
  if (Math.abs(x) < threshold) return 'none'
  if (Math.abs(y) > Math.abs(x)) return 'none'
  return x < 0 ? 'next' : 'prev'
}

/**
 * Which slides has this person actually had in front of them.
 *
 * Kept as a sorted, unique list of indexes rather than a count, because the
 * client who taps ›  ‹  ›  ‹ has seen two slides, not four. Out-of-range
 * indexes are ignored rather than stored: a stale index would make the
 * "all seen" test true while a card was still unlooked-at.
 */
export function markSeen(
  seen: readonly number[], index: number, total: number,
): number[] {
  const n = Number.isFinite(total) ? Math.floor(total) : 0
  const i = Number.isFinite(index) ? Math.floor(index) : -1
  const kept = (seen ?? []).filter(s => Number.isInteger(s) && s >= 0 && s < n)
  if (i < 0 || i >= n) return [...new Set(kept)].sort((a, b) => a - b)
  return [...new Set([...kept, i])].sort((a, b) => a - b)
}

/** Every slide looked at. A single-file piece is seen the moment it renders. */
export function allSeen(seen: readonly number[], total: number): boolean {
  const n = Number.isFinite(total) ? Math.floor(total) : 0
  if (n <= 0) return false
  return markSeen(seen, -1, n).length >= n
}

/** "2 / 5" — the position line on the full viewer. */
export function counterLabel(index: number, total: number): string | null {
  const n = Number.isFinite(total) ? Math.floor(total) : 0
  if (n < 2) return null
  return `${clampIndex(index, n) + 1} / ${n}`
}

/**
 * What to print beside Approve.
 *
 * It is a nudge, never a gate — approval is not blocked on it (see
 * ReviewCard). Nothing at all for a single-file piece: there is no second
 * card to have missed.
 */
export function seenLabel(seen: readonly number[], total: number): string | null {
  const n = Number.isFinite(total) ? Math.floor(total) : 0
  if (n < 2) return null
  if (allSeen(seen, n)) return 'All slides seen ✓'
  return `Seen ${markSeen(seen, -1, n).length} of ${n} slides`
}

/** What one slide looks like to the viewer — the portal payload's shape, and
 *  the least a caller can get away with. */
export type ViewerSlide = { url: string; name?: string; type?: 'image' | 'video' }

/**
 * Every card of a post, in posting order.
 *
 * `slides` is what the portal payload carries. `preview_url` is the fallback
 * for anything reaching a viewer without it — an older reader, or a version
 * whose only media is a link `slidesOf` would not vouch for. Lives here, not
 * beside the components, because a server page and a client card both ask.
 */
export function slidesFor(
  item: { slides?: readonly ViewerSlide[] | null; preview_url?: string | null } | null | undefined,
): ViewerSlide[] {
  const many = (item?.slides ?? []).filter(s => s && typeof s.url === 'string' && s.url)
  if (many.length > 0) return many.map(s => ({ url: s.url, name: s.name, type: s.type }))
  return item?.preview_url ? [{ url: item.preview_url }] : []
}
