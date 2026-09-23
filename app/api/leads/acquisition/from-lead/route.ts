import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Lead, Prospect as ProspectRow } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { logAcqEvent } from '../../../../lib/acquisition'
import { ALREADY_A_PROSPECT, inboundCandidates, prospectFromLead, type InboundLead } from '../../../../lib/acq-inbound-core'

/**
 * AN INBOUND LEAD INTO THE ACQUISITION SYSTEM (the blueprint: an enquiry is
 * the signal that makes a lead). GET lists the website-form and inbox leads
 * not yet in the system; POST makes one of them a prospect — at New lead /
 * Engaged, dated from when they wrote, owned by whoever pressed it — and
 * puts the enquiry on its timeline as the reply it is. Once per lead: a
 * second press answers 409. The live Leads page keeps its row untouched.
 */
export const dynamic = 'force-dynamic'

const RECENT = 200

export async function GET() {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler')
      const [leads, prospects] = await Promise.all([
        table<Lead>('leads').list({ orderBy: [['created_at', 'desc']], limit: RECENT }),
        table<ProspectRow>('prospects').list({ limit: 2000 }),
      ])
      return NextResponse.json({ candidates: inboundCandidates(leads as unknown as InboundLead[], prospects as never[]) })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const body = await req.json().catch(() => ({})) as { lead_id?: unknown }
      const leadId = String(body.lead_id ?? '').trim()
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(leadId)) return NextResponse.json({ error: 'Pick a lead' }, { status: 400 })
      const lead = await table<Lead>('leads').get(leadId)
      if (!lead) return NextResponse.json({ error: 'That lead is gone' }, { status: 404 })
      // once per lead — and never a second row for the same address
      const prospects = await table<ProspectRow>('prospects').list({ limit: 2000, fresh: true } as never)
      if (inboundCandidates([lead as unknown as InboundLead], prospects as never[]).length === 0) {
        return NextResponse.json({ error: ALREADY_A_PROSPECT }, { status: 409 })
      }
      const now = new Date().toISOString()
      const prospect = await table<ProspectRow>('prospects').insert(prospectFromLead(lead as unknown as InboundLead, now, user.id) as never)
      // the lead's "They wrote again — reply" flag is answered by bringing it in (23 Sep 2026): the prospect's page is where the reply happens now
      if (lead.next_action) await table<Lead>('leads').update(leadId, { next_action: null, next_action_at: null } as never)
      const who = user.name || user.email
      await logAcqEvent({ prospectId: prospect.id, kind: 'added', by: user.id, detail: `Brought in from an inbound lead by ${who}` })
      const said = [lead.need, lead.model].map(s => String(s ?? '').trim()).filter(Boolean).join(' · ')
      await logAcqEvent({ prospectId: prospect.id, kind: 'reply', by: user.id, source: 'system', at: lead.created_at, detail: said ? `Wrote in: ${said}` : 'Wrote in' })
      try { const { inngest } = await import('../../../../inngest/client'); await inngest.send({ name: 'app/acquisition.research.requested', data: { prospect_id: prospect.id } }) } catch (e) { console.error('[acquisition] could not queue the research:', e) }
      return NextResponse.json({ prospect }, { status: 201 })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
