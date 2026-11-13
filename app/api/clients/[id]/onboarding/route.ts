import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, ClientOnboarding } from '@/lib/db-types'
import { authzErrorResponse } from '../../../../lib/authz'
import { logActivity } from '../../../../lib/workflow'
import { normaliseOnboarding } from '../../../../lib/onboarding-email-core'
import { onboardingContext, onboardingGate } from './shared'

/**
 * THE CLIENT'S WELCOME EMAIL, AS A DRAFT (the owner, 13 Nov 2026). An account manager on this client, or a super
 * admin, reads and saves it. NOTHING HERE SENDS (the owner, 13 Nov 2026: "not send from here"): the person copies the email off the page and sends it from their own mailbox.
 */

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const { id } = await params
    const g = await onboardingGate(id)
    if (g.denied) return g.denied
    const client = await table<Client>('clients').get(id)
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    const ctx = await onboardingContext(client, req)
    const row = await table<ClientOnboarding>('client_onboarding').get(id)
    return NextResponse.json({
      draft: row ? normaliseOnboarding(row.draft, ctx.suggested) : ctx.suggested,
      suggested: ctx.suggested,
      saved: !!row,
      updated_at: row?.updated_at ?? null,
      updated_by_name: row?.updated_by_name ?? null,
      portal_url: ctx.portalUrl,
      asset_base: ctx.assetBase,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const { id } = await params
    const g = await onboardingGate(id)
    if (g.denied) return g.denied
    const client = await table<Client>('clients').get(id)
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    const body = await req.json().catch(() => ({}))
    const ctx = await onboardingContext(client, req)
    const draft = normaliseOnboarding(body?.draft, ctx.suggested)
    if (!draft.subject.trim()) return NextResponse.json({ error: 'The email needs a subject' }, { status: 422 })
    const now = new Date().toISOString()
    await table<ClientOnboarding>('client_onboarding').upsert({
      id, client_id: id, draft, updated_by: g.user.id, updated_by_name: g.user.name ?? g.user.email ?? null, updated_at: now,
    })
    await logActivity({ actor: g.user, clientId: id, entityType: 'client_onboarding', entityId: id, action: 'updated', detail: 'Welcome email draft saved' })
    return NextResponse.json({ draft, saved: true, updated_at: now, updated_by_name: g.user.name ?? g.user.email ?? null })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
