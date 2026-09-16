import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import { logActivity } from '../../../lib/workflow'
import { announceItemChange } from '../../../lib/production-live'
import { portalActor, notifyManagersOfComment } from '../../../lib/portal-actor'
import { editingPortalItem } from '../../../lib/editing-portal'
import { isDriveId } from '../../../lib/files-core'
import { clipApprovalsOf, requestOrigin, withClipApproved, withClipUnapproved } from '../../../lib/clip-approvals-core'
import { reviewPath } from '../../../lib/video-review-core'

/**
 * THE CLIENT APPROVES ONE CLIP (the owner, 16 Sep 2026: "each video for the
 * client portal gets a nice Approved button, so the team sees which files
 * in Drive to work from"). A tick on the card, and the client's managers
 * told — never a move: the card stays where it is until the account
 * manager or a super admin logs the approval or sends it back for changes
 * ("even though the client approves all items it does not send back to
 * draft"). `undo` takes the tick back.
 */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const token = String(body.token ?? '')
    const itemId = String(body.item ?? '')
    const fileId = String(body.file_id ?? '')
    const name = String(body.name ?? '').trim().slice(0, 200)
    const decision = body.decision === 'undo' ? 'undo' : 'approve'
    const authorName = String(body.author_name ?? '').replace(/["<>\r\n]/g, '').trim().slice(0, 60)
    if (!isDriveId(fileId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // A TICK IS SIGNED (the owner, 16 Sep 2026: "who clicked approve?" — an
    // unsigned press said only the client's name): the person's name is
    // required to approve, and the address and device are kept with it
    if (decision === 'approve' && !authorName) return NextResponse.json({ error: 'Add your name first, so the team knows who approved it' }, { status: 400 })
    const found = await editingPortalItem(token, itemId)
    if (!found) return NextResponse.json({ error: 'Invalid link' }, { status: 401 })
    const { owner, item } = found
    const client = owner.client
    const by = authorName || client.name
    const at = new Date().toISOString()
    const from = requestOrigin(req.headers)

    const current = clipApprovalsOf(item)
    const next = decision === 'approve'
      ? withClipApproved(current, { file_id: fileId, name, at, by, ip: from.ip, device: from.device })
      : withClipUnapproved(current, fileId)
    await table<ContentItem>('content_items').update(item.id, { clip_approvals: next, updated_at: at })

    const actor = await portalActor(client.id, client.name)
    await logActivity({
      actor, clientId: client.id,
      entityType: 'content_item', entityId: item.id,
      action: decision === 'approve' ? 'clip_approved' : 'clip_unapproved',
      detail: decision === 'approve' ? `${name || fileId} approved by ${by} (${client.name}) from ${from.ip ?? 'an unknown address'}` : `${name || fileId} — approval taken back by ${by} from ${from.ip ?? 'an unknown address'}`,
    })
    announceItemChange({ item_id: item.id, client_id: client.id, status: item.status, kind: 'updated' })
    if (decision === 'approve') {
      await notifyManagersOfComment({
        clientId: client.id,
        speaker: authorName ? `${authorName} · ${client.name}` : client.name,
        subjectTitle: `${item.title} — a clip approved`,
        body: `Approved: ${name || 'a clip'} (${next.length} of the clips so far). The card stays where it is until you log the approval or send it back.`,
        dashboardPath: reviewPath(item.id, fileId, name || undefined),
      }).catch(e => console.error('clip approval notify error:', e))
    }
    return NextResponse.json({ ok: true, approvals: next })
  } catch (e) {
    console.error('portal clip error:', e)
    return NextResponse.json({ error: 'Something went wrong — try again' }, { status: 500 })
  }
  })
}
