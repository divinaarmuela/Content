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

import { normaliseFolderName } from './gdrive-core'
import { ROLE_LABEL, TEAM_ROLES, mayPublish, type Role } from './identity-core'
import { mayApprovePost, maySendPostApproval } from './posting-approval-core'
import { actingRoles } from './workflow-core'
import {
  saysAutoRenews, timeLeftWords, tokenNotice, type TokenStatus,
} from './token-health-core'

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
 * The whole health payload, as the posting service answers it.
 *
 * `GET /accounts/{id}/health` — a status word, the token, what the account may
 * still DO, and a list of issues in the provider's own words. The page used to
 * be handed the token alone, which is how a healthy account came to be badged
 * broken: see `healthBlocksPosting` below.
 */
export type AccountHealth = {
  status?: string | null
  tokenStatus?: TokenStatus | null
  permissions?: {
    canPost?: boolean | null
    canFetchAnalytics?: boolean | null
    missingRequired?: unknown
  } | null
  issues?: unknown
}

/** The caller may hand over the whole payload or, as several already do, the
 *  token on its own. A `tokenStatus` key is what tells them apart. */
type HealthLike = AccountHealth | TokenStatus

const isFullHealth = (v: HealthLike): v is AccountHealth =>
  typeof v === 'object' && v !== null && 'tokenStatus' in v

const tokenOf = (v: HealthLike | null | undefined): TokenStatus | null => {
  if (!v) return null
  return isFullHealth(v) ? (v.tokenStatus ?? null) : (v as TokenStatus)
}

const statusWordOf = (v: HealthLike | null | undefined): string =>
  (v && isFullHealth(v) ? String(v.status ?? '') : '').toLowerCase()

const permissionsOf = (v: HealthLike | null | undefined) =>
  (v && isFullHealth(v) ? (v.permissions ?? null) : null)

const missingOf = (v: HealthLike | null | undefined): string[] => {
  const raw = permissionsOf(v)?.missingRequired
  return (Array.isArray(raw) ? raw : []).map(x => String(x ?? '')).filter(Boolean)
}

/**
 * A permission, in words somebody can act on.
 *
 * The provider names them the way the platform's API does
 * (`pages_manage_posts`), which tells a person nothing about what to press. An
 * unknown one is shown as it came rather than dropped — a missing permission
 * nobody can name is still a missing permission.
 */
const PERMISSION_WORDS: Record<string, string> = {
  pages_manage_posts: 'posting to the Page',
  pages_read_engagement: 'reading the Page’s comments',
  pages_show_list: 'seeing which Pages this account manages',
  instagram_basic: 'seeing the Instagram account',
  instagram_content_publish: 'posting to Instagram',
  instagram_manage_comments: 'reading Instagram comments',
  instagram_manage_insights: 'reading Instagram’s numbers',
  business_management: 'managing the business account',
  'video.publish': 'posting videos',
  'video.upload': 'uploading videos',
  'user.info.basic': 'seeing who the account is',
  w_member_social: 'posting on LinkedIn',
  r_organization_social: 'reading the company page',
}

const permissionWords = (names: readonly string[]): string =>
  names.map(n => PERMISSION_WORDS[n] ?? `“${n}”`).join(', ')

/* ── is this account actually stopped? ──────────────────────────────────── */

export type HealthBlock =
  | { blocked: false }
  | { blocked: true; kind: 'expired' | 'permission'; why: string }

/**
 * THE ONE RULE FOR "THIS ACCOUNT CANNOT POST UNTIL SOMEBODY FIXES IT".
 *
 * -- WHY THIS EXISTS, AND WHAT IT COST NOT TO HAVE IT --
 *
 * The provider's `status` word has three values and only one of them means
 * broken. `warning` is what it says while it is RENEWING ITS OWN LOGIN:
 *
 *   { status: 'warning',
 *     tokenStatus: { valid: true, expiresIn: 'Auto-refreshes', needsRefresh: true },
 *     permissions: { canPost: true, missingRequired: [] },
 *     issues: ['Token expired or expiring soon (auto-refresh pending)'] }
 *
 * Every field there says the account is fine and the provider is handling it.
 * We were reading `needsRefresh: true` on its own, and told the owner that two
 * working accounts — a client's TikTok and a YouTube channel — "need
 * reconnecting" because "the provider can no longer renew this on its own",
 * which is the exact opposite of what it had just said. A badge that cries
 * wolf is worse than no badge: the next one, the real one, is the one nobody
 * believes.
 *
 * So an account is stopped ONLY when something says it is stopped:
 *
 *   • the token is not valid;
 *   • a required permission is missing (named here, in words);
 *   • the provider says it cannot post;
 *   • the provider's own status word is `error`.
 *
 * `warning` is NOT on that list, and neither is `needsRefresh` on its own.
 *
 * This is the ONE place that decides it. The badge on the access page reads
 * it, and nothing else reaches a verdict of its own: the calendar tile's
 * "needs reconnecting" and the account-drop email both hang off
 * `social_accounts.active === false`, which only the provider's
 * disconnected / revoked / expired WEBHOOK sets. A warning reaches neither.
 */
