import 'server-only'
import { supabase } from '@/lib/supabase'
import { AuthzError, type TeamUser } from './authz'
import { actingRoles } from './workflow-core'
import { logActivity } from './workflow'
import { announceItemChange } from './production-live'
import { notify, renderEmail, escapeHtml } from './mailer'
import { formatWithZone, safeZone, zoneAbbrev, zoneLabel } from './timezone-core'
import { platformLabel } from './posting-card-core'
import {
  maySendPostApproval, mayApprovePost, nextApprovalState, parseApprovalState,
  type ApprovalAction, type PostingApprovalState,
} from './posting-approval-core'

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/**
 * Final-post approval, server side — the one place the state is written.
 *
 * The route is a thin wrapper around actOnPostingApproval; the E2E role-play
 * calls it directly, which is the point of it living here (the same shape as
 * upsertScheduleEntry). Every write is optimistically concurrent: the UPDATE
 * carries the expected current state, and zero rows means somebody answered
 * first.
 *
 * TOLERANT throughout: on a database where supabase/posting_approval.sql has
 * not been run, reads degrade to "the gate is not in use" and writes explain
 * themselves instead of stack-tracing.
 */

type ApprovableItem = {
  id: string
  client_id: string
  status: string
  title?: string
  caption?: string | null
  owner_id?: string | null
  scheduler_ids?: unknown
  platform_targets?: unknown
  posting_approval_state?: unknown
  posting_client_required?: unknown
}

/** Does this row's shape carry the columns at all? A row selected with '*'
 *  from a migrated database has the key (even when null); an unmigrated one
 *  does not. */
export function postingApprovalSupported(row: Record<string, unknown>): boolean {
  return 'posting_approval_state' in row
}

/** The item's gate, read tolerantly off a '*' row — what the detail payload
 *  sends the posting card. */
export function readPostingApproval(row: Record<string, unknown>): {
  supported: boolean
  state: PostingApprovalState | null
  client_required: boolean
  note: string | null
  approved_at: string | null
} {
  return {
    supported: postingApprovalSupported(row),
    state: parseApprovalState(row.posting_approval_state),
    client_required: row.posting_client_required === true,
    note: typeof row.posting_approval_note === 'string' ? row.posting_approval_note : null,
    approved_at: typeof row.posting_approved_at === 'string' ? row.posting_approved_at : null,
  }
}

/**
 * The posting_approval_state of one item, straight from the database — the
 * publish planner's read. Missing column (or any read error) degrades to
 * null, which is "the gate is not in use": exactly today's behaviour.
 */
export async function postingApprovalStateOf(itemId: string): Promise<PostingApprovalState | null> {
  const { data, error } = await supabase
    .from('content_items')
    .select('posting_approval_state')
    .eq('id', itemId)
    .maybeSingle()
  if (error) return null // column not migrated yet — behave as before it existed
  return parseApprovalState(data?.posting_approval_state)
}

export type PostingApprovalInput = {
  action: ApprovalAction
  /** what should change / anything with the yes */
  note?: string
  /** send only: also route it to the client's portal for their sign-off */
  client_too?: boolean
}

/** The preview facts the approver's email carries — worked out once here so
 *  the mail and the portal say the same thing. */
async function previewFacts(item: ApprovableItem): Promise<{
  whenLine: string | null
  platforms: string
  tz: string
}> {
  const [{ data: client }, { data: entries }] = await Promise.all([
    supabase.from('clients').select('timezone').eq('id', item.client_id).maybeSingle(),
    supabase.from('schedule_entries')
      .select('platform, scheduled_at')
      .eq('item_id', item.id)
      .not('scheduled_at', 'is', null)
      .order('scheduled_at', { ascending: true }),
  ])
  const tz = safeZone(client?.timezone as string | null)
  const first = entries?.[0] ?? null
  const targets = Array.isArray(item.platform_targets) ? item.platform_targets.map(String) : []
  const names = [...new Set([
    ...(entries ?? []).map(e => String(e.platform)),
    ...targets,
  ])].map(platformLabel)
  return {
    whenLine: first?.scheduled_at
      ? `${formatWithZone(first.scheduled_at as string, tz)} — ${zoneLabel(tz)} time (${zoneAbbrev(tz, first.scheduled_at as string)})`
      : null,
    platforms: names.length > 0 ? names.join(', ') : 'the connected channels',
    tz,
  }
}

