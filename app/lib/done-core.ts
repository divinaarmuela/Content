/**
 * MARK A CARD DONE (the owner, 30 Oct 2026: "add a completed tab on each card it will then go to the last column in
 * editor and designer … after 1 and a half weeks they will disappear … mark done can be during any stage … any AM,
 * editor or super admin can do it"). Pure. A stamp on the card (`done_at`, `done_by`), never a status: whatever stage
 * the card is at stays as it is — its files, versions, posts and history untouched — and the Editor and Designer
 * pages put it in their last lane, Done, until a week and a half has passed, when it leaves the board. "Not done"
 * clears the stamp and the card is back where its stage puts it.
 */

/** a week and a half, in whole days — the card leaves the board on the 11th day after it was marked */
export const DONE_SHOWN_DAYS = 10

export function mayMarkDone(viewer: { role?: string | null } | null | undefined): boolean {
  return ['account_manager', 'super_admin', 'editor'].includes(String(viewer?.role ?? ''))
}

export function isMarkedDone(card: { done_at?: unknown } | null | undefined): boolean {
  return typeof card?.done_at === 'string' && card.done_at.length > 0
}

const dayBefore = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/** still on the board: not marked done, or marked within the last week and a half (`today` is "YYYY-MM-DD") */
export function doneStillShown(card: { done_at?: unknown }, today: string, days = DONE_SHOWN_DAYS): boolean {
  if (!isMarkedDone(card)) return true
  const day = String(card.done_at).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return true
  return day >= dayBefore(today, days)
}

/** what the row gets: stamped by this person now, or cleared */
export function donePatch(done: boolean, by: string, now: string): { done_at: string | null; done_by: string | null } {
  return done ? { done_at: now, done_by: by } : { done_at: null, done_by: null }
}
