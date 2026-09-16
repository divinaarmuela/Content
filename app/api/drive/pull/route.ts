import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Batch } from '@/lib/db-types'
import { requireRole, authzErrorResponse, AuthzError } from '../../../lib/authz'
import { canManageBatch, loadItemForUser } from '../../../lib/production-access'
import { actingRoles } from '../../../lib/workflow-core'
import { startPull } from '../../../lib/drive-pull'
import { finishedEditOf } from '../../../lib/card-link-core'
import { roundOf } from '../../../lib/edit-round-core'

/**
 * PULL THE FILES IN, ON PURPOSE (the owner, 16 Sep 2026): the button under a
 * folder — the first time, after a failure, or after a new cut was dropped
 * into the same folder. The folder is the one already saved on the shoot or
 * the card; the caller names which. A read of Drive, a write to our own
 * storage (trap 13): nothing in Drive changes.
 */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const body = await req.json().catch(() => ({})) as { kind?: unknown; id?: unknown; which?: unknown }
    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ error: 'Which folder?' }, { status: 400 })

    if (body.kind === 'batch') {
      const batch = await table<Batch>('batches').get(id)
      if (!batch) return NextResponse.json({ error: 'Shoot not found' }, { status: 404 })
      if (!(await canManageBatch(user, batch)) && batch.editor_id !== user.id) throw new AuthzError('This shoot is not yours to work', 403)
      if (!batch.footage_url) return NextResponse.json({ error: 'No footage folder on this shoot yet' }, { status: 400 })
      const r = await startPull({ kind: 'batch', scopeId: batch.id, folderUrl: batch.footage_url, by: user.id, purpose: 'folder' })
      return NextResponse.json(r, { status: r.started || r.reason === 'Already being pulled' ? 200 : 400 })
    }

    if (body.kind === 'item') {
      const item = await loadItemForUser(user, id)
      const hats = actingRoles({ id: user.id, role: user.role }, item as never)
      if (!hats.some(h => h === 'editor' || h === 'account_manager' || h === 'super_admin' || h === 'scheduler')) {
        throw new AuthzError('This card is not yours to work', 403)
      }
      // the finished edit, or the source working folder
      const finished = body.which === 'finished' ? finishedEditOf(item as never) : null
      const url = finished?.url ?? (typeof item.raw_assets_url === 'string' ? item.raw_assets_url : '')
      if (!url) return NextResponse.json({ error: 'No folder on this card yet' }, { status: 400 })
      // the finished edit carries the card's round; a folder to work from is no version
      const r = await startPull({ kind: 'item', scopeId: item.id, folderUrl: url, version: finished ? roundOf(item) : 1, by: user.id, purpose: finished ? 'finished' : 'folder' })
      return NextResponse.json(r, { status: r.started || r.reason === 'Already being pulled' ? 200 : 400 })
    }
    return NextResponse.json({ error: 'Which kind?' }, { status: 400 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
