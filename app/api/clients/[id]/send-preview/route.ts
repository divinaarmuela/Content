import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, ClientContact, SocialPost } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { assertClientAccess } from '@/app/lib/social-schedule'
import { clientRecipients } from '@/app/lib/client-recipients-core'
import { onePortal, onePortalPath } from '@/app/lib/one-portal-core'
import { readPostState, type PostState } from '@/app/lib/post-stage-core'
import { sendSchedulingPreview, unansweredBooked } from '@/app/lib/one-portal-send'
import { DASHBOARD_URL } from '@/app/lib/app-url'

/**
 * SEND THE PREVIEW (docs/ONE_PORTAL_SPEC.md R12) — the email telling the client to look at their Scheduling tab.
 *
 * GET  → what the dialog shows first: the link, who can be emailed, the booked posts not yet answered.
 * POST { emails: string[], note?: string } → sends, and marks those posts as asked.
 *
 * An account manager, a scheduler, a general or a super admin (decided 2 Oct 2026), on a client they may work
 * on, and only for a client on the one portal. Every email is a deliberate client send to the client's own
 * portal recipients; a test client's reach test addresses only.
 */

const MAY_SEND = new Set(['account_manager', 'scheduler', 'general', 'super_admin'])

async function load(id: string) {
  const [client, contacts, rows] = await Promise.all([
    table<Client>('clients').get(id).catch(() => null),
    table<ClientContact>('client_contacts').list({ by: { client_id: id } }).catch(() => [] as ClientContact[]),
    table<SocialPost>('social_posts').list({ where: r => r.client_id === id && r.stage === 'booked' }),
  ])
  return { client, contacts, posts: rows.map(r => readPostState(r as unknown as Record<string, unknown>)).filter((p): p is PostState => !!p) }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      if (!MAY_SEND.has(user.role)) return NextResponse.json({ error: 'Sending the preview is for account managers and schedulers' }, { status: 403 })
      const { id } = await params
      await assertClientAccess(user, id)
      const { client, contacts, posts } = await load(id)
      if (!client) return NextResponse.json({ error: 'This client was not found' }, { status: 404 })
      if (!onePortal(client)) return NextResponse.json({ error: 'This client is not on the one portal yet' }, { status: 409 })
      const token = typeof client.share_token === 'string' ? client.share_token.trim() : ''
      return NextResponse.json({
        link: token ? `${DASHBOARD_URL}${onePortalPath(token, 'scheduling')}` : null,
        recipients: clientRecipients(client, contacts).map(r => ({ email: r.email, name: r.name })),
        booked: posts.length,
        unanswered: unansweredBooked(posts).map(p => ({ id: p.id, scheduled_for: p.scheduled_for })),
      })
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
      if (!MAY_SEND.has(user.role)) return NextResponse.json({ error: 'Sending the preview is for account managers and schedulers' }, { status: 403 })
      const { id } = await params
      await assertClientAccess(user, id)
      const body = await req.json().catch(() => ({}))
      const note = typeof body.note === 'string' ? body.note.slice(0, 1000) : null
      const result = await sendSchedulingPreview({
        clientId: id, emails: body.emails, note,
        pressedBy: { id: user.id, name: user.name ?? null, email: user.email },
      })
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
      return NextResponse.json(result)
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
