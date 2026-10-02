import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { assertClientAccess } from '@/app/lib/social-schedule'
import { loadNotify, sendNotify } from '@/app/lib/one-portal-notify'

/**
 * NOTIFY THE CLIENT (app/lib/one-portal-notify.ts) — one email with the link to one page of their one portal.
 *
 * GET  ?tab=&id=  → who can be emailed, and the link (only for a page the client can open now)
 * POST { tab, id, emails, note?, copy? } → sends to the ticked people; `copy` only returns the link
 *
 * An account manager, a scheduler, a general or a super admin — the same people as Send the preview — on a client
 * they may work on. Every email is a deliberate client send to the client's own addresses.
 */
const MAY_SEND = new Set(['account_manager', 'scheduler', 'general', 'super_admin'])

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      if (!MAY_SEND.has(user.role)) return NextResponse.json({ error: 'Notifying the client is for account managers and schedulers' }, { status: 403 })
      const { id } = await params
      await assertClientAccess(user, id)
      const q = new URL(req.url).searchParams
      const page = await loadNotify(id, q.get('tab'), q.get('id'))
      if (!page.ok) return NextResponse.json({ error: page.error }, { status: page.status })
      return NextResponse.json({ client_name: page.client.name, recipients: page.recipients, title: page.title, link: page.link })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      if (!MAY_SEND.has(user.role)) return NextResponse.json({ error: 'Notifying the client is for account managers and schedulers' }, { status: 403 })
      const { id } = await params
      await assertClientAccess(user, id)
      const body = await req.json().catch(() => ({})) as { tab?: unknown; id?: unknown; emails?: unknown; note?: unknown; copy?: unknown }
      if (body.copy === true) {
        const page = await loadNotify(id, body.tab, body.id)
        if (!page.ok) return NextResponse.json({ error: page.error }, { status: page.status })
        return NextResponse.json({ link: page.link })
      }
      const sent = await sendNotify({ clientId: id, tab: body.tab, id: body.id, emails: body.emails, note: typeof body.note === 'string' ? body.note : null, pressedBy: { id: user.id, name: user.name } })
      if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: sent.status })
      return NextResponse.json(sent)
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
