/**
 * THE CARD IN THE ADDRESS.
 *
 * A card opened from a board slides in beside it, and the address carries
 * `?card=<id>` so a link to that card still lands on it and a refresh opens
 * it again. Closing takes the parameter back out. Pure string work, no
 * window: the hook that reads and writes the address calls these.
 */

export const CARD_PARAM = 'card'

/** the card named in a search string (`?card=abc`), or null */
export function readCardParam(search: string): string | null {
  try {
    const p = new URLSearchParams(search.startsWith('?') ? search : `?${search}`)
    const id = (p.get(CARD_PARAM) ?? '').trim()
    return id.length > 0 ? id : null
  } catch {
    return null
  }
}

/**
 * The same address with the card set (or, given null, removed). Works on a
 * full URL or a path; everything else in the address is left alone.
 */
export function withCardParam(href: string, id: string | null): string {
  const relative = !/^[a-z]+:\/\//i.test(href)
  const url = new URL(href, relative ? 'http://local.invalid' : undefined)
  if (id) url.searchParams.set(CARD_PARAM, id)
  else url.searchParams.delete(CARD_PARAM)
  if (!relative) return url.toString()
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Did a touch travel far enough sideways to count as "swipe it shut"?
 * Mostly horizontal (so a scroll is never a dismiss) and past the threshold.
 */
export function isDismissSwipe(dx: number, dy: number, threshold = 80): boolean {
  return dx >= threshold && Math.abs(dx) > Math.abs(dy) * 1.5
}
