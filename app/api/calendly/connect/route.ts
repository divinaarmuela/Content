import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { connectCalendly } from '@/app/lib/calendly'

/** super_admin: point Calendly's booking + cancellation webhook at this app (9 Nov 2026). Pressing it again is safe. */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    await requireRole('super_admin')
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  try {
    return NextResponse.json(await connectCalendly(new URL(req.url).origin))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Calendly refused' }, { status: 502 })
  }
}
