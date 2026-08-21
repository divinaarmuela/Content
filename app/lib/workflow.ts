import 'server-only'
import { supabase } from '@/lib/supabase'
import { notify, renderEmail } from './mailer'
import { AuthzError, type TeamUser } from './authz'
import { announceItemChange } from './production-live'
import {
  checkTransition,
  versionSatisfiesSubmission,
  TRANSITION_NOTIFICATIONS,
  CLIENT_LABELS,
  type ItemStatus,
  type Audience,
} from './workflow-core'

export type ContentItem = {
  id: string
  client_id: string
  batch_id: string | null
  title: string
  content_type: string
  status: ItemStatus
  owner_id: string | null
  caption: string | null
  client_approval_required: boolean
  current_version_number: number
  due_date?: string | null
  updated_at?: string | null
  raw_assets_url?: string | null
  brief?: string | null
  raw_assets?: { url: string; name: string }[] | null
}

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export async function logActivity(input: {
  actor: TeamUser | null
  clientId?: string | null
  entityType: string
  entityId: string
  action: string
  oldValue?: string
  newValue?: string
  detail?: string
}) {
  await supabase.from('workflow_activity').insert({
    actor_id: input.actor?.id ?? null,
    client_id: input.clientId ?? null,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    old_value: input.oldValue ?? null,
    new_value: input.newValue ?? null,
    detail: input.detail ?? null,
  })
}

/** Resolve a notification audience to concrete active people for a client. */
async function resolveAudience(audience: Audience, item: ContentItem): Promise<{ id: string; email: string; name: string }[]> {
  switch (audience) {
    case 'owner_editor': {
      if (!item.owner_id) return []
      const { data } = await supabase.from('team_users')
        .select('id, email, name').eq('id', item.owner_id).eq('active_status', true)
      return data ?? []
    }
    case 'account_managers': {
      const { data } = await supabase
        .from('team_user_clients')
        // the FK must be named: team_user_clients has TWO links to team_users
        // (team_user_id and assigned_by), and the bare embed is ambiguous —
        // PostgREST errors, data comes back null, and the empty-AM fallback
        // then emails every super admin on every transition.
        .select('team_users!team_user_clients_team_user_id_fkey!inner(id, email, name, role, active_status)')
        .eq('client_id', item.client_id)
      const ams = (data ?? [])
        .map(r => r.team_users as unknown as { id: string; email: string; name: string; role: string; active_status: boolean })
        // anyone ASSIGNED as this client's manager hears about it — a super
        // admin who manages a client is still its account manager
        .filter(u => (u.role === 'account_manager' || u.role === 'super_admin') && u.active_status)
      if (ams.length > 0) return ams
      // fall back to super admins so nothing goes unnoticed on unassigned clients
      const { data: admins } = await supabase.from('team_users')
        .select('id, email, name').eq('role', 'super_admin').eq('active_status', true)
      return admins ?? []
    }
    case 'schedulers': {
      const { data } = await supabase.from('team_users')
        .select('id, email, name').eq('role', 'scheduler').eq('active_status', true)
      return data ?? []
    }
    case 'client_users': {
      const { data } = await supabase.from('team_users')
        .select('id, email, name').eq('role', 'client').eq('client_id', item.client_id).eq('active_status', true)
      return data ?? []
    }
  }
}

/** Directly-uploaded source files on a job: [{url, name}], server-validated. */
export function sanitiseRawAssets(raw: unknown): { url: string; name: string }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((a): a is { url?: unknown; name?: unknown } => !!a && typeof a === 'object')
    .map(a => ({ url: String(a.url ?? '').slice(0, 2000), name: String(a.name ?? '').slice(0, 200) }))
    .filter(a => /^https:\/\//.test(a.url))
    .slice(0, 50)
}

/**
 * The job handoff email: "you've been assigned this edit" with the brief,
 * the raw assets link, and the due date — everything an editor needs to
 * start. Fired when an item is created with an owner, or re-assigned.
 * Fire-and-forget like every notification; never blocks the write.
 */
