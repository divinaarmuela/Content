import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { IntakeForm } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { discoveryState } from '@/app/lib/lead-discovery-core'

/**
 * WHERE EVERY LEAD'S DISCOVERY FORM IS UP TO, for the Leads list (20 Nov 2026: "how can we keep track"):
 *   GET → { forms: { <lead id>: { label, tone, step, answered, total } } }
 * Only the chip's words leave here — never the answers. The team, never a client.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler')
      const rows = await table<IntakeForm & { lead_id?: string | null }>('intake_forms').list({ where: f => !!f.lead_id })
      const forms: Record<string, { label: string; tone: string; step: string; answered: number; total: number }> = {}
      for (const f of rows) {
        const s = discoveryState(f)
        forms[String(f.lead_id)] = { label: s.label, tone: s.tone, step: s.step, answered: s.answered, total: s.total }
      }
      return NextResponse.json({ forms })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
