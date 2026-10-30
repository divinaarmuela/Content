import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { announceItemChange } from '../../../../../lib/production-live'
import { donePatch, mayMarkDone } from '../../../../../lib/done-core'

/**
 * MARK A CARD DONE, OR NOT (done-core; the owner, 30 Oct 2026). POST { done: boolean }. Any stage; an account manager,
 * an editor or a super admin. Stamps or clears `done_at` and nothing else — the card's stage, files and posts stay.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      if (!mayMarkDone(user)) return NextResponse.json({ error: 'Only an account manager, an editor or a super admin may mark a card done' }, { status: 403 })
      const { id } = await params
      // throws 404 / 403 for a card this person may not open
      const item = await loadItemForUser(user, id) as ContentItem
      const body = await req.json().catch(() => ({})) as { done?: unknown }
      const done = body.done !== false
      const now = new Date().toISOString()
      await table('content_items').update(id, { ...donePatch(done, user.id, now), updated_at: now } as never)
      await logActivity({ actor: user, clientId: item.client_id, entityType: 'content_item', entityId: id, action: done ? 'marked_done' : 'unmarked_done', newValue: item.title })
      announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'updated' })
      return NextResponse.json({ ok: true, done })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
