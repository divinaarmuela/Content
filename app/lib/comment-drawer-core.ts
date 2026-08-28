/**
 * The comments drawer's pure logic — no I/O, fully unit-testable.
 *
 * The drawer lets anyone read and write an item's comments WITHOUT leaving
 * the board they are working on. Three small rules live here so the three
 * boards and the drawer itself can never disagree about them:
 *
 * - `?comments=<itemId>` is the deep link that opens the drawer on load, so
 *   a notification email can land a person straight in the conversation.
 *   It is additive: it never replaces the page, and closing the drawer
 *   removes only that one parameter.
 * - the badge on the card's comment button: an amber dot means somebody
 *   tagged YOU here and it is not done — the same signal the TurnChip and
 *   the "Waiting on you" card read (`my_open_task` from the items API).
 */

/** The item id in `?comments=…`, if the URL carries one. */
export function commentsParamOf(search: string): string | null {
  try {
    const id = new URLSearchParams(search).get('comments')
    const trimmed = id?.trim() ?? ''
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

/**
 * The same URL with `?comments=<id>` set (or removed, when id is null) and
 * every other parameter kept — so opening the drawer never wipes a filter
 * someone put in the URL, and closing it leaves the page exactly as found.
 */
export function withCommentsParam(pathname: string, search: string, id: string | null): string {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search)
  } catch {
    params = new URLSearchParams()
  }
  if (id && id.trim()) params.set('comments', id.trim())
  else params.delete('comments')
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

/**
 * What the card's comment button should say and show.
 *
 * `tagged` is the items API's `my_open_task`: somebody tagged the viewer in
 * a comment on this item and it has not been marked done. That earns the
 * amber dot and a label that says why — a bare dot is a mystery.
 */
export function commentBadge(tagged: boolean | undefined): { dot: boolean; label: string } {
  return tagged
    ? { dot: true, label: 'Comments — someone tagged you here' }
    : { dot: false, label: 'Comments' }
}
