import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { AuthzError, authzErrorResponse, requireRole } from '@/app/lib/authz'
import { accessibleClientIds } from '@/app/lib/production-access'
import { isMonthKey, mayOpenReports } from '@/app/lib/client-report-core'
import { readReportV2 } from '@/app/lib/report-v2/read'
import { shareBlockers } from '@/app/lib/report-v2/checks'

/**
 * THE REPORT PREVIEW (the owner, 5 Nov 2026: see the new figures and layout before anything replaces Reports).
 *   GET                         the clients this person may report on
 *   GET ?client_id&month        the month's figures read LIVE from Zernio, every one with its state, and the checks.
 * READ ONLY: nothing is saved, nothing is shared. Super admins, and account managers for their own clients.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('account_manager')
      if (!mayOpenReports(user.role)) throw new AuthzError('Reports are for super admins and account managers', 403)
      const ids = await accessibleClientIds(user)
      const q = new URL(req.url).searchParams
      const clientId = q.get('client_id') ?? ''
      if (!clientId) {
        const clients = (await table<Client>('clients').list({ where: c => (ids === null || ids.includes(c.id)) && String(c.status ?? '') !== 'archived' }))
          .map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name))
        return NextResponse.json({ clients })
      }
      const month = q.get('month') ?? ''
      if (!isMonthKey(month)) throw new AuthzError('Pick a month', 400)
      if (ids !== null && !ids.includes(clientId)) throw new AuthzError('That client is not one of yours', 403)
      const report = await readReportV2(clientId, month)
      return NextResponse.json({ report, blockers: shareBlockers(report.checks) })
    } catch (e) {
      if (e instanceof AuthzError) { const r = authzErrorResponse(e); return NextResponse.json({ error: r.error }, { status: r.status }) }
      console.error('[reports/preview]', e)
      return NextResponse.json({ error: e instanceof Error ? e.message : 'The figures could not be read' }, { status: 500 })
    }
  })
}
