import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ClientAgreement } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { accessibleClientIds, visibleClientIds } from '../../../../lib/production-access'
import { logActivity } from '../../../../lib/workflow'
import {
  normaliseDeliverableLines, normaliseServices, RETAINED_SERVICE_CATALOG,
} from '../../../../lib/agreement-core'

/**
 * The client's standing deal: monthly deliverable quantities and retained
 * services. Read by everyone producing for the client (schedulers write
 * captions against it too); written by account managers.
 */

/** Reading is scoped by `visibleClientIds`: whoever holds a job for this
 *  client is shown the deal it is measured against — the shoot page and the
 *  item page both print the monthly quotas, and an assignee who was refused
 *  them read "You are not assigned to this client" over their own work.
 *  WRITING stays on `accessibleClientIds`: changing the deal is running the
 *  client, and holding one job there is not that. */
async function assertClientAccess(
  user: Awaited<ReturnType<typeof requireRole>>, clientId: string,
  opts: { write?: boolean } = {},
) {
  const ids = opts.write ? await accessibleClientIds(user) : await visibleClientIds(user)
  if (ids !== null && !ids.includes(clientId)) {
    return NextResponse.json({ error: 'You are not assigned to this client' }, { status: 403 })
  }
  return null
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const denied = await assertClientAccess(user, id)
    if (denied) return denied

    const row = (await table<ClientAgreement>('client_agreements')
      .list({ by: { client_id: id }, limit: 1 }))[0] ?? null
    // the columns the old select named — the deal, not the row's own id
    const agreement = row ? {
      deliverable_lines: row.deliverable_lines, services: row.services,
      notes: row.notes, start_date: row.start_date,
      updated_at: row.updated_at, updated_by: row.updated_by,
    } : null

    return NextResponse.json({ agreement, catalog: RETAINED_SERVICE_CATALOG })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('account_manager')
    const { id } = await params
    const denied = await assertClientAccess(user, id, { write: true })
    if (denied) return denied

    const body = await req.json()
    const lines = normaliseDeliverableLines(body.deliverable_lines)
    if ('error' in lines) return NextResponse.json({ error: lines.error }, { status: 422 })
    const services = normaliseServices(body.services)
    if ('error' in services) return NextResponse.json({ error: services.error }, { status: 422 })
    // start date anchors at-risk pacing — a plain date or nothing
    const rawStart = String(body.start_date ?? '').trim()
    if (rawStart && !/^\d{4}-\d{2}-\d{2}$/.test(rawStart)) {
      return NextResponse.json({ error: 'Start date must be a date (YYYY-MM-DD)' }, { status: 422 })
    }

    const data = await table<ClientAgreement>('client_agreements').upsert({
      client_id: id,
      deliverable_lines: lines.lines,
      services: services.services,
      start_date: rawStart || null,
      notes: String(body.notes ?? '').slice(0, 4000) || null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'client_id' })

    await logActivity({
      actor: user, clientId: id,
      entityType: 'client_agreement', entityId: id,
      action: 'updated',
      detail: `${lines.lines.length} deliverable line${lines.lines.length === 1 ? '' : 's'}, ${services.services.filter(s => s.active).length} active services`,
    })
    return NextResponse.json({ agreement: data })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