export function notifyJobAssigned(actor: TeamUser, item: ContentItem) {
  if (!item.owner_id || item.owner_id === actor.id) return
  void (async () => {
    const { data: editor } = await supabase
      .from('team_users')
      .select('id, email, name')
      .eq('id', item.owner_id)
      .eq('active_status', true)
      .maybeSingle()
    if (!editor) return
    await notify({
      actorName: actor.name,
      actorEmail: actor.email,
      actorClerkId: actor.clerk_user_id,
      eventType: 'job_assigned',
      entityType: 'content_item',
      // re-assignment to the same person after someone else held it should
      // notify again — key on the owner, not just the item
      // updated_at is part of the key so re-assigning an item back to a
      // previous owner notifies again — the id#owner pair alone never did
      entityId: `${item.id}#${item.owner_id}#${item.updated_at ?? ''}`,
      recipientId: editor.id,
      recipientEmail: editor.email,
      subject: `New job: ${item.title}`,
      bodyHtml: renderEmail(
        `New job: ${item.title}`,
        `<p><strong>${item.title}</strong> (${item.content_type}) has been assigned to you by ${actor.name || actor.email}.</p>` +
        (item.brief ? `<p><strong>Brief:</strong><br>${String(item.brief).slice(0, 2000).replace(/\n/g, '<br>')}</p>` : '') +
        (item.raw_assets_url ? `<p><strong>Raw assets folder:</strong> <a href="${item.raw_assets_url}">${item.raw_assets_url}</a></p>` : '') +
        ((item.raw_assets?.length ?? 0) > 0
          ? `<p><strong>Files:</strong><br>${item.raw_assets!.slice(0, 20).map(a => `<a href="${a.url}">${a.name || a.url}</a>`).join('<br>')}</p>`
          : '') +
        (item.due_date ? `<p><strong>Due:</strong> ${item.due_date}</p>` : ''),
        'Open the job',
        `${DASHBOARD_URL}/dashboard/production/${item.id}`
      ),
    })
  })().catch(e => console.error('job-assigned notification error:', e))
}

/**
 * "Please schedule this" — the manager hands an approved item to specific
 * schedulers. Used after a CLIENT approves (the client cannot pick, so the
 * approval fans out to everyone; this narrows it to the right person).
 */
export async function notifyScheduleHandoff(
  actor: TeamUser,
  item: ContentItem,
  schedulerIds: string[],
): Promise<number> {
  const ids = schedulerIds.filter(x => typeof x === 'string').slice(0, 20)
  if (ids.length === 0) return 0
  const { data } = await supabase
    .from('team_users')
    .select('id, email, name, role, active_status')
    .in('id', ids)
  const people = (data ?? []).filter(u =>
    u.active_status && (u.role === 'scheduler' || u.role === 'super_admin') && u.id !== actor.id)
  await Promise.all(people.map(p => notify({
    actorName: actor.name,
    actorEmail: actor.email,
    actorClerkId: actor.clerk_user_id,
    eventType: 'schedule_handoff',
    entityType: 'content_item',
    // per-person per-version: handing the next revision to the same person
    // notifies again; a retried click cannot double-send
    entityId: `${item.id}#handoff#${p.id}#v${item.current_version_number}`,
    recipientId: p.id,
    recipientEmail: p.email,
    subject: `Please schedule: ${item.title}`,
    bodyHtml: renderEmail(
      `Please schedule: ${item.title}`,
      `<p><strong>${item.title}</strong> is approved and ${actor.name || actor.email} picked you to schedule it.</p>` +
      (item.due_date ? `<p><strong>Due:</strong> ${item.due_date}</p>` : ''),
      'Open the item',
      `${DASHBOARD_URL}/dashboard/production/${item.id}`
    ),
  })))
  return people.length
}

/**
 * "This went out" — tell the people who answer to the client. The scheduler
 * picks who hears; unpicked, it goes to the client's assigned managers.
 */
export function notifyPublishQueued(
  actor: TeamUser,
  item: ContentItem,
  opts: { jobId: string; publishNow: boolean; recipientIds?: string[] },
) {
  void (async () => {
    let recipients: { id: string; email: string; name: string }[]
    if (opts.recipientIds && opts.recipientIds.length > 0) {
      const { data } = await supabase.from('team_users')
        .select('id, email, name, role')
        .in('id', opts.recipientIds.slice(0, 20))
        .eq('active_status', true)
        .neq('role', 'client')
      recipients = data ?? []
    } else {
      recipients = await resolveAudience('account_managers', item)
    }
    const when = opts.publishNow ? 'is being published now' : 'is queued for its scheduled time'
    await Promise.all(recipients.filter(r => r.id !== actor.id).map(r => notify({
      actorName: actor.name,
      actorEmail: actor.email,
      actorClerkId: actor.clerk_user_id,
      eventType: 'publish_queued',
      entityType: 'content_item',
      entityId: `${item.id}#${opts.jobId}`,
      recipientId: r.id,
      recipientEmail: r.email,
      subject: `${opts.publishNow ? 'Publishing' : 'Scheduled'}: ${item.title}`,
      bodyHtml: renderEmail(
        `${opts.publishNow ? 'Publishing' : 'Scheduled'}: ${item.title}`,
        `<p><strong>${item.title}</strong> ${when} on the client's connected accounts, sent by ${actor.name || actor.email}.</p>`,
        'Open the item',
        `${DASHBOARD_URL}/dashboard/production/${item.id}`
      ),
    })))
  })().catch(e => console.error('publish notification error:', e))
}

