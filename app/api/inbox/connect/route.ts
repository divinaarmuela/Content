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

export async function GET(req: Request) {
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
    const res = NextResponse.redirect(inboxConsentUrl(req, encodeURIComponent(user.email), user.email))
    // WHERE TO COME BACK TO (21 Sep 2026): the acquisition page offers this press to people who cannot open
    // the scanner's settings (Joy), so the callback returns them to where they pressed it
    if (new URL(req.url).searchParams.get('from') === 'acquisition') {
      res.cookies.set('inbox_return', 'acquisition', { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 900, path: '/' })
    }
    return res
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
