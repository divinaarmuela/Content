import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { buildRootPlan } from '../../../../lib/gdrive-root'

/**
 * What is already in the Clients folder, lined up against the client list.
 *
 * Both verbs read, and neither creates anything. POST used to make the
 * "Clients" folder when a person said yes; the owner's ruling is that the app
 * makes no folders in their Drive at all, so the question is not asked and the
 * answer is not acted on. The card tells them to make it in Drive instead.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await requireRole('super_admin')
    const result = await buildRootPlan()
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 })
    return NextResponse.json(result.plan)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: Request) {
  try {
    await requireRole('super_admin')
    // kept as a POST so a browser tab deployed against the older build does
    // not 405, and deliberately identical to the GET: there is nothing left
    // for it to create. The app makes no folders in the owner's Drive.
    await req.json().catch(() => ({}))
    const result = await buildRootPlan()
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 })
    return NextResponse.json(result.plan)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
