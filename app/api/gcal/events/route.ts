import { NextRequest, NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../lib/authz'
import { listCalendarEvents } from '../../../lib/gcal'

export const dynamic = 'force-dynamic'

/** Events across every enabled calendar for [from, to) — ISO instants. */
export async function GET(req: NextRequest) {
  try {
    await requireRole('editor')
    const from = req.nextUrl.searchParams.get('from')
    const to = req.nextUrl.searchParams.get('to')
    if (!from || !to || isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
      return NextResponse.json({ error: 'Missing or invalid from/to' }, { status: 400 })
    }
    const { events, errors } = await listCalendarEvents(
      new Date(from).toISOString(), new Date(to).toISOString(),
    )
    return NextResponse.json({ events, errors })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
