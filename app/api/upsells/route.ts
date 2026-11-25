import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { authzErrorResponse, requireSignedIn } from '../../lib/authz'
import { createUpsell, listUpsells, requireUpsells, upsellClients, upsellPeople, upsellViewer } from '../../lib/upsells'
import { mayMarkPaid } from '../../lib/upsell-core'

/**
 * THE UPSELL TRACKER (Divina, 25 Nov 2026). GET: every row, the clients this person may log for, and who is on the
 * tracker. POST: log one. Both refuse anyone the page is not opened to (requireUpsells) — super admins, and the
 * people named on the Team page.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  return withRequestCache(async () => {
    try {
      const user = await requireSignedIn()
      await requireUpsells(user)
      const viewer = upsellViewer(user)
      const [rows, clients, everyone] = await Promise.all([listUpsells(user), upsellClients(user), upsellPeople()])
      // who else is on the tracker is the keepers' to know; anybody else is given only themselves
      const people = viewer.seesAll ? everyone : [{ id: user.id, name: user.name }]
      return NextResponse.json({
        rows, clients, people,
        me: { id: user.id, name: user.name, role: user.role, seesAll: viewer.seesAll, mayMarkPaid: mayMarkPaid(viewer) },
      })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function POST(req: Request) {
  try {
    const user = await requireSignedIn()
    await requireUpsells(user)
    const res = await createUpsell(user, await req.json().catch(() => ({})))
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: res.status })
    return NextResponse.json({ row: res.value }, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
