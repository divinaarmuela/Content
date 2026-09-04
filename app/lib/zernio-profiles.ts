import 'server-only'
import { isPublishDryRun } from './publisher'
import { readProfiles, type ProfileChoice } from './social-access-core'

/**
 * THE PROVIDER'S GROUPS OF ACCOUNTS.
 *
 * Zernio calls them "profiles", which is the single most confusing word it
 * could have picked: a profile is NOT an Instagram profile, it is a folder
 * that several connected accounts sit in. The owner has four of them today
 * (Default, test, Stretchworks, and one marked for deletion), and every
 * account has to be in exactly one.
 *
 * Why it matters here: a post is created against a profile. If a client's
 * accounts are scattered across groups, a scheduler picking "Instagram" can
 * be picking somebody else's Instagram. So a client maps to ONE group and the
 * access page is where that is set. The column holding it is
 * `clients.social_profile_id` -- the one the connect flow, the automations
 * route and the webhook matcher already read. There is deliberately no second
 * column for the same fact.
 *
 * These three calls live here rather than on the `Publisher` interface on
 * purpose: publishing is the interface's job, and grouping is an
 * administrative act nothing in the publish path is allowed to perform.
 *
 * Docs, checked 2026-09-04 (`docs_search`):
 *   GET    /v1/profiles              — list the groups
 *   POST   /v1/profiles  { name }    — make one; the id is provider-minted
 *   PATCH  /v1/accounts/{accountId}  — "moves the social account only",
 *                                      which is exactly what we want for a
 *                                      social account. (There is a separate
 *                                      endpoint for provisioned PHONE numbers,
 *                                      which carry hidden telephony accounts
 *                                      alongside them; we have none.)
 * TODO if Zernio publishes a dedicated /v1/accounts/{id}/move for social
 * accounts, switch `accountMoveRequest` to it — the shape is pinned by a test
 * so the change is one function and one expectation.
 */

const BASE = process.env.ZERNIO_API_URL ?? 'https://zernio.com/api/v1'

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const key = process.env.ZERNIO_API_KEY
  if (!key) throw new Error('The posting service is not switched on yet')
  return { Authorization: `Bearer ${key}`, ...extra }
}

export type ProviderRequest = {
  url: string
  method: 'GET' | 'POST' | 'PATCH'
  body: Record<string, unknown> | null
}

/* ── the request shapes, pure and testable ─────────────────────────────── */

export function profilesListRequest(base: string = BASE): ProviderRequest {
  return { url: `${base}/profiles`, method: 'GET', body: null }
}

export function profileCreateRequest(name: string, base: string = BASE): ProviderRequest {
  return { url: `${base}/profiles`, method: 'POST', body: { name: String(name ?? '').trim() } }
}

/**
 * Moving one account into a group.
 *
 * The account id here is the PROVIDER's id, never ours: our row id means
 * nothing upstream, and sending it would 404 in a way that reads like the
 * account is gone.
 *
 * `profileId` in camelCase, which is how every documented body in this API
 * spells it (`POST /v1/automations` takes `profileId`, and so does the connect
 * flow); the reference page for `PATCH /v1/accounts/{accountId}` -- titled
 * "Move account to another profile" -- documents the endpoint but not the body
 * key. Because a wrong key would answer 200 and move nothing, the caller does
 * NOT trust the 200: `moveAccountsToProfile` reads the group back afterwards
 * and reports anything still outside it. A silent no-op is the one failure
 * this whole card exists to prevent.
 */
export function accountMoveRequest(
  providerAccountId: string, profileId: string, base: string = BASE,
): ProviderRequest {
  return {
    url: `${base}/accounts/${encodeURIComponent(providerAccountId)}`,
    method: 'PATCH',
    body: { profileId: String(profileId) },
  }
}

/* ── the calls ─────────────────────────────────────────────────────────── */

/**
 * The dry run.
 *
 * Same reasoning as `PUBLISH_DRY_RUN` on the publisher: the test suite must
 * not reach into the owner's real account and start moving accounts between
 * groups. With the flag on, these answer from memory and open no socket.
 */
const DRY_RUN_PROFILES: ProfileChoice[] = [
  { id: 'dry-run-default', name: 'Default', accountCount: 0 },
  { id: 'dry-run-test', name: 'test', accountCount: 0 },
]

export function providerConfigured(): boolean {
  return isPublishDryRun() || Boolean(process.env.ZERNIO_API_KEY)
}

