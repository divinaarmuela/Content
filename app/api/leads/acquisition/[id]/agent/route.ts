import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Prospect as ProspectRow } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { agentContext, runAgentForProspect } from '../../../../../lib/acq-agent'

/**
 * CHECK NOW (acq-agent.ts): the agent's pass for ONE prospect, run inside the
 * request so the person who pressed it is told what it found. The same pass
 * the schedule runs — it gathers, compares, decides and writes the same way.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler') // any team role; excludes `client`
      const { id } = await params
      const p = await table<ProspectRow>('prospects').get(id, { fresh: true })
      if (!p) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })
      const run = await runAgentForProspect(p as never, await agentContext())
      if (run.error) return NextResponse.json({ error: `The agent could not finish: ${run.error}`, run }, { status: 502 })
      return NextResponse.json({ run })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
