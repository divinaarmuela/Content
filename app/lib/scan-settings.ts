import 'server-only'
import { table } from '@/lib/db'
import type { ScanMailbox, ScanRun } from '@/lib/db-types'
import { getMailboxes, type Mailbox } from './gmail'
import { listConnectedMailboxes } from './clerk-gmail'
import { normaliseSettings, DEFAULT_SCAN_SETTINGS, type ScanSettings } from './scan-core'
import { decryptSecret } from './secret-box'
import { inboxClientId, inboxClientSecret } from './inbox-connect'

export type { ScanSettings } from './scan-core'

/** Global scanner settings. Never throws: if the row is missing or malformed
 *  the scanner falls back to documented defaults rather than refusing to run.
 *  One row, so it lives under a fixed id. */
export async function getScanSettings(): Promise<ScanSettings> {
  try {
    const row = await table('scan_settings').get('singleton')
    if (!row) return { ...DEFAULT_SCAN_SETTINGS }
    return normaliseSettings(row)
  } catch {
    return { ...DEFAULT_SCAN_SETTINGS }
  }
}

export async function saveScanSettings(patch: unknown, updatedBy: string): Promise<ScanSettings> {
  const current = await getScanSettings()
  const merged = normaliseSettings({ ...current, ...(patch as object) })
  await table('scan_settings')
    .upsert({ id: 'singleton', ...merged, updated_at: new Date().toISOString(), updated_by: updatedBy })
  return merged
}

export type MailboxEntry = {
  email: string
  source: 'shared' | 'connected' | 'self'
  enabled: boolean
  label: string | null
  /** who granted access, for mailboxes connected through the dashboard */
  connected_by: string | null
  /** health, from the most recent run */
  last_run_at: string | null
  last_status: 'running' | 'success' | 'error' | null
  last_error: string | null
  last_leads_created: number | null
}

/**
 * Every address the scanner could use, with its on/off state and health.
 *
 * Availability comes from the environment and from Clerk; the enabled flag
 * comes from scan_mailboxes. Only addresses with no row yet are registered,
 * enabled-by-default, so a mailbox an admin has explicitly turned off is
 * never silently re-enabled.
 */
export async function listMailboxEntries(): Promise<MailboxEntry[]> {
  const shared = getMailboxes()
  const connected = await listConnectedMailboxes().catch(() => [] as Mailbox[])
  const self = await listSelfConnectedMailboxes()

  const seen = new Set(shared.map(m => m.email.toLowerCase()))
  const available: { email: string; source: 'shared' | 'connected' | 'self' }[] = [
    ...shared.map(m => ({ email: m.email.toLowerCase(), source: 'shared' as const })),
    ...self
      .filter(m => !seen.has(m.email.toLowerCase()))
      .map(m => ({ email: m.email.toLowerCase(), source: 'self' as const })),
    ...connected
      .filter(m => !seen.has(m.email.toLowerCase()) && !self.some(s => s.email === m.email.toLowerCase()))
      .map(m => ({ email: m.email.toLowerCase(), source: 'connected' as const })),
  ]

  const mailboxes = table<ScanMailbox>('scan_mailboxes')
  let rows = await mailboxes.list()
  const known = new Set(rows.map(r => r.email))
  const missing = available.filter(a => !known.has(a.email))
  if (missing.length > 0) {
    await Promise.all(missing.map(a => mailboxes.upsert({ email: a.email, source: a.source })))
    rows = await mailboxes.list()
  }
  const byEmail = new Map(rows.map(r => [r.email, r]))

  // one most-recent run per mailbox
  const runs = await table<ScanRun>('scan_runs').list({
    orderBy: [['started_at', 'desc']],
    limit: 200,
  })
  const latest = new Map<string, ScanRun>()
  for (const r of runs) if (!latest.has(r.mailbox)) latest.set(r.mailbox, r)

  return available.map(a => {
    const row = byEmail.get(a.email)
    const run = latest.get(a.email)
    return {
      email: a.email,
      source: a.source,
      enabled: row?.enabled ?? true,
      label: row?.label ?? null,
      connected_by: row?.connected_by ?? null,
      last_run_at: run?.started_at ?? null,
      last_status: (run?.status as MailboxEntry['last_status']) ?? null,
      last_error: run?.error ?? null,
      last_leads_created: run?.leads_created ?? null,
    }
  })
}

export async function setMailboxEnabled(email: string, enabled: boolean, by: string): Promise<void> {
  const mailboxes = table<ScanMailbox>('scan_mailboxes')
  const rows = await mailboxes.list({ by: { email: email.toLowerCase() } })
  await Promise.all(rows.map(r => mailboxes.update(r.id, {
    enabled, updated_at: new Date().toISOString(), updated_by: by,
  })))
}

/** The addresses a scheduled run should fan out over. */
export async function enabledMailboxEmails(): Promise<string[]> {
  const entries = await listMailboxEntries()
  return entries.filter(e => e.enabled).map(e => e.email)
}

/**
 * Mailboxes whose owner connected them through the dashboard.
 *
 * The token is decrypted here and nowhere else; a decryption failure means a
 * rotated CREDENTIALS_KEY, and losing one mailbox to that is better than
 * throwing and losing the whole scan.
 */
export async function listSelfConnectedMailboxes(): Promise<Mailbox[]> {
  const rows = await table<ScanMailbox>('scan_mailboxes').list({
    where: r => r.refresh_token_encrypted != null,
  })

  const out: Mailbox[] = []
  for (const row of rows) {
    try {
      out.push({
        email: row.email.toLowerCase(),
        refreshToken: decryptSecret(row.refresh_token_encrypted as string),
        // bound to the connect app, not the mail-sending one
        clientId: inboxClientId(),
        clientSecret: inboxClientSecret(),
      })
    } catch (e) {
      console.error(`could not decrypt the stored token for ${row.email}:`, e)
    }
  }
  return out
}
