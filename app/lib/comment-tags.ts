import 'server-only'
import { supabase } from '@/lib/supabase'
import type { TeamUser } from './authz'
import { notify, renderEmail, escapeHtml } from './mailer'
import { OPEN_ITEM_CTA } from './email-voice-core'
import { resolveTags, type Mentionable } from './mention-core'

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/**
 * Tagging somebody in a comment — the server half.
 *
 * "@Name" in the text is the truth: the box sends the ids it resolved, and
 * the server resolves the same text against the same roster, so a tag typed
 * on a phone with a stale team list still lands. The first tagged person is
 * the comment's `assigned_to` (one seat per comment — that is what the
 * "Waiting on you" card, the board badge and the resolve tick hang off);
 * everyone else tagged is told the same way, with the same link.
 *
 * Every tagged person gets: an email with a deep link, a notification row
 * (the bell and the Notifications page read those), and — because the
 * notification's entity is the ITEM or the SHOOT, with the comment id after
 * a '#' — a row that opens the right page. The old rows pointed at the
 * comment id under an entity type nothing could route, so every one of
 * them was a dead row.
 */

export type Taggable = Mentionable & { email: string }

/** Active, non-client team members — the people "@Name" can reach. */
export async function taggableTeam(): Promise<Taggable[]> {
  const { data } = await supabase
    .from('team_users')
    .select('id, name, email, role, active_status')
    .neq('role', 'client')
    .eq('active_status', true)
  return (data ?? []).map(u => ({ id: String(u.id), name: String(u.name ?? u.email ?? ''), email: String(u.email ?? '') }))
}

/** The pure rule lives in mention-core; re-exported so the routes import
 *  one module for tagging. */
export { resolveTags }

/** Tell each tagged person: email + notification row, deep-linked. */
export async function notifyTagged(input: {
  actor: TeamUser
  tagged: readonly Taggable[]
  text: string
  /** the thing the comment is on */
  target: { kind: 'item' | 'shoot'; id: string; title: string }
  commentId: string
}): Promise<void> {
  const { actor, tagged, text, target, commentId } = input
  const href = target.kind === 'item'
    ? `${DASHBOARD_URL}/dashboard/production/${target.id}`
    : `${DASHBOARD_URL}/dashboard/production/shoots/${target.id}`
  const who = actor.name || actor.email
  for (const t of tagged) {
    await notify({
      actorName: actor.name,
      actorEmail: actor.email,
      actorClerkId: actor.clerk_user_id,
      eventType: 'comment_assigned',
      // the ITEM (or shoot) is the entity, so the row routes to the page;
      // the comment id rides after '#' to keep the dedupe key per comment
      entityType: target.kind === 'item' ? 'content_item' : 'shoot',
      entityId: `${target.id}#${commentId}`,
      recipientId: t.id,
      recipientEmail: t.email,
      subject: `${who} tagged you on ${target.title}`,
      bodyHtml: renderEmail(
        `${who} tagged you on ${target.title}`,
        `<p><strong>${escapeHtml(who)}</strong> asked you to look at something on <strong>${escapeHtml(target.title)}</strong>:</p>` +
        `<blockquote style="margin:12px 0;padding:8px 14px;border-left:3px solid #e4e4e7;color:#3f3f46;">${escapeHtml(text.slice(0, 500))}</blockquote>` +
        `<p><strong>What happens next:</strong> it stays under &ldquo;Waiting on you&rdquo; until you mark it done on the ${target.kind === 'item' ? 'item' : 'shoot'} page.</p>`,
        target.kind === 'item' ? OPEN_ITEM_CTA : 'Open the shoot',
        href,
      ),
    })
  }
}

/**
 * Marking a tagged comment done also clears it from the tagged person's
 * bell: the notification was the "you are needed" signal, and once the need
 * is met an unread badge for it is a lie. Best-effort — a stale badge is a
 * smaller failure than a resolve that fails.
 */
export async function settleTagNotifications(targetId: string, commentId: string): Promise<void> {
  try {
    await supabase
      .from('notification_log')
      .update({ read_at: new Date().toISOString() })
      .eq('entity_id', `${targetId}#${commentId}`)
      .is('read_at', null)
  } catch { /* best-effort */ }
}
