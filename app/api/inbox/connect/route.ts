import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { inboxConsentUrl, inboxConnectConfigured } from '../../../lib/inbox-connect'
import { getScanSettings } from '../../../lib/scan-settings'

/**
 * Start the "connect my inbox" consent flow.
 *
 * Gated at editor: anyone on the team may connect their OWN mailbox, and
 * Google decides whose mailbox it is — the consent screen authenticates the
 * mailbox owner, so this cannot be used to connect somebody else's.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await requireRole('editor')

    if (!inboxConnectConfigured()) {
      return NextResponse.json(
        { error: 'Inbox connection is not configured — GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and CREDENTIALS_KEY are required.' },
        { status: 503 },
      )
    }

    const settings = await getScanSettings()
    if (!settings.allow_self_connect) {
      return NextResponse.json(
        { error: 'Connecting inboxes is switched off in scanner settings.' },
        { status: 403 },
      )
    }

    // state carries who started it, so the callback can record who connected
    // without trusting anything the browser sends back
    return NextResponse.redirect(inboxConsentUrl(encodeURIComponent(user.email)))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
