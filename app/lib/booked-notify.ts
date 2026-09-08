import 'server-only'
import { table } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { TeamUserClient } from '@/lib/db-types'
import { notify, renderEmail, escapeHtml } from './mailer'

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
import type { TeamUser } from './authz'
import { formatInZone, safeZone } from './timezone-core'
import { itemPath } from './workflow-core'

/**
 * "IF SOMETHING IS SCHEDULED, NOTIFY THE AM" (the owner, 9 Sep 2026).
 *
 * When a post is booked in, every active account manager and super admin on
 * the client is told — bell and email, the same `notify` every other event
 * uses — except the person who booked it. Nobody outside the team is told.
 */
export async function notifyManagersBooked(
  actor: TeamUser,
  item: { id: string; title: string; client_id: string; adhoc_post?: unknown },
  post: { scheduled_for?: string | null; timezone?: string | null },
  channels: readonly string[],
): Promise<void> {
  try {
    const links = await table<TeamUserClient>('team_user_clients').list({ by: { client_id: item.client_id } })
    const joined = await attachOne(links, 'team_user_id', 'team_users', ['id', 'email', 'name', 'role', 'active_status'])
    const managers = joined
      .map(r => r.team_users as unknown as { id: string; email: string; name: string; role: string; active_status: boolean } | null)
      .filter((u): u is { id: string; email: string; name: string; role: string; active_status: boolean } =>
        !!u && (u.role === 'account_manager' || u.role === 'super_admin') && u.active_status && u.id !== actor.id)
    const tz = safeZone(post.timezone ?? undefined)
    const when = (post.scheduled_for ? formatInZone(post.scheduled_for, tz, 'full') : null) ?? 'now'
    const where = channels.length > 0 ? ` on ${channels.join(', ')}` : ''
    const subject = `Booked in: ${item.title} — ${when}`
    for (const m of managers) {
      await notify({
        actorName: actor.name, actorEmail: actor.email, actorClerkId: actor.clerk_user_id,
        eventType: 'post_booked',
        entityType: 'content_item',
        entityId: `${item.id}#booked#${post.scheduled_for ?? 'now'}`,
        recipientId: m.id, recipientEmail: m.email,
        subject,
        bodyHtml: renderEmail(
          subject,
          `<p><strong>${escapeHtml(item.title)}</strong> is booked to go out ${escapeHtml(when)}${escapeHtml(where)}, by ${escapeHtml(actor.name || actor.email || '')}.</p>` +
          `<p>Nothing is needed from you — this is so you know.</p>`,
          'See it',
          `${DASHBOARD_URL}${itemPath(item)}`,
        ),
      })
    }
  } catch (e) {
    console.error('booked notify:', e)
  }
}

/**
 * A NOTE ON THE CALENDAR TELLS THE TEAM ON THAT CLIENT (the owner, 9 Sep
 * 2026: "why does the back and forth chat not notify the team or the AM,
 * like in the Schedule"). Every active team member on the client — the
 * managers and the schedulers — except the person who wrote it. Bell and
 * email; never a client.
 */
export async function notifyTeamOfNote(
  actor: TeamUser,
  note: { id: string; client_id: string; at: string; text: string },
  clientName: string | null,
): Promise<void> {
  try {
    const links = await table<TeamUserClient>('team_user_clients').list({ by: { client_id: note.client_id } })
    const joined = await attachOne(links, 'team_user_id', 'team_users', ['id', 'email', 'name', 'role', 'active_status'])
    const people = joined
      .map(r => r.team_users as unknown as { id: string; email: string; name: string; role: string; active_status: boolean } | null)
      .filter((u): u is { id: string; email: string; name: string; role: string; active_status: boolean } =>
        !!u && u.role !== 'client' && u.active_status && u.id !== actor.id)
    const when = formatInZone(note.at, safeZone(undefined), 'full') ?? note.at
    const who = actor.name || actor.email || 'Someone'
    const subject = `${who} left a note on ${clientName ?? 'the'} calendar — ${when}`
    for (const p of people) {
      await notify({
        actorName: actor.name, actorEmail: actor.email, actorClerkId: actor.clerk_user_id,
        eventType: 'schedule_note',
        entityType: 'schedule_note',
        entityId: `${note.client_id}#${note.id}`,
        recipientId: p.id, recipientEmail: p.email,
        subject,
        bodyHtml: renderEmail(
          subject,
          `<p>${escapeHtml(who)} wrote, pinned to ${escapeHtml(when)}:</p>` +
          `<blockquote style="margin:12px 0;padding:8px 14px;border-left:3px solid #e4e4e7;color:#3f3f46;">${escapeHtml(note.text)}</blockquote>`,
          'Open the calendar',
          `${DASHBOARD_URL}/dashboard/social/schedule?client=${encodeURIComponent(note.client_id)}`,
        ),
      })
    }
  } catch (e) {
    console.error('note notify:', e)
  }
}