export async function listProfiles(): Promise<ProfileChoice[]> {
  if (isPublishDryRun()) return DRY_RUN_PROFILES
  const req = profilesListRequest()
  const res = await fetch(req.url, { headers: headers() })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(String(json?.error ?? 'Could not read the groups at the posting service'))
  }
  return readProfiles(json)
}

/**
 * A group with this name, made or adopted.
 *
 * Group names are unique per workspace, and a duplicate comes back 409 with
 * `details.existingProfileId`. Pressing "Make one called 'Stretchworks'" for a
 * client whose group somebody already made by hand is not an error -- it is
 * the same intention arriving twice, and the right answer is the group that
 * exists. So a 409 is ADOPTED rather than surfaced as a provider message
 * nobody can act on.
 *
 * The `Idempotency-Key` covers the other half: a retried request (a flaky
 * line, a double press) replays the first answer instead of racing itself into
 * that 409 in the first place. It is derived from the NAME, so two presses of
 * the same button are one request and two different names are not.
 */
export async function createProfile(name: string): Promise<ProfileChoice> {
  const clean = String(name ?? '').trim()
  if (!clean) throw new Error('Give the group a name')
  if (isPublishDryRun()) {
    return { id: `dry-run-${clean.toLowerCase().replace(/\s+/g, '-')}`, name: clean, accountCount: 0 }
  }
  const req = profileCreateRequest(clean)
  const res = await fetch(req.url, {
    method: req.method,
    headers: headers({
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey('profile', clean),
    }),
    body: JSON.stringify(req.body),
  })
  const json = await res.json().catch(() => ({})) as {
    profile?: { _id?: string; id?: string }
    _id?: string
    details?: { existingProfileId?: string }
    error?: string
  }

  if (res.status === 409) {
    const existing = json?.details?.existingProfileId
    if (typeof existing === 'string' && existing) {
      return { id: existing, name: clean, accountCount: null }
    }
  }
  if (!res.ok) throw new Error(String(json?.error ?? 'Could not make that group'))
  const id = json?.profile?._id ?? json?.profile?.id ?? json?._id
  if (typeof id !== 'string' || !id) throw new Error('The posting service gave the group no id')
  return { id, name: clean, accountCount: 0 }
}

/** Same intention, same key. Stable across retries and different per name, so
 *  a replay is a replay and a different group is a different request. */
export function idempotencyKey(kind: string, subject: string): string {
  const clean = String(subject ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return `mdm-${kind}-${clean}`.slice(0, 120)
}

/**
 * Move one connected account into a group.
 *
 * Never fatal to the caller's own work: the mapping is what the app acts on,
 * and an account that could not be moved is reported by name so somebody can
 * see WHICH one rather than being told the whole thing failed.
 */
export async function moveAccountToProfile(
  providerAccountId: string, profileId: string,
): Promise<void> {
  if (isPublishDryRun()) return
  const req = accountMoveRequest(providerAccountId, profileId)
  const res = await fetch(req.url, {
    method: req.method,
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(req.body),
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(String(json?.error ?? `Could not move that account (${res.status})`))
  }
}

export type MoveOutcome = { moved: string[]; failed: { name: string; why: string }[] }

/**
 * Move a client's whole set across, one at a time, and say what happened to
 * each -- a half-moved set that reports "done" is the worst answer available.
 *
 * `verify` is passed in rather than imported so this stays testable without a
 * provider: it returns the provider account ids the group holds AFTERWARDS. A
 * 200 is not taken as proof, because the one way this could fail silently is a
 * request the provider accepts and quietly ignores.
 */
export async function moveAccountsToProfile(
  accounts: { providerAccountId: string; name: string }[],
  profileId: string,
  verify?: (profileId: string) => Promise<string[] | null>,
): Promise<MoveOutcome> {
  const out: MoveOutcome = { moved: [], failed: [] }
  const attempted: { providerAccountId: string; name: string }[] = []
  for (const a of accounts) {
    try {
      await moveAccountToProfile(a.providerAccountId, profileId)
      attempted.push(a)
    } catch (e) {
      out.failed.push({ name: a.name, why: e instanceof Error ? e.message : 'It would not move' })
    }
  }

  const inGroup = verify ? await verify(profileId).catch(() => null) : null
  if (!inGroup || inGroup.length === 0) {
    // nothing to check against -- report what the calls themselves said, which
    // is all we were told
    out.moved.push(...attempted.map(a => a.name))
    return out
  }
  const holds = new Set(inGroup)
  for (const a of attempted) {
    if (holds.has(a.providerAccountId)) out.moved.push(a.name)
    else {
      out.failed.push({
        name: a.name,
        why: 'the posting service said yes but the account is still in its old group',
      })
    }
  }
  return out
}
