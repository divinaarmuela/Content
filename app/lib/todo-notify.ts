import 'server-only'
import { table } from '@/lib/db'
import type { TeamUser as TeamUserRow } from '@/lib/db-types'
import type { TeamUser } from './authz'
import { escapeHtml, notify, renderEmail } from './mailer'
import { DASHBOARD_URL } from './app-url'

/**
 * TELLING PEOPLE ABOUT A TO-DO (the owner, 18 Oct 2026: "Bell + email", like
 * Asana's inbox). One email and one bell row per person per event, through
 * `notify` — so EMAIL_TEST_ONLY, the test-client guard and the exactly-once
 * log all apply. The bell opens /dashboard/todos?task=<id>
 * (notification-words `todo`).
 */
export async function notifyTodo(input: {
  actor: TeamUser
  todo: { id: string; title: string; client_id?: string | null }
  recipientIds: readonly string[]
  /** what happened, said to the reader: "commented on", "tagged you on", "assigned you" */
  verb: string
  /** the event, also the dedupe key's tail: one per comment, one per change */
  event: string
  eventKey: string
  quote?: string | null
}): Promise<void> {
  const ids = [...new Set(input.recipientIds)].filter(id => id && id !== input.actor.id)
  if (ids.length === 0) return
  const people = await table<TeamUserRow>('team_users').list({ where: u => ids.includes(String(u.id)) && u.active_status !== false && !!u.email })
  const who = input.actor.name || input.actor.email
  const href = `${DASHBOARD_URL}/dashboard/todos?task=${encodeURIComponent(input.todo.id)}`
  const subject = `${who} ${input.verb} ${input.todo.title}`.slice(0, 180)
  for (const p of people) {
    await notify({
      actorName: input.actor.name,
      actorEmail: input.actor.email,
      eventType: input.event,
      entityType: 'todo',
      entityId: `${input.todo.id}#${input.eventKey}`,
      recipientId: String(p.id),
      recipientEmail: String(p.email),
      clientId: input.todo.client_id ?? null,
      subject,
      bodyHtml: renderEmail(
        subject,
        `<p><strong>${escapeHtml(who)}</strong> ${escapeHtml(input.verb)} <strong>${escapeHtml(input.todo.title)}</strong>.</p>` +
        (input.quote ? `<blockquote style="margin:12px 0;padding:8px 14px;border-left:3px solid #e4e4e7;color:#3f3f46;">${escapeHtml(input.quote.slice(0, 500))}</blockquote>` : ''),
        'Open the to-do',
        href,
      ),
    })
  }
}
