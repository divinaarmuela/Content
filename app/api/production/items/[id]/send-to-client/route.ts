import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, ClientContact, ContentItem, TeamUser } from '@/lib/db-types'
import { AuthzError, authzErrorResponse, requireRole } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { notify, renderEmail, escapeHtml } from '../../../../../lib/mailer'
import { DASHBOARD_URL } from '../../../../../lib/app-url'
import { parsePostActRequest, refusalStatus } from '../../../../../lib/post-act-contract'
import { actOnPost, clientRecipients, loadPostState, pickRecipients } from '../../../../../lib/post-stage'

/**
 * SEND TO CLIENT — two different things, kept apart (the posting rebuild, 29 Sep 2026).
 *
 *   THE EDIT (the card at With client, `client_review`): the client is emailed a link to the CARD on
 *   their portal, to approve the edit. Unchanged, and still sent only by a person pressing Send.
 *
 *   A POST: this route is only a door onto the one writer. `{ post_id, expect_rev, version, emails }`
 *   becomes the post's own move — "Passed — send to client" from the quality check (T4), or "Send to
 *   client" from Ready to post (T2b) — through app/lib/post-stage.ts, which freezes the version, emails
 *   it, and moves the post only once something reached the client (audit P9, V9, V10, W10). The new
 *   pages call `POST /api/posts/<id>/act` directly; this door is kept until nothing calls it, then goes.
 *
 * GET  → who this client can be sent to, for the person to tick.
 * POST → the send. Only an account manager or a super admin; only addresses on the client's own list.
 */
export const dynamic = 'force-dynamic'

/** The edit's review page on the portal — the card, not a post. */
function cardApprovalLink(base: string, shareToken: string, itemId: string): string {
  return `${base.replace(/\/+$/, '')}/portal/${encodeURIComponent(shareToken)}/approve/${encodeURIComponent(itemId)}`
}

/** One send per card, per address, per press — the stamp is the press. */
const sendKey = (itemId: string, email: string, stamp: string) => `${itemId}#post-to-client#${email}#${stamp}`

/** What the person who pressed Send is told, from what actually happened to each address. */
function sendOutcomeWords(results: readonly { email: string; result: string }[]): string {
  const sent = results.filter(r => r.result === 'sent' || r.result === 'duplicate').map(r => r.email)
  const failed = results.filter(r => r.result !== 'sent' && r.result !== 'duplicate').map(r => r.email)
  if (sent.length === 0) return `Nothing was sent — ${failed.join(', ')} could not be emailed. Try again, or send them the link yourself.`
  return `Emailed ${sent.join(', ')} the link to view and approve it.`
    + (failed.length ? ` Could not email ${failed.join(', ')} — send them the link yourself.` : '')
}

