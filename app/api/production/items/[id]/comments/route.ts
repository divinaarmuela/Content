import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireSignedIn, requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { isValidOwner } from '../../../../../lib/work-kinds-core'
import { logActivity } from '../../../../../lib/workflow'
import { notify, renderEmail, escapeHtml } from '../../../../../lib/mailer'
import { announceItemChange } from '../../../../../lib/production-live'
import { OPEN_ITEM_CTA } from '../../../../../lib/email-voice-core'

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/** Add a comment. Visibility is derived from the author's role, never
 *  client-chosen: clients always write client-visible comments; editors always
 *  write internal ones; AMs/admins choose. Client comments notify the AM only
 *  (doc 1 §8 — the gatekeeper rule). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSignedIn()
    const { id } = await params
    const item = await loadItemForUser(user, id)
    const body = await req.json()
    const text = String(body.body ?? '').trim().slice(0, 5000)
    if (!text) return NextResponse.json({ error: 'Comment text is required' }, { status: 400 })

    // a reply's parent must belong to THIS item — never graft across items
    let parentId: string | null = null
    if (body.parent_id) {
      const { data: parent } = await supabase
        .from('item_comments').select('id').eq('id', body.parent_id).eq('item_id', id).maybeSingle()
      if (!parent) return NextResponse.json({ error: 'That comment is not on this item' }, { status: 400 })
      parentId = parent.id
    }
    // an assignee must be an active, non-client team member (clients cannot assign)
    let assignedTo: string | null = null
    if (user.role !== 'client' && body.assigned_to) {
      const { data: cand } = await supabase
        .from('team_users').select('role, active_status').eq('id', body.assigned_to).maybeSingle()
      if (!isValidOwner(cand)) return NextResponse.json({ error: 'That assignee is not a valid team member' }, { status: 400 })
      assignedTo = String(body.assigned_to)
    }
    const ts = Number(body.video_timestamp_sec)
    const videoTs = Number.isFinite(ts) && ts >= 0 ? Math.floor(ts) : null

    let visibility: 'internal' | 'client'
    if (user.role === 'client') visibility = 'client'
    else if (user.role === 'editor' || user.role === 'scheduler') visibility = 'internal'
    else visibility = body.visibility === 'client' ? 'client' : 'internal'

    const { data: comment, error } = await supabase
      .from('item_comments')
      .insert({
        item_id: id,
        parent_id: parentId,
        author_id: user.id,
        visibility,
        body: text,
        video_timestamp_sec: videoTs,
        assigned_to: assignedTo,
      })
      .select()
      .single()
    if (error) throw new Error(error.message)

    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: 'comment_added', detail: visibility,
    })

    // gatekeeper routing: client comments → assigned AMs (fallback super admins)
    if (user.role === 'client') {
      const { data } = await supabase
        .from('team_user_clients')
        // FK named explicitly — the bare embed is ambiguous (two links to
        // team_users) and silently resolves to nobody, see workflow.ts
        .select('team_users!team_user_clients_team_user_id_fkey!inner(id, email, name, role, active_status)')
        .eq('client_id', item.client_id)
      let recipients = (data ?? [])
        .map(r => r.team_users as unknown as { id: string; email: string; role: string; active_status: boolean })
        // assigned super admins count as the client's manager here too
        .filter(u => (u.role === 'account_manager' || u.role === 'super_admin') && u.active_status)
      if (recipients.length === 0) {
        const { data: admins } = await supabase.from('team_users')
          .select('id, email, role, active_status').eq('role', 'super_admin').eq('active_status', true)
        recipients = (admins ?? []) as typeof recipients
      }
      for (const r of recipients) {
        await notify({
          actorName: user.name,
          actorEmail: user.email,
          actorClerkId: user.clerk_user_id,
          eventType: 'client_comment',
          entityType: 'item_comment',
          entityId: comment.id,
          recipientId: r.id,
          recipientEmail: r.email,
          subject: `The client commented on ${item.title}`,
          bodyHtml: renderEmail(
            `The client commented on ${item.title}`,
            `<p>The client wrote:</p>` +
            `<blockquote style="margin:12px 0;padding:8px 14px;border-left:3px solid #e4e4e7;color:#3f3f46;">${escapeHtml(text.slice(0, 500))}</blockquote>` +
            `<p><strong>What happens next:</strong> read it and, if changes are needed, leave the editor a note on the item — nobody else has been told yet.</p>`,
            OPEN_ITEM_CTA,
            `${DASHBOARD_URL}/dashboard/production/${id}`
          ),
        })
      }
    }

    // assigned internal task → notify the assignee
    if (visibility === 'internal' && comment.assigned_to && comment.assigned_to !== user.id) {
      const { data: assignee } = await supabase.from('team_users')
        .select('id, email').eq('id', comment.assigned_to).eq('active_status', true).maybeSingle()
      if (assignee) {
        await notify({
          actorName: user.name,
          actorEmail: user.email,
          actorClerkId: user.clerk_user_id,
          eventType: 'comment_assigned',
          entityType: 'item_comment',
          entityId: comment.id,
          recipientId: assignee.id,
          recipientEmail: assignee.email,
          // "Task on X", body = the raw comment and nothing else: it never
          // said who wrote it, that it was for the reader, or what a "task"
          // means here. It says all three now.
          subject: `${user.name || user.email} left you a note on ${item.title}`,
          bodyHtml: renderEmail(
            `${user.name || user.email} left you a note on ${item.title}`,
            `<p><strong>${escapeHtml(user.name || user.email)}</strong> asked you to look at something on <strong>${escapeHtml(item.title)}</strong>:</p>` +
            `<blockquote style="margin:12px 0;padding:8px 14px;border-left:3px solid #e4e4e7;color:#3f3f46;">${escapeHtml(text.slice(0, 500))}</blockquote>` +
            `<p><strong>What happens next:</strong> it stays on your list until you mark it done on the item.</p>`,
            OPEN_ITEM_CTA,
            `${DASHBOARD_URL}/dashboard/production/${id}`
          ),
        })
      }
    }

    announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'comment' })
    return NextResponse.json(comment, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Resolve/unresolve a comment. editor+. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    await loadItemForUser(user, id)
    const body = await req.json()
    if (!body.comment_id || typeof body.resolved !== 'boolean') {
      return NextResponse.json({ error: 'comment_id and resolved are required' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('item_comments')
      .update({ resolved: body.resolved })
      .eq('id', body.comment_id)
      .eq('item_id', id)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
