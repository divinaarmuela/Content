import 'server-only'
import { supabase } from '@/lib/supabase'
import { notify, renderEmail, escapeHtml } from './mailer'
import { AuthzError, type TeamUser } from './authz'
import { announceItemChange } from './production-live'
import {
  actingRoles,
  checkTransitionAs,
  versionSatisfiesSubmission,
  TRANSITION_NOTIFICATIONS,
  CLIENT_LABELS,
  STATUS_LABELS,
  type ItemStatus,
  type Audience,
} from './workflow-core'
import { BATCH_TRANSITION_NOTIFICATIONS } from './batch-brief-core'
import {
  briefSatisfiesSubmission, checkBriefTaskTransitionAs, itemStatusLabel, SHOOT_BRIEF_SLUG,
} from './brief-task-core'
import { checkTaskTransitionAs, isInternalKind, taskStatusLabel, type KindShape } from './task-kind-core'
import { needsNewVersion } from './claim-core'

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
  brief_url?: string | null
  brief?: string | null
  raw_assets?: { url: string; name: string }[] | null
  /** schedulers this item was explicitly handed to (handoff route) */
  scheduler_ids?: string[] | null
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
    case 'assigned_schedulers': {
      // only the people this item was explicitly handed to — never the whole
      // scheduling team. No handoff yet → nobody.
      const ids = (Array.isArray(item.scheduler_ids) ? item.scheduler_ids : [])
        .filter((x): x is string => typeof x === 'string').slice(0, 20)
      if (ids.length === 0) return []
      const { data } = await supabase.from('team_users')
        .select('id, email, name').in('id', ids).eq('active_status', true)
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
        `<p><strong>${escapeHtml(item.title)}</strong> (${escapeHtml(item.content_type)}) has been assigned to you by ${escapeHtml(actor.name || actor.email)}.</p>` +
        (item.brief ? `<p><strong>Brief:</strong><br>${String(item.brief).slice(0, 2000).replace(/\n/g, '<br>')}</p>` : '') +
        (item.raw_assets_url ? `<p><strong>Raw assets folder:</strong> <a href="${escapeHtml(item.raw_assets_url)}">${escapeHtml(item.raw_assets_url)}</a></p>` : '') +
        ((item.raw_assets?.length ?? 0) > 0
          ? `<p><strong>Files:</strong><br>${item.raw_assets!.slice(0, 20).map(a => `<a href="${escapeHtml(a.url)}">${escapeHtml(a.name || a.url)}</a>`).join('<br>')}</p>`
          : '') +
        (item.due_date ? `<p><strong>Due:</strong> ${item.due_date}</p>` : ''),
        'Open the job',
        `${DASHBOARD_URL}/dashboard/production/${item.id}`
      ),
    })
  })().catch(e => console.error('job-assigned notification error:', e))
}

/**
 * A shoot brief's lifecycle moments, told to the people they commit:
 * locking a date informs the brief's owner and the client's managers;
 * "shot" tells the managers footage exists and production can start.
 */
