import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { authzErrorResponse, requireSignedIn } from '../../lib/authz'
import { createUpsell, listUpsells, requireUpsells, upsellClients, upsellPeople } from '../../lib/upsells'
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
      const [rows, clients, people] = await Promise.all([listUpsells(), upsellClients(user), upsellPeople()])
      return NextResponse.json({
        rows, clients, people,
        me: { id: user.id, name: user.name, role: user.role, mayMarkPaid: mayMarkPaid({ id: user.id, role: user.role }) },
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
