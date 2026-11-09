import 'server-only'
import { table } from '@/lib/db'
import type { MdAppAd } from '@/lib/db-types'
import { decryptSecret, encryptSecret } from './secret-box'
import { mdAppReady, MdAppError, saveConnection } from './md-app'
import { mdAppsecretProof, mdCodeExchangeUrl, mdErrorMessage, mdGraphUrl, mdRedactUrl, type MdAppReady } from './md-app-core'
import {
  INSIGHT_FIELDS, grantedPermissions, isAdAccountId, isCampaignId, longLivedParams, mayDeleteCampaign, monthTimeRange,
  allowedAdAccounts, visibleAdAccounts, eighteenMonthRange, latestMonthWithSpend, parseAdAccounts, parseCampaignInsights, parseCampaigns, parseUserToken, recordedIds, testCampaignParams, totalsOf,
  type AdAccount, type Campaign, type CampaignResult,
} from './md-app-ads-core'

/**
 * MD APP ADS — the I/O half (9 Nov 2026). Rules and the why: md-app-ads-core.ts. One row per client in md_app_ads;
 * the user token is encrypted with CREDENTIALS_KEY and never logged, returned or put in an error.
 */

type Auth = { token: string; appSecret: string }

async function call(url: string, init?: RequestInit): Promise<any> {
  let res: Response
  try { res = await fetch(url, { ...init, cache: 'no-store' }) } catch {
    throw new MdAppError(`Could not reach Meta (${mdRedactUrl(url).split('?')[0]})`)
  }
  const json = await res.json().catch(() => null)
  if (!res.ok || (json && typeof json === 'object' && 'error' in json && json.error)) throw new MdAppError(mdErrorMessage(json, res.status), res.status)
  return json
}
const signed = (path: string, a: Auth, params?: Record<string, string | number | undefined>) => {
  const u = new URL(mdGraphUrl(path, params))
  u.searchParams.set('access_token', a.token)
  u.searchParams.set('appsecret_proof', mdAppsecretProof(a.token, a.appSecret))
  return u.toString()
}
const get = (a: Auth, path: string, params?: Record<string, string | number | undefined>) => call(signed(path, a, params))

const rows = () => table<MdAppAd>('md_app_ads')

export type PublicAds = Omit<MdAppAd, 'token_encrypted'>
const publicRow = (r: MdAppAd): PublicAds => { const { token_encrypted: _t, ...rest } = r; void _t; return rest }

/** The ads connect's callback: code → short user token → long-lived user token → stored for this client. */
export async function connectAds(ready: MdAppReady & { ok: true }, input: { code: string; clientId: string; userId: string; now: number; reviewer?: boolean }): Promise<{ missing: string[] }> {
  const short = parseUserToken(await call(mdCodeExchangeUrl({ appId: ready.env.appId, appSecret: ready.env.appSecret, redirectUri: ready.env.redirectUri, code: input.code })), input.now)
  if (!short.ok) throw new MdAppError(short.error)
  // the long-lived swap is a nicety: a failure keeps the short token rather than failing the connect
  let tok: { token: string; expiresAt: string | null } = short
  try {
    const long = parseUserToken(await call(mdGraphUrl('oauth/access_token', longLivedParams({ appId: ready.env.appId, appSecret: ready.env.appSecret, token: short.token }))), input.now)
    if (long.ok) tok = long
  } catch { /* keep the short one */ }
  const a = { token: tok.token, appSecret: ready.env.appSecret }
  const [me, perms] = await Promise.all([get(a, 'me', { fields: 'name' }).catch(() => null), get(a, 'me/permissions').catch(() => null)])
  const granted = grantedPermissions(perms)
  const nowIso = new Date(input.now).toISOString()
  await rows().claim(input.clientId, cur => ({
    id: input.clientId, client_id: input.clientId, token_encrypted: encryptSecret(tok.token),
    fb_user_name: typeof me?.name === 'string' ? me.name : null, granted: granted as never,
    connected_by: input.userId, connected_at: nowIso, expires_at: tok.expiresAt,
    ad_account_id: cur?.ad_account_id ?? null, test_campaign_ids: (cur?.test_campaign_ids ?? []) as never,
    all_accounts: input.reviewer === true,
  }))
  // THE ONE LOGIN (9 Nov 2026): the same token is the client's connection for Instagram and Pages too
  await saveConnection(ready, { token: tok.token, clientId: input.clientId, userId: input.userId, now: input.now, allAdAccounts: input.reviewer === true })
  return { missing: ['ads_read', 'ads_management'].filter(p => !granted.includes(p)) }
}

async function authOf(clientId: string): Promise<{ auth: Auth; row: MdAppAd }> {
  const ready = mdAppReady()
  if (!ready.ok) throw new MdAppError(ready.reason, 503)
  const row = await rows().get(clientId, { fresh: true })
  if (!row) throw new MdAppError('Ads are not connected for this client yet. Press Connect ads first.', 409)
  return { auth: { token: decryptSecret(row.token_encrypted), appSecret: ready.env.appSecret }, row }
}

