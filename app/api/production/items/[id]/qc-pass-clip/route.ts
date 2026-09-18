import { NextResponse } from 'next/server'
import { table } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import { authzErrorResponse, requireSignedIn } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { announceItemChange } from '../../../../../lib/production-live'
import { isQualityReviewer } from '../../../../../lib/identity-core'
import { qcApprovalsOf, withClipApproved, withClipUnapproved } from '../../../../../lib/clip-approvals-core'
import { settleQualityCheck } from '../../../../../lib/split-approved'

/**
 * THE QUALITY CHECK, ONE CLIP AT A TIME (the owner, 18 Sep 2026: "the approve
 * during quality review means it goes to the client now — it's the quality
 * checker or super admins"). A pass carries the reviewer's name. Then the
 * check is settled at once (split-approved): passed clips go to the client
 * on their own card, a fully passed card goes to the client itself.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSignedIn()
    if (!(isQualityReviewer(user) || user.role === 'super_admin')) {
      return NextResponse.json({ error: 'The quality check is the reviewer’s — or a super admin’s' }, { status: 403 })
    }
    const { id } = await ctx.params
    const item = await loadItemForUser(user, id)
    if (String(item.status) !== 'quality_check') return NextResponse.json({ error: 'A clip is passed while the card is at the quality check — it is not there now' }, { status: 409 })
    const body = await req.json().catch(() => ({})) as { file_id?: unknown; name?: unknown; on?: unknown }
    const fileId = String(body.file_id ?? '').trim()
    if (!fileId) return NextResponse.json({ error: 'Which clip?' }, { status: 400 })
    const name = String(body.name ?? '').trim().slice(0, 200)
    const on = body.on !== false
    const at = new Date().toISOString()
    const current = qcApprovalsOf(item)
    const next = on
      ? withClipApproved(current, { file_id: fileId, name, at, by: user.name || user.email, team: true })
      : withClipUnapproved(current, fileId)
    const updated = await table<ContentItem>('content_items').update(id, { qc_approvals: next, updated_at: at } as never)
    await logActivity({
      actor: user, entityType: 'content_item', entityId: id,
      action: on ? 'clip_passed_qc' : 'clip_unpassed_qc',
      detail: on ? `${name || fileId} passed the quality check by ${user.name || user.email}` : `${name || fileId} — pass taken back by ${user.name || user.email}`,
    })
    announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'updated' })
    let settled: { moved?: number; sent?: boolean } | null = null
    if (on) {
      try { settled = await settleQualityCheck(user, (updated ?? { ...item, qc_approvals: next }) as never) }
      catch (e) { console.error('[qc-pass-clip] settling the quality check failed:', e) }
    }
    return NextResponse.json({ qc_approvals: next, settled })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