/** the client's assigned account managers (super admins included), active only */
async function clientManagers(clientId: string): Promise<{ id: string; email: string; name: string }[]> {
  const { data } = await supabase
    .from('team_user_clients')
    .select('team_users!team_user_clients_team_user_id_fkey!inner(id, email, name, role, active_status)')
    .eq('client_id', clientId)
  return (data ?? [])
    .map(r => r.team_users as unknown as { id: string; email: string; name: string; role: string; active_status: boolean })
    .filter(u => (u.role === 'account_manager' || u.role === 'super_admin') && u.active_status)
}

/** the people holding the scheduling of this item, plus its owner */
async function itemSchedulingPeople(item: ApprovableItem): Promise<{ id: string; email: string; name: string }[]> {
  const ids = [
    ...(Array.isArray(item.scheduler_ids) ? item.scheduler_ids.map(String) : []),
    ...(item.owner_id ? [String(item.owner_id)] : []),
  ].slice(0, 20)
  if (ids.length === 0) return []
  const { data } = await supabase
    .from('team_users').select('id, email, name')
    .in('id', ids).eq('active_status', true)
  return data ?? []
}

/** the email the approver gets: the post as it will actually appear */
function previewHtml(item: ApprovableItem, facts: { whenLine: string | null; platforms: string }): string {
  const caption = (item.caption ?? '').trim()
  return (
    `<p><strong>${escapeHtml(item.title ?? 'A post')}</strong> is ready to go out and needs your sign-off on the final post.</p>` +
    `<p><strong>Where:</strong> ${escapeHtml(facts.platforms)}</p>` +
    (facts.whenLine ? `<p><strong>When:</strong> ${escapeHtml(facts.whenLine)}</p>` : '<p><strong>When:</strong> as soon as it is approved</p>') +
    `<p><strong>Caption, exactly as it will post:</strong></p>` +
    `<p style="border-left:3px solid #e4e4e7;padding-left:12px;white-space:pre-wrap;">${caption ? escapeHtml(caption) : '<em>(no caption — it would go out with the title as its text)</em>'}</p>`
  )
}

/**
 * Perform one final-post approval action as this person, with the hat checks:
 * the scheduling hat (or the owner, or a super admin) sends; the client's
 * account manager or a super admin approves / asks for changes. Returns the
 * updated row.
 */
