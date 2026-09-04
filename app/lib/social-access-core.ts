/**
 * WHO CAN DO WHAT WITH THIS CLIENT'S SOCIAL ACCOUNTS — in plain words.
 *
 * The access page invents no permission model. Everything on it is the model
 * the app already runs on, said out loud: a person is on a client because
 * there is a row in `team_user_clients`, and what they may do on Schedule
 * comes from their role and nothing else. This file is the translation layer
 * between those two facts and the sentences on screen, so the page cannot
 * quietly describe a right the server does not actually grant.
 *
 * Pure: no database, no fetch. The route hands it rows; it hands back words.
 */

import { ROLE_LABEL, mayPublish, type Role } from './identity-core'
import { tokenNotice, timeLeftWords, type TokenStatus } from './token-health-core'

/* ── what a person may do ──────────────────────────────────────────────── */

export type Right = 'plan' | 'approve' | 'post'

/** The three words on the chips. Nothing longer fits, and nothing shorter is
 *  honest. */
export const RIGHT_LABEL: Record<Right, string> = {
  plan: 'Can plan',
  approve: 'Can approve',
  post: 'Can post',
}

/**
 * The rights a role carries on Schedule.
 *
 *  • super admin — everything.
 *  • account manager — plans, signs a post off, and posts it.
 *  • scheduler — plans and posts, but the sign-off is somebody else's.
 *  • editor — drafts the work; never approves, never posts. (An editor sits
 *    ABOVE a scheduler in the role ladder because they do more of the work,
 *    which is exactly why "can post" is a named set here and not a rung.)
 *  • client — not a person with access to this page at all.
 */
export function rightsForRole(role: string): Right[] {
  switch (role) {
    case 'super_admin':
    case 'account_manager':
      return ['plan', 'approve', 'post']
    case 'scheduler':
      return mayPublish(role) ? ['plan', 'post'] : ['plan']
    case 'editor':
      return ['plan']
    default:
      return []
  }
}

export function rightsWords(role: string): string[] {
  return rightsForRole(role).map(r => RIGHT_LABEL[r])
}

/**
 * One sentence saying what this person actually does here.
 *
 * Not a restatement of the chips: the chips say what is allowed, this says
 * how the work moves — which is the thing somebody looking at the list is
 * really trying to work out.
 */
export function accessSummary(role: string): string {
  switch (role) {
    case 'super_admin':
      return 'Can do anything on this client, including approving and posting.'
    case 'account_manager':
      return 'Plans posts, signs them off, and can post them.'
    case 'scheduler':
      return 'Plans posts and sends them for approval, then posts them once they are approved.'
    case 'editor':
      return 'Works on the pieces they are assigned. Cannot approve or post.'
    case 'client':
      return 'Sees their own work in the portal and approves it there.'
    default:
      return 'No rights on this client’s posts.'
  }
}

export type AccessLink = { team_user_id: string; client_id?: string; assigned_at?: string | null }
export type AccessUser = {
  id: string
  name: string
  email: string
  role: string
  active_status?: boolean
}

export type PersonWithAccess = {
  id: string
  name: string
  email: string
  role: string
  roleLabel: string
  rights: string[]
  summary: string
  assignedAt: string | null
}

/**
 * The people on this client, in the order somebody would look for them:
 * whoever can approve first, then who can post, then the rest, then by name.
 *
 * A link whose person is gone or switched off is DROPPED rather than shown as
 * a blank: a name on an access list that nobody can match to a person is the
 * kind of thing that gets a leaver left on for a year.
 */
export function peopleWithAccess(
  links: AccessLink[], users: AccessUser[],
): PersonWithAccess[] {
  const byId = new Map(users.map(u => [u.id, u]))
  const rank = (role: string) => {
    const r = rightsForRole(role)
    return r.includes('approve') ? 0 : r.includes('post') ? 1 : r.length > 0 ? 2 : 3
  }
  const seen = new Set<string>()
  const out: PersonWithAccess[] = []
  for (const link of links) {
    const u = byId.get(link.team_user_id)
    if (!u || u.active_status === false || seen.has(u.id)) continue
    seen.add(u.id)
    out.push({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      roleLabel: ROLE_LABEL[u.role as Role] ?? u.role,
      rights: rightsWords(u.role),
      summary: accessSummary(u.role),
      assignedAt: link.assigned_at ?? null,
    })
  }
  return out.sort((a, b) =>
    rank(a.role) - rank(b.role) || a.name.localeCompare(b.name))
}

/** May this person change who is on the client? The same answer the managers
 *  route enforces — the page hides the button, the server refuses the write. */
export function mayChangeAccess(role: string): boolean {
  return role === 'super_admin'
}

/** May this person map the client to a group of accounts at the provider? */
export function mayChangeProfile(role: string): boolean {
  return role === 'super_admin' || role === 'account_manager'
}

