import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { driveConfigured, driveStatus, pickedRoot } from '../../../lib/gdrive'

/**
 * Which folder the filing cabinet is, as far as the app knows.
 *
 * super_admin, like every other switch on this connection: choosing where a
 * client's files live is one decision for the whole agency, and the reply
 * carries folder ids that only somebody who may change them needs.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireRole('super_admin')
    const status = await driveStatus()
    return NextResponse.json({
      configured: driveConfigured(),
      connected: status.connected,
      account_email: status.account_email,
      picked: await pickedRoot(),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
