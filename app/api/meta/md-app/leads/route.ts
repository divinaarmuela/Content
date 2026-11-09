import { NextRequest, NextResponse } from 'next/server'
import { AuthzError, authzErrorResponse, requireRole } from '@/app/lib/authz'
import { MdAppError } from '@/app/lib/md-app'
import { formLeads, leadForms, liveStatus, setLive } from '@/app/lib/md-app-leads'
import { isGraphId } from '@/app/lib/md-app-inbox-core'
import { accessibleClientIds } from '@/app/lib/production-access'

/**
 * /api/meta/md-app/leads?clientId= (9 Nov 2026) — the Meta card's Leads tab and Live updates. Account manager+ on THEIR client.
 * GET  &view=forms | &view=leads&formId= | &view=live
 * POST { action: 'live', on: true|false }
 */
export const dynamic = 'force-dynamic'

async function gate(clientId: string) {
  const me = await requireRole('account_manager')
  const ids = await accessibleClientIds(me)
  if (ids !== null && !ids.includes(clientId)) throw new AuthzError('That client is not one of yours', 403)
}
const fail = (e: unknown) => {
  if (e instanceof MdAppError) return NextResponse.json({ error: e.detail?.userMessage ?? e.message }, { status: e.status === 409 ? 409 : 502 })
  if (e instanceof Error && !(e instanceof AuthzError)) return NextResponse.json({ error: e.message }, { status: 409 })
  const { error, status } = authzErrorResponse(e)
  return NextResponse.json({ error }, { status })
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const clientId = q.get('clientId')?.trim()
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  try {
    await gate(clientId)
    const view = q.get('view')
    if (view === 'forms') return NextResponse.json({ forms: await leadForms(clientId) })
    if (view === 'live') return NextResponse.json(await liveStatus(clientId))
    if (view === 'leads') {
      const formId = q.get('formId')
      if (!isGraphId(formId)) return NextResponse.json({ error: 'formId is required' }, { status: 400 })
      return NextResponse.json({ leads: await formLeads(clientId, formId) })
    }
    return NextResponse.json({ error: 'Unknown view' }, { status: 400 })
  } catch (e) { return fail(e) }
}

export async function POST(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId')?.trim()
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  try {
    await gate(clientId)
    if (body?.action !== 'live' || typeof body.on !== 'boolean') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    return NextResponse.json(await setLive(clientId, body.on))
  } catch (e) { return fail(e) }
}
