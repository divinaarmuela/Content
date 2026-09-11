import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { clientManagers } from '../../../../../lib/posting-approval'
import { notify, renderEmail, escapeHtml } from '../../../../../lib/mailer'
import { announceItemChange } from '../../../../../lib/production-live'
import { itemPath } from '../../../../../lib/workflow-core'
import { flagCheck } from '../../../../../lib/card-flag-core'

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/**
 * TWO SMALL THINGS AN EDITOR SAYS ABOUT THEIR CARD (the Video Editors SOP):
 *
 *   acknowledged   — "I have seen it and I am on it", the same day it lands
 *   deadline_risk  — "this will not make the date", the moment they see it,
 *                    with a line saying why; the client's managers are told
 *
 * Both are activity rows, never a status: the card does not move, the
 * history says what was said. The card's holder says them, or a manager on
 * their behalf.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const item = await loadItemForUser(user, id)
    const body = await req.json().catch(() => ({})) as { kind?: unknown; note?: unknown }
    const check = flagCheck({
      kind: body.kind, note: body.note,
      viewer: { id: user.id, role: user.role }, ownerId: item.owner_id ?? null,
    })
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.status })

    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: check.kind,
      detail: check.note || null || undefined,
    })
    if (check.kind === 'deadline_risk') {
      const managers = await clientManagers(item.client_id)
      const subject = `Deadline at risk: ${item.title}`
      await Promise.all(managers.filter(m => m.id !== user.id).map(m => notify({
        actorName: user.name, actorEmail: user.email, actorClerkId: user.clerk_user_id,
        eventType: 'deadline_risk', entityType: 'content_item',
        entityId: `${id}#risk#${m.id}#${Date.now()}`,
        recipientId: m.id, recipientEmail: m.email,
        subject,
        bodyHtml: renderEmail(
          subject,
          `<p><strong>${escapeHtml(item.title)}</strong> may not make its date. ${escapeHtml(user.name || user.email)} flagged it early, as the playbook asks.</p>`
          + `<blockquote style="margin:12px 0;padding:8px 14px;border-left:3px solid #e4e4e7;color:#3f3f46;">${escapeHtml(check.note)}</blockquote>`
          + (item.due_date ? `<p><strong>Due:</strong> ${escapeHtml(String(item.due_date).slice(0, 10))}</p>` : ''),
          'Open the item',
          `${DASHBOARD_URL}${itemPath(item)}`,
        ),
      })))
    }
    announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'updated' })
    return NextResponse.json({ ok: true, kind: check.kind })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
