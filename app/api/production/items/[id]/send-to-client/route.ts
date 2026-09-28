import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, ClientContact, ContentItem, SocialPost, TeamUser } from '@/lib/db-types'
import { AuthzError, authzErrorResponse, requireRole } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { notify, renderEmail, escapeHtml } from '../../../../../lib/mailer'
import { DASHBOARD_URL } from '../../../../../lib/app-url'
import {
  clientRecipients, itemApprovalLink, pickRecipients, sendKey, sendOutcomeWords, sendStage,
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

/**
 * WHO THE CLIENT HEARS FROM (the owner, 28 Sep 2026: "it should be from Divina"). Every client approval email goes out
 * in Divina's name, and a reply reaches her — whoever pressed Send. The four sent at 12:40 pm that day said "Akmal
 * Ashwin" because they were pressed from his login. CLIENT_EMAIL_SENDER_ID overrides; an inactive sender falls back to
 * whoever pressed Send, so a client email never goes out in the name of somebody who has left.
 */
const CLIENT_EMAIL_SENDER_ID = process.env.CLIENT_EMAIL_SENDER_ID || '54926a48-335e-46e9-a080-df8c1ad42ac9'

async function clientFacingSender(fallback: { name?: string | null; email: string }): Promise<{ name: string; email: string }> {
  const u = await table<TeamUser>('team_users').get(CLIENT_EMAIL_SENDER_ID).catch(() => null)
  if (u && u.active_status && u.email) return { name: u.name || u.email, email: u.email }
  return { name: fallback.name || fallback.email, email: fallback.email }
}

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
        sendable: sendStage(item as never) !== null,
        stage: sendStage(item as never),
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
      const stage = sendStage(item as never)
      if (!stage) {
        return NextResponse.json({ error: 'This can be sent to the client once it is With client, or once its post is waiting on approval' }, { status: 409 })
      }
      if (!client.share_token) {
        return NextResponse.json({ error: 'This client has no portal link yet — make one on the client first' }, { status: 409 })
      }
      const body = await req.json().catch(() => ({})) as { emails?: unknown; note?: unknown; test?: unknown }
      const note = String(body.note ?? '').trim().slice(0, 1000)
      // SEND ME A TEST FIRST (the owner, 28 Sep 2026: "send a test link to me, I want to see how you plan to send"): the
      // exact email the client would get, to the person pressing it, with the page in preview — nothing on the post moves
      const test = body.test === true
      const picked = test ? { ok: true as const, emails: [String(user.email).toLowerCase()] } : pickRecipients(body.emails, recipients)
      if (!picked.ok) return NextResponse.json({ error: picked.error }, { status: 400 })
      // THE FINAL POST: marked as the client's to answer, so their page (and the portal's list) offers it to them — the
      // same flag the composer's old "Send to client" set, without which nobody was ever asked (24 Sep 2026)
      if (!test && stage === 'post' && (item as { posting_client_required?: unknown }).posting_client_required !== true) {
        const taken = await table<ContentItem>('content_items').claim(item.id, cur =>
          cur && String((cur as { posting_approval_state?: unknown }).posting_approval_state ?? '') === 'pending'
            ? { ...cur, posting_client_required: true } as ContentItem
            : null)
        if (!taken.claimed) return NextResponse.json({ error: 'Somebody answered this post while you were sending it — refresh to see where it stands' }, { status: 409 })
      }
      const link = itemApprovalLink(DASHBOARD_URL, client.share_token, item.id) + (test ? '?preview=1' : '')
      const title = String(item.title ?? 'Your post')
      // the words the client will be approving: the post's own caption once there is a post
      const posts = stage === 'post'
        ? await table<SocialPost>('social_posts').list({ by: { item_id: item.id } }).catch(() => [] as SocialPost[])
        : []
      const post = posts.filter(p => p.status !== 'cancelled').sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))[0] ?? null
      const caption = String(post?.caption ?? (item as { caption?: string | null }).caption ?? '').trim()
      // a test goes out as it will for real — from the client-facing sender — so what you see is what they get
      const sender = await clientFacingSender(user)
      const from = sender.name
      const stamp = new Date().toISOString()

      const results: { email: string; result: string }[] = []
      for (const email of picked.emails) {
        const who = test ? null : recipients.find(r => r.email === email)
        const hello = who && who.name !== email ? who.name.split(' ')[0] : client.name
        const result = await notify({
          eventType: 'post_to_client', entityType: 'content_item',
          entityId: sendKey(item.id, email, stamp),
          recipientEmail: email, toClient: !test, deliberateClientSend: !test,
          actorName: sender.name, actorEmail: sender.email,
          subject: (test ? `[Test — what ${client.name} gets] ` : '') + (stage === 'post' ? `Your post is ready to approve: ${title}` : `Ready for your approval: ${title}`),
          bodyHtml: renderEmail(
            `Ready for your approval: ${escapeHtml(title)}`,
            (test ? `<p style="background:#fef3c7;padding:8px 12px;border-radius:6px;"><em>A test copy for you — exactly what ${escapeHtml(client.name)} receives. The link opens in preview, so nothing changes on the post.</em></p>` : '') +
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
      if (!test) await logActivity({
        actor: user, clientId: item.client_id, entityType: 'content_item', entityId: item.id,
        action: 'sent_to_client',
        detail: delivered.length ? `Emailed ${delivered.join(', ')}${note ? ` — “${note}”` : ''}` : `Could not email ${picked.emails.join(', ')}`,
      }).catch(() => undefined)

      return NextResponse.json({
        sent: delivered, results, link,
        message: test
          ? (delivered.length ? `Test sent to ${delivered[0]} — open it to see exactly what ${client.name} gets.` : 'The test could not be emailed — try again in a moment')
          : sendOutcomeWords(results),
      }, { status: delivered.length > 0 ? 200 : 502 })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
