import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { dropboxConfigured, dropboxConsentUrl, NOT_CONFIGURED } from '../../../lib/dropbox'

/**
 * Start the "connect Dropbox" consent flow.
 *
 * super_admin only, and deliberately stricter than the calendar connect:
 * there is exactly ONE Dropbox connection for the whole agency, so connecting
 * is not "add my account" but "decide where every client's files live".
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const user = await requireRole('super_admin')
    if (!dropboxConfigured()) {
      return NextResponse.json(
        { error: `${NOT_CONFIGURED} — DROPBOX_APP_KEY and DROPBOX_APP_SECRET are required.` },
        { status: 503 },
      )
    }
    return NextResponse.redirect(dropboxConsentUrl(req, encodeURIComponent(user.email)))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
