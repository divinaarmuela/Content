/**
 * A FEW AT A TIME, WITH LEFT AND RIGHT (the owner, 13 Nov 2026: "make sure it's not too long, make it like a button
 * left or right to show the posts, because when the list gets long the posts this month is all the way down").
 * Pure: how many pages, which rows a page holds, and which page a given row sits on.
 */

export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, size)))
}

/** a page number that exists, whatever was asked for */
export function clampPage(page: number, total: number, size: number): number {
  const last = pageCount(total, size) - 1
  return Number.isFinite(page) ? Math.min(last, Math.max(0, Math.trunc(page))) : 0
}

export function pageSlice<T>(rows: readonly T[], page: number, size: number): T[] {
  const s = Math.max(1, size)
  const p = clampPage(page, rows.length, s)
  return rows.slice(p * s, p * s + s)
}

/** the page that holds row `index` — the day's list opens on what is coming up next, not on this morning */
export function pageOfIndex(index: number, total: number, size: number): number {
  if (index < 0) return 0
  return clampPage(Math.floor(index / Math.max(1, size)), total, size)
}

/** "6–10 of 14" */
export function pageWords(page: number, total: number, size: number): string {
  if (total <= 0) return ''
  const s = Math.max(1, size)
  const p = clampPage(page, total, s)
  const from = p * s + 1
  const to = Math.min(total, from + s - 1)
  return from === to ? `${from} of ${total}` : `${from}–${to} of ${total}`
}

/**
 * Where today's list opens: the first row at or after now. Every row gone already → the last page (the end of the
 * day), not back to the morning.
 */
export function firstUpcoming(rows: readonly { at: string }[], nowWall: string | null): number {
  if (!nowWall || rows.length === 0) return 0
  const i = rows.findIndex(r => r.at >= nowWall)
  return i === -1 ? rows.length - 1 : i
}

/** how many Approved posts the Post approval board shows before "Show more", and how many each press adds */
export const APPROVED_STEP = 10

/**
 * How many rows of a long column to draw: `asked`, or more when a row the address points at sits further down
 * (`focused[i]` = row i is one of those). A linked post is never hidden behind "Show more".
 */
export function laneShown(asked: number, focused: readonly boolean[]): number {
  return Math.max(Math.max(0, Math.trunc(asked)), focused.lastIndexOf(true) + 1)
}

/** the To-dos pages: the only ones that carry the "search tasks, people, messages" box */
export function isTodosPage(path: string | null | undefined): boolean {
  return path === '/dashboard/todos' || String(path ?? '').startsWith('/dashboard/todos/')
}

/**
 * A POST IS IN ONE COLUMN (the owner, 13 Nov 2026: "approved posts that's going out today and confirmed, why is it
 * still in approved"). Approved holds every post that has left approval, and Going out today is drawn beside it from
 * its own list, so today's posts were in both. Whatever Going out today shows is taken out of the lane named here.
 */
export function withoutToday<G extends { lane: { key: string }; posts: readonly { id: string }[] }>(groups: readonly G[], todayIds: ReadonlySet<string>, laneKey = 'approved'): G[] {
  if (todayIds.size === 0) return [...groups]
  return groups.map(g => (g.lane.key === laneKey ? { ...g, posts: g.posts.filter(p => !todayIds.has(p.id)) } : g))
}
