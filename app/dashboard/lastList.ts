'use client'

/**
 * Where the person actually came from.
 *
 * The item detail page's "Back" used to be derived from the item's STATUS:
 * open a task from Production, approve it, and the arrow silently became
 * "← Scheduler" and took you to a page the task never appears on. A status is
 * a fact about the work; it is not a fact about your browsing.
 *
 * So the dashboard remembers the last LIST page you were on (a board, a queue,
 * the overview) and the detail page offers that. Session-scoped: a new tab
 * starts with no memory and falls back to backLinkFor, which is the old
 * behaviour and still a reasonable guess.
 */

const KEY = 'md-last-list'

/** The pages that count as somewhere to go back TO, and what to call them. */
const LISTS: { href: string; label: string }[] = [
  { href: '/dashboard/production', label: 'Production' },
  { href: '/dashboard/editor', label: 'Editor' },
  { href: '/dashboard/scheduler/calendar', label: 'Calendar' },
  { href: '/dashboard/scheduler', label: 'Scheduler' },
  { href: '/dashboard', label: 'Overview' },
]

/** Is this path one of the lists — and which? Longest match first, so
 *  /dashboard/scheduler/calendar is the calendar and not the queue. */
export function listFor(path: string): { href: string; label: string } | null {
  return LISTS.find(l => path === l.href) ?? null
}

/** Called on every dashboard navigation. A path that is not a list (an item
 *  detail, a shoot page, a settings screen) leaves the memory alone — that is
 *  the whole point: it survives the hop into the item. */
export function rememberList(path: string): void {
  const hit = listFor(path)
  if (!hit) return
  try { sessionStorage.setItem(KEY, hit.href) } catch { /* private mode */ }
}

/** Where "Back" should go, or null when we genuinely do not know. */
export function lastList(): { href: string; label: string } | null {
  try {
    const href = sessionStorage.getItem(KEY)
    return href ? listFor(href) : null
  } catch {
    return null
  }
}
