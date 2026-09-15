import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Batch, TeamUser } from '@/lib/db-types'
import { requireRole, authzErrorResponse, AuthzError } from '../../../../../lib/authz'
import { accessibleClientIds, loadItemForUser } from '../../../../../lib/production-access'
import { logActivity, notifyHandedOver } from '../../../../../lib/workflow'
import { announceBatchChange, announceItemChange } from '../../../../../lib/production-live'
import { askedPatch } from '../../../../../lib/asked-core'
import { editorRefusal, transferRefusal, transferWords } from '../../../../../lib/editor-transfer-core'

/**
 * TRANSFER THE EDITING JOB (the owner, 15 Sep 2026): the client's account
 * manager or a super admin moves an edit — the card, with everything on it
 * — to another editor. One write on the card (its holder, who moved it, and
 * the ask that puts it in the new person's queue); on a card made from a
 * shoot, the shoot's named editor follows in the same request. The new
 * editor is told, with whatever words were typed. Nothing on the card is
 * copied, rewritten or lost.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const item = await loadItemForUser(user, id)
    const clientIds = await accessibleClientIds(user)
    const refused = transferRefusal({ id: user.id, role: user.role, clientIds }, item as never)
    if (refused) throw new AuthzError(refused, user.role === 'super_admin' || user.role === 'account_manager' ? 400 : 403)

    const body = await req.json().catch(() => ({})) as { editor_id?: unknown; note?: unknown }
    const editorId = typeof body.editor_id === 'string' ? body.editor_id.trim() : ''
    if (!editorId) return NextResponse.json({ error: 'Pick who the editing goes to' }, { status: 400 })
    const editor = await table<TeamUser>('team_users').get(editorId)
    const why = editorRefusal(editor, item.owner_id)
    if (why) return NextResponse.json({ error: why }, { status: 400 })
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''

    const previousOwner = item.owner_id ? await table<TeamUser>('team_users').get(item.owner_id) : null
    const now = new Date().toISOString()
    // the card moves: its holder, who moved it, and the ask that makes it
    // the new person's queue (the same three fields Hand to writes)
    await table('content_items').update(id, {
      owner_id: editorId,
      assigned_by: user.id,
      ...askedPatch([editorId], now),
      updated_at: now,
    })
    const updated = { ...(item as Record<string, unknown>), owner_id: editorId, assigned_by: user.id, updated_at: now }
    announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'updated' })

    // A CARD FROM A SHOOT: the shoot's editor follows, so "Footage is in",
    // the plan and every later notice go to the new person
    let shootFollowed = false
    if (item.batch_id) {
      const batch = await table<Batch>('batches').get(String(item.batch_id))
      if (batch && (!batch.editor_id || batch.editor_id === item.owner_id)) {
        await table('batches').update(batch.id, { editor_id: editorId, updated_at: now, last_edited_by: user.id })
        announceBatchChange({ batch_id: batch.id, client_id: batch.client_id, status: String(batch.status ?? ''), kind: 'updated' })
        shootFollowed = true
      }
    }

    notifyHandedOver(user, updated as never, note || null)
    const toName = editor!.name || editor!.email
    const fromName = previousOwner ? (previousOwner.name || previousOwner.email) : null
    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: 'editing_transferred',
      oldValue: item.owner_id ?? undefined, newValue: editorId,
      detail: transferWords(fromName, toName) + (shootFollowed ? ' — the shoot’s editor too' : ''),
    })
    return NextResponse.json({ ok: true, editor: { id: editorId, name: toName }, shoot_followed: shootFollowed })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