/**
 * Execute a status transition with the full guarantee set:
 *  - legality + role permission from the pure state machine
 *  - requirement evidence (reviewable asset / schedule entry / live url)
 *  - optimistic concurrency: UPDATE ... WHERE status = expected. If another
 *    request moved the item first, zero rows update and we return 409 —
 *    no double transitions, ever.
 *  - audit log + exactly-once notifications (dedupe key includes the
 *    from>to edge and version, so a retried request can't double-send).
 */
export async function performTransition(
  actor: TeamUser,
  item: ContentItem,
  to: ItemStatus,
  opts?: {
    /** Chosen reviewers: when the actor picked who should hear about this,
     *  the manager audience becomes exactly those people (validated to be
     *  active managing roles) instead of everyone assigned. */
    reviewerIds?: string[]
    schedulerIds?: string[]
  },
): Promise<ContentItem> {
  const from = item.status
  const check = checkTransition(actor.role, from, to)
  if (!check.ok) throw new AuthzError(check.reason, 403)

  // requirement evidence
  if (check.rule.requires === 'reviewable_asset') {
    const { data: latest } = await supabase
      .from('asset_versions')
      .select('file_url, drive_url, dropbox_url')
      .eq('item_id', item.id)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!latest) throw new AuthzError('Add a version with links before submitting', 400)
    const valid = versionSatisfiesSubmission(latest)
    if (!valid.ok) throw new AuthzError(`Missing: ${valid.missing.join(' and ')}`, 400)
  }
  if (check.rule.requires === 'schedule_entry') {
    const { count } = await supabase
      .from('schedule_entries')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', item.id)
      .not('scheduled_at', 'is', null)
    if (!count) throw new AuthzError('Add at least one platform with a date/time before marking scheduled', 400)
  }
  if (check.rule.requires === 'live_url') {
    const { count } = await supabase
      .from('schedule_entries')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', item.id)
      .not('live_url', 'is', null)
    if (!count) throw new AuthzError('Add the live URL before marking published', 400)
  }

  // optimistic concurrency — the race-condition guard
  const { data: updated, error } = await supabase
    .from('content_items')
    .update({ status: to })
    .eq('id', item.id)
    .eq('status', from)
    .select()
    .maybeSingle()
  if (error) throw new AuthzError(error.message, 500)
  if (!updated) {
    throw new AuthzError('This item was just updated by someone else — refresh and try again', 409)
  }

  await logActivity({
    actor,
    clientId: item.client_id,
    entityType: 'content_item',
    entityId: item.id,
    action: 'status_change',
    oldValue: from,
    newValue: to,
    detail: check.rule.label,
  })

  // approvals history for the decisions that matter
  if (to === 'approved_for_scheduling' || to === 'client_changes_requested') {
    await supabase.from('approvals').insert({
      item_id: item.id,
      approval_type: actor.role === 'client' ? 'client' : from === 'client_review' ? 'client' : 'internal',
      decided_by: actor.id,
      decision: to === 'approved_for_scheduling' ? 'approved' : 'changes_requested',
    })
  }

  // notifications — fire-and-forget; the outbox dedupe makes retries safe
  const audiences = TRANSITION_NOTIFICATIONS[`${from}>${to}`] ?? []
  const isClientFacing = to === 'client_review'
  const reviewerIds = (opts?.reviewerIds ?? []).filter(x => typeof x === 'string').slice(0, 20)
  const schedulerIds = (opts?.schedulerIds ?? []).filter(x => typeof x === 'string').slice(0, 20)
  void (async () => {
    for (const audience of audiences) {
      let people = await resolveAudience(audience, item)
      if (audience === 'account_managers' && reviewerIds.length > 0) {
        // the actor picked their reviewers — honour the choice, but only
        // among active managing roles (a picked editor or a stale id is
        // silently dropped, never trusted)
        const { data: picked } = await supabase
          .from('team_users')
          .select('id, email, name, role, active_status')
          .in('id', reviewerIds)
        const chosen = (picked ?? []).filter(u =>
          u.active_status && (u.role === 'account_manager' || u.role === 'super_admin'))
        if (chosen.length > 0) people = chosen
      }
      if (audience === 'schedulers' && schedulerIds.length > 0) {
        // the approver picked who schedules this — same trust rule as
        // reviewers: only active scheduling roles survive the filter
        const { data: picked } = await supabase
          .from('team_users')
          .select('id, email, name, role, active_status')
          .in('id', schedulerIds)
        const chosen = (picked ?? []).filter(u =>
          u.active_status && (u.role === 'scheduler' || u.role === 'super_admin'))
        if (chosen.length > 0) people = chosen
      }
      for (const person of people) {
        if (person.id === actor.id) continue // don't notify yourself
        const label = audience === 'client_users' ? CLIENT_LABELS[to] : check.rule.label
        const subject = audience === 'client_users'
          ? `${item.title} — ${label}`
          : `${check.rule.label}: ${item.title}`
        await notify({
          actorName: actor.name,
          actorEmail: actor.email,
          actorClerkId: actor.clerk_user_id,
          eventType: `transition_${from}_${to}`,
          entityType: 'content_item',
          // keyed on THIS successful write (updated_at bumps on every update):
          // a repeated edge — even at the same version — notifies again, while
          // a retried request cannot double-send because the optimistic guard
          // 409s before a second write ever happens
          entityId: `${item.id}#${updated.updated_at ?? `v${item.current_version_number}`}`,
          recipientId: person.id,
          recipientEmail: person.email,
          subject,
          bodyHtml: renderEmail(
            subject,
            isClientFacing && audience === 'client_users'
              ? `<p><strong>${item.title}</strong> is ready for your review.</p>`
              : `<p><strong>${item.title}</strong> moved from “${from.replace(/_/g, ' ')}” to “${to.replace(/_/g, ' ')}” by ${actor.name || actor.email}.</p>`,
            // a client account cannot open the team dashboard — send them to
            // their portal; the team gets the item itself
            audience === 'client_users' ? 'Open your portal' : 'Open the item',
            audience === 'client_users'
              ? `${DASHBOARD_URL}/client`
              : `${DASHBOARD_URL}/dashboard/production/${item.id}`
          ),
        })
      }
    }
  })().catch(e => console.error('notification fan-out error:', e))

  // live hint for every open board/queue/calendar/item page
  announceItemChange({ item_id: item.id, client_id: item.client_id, status: to, kind: 'transition' })

  return updated as ContentItem
}

