import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { deleteAutomation, updateAutomation } from '@/app/lib/comment-automation'

type Ctx = { params: Promise<{ id: string }> }

/** On/off, or the DM text and public reply. `id` is our row id, or `z:<zernio id>` for one made elsewhere. */
export async function PATCH(req: Request, { params }: Ctx) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('account_manager')
      const { id } = await params
      const body = await req.json().catch(() => null)
      const done = await updateAutomation(user, decodeURIComponent(id), body)
      if (!done.ok) return NextResponse.json({ error: done.error }, { status: done.status })
      return NextResponse.json({ ok: true })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

/** Delete at Zernio (its history goes with it) and here. The page confirms first. */
export async function DELETE(_req: Request, { params }: Ctx) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('account_manager')
      const { id } = await params
      const done = await deleteAutomation(user, decodeURIComponent(id))
      if (!done.ok) return NextResponse.json({ error: done.error }, { status: done.status })
      return NextResponse.json({ ok: true })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
