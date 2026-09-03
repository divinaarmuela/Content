import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { ItemComment, TeamUser, TeamUserClient } from '@/lib/db-types'
import { requireSignedIn, requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { notify, renderEmail, escapeHtml } from '../../../../../lib/mailer'
import { announceItemChange } from '../../../../../lib/production-live'
import { OPEN_ITEM_CTA } from '../../../../../lib/email-voice-core'
import {
  notifyTagged, resolveTags, settleTagNotifications, taggableTeam,
} from '../../../../../lib/comment-tags'

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/** Add a comment. Visibility is derived from the author's role, never
 *  client-chosen: clients always write client-visible comments; editors always
 *  write internal ones; AMs/admins choose. Client comments notify the AM only
 *  (doc 1 §8 — the gatekeeper rule).
 *
 *  Tagging: "@Name" in the text — or `assigned_to` / `mention_ids` sent by the
 *  box — reaches ANY active team member, whoever the author is. The first
 *  tagged person becomes the comment's assignee (the seat the "Waiting on
 *  you" card and the board badge read); everyone tagged is emailed. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
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
      const parent = await table<ItemComment>('item_comments').get(String(body.parent_id))
      if (!parent || parent.item_id !== id) {
        return NextResponse.json({ error: 'That comment is not on this item' }, { status: 400 })
      }
      parentId = parent.id
    }

    let visibility: 'internal' | 'client'
    if (user.role === 'client') visibility = 'client'
    else if (user.role === 'editor' || user.role === 'scheduler') visibility = 'internal'
    else visibility = body.visibility === 'client' ? 'client' : 'internal'

    // who is tagged: the ids the box sent, plus whoever the text names —
    // resolved against the live roster so only a real, active team member
    // can ever be assigned (clients cannot tag)
    const explicit = [
      ...(Array.isArray(body.mention_ids) ? body.mention_ids.map(String) : []),
      ...(body.assigned_to ? [String(body.assigned_to)] : []),
    ]
    const team = user.role === 'client' || visibility !== 'internal' ? [] : await taggableTeam()
    const tagged = resolveTags(text, explicit, team, user.id)
    if (user.role !== 'client' && explicit.length > 0 && tagged.length === 0 && !explicit.includes(user.id)) {
      return NextResponse.json({ error: 'That person is not an active team member' }, { status: 400 })
    }
    const assignedTo = tagged[0]?.id ?? null

    const ts = Number(body.video_timestamp_sec)
    const videoTs = Number.isFinite(ts) && ts >= 0 ? Math.floor(ts) : null

    const comment = await table('item_comments').insert({
      item_id: id,
      parent_id: parentId,
      author_id: user.id,
      visibility,
      body: text,
      video_timestamp_sec: videoTs,
      assigned_to: assignedTo,
      // an unstamped boolean reads back absent, and every "still open" filter
      // — the badge, the Waiting-on-you card — tests `resolved === false`
      resolved: false,
    }) as unknown as ItemComment

    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: 'comment_added', detail: visibility,
    })

    // gatekeeper routing: client comments → assigned AMs (fallback super admins)
    if (user.role === 'client') {
      const links = await table<TeamUserClient>('team_user_clients')
        .list({ by: { client_id: item.client_id } })
      let recipients = (await attachOne(links, 'team_user_id', 'team_users', ['id', 'email', 'name', 'role', 'active_status']))
        .map(r => r.team_users as unknown as { id: string; email: string; role: string; active_status: boolean } | null)
        .filter((u): u is { id: string; email: string; role: string; active_status: boolean } => u !== null)
        // assigned super admins count as the client's manager here too
        .filter(u => (u.role === 'account_manager' || u.role === 'super_admin') && u.active_status)
      if (recipients.length === 0) {
        const admins = await table<TeamUser>('team_users')
          .list({ where: u => u.role === 'super_admin' && u.active_status === true })
        recipients = admins as unknown as typeof recipients
      }
      for (const r of recipients) {
        await notify({
          actorName: user.name,
          actorEmail: user.email,
          actorClerkId: user.clerk_user_id,
          eventType: 'client_comment',
          entityType: 'content_item',
          entityId: `${id}#${comment.id}`,
          recipientId: r.id,
          recipientEmail: r.email,
          subject: `The client commented on ${item.title}`,
          bodyHtml: renderEmail(
            `The client commented on ${item.title}`,
            `<p>The client wrote:</p>` +
            `<blockquote style="margin:12px 0;padding:8px 14px;border-left:3px solid #e4e4e7;color:#3f3f46;">${escapeHtml(text.slice(0, 500))}</blockquote>` +
            `<p><strong>What happens next:</strong> read it and, if changes are needed, tag the editor in a comment on the item — nobody else has been told yet.</p>`,
            OPEN_ITEM_CTA,
            `${DASHBOARD_URL}/dashboard/production/${id}`
          ),
        })
      }
    }

    // tagged people → email + notification row + "Waiting on you"
    if (visibility === 'internal' && tagged.length > 0) {
      await notifyTagged({
        actor: user, tagged, text,
        target: { kind: 'item', id, title: String(item.title ?? 'an item') },
        commentId: comment.id,
      })
    }

    announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'comment' })
    return NextResponse.json(comment, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Resolve/unresolve a comment. editor+. Resolving clears the tagged
 *  person's bell for it too — the badge was the "you are needed" signal. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    await loadItemForUser(user, id)
    const body = await req.json()
    if (!body.comment_id || typeof body.resolved !== 'boolean') {
      return NextResponse.json({ error: 'comment_id and resolved are required' }, { status: 400 })
    }
    const comments = table<ItemComment>('item_comments')
    const existing = await comments.get(String(body.comment_id))
    // a comment on another item is never resolvable from this one
    if (!existing || existing.item_id !== id) throw new Error('That comment is not on this item')
    const data = await comments.update(existing.id, { resolved: body.resolved })
    if (body.resolved) await settleTagNotifications(id, String(body.comment_id))
    announceItemChange({ item_id: id, client_id: String((data as { client_id?: string }).client_id ?? ''), status: 'draft_uploaded', kind: 'comment' })
    return NextResponse.json(data)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
