import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { buildRootPlan } from '../../../../lib/gdrive-root'

/**
 * What is already in the Clients folder, lined up against the client list.
 *
 * GET reads and never creates. POST does exactly one thing more: makes the
 * "Clients" folder, and only because a person answered the question GET asked
 * them ("there is no Clients folder in there — make one?").
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
    const body = await req.json().catch(() => ({})) as { create_clients_folder?: boolean }
    const result = await buildRootPlan({ createClientsFolder: Boolean(body.create_clients_folder) })
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 400 })
    return NextResponse.json(result.plan)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
