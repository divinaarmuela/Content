import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { flowStats } from '@/app/lib/flows'

type Ctx = { params: Promise<{ id: string }> }

/** A flow's numbers: Zernio's totals, and per-step counts over its latest runs. Read only. */
export async function GET(_req: Request, { params }: Ctx) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const got = await flowStats(user, decodeURIComponent(id))
      if (!got.ok) return NextResponse.json({ error: got.error }, { status: got.status })
      return NextResponse.json(got.stats)
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
