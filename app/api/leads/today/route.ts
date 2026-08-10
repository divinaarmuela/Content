import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { guard } from '../../../lib/authz'

/**
 * Today's new leads (Melbourne day), each with the reason it exists: the
 * classifier's own reasoning for scanner finds, the form for form fills.
 * Feeds the "new leads today" banner on the leads page.
 */
export async function GET() {
  const denied = await guard('editor')
  if (denied) return denied

  // midnight Melbourne expressed in UTC, robust across AEST/AEDT
  const melbNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Australia/Melbourne' }))
  const utcNow = new Date()
  const offsetMs = utcNow.getTime() - melbNow.getTime()
  const melbMidnight = new Date(melbNow); melbMidnight.setHours(0, 0, 0, 0)
  const sinceUtc = new Date(melbMidnight.getTime() + offsetMs).toISOString()

  const { data: leads, error } = await supabase.from('leads')
    .select('id, created_at, fname, lname, email, biz, need, source')
    .gte('created_at', sinceUtc).order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // the classifier's reasoning lives in the ingest log, keyed by lead
  const ids = (leads ?? []).map(l => l.id)
  const reasons = new Map<string, { reasoning: string | null; subject: string | null; mailbox: string | null }>()
  if (ids.length > 0) {
    const { data: log } = await supabase.from('email_ingest_log')
      .select('lead_id, reasoning, subject, mailbox')
      .in('lead_id', ids)
    for (const row of log ?? []) {
      if (row.lead_id && !reasons.has(row.lead_id)) {
        reasons.set(row.lead_id, { reasoning: row.reasoning, subject: row.subject, mailbox: row.mailbox })
      }
    }
  }

  return NextResponse.json({
    since: sinceUtc,
    leads: (leads ?? []).map(l => {
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
}