/**
 * Append a new asset version with race-safe numbering: compute next number,
 * insert; on unique-constraint collision (concurrent upload won the number),
 * retry with the next. Bounded retries — no infinite loops.
 */
export async function addVersion(
  actor: TeamUser,
  itemId: string,
  links: { file_url?: string; dropbox_url?: string; drive_url?: string; notes?: string },
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: latest } = await supabase
      .from('asset_versions')
      .select('version_number')
      .eq('item_id', itemId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextNumber = (latest?.version_number ?? 0) + 1

    const { data, error } = await supabase
      .from('asset_versions')
      .insert({
        item_id: itemId,
        version_number: nextNumber,
        file_url: links.file_url ?? '',
        dropbox_url: links.dropbox_url ?? '',
        drive_url: links.drive_url ?? '',
        notes: links.notes ?? null,
        uploaded_by: actor.id,
      })
      .select()
      .single()

    if (!error && data) {
      await supabase.from('content_items')
        .update({ current_version_number: nextNumber })
        .eq('id', itemId)
        .lt('current_version_number', nextNumber) // never move backwards
      await logActivity({
        actor,
        entityType: 'content_item',
        entityId: itemId,
        action: 'version_added',
        newValue: `v${nextNumber}`,
      })
      return data
    }
    if (error && !error.message.includes('duplicate key')) {
      throw new AuthzError(error.message, 500)
    }
    // duplicate version number — another upload won the race; loop and retry
  }
  throw new AuthzError('Could not allocate a version number — please retry', 409)
}
