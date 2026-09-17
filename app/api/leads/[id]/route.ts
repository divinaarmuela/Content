import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Lead } from '@/lib/db-types'
import { requireRole, requireSignedIn, authzErrorResponse } from '../../../lib/authz'
import { sanitisePipelinePatch } from '../../../lib/pipeline-core'

/** Editing and deleting leads is an account_manager action. Middleware alone
 *  would admit any signed-in account, including a client. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  const { id } = await params
  const body = await req.json()

  const allowed = ['fname', 'lname', 'email', 'phone', 'biz', 'model', 'need', 'budget', 'timeline'] as const
  const patch: Record<string, unknown> = {}
  for (const key of allowed) if (key in body) patch[key] = body[key]
  // THE PIPELINE FIELDS (the acquisition doc, 17 Sep 2026): who owns the deal,
  // its tier and source, the dated milestones, the objection, the touches.
  // Anyone on the team may work a deal — Joy runs the pipeline and is not a
  // manager; a client never may. The contact details stay a manager's.
  const pipe = sanitisePipelinePatch(body)
  if (!pipe.ok) return NextResponse.json({ error: pipe.error }, { status: 400 })
  Object.assign(patch, pipe.patch)
  try {
    const user = await requireSignedIn()
    if (user.role === 'client') throw new Error('Not for clients')
    if (allowed.some(k => k in body)) await requireRole('account_manager')
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No editable fields in request' }, { status: 400 })
  }
  if ('email' in patch && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(patch.email))) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  try {
    const data = await table('leads').update(id, patch)
    if (!data) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
  })
}

/** Delete a lead. Clerk-protected via middleware (/api/leads(.*)). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    await requireRole('account_manager')
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  const { id } = await params
  const leads = table<Lead>('leads')
  try {
    // the old delete reported what it removed; a missing row is still a 404
    const existing = await leads.get(id)
    if (!existing) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    await leads.remove(id)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
  })
}
