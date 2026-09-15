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

/**
 * WHO GETS THE MAKER'S DRAWER on the Editor page — the one with the link box,
 * the checks and the submit, instead of the manager's card with its buttons.
 *
 * An editor, always: they only ever hold their own cards. A general user who
 * holds the card (14 Sep 2026). And ANYONE who holds the card while it is in
 * their hands — Draft, or back for changes (the owner, 15 Sep 2026: a super
 * admin made a card in Editor, assigned it to themselves, and asked "why
 * can't I add the folder link then? I assigned it to myself…"). Once the
 * card is out of their hands — at the quality check, with the client, or
 * waiting on a decision — a manager is back to managing it.
 */
export const HELD_WHILE_MAKING: readonly string[] = ['draft_uploaded', 'revision_required']

export function usesMakerDrawer(
  me: { id?: string | null; role?: string | null } | null | undefined,
  card: { owner_id?: string | null; status?: string | null } | null | undefined,
): boolean {
  if (!me) return false
  if (me.role === 'editor') return true
  const holder = !!me.id && !!card && card.owner_id === me.id
  if (!holder) return false
  if (me.role === 'general') return true
  return HELD_WHILE_MAKING.includes(String(card?.status ?? ''))
}
