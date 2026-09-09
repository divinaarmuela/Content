import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { table } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { notify, renderEmail, escapeHtml } from '../../../../lib/mailer'
import { clientPortalUsers } from '../../../../lib/social-connect'
import { assertClientAccess } from '../../../../lib/social-schedule'
import { connectLinkPath, isConnectable, parseNetworks } from '../../../../lib/connect-link-core'
import { platformLabel } from '../../../../lib/posting-card-core'

/**
 * Email the client the link that connects — or reconnects — their own accounts.
 *
 * The agency does not have the client's Instagram password and should not
 * want it, so "connect their account for them" is not a thing that can
 * happen. What can happen is this: whoever is blocked by the missing
 * connection sends the client ONE link, the client presses Connect on it,
 * and the account is connected.
 *
 * THE LINK IS THE PERMANENT ONE (9 Sep 2026). This used to email the
 * provider's own sign-in URL, which expires within the hour — "if the button
 * has expired by the time you press it, reply and we'll send a fresh one" —
 * so a client who opened the email after lunch had a dead button. It now
 * emails /connect/<token>, the client's own page, which never expires,
 * shows every network the manager ticked, and is the same link they use
 * months later when a connection runs out (the owner: "what if the
 * connection is getting lost … we gave the client the link").
 *
 * Who receives it: the client's portal logins, and the client's contact
 * email on their record — whichever exist, no duplicates. Nobody at all is
 * said in words rather than a link going nowhere.
 *
 * Gated at the team floor: the scheduler is the person the missing
 * connection is blocking, and making them ask a manager to send an email is
 * the friction this removes. The client check is the same one every
 * Schedule route makes.
 */
export async function POST(req: Request) {
  try {
    const user = await requireRole('scheduler')
    const body = await req.json().catch(() => ({})) as {
      clientId?: unknown; platform?: unknown; networks?: unknown; reason?: unknown
    }
    const clientId = typeof body.clientId === 'string' ? body.clientId : ''
    if (!clientId) return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
    await assertClientAccess(user, clientId)

    const client = await table<Client>('clients').get(clientId)
    if (!client) return NextResponse.json({ error: 'That client no longer exists' }, { status: 404 })

    // the networks on the link: the ticks, or the one network this is about
    const networks = typeof body.networks === 'string' && body.networks.trim()
      ? parseNetworks(body.networks)
      : isConnectable(body.platform) ? [body.platform] : parseNetworks(null)
    const reconnect = body.reason === 'reconnect'
    const about = isConnectable(body.platform) ? platformLabel(body.platform) : null

    // who would actually receive it — asked BEFORE anything is minted, so a
    // client with nobody to email is told that instead
    const portal = await clientPortalUsers(clientId)
    const contact = client.email?.trim().toLowerCase() ?? ''
    const people: { id: string | null; name: string; email: string }[] = [
      ...portal.map(p => ({ id: p.id, name: p.name, email: p.email })),
      ...(contact && !portal.some(p => p.email.toLowerCase() === contact)
        ? [{ id: null, name: client.contact_name || client.name, email: contact }]
        : []),
    ]
    if (people.length === 0) {
      return NextResponse.json({
        error: 'This client has no email on record and nobody on their portal — add a contact email on the client, or copy the link and send it yourself.',
      }, { status: 400 })
    }

    // the token IS the link; a client made before tokens existed gets one now
    let token = client.share_token
    if (!token) {
      token = randomUUID()
      await table('clients').update(clientId, { share_token: token })
    }
    const base = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
    const link = `${base}${connectLinkPath(token, networks)}`

    const labels = networks.map(platformLabel)
    const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
    const subject = reconnect && about
      ? `Please reconnect your ${about} account`
      : `Connect your ${list} ${labels.length === 1 ? 'account' : 'accounts'}`

    let sent = 0
    for (const person of people) {
      const result = await notify({
        actorName: user.name,
        actorEmail: user.email,
        actorClerkId: user.clerk_user_id,
        eventType: reconnect ? 'social_reconnect_ask' : 'social_connect_invite',
        entityType: 'client',
        // a second ask is a REMINDER somebody chose to send — the timestamp
        // keeps the dedupe from swallowing it
        entityId: `${clientId}#${networks.join('+')}#${Date.now()}`,
        recipientId: person.id,
        recipientEmail: person.email,
        toClient: true,
        subject,
        bodyHtml: renderEmail(
          subject,
          `<p>Hi ${escapeHtml(person.name)},</p>` +
          (reconnect && about
            ? `<p>Your ${escapeHtml(about)} account&rsquo;s connection to our scheduler has run out — this happens when a password changes, or once a year on some networks. Nothing is posted until it is reconnected.</p>` +
              `<p>The button below opens your connect page. Press <strong>Reconnect</strong> next to ${escapeHtml(about)} and sign in there, as you did the first time. You sign in on ${escapeHtml(about)}&rsquo;s own screen — we never see your password.</p>`
            : `<p>So we can post your content for you, we need your ${escapeHtml(list)} ${labels.length === 1 ? 'account' : 'accounts'} connected to our scheduler.</p>` +
              `<p>The button below opens your connect page. Press <strong>Connect</strong> next to each network and sign in there — on the network&rsquo;s own screen, not ours. We never see your password, and you can disconnect at any time.</p>`) +
          `<p style="color:#71717a;font-size:12px;">Keep this link — it is yours, it does not expire, and it is the same page to use if a connection ever needs renewing.</p>`,
          reconnect ? `Reconnect ${about ?? ''}`.trim() : 'Open my connect page',
          link,
        ),
      })
      if (result === 'sent') sent++
    }

    return NextResponse.json({
      sent,
      link,
      recipients: people.map(p => ({ name: p.name, email: p.email })),
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
