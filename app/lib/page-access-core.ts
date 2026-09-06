/**
 * Pure page-visibility logic — no imports beyond a type, no I/O, fully
 * unit-testable.
 *
 * A person's role decides which dashboard pages they see by default. A super
 * admin can additionally open a page to an INDIVIDUAL — "let Manal see Leads"
 * is the real request, and granting it to every account manager to reach one
 * of them is how permissions sprawl.
 *
 * One rule holds the whole thing safe: a grant only ever ADDS. Nothing here
 * can take a page away from someone who has it by default, so a mistyped
 * setting cannot lock the team out of its own work.
 */

import type { Role } from './identity-core'

/** Pages granted to one person, as hrefs. */
export type GrantedPages = string[]

/**
 * Every page a super admin may hand out, in sidebar order.
 *
 * `parent` marks a SUBPAGE — a tab inside another page. A subpage is only
 * ever reachable when its parent is, which keeps "can see Clients but not
 * their credentials" expressible without inventing a second permission model.
 */
export const GRANTABLE_PAGES: { href: string; label: string; parent?: string }[] = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/leads', label: 'Leads' },
  { href: '/dashboard/clients', label: 'Clients' },
  { href: '/dashboard/clients/:id/contacts', label: 'Contacts', parent: '/dashboard/clients' },
  { href: '/dashboard/clients/:id/notes', label: 'Notes', parent: '/dashboard/clients' },
  { href: '/dashboard/clients/:id/credentials', label: 'Credentials', parent: '/dashboard/clients' },
  { href: '/dashboard/clients/:id/social', label: 'Social', parent: '/dashboard/clients' },
  { href: '/dashboard/clients/:id/intake', label: 'Intake', parent: '/dashboard/clients' },
  { href: '/dashboard/clients/:id/brand', label: 'Brand', parent: '/dashboard/clients' },
  { href: '/dashboard/clients/:id/agreement', label: 'Agreement', parent: '/dashboard/clients' },
  { href: '/dashboard/files', label: 'Files' },
  { href: '/dashboard/audience', label: 'Audience' },
  { href: '/dashboard/social', label: 'Social channels' },
  { href: '/dashboard/website', label: 'Website' },
  { href: '/dashboard/production', label: 'Production' },
  { href: '/dashboard/editor', label: 'Editor' },
  { href: '/dashboard/bookings', label: 'Bookings' },
  { href: '/dashboard/scheduler', label: 'Scheduler' },
  { href: '/dashboard/calendar', label: 'Calendar' },
  { href: '/dashboard/activity', label: 'Asana activity' },
  { href: '/dashboard/reports', label: 'Reports' },
  { href: '/dashboard/team', label: 'Team' },
  // NOT a subpage of Team: it is the workload board, and someone can
  // reasonably be given one without the other (an editor who runs the
  // week's schedule does not need everybody's email address)
  { href: '/dashboard/team/activity', label: 'Team activity' },
  { href: '/dashboard/ai', label: 'AI Assistant' },
  { href: '/dashboard/notifications', label: 'Notifications' },
  { href: '/dashboard/settings', label: 'Settings' },
]

const GRANTABLE_HREFS = new Set(GRANTABLE_PAGES.map(p => p.href))

/**
 * Pages nobody holds by role — not even a super admin.
 *
 * The ladder answers "what does this ROLE do". Some pages instead belong to
 * a named handful of people (bookings is the shared mailboxes: contact@,
 * tech@, hello@, plus Martin), and squeezing that into a role would either
 * hand it to every super admin or invent a role for four people. So it is
 * granted per person, and the default for everyone is no.
 */
export const GRANT_ONLY_PAGES = new Set<string>(['/dashboard/bookings'])

/**
 * The Schedule page — the posting calendar under Social. It is a CHILD of
 * Social in the nav (whoever may see Social may see all of it), but it is
 * also the one Social page a scheduler holds on its own, so it has a key of
 * its own here.
 */
export const SCHEDULE_PAGE = '/dashboard/social/schedule'
const SOCIAL_PAGE = '/dashboard/social'

/** The Social page a child href rides on, or null for anything else. */
export function socialParentOf(href: string): string | null {
  return href.startsWith(`${SOCIAL_PAGE}/`) ? SOCIAL_PAGE : null
}

/** Every team role gets the Overview, their own Notifications feed, and
 *  Settings (their profile and notification preferences live there). */
const PERSONAL_PAGES = ['/dashboard', '/dashboard/notifications', '/dashboard/settings']

