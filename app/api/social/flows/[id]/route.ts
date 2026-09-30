import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse, roleSatisfies } from '@/app/lib/authz'
import { readFlow, updateFlow } from '@/app/lib/flows'

type Ctx = { params: Promise<{ id: string }> }

/** One flow, read from Zernio, with its problems and its plain-English summary. */
export async function GET(_req: Request, { params }: Ctx) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const got = await readFlow(user, decodeURIComponent(id))
      if (!got.ok) return NextResponse.json({ error: got.error }, { status: got.status })
      return NextResponse.json({ ...got.view, can_manage: roleSatisfies(user.role, 'account_manager') })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

/** Save a draft or paused flow's name and graph. Never its status — see app/lib/flows.ts. */
export async function PATCH(req: Request, { params }: Ctx) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('account_manager')
      const { id } = await params
      const body = await req.json().catch(() => null)
      const done = await updateFlow(user, decodeURIComponent(id), body)
      if (!done.ok) return NextResponse.json({ error: done.error, issues: done.issues ?? [] }, { status: done.status })
      return NextResponse.json({ id: done.id, status: done.status })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
