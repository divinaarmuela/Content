import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Batch } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { shootManager } from '../../../../../lib/production-access'
import { canManageShoot } from '../../../../../lib/shoot-sop-core'
import { logActivity } from '../../../../../lib/workflow'
import { notifyBriefShared } from '../../../../../lib/shoot-sop-notify'

/**
 * SEND THE PLAN AGAIN (the owner, 14 Sep 2026): the people on the shoot who
 * have not read it yet — the ones added since the share included — get the
 * "Read the plan" email once more. A manager's press; nothing else changes.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const batch = await table<Batch>('batches').get(id)
    if (!batch) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })
    if (!canManageShoot(await shootManager(user), batch)) {
      return NextResponse.json({ error: 'Only the account manager on this shoot sends the plan' }, { status: 403 })
    }
    if (!batch.brief_shared_at) return NextResponse.json({ error: 'Share the plan with the team first' }, { status: 400 })
    const again = new Date().toISOString()
    const told = await notifyBriefShared(user, batch, { again })
    await logActivity({
      actor: user, clientId: batch.client_id, entityType: 'batch', entityId: id,
      action: 'sop_stage', detail: `Plan sent again to ${told} ${told === 1 ? 'person' : 'people'} who had not read it`,
    })
    return NextResponse.json({ told })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
