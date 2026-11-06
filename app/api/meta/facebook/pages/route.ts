import { NextRequest, NextResponse } from 'next/server'
import { AuthzError, authzErrorResponse, requireRole } from '@/app/lib/authz'
import { table } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { MetaFbError, disconnectPage, listClientPages, metaFbReady, pickPage, subscribePageWebhooks } from '@/app/lib/meta-fb'
import { isGraphId } from '@/app/lib/meta-fb-core'
import { accessibleClientIds } from '@/app/lib/production-access'

async function assertMine(user: Parameters<typeof accessibleClientIds>[0], clientId: string) {
  const ids = await accessibleClientIds(user)
  if (ids !== null && !ids.includes(clientId)) throw new AuthzError('That client is not one of yours', 403)
}

/**
 * /api/meta/facebook/pages (6 Nov 2026)
 *
 * GET ?clientId=  the client's Pages (picked + candidates, never a token) and its switch `facebook_via_meta`.
 *                 Account manager on their own client (the Meta reviewer is a 100M-only manager), super admin any.
 * POST { clientId, action: 'pick' | 'disconnect' | 'subscribe', pageId }   super admins only
 * PATCH { clientId, viaMeta }  the switch "Post this client's Facebook through Meta" — super admins only
 */
export const dynamic = 'force-dynamic'

const fail = (e: unknown) => {
  if (e instanceof MetaFbError) return NextResponse.json({ error: e.detail?.userMessage ?? e.message }, { status: 502 })
  const { error, status } = authzErrorResponse(e)
  return NextResponse.json({ error }, { status })
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId')?.trim()
  if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
  try {
    const me = await requireRole('account_manager')
    await assertMine(me, clientId)
  } catch (e) { return fail(e) }
  const ready = metaFbReady()
  const [pages, client] = await Promise.all([
    listClientPages(clientId),
    table<Client>('clients').get(clientId, { fresh: true }).catch(() => null),
  ])
  return NextResponse.json({
    configured: ready.ok, reason: ready.ok ? null : ready.reason, pages,
    viaMeta: (client as { facebook_via_meta?: unknown } | null)?.facebook_via_meta === true,
  })
}

export async function POST(req: NextRequest) {
  try { await requireRole('super_admin') } catch (e) { return fail(e) }
  const body = await req.json().catch(() => null) as { clientId?: unknown; action?: unknown; pageId?: unknown } | null
  const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
  const pageId = typeof body?.pageId === 'string' ? body.pageId.trim() : ''
  if (!clientId || !isGraphId(pageId)) return NextResponse.json({ error: 'clientId and pageId are required' }, { status: 400 })
  try {
    if (body?.action === 'pick') {
      const ready = metaFbReady()
      if (!ready.ok) return NextResponse.json({ error: ready.reason }, { status: 503 })
      return NextResponse.json({ ok: true, page: await pickPage(clientId, pageId) })
    }
    if (body?.action === 'disconnect') {
      const done = await disconnectPage(clientId, pageId)
      if (!done) return NextResponse.json({ error: 'That Page is not connected to this client' }, { status: 404 })
      // no Page left: the switch goes off with it, so nothing is booked onto a road with no Page
      const left = await listClientPages(clientId)
      if (!left.some(p => p.active)) await table<Client>('clients').update(clientId, { facebook_via_meta: false } as Partial<Client>)
      return NextResponse.json({ ok: true })
    }
    if (body?.action === 'subscribe') return NextResponse.json({ ok: (await subscribePageWebhooks(pageId)).success })
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) { return fail(e) }
}

export async function PATCH(req: NextRequest) {
  try { await requireRole('super_admin') } catch (e) { return fail(e) }
  const body = await req.json().catch(() => null) as { clientId?: unknown; viaMeta?: unknown } | null
  const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
  if (!clientId || typeof body?.viaMeta !== 'boolean') {
    return NextResponse.json({ error: 'clientId and viaMeta (true or false) are required' }, { status: 400 })
  }
  const client = await table<Client>('clients').get(clientId, { fresh: true }).catch(() => null)
  if (!client) return NextResponse.json({ error: 'No such client' }, { status: 404 })
  if (body.viaMeta && !(await listClientPages(clientId)).some(p => p.active)) {
    return NextResponse.json({ error: 'Connect and pick the Facebook Page first' }, { status: 409 })
  }
  await table<Client>('clients').update(clientId, { facebook_via_meta: body.viaMeta } as Partial<Client>)
  return NextResponse.json({ ok: true, viaMeta: body.viaMeta })
}
