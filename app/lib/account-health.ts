import 'server-only'
import { table } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { Client, SocialAccount, TeamUserClient } from '@/lib/db-types'
import { getPublisher } from './publisher'
import { notify, renderEmail, escapeHtml } from './mailer'
import { healthVerdict, reconnectSubject, type ProviderHealth, type StoredHealth } from './account-health-core'

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
/** the agency's own inbox — always told when an account drops (the owner,
 *  9 Sep 2026: "notification is sent to scheduler, AM and tech@") */
export const TECH_EMAIL = 'tech@mdmmarketing.com.au'

/**
 * THE MORNING CHECK ON EVERY CONNECTED ACCOUNT.
 *
 * One call to the provider for the lot, the verdict written on each
 * account's row (`social_accounts.health`) so the Schedule page's icons
 * read it live, and — for an account that needs reconnecting — a note to
 * the people who can do something about it: the client's schedulers and
 * managers, and the agency's tech inbox. Once per account per day
 * (`notify` dedupes on the entity id).
 */
/**
 * Re-read ONE client's accounts' health, now — after a reconnect, so the
 * "expired" the morning check wrote does not stand until tomorrow's 7 am on
 * an account the client has just signed into again. No emails: that is the
 * morning's job, and a reconnect is good news.
 */
export async function refreshClientAccountsHealth(clientId: string, now: Date = new Date()): Promise<number> {
  const publisher = getPublisher()
  const answer = await publisher.accountsHealth().catch(() => null) as { accounts?: ProviderHealth[] } | null
  const rows = Array.isArray(answer?.accounts) ? answer!.accounts! : []
  if (rows.length === 0) return 0
  const ours = await table<SocialAccount>('social_accounts').list({ by: { client_id: clientId } })
  const byProvider = new Map(ours.filter(a => a.active !== false).map(a => [String(a.provider_account_id), a]))
  let updated = 0
  for (const row of rows) {
    const account = byProvider.get(String(row.accountId ?? ''))
    if (!account) continue
    await table('social_accounts').update(account.id, { health: healthVerdict(row, now.getTime()) })
    updated++
  }
  return updated
}

export async function checkAllAccountsHealth(now: Date = new Date()): Promise<{ checked: number; act: number; watch: number; told: number }> {
  const tally = { checked: 0, act: 0, watch: 0, told: 0 }
  const publisher = getPublisher()
  const answer = await publisher.accountsHealth() as { accounts?: ProviderHealth[] } | null
  const rows = Array.isArray(answer?.accounts) ? answer!.accounts! : []
  if (rows.length === 0) return tally

  const ours = await table<SocialAccount>('social_accounts').list({ where: a => a.active !== false })
  const byProvider = new Map(ours.map(a => [String(a.provider_account_id), a]))
  const day = now.toISOString().slice(0, 10)

  for (const row of rows) {
    const account = byProvider.get(String(row.accountId ?? ''))
    if (!account) continue
    const health = healthVerdict(row, now.getTime())
    await table('social_accounts').update(account.id, { health })
    tally.checked++
    if (health.level === 'watch') tally.watch++
    if (health.level !== 'act') continue
    tally.act++
    tally.told += await tellTheTeam(account, health, day)
  }
  return tally
}

async function tellTheTeam(account: SocialAccount, health: StoredHealth, day: string): Promise<number> {
  const client = account.client_id ? await table<Client>('clients').get(account.client_id).catch(() => null) : null
  const links = account.client_id
    ? await table<TeamUserClient>('team_user_clients').list({ by: { client_id: account.client_id } })
    : []
  const joined = await attachOne(links, 'team_user_id', 'team_users', ['id', 'email', 'name', 'role', 'active_status'])
  const people = joined
    .map(r => r.team_users as unknown as { id: string; email: string; name: string; role: string; active_status: boolean } | null)
    .filter((u): u is { id: string; email: string; name: string; role: string; active_status: boolean } =>
      !!u && u.active_status && ['scheduler', 'account_manager', 'super_admin'].includes(u.role))
  const subject = reconnectSubject({ username: account.username, name: account.name, platform: String(account.platform) }, client?.name ?? null)
  const href = account.client_id
    ? `${DASHBOARD_URL}/dashboard/social/schedule?client=${encodeURIComponent(account.client_id)}`
    : `${DASHBOARD_URL}/dashboard/social`
  const body = renderEmail(
    subject,
    `<p><strong>${escapeHtml(account.username || account.name || String(account.platform))}</strong> on ${escapeHtml(String(account.platform))}` +
    `${client ? ` for <strong>${escapeHtml(client.name)}</strong>` : ''} needs reconnecting.</p>` +
    `<p>${escapeHtml(health.reason)}</p>` +
    `<p>On the Schedule page, press the account's icon and choose Reconnect — it opens the network's sign-in, the same as connecting it the first time.</p>`,
    'Open the Schedule page',
    href,
  )
  const recipients: { id: string | null; email: string }[] = [
    ...people.map(p => ({ id: p.id, email: p.email })),
    ...(people.some(p => p.email.toLowerCase() === TECH_EMAIL) ? [] : [{ id: null, email: TECH_EMAIL }]),
  ]
  let told = 0
  for (const r of recipients) {
    await notify({
      eventType: 'account_reconnect',
      entityType: 'social_account',
      entityId: `${account.id}#health#${day}`,
      recipientId: r.id, recipientEmail: r.email,
      subject, bodyHtml: body,
    })
    told++
  }
  return told
}
