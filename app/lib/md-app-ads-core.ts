/**
 * MD APP ADS — the pure half (9 Nov 2026). The I/O half is md-app-ads.ts.
 *
 * Why it exists: Meta's App Review for ads_read / ads_management wants a screen recording of OUR app showing the
 * Facebook Login (with the permission granted) and then the ad account's Impressions, Conversions, Spend, Clicks
 * and Reach (developers.facebook.com/docs/permissions/reference/ads_read). Until review approves, only a person with
 * a role on MD App gets those permissions, so this road uses a USER access token from a second Login for Business
 * configuration (MD_APP_ADS_CONFIG_ID), not the client's system-user token.
 *
 * SAFETY RULES (owner, 6 Nov 2026: "make sure it doesn't affect the ad account, or cost anything, or delete anything"):
 *  - reads are reads;
 *  - the only thing ever created is a campaign named TEST_CAMPAIGN_NAME, status PAUSED, no budget, no ad sets, no ads;
 *  - the only thing ever deleted is a campaign this app created AND recorded (mayDeleteCampaign).
 * Proven by hand on 7 Nov 2026 in the Graph Explorer as an app admin: the same POST made campaign 120258114641260002
 * PAUSED and DELETE /{campaign-id} removed it.
 */

export const ADS_PERMISSIONS = ['ads_read', 'ads_management'] as const

export const TEST_CAMPAIGN_NAME = 'MD App test - do not run'

/** Facebook's long-lived user token exchange (oauth/access_token, grant_type=fb_exchange_token) */
export function longLivedParams(p: { appId: string; appSecret: string; token: string }): Record<string, string> {
  return { grant_type: 'fb_exchange_token', client_id: p.appId, client_secret: p.appSecret, fb_exchange_token: p.token }
}

/** `{ access_token, expires_in? }` → the token and when it ends (null when Meta did not say) */
export function parseUserToken(json: unknown, now: number): { ok: true; token: string; expiresAt: string | null } | { ok: false; error: string } {
  const j = (json ?? {}) as Record<string, unknown>
  if (typeof j.access_token !== 'string' || !j.access_token) {
    const e = (j.error ?? {}) as Record<string, unknown>
    return { ok: false, error: typeof e.message === 'string' ? e.message : 'Meta sent no token back' }
  }
  const secs = Number(j.expires_in)
  return { ok: true, token: j.access_token, expiresAt: Number.isFinite(secs) && secs > 0 ? new Date(now + secs * 1000).toISOString() : null }
}

/** /me/permissions → the granted ones */
export function grantedPermissions(json: unknown): string[] {
  const data = ((json ?? {}) as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data.filter((r: any) => r && r.status === 'granted' && typeof r.permission === 'string').map((r: any) => r.permission as string)
}

export function missingAdsPermissions(granted: readonly string[]): string[] {
  return ADS_PERMISSIONS.filter(p => !granted.includes(p))
}

export type AdAccount = { id: string; name: string; status: number | null; currency: string | null }

/** /me/adaccounts?fields=id,name,account_status,currency */
export function parseAdAccounts(json: unknown): AdAccount[] {
  const data = ((json ?? {}) as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data
    .filter((r: any) => r && typeof r.id === 'string' && /^act_\d{1,30}$/.test(r.id))
    .map((r: any) => ({ id: r.id, name: typeof r.name === 'string' && r.name ? r.name : r.id, status: Number.isFinite(Number(r.account_status)) ? Number(r.account_status) : null, currency: typeof r.currency === 'string' ? r.currency : null }))
}

/**
 * THE ONLY AD ACCOUNTS THIS APP SHOWS (9 Nov 2026, owner: the card listed 19 accounts, most of them real clients').
 * The ads login is a person's own Facebook, which sees every account that person manages; until App Review is
 * approved and clients connect their own, only our own MDM Marketing account is listed, picked or touched.
 */
export const ALLOWED_AD_ACCOUNTS: readonly string[] = ['act_572733431883963']

export function allowedAdAccounts<T extends { id: string }>(accounts: readonly T[]): T[] {
  return accounts.filter(a => ALLOWED_AD_ACCOUNTS.includes(a.id))
}

/**
 * The latest month that had spend, from /{act}/insights?time_increment=monthly&fields=spend (9 Nov 2026). The card opens
 * on it, so nobody — Meta's reviewer included — lands on a month of zeros because the account's ads are paused today.
 */
export function latestMonthWithSpend(json: unknown): string | null {
  const data = ((json ?? {}) as { data?: unknown }).data
  if (!Array.isArray(data)) return null
  const months = data
    .filter((r: any) => r && typeof r.date_start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date_start) && Number(r.spend) > 0)
    .map((r: any) => (r.date_start as string).slice(0, 7))
    .sort()
  return months.length ? months[months.length - 1] : null
}

/** the last 18 whole months up to today, as Meta's time_range */
export function eighteenMonthRange(now: Date): { since: string; until: string } {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 17, 1))
  return { since: since.toISOString().slice(0, 10), until: now.toISOString().slice(0, 10) }
}

