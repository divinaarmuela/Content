import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
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
  try {
    // same floor as creating a group: every team role may, no client may
    const user = await requireRole('scheduler')
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    // The select names no new columns (no `planned`), so it tolerates the
    // mixed-format migration not having run yet — nothing here depends on it.
    const { data: group, error: gErr } = await supabase
      .from('deliverable_groups')
      .select('id, client_id, title, work_kind_id, work_kinds(slug, uses_media)')
      .eq('id', id)
      .maybeSingle()
    if (gErr) {
      // table not migrated at all — there is nothing to delete, say so plainly
      if (/relation|does not exist|could not find the table|schema cache/i.test(gErr.message)) {
        return NextResponse.json({ error: 'That card no longer exists' }, { status: 404 })
      }
      throw new Error(gErr.message)
    }
    if (!group) return NextResponse.json({ error: 'That card no longer exists' }, { status: 404 })

    // client scope, exactly as the create path: a TASK group is internal work
    // any team member may touch; an asset group stays scoped to its client team
    const taskGroup = taskExemptFromClientScope(group.work_kinds as { slug?: string | null; uses_media?: boolean | null } | null)
    const clientIds = await accessibleClientIds(user)
    if (!taskGroup && clientIds !== null && !clientIds.includes(group.client_id)) {
      return NextResponse.json({ error: 'You are not assigned to that client' }, { status: 403 })
    }

    // Detach the pieces BEFORE deleting the promise, so real work is never
    // orphaned into a deleted parent — they become plain cards on the board.
    const { data: detached, error: dErr } = await supabase
      .from('content_items')
      .update({ group_id: null })
      .eq('group_id', id)
      .select('id')
    if (dErr) throw new Error(dErr.message)

    const { error: delErr } = await supabase.from('deliverable_groups').delete().eq('id', id)
    if (delErr) throw new Error(delErr.message)

    const kept = detached?.length ?? 0
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
}
