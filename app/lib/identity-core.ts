/**
 * Pure identity/notification logic — no imports, no server dependencies.
 * Lives separately from authz.ts/mailer.ts so unit tests can exercise it
 * without pulling in `server-only`, Clerk, Supabase, or nodemailer.
 */

export const TEAM_ROLES = ['scheduler', 'editor', 'account_manager', 'super_admin'] as const
export type Role = 'super_admin' | 'account_manager' | 'editor' | 'scheduler' | 'client'

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
  editor: 'Editor',
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
