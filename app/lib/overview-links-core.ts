/**
 * WHERE THE OVERVIEW SENDS EACH ROLE — pure, no I/O.
 *
 * The owner, 13 Sep 2026: "this needs fixing for every role too, the button
 * pages are wrong"; "doesn't make sense quality review can create a post";
 * "the link … is wrong, that page doesn't exist anymore". Every link the
 * Overview draws goes through here, so one rule decides: a link opens a page
 * the role HAS (`defaultAllows`), a card opens ON A BOARD the role has (the
 * boards read `?card=`), and the stage chips are that role's own columns.
 */

import type { Role } from './identity-core'
import { defaultAllows, SCHEDULE_PAGE } from './page-access-core'
import { BOARD_COLUMNS, columnOf, type BoardColumnKey } from './board-core'
import { EDITOR_LANES } from './editor-sop-core'
import type { ItemStatus } from './workflow-core'

export const EDITOR_BOARD = '/dashboard/editor'
export const POST_APPROVAL_BOARD = '/dashboard/scheduler'
export const SHOOTS_PAGE = '/dashboard/production'
export const CALENDAR_PAGE = '/dashboard/scheduler/calendar'

/** Who may make a post or a card from a "New …" button. A quality checker
 *  and an editor check and make; they do not raise posts. */
export const MAY_CREATE_POST: readonly Role[] = ['scheduler', 'general', 'account_manager', 'super_admin']
export function mayCreatePost(role: Role | string | null | undefined): boolean {
  return (MAY_CREATE_POST as readonly string[]).includes(String(role ?? ''))
}

/** Roles with the Schedule page — the only ones shown booking affordances. */
export function mayBookPosts(role: Role | null | undefined): boolean {
  return !!role && defaultAllows(role, SCHEDULE_PAGE)
}

/** The stages a card is still being MADE in — those live on the Editor
 *  board; everything after is Post approval's. */
const MAKING: readonly string[] = ['draft_uploaded', 'revision_required', 'revision_complete', 'quality_check', 'internal_review']

/**
 * A card, opened on a board this role has. The old full-card page
 * (`/dashboard/production/<id>`) is not a link anybody is sent to.
 */
export function cardHref(role: Role | null | undefined, card: { id: string; status?: ItemStatus | string | null }): string {
  const status = String(card.status ?? '')
  const onEditor = MAKING.includes(status)
  let board: string
  switch (role) {
    case 'editor': board = EDITOR_BOARD; break
    case 'scheduler': board = POST_APPROVAL_BOARD; break
    case 'quality_checker': board = POST_APPROVAL_BOARD; break
    default: board = onEditor ? EDITOR_BOARD : POST_APPROVAL_BOARD
  }
  return `${board}?card=${encodeURIComponent(card.id)}`
}

/** A shoot's own page — every role that has Shoots opens it there. */
export function shootHref(shootId: string): string {
  return `${SHOOTS_PAGE}/shoots/${encodeURIComponent(shootId)}`
}

export type OverviewChip = {
  key: string
  label: string
  href: string
  /** which board columns this chip counts (post cards by status → column) */
  columns: readonly BoardColumnKey[]
  /** a chip counted from somewhere else (plans waiting on the quality checker) */
  external?: 'plans_in_review'
}

/**
 * "Where everything is right now", in the role's OWN columns, each chip a
 * way into that column of a board the role has.
 */
export function overviewChips(role: Role | null | undefined): OverviewChip[] {
  if (role === 'editor') {
    return EDITOR_LANES.map(l => ({
      key: l.key, label: l.label, columns: l.columns,
      href: `${EDITOR_BOARD}?column=${l.columns[0]}`,
    }))
  }
  if (role === 'scheduler') {
    return BOARD_COLUMNS
      .filter(c => ['ready_to_post', 'booked', 'posted'].includes(c.key))
      .map(c => ({ key: c.key, label: c.label, columns: [c.key], href: `${POST_APPROVAL_BOARD}?column=${c.key}` }))
  }
  if (role === 'quality_checker') {
    return [
      { key: 'quality_check', label: 'Quality check', columns: ['quality_check'], href: `${POST_APPROVAL_BOARD}?column=quality_check` },
      { key: 'plans_in_review', label: 'Plans to review', columns: [], href: SHOOTS_PAGE, external: 'plans_in_review' },
    ]
  }
  // general, account manager, super admin: the seven Post approval columns
  return BOARD_COLUMNS.map(c => ({ key: c.key, label: c.label, columns: [c.key], href: `${POST_APPROVAL_BOARD}?column=${c.key}` }))
}

/** Count post cards by status into a chip's columns. */
export function chipCount(chip: OverviewChip, pipeline: Record<string, number> | undefined, plansInReview = 0): number {
  if (chip.external === 'plans_in_review') return plansInReview
  let n = 0
  for (const [status, count] of Object.entries(pipeline ?? {})) {
    const col = columnOf(status as ItemStatus)
    if (col && chip.columns.includes(col)) n += count
  }
  return n
}

/** The page an href lands on, for `defaultAllows`: the query is dropped and
 *  a shoot's or client's own page counts as its list page. */
export function pageOf(href: string): string {
  const path = href.split('?')[0].split('#')[0]
  if (path.startsWith(`${SHOOTS_PAGE}/shoots/`)) return SHOOTS_PAGE
  if (path.startsWith('/dashboard/clients/')) return '/dashboard/clients'
  // the calendar is Post approval's own sub-page
  if (path === CALENDAR_PAGE) return POST_APPROVAL_BOARD
  return path
}

/** Is this link one the role may follow from the Overview? */
export function linkAllowed(role: Role | null | undefined, href: string): boolean {
  if (!role) return false
  const page = pageOf(href)
  if (href.split('?')[0] === CALENDAR_PAGE) return defaultAllows(role, page) && mayBookPosts(role)
  return defaultAllows(role, page)
}

/** A section's action, or nothing when the role lacks the page. */
export function actionFor(role: Role | null | undefined, label: string, href: string): { label: string; href: string } | undefined {
  return linkAllowed(role, href) ? { label, href } : undefined
}

/**
 * Every href the Overview may draw for a role, as data — what the test
 * checks against `defaultAllows`. Cards use a sample id; the boards read
 * whatever id follows `?card=`.
 */
export function overviewLinksFor(role: Role): string[] {
  const sample = { id: 'card-1' }
  const links = new Set<string>()
  for (const chip of overviewChips(role)) links.add(chip.href)
  for (const status of ['draft_uploaded', 'quality_check', 'client_review', 'approved_for_scheduling', 'scheduled', 'published']) {
    links.add(cardHref(role, { ...sample, status }))
  }
  if (defaultAllows(role, SHOOTS_PAGE)) links.add(shootHref('shoot-1'))
  if (role === 'editor' || role === 'general' || role === 'account_manager' || role === 'super_admin') links.add(EDITOR_BOARD)
  if (role !== 'editor') links.add(POST_APPROVAL_BOARD)
  if (mayBookPosts(role) && role !== 'general') links.add(CALENDAR_PAGE)
  if (role === 'account_manager' || role === 'super_admin' || role === 'general') links.add('/dashboard/clients')
  if (role === 'super_admin') links.add('/dashboard/leads')
  return [...links]
}
