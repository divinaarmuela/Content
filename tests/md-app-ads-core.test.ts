import { describe, expect, it } from 'vitest'
import {
  TEST_CAMPAIGN_NAME, grantedPermissions, mayDeleteCampaign, missingAdsPermissions, monthTimeRange, parseAdAccounts,
  parseCampaignInsights, parseCampaigns, parseUserToken, recordedIds, testCampaignParams, totalsOf,
} from '../app/lib/md-app-ads-core'

describe('MD App ads, the pure rules (9 Nov 2026)', () => {
  it('reads a user token and when it ends', () => {
    expect(parseUserToken({ access_token: 'abc', expires_in: 3600 }, 0)).toEqual({ ok: true, token: 'abc', expiresAt: new Date(3600_000).toISOString() })
    expect(parseUserToken({ access_token: 'abc' }, 0)).toEqual({ ok: true, token: 'abc', expiresAt: null })
    expect(parseUserToken({ error: { message: 'Invalid code' } }, 0)).toEqual({ ok: false, error: 'Invalid code' })
  })
  it('says which ads permissions were not granted', () => {
    const g = grantedPermissions({ data: [{ permission: 'ads_read', status: 'granted' }, { permission: 'ads_management', status: 'declined' }] })
    expect(g).toEqual(['ads_read'])
    expect(missingAdsPermissions(g)).toEqual(['ads_management'])
  })
  it('keeps only real ad account ids', () => {
    expect(parseAdAccounts({ data: [{ id: 'act_572733431883963', name: 'MDM Marketing', account_status: 1, currency: 'AUD' }, { id: '../x' }] }))
      .toEqual([{ id: 'act_572733431883963', name: 'MDM Marketing', status: 1, currency: 'AUD' }])
  })
  it('turns a month into Meta\'s date range', () => {
    expect(monthTimeRange('2026-02')).toEqual({ since: '2026-02-01', until: '2026-02-28' })
    expect(monthTimeRange('2026-10')).toEqual({ since: '2026-10-01', until: '2026-10-31' })
    expect(monthTimeRange('2026-13')).toBeNull()
    expect(monthTimeRange('x')).toBeNull()
  })
  it('counts conversions without counting the same leads twice', () => {
    const rows = parseCampaignInsights({ data: [{
      campaign_id: '1', campaign_name: 'Leads', impressions: '1000', reach: '800', clicks: '40', spend: '120.50',
      actions: [{ action_type: 'lead', value: '7' }, { action_type: 'onsite_conversion.lead_grouped', value: '7' }, { action_type: 'link_click', value: '40' }, { action_type: 'purchase', value: '2' }],
    }] })
    expect(rows).toEqual([{ campaignId: '1', name: 'Leads', impressions: 1000, reach: 800, clicks: 40, spend: 120.5, conversions: 9 }])
    expect(totalsOf(rows)).toEqual({ impressions: 1000, reach: 800, clicks: 40, spend: 120.5, conversions: 9 })
  })
  it('creates only a paused campaign with no budget', () => {
    const p = testCampaignParams()
    expect(p.status).toBe('PAUSED')
    expect(p.name).toBe(TEST_CAMPAIGN_NAME)
    expect(Object.keys(p).some(k => /budget/.test(k) && k !== 'is_adset_budget_sharing_enabled')).toBe(false)
  })
  it('deletes only a campaign it made and recorded', () => {
    expect(mayDeleteCampaign({ id: '9', name: TEST_CAMPAIGN_NAME }, ['9'])).toBe(true)
    expect(mayDeleteCampaign({ id: '9', name: 'Real campaign' }, ['9'])).toBe(false)
    expect(mayDeleteCampaign({ id: '8', name: TEST_CAMPAIGN_NAME }, ['9'])).toBe(false)
    expect(mayDeleteCampaign(null, ['9'])).toBe(false)
    expect(recordedIds(['9', 'x', 3])).toEqual(['9'])
  })
  it('reads campaigns', () => {
    expect(parseCampaigns({ data: [{ id: '12', name: 'A', effective_status: 'PAUSED', objective: 'OUTCOME_LEADS', created_time: '2026-05-01' }] }))
      .toEqual([{ id: '12', name: 'A', status: 'PAUSED', objective: 'OUTCOME_LEADS', createdTime: '2026-05-01' }])
  })
})

describe('the ads code can delete ONE test campaign and nothing else (owner, 9 Nov 2026)', () => {
  it('has exactly one DELETE, on a single campaign id, behind the test-campaign check', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/lib/md-app-ads.ts', 'utf8')
    const deletes = src.match(/method: 'DELETE'/g) ?? []
    expect(deletes.length).toBe(1)
    expect(src).toContain("await call(signed(campaignId, auth), { method: 'DELETE' })")
    // the check runs first, in the same function
    const fn = src.slice(src.indexOf('export async function deleteTestCampaign'), src.indexOf("{ method: 'DELETE' }"))
    expect(fn).toContain('mayDeleteCampaign(campaign, recorded)')
    // never the account-wide campaigns edge, never an ad set or ad
    expect(src).not.toMatch(/\/campaigns`[^\n]*DELETE|delete_strategy|adsets|\/ads`/)
  })
})

describe('only our own ad account is listed (9 Nov 2026)', () => {
  it('keeps MDM Marketing and drops every client account', async () => {
    const { allowedAdAccounts } = await import('../app/lib/md-app-ads-core')
    const out = allowedAdAccounts([{ id: 'act_572733431883963' }, { id: 'act_111' }, { id: 'act_222' }])
    expect(out.map(a => a.id)).toEqual(['act_572733431883963'])
  })
})