export async function adsStatus(clientId: string): Promise<{ connection: PublicAds | null; accounts: AdAccount[]; latestMonth: string | null; error: string | null }> {
  const row = await rows().get(clientId, { fresh: true }).catch(() => null)
  if (!row) return { connection: null, accounts: [], latestMonth: null, error: null }
  try {
    const { auth } = await authOf(clientId)
    // our team's login: our own ad account only; Meta's reviewer's own login: their own test ad accounts (9 Nov 2026)
    const all = parseAdAccounts(await get(auth, 'me/adaccounts', { fields: 'id,name,account_status,currency', limit: 50 }))
    const accounts = visibleAdAccounts(all, row.all_accounts === true)
    // READ ONLY: which month to open on (latestMonthWithSpend); a failure just opens on last month
    const latestMonth = row.ad_account_id && isAdAccountId(row.ad_account_id)
      ? await get(auth, `${row.ad_account_id}/insights`, { fields: 'spend', time_increment: 'monthly', time_range: JSON.stringify(eighteenMonthRange(new Date())), limit: 30 })
        .then(latestMonthWithSpend).catch(() => null)
      : null
    return { connection: publicRow(row), accounts, latestMonth, error: null }
  } catch (e) {
    return { connection: publicRow(row), accounts: [], latestMonth: null, error: e instanceof Error ? e.message : 'Could not read the ad accounts' }
  }
}

/** the ad account must be one this login can see — never an id typed in from outside */
async function assertAccount(auth: Auth, accountId: string, all = false) {
  if (!isAdAccountId(accountId)) throw new MdAppError('Pick an ad account', 400)
  const seen = parseAdAccounts(await get(auth, 'me/adaccounts', { fields: 'id,name', limit: 50 }))
  const accounts = visibleAdAccounts(seen, all)
  if (!accounts.some(x => x.id === accountId)) throw new MdAppError('That ad account is not one this Facebook login can see', 403)
}

export async function pickAccount(clientId: string, accountId: string): Promise<void> {
  const { auth, row } = await authOf(clientId)
  await assertAccount(auth, accountId, row.all_accounts === true)
  await rows().claim(clientId, cur => (cur ? { ...cur, ad_account_id: accountId } : null))
}

/** READ ONLY: the month's results per campaign, and every campaign in the account */
export async function adsResults(clientId: string, month: string): Promise<{ accountId: string; rows: CampaignResult[]; totals: ReturnType<typeof totalsOf>; campaigns: Campaign[]; testIds: string[] }> {
  const { auth, row } = await authOf(clientId)
  const accountId = row.ad_account_id
  if (!accountId || !isAdAccountId(accountId)) throw new MdAppError('Pick an ad account first', 409)
  const range = monthTimeRange(month)
  if (!range) throw new MdAppError('Pick a month', 400)
  const [ins, camps] = await Promise.all([
    get(auth, `${accountId}/insights`, { level: 'campaign', fields: INSIGHT_FIELDS.join(','), time_range: JSON.stringify(range), limit: 100 }),
    get(auth, `${accountId}/campaigns`, { fields: 'id,name,status,effective_status,objective,created_time', limit: 50 }),
  ])
  const results = parseCampaignInsights(ins)
  return { accountId, rows: results, totals: totalsOf(results), campaigns: parseCampaigns(camps), testIds: recordedIds(row.test_campaign_ids) }
}

/** The ONE write: a PAUSED test campaign, no budget, no ad sets, no ads. Its id is recorded so it alone can be deleted. */
export async function createTestCampaign(clientId: string): Promise<{ id: string }> {
  const { auth, row } = await authOf(clientId)
  const accountId = row.ad_account_id
  if (!accountId || !isAdAccountId(accountId)) throw new MdAppError('Pick an ad account first', 409)
  await assertAccount(auth, accountId, row.all_accounts === true)
  const json = await call(signed(`${accountId}/campaigns`, auth), {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(testCampaignParams()).toString(),
  })
  const id = String(json?.id ?? '')
  if (!isCampaignId(id)) throw new MdAppError('Meta did not return the new campaign')
  await rows().claim(clientId, cur => (cur ? { ...cur, test_campaign_ids: [...recordedIds(cur.test_campaign_ids), id] as never } : null))
  return { id }
}

/** Delete — only a campaign this app created, recorded on this client, still named as the test. */
export async function deleteTestCampaign(clientId: string, campaignId: string): Promise<void> {
  if (!isCampaignId(campaignId)) throw new MdAppError('Unknown campaign', 400)
  const { auth, row } = await authOf(clientId)
  const recorded = recordedIds(row.test_campaign_ids)
  const live = await get(auth, campaignId, { fields: 'id,name' }).catch(() => null)
  const campaign = live ? { id: String(live.id), name: String(live.name ?? '') } : null
  if (!mayDeleteCampaign(campaign, recorded)) throw new MdAppError('Only the test campaign this app made can be deleted here', 403)
  await call(signed(campaignId, auth), { method: 'DELETE' })
  await rows().claim(clientId, cur => (cur ? { ...cur, test_campaign_ids: recordedIds(cur.test_campaign_ids).filter(x => x !== campaignId) as never } : null))
}

export async function disconnectAds(clientId: string): Promise<boolean> {
  const cur = await rows().get(clientId, { fresh: true })
  if (!cur) return false
  await rows().remove(clientId)
  return true
}
