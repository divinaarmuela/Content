import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Lead, LeadEvent, EmailIngestLog } from '@/lib/db-types'
import { requireSignedIn, authzErrorResponse } from '@/app/lib/authz'
import { buildTimeline } from '@/app/lib/lead-timeline-core'

/** A lead's timeline (9 Nov 2026) — the team only, never a client. Pure rules: app/lib/lead-timeline-core.ts. */
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSignedIn()
    if (user.role === 'client') return NextResponse.json({ error: 'Not for clients' }, { status: 403 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  const { id } = await params
  return withRequestCache(async () => {
    const lead = await table<Lead>('leads').get(id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    const email = (lead.email ?? '').toLowerCase()
    const [events, emails] = await Promise.all([
      table<LeadEvent>('lead_events').list({ by: { lead_id: id } }),
      table<EmailIngestLog>('email_ingest_log').list({ where: m => m.lead_id === id || (!!email && (m.from_email ?? '').toLowerCase() === email) }),
    ])
    return NextResponse.json({ items: buildTimeline(lead, events, emails) })
  })
}
