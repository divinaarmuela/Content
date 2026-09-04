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
 * be picking somebody else's Instagram. So a client maps to ONE group
 * (`clients.zernio_profile_id`) and the access page is where that is set.
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

export async function createProfile(name: string): Promise<ProfileChoice> {
  const clean = String(name ?? '').trim()
  if (!clean) throw new Error('Give the group a name')
  if (isPublishDryRun()) {
    return { id: `dry-run-${clean.toLowerCase().replace(/\s+/g, '-')}`, name: clean, accountCount: 0 }
  }
  const req = profileCreateRequest(clean)
  const res = await fetch(req.url, {
    method: req.method,
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(req.body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(String(json?.error ?? 'Could not make that group'))
  const id = (json as { profile?: { _id?: string }; _id?: string })?.profile?._id
    ?? (json as { _id?: string })?._id
  if (typeof id !== 'string' || !id) throw new Error('The posting service gave the group no id')
  return { id, name: clean, accountCount: 0 }
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

/** Move a client's whole set across, one at a time, and say what happened to
 *  each — a half-moved set that reports "done" is the worst answer available. */
export async function moveAccountsToProfile(
  accounts: { providerAccountId: string; name: string }[], profileId: string,
): Promise<MoveOutcome> {
  const out: MoveOutcome = { moved: [], failed: [] }
  for (const a of accounts) {
    try {
      await moveAccountToProfile(a.providerAccountId, profileId)
      out.moved.push(a.name)
    } catch (e) {
      out.failed.push({ name: a.name, why: e instanceof Error ? e.message : 'It would not move' })
    }
  }
  return out
}
