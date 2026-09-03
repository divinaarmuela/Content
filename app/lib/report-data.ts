import 'server-only'
import { table } from '@/lib/db'
import type { Client, EmailIngestLog, Lead } from '@/lib/db-types'

/** Aggregates one calendar month of lead activity for the report. */

export type LeadsReportData = {
  month: number
  year: number
  monthLabel: string
  periodStart: string
  periodEnd: string
  totals: {
    leads: number
    fromForm: number
    fromInbox: number
    prospectsCreated: number
    inboxScanned: number
    inboxSkipped: number
  }
  byService: { label: string; count: number }[]
  leads: {
    date: string
    name: string
    business: string
    email: string
    source: string
    service: string
  }[]
}

export async function buildLeadsReportData(
  month: number,
  year: number,
  dataFrom?: string | null
): Promise<LeadsReportData> {
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))
  const effectiveStart = dataFrom && new Date(dataFrom) > start ? new Date(dataFrom) : start
  const startIso = effectiveStart.toISOString()
  const endIso = end.toISOString()

  const inPeriod = (created: string | null | undefined) =>
    !!created && created >= startIso && created < endIso

  const [leads, ingest, prospects] = await Promise.all([
    table<Lead>('leads').list({
      where: r => inPeriod(r.created_at),
      orderBy: [['created_at', 'asc']],
      limit: 500,
    }),
    table<EmailIngestLog>('email_ingest_log').list({
      where: r => inPeriod(r.created_at),
      limit: 2000,
    }),
    table<Client>('clients').list({
      by: { status: 'prospect' },
      where: r => inPeriod(r.created_at),
      limit: 500,
    }),
  ])

  const serviceCounts = new Map<string, number>()
  for (const l of leads) {
    const key = (l.model || 'Not specified').trim()
    serviceCounts.set(key, (serviceCounts.get(key) ?? 0) + 1)
  }
  const byService = [...serviceCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)

  return {
    month,
    year,
    monthLabel: start.toLocaleString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    periodStart: startIso.slice(0, 10),
    periodEnd: new Date(end.getTime() - 86400000).toISOString().slice(0, 10),
    totals: {
      leads: leads.length,
      fromForm: leads.filter(l => (l.source ?? 'web_form') === 'web_form').length,
      fromInbox: leads.filter(l => l.source === 'email_ingest').length,
      prospectsCreated: prospects.length,
      inboxScanned: ingest.length,
      inboxSkipped: ingest.filter(i => ['skipped', 'not_a_lead'].includes(i.status)).length,
    },
    byService,
    leads: leads.map(l => ({
      date: new Date(l.created_at).toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', day: '2-digit', month: 'short' }),
      name: `${l.fname} ${l.lname}`.trim(),
      business: l.biz ?? '',
      email: l.email ?? '',
      source: l.source === 'email_ingest' ? 'Inbox' : 'Website',
      service: l.model ?? '—',
    })),
  }
}
