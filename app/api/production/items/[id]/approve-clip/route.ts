import { NextResponse } from 'next/server'
import { table } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { announceItemChange } from '../../../../../lib/production-live'
import { clipApprovalsOf, withClipApproved, withClipUnapproved } from '../../../../../lib/clip-approvals-core'
import { settleApprovals } from '../../../../../lib/split-approved'

/**
 * A TEAM APPROVAL ON ONE CLIP (the owner, 18 Sep 2026: "make sure the AM or
 * super admin can approve each asset as well — sometimes the client will
 * call us"). The tick carries the manager's name and says it was the team's;
 * the client's own ticks stay the client's. Then the approvals are settled
 * at once (split-approved): approved clips go to handover, a fully approved
 * card is accepted.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('account_manager')   // an account manager or a super admin
    const { id } = await ctx.params
    const item = await loadItemForUser(user, id)
    const body = await req.json().catch(() => ({})) as { file_id?: unknown; name?: unknown; on?: unknown }
    const fileId = String(body.file_id ?? '').trim()
    if (!fileId) return NextResponse.json({ error: 'Which clip?' }, { status: 400 })
    const name = String(body.name ?? '').trim().slice(0, 200)
    const on = body.on !== false
    const at = new Date().toISOString()
    const current = clipApprovalsOf(item)
    const next = on
      ? withClipApproved(current, { file_id: fileId, name, at, by: user.name || user.email, team: true })
      : withClipUnapproved(current, fileId)
    const updated = await table<ContentItem>('content_items').update(id, { clip_approvals: next, updated_at: at } as never)
    await logActivity({
      actor: user, entityType: 'content_item', entityId: id,
      action: on ? 'clip_approved' : 'clip_unapproved',
      detail: on ? `${name || fileId} approved by ${user.name || user.email} (team, for the client)` : `${name || fileId} — approval taken back by ${user.name || user.email}`,
    })
    announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'updated' })
    let settled: { moved?: number; accepted?: boolean } | null = null
    if (on) {
      try { settled = await settleApprovals(user, (updated ?? { ...item, clip_approvals: next }) as never) }
      catch (e) { console.error('[approve-clip] settling the approvals failed:', e) }
    }
    return NextResponse.json({ approvals: next, settled })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
