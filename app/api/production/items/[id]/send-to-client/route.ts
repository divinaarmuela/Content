import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, ClientContact, ContentItem } from '@/lib/db-types'
import { AuthzError, authzErrorResponse, requireRole } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { notify, renderEmail, escapeHtml } from '../../../../../lib/mailer'
import { DASHBOARD_URL } from '../../../../../lib/app-url'
import {
  SENDABLE_STATUS, clientRecipients, itemApprovalLink, pickRecipients, sendKey, sendOutcomeWords,
} from '../../../../../lib/post-to-client-core'

/**
 * SEND TO CLIENT (the owner, 28 Sep 2026: "at With client it should be sent to the client — confirming the emails
 * that will receive it; an AM or super admin can do it; once approved it goes Ready to post, from the client, or we
 * can log it ourselves").
 *
 * GET  → who this client can be sent to (the client's own address, then its people), for the person to confirm.
 * POST { emails, note? } → emails each chosen address a link to this card on the client's portal, where they see
 *      the post and press Approve or Ask for a change. The card must be With client; only an account manager or a
 *      super admin may send; only addresses on the client's own list are accepted. Nothing moves on its own: the
 *      client's Approve (or "Log the client's approval") is what takes it to Ready to post.
 */
export const dynamic = 'force-dynamic'

async function context(id: string) {
  const user = await requireRole('account_manager')
  const item = await loadItemForUser(user, id) as ContentItem
  const [client, contacts] = await Promise.all([
    table<Client>('clients').get(item.client_id),
    table<ClientContact>('client_contacts').list({ by: { client_id: item.client_id } }).catch(() => [] as ClientContact[]),
  ])
  if (!client) throw new AuthzError('This card has no client', 404)
  return { user, item, client, recipients: clientRecipients(client, contacts) }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const { id } = await params
      const { item, client, recipients } = await context(id)
      return NextResponse.json({
        recipients,
        client_name: client.name,
        sendable: item.status === SENDABLE_STATUS,
        has_portal: !!client.share_token,
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
      const { id } = await params
      const { user, item, client, recipients } = await context(id)
      if (item.status !== SENDABLE_STATUS) {
        return NextResponse.json({ error: 'This can be sent to the client once it is With client — pass the quality check first' }, { status: 409 })
      }
      if (!client.share_token) {
        return NextResponse.json({ error: 'This client has no portal link yet — make one on the client first' }, { status: 409 })
      }
      const body = await req.json().catch(() => ({})) as { emails?: unknown; note?: unknown }
      const picked = pickRecipients(body.emails, recipients)
      if (!picked.ok) return NextResponse.json({ error: picked.error }, { status: 400 })
      const note = String(body.note ?? '').trim().slice(0, 1000)
      const link = itemApprovalLink(DASHBOARD_URL, client.share_token, item.id)
      const title = String(item.title ?? 'Your post')
      const caption = String((item as { caption?: string | null }).caption ?? '').trim()
      const from = user.name || user.email
      const stamp = new Date().toISOString()

      const results: { email: string; result: string }[] = []
      for (const email of picked.emails) {
        const who = recipients.find(r => r.email === email)
        const hello = who && who.name !== email ? who.name.split(' ')[0] : client.name
        const result = await notify({
          eventType: 'post_to_client', entityType: 'content_item',
          entityId: sendKey(item.id, email, stamp),
          recipientEmail: email, toClient: true, deliberateClientSend: true,
          actorName: user.name, actorEmail: user.email,
          subject: `Ready for your approval: ${title}`,
          bodyHtml: renderEmail(
            `Ready for your approval: ${escapeHtml(title)}`,
            `<p>Hi ${escapeHtml(hello)},</p>` +
            `<p>${escapeHtml(from)} has sent you <strong>${escapeHtml(title)}</strong> to look over before it goes out.</p>` +
            (note ? `<p style="border-left:3px solid #e4e4e7;padding-left:12px;">${escapeHtml(note)}</p>` : '') +
            (caption ? `<p><strong>Caption:</strong><br>${escapeHtml(caption).replace(/\n/g, '<br>')}</p>` : '') +
            `<p>Open it to see the post, then press <strong>Approve</strong> — or <strong>Ask for a change</strong> and tell us what to change.</p>`,
            'View and approve',
            link,
          ),
        }).catch(() => 'failed' as const)
        results.push({ email, result })
      }

      const delivered = results.filter(r => r.result === 'sent' || r.result === 'duplicate').map(r => r.email)
      await logActivity({
        actor: user, clientId: item.client_id, entityType: 'content_item', entityId: item.id,
        action: 'sent_to_client',
        detail: delivered.length ? `Emailed ${delivered.join(', ')}${note ? ` — “${note}”` : ''}` : `Could not email ${picked.emails.join(', ')}`,
      }).catch(() => undefined)

      return NextResponse.json({
        sent: delivered, results, link, message: sendOutcomeWords(results),
      }, { status: delivered.length > 0 ? 200 : 502 })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
