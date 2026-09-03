import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { ContentItem, DeliverableGroup } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { accessibleClientIds } from '../../../../lib/production-access'
import { taskExemptFromClientScope } from '../../../../lib/item-edit-core'
import { logActivity } from '../../../../lib/workflow'

/**
 * Delete a deliverable/quota GROUP card — the "Reels · 2 of 5" promise.
 *
 * A card made by mistake used to be permanent: there was no DELETE at all.
 * Removing the group must never destroy the real work made under it, so any
 * pieces are DETACHED first (group_id → null) and live on as ordinary plain
 * cards. Only the promise row itself is deleted. A group with no pieces is
 * simply removed.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    // same floor as creating a group: every team role may, no client may
    const user = await requireRole('scheduler')
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const found = await table<DeliverableGroup>('deliverable_groups').get(id)
    if (!found) return NextResponse.json({ error: 'That card no longer exists' }, { status: 404 })
    const group = (await attachOne([found], 'work_kind_id', 'work_kinds', ['slug', 'uses_media']))[0]

    // client scope, exactly as the create path: a TASK group is internal work
    // any team member may touch; an asset group stays scoped to its client team
    const taskGroup = taskExemptFromClientScope(group.work_kinds as { slug?: string | null; uses_media?: boolean | null } | null)
    const clientIds = await accessibleClientIds(user)
    if (!taskGroup && clientIds !== null && !clientIds.includes(group.client_id)) {
      return NextResponse.json({ error: 'You are not assigned to that client' }, { status: 403 })
    }

    // Detach the pieces BEFORE deleting the promise, so real work is never
    // orphaned into a deleted parent — they become plain cards on the board.
    const items = table<ContentItem>('content_items')
    const detached = await items.list({ where: r => r.group_id === id })
    await Promise.all(detached.map(r => items.update(r.id, { group_id: null })))

    await table('deliverable_groups').remove(id)

    const kept = detached.length
    await logActivity({
      actor: user, clientId: group.client_id,
      entityType: 'content_item', entityId: id, action: 'deleted',
      oldValue: `${group.title} — card removed${kept ? `, ${kept} piece${kept === 1 ? '' : 's'} kept` : ''}`,
    })
    return NextResponse.json({ ok: true, detached: kept })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