export function healthBlocksPosting(
  health: HealthLike | null | undefined,
): HealthBlock {
  const token = tokenOf(health)
  const permissions = permissionsOf(health)
  const missing = missingOf(health)
  const word = statusWordOf(health)

  if (token?.valid === false) {
    return {
      blocked: true,
      kind: 'expired',
      why: 'Posts for this account will not go out until it is reconnected.',
    }
  }
  if (missing.length > 0) {
    return {
      blocked: true,
      kind: 'permission',
      why: `Reconnect it and say yes to everything it asks for — it is still missing ${permissionWords(missing)}.`,
    }
  }
  if (permissions?.canPost === false) {
    return {
      blocked: true,
      kind: 'permission',
      why: 'The posting service can reach this account but is not allowed to post to it. Reconnect it and say yes to everything it asks for.',
    }
  }
  if (word === 'error') {
    return {
      blocked: true,
      kind: 'expired',
      why: 'The posting service cannot use this account. Reconnect it — until you do, posts scheduled for it will not go out.',
    }
  }
  return { blocked: false }
}

/**
 * Is the provider renewing this login for us right now?
 *
 * Either it says so in the expiry text ("Auto-refreshes"), or it is wearing
 * `warning` + `needsRefresh` — which is the same sentence in field form, and
 * is exactly the payload that used to come out as "needs reconnecting".
 */
