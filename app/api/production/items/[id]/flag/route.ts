import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { clientManagers } from '../../../../../lib/posting-approval'
import { notify, renderEmail, escapeHtml } from '../../../../../lib/mailer'
import { announceItemChange } from '../../../../../lib/production-live'
import { itemPath } from '../../../../../lib/workflow-core'
import { flagCheck } from '../../../../../lib/card-flag-core'
import { qcDetail, blockerNeed } from '../../../../../lib/editor-sop-core'
import { notifyBlocked } from '../../../../../lib/editor-sop-notify'

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/**
 * WHAT AN EDITOR SAYS ABOUT THEIR CARD (the Video Editors SOP, 11 Sep 2026):
 *
 *   acknowledged     — §6 "I have seen it and I am on it", the same day
 *   deadline_risk    — §6 "this will not make the date", with a line why;
 *                      the client's managers are told
 *   qc_done          — §4 the seven checks, all ticked, on this version
 *   handover_drive   — §5 the final is in the Drive monthly folder
 *   handover_source  — §5 source and project files handed off
 *   blocked          — §7 what is needed, from whom; they are told now, Ops
 *                      is copied at 12 h, leadership at 24 h (the sweep)
 *   unblocked        — §7 done
 *
 * None of these moves the card. The card's holder says them, or a manager on
 * their behalf.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const item = await loadItemForUser(user, id)
    const body = await req.json().catch(() => ({})) as { kind?: unknown; note?: unknown; ticks?: unknown; need?: unknown; from_id?: unknown }
    const check = flagCheck({
      kind: body.kind, note: body.note, ticks: body.ticks, need: body.need,
      viewer: { id: user.id, role: user.role }, ownerId: item.owner_id ?? null,
    })
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: check.status })

    const now = new Date().toISOString()
    let detail: string | null = check.note || null
    if (check.kind === 'qc_done') {
      detail = qcDetail(check.ticks)
      await table<ContentItem>('content_items').update(id, { qc_done_version: Number(item.current_version_number ?? 0) || null })
    }
    if (check.kind === 'handover_drive') await table<ContentItem>('content_items').update(id, { handover_drive_at: now })
    if (check.kind === 'handover_source') await table<ContentItem>('content_items').update(id, { handover_source_at: now })
    let told: { id: string; name: string }[] = []
    if (check.kind === 'blocked' && check.need) {
      const fromId = typeof body.from_id === 'string' && body.from_id ? body.from_id : null
      await table<ContentItem>('content_items').update(id, {
        blocked_need: check.need, blocked_from_id: fromId, blocked_note: check.note,
        blocked_at: now, blocked_nudged_12_at: null, blocked_nudged_24_at: null,
      })
      const need = blockerNeed(check.need)!
      const r = await notifyBlocked(user, item, check.need, check.note)
      told = r.told
      detail = `${need.label}: ${check.note}${told.length ? ` — asked ${told.map(p => p.name).join(', ')}` : ''}`
    }
    if (check.kind === 'unblocked') {
      await table<ContentItem>('content_items').update(id, {
        blocked_need: null, blocked_from_id: null, blocked_note: null,
        blocked_at: null, blocked_nudged_12_at: null, blocked_nudged_24_at: null,
      })
      detail = check.note || 'Unblocked'
    }

    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: check.kind,
      detail: detail ?? undefined,
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
    return NextResponse.json({ ok: true, kind: check.kind, told: told.map(p => p.name) })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