/**
 * WHO THE CLIENT HEARS FROM (the owner, 28 Sep 2026: "it should be from Divina"). CLIENT_EMAIL_SENDER_ID
 * overrides; an inactive sender falls back to whoever pressed Send.
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
        // the edit is sendable at With client; a post is sent from its own window
        sendable: item.status === 'client_review',
        stage: item.status === 'client_review' ? 'card' : null,
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
      const body = await req.json().catch(() => ({})) as {
        emails?: unknown; note?: unknown; test?: unknown; copy?: unknown
        post_id?: unknown; expect_rev?: unknown; version?: unknown
      }

      // ── A POST: the one writer does it ──
      if (typeof body.post_id === 'string' && body.post_id) {
        const { post } = await loadPostState(body.post_id)
        if (!post || post.source_item_id !== item.id) return NextResponse.json({ error: 'That post is not on this card' }, { status: 404 })
        const action = post.stage === 'quality_check' ? 'pass_send_client' : post.stage === 'ready' ? 'send_to_client' : null
        if (!action) {
          return NextResponse.json({ error: 'A post goes to the client from its quality check, or once it has passed — open it on Post approval.' }, { status: 409 })
        }
        const parsed = parsePostActRequest({
          action, expect_rev: body.expect_rev, version: body.version,
          note: typeof body.note === 'string' ? body.note : undefined,
          send_to: Array.isArray(body.emails) ? body.emails : [],
          via: body.copy === true ? 'link' : 'email',
        })
        if (!parsed.ok) return NextResponse.json({ error: parsed.reason }, { status: 400 })
        const result = await actOnPost(user, post.id, parsed.request)
        if (!result.ok) return NextResponse.json({ error: result.reason, code: result.code, post: result.post }, { status: refusalStatus(result.code) })
        return NextResponse.json({ post: result.post, words: result.words, link: result.link ?? null, message: result.words })
      }

      // ── THE EDIT (the card at With client) ──
      if (item.status !== 'client_review') {
        return NextResponse.json({ error: 'The card can be sent to the client once it is With client. A post is sent from its own window.' }, { status: 409 })
      }
      if (!client.share_token) {
        return NextResponse.json({ error: 'This client has no portal link yet — make one on the client first' }, { status: 409 })
      }
      const note = String(body.note ?? '').trim().slice(0, 1000)
      // SEND ME A TEST FIRST (the owner, 28 Sep 2026): the email the client would get, to the person
      // pressing it — nothing on the card moves. Its button opens the CARD on the dashboard (behind the
      // team sign-in), never the client's Approve page: that page has no preview any more (audit P4), and
      // a test link to it would let the team member approve for the client by mistake (review fix)
      const test = body.test === true
      // COPY THE LINK (the owner, 28 Sep 2026): no email — the link is theirs to send by hand
      if (body.copy === true) {
        const link = cardApprovalLink(DASHBOARD_URL, client.share_token, item.id)
        await table<ContentItem>('content_items').update(item.id, { client_sent: { at: new Date().toISOString(), to: [], stage: 'card', via: 'link', for_time: null } } as never).catch(() => undefined)
        await logActivity({ actor: user, clientId: item.client_id, entityType: 'content_item', entityId: item.id, action: 'sent_to_client', detail: 'Copied the approval link to send by hand' }).catch(() => undefined)
        return NextResponse.json({ link, message: 'Link ready — paste it to the client. It opens this card for them to approve.' })
      }
      const picked = test ? { ok: true as const, emails: [String(user.email).toLowerCase()] } : pickRecipients(body.emails, recipients)
      if (!picked.ok) return NextResponse.json({ error: picked.error }, { status: 400 })
      const link = test
        ? `${DASHBOARD_URL.replace(/\/+$/, '')}/dashboard/production/${encodeURIComponent(item.id)}`
        : cardApprovalLink(DASHBOARD_URL, client.share_token, item.id)
      const title = String(item.title ?? 'Your work')
      const sender = await clientFacingSender(user)
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
          subject: (test ? `[Test — what ${client.name} gets] ` : '') + `Ready for your approval: ${title}`,
          bodyHtml: renderEmail(
            `Ready for your approval: ${escapeHtml(title)}`,
            (test ? `<p style="background:#fef3c7;padding:8px 12px;border-radius:6px;"><em>A test copy for you — the words ${escapeHtml(client.name)} receives. Its button opens the card on the dashboard, not the client's page, so nothing is approved from this email.</em></p>` : '') +
            `<p>Hi ${escapeHtml(hello)},</p>` +
            `<p>${escapeHtml(sender.name)} has sent you <strong>${escapeHtml(title)}</strong> to look over.</p>` +
            (note ? `<p style="border-left:3px solid #e4e4e7;padding-left:12px;">${escapeHtml(note)}</p>` : '') +
            `<p>Open it to see it, then press <strong>Approve</strong> — or <strong>Ask for a change</strong> and tell us what to change.</p>`,
            'View and approve',
            link,
          ),
        }).catch(() => 'failed' as const)
        results.push({ email, result })
      }

      const delivered = results.filter(r => r.result === 'sent' || r.result === 'duplicate').map(r => r.email)
      // stamped on the card only for a real send that reached someone
      if (!test && delivered.length > 0) {
        await table<ContentItem>('content_items').update(item.id, { client_sent: { at: stamp, to: delivered, stage: 'card', for_time: null } } as never).catch(() => undefined)
      }
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
