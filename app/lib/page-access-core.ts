/**
 * Pure page-visibility logic — no imports, no I/O, fully unit-testable.
 *
 * The role ladder decides who sees which dashboard page by default. A super
 * admin can open a page to roles that would not normally reach it; those
 * grants live in page_access and are applied here.
 *
 * One rule holds the whole thing safe: a grant only ever ADDS. Nothing in
 * this file can take a page away from someone who already had it, so a
 * mistyped setting cannot lock the team out of its own work.
 */

import type { Role } from './identity-core'

/** Extra roles allowed per page: '/dashboard/leads' → ['editor']. */
export type PageAccess = Record<string, string[]>

/**
 * The default ladder, mirroring what the sidebar has always done:
 * editors live on the production board, schedulers on the scheduler and
 * calendar, clients get nothing, and everyone above sees everything.
 */
export function defaultAllows(role: Role | null, href: string): boolean {
  if (role === null) return false             // unknown identity — show nothing yet
  if (role === 'client') return false
  if (role === 'editor') return href === '/dashboard/production'
  if (role === 'scheduler') return ['/dashboard/scheduler', '/dashboard/calendar'].includes(href)
  return true                                  // account_manager, super_admin
}

/** May this role see this page, once a super admin's grants are applied? */
export function canSeePage(role: Role | null, href: string, access: PageAccess): boolean {
  if (role === null) return false
  if (defaultAllows(role, href)) return true
  // super admins already pass above; a grant never widens beyond team roles
  if (role === 'client') return false
  return (access[href] ?? []).includes(role)
}

/** Filter a nav list. Order is preserved — a granted page appears where it
 *  always sits, not appended somewhere surprising. */
export function visiblePages<T extends { href: string }>(
  role: Role | null, items: T[], access: PageAccess,
): T[] {
  return items.filter(i => canSeePage(role, i.href, access))
}

/** Roles a page can be granted to. Super admins see everything already, and
 *  `client` is a different axis entirely — neither is offerable. */
export const GRANTABLE_ROLES: Role[] = ['scheduler', 'editor', 'account_manager']

/** Clean a grant list arriving from a browser: known roles only, deduped,
 *  and never the two that make no sense. */
export function normaliseGrantRoles(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : []
  const out: string[] = []
  for (const item of list) {
    const role = String(item ?? '').trim()
    if (!GRANTABLE_ROLES.includes(role as Role)) continue
    if (!out.includes(role)) out.push(role)
  }
  return out
}