function renewingItself(health: HealthLike | null | undefined): boolean {
  const token = tokenOf(health)
  if (!token) return false
  if (saysAutoRenews(token.expiresIn)) return true
  return statusWordOf(health) === 'warning' && token.needsRefresh === true
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
function readsAsHealth(health: HealthLike): boolean {
  // the full shape says something the moment it carries a status word we know
  // or a permissions block we can read, even with no token at all
  if (isFullHealth(health)) {
    if (['healthy', 'warning', 'error'].includes(statusWordOf(health))) return true
    if (typeof permissionsOf(health)?.canPost === 'boolean') return true
  }
  const token = tokenOf(health)
  if (!token) return false
  const status = token as unknown as Record<string, unknown>
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
 * The order below is the whole design:
 *
 *   1. we could not read the answer       → "Not checked"
 *   2. `healthBlocksPosting` says stopped → "Expired" / "Needs reconnecting"
 *   3. the provider is renewing it        → "Connected", and it says so
 *   4. it says healthy                    → "Connected"
 *   5. otherwise the expiry date decides  → "Needs reconnecting soon", or
 *                                            "Connected" with how long is left
 *
 * Step 3 sits ABOVE the date arithmetic on purpose. A login being refreshed by
 * the provider IS expiring — that is what refreshing means — so reading the
 * date without reading the sentence next to it is precisely how two working
 * accounts got badged broken.
 *
 * "Not checked" is the state that matters most. An account we could not reach
 * used to be badged a green "Connected" with a grey line of small print
 * underneath, so a provider outage over an expired token read as everything
 * being fine — and a week of posts got queued against a channel that would
 * refuse every one of them. We do not know, so it says we do not know, in a
 * colour that is neither good news nor bad.
 */
export function accountHealthWords(
  health: HealthLike | null | undefined, now: number,
): AccountHealthWords {
  if (!health || !readsAsHealth(health)) {
    return {
      state: 'unknown',
      label: 'Not checked',
      detail: 'We could not reach the posting service to check this one, so we cannot say whether it is working. Press “Check them” to try again.',
      needsReconnect: false,
    }
  }

  const stopped = healthBlocksPosting(health)
  if (stopped.blocked) {
    return {
      state: stopped.kind === 'expired' ? 'expired' : 'reconnect',
      label: stopped.kind === 'expired' ? 'Expired' : 'Needs reconnecting',
      detail: stopped.why,
      needsReconnect: true,
    }
  }

  if (renewingItself(health)) {
    return {
      state: 'connected',
      label: 'Connected',
      detail: 'Renewing its login on its own — nothing to do.',
      needsReconnect: false,
    }
  }

  if (statusWordOf(health) === 'healthy') {
    return {
      state: 'connected',
      label: 'Connected',
      detail: 'Working normally.',
      needsReconnect: false,
    }
  }

  const notice = tokenNotice(tokenOf(health), now)
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

/* ── the face on an account ─────────────────────────────────────────────── */

/**
 * Two letters for an account when there is no photo to show.
 *
 * Lives here rather than beside the calendar bar because the bar is no longer
 * the only place an account wears a face — the access page shows the same set
 * of rows, and two initials functions would drift the first time somebody
 * decided a one-word name should be one letter.
 */
export function initialsOf(name: string): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

/**
 * HAS THIS SIGNED URL ALREADY RUN OUT?
 *
 * TikTok's photos come from a CDN that signs its links and puts the deadline
 * in the query string (`x-expires`, seconds since the epoch); the same trick
 * turns up as `Expires` on other CDNs and as `X-Amz-Date` + `X-Amz-Expires` on
 * anything S3-shaped. We store the URL so the browser does not have to ask the
 * provider on every render, which means the stored one is always a little bit
 * stale and eventually dead.
 *
 * A dead one must degrade to initials, not to a broken picture: the row is
 * about whether an account works, and a torn-image glyph next to it reads as
 * the account being broken rather than the photo. So the deadline is READ
 * before the URL is used, and `onError` in the component catches the rest —
 * an expiry spelled some way we have never seen, a photo deleted upstream.
 *
 * Unreadable or absent deadline means "no reason to think it is dead", which
 * is the honest answer: the image tag will find out.
 */
export function signedUrlExpired(url: string, now: number): boolean {
  let params: URLSearchParams
  try {
    params = new URL(url).searchParams
  } catch {
    return false
  }
  const seconds = (raw: string | null): number | null => {
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  }

  const at = seconds(params.get('x-expires')) ?? seconds(params.get('X-Expires'))
    ?? seconds(params.get('Expires')) ?? seconds(params.get('expires'))
  if (at !== null) return at * 1000 <= now

  // S3's pair: a start stamp plus a lifetime in seconds
  const started = params.get('X-Amz-Date')
  const lifetime = seconds(params.get('X-Amz-Expires'))
  if (started && lifetime !== null) {
    // 20260905T041500Z — no separators, so give it the ones Date wants
    const iso = /^\d{8}T\d{6}Z$/.test(started)
      ? `${started.slice(0, 4)}-${started.slice(4, 6)}-${started.slice(6, 8)}T${started.slice(9, 11)}:${started.slice(11, 13)}:${started.slice(13, 15)}Z`
      : started
    const from = new Date(iso).getTime()
    if (!Number.isNaN(from)) return from + lifetime * 1000 <= now
  }
  return false
}

export type AccountFace =
  | { kind: 'photo'; url: string; initials: string; name: string }
  | { kind: 'initials'; initials: string; name: string }

/** The least an account has to carry to be given a face. */
export type FaceSubject = {
  name?: string | null
  username?: string | null
  platform?: string | null
  avatar_url?: string | null
}

/**
 * THE ONE DECISION: this account's real photo, or its initials.
 *
 * Pure, so the rule can be tested without a browser and cannot be re-decided
 * differently on each of the pages that draws an account. Three things stop a
 * photo being used, and all three end in the same place rather than in a grey
 * box or a torn image:
 *
 *   • there is none — Instagram and LinkedIn hand back null today;
 *   • it is not a picture we can load over https;
 *   • its signature has run out (see `signedUrlExpired`).
 *
 * The name is picked the way a person would say it: the handle first, because
 * that is what identifies an account, then the account's own name, then
 * whatever the caller offers (usually the client's name).
 */
export function avatarFor(
  account: FaceSubject | null | undefined,
  now: number = Date.now(),
  fallbackName = '',
): AccountFace {
  const name = String(
    account?.username || account?.name || fallbackName || account?.platform || '',
  ).trim()
  const initials = initialsOf(name)
  const url = String(account?.avatar_url ?? '').trim()
  if (!url) return { kind: 'initials', initials, name }
  if (!/^https:\/\//i.test(url)) return { kind: 'initials', initials, name }
  if (signedUrlExpired(url, now)) return { kind: 'initials', initials, name }
  return { kind: 'photo', url, initials, name }
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

/* ── setting the group up in one press ─────────────────────────────────── */

/**
 * IS THIS GROUP THE ONE NAMED AFTER THE CLIENT?
 *
 * Asked with the Drive matcher's own normaliser, on purpose. Somebody typing
 * a group name at the posting service varies capitals, punctuation and a
 * trailing "Pty Ltd" without meaning anything by it, and the agency already
 * decided once what makes two names the same client — in `normaliseFolderName`,
 * where the HQ folders are adopted rather than duplicated. A second, slightly
 * different rule here would mean a client whose Drive folder was adopted and
 * whose posting group was duplicated, which is the worst of both.
 *
 * Deliberately exact-after-normalising, like the Drive one: making a duplicate
 * group is annoying, and adopting the WRONG client's group sends a post out
 * under somebody else's name.
 */
export function sameGroupName(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normaliseFolderName(a)
  const right = normaliseFolderName(b)
  return left.length > 0 && left === right
}

/** The group already named after this client, if the provider has one. */
export function findGroupByName(
  profiles: readonly ProfileChoice[], name: string,
): ProfileChoice | null {
  return profiles.find(p => sameGroupName(p.name, name)) ?? null
}

export type GroupSetup = {
  /** is there nothing left to do */
  done: boolean
  /** what the button says, or null when there is no button to show */
  action: string | null
  /** the line under it */
  detail: string
}

/**
 * "SET UP THIS CLIENT'S GROUP" — offered, or shown as already done.
 *
 * The page used to offer `Make one called "X"` whatever the state was, which
 * invites a second group with the same name for a client that already has
 * one. So the state is worked out first, and the button only exists while
 * pressing it would change something:
 *
 *   • mapped to the group named after the client, nothing astray → done;
 *   • mapped somewhere else, or accounts left behind in another group → the
 *     action, described in terms of what will move;
 *   • no accounts connected at all → done in the only sense available, and
 *     said plainly rather than offered as a button that moves nothing.
 *
 * Never a word about renaming or deleting: a group at the provider may be
 * somebody's by hand, and this action only ever adopts one or adds one.
 */
export function groupSetupWords(input: {
  clientName: string
  profile: ProfileChoice | null
  accountCount: number
  strayCount: number
}): GroupSetup {
  const { clientName, profile, accountCount, strayCount } = input
  const named = profile !== null && sameGroupName(profile.name, clientName)

  if (accountCount === 0) {
    return {
      done: named,
      action: named ? null : `Set up ${clientName}’s group`,
      detail: named
        ? `${clientName} has a group of their own. Nothing to move yet — no accounts are connected.`
        : `Nothing to move yet — no accounts are connected. You can still make ${clientName} a group of their own, ready for the first one.`,
    }
  }

  if (named && strayCount === 0) {
    return {
      done: true,
      action: null,
      detail: `All ${accountCount} of ${clientName}’s account${accountCount === 1 ? '' : 's'} are in this group. Nothing to do.`,
    }
  }

  const willMove = named ? strayCount : accountCount
  return {
    done: false,
    action: `Set up ${clientName}’s group`,
    detail: named
      ? `${strayCount} of ${clientName}’s account${strayCount === 1 ? ' is' : 's are'} still in another group. This moves ${strayCount === 1 ? 'it' : 'them'} across.`
      : `This finds or makes a group called “${clientName}” and moves ${willMove === 1 ? 'their account' : `all ${willMove} of their accounts`} into it. Nothing is renamed or deleted.`,
  }
}

/**
 * What happened, per account.
 *
 * A half-moved set reported as "done" is the failure this whole action exists
 * to prevent, so the sentence names the accounts that would not move and says
 * why for each — the provider's own reason, which is usually the only clue
 * anybody has. "All of them" is only said when the read-back agreed.
 */
export function groupSetupReport(input: {
  clientName: string
  groupName: string
  moved: readonly string[]
  failed: readonly { name: string; why: string }[]
  adopted: boolean
}): string {
  const { clientName, groupName, moved, failed, adopted } = input
  const where = `“${groupName}”`
  const opening = adopted
    ? `${clientName} is in the group ${where}, which was already there.`
    : `${clientName} has a group of their own, ${where}.`

  if (moved.length === 0 && failed.length === 0) {
    return `${opening} Nothing to move yet — no accounts are connected.`
  }
  if (failed.length === 0) {
    return `${opening} ${moved.length === 1 ? 'The account' : `All ${moved.length} accounts`} moved across: ${moved.join(', ')}.`
  }
  const stuck = failed.map(f => `${f.name} — ${f.why}`).join('; ')
  if (moved.length === 0) {
    return `${opening} Nothing moved: ${stuck}.`
  }
  return `${opening} Moved: ${moved.join(', ')}. Still where ${failed.length === 1 ? 'it' : 'they'} ${failed.length === 1 ? 'was' : 'were'}: ${stuck}.`
}
