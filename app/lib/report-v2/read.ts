import 'server-only'
import { table } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { previousMonth } from '../client-report-core'
import { runChecks } from './checks'
import { readAccountMonth } from './fetch'
import { normaliseAccount } from './normalise'
import { V2_PLATFORMS, type V2Account, type V2Platform, type V2PlatformId, type V2Report, type ZernioFetch } from './types'
import { liveZernio } from './zernio'

/**
 * REPORT V2 — one client's month, read LIVE and READ ONLY (the preview page, 5 Nov 2026): the database is only read
 * (the client and its accounts), Zernio only asked, and nothing is saved anywhere.
 */
export async function accountsOfClient(clientId: string): Promise<V2Account[]> {
  const rows = await table<{ id: string; client_id: string | null; platform: string; provider_account_id: string | null; username: string | null; name: string | null; active?: boolean | null }>('social_accounts')
    .list({ where: a => a.client_id === clientId && a.active !== false && (V2_PLATFORMS as readonly string[]).includes(a.platform) && !!a.provider_account_id })
  const seen = new Set<string>()
  return rows.filter(a => !seen.has(a.platform) && seen.add(a.platform))
    .map(a => ({ id: String(a.provider_account_id), platform: a.platform as V2PlatformId, handle: a.username ?? a.name ?? null }))
    .sort((a, b) => V2_PLATFORMS.indexOf(a.platform) - V2_PLATFORMS.indexOf(b.platform))
}

export async function readReportV2(clientId: string, month: string, opts: { z?: ZernioFetch; today?: string; compareWithLastMonth?: boolean } = {}): Promise<V2Report> {
  const z = opts.z ?? liveZernio
  const client = await table<Client>('clients').get(clientId)
  if (!client) throw new Error('No such client')
  const accounts = await accountsOfClient(clientId)
  const profileId = String((client as { social_profile_id?: string | null }).social_profile_id ?? '') || null
  const today = opts.today ?? new Date().toISOString().slice(0, 10)
  return readFromAccounts(z, { clientId, clientName: client.name, profileId, accounts }, month, today, !!opts.compareWithLastMonth)
}

/** the same, from accounts already known (the fixture tests call this) */
export async function readFromAccounts(z: ZernioFetch, c: { clientId: string; clientName: string; profileId: string | null; accounts: V2Account[] }, month: string, today: string, compareWithLastMonth = false): Promise<V2Report> {
  const gaps: string[] = []
  if (!c.accounts.length) gaps.push('This client has no account connected in Zernio')
  const platforms: V2Platform[] = []
  // one account at a time: Zernio allows about 10 calls per 2 seconds
  for (const a of c.accounts) platforms.push(normaliseAccount(await readAccountMonth(z, a, c.profileId, month, today)))
  let previous: { platforms: V2Platform[] } | null = null
  if (compareWithLastMonth) {
    const pm = previousMonth(month)
    previous = { platforms: [] }
    for (const a of c.accounts) previous.platforms.push(normaliseAccount(await readAccountMonth(z, a, c.profileId, pm, today)))
  }
  return {
    clientId: c.clientId, clientName: c.clientName, month, readAt: new Date().toISOString(),
    platforms, gaps, checks: runChecks(platforms, gaps, previous),
  }
}
