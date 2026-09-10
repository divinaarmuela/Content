/**
 * "Act as this person" — the pure half.
 *
 * The owner (10 Sep 2026): "add a feature for me to be as this user: only
 * tech@mdmmarketing.com.au should have this. I can act as any person and take
 * over and see what I see, and action on their behalf."
 *
 * ONE address may do this. Not "super admins", not "the allowlist" — one
 * address, spelled out here, because the whole point of the feature is that it
 * hands over somebody else's account, and a rule anybody can be added to is a
 * rule that will be. Every server check asks this about the REAL signed-in
 * email, never about the person being acted as, so the cookie on its own can
 * never do anything for anybody.
 *
 * No imports, no I/O — the server module and the route both read from here.
 */

/** The only address that may act as another person. */
export const ACT_AS_EMAIL = 'tech@mdmmarketing.com.au'

/** The cookie that carries who is being acted as. httpOnly, set by the API. */
export const ACT_AS_COOKIE = 'mdm_act_as'

/** How long acting as somebody lasts before it lapses on its own: 12 hours. */
export const ACT_AS_MAX_AGE_SECONDS = 12 * 60 * 60

/**
 * May this email act as another person?
 *
 * Case-insensitive exact match against the one address. Nobody else, not even
 * another super admin.
 */
export function mayActAs(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === ACT_AS_EMAIL
}

/**
 * The team_users id carried by the cookie, or null.
 *
 * Shape only — this says nothing about whether the row exists, is active, or
 * is somebody this person may become. The server checks all three. Realtime
 * Database keys cannot contain `. # $ [ ] /`, so anything outside the key
 * alphabet is not an id we ever wrote and is refused before it reaches a path.
 */
export function readActAs(cookieValue: string | null | undefined): string | null {
  const raw = (cookieValue ?? '').trim()
  if (!raw || raw.length > 128) return null
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null
  return raw
}

/** The name of a person, however they arrive. */
function nameOf(who: string | { name?: string | null } | null | undefined): string {
  if (!who) return ''
  return (typeof who === 'string' ? who : who.name ?? '').trim()
}

/**
 * "Tech MD, acting as Renee Yap" — how the real person is named on screen
 * while they are somebody else. With nobody to act as, it is just their name.
 */
export function actorLabel(
  real: string | { name?: string | null } | null | undefined,
  asUser: string | { name?: string | null } | null | undefined
): string {
  const realName = nameOf(real)
  const asName = nameOf(asUser)
  if (!asName) return realName
  if (!realName) return asName
  return `${realName}, acting as ${asName}`
}

/**
 * "Renee Yap (Tech MD acting as them)" — how the audit trail names the person
 * an action is recorded against.
 *
 * The action stays theirs, because that is what happened to their card and
 * their queue. The real person is appended so the trail can never hide who
 * pressed the button.
 */
export function auditActorName(
  actor: string | { name?: string | null } | null | undefined,
  actingBy: string | { name?: string | null } | null | undefined
): string {
  const who = nameOf(actor) || 'someone'
  const by = nameOf(actingBy)
  return by ? `${who} (${by} acting as them)` : who
}
