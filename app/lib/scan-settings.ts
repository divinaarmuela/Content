import 'server-only'
import { supabase } from '@/lib/supabase'
import { getMailboxes, type Mailbox } from './gmail'
import { listConnectedMailboxes } from './clerk-gmail'
import { normaliseSettings, DEFAULT_SCAN_SETTINGS, type ScanSettings } from './scan-core'
import { decryptSecret } from './secret-box'
import { inboxClientId, inboxClientSecret } from './inbox-connect'

export type { ScanSettings } from './scan-core'

/** Global scanner settings. Never throws: if the table is missing or the row
 *  is malformed the scanner falls back to documented defaults rather than
 *  refusing to run. */
export async function getScanSettings(): Promise<ScanSettings> {
  const { data, error } = await supabase
    .from('scan_settings').select('*').eq('id', 1).maybeSingle()
  if (error || !data) return { ...DEFAULT_SCAN_SETTINGS }
  return normaliseSettings(data)
}

export async function saveScanSettings(patch: unknown, updatedBy: string): Promise<ScanSettings> {
  const current = await getScanSettings()
  const merged = normaliseSettings({ ...current, ...(patch as object) })
  const { error } = await supabase
    .from('scan_settings')
    .upsert({ id: 1, ...merged, updated_at: new Date().toISOString(), updated_by: updatedBy })
  if (error) throw new Error(error.message)
  return merged
}

export type MailboxEntry = {
  email: string
  source: 'shared' | 'connected' | 'self'
  enabled: boolean
  label: string | null
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
 * comes from scan_mailboxes. Newly discovered addresses are registered
 * enabled-by-default via an upsert that ignores conflicts, so a mailbox an
 * admin has explicitly turned off is never silently re-enabled.
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

  if (available.length > 0) {
    await supabase.from('scan_mailboxes').upsert(
      available.map(a => ({ email: a.email, source: a.source })),
      { onConflict: 'email', ignoreDuplicates: true }
    )
  }

  const { data: rows } = await supabase
    .from('scan_mailboxes').select('email, enabled, label, source')
  const byEmail = new Map((rows ?? []).map(r => [r.email as string, r]))

  // one most-recent run per mailbox
  const { data: runs } = await supabase
    .from('scan_runs')
    .select('mailbox, status, started_at, error, leads_created')
    .order('started_at', { ascending: false })
    .limit(200)
  const latest = new Map<string, NonNullable<typeof runs>[number]>()
  for (const r of runs ?? []) if (!latest.has(r.mailbox)) latest.set(r.mailbox, r)

  return available.map(a => {
    const row = byEmail.get(a.email)
    const run = latest.get(a.email)
    return {
      email: a.email,
      source: a.source,
      enabled: row?.enabled ?? true,
      label: (row?.label as string | null) ?? null,
      last_run_at: run?.started_at ?? null,
      last_status: (run?.status as MailboxEntry['last_status']) ?? null,
      last_error: run?.error ?? null,
      last_leads_created: run?.leads_created ?? null,
    }
  })
}

export async function setMailboxEnabled(email: string, enabled: boolean, by: string): Promise<void> {
  const { error } = await supabase
    .from('scan_mailboxes')
    .update({ enabled, updated_at: new Date().toISOString(), updated_by: by })
    .eq('email', email.toLowerCase())
  if (error) throw new Error(error.message)
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
  const { data } = await supabase
    .from('scan_mailboxes')
    .select('email, refresh_token_encrypted')
    .not('refresh_token_encrypted', 'is', null)

  const out: Mailbox[] = []
  for (const row of data ?? []) {
    try {
      out.push({
        email: (row.email as string).toLowerCase(),
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
