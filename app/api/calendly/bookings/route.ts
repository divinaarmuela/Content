import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { listBookings } from '@/app/lib/calendly'
import { summariseBookings } from '@/app/lib/bookings-core'

/**
 * account_manager and up: how many calls have been booked through Calendly, all time, by month (the Bookings tab on
 * Leads, 11 Nov 2026). Read only; the Calendly token stays on the server.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireRole('account_manager')
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  try {
    return NextResponse.json(summariseBookings(await listBookings()))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Calendly did not answer' }, { status: 502 })
  }
}