/**
 * The default ladder — THE THREE PAGES RESET (6 Sep 2026).
 *
 * The owner's words: "my team is currently confused on how to use it". Each
 * role now sees the one page that is their job and nothing beside it:
 *
 *   editor          → Editor
 *   scheduler       → Scheduler, Schedule
 *   account_manager → their clients' pages (everything but business
 *                     development: Leads and Audience stay grantable)
 *   super_admin     → everything, plus Leads
 *
 * …plus the personal three (Overview, Notifications, Settings) for every
 * team role. A super admin can still open any page to one person by grant.
 *
 * This is the NAV's answer. The API routes keep their own gates: what a
 * person may DO on a card is decided per card by their assignment, in
 * workflow-core, and the item page opens for any team member who is sent a
 * link to it.
 */
export function defaultAllows(role: Role | null, href: string): boolean {
  if (role === null) return false             // unknown identity — show nothing yet
  if (role === 'client') return false
  // a grant-only page is never default, however senior the role
  if (GRANT_ONLY_PAGES.has(href)) return false
  // a Social child is nobody's default but the scheduler's Schedule: everyone
  // else reaches the children THROUGH Social (canSeePage falls back to the
  // parent), so hiding Social hides all of it in one move
  if (socialParentOf(href)) return role === 'scheduler' && href === SCHEDULE_PAGE
  if (role === 'editor') {
    return [...PERSONAL_PAGES, '/dashboard/editor'].includes(href)
  }
  if (role === 'scheduler') {
    return [...PERSONAL_PAGES, '/dashboard/scheduler', SCHEDULE_PAGE].includes(href)
  }
  // account managers run client delivery, not business development — the lead
  // funnel and the audience lists stay out of their default world (grantable
  // per person when someone wears both hats). Reports ARE client delivery.
  if (role === 'account_manager') return !['/dashboard/leads', '/dashboard/audience'].includes(href)
  return true                                  // super_admin
}

/** The subpage key for a real path: /dashboard/clients/abc-123/brand →
 *  /dashboard/clients/:id/brand. Ids vary; permissions do not. */
export function subpageKey(path: string): string | null {
  const m = path.match(/^\/dashboard\/clients\/[^/]+\/([^/]+)$/)
  return m ? `/dashboard/clients/:id/${m[1]}` : null
}

/** A subpage needs BOTH its parent and itself. */
export function canSeeSubpage(
  role: Role | null, key: string, granted: GrantedPages, hidden: GrantedPages = [],
): boolean {
  const page = GRANTABLE_PAGES.find(p => p.href === key)
  if (!page?.parent) return canSeePage(role, key, granted, hidden)
  if (!canSeePage(role, page.parent, granted, hidden)) return false
  return canSeePage(role, key, granted, hidden)
}

/** May this person see this page — by role, or because they were granted it?
 *  `hidden` is the person's OWN mute list: a preference that wins over
 *  everything, including a super admin's blanket access. It never touches
 *  server-side permissions — an API they may call, they may still call. */
export function canSeePage(role: Role | null, href: string, granted: GrantedPages, hidden: GrantedPages = []): boolean {
  if (role === null) return false
  if (hidden.includes(href)) return false
  if (defaultAllows(role, href)) return true
  // a grant is for a team member; a client is a different axis entirely
  if (role === 'client') return false
  if (granted.includes(href)) return true
  // a Social child rides on Social itself: whoever may see the channels may
  // see the schedule, the inbox and the rest — one permission, not six
  const parent = socialParentOf(href)
  return parent !== null && canSeePage(role, parent, granted, hidden)
}

/** Filter a nav list. Order is preserved — a granted page appears where it
 *  always sits, not appended somewhere surprising. */
export function visiblePages<T extends { href: string }>(
  role: Role | null, items: T[], granted: GrantedPages, hidden: GrantedPages = [],
): T[] {
  return items.filter(i => canSeePage(role, i.href, granted, hidden))
}

/** Can this page be handed out at all? Guards the write path against a typo'd
 *  or invented href being stored and later matched. */
export function isGrantablePage(href: string): boolean {
  return GRANTABLE_HREFS.has(href)
}

/** Clean a list of hrefs arriving from a browser: known pages only, deduped,
 *  and never a page the person already has by default (storing those would
 *  make a later role change silently keep access it should have lost). */
export function normaliseGrantedPages(raw: unknown, role: Role | null): string[] {
  const list = Array.isArray(raw) ? raw : []
  const out: string[] = []
  for (const item of list) {
    const href = String(item ?? '').trim()
    if (!isGrantablePage(href)) continue
    if (defaultAllows(role, href)) continue
    if (!out.includes(href)) out.push(href)
  }
  return out
}