export function notifyBatchTransition(
  actor: TeamUser,
  batch: { id: string; client_id: string; title: string; owner_id?: string | null; shoot_date?: string | null },
  from: string,
  to: string,
) {
  const audiences = BATCH_TRANSITION_NOTIFICATIONS[`${from}>${to}`] ?? []
  if (audiences.length === 0) return
  void (async () => {
    const stub: ContentItem = {
      id: batch.id, client_id: batch.client_id, batch_id: batch.id,
      title: batch.title, content_type: 'other', status: 'draft_uploaded',
      owner_id: batch.owner_id ?? null, caption: null,
      client_approval_required: false, current_version_number: 0,
    }
    const label = to === 'locked' ? 'Shoot date locked' : to === 'shot' ? 'Shoot marked as shot' : `Shoot ${to}`
    const when = batch.shoot_date
      ? new Date(batch.shoot_date).toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'long', day: 'numeric', month: 'long' })
      : null
    for (const audience of audiences) {
      const people = await resolveAudience(audience, stub)
      for (const person of people) {
        if (person.id === actor.id) continue
        await notify({
          actorName: actor.name,
          actorEmail: actor.email,
          actorClerkId: actor.clerk_user_id,
          eventType: `batch_${from}_${to}`,
          entityType: 'batch',
          entityId: `${batch.id}#${from}>${to}#${Date.now()}`,
          recipientId: person.id,
          recipientEmail: person.email,
          subject: `${label}: ${batch.title}`,
          bodyHtml: renderEmail(
            `${label}: ${batch.title}`,
            `<p><strong>${escapeHtml(batch.title)}</strong> — ${label.toLowerCase()} by ${escapeHtml(actor.name || actor.email)}.</p>` +
            (when && to === 'locked' ? `<p><strong>Shoot date:</strong> ${when}</p>` : ''),
            'Open the brief',
            `${DASHBOARD_URL}/dashboard/production/shoots/${batch.id}`
          ),
        })
      }
    }
  })().catch(e => console.error('batch transition notification error:', e))
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
  // anyone on the team can be handed scheduling now — the hat follows the
  // assignment, not the job title. Only clients (and the actor) are excluded.
  const people = (data ?? []).filter(u =>
    u.active_status && u.role !== 'client' && u.id !== actor.id)
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
    /** A note travelling with the transition (e.g. what to revise) — shown
     *  in the team's notification emails, never the client's. */
    note?: string
  },
): Promise<ContentItem> {
  const from = item.status

  // a shoot-BRIEF task rides the same machine wearing its own words and
  // evidence: the "asset" under review is the brief itself, and "scheduled"
  // means the shoot is booked — which requires its date to be locked
  const { data: kindRow } = item.id
    ? await supabase.from('content_items')
        .select('work_kinds(slug, uses_media), batches(status, concept, shot_list)')
        .eq('id', item.id).maybeSingle()
    : { data: null }
  const kindSlug = (kindRow?.work_kinds as { slug?: string } | null)?.slug ?? null
  const briefBatch = (kindRow?.batches as { status?: string; concept?: string | null; shot_list?: unknown[] } | null) ?? null
  const isBriefTask = kindSlug === SHOOT_BRIEF_SLUG
  const isInternal = isInternalKind(kindRow?.work_kinds as KindShape)
  /** what a stage is CALLED, in this item's own vocabulary */
  const stageLabel = (s: ItemStatus) => isInternal
    ? taskStatusLabel(kindRow?.work_kinds as KindShape, s, STATUS_LABELS[s])
    : itemStatusLabel(kindSlug, s, STATUS_LABELS[s])

  // rights follow ASSIGNMENT, not job title: the hats this actor wears on
  // THIS item decide the move, so an editor handed a scheduling job can
  // schedule it and an editor who holds nothing here can move nothing
  const hats = actingRoles({ id: actor.id, role: actor.role }, item)

  const check = isBriefTask
    ? checkBriefTaskTransitionAs(hats, from, to)
    : isInternal ? checkTaskTransitionAs(hats, from, to)
    : checkTransitionAs(hats, from, to)
  if (!check.ok) throw new AuthzError(check.reason, 403)

  if (isBriefTask && 'requires' in check && check.requires === 'batch_locked') {
    if (!briefBatch || !['locked', 'shot'].includes(briefBatch.status ?? '')) {
      // "the brief page" is this page; the date lives on the SHOOT page
      throw new AuthzError('Lock the shoot date on the shoot page before booking it', 400)
    }
  }

  // requirement evidence
  if (check.rule.requires === 'reviewable_asset') {
    if (isBriefTask) {
      const ok = briefSatisfiesSubmission(item as { brief_url?: string | null }, briefBatch)
      if (!ok.ok) throw new AuthzError(ok.missing, 400)
    } else {
      const { data: latest } = await supabase
        .from('asset_versions')
        .select('file_url, drive_url, dropbox_url, created_at')
        .eq('item_id', item.id)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (isInternal) {
        // a task's evidence is the work itself: a file or a link. No Dropbox
        // master — there is no footage to archive
        if (!latest || (!latest.file_url && !latest.drive_url)) {
          throw new AuthzError('Attach the work first — upload a file or add a link, then submit', 400)
        }
      } else {
        if (!latest) throw new AuthzError('Add a version with links before submitting', 400)
        const valid = versionSatisfiesSubmission(latest)
        if (!valid.ok) throw new AuthzError(`Missing: ${valid.missing.join(' and ')}`, 400)
      }
    }
  }

  // "Revisions done" has to mean a revision HAPPENED. Re-submitting the same
  // cut the manager just rejected sends it round the loop unchanged; the
  // audit trail already knows when changes were asked for, so compare against
  // it. An item with no such record predates the trail — let it through.
  if (!isBriefTask && from === 'revision_required' && to === 'revision_complete') {
    // fetched here rather than borrowed from the requirement branch above: if
    // this edge ever stops requiring a reviewable asset, a borrowed null would
    // block the move forever with a message about a version nobody asked for
    const { data: latestVersion } = await supabase
      .from('asset_versions')
      .select('created_at')
      .eq('item_id', item.id)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    const { data: lastRequest } = await supabase
      .from('workflow_activity')
      .select('created_at')
      .eq('entity_type', 'content_item')
      .eq('entity_id', item.id)
      .eq('action', 'status_change')
      .eq('new_value', 'revision_required')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (needsNewVersion(latestVersion?.created_at ?? null, lastRequest?.created_at ?? null)) {
      throw new AuthzError('Add a new version with the revisions first.', 400)
    }
  }
  if (check.rule.requires === 'schedule_entry' && !isBriefTask) {
    const { count } = await supabase
      .from('schedule_entries')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', item.id)
      .not('scheduled_at', 'is', null)
    if (!count) throw new AuthzError('Add at least one platform with a date/time before marking scheduled', 400)
  }
  if (check.rule.requires === 'live_url') {
    // a platform is "published" once it has a live link OR was marked posted
    // in-app (publish_status flips to 'published' either way) — Stories have
    // no link, so requiring a URL would strand them
    const { count } = await supabase
      .from('schedule_entries')
      .select('id', { count: 'exact', head: true })
      .eq('item_id', item.id)
      .eq('publish_status', 'published')
    if (!count) throw new AuthzError('Add a live link, or mark a platform posted in-app, before publishing', 400)
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

  // Sharing a plan with the client IS showing it to them. The shoot's own
  // portal switch used to stay off after this move, so the brief read
  // "Plan with client" while the client could see nothing — two switches
  // for one intention. Turn it on here; an AM can still hide it again.
  if (isBriefTask && to === 'client_review' && item.batch_id) {
    const { error: shareErr } = await supabase.from('batches')
      .update({ shared_with_client: true }).eq('id', item.batch_id)
    if (shareErr) console.error('share plan with client: could not flag the shoot', shareErr.message)
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
      if (audience === 'assigned_schedulers') {
        if (schedulerIds.length > 0) {
          // the approver picked who schedules this — same trust rule as
          // reviewers, but the pool is the whole team: scheduling is an
          // assignment, so a stale id or a client account is all that is
          // dropped. The item's own scheduler_ids are written AFTER this runs,
          // so the pre-transition snapshot resolveAudience saw is empty and
          // the pick is the only thing that knows who was chosen.
          const { data: picked } = await supabase
            .from('team_users')
            .select('id, email, name, role, active_status')
            .in('id', schedulerIds)
          // the actor is NOT filtered out here: an approver who picks only
          // themselves would leave chosen empty and fall back to the default
          // broadcast — the whole team emailed. The loop below skips them.
          const chosen = (picked ?? []).filter(u =>
            u.active_status && u.role !== 'client')
          if (chosen.length > 0) people = chosen
        } else if (people.length === 0 && to === 'approved_for_scheduling') {
          // approved and handed to nobody: the queue is open, so every
          // scheduler hears "anyone can pick it up". Silence here was the bug —
          // the status says it is their turn and no email ever said so.
          people = await resolveAudience('schedulers', item)
        }
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
              ? isBriefTask
                // the plan and the piece are different things to a client, and
                // the portal shows each in its own place
                ? `<p>Your shoot plan for <strong>${item.title}</strong> is ready for you to look over.</p>` +
                  `<p>Open your portal to approve it or tell us what to change — it&rsquo;s under Shoot plans.</p>`
                : `<p><strong>${item.title}</strong> is ready for your review.</p>`
              // the raw status is a database value, not a sentence — every
              // human-facing surface says the same plain words, and a shoot
              // brief says them its own way ("Shoot booked", not "Published")
              : `<p><strong>${item.title}</strong> moved from “${stageLabel(from)}” to “${stageLabel(to)}” by ${actor.name || actor.email}.</p>` +
                (opts?.note?.trim() && audience !== 'client_users'
                  ? `<p><strong>Note:</strong><br>${escapeHtml(opts.note.trim()).replace(/\n/g, '<br>')}</p>`
                  : ''),
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
