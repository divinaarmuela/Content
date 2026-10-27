import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, ClientReport } from '@/lib/db-types'
import { AuthzError, authzErrorResponse, requireRole, type TeamUser } from '@/app/lib/authz'
import { accessibleClientIds } from '@/app/lib/production-access'
import { isMonthKey, mayDeleteReport, mayOpenReports, reportId, REVIEW_CHECKS, type MonthKey } from '@/app/lib/client-report-core'
import { generateReport, loadReportData } from '@/app/lib/client-report'
import { explainMonth } from '@/app/lib/post-breakdown'
import { logActivity } from '@/app/lib/workflow'

/**
 * THE MONTHLY CLIENT REPORT (client-report-core.ts has the why).
 *
 *   GET    ?client_id&month[&refresh=1]   the clients this person may report on; the month's figures (read from
 *                                         Zernio when there are none yet, or on refresh) and the saved report
 *   POST   { client_id, month, action: 'generate', objective, notes }   the AI writes the report from the figures
 *   POST   { client_id, month, action: 'explain' }   the month's posts scored and explained, UNLK.AI's way
 *   PATCH  { client_id, month, body?, notes?, objective?, checks? }     the team's edits and ticks
 *   DELETE ?client_id&month                                            a super admin removes the saved report
 *
 * WHO: super admins, and account managers for their own clients only. Deleting is a super admin's alone.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function who(): Promise<TeamUser> {
  const user = await requireRole('account_manager')
  if (!mayOpenReports(user.role)) throw new AuthzError('Reports are for super admins and account managers', 403)
  return user
}
async function mayReportOn(user: TeamUser, clientId: string): Promise<void> {
  const ids = await accessibleClientIds(user)
  if (ids !== null && !ids.includes(clientId)) throw new AuthzError('That client is not one of yours', 403)
}
function pick(url: string): { clientId: string; month: MonthKey } {
  const q = new URL(url).searchParams
  const clientId = q.get('client_id') ?? ''
  const month = q.get('month') ?? ''
  if (!clientId || !isMonthKey(month)) throw new AuthzError('Pick a client and a month', 400)
  return { clientId, month }
}

export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await who()
      const ids = await accessibleClientIds(user)
      const clients = (await table<Client>('clients').list({ where: c => (ids === null || ids.includes(c.id)) && String(c.status ?? '') !== 'archived' }))
        .map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name))
      const q = new URL(req.url).searchParams
      if (!q.get('client_id')) return NextResponse.json({ clients, mayDelete: mayDeleteReport(user.role) })
      const { clientId, month } = pick(req.url)
      await mayReportOn(user, clientId)
      let report = await table<ClientReport>('client_reports').get(reportId(clientId, month))
      if (!report?.data || q.get('refresh') === '1') {
        await loadReportData(clientId, month)
        report = await table<ClientReport>('client_reports').get(reportId(clientId, month))
      }
      return NextResponse.json({ clients, mayDelete: mayDeleteReport(user.role), report })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await who()
      const body = await req.json().catch(() => ({})) as { client_id?: string; month?: string; action?: string; objective?: string; notes?: string }
      if (!body.client_id || !isMonthKey(body.month) || (body.action !== 'generate' && body.action !== 'explain')) return NextResponse.json({ error: 'Pick a client and a month' }, { status: 400 })
      await mayReportOn(user, body.client_id)
      if (body.action === 'explain') {
        const x = await explainMonth(body.client_id, body.month)
        const report = await table<ClientReport>('client_reports').get(reportId(body.client_id, body.month))
        if (!x.ok) return NextResponse.json({ error: x.error, report }, { status: 502 })
        await logActivity({ actor: user, clientId: body.client_id, entityType: 'client_report', entityId: reportId(body.client_id, body.month), action: 'report_posts_explained', newValue: body.month }).catch(() => undefined)
        return NextResponse.json({ ok: true, report })
      }
      const r = await generateReport(body.client_id, body.month, user.id, { objective: String(body.objective ?? '').slice(0, 300), notes: String(body.notes ?? '').slice(0, 6000) })
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 })
      await logActivity({ actor: user, clientId: body.client_id, entityType: 'client_report', entityId: reportId(body.client_id, body.month), action: 'report_generated', newValue: body.month }).catch(() => undefined)
      return NextResponse.json({ ok: true, report: await table<ClientReport>('client_reports').get(reportId(body.client_id, body.month)) })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function PATCH(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await who()
      const body = await req.json().catch(() => ({})) as { client_id?: string; month?: string; body?: unknown; notes?: unknown; objective?: unknown; checks?: unknown }
      if (!body.client_id || !isMonthKey(body.month)) return NextResponse.json({ error: 'Pick a client and a month' }, { status: 400 })
      await mayReportOn(user, body.client_id)
      const id = reportId(body.client_id, body.month)
      const now = new Date().toISOString()
      const checks = body.checks && typeof body.checks === 'object'
        ? Object.fromEntries(REVIEW_CHECKS.map(c => [c.key, (body.checks as Record<string, unknown>)[c.key] === true])) : undefined
      const put = await table<ClientReport>('client_reports').claim(id, cur => (cur ? {
        ...cur,
        ...(typeof body.body === 'string' ? { body: body.body.slice(0, 200000) } : {}),
        ...(typeof body.notes === 'string' ? { notes: body.notes.slice(0, 6000) } : {}),
        ...(typeof body.objective === 'string' ? { objective: body.objective.slice(0, 300) } : {}),
        ...(checks ? { checks: checks as never } : {}),
        updated_by: user.id, updated_at: now,
      } : null))
      if (!put.claimed) return NextResponse.json({ error: 'Load the month first' }, { status: 404 })
      return NextResponse.json({ ok: true, report: put.row })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function DELETE(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await who()
      if (!mayDeleteReport(user.role)) throw new AuthzError('Only a super admin can delete a report', 403)
      const { clientId, month } = pick(req.url)
      await table<ClientReport>('client_reports').remove(reportId(clientId, month))
      await logActivity({ actor: user, clientId, entityType: 'client_report', entityId: reportId(clientId, month), action: 'report_deleted', oldValue: month }).catch(() => undefined)
      return NextResponse.json({ ok: true })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
