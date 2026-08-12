import { NextRequest, NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { listCalendarAccounts, setCalendarEnabled, disconnectCalendar } from '../../../lib/gcal'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireRole('editor')
    return NextResponse.json({ accounts: await listCalendarAccounts() })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Toggle a calendar on/off, or disconnect it entirely. */
export async function PATCH(req: NextRequest) {
  try {
    await requireRole('editor')
    const body = await req.json() as { email?: string; enabled?: boolean; disconnect?: boolean }
    const email = String(body.email ?? '').trim().toLowerCase()
    if (!email) return NextResponse.json({ error: 'Missing email' }, { status: 400 })

    if (body.disconnect) await disconnectCalendar(email)
    else if (typeof body.enabled === 'boolean') await setCalendarEnabled(email, body.enabled)
    else return NextResponse.json({ error: 'Nothing to do' }, { status: 400 })

    return NextResponse.json({ accounts: await listCalendarAccounts() })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
