/**
 * SCANNING — the pure half (the acquisition blueprint's Scanning page: what
 * was read, when, from which inbox, and what came of it).
 *
 * Nothing new is recorded for this page. It reads what the system already
 * keeps: the email scanner's log (one row per message it looked at, with
 * why it was skipped or kept), the agent's per-prospect check stamp, and
 * the findings the agent and the scanner put on prospects' timelines. No
 * I/O.
 */

import { ACQ_EVENT_KINDS } from './acquisition-core'

export type MailboxLike = { email: string; enabled?: boolean | null; source?: string | null }
export type IngestRow = {
  id: string
  created_at: string
  mailbox?: string | null
  from_email?: string | null
  subject?: string | null
  received_at?: string | null
  status?: string | null
  reasoning?: string | null
  lead_id?: string | null
}
export type FindingEvent = {
  id: string
  prospect_id: string
  kind: string
  at: string
  source?: string | null
  detail?: string | null
  confidence?: number | null
  confirmed?: boolean | null
  dismissed_at?: string | null
}

export const SCAN_CRON_WORDS = 'The agent reads the connected inboxes and MD Media’s Instagram DMs every 30 minutes, 6 am to 10 pm Melbourne; a DM to MD Media’s account wakes it at once.'

/** what the email scanner's status means, in words */
export const INGEST_STATUS_WORDS: Record<string, string> = {
  lead_created: 'Made a lead',
  not_a_lead: 'Read — not a lead',
  skipped: 'Skipped',
  error: 'Could not read',
}

export type MailboxSummary = {
  email: string
  enabled: boolean
  last_read_at: string | null
  today: { read: number; skipped: number; leads: number; errors: number }
}

const dayKey = (iso: string | null | undefined, tz: string): string | null => {
  const t = Date.parse(String(iso ?? ''))
  if (!Number.isFinite(t)) return null
  return new Date(t).toLocaleDateString('en-CA', { timeZone: tz })
}

/** each mailbox the scanner is set to read: when it last looked, and today's tally */
export function mailboxSummaries(entries: readonly MailboxLike[], rows: readonly IngestRow[], nowIso: string, tz = 'Australia/Melbourne'): MailboxSummary[] {
  const today = dayKey(nowIso, tz)
  return entries.map(e => {
    const mine = rows.filter(r => String(r.mailbox ?? '').toLowerCase() === e.email.toLowerCase())
    const last = mine.reduce<string | null>((best, r) => (!best || String(r.created_at) > best ? String(r.created_at) : best), null)
    const todays = mine.filter(r => dayKey(r.created_at, tz) === today)
    return {
      email: e.email.toLowerCase(),
      enabled: e.enabled !== false,
      last_read_at: last,
      today: {
        read: todays.length,
        skipped: todays.filter(r => r.status === 'skipped').length,
        leads: todays.filter(r => r.status === 'lead_created').length,
        errors: todays.filter(r => r.status === 'error').length,
      },
    }
  }).sort((a, b) => a.email.localeCompare(b.email))
}

export type RecentRead = { id: string; at: string; mailbox: string; from: string; subject: string; status: string; words: string; why: string | null; lead_id: string | null }

/** the last messages the scanner looked at, newest first */
export function recentReads(rows: readonly IngestRow[], n = 40): RecentRead[] {
  return [...rows]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, n)
    .map(r => ({
      id: r.id,
      at: String(r.received_at ?? r.created_at),
      mailbox: String(r.mailbox ?? ''),
      from: String(r.from_email ?? ''),
      subject: String(r.subject ?? '').trim() || '(no subject)',
      status: String(r.status ?? ''),
      words: INGEST_STATUS_WORDS[String(r.status ?? '')] ?? String(r.status ?? ''),
      why: String(r.reasoning ?? '').trim() || null,
      lead_id: r.lead_id ?? null,
    }))
}

export type AgentSummary = { last_pass_at: string | null; prospects_checked: number; prospects_total: number }

/** when the agent last looked at anything, and how many prospects it has ever checked */
export function agentSummary(prospects: readonly { agent_checked_at?: string | null }[]): AgentSummary {
  const stamps = prospects.map(p => String(p.agent_checked_at ?? '')).filter(Boolean)
  return {
    last_pass_at: stamps.length ? stamps.sort().at(-1)! : null,
    prospects_checked: stamps.length,
    prospects_total: prospects.length,
  }
}

export type Finding = { id: string; at: string; prospect_id: string; business: string; kind: string; label: string; detail: string; confidence: number | null; state: 'recorded' | 'unsure' | 'dismissed'; source: string }

/** what the agent and the scanner put on prospects, newest first, with where each landed */
export function findingsList(events: readonly FindingEvent[], prospects: readonly { id: string; business: string }[], n = 40): Finding[] {
  const name = new Map(prospects.map(p => [p.id, p.business]))
  return events
    .filter(e => (e.source === 'agent' || e.source === 'scanner') && name.has(e.prospect_id))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, n)
    .map(e => ({
      id: e.id,
      at: e.at,
      prospect_id: e.prospect_id,
      business: name.get(e.prospect_id)!,
      kind: e.kind,
      label: ACQ_EVENT_KINDS[e.kind as keyof typeof ACQ_EVENT_KINDS]?.label ?? e.kind,
      detail: String(e.detail ?? '').trim(),
      confidence: typeof e.confidence === 'number' ? e.confidence : null,
      state: e.dismissed_at ? 'dismissed' : e.confirmed === false ? 'unsure' : 'recorded',
      source: String(e.source ?? ''),
    }))
}
