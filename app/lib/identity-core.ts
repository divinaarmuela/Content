/**
 * Pure identity/notification logic — no imports, no server dependencies.
 * Lives separately from authz.ts/mailer.ts so unit tests can exercise it
 * without pulling in `server-only`, Clerk, the database, or nodemailer.
 */

/**
 * THE LADDER. `general` (9 Sep 2026) is the person who does everything a
 * scheduler and an editor do — makes cards and shoot plans for any client,
 * edits, sends for approval, books approved pieces in — and nothing a
 * manager does: no approving, no reading the client's own comments. It sits
 * above editor and below account_manager so `requireRole('editor')` and
 * `requireRole('scheduler')` admit it and `requireRole('account_manager')`
 * does not.
 */
export const TEAM_ROLES = ['scheduler', 'editor', 'quality_checker', 'general', 'account_manager', 'super_admin'] as const
export type Role = 'super_admin' | 'account_manager' | 'general' | 'quality_checker' | 'editor' | 'scheduler' | 'client'

/**
 * THE QUALITY CHECKER IS A ROLE (the owner, 13 Sep 2026: "quality check is a
 * role"). Joy's job title, in the role list, with its own pages. It sits
 * above editor (it may do everything an editor may, and open the editor's
 * face of a card) and below general and account manager (no client share,
 * no handover to the scheduler, no team management, no publishing).
 *
 * The older way — the `quality_reviewer` FLAG on any role, for an account
 * manager who also reviews — keeps working. `isQualityReviewer` is the ONE
 * question every gate asks; nothing reads the flag or the role on its own.
 */
export function isQualityReviewer(
  u: { role?: string | null; quality_reviewer?: boolean | null } | null | undefined,
): boolean {
  if (!u) return false
  return u.role === 'quality_checker' || u.quality_reviewer === true
}

/**
 * The one spelling of each role a person reads on screen.
 *
 * Five files each carried their own copy — "Account manager", "account
 * manager", a lowercase `role.replace('_', ' ')`, and "Director" for the
 * super admin in one card while everything else said "Super admin". A role
 * name is a name; it is spelled one way.
 */
export const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super admin',
  account_manager: 'Account manager',
  general: 'General',
  quality_checker: 'Quality checker',
  editor: 'Editor or designer',
  scheduler: 'Scheduler',
  client: 'Client',
}

/** `ROLE_LABEL` for a string that may not be a known role — never an underscore. */
export function roleLabel(role: string | null | undefined): string {
  if (!role) return ''
  return (ROLE_LABEL as Record<string, string>)[role] ?? role.split('_').join(' ')
}

/** Parse the SUPER_ADMIN_EMAILS env allowlist (comma separated, case/space tolerant). */
export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
}

/** Should this email be promoted to super_admin? */
export function isAllowlistedSuperAdmin(email: string, allowlist: string[]): boolean {
  return allowlist.includes(email.trim().toLowerCase())
}

/** Role hierarchy check. `client` is its own axis: it never satisfies a team
 *  requirement and team roles never satisfy `client`. super_admin passes all. */
/**
 * The hats that may put a post on a client's real account.
 *
 * Not a rung on the ladder: an EDITOR sits above a scheduler in `TEAM_ROLES`
 * (they do more of the work) and still must never publish, so this is a named
 * set rather than `roleSatisfies('scheduler')`. One list, so the schedule
 * page, the composer and the item page cannot disagree about it.
 */
export const MAY_PUBLISH: readonly Role[] = ['scheduler', 'general', 'account_manager', 'super_admin']

export function mayPublish(role: Role | string): boolean {
  return (MAY_PUBLISH as readonly string[]).includes(role)
}

export function roleSatisfies(actual: Role, required: Role): boolean {
  if (actual === 'super_admin') return true
  if (required === 'client') return actual === 'client'
  if (actual === 'client') return false
  const order = TEAM_ROLES as readonly string[]
  return order.indexOf(actual) >= order.indexOf(required)
}

/** Canonical dedupe key: same event + entity + recipient → same key → the
 *  notification_log unique constraint allows at most one send. */
export function buildDedupeKey(
  eventType: string,
  entityType: string,
  entityId: string,
  recipientEmail: string
): string {
  return [eventType, entityType, entityId, recipientEmail.trim().toLowerCase()].join('::')
}

/**
 * How a person is NAMED on a screen: their name, or — when the Team row has
 * none — the part of their email before the @, capitalised, never the whole
 * address (the owner, 13 Sep 2026: a card read "akmaltestmdmedia@gmail.com ·
 * version 1"). Pure; every name map and the history line read it.
 */
export function personLabel(name: string | null | undefined, email?: string | null): string {
  const n = String(name ?? '').trim()
  const pick = n && !n.includes('@') ? n : String(n || email || '').trim()
  if (!pick) return ''
  if (!pick.includes('@')) return pick
  const local = pick.split('@')[0].replace(/[._-]+/g, ' ').trim()
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : pick
}

/**
 * A CLIENT'S MANAGER IS WHOEVER IS ASSIGNED ON THE CLIENT (the owner, 15 Sep
 * 2026: "their role is super admin but they can be tagged as AM, because I
 * have added them as AM in the client" — a card read "Account manager: none
 * on this client yet" under a super admin who was the AM). Being on the
 * client's team as an account manager OR a super admin is what counts; the
 * emails already read it that way (workflow.resolveAudience), and now so
 * do the card face, the drawer, the post card, comment notices and @-mentions.
 */
export function managesClients(role: string | null | undefined): boolean {
  return role === 'account_manager' || role === 'super_admin'
}
