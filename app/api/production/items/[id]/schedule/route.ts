import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { upsertScheduleEntry } from '../../../../../lib/schedule'

/** Upsert a platform schedule entry.
 *
 *  The gate is the HAT, not the job title — whoever was handed the scheduling
 *  may write here, which is exactly when the detail page draws the form. The
 *  check and the write both live in upsertScheduleEntry; this stays thin.
 *  'scheduler' as a floor here only keeps client accounts out — the real
 *  decision is per item. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const item = await loadItemForUser(user, id)
    const body = await req.json()
    return NextResponse.json(await upsertScheduleEntry(user, item, body))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
