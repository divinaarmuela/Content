import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse, roleSatisfies } from '@/app/lib/authz'
import { createFlow, flowSetup, listClientFlows } from '@/app/lib/flows'

/**
 * The flow builder's list and create (app/lib/flows.ts). Schedulers may look;
 * account managers and super admins make and change flows — the same ladder
 * as the comment automations. Nothing here switches a flow on: a create is a
 * Zernio DRAFT, and no route calls /activate.
 *
 *   GET  ?client_id=  → that client's flows, read from Zernio
 *   GET               → the clients and accounts that can hold a flow
 *   POST              → a new flow (draft), once per draft_key
 */
export async function GET(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const can_manage = roleSatisfies(user.role, 'account_manager')
      const clientId = new URL(req.url).searchParams.get('client_id')
      if (clientId) {
        const got = await listClientFlows(user, clientId)
        if (!got.ok) return NextResponse.json({ error: got.error }, { status: got.status })
        return NextResponse.json({ rows: got.rows, read: got.read, can_manage })
      }
      return NextResponse.json({ clients: await flowSetup(user), can_manage })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('account_manager')
      const body = await req.json().catch(() => null)
      const made = await createFlow(user, body)
      if (!made.ok) return NextResponse.json({ error: made.error, issues: made.issues ?? [] }, { status: made.status })
      return NextResponse.json({ id: made.id, status: made.status, again: made.again }, { status: made.again ? 200 : 201 })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
