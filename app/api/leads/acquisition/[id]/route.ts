import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Prospect as ProspectRow, ProspectEvent } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { mayDeleteProspect, sanitiseProspectPatch } from '../../../../lib/acquisition-core'

/**
 * ONE PROSPECT'S FIELDS (the acquisition blueprint, 21 Sep 2026). Anyone on
 * the team fills them in — the research, the asset links, the dates, the
 * money — cleaned field by field. Deleting one is a manager's, and takes its
 * timeline with it.
 */
export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler')
      const { id } = await params
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      const clean = sanitiseProspectPatch(body)
      if (!clean.ok) return NextResponse.json({ error: clean.error }, { status: 422 })
      if (Object.keys(clean.patch).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
      const prospect = await table<ProspectRow>('prospects').update(id, { ...clean.patch, updated_at: new Date().toISOString() } as never)
      if (!prospect) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 })
      return NextResponse.json({ prospect })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      if (!mayDeleteProspect(user)) return NextResponse.json({ error: 'An account manager or a super admin deletes a prospect' }, { status: 403 })
      const { id } = await params
      await table<ProspectEvent>('prospect_events').removeWhere(e => (e as { prospect_id?: string }).prospect_id === id)
      await table<ProspectRow>('prospects').remove(id)
      return NextResponse.json({ ok: true })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
