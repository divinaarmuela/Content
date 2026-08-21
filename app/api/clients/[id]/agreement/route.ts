import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { accessibleClientIds } from '../../../../lib/production-access'
import { logActivity } from '../../../../lib/workflow'
import {
  normaliseDeliverableLines, normaliseServices, RETAINED_SERVICE_CATALOG,
} from '../../../../lib/agreement-core'

/**
 * The client's standing deal: monthly deliverable quantities and retained
 * services. Read by everyone producing for the client (schedulers write
 * captions against it too); written by account managers.
 */

async function assertClientAccess(user: Awaited<ReturnType<typeof requireRole>>, clientId: string) {
  const ids = await accessibleClientIds(user)
  if (ids !== null && !ids.includes(clientId)) {
    return NextResponse.json({ error: 'You are not assigned to this client' }, { status: 403 })
  }
  return null
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const denied = await assertClientAccess(user, id)
    if (denied) return denied

    const { data } = await supabase
      .from('client_agreements')
      .select('deliverable_lines, services, notes, updated_at, updated_by')
      .eq('client_id', id)
      .maybeSingle()

    return NextResponse.json({ agreement: data ?? null, catalog: RETAINED_SERVICE_CATALOG })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('account_manager')
    const { id } = await params
    const denied = await assertClientAccess(user, id)
    if (denied) return denied

    const body = await req.json()
    const lines = normaliseDeliverableLines(body.deliverable_lines)
    if ('error' in lines) return NextResponse.json({ error: lines.error }, { status: 422 })
    const services = normaliseServices(body.services)
    if ('error' in services) return NextResponse.json({ error: services.error }, { status: 422 })

    const { data, error } = await supabase
      .from('client_agreements')
      .upsert({
        client_id: id,
        deliverable_lines: lines.lines,
        services: services.services,
        notes: String(body.notes ?? '').slice(0, 4000) || null,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'client_id' })
      .select()
      .single()
    if (error) throw new Error(error.message)

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
}
