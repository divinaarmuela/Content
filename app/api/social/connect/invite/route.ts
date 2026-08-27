import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { notify, renderEmail, escapeHtml } from '../../../../lib/mailer'
import { clientPortalUsers, connectLinkFor } from '../../../../lib/social-connect'
import { platformLabel } from '../../../../lib/posting-card-core'

/**
 * Email the client the link that connects their own account.
 *
 * The agency does not have the client's Instagram password and should not want
 * it, so "connect their account for them" is not a thing that can happen. What
 * can happen is this: the person who has to post the content sends the client
 * one link, the client presses it, and the account is connected — without the
 * scheduler having to chase an account manager who has to chase the client.
 *
 * Gated at the team floor rather than account_manager for that reason: the
 * scheduler is the person the missing connection is blocking, and making them
 * ask somebody else to send an email is the friction this removes. It reveals
 * nothing about the client that they do not already know, and the OAuth screen
 * on the other end is the platform's own.
 */
export async function POST(req: Request) {
  try {
    const user = await requireRole('scheduler')
    const { clientId, platform } = await req.json()

    if (typeof clientId !== 'string' || !clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
    }
    if (typeof platform !== 'string') {
      return NextResponse.json({ error: 'platform is required' }, { status: 400 })
    }

    // who would actually receive it — asked BEFORE minting a link, so a client
    // with nobody in their portal is told that instead of a link going nowhere
    const people = await clientPortalUsers(clientId)
    if (people.length === 0) {
      return NextResponse.json({
        error: 'This client has nobody set up on their portal to email — add a client login first, or use “Connect now”.',
      }, { status: 400 })
    }

    const link = await connectLinkFor(clientId, platform)
    if ('error' in link) {
      return NextResponse.json({ error: link.error }, { status: link.status })
    }

    const label = platformLabel(platform)
    const subject = `Connect your ${label} account`
    let sent = 0
    for (const person of people) {
      const result = await notify({
        actorName: user.name,
        actorEmail: user.email,
        actorClerkId: user.clerk_user_id,
        eventType: 'social_connect_invite',
        entityType: 'client',
        // a second ask for the same platform is a REMINDER somebody chose to
        // send — the timestamp keeps the dedupe from swallowing it
        entityId: `${clientId}#${platform}#${Date.now()}`,
        recipientId: person.id,
        recipientEmail: person.email,
        subject,
        bodyHtml: renderEmail(
          subject,
          `<p>Hi ${escapeHtml(person.name)},</p>` +
          `<p>So we can post your content for you, we need your ${escapeHtml(label)} account connected to our scheduler.</p>` +
          `<p>The button below opens ${escapeHtml(label)}&rsquo;s own login screen. You sign in there, not here — we never see your password, and you can disconnect it at any time.</p>` +
          `<p style="color:#71717a;font-size:12px;">If the button has expired by the time you press it, reply to this email and we&rsquo;ll send a fresh one.</p>`,
          `Connect ${label}`,
          link.authUrl,
        ),
      })
      if (result === 'sent') sent++
    }

    return NextResponse.json({
      sent,
      recipients: people.map(p => ({ name: p.name, email: p.email })),
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
