import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { driveConfigured, driveConsentUrl, NOT_CONFIGURED } from '../../../lib/gdrive'

/**
 * Start the "connect Google Drive" consent flow.
 *
 * super_admin only, and deliberately stricter than the calendar connect:
 * there is exactly ONE Drive connection for the whole agency, so connecting
 * is not "add my account" but "decide where every client's files live".
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const user = await requireRole('super_admin')
    if (!driveConfigured()) {
      return NextResponse.json(
        { error: `${NOT_CONFIGURED} — the Internal Google app credentials and CREDENTIALS_KEY are required.` },
        { status: 503 },
      )
    }
    return NextResponse.redirect(driveConsentUrl(req, encodeURIComponent(user.email)))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
