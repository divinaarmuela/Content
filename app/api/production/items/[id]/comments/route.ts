import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireSignedIn, requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { notify, renderEmail } from '../../../../../lib/mailer'
import { announceItemChange } from '../../../../../lib/production-live'

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
    if (!body.body?.trim()) return NextResponse.json({ error: 'Comment text is required' }, { status: 400 })

    let visibility: 'internal' | 'client'
    if (user.role === 'client') visibility = 'client'
    else if (user.role === 'editor' || user.role === 'scheduler') visibility = 'internal'
    else visibility = body.visibility === 'client' ? 'client' : 'internal'

    const { data: comment, error } = await supabase
      .from('item_comments')
      .insert({
        item_id: id,
        parent_id: body.parent_id ?? null,
        author_id: user.id,
        visibility,
        body: String(body.body).trim(),
        video_timestamp_sec: body.video_timestamp_sec ?? null,
        assigned_to: user.role === 'client' ? null : body.assigned_to ?? null,
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
        .filter(u => u.role === 'account_manager' && u.active_status)
      if (recipients.length === 0) {
        const { data: admins } = await supabase.from('team_users')
          .select('id, email, role, active_status').eq('role', 'super_admin').eq('active_status', true)
        recipients = (admins ?? []) as typeof recipients
      }
      for (const r of recipients) {
        await notify({
          eventType: 'client_comment',
          entityType: 'item_comment',
          entityId: comment.id,
          recipientId: r.id,
          recipientEmail: r.email,
          subject: `Client comment on ${item.title}`,
          bodyHtml: renderEmail(
            `Client comment on ${item.title}`,
            `<p>${String(body.body).trim().slice(0, 500)}</p><p style="color:#a1a1aa;font-size:12px;">Review it and assign an editor task if changes are needed — the editor has not been notified.</p>`,
            'Open item',
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
          eventType: 'comment_assigned',
          entityType: 'item_comment',
          entityId: comment.id,
          recipientId: assignee.id,
          recipientEmail: assignee.email,
          subject: `Task on ${item.title}`,
          bodyHtml: renderEmail(
            `Task on ${item.title}`,
            `<p>${String(body.body).trim().slice(0, 500)}</p>`,
            'Open item',
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
