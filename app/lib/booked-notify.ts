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
