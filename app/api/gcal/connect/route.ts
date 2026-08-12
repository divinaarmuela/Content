import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { inboxConnectConfigured } from '../../../lib/inbox-connect'
import { calendarConsentUrl } from '../../../lib/gcal'

/**
 * Start the "connect a calendar" consent flow. Gated at editor — Google's
 * consent screen authenticates the calendar owner, so this can only ever
 * connect a calendar its owner signs in to.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const user = await requireRole('editor')
    if (!inboxConnectConfigured()) {
      return NextResponse.json(
        { error: 'Calendar connection is not configured — INBOX_CLIENT_ID, INBOX_CLIENT_SECRET and CREDENTIALS_KEY are required.' },
        { status: 503 },
      )
    }
    return NextResponse.redirect(calendarConsentUrl(req, encodeURIComponent(user.email)))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