/**
 * Which ad accounts a connection may list (9 Nov 2026). Our own MDM Marketing whenever the login can see it — that is
 * every connect made with our team's Facebook, the reviewer login included. Only a login that sees NONE of ours AND
 * was started by Meta's reviewer login (their own Meta test account) lists its own accounts instead.
 */
export function visibleAdAccounts<T extends { id: string }>(all: readonly T[], reviewerConnect: boolean): T[] {
  const ours = allowedAdAccounts(all)
  return ours.length > 0 || !reviewerConnect ? ours : [...all]
}

export const isAdAccountId = (v: unknown): v is string => typeof v === 'string' && /^act_\d{1,30}$/.test(v)
export const isCampaignId = (v: unknown): v is string => typeof v === 'string' && /^\d{1,30}$/.test(v)

/** 'YYYY-MM' → Meta's time_range (since/until inclusive). null for anything else. */
export function monthTimeRange(month: string): { since: string; until: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return null
  const y = Number(m[1]); const mo = Number(m[2])
  if (mo < 1 || mo > 12) return null
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return { since: `${m[1]}-${m[2]}-01`, until: `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}` }
}

export const INSIGHT_FIELDS = ['campaign_id', 'campaign_name', 'impressions', 'reach', 'clicks', 'spend', 'actions'] as const

/** the result actions counted as "Conversions" on the screen — leads, purchases, sign-ups, plus the pixel's own */
const CONVERSION_TYPES = new Set(['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'purchase', 'offsite_conversion.fb_pixel_purchase', 'complete_registration', 'offsite_conversion.fb_pixel_complete_registration', 'contact', 'schedule', 'submit_application'])

export type CampaignResult = { campaignId: string; name: string; impressions: number; reach: number; clicks: number; spend: number; conversions: number }

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

/** /act_x/insights?level=campaign → one row per campaign. `lead` and `onsite_conversion.lead_grouped` describe the same
 *  leads, so a campaign's conversions take the larger of the two lead counts rather than adding them. */
export function parseCampaignInsights(json: unknown): CampaignResult[] {
  const data = ((json ?? {}) as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data.filter((r: any) => r && r.campaign_id).map((r: any) => {
    const acts: { action_type: string; value: unknown }[] = Array.isArray(r.actions) ? r.actions : []
    let leads = 0; let other = 0
    for (const a of acts) {
      if (!CONVERSION_TYPES.has(a?.action_type)) continue
      if (a.action_type.includes('lead')) leads = Math.max(leads, num(a.value))
      else other += num(a.value)
    }
    return {
      campaignId: String(r.campaign_id), name: typeof r.campaign_name === 'string' ? r.campaign_name : String(r.campaign_id),
      impressions: num(r.impressions), reach: num(r.reach), clicks: num(r.clicks), spend: num(r.spend), conversions: leads + other,
    }
  })
}

export function totalsOf(rows: readonly CampaignResult[]): Omit<CampaignResult, 'campaignId' | 'name'> {
  return rows.reduce((t, r) => ({
    impressions: t.impressions + r.impressions, reach: t.reach + r.reach, clicks: t.clicks + r.clicks,
    spend: Math.round((t.spend + r.spend) * 100) / 100, conversions: t.conversions + r.conversions,
  }), { impressions: 0, reach: 0, clicks: 0, spend: 0, conversions: 0 })
}

export type Campaign = { id: string; name: string; status: string; objective: string | null; createdTime: string | null }

export function parseCampaigns(json: unknown): Campaign[] {
  const data = ((json ?? {}) as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data.filter((r: any) => r && isCampaignId(String(r.id))).map((r: any) => ({
    id: String(r.id), name: typeof r.name === 'string' ? r.name : String(r.id),
    status: String(r.effective_status ?? r.status ?? ''), objective: typeof r.objective === 'string' ? r.objective : null,
    createdTime: typeof r.created_time === 'string' ? r.created_time : null,
  }))
}

/** The ONE thing this app creates: a PAUSED campaign with no budget (so no ad set, no ad, nothing can spend). */
export function testCampaignParams(): Record<string, string> {
  return {
    name: TEST_CAMPAIGN_NAME, objective: 'OUTCOME_ENGAGEMENT', status: 'PAUSED',
    special_ad_categories: '[]', is_adset_budget_sharing_enabled: 'false',
  }
}

/** Delete only what this app made: recorded on the client's row AND still carrying the test name. */
export function mayDeleteCampaign(campaign: Pick<Campaign, 'id' | 'name'> | null, recorded: readonly string[]): boolean {
  return !!campaign && recorded.includes(campaign.id) && campaign.name === TEST_CAMPAIGN_NAME
}

export function recordedIds(v: unknown): string[] {
  return Array.isArray(v) ? v.filter(isCampaignId) : []
}