/* ── how an account is doing ───────────────────────────────────────────── */

export type AccountHealthWords = {
  /** the badge: three states and no more */
  state: 'connected' | 'reconnect' | 'expired'
  label: string
  /** the small print under it */
  detail: string
  /** does the Reconnect button belong on this row */
  needsReconnect: boolean
}

/**
 * The badge on an account row.
 *
 * Deliberately three states. The provider reports half a dozen shades of
 * "fine"; a person looking at a list of accounts is asking one question — is
 * anything about to stop working — and every extra word in that answer is a
 * word between them and it.
 */
export function accountHealthWords(
  status: TokenStatus | null | undefined, now: number,
): AccountHealthWords {
  if (!status) {
    return {
      state: 'connected',
      label: 'Connected',
      detail: 'We could not check this one just now. Refresh to try again.',
      needsReconnect: false,
    }
  }
  const notice = tokenNotice(status, now)
  if (status.valid === false) {
    return {
      state: 'expired',
      label: 'Expired',
      detail: 'Posts for this account will not go out until it is reconnected.',
      needsReconnect: true,
    }
  }
  if (notice && notice.level === 'act') {
    return {
      state: 'reconnect',
      label: 'Needs reconnecting',
      detail: notice.advice,
      needsReconnect: true,
    }
  }
  if (notice && notice.level === 'watch') {
    return {
      state: 'reconnect',
      label: 'Needs reconnecting soon',
      detail: `${timeLeftWords(notice.daysLeft)} — ${notice.advice}`,
      needsReconnect: true,
    }
  }
  return {
    state: 'connected',
    label: 'Connected',
    detail: notice?.autoRenews
      ? 'It renews itself — there is nothing to do.'
      : notice
        ? `${timeLeftWords(notice.daysLeft)}. ${notice.advice}`
        : 'Working normally.',
    needsReconnect: false,
  }
}

/** "Checked just now" / "Checked 4 minutes ago" — when we last asked the
 *  provider, not when the account was connected. */
export function lastCheckedWords(at: string | null | undefined, now: number): string {
  if (!at) return 'Not checked yet'
  const then = new Date(at).getTime()
  if (Number.isNaN(then)) return 'Not checked yet'
  const mins = Math.floor((now - then) / 60000)
  if (mins < 1) return 'Checked just now'
  if (mins < 60) return `Checked ${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Checked ${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `Checked ${days} day${days === 1 ? '' : 's'} ago`
}

/* ── the client's group of accounts at the provider ────────────────────── */

export type ProfileChoice = { id: string; name: string; accountCount: number | null }

/**
 * The provider's "profiles" are groups of accounts, and a client belongs in
 * exactly one of them. Read tolerantly: the list comes back under three
 * different keys depending on the endpoint, and an id can be `_id` or `id`.
 */
export function readProfiles(raw: unknown): ProfileChoice[] {
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { profiles?: unknown })?.profiles)
      ? (raw as { profiles: unknown[] }).profiles
      : Array.isArray((raw as { data?: unknown })?.data)
        ? (raw as { data: unknown[] }).data
        : []
  return rows
    .map(r => {
      const p = r as Record<string, unknown>
      const id = String(p._id ?? p.id ?? '')
      const name = String(p.name ?? p.title ?? '').trim()
      const count = p.accountCount ?? p.accounts_count
        ?? (Array.isArray(p.accounts) ? p.accounts.length : null)
      return {
        id,
        name: name || 'Untitled group',
        accountCount: typeof count === 'number' ? count : null,
      }
    })
    .filter(p => p.id)
}

/**
 * What the mapping row says, in a sentence.
 *
 * The owner keeps several groups at the provider — a default, a test one, and
 * one per brand — and the ONE thing that must never be ambiguous is which of
 * them a post for this client goes into.
 */
export function profileMappingWords(input: {
  clientName: string
  profile: ProfileChoice | null
  /** accounts of this client that are NOT in the mapped group yet */
  strayCount: number
}): { title: string; detail: string; action: string | null } {
  if (!input.profile) {
    return {
      title: 'Not in a group yet',
      detail: `${input.clientName}’s accounts are not grouped at the posting service. Pick a group, or make one named after the client, so their posts never land under somebody else’s.`,
      action: 'Choose a group',
    }
  }
  if (input.strayCount > 0) {
    return {
      title: input.profile.name,
      detail: `${input.strayCount} of this client’s account${input.strayCount === 1 ? ' is' : 's are'} still in another group. Move ${input.strayCount === 1 ? 'it' : 'them'} across so everything for ${input.clientName} sits together.`,
      action: 'Move them across',
    }
  }
  return {
    title: input.profile.name,
    detail: `Every account for ${input.clientName} is in this group.`,
    action: 'Change group',
  }
}
