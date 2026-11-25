import { NextResponse } from 'next/server'
import { authzErrorResponse, requireSignedIn } from '../../../lib/authz'
import { deleteUpsell, patchUpsell, requireUpsells } from '../../../lib/upsells'

/**
 * One upsell. PATCH { expect_rev, …fields, stage?, paid?, months_paid? } — the row's own person or a super admin
 * changes it; only a super admin sends `paid` / `months_paid`. A stale `expect_rev` is 409 with the row as it stands.
 * DELETE — a super admin, or the row's own person before it is won.
 */
export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSignedIn()
    await requireUpsells(user)
    const { id } = await params
    const res = await patchUpsell(user, id, await req.json().catch(() => ({})))
    if (!res.ok) return NextResponse.json({ error: res.reason, ...(res.fresh ? { row: res.fresh } : {}) }, { status: res.status })
    return NextResponse.json({ row: res.value })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSignedIn()
    await requireUpsells(user)
    const { id } = await params
    const res = await deleteUpsell(user, id)
    if (!res.ok) return NextResponse.json({ error: res.reason }, { status: res.status })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
