import 'server-only'
import { supabase } from '@/lib/supabase'

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

  const [leadsRes, ingestRes, prospectsRes] = await Promise.all([
    supabase
      .from('leads')
      .select('created_at, fname, lname, email, biz, model, source')
      .gte('created_at', startIso).lt('created_at', endIso)
      .order('created_at', { ascending: true })
      .limit(500),
    supabase
      .from('email_ingest_log')
      .select('status')
      .gte('created_at', startIso).lt('created_at', endIso)
      .limit(2000),
    supabase
      .from('clients')
      .select('id')
      .eq('status', 'prospect')
      .gte('created_at', startIso).lt('created_at', endIso)
      .limit(500),
  ])

  const leads = leadsRes.data ?? []
  const ingest = ingestRes.data ?? []

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
      prospectsCreated: (prospectsRes.data ?? []).length,
      inboxScanned: ingest.length,
      inboxSkipped: ingest.filter(i => ['skipped', 'not_a_lead'].includes(i.status)).length,
    },
    byService,
    leads: leads.map(l => ({
      date: new Date(l.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }),
      name: `${l.fname} ${l.lname}`.trim(),
      business: l.biz ?? '',
      email: l.email,
      source: l.source === 'email_ingest' ? 'Inbox' : 'Website',
      service: l.model ?? '—',
    })),
  }
}
