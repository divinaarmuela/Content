import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Prospect as ProspectRow } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { researchProspect } from '../../../../../lib/acq-agent'

/**
 * RESEARCH THIS BUSINESS (acq-agent.ts): the agent looks the business up on
 * the web, fills only what is empty, and puts what it found — with its
 * sources — on the timeline. Run in the request so the person sees the result.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 180

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler') // any team role; excludes `client`
      const { id } = await params
      const p = await table<ProspectRow>('prospects').get(id, { fresh: true })
      if (!p) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })
      const run = await researchProspect(p as never)
      if (run.error) return NextResponse.json({ error: run.error, run }, { status: 502 })
      return NextResponse.json({ run })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
