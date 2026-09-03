import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Lead, EmailIngestLog } from '@/lib/db-types'
import { guard } from '../../../lib/authz'

/**
 * Today's new leads (Melbourne day), each with the reason it exists: the
 * classifier's own reasoning for scanner finds, the form for form fills.
 * Feeds the "new leads today" banner on the leads page.
 */
export async function GET() {
  return withRequestCache(async () => {
  const denied = await guard('editor')
  if (denied) return denied

  // midnight Melbourne expressed in UTC, robust across AEST/AEDT
  const melbNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Melbourne' }))
  const utcNow = new Date()
  const offsetMs = utcNow.getTime() - melbNow.getTime()
  const melbMidnight = new Date(melbNow); melbMidnight.setHours(0, 0, 0, 0)
  const sinceUtc = new Date(melbMidnight.getTime() + offsetMs).toISOString()

  let leads: Lead[]
  try {
    leads = await table<Lead>('leads').list({
      where: l => l.created_at >= sinceUtc, orderBy: [['created_at', 'desc']],
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  // the classifier's reasoning lives in the ingest log, keyed by lead
  const ids = leads.map(l => l.id)
  const reasons = new Map<string, { reasoning: string | null; subject: string | null; mailbox: string | null }>()
  if (ids.length > 0) {
    const log = await table<EmailIngestLog>('email_ingest_log').list({
      where: r => !!r.lead_id && ids.includes(r.lead_id),
    })
    for (const row of log) {
      if (row.lead_id && !reasons.has(row.lead_id)) {
        reasons.set(row.lead_id, { reasoning: row.reasoning, subject: row.subject, mailbox: row.mailbox })
      }
    }
  }

  return NextResponse.json({
    since: sinceUtc,
    leads: leads.map(l => {
      const scan = reasons.get(l.id)
      return {
        id: l.id,
        created_at: l.created_at,
        name: `${l.fname ?? ''} ${l.lname ?? ''}`.trim() || l.email,
        biz: l.biz,
        source: l.source,
        reason: l.source === 'web_form'
          ? `Filled the website contact form${l.need ? `: "${l.need}"` : ''}`
          : scan
            ? `Scanner${scan.mailbox ? ` (${scan.mailbox.split('@')[0]}@)` : ''}${scan.subject ? `, "${scan.subject}"` : ''}${scan.reasoning ? `: ${scan.reasoning}` : ''}`
            : 'Picked up by the inbox scanner',
      }
    }),
  })
  })
}