export async function actOnPostingApproval(
  actor: TeamUser,
  item: ApprovableItem,
  input: PostingApprovalInput,
): Promise<Record<string, unknown>> {
  const hats = actingRoles({ id: actor.id, role: actor.role }, item)
  const note = String(input.note ?? '').trim().slice(0, 2000)

  if (input.action === 'send') {
    if (!maySendPostApproval(hats)) {
      throw new AuthzError('Only the person scheduling this may send it for approval', 403)
    }
    // the gate guards the queue, so it only makes sense on a signed-off asset
    if (!['approved_for_scheduling', 'scheduled'].includes(item.status)) {
      throw new AuthzError('The item itself has to be approved before its post can be', 400)
    }
  } else {
    if (!mayApprovePost(hats)) {
      throw new AuthzError('Only an account manager (or the client) can approve the final post', 403)
    }
    if (input.action === 'request_changes' && !note) {
      throw new AuthzError('Say what should change — a short note is enough', 400)
    }
  }

  const move = nextApprovalState(item.posting_approval_state, input.action)
  if (!move.ok) throw new AuthzError(move.reason, 409)

  const patch: Record<string, unknown> = { posting_approval_state: move.state }
  if (input.action === 'send') {
    // a fresh ask wipes the old answer
    patch.posting_approved_by = null
    patch.posting_approved_at = null
    patch.posting_approval_note = null
    if (input.client_too !== undefined) patch.posting_client_required = input.client_too === true
  }
  if (input.action === 'approve') {
    patch.posting_approved_by = actor.id
    patch.posting_approved_at = new Date().toISOString()
    if (note) patch.posting_approval_note = note
  }
  if (input.action === 'request_changes') {
    patch.posting_approval_note = note
    patch.posting_approved_by = null
    patch.posting_approved_at = null
  }

  // optimistic concurrency on the state itself: two people answering at once
  // resolve to exactly one write. `is` for null (an unsent gate), `eq` else.
  const current = parseApprovalState(item.posting_approval_state)
  let q = supabase.from('content_items').update(patch).eq('id', item.id)
  q = current === null
    ? q.or('posting_approval_state.is.null,posting_approval_state.eq.draft')
    : q.eq('posting_approval_state', current)
  const { data: updated, error } = await q.select().maybeSingle()
  if (error) {
    // the one honest sentence for an unmigrated database
    if (/posting_approval_state|column|schema cache/i.test(error.message)) {
      throw new AuthzError('Final post approval is not set up on this database yet — run supabase/posting_approval.sql first', 400)
    }
    throw new AuthzError(error.message, 500)
  }
  if (!updated) {
    throw new AuthzError('Somebody answered this post while you were looking — refresh to see where it stands', 409)
  }

  await logActivity({
    actor, clientId: item.client_id,
    entityType: 'content_item', entityId: item.id,
    action: input.action === 'send' ? 'posting_approval_sent'
      : input.action === 'approve' ? 'posting_approved'
      : 'posting_changes_requested',
    detail: note || undefined,
  })
  announceItemChange({
    item_id: item.id, client_id: item.client_id, status: item.status, kind: 'updated',
  })

  // notifications — fire-and-forget, the outbox dedupe makes retries safe
  const title = item.title ?? 'A post'
  void (async () => {
    const facts = await previewFacts(item)
    const stamp = new Date().toISOString()
    if (input.action === 'send') {
      // the approver is the client's account manager; client_too additionally
      // surfaces it on the portal, where portal-data reads the same columns
      const managers = await clientManagers(item.client_id)
      for (const m of managers) {
        if (m.id === actor.id) continue
        await notify({
          actorName: actor.name, actorEmail: actor.email, actorClerkId: actor.clerk_user_id,
          eventType: 'posting_approval_requested',
          entityType: 'content_item',
          entityId: `${item.id}#post-approval#${stamp}`,
          recipientId: m.id, recipientEmail: m.email,
          subject: `Approve this post: ${title}`,
          bodyHtml: renderEmail(
            `Approve this post: ${title}`,
            previewHtml(item, facts) +
            `<p>Open the item to approve it or ask for changes — nothing goes out until someone does.</p>`,
            'Review the post',
            `${DASHBOARD_URL}/dashboard/production/${item.id}`,
          ),
        })
      }
    } else {
      // the answer goes back to whoever prepared the post
      const people = await itemSchedulingPeople(item)
      const approved = input.action === 'approve'
      for (const p of people) {
        if (p.id === actor.id) continue
        await notify({
          actorName: actor.name, actorEmail: actor.email, actorClerkId: actor.clerk_user_id,
          eventType: approved ? 'posting_approved' : 'posting_changes_requested',
          entityType: 'content_item',
          entityId: `${item.id}#post-approval#${input.action}#${stamp}`,
          recipientId: p.id, recipientEmail: p.email,
          subject: approved ? `Approved to post: ${title}` : `Post changes asked for: ${title}`,
          bodyHtml: renderEmail(
            approved ? `Approved to post: ${title}` : `Post changes asked for: ${title}`,
            approved
              ? `<p><strong>${escapeHtml(title)}</strong> got its final sign-off from ${escapeHtml(actor.name || actor.email)} — you can queue it now.</p>` +
                (note ? `<p><strong>Note:</strong><br>${escapeHtml(note)}</p>` : '')
              : `<p>${escapeHtml(actor.name || actor.email)} asked for changes before <strong>${escapeHtml(title)}</strong> goes out:</p>` +
                `<p style="border-left:3px solid #e4e4e7;padding-left:12px;">${escapeHtml(note)}</p>` +
                `<p>Update the caption or the media, then send it for approval again.</p>`,
            'Open the item',
            `${DASHBOARD_URL}/dashboard/production/${item.id}`,
          ),
        })
      }
    }
  })().catch(e => console.error('posting-approval notification error:', e))

  return updated as Record<string, unknown>
}
