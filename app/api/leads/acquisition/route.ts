import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Prospect as ProspectRow } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { sanitiseProspectPatch } from '../../../lib/acquisition-core'
import { logAcqEvent } from '../../../lib/acquisition'

/**
 * A NEW TARGET (the acquisition blueprint, 21 Sep 2026 — §7 "Research Target:
 * business identified but no contact made yet"). Anyone on the team adds one;
 * it starts at stage 1 with whoever added it on the record. A strong fit and
 * a weak presence are the blueprint's first two score signals, written on the
 * timeline the moment they are ticked.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler') // any team role; excludes `client`
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      const clean = sanitiseProspectPatch(body)
      if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 422 })
      if (!clean.patch.business) return NextResponse.json({ error: 'A target needs the business’s name' }, { status: 422 })
      const now = new Date().toISOString()
      const prospect = await table<ProspectRow>('prospects').insert({
        ...clean.patch, stage: 'target', stage_entered_at: now, added_by: user.id,
        source: clean.patch.source ?? 'outbound', created_at: now, updated_at: now,
      } as never)
      await logAcqEvent({ prospectId: prospect.id, kind: 'added', by: user.id, detail: `Added by ${user.name || user.email}` })
      if (body.fit_strong === true) await logAcqEvent({ prospectId: prospect.id, kind: 'fit', by: user.id })
      if (body.weak_presence === true) await logAcqEvent({ prospectId: prospect.id, kind: 'weak_presence', by: user.id })
      // the agent looks the business up while Manal carries on (acq-agent.ts) — best effort
      try { const { inngest } = await import('../../../inngest/client'); await inngest.send({ name: 'app/acquisition.research.requested', data: { prospect_id: prospect.id } }) } catch (e) { console.error('[acquisition] could not queue the research:', e) }
      return NextResponse.json({ prospect }, { status: 201 })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
