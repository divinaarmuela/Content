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

import { ROLE_LABEL, TEAM_ROLES, mayPublish, type Role } from './identity-core'
import { mayApprovePost, maySendPostApproval } from './posting-approval-core'
import { actingRoles } from './workflow-core'
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
 * The rights a role carries on Schedule — ASKED OF THE RULES, not listed here.
 *
 * This used to be a hand-written table that happened to agree with the server.
 * That is the worst kind of correct: change `MAY_PUBLISH` or `mayApprovePost`
 * tomorrow and the page carries on telling the team who can post, wrongly,
 * with every test still green. So each chip is one call to the function that
 * actually gates the server:
 *
 *   plan    → `maySendPostApproval` — who may put a post together and send it
 *   approve → `mayApprovePost`      — who may sign it off
 *   post    → `mayPublish`          — who may put it out
 *
 * The first two are asked in terms of HATS, not titles, so they are asked the
 * way the item page asks them: `actingRoles` for this person on a piece of
 * this client that nobody has been handed yet — which is what a page about a
 * CLIENT rather than about one piece is describing.
 *
 * A client is not on this list at all: they approve in the portal, wearing the
 * client hat, and are never a team member on a client's access list.
 */
export function rightsForRole(role: string): Right[] {
  if (!(TEAM_ROLES as readonly string[]).includes(role)) return []
  const hats = actingRoles(
    { id: 'whoever', role: role as Role },
    { owner_id: null, scheduler_ids: [] },
  )
  const out: Right[] = []
  if (maySendPostApproval(hats)) out.push('plan')
  if (mayApprovePost(hats)) out.push('approve')
  if (mayPublish(role)) out.push('post')
  return out
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
  /** the badge. Four states: three about the account, and one about US — we
   *  could not ask. */
  state: 'connected' | 'reconnect' | 'expired' | 'unknown'
  label: string
  /** the small print under it */
  detail: string
  /** does the Reconnect button belong on this row */
  needsReconnect: boolean
}

/**
 * Does this payload actually SAY anything about the account?
 *
 * "Not checked" used to mean only "the request failed". A reply that arrived
 * but made no sense — `{}`, `{ valid: 'expired' }`, `{ expiresAt: 'soon' }` —
 * fell straight through to the bottom of `accountHealthWords` and came out as
 * a green "Connected · Working normally", which is the same lie the failed
 * check used to tell, arrived at by a different road. A field we cannot read
 * is a field we did not read: it says nothing, and neither do we.
 *
 * `expiresIn` is free text from the provider by definition, so any string
 * counts; every other field has one shape and must wear it.
 */
function readsAsHealth(status: Record<string, unknown>): boolean {
  const has = (k: string) => status[k] !== undefined && status[k] !== null
  if (has('valid') && typeof status.valid !== 'boolean') return false
  if (has('needsRefresh') && typeof status.needsRefresh !== 'boolean') return false
  if (has('expiresAt')) {
    const at = status.expiresAt
    if (typeof at !== 'string' || Number.isNaN(new Date(at).getTime())) return false
  }
  if (has('expiresIn') && typeof status.expiresIn !== 'string') return false
  // an empty object is a reply with no news in it, which is not the same as
  // good news
  return has('valid') || has('needsRefresh') || has('expiresAt') || has('expiresIn')
}

/**
 * The badge on an account row.
 *
 * Deliberately few states. The provider reports half a dozen shades of "fine";
 * a person looking at a list of accounts is asking one question — is anything
 * about to stop working — and every extra word in that answer is a word
 * between them and it.
 *
 * "Not checked" is the fourth, and it is the one that matters most. An account
 * we could not reach used to be badged a green "Connected" with a grey line of
 * small print underneath, so a provider outage over an expired token read as
 * everything being fine — and a week of posts got queued against a channel
 * that would refuse every one of them. We do not know, so it says we do not
 * know, in a colour that is neither good news nor bad.
 */
export function accountHealthWords(
  status: TokenStatus | null | undefined, now: number,
): AccountHealthWords {
  if (!status || !readsAsHealth(status as Record<string, unknown>)) {
    return {
      state: 'unknown',
      label: 'Not checked',
      detail: 'We could not reach the posting service to check this one, so we cannot say whether it is working. Press “Check them” to try again.',
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

/**
 * "Checked just now" / "Checked 4 minutes ago" — when we last asked the
 * PROVIDER, not when the account was connected.
 *
 * The stamp comes from the request that asked, which on a freshly opened page
 * really is a moment ago; it ages honestly while the page stays open, which is
 * the case that matters (a tab left up all afternoon must not keep claiming
 * its badges are current).
 */
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
