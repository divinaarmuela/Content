import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { announceItemChange } from '../../../../../lib/production-live'
import { clipApprovalsOf, requestOrigin, withClipApproved, withClipUnapproved } from '../../../../../lib/clip-approvals-core'
import { currentFiles, finalFilesOf } from '../../../../../lib/final-files-core'

/**
 * A CLIP APPROVED ON THE CLIENT'S BEHALF (the owner, 22 Sep 2026: "an AM or
 * super admin can choose which videos are approved for the client, right?").
 * The client said it on a call, or the manager decided: the same tick the
 * portal writes, signed "<name> (MD Media)" so it is never mistaken for the
 * client's own press, and shown on the portal and the card alike. Taking it
 * back works the same way. A tick is a note, never a move.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('account_manager') // account managers and super admins
      const { id } = await params
      const item = await loadItemForUser(user, id)
      const body = await req.json().catch(() => ({})) as { file_id?: unknown; decision?: unknown }
      const fileId = String(body.file_id ?? '')
      const decision = body.decision === 'undo' ? 'undo' : 'approve'
      const file = [...currentFiles(item as never), ...finalFilesOf(item as never)].find(f => f.id === fileId)
      if (!file) return NextResponse.json({ error: 'That clip is not on this card' }, { status: 404 })
      const at = new Date().toISOString()
      const from = requestOrigin(req.headers)
      const by = `${user.name || user.email} (MD Media)`
      const current = clipApprovalsOf(item as never)
      const next = decision === 'approve'
        ? withClipApproved(current, { file_id: fileId, name: file.name, at, by, ip: from.ip, device: from.device })
        : withClipUnapproved(current, fileId)
      await table<ContentItem>('content_items').update(id, { clip_approvals: next, updated_at: at })
      announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'updated' })
      await logActivity({
        actor: user, clientId: item.client_id, entityType: 'content_item', entityId: id,
        action: decision === 'approve' ? 'clip_approved' : 'clip_unapproved',
        detail: decision === 'approve' ? `${file.name} marked approved on the client's behalf` : `${file.name} — approval taken back`,
      })
      return NextResponse.json({ ok: true, approvals: next })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
