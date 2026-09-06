import 'server-only'
import { DbError, table } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type {
  Approval, AssetVersion, Batch, ContentItem as ContentItemRow, ScheduleEntry,
  TeamUser as TeamUserRow, TeamUserClient, WorkflowActivity,
} from '@/lib/db-types'
import { notify, renderEmail, escapeHtml } from './mailer'
import {
  transitionSubject, whatHappensNext, longDate, OPEN_ITEM_CTA,
} from './email-voice-core'
import { AuthzError, type TeamUser } from './authz'
import { announceBatchChange, announceItemChange } from './production-live'
import { shouldAutoWrap } from './shoot-lifecycle-core'
import {
  actingRoles,
  checkTransitionAs,
  clientArrivalLine,
  versionSatisfiesSubmission,
  TRANSITIONS,
  TRANSITION_NOTIFICATIONS,
  CLIENT_LABELS,
  STATUS_LABELS,
  type ItemStatus,
  type Audience,
} from './workflow-core'
import type { Role } from './identity-core'
import { systemMayMove } from './posting-card-core'
import { BATCH_TRANSITION_NOTIFICATIONS } from './batch-brief-core'
import { formatWithZone, safeZone, zoneAbbrev, zoneLabel } from './timezone-core'
import {
  BRIEF_STATUS_TURN,
  briefSatisfiesSubmission, checkBriefTaskTransitionAs, itemStatusLabel, SHOOT_BRIEF_SLUG,
} from './brief-task-core'
import { checkTaskTransitionAs, isInternalKind, taskStatusLabel, type KindShape } from './task-kind-core'
import { needsNewVersion } from './claim-core'
// pure, no I/O — the one question "does this client sign every post off"
import { CLIENT_POLICY_UNREADABLE, clientSignsOffEveryPost } from './social-schedule-core'
import { mirrorLatestVersionSoon } from './gdrive-mirror'
import type { Slide } from './version-files-core'

export type ContentItem = {
  id: string
  client_id: string
  batch_id: string | null
  title: string
  content_type: string
  status: ItemStatus
  owner_id: string | null
  /** whoever raised the card — the `creator` notification audience */
  assigned_by?: string | null
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
  await table('workflow_activity').insert({
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
      const owner = await table<TeamUserRow>('team_users').get(item.owner_id)
      return owner && owner.active_status ? [owner] : []
    }
    case 'account_managers': {
      const links = await table<TeamUserClient>('team_user_clients')
        .list({ by: { client_id: item.client_id } })
      const joined = await attachOne(links, 'team_user_id', 'team_users',
        ['id', 'email', 'name', 'role', 'active_status'])
      const ams = joined
        .map(r => r.team_users as unknown as { id: string; email: string; name: string; role: string; active_status: boolean } | null)
        // anyone ASSIGNED as this client's manager hears about it — a super
        // admin who manages a client is still its account manager
        .filter((u): u is { id: string; email: string; name: string; role: string; active_status: boolean } =>
          !!u && (u.role === 'account_manager' || u.role === 'super_admin') && u.active_status)
      if (ams.length > 0) return ams
      // fall back to super admins so nothing goes unnoticed on unassigned clients
      return table<TeamUserRow>('team_users')
        .list({ where: u => u.role === 'super_admin' && u.active_status })
    }
    case 'schedulers':
      return table<TeamUserRow>('team_users')
        .list({ where: u => u.role === 'scheduler' && u.active_status })
    case 'assigned_schedulers': {
      // only the people this item was explicitly handed to — never the whole
      // scheduling team. No handoff yet → nobody.
      const ids = (Array.isArray(item.scheduler_ids) ? item.scheduler_ids : [])
        .filter((x): x is string => typeof x === 'string').slice(0, 20)
      if (ids.length === 0) return []
      return table<TeamUserRow>('team_users')
        .list({ where: u => ids.includes(u.id) && u.active_status })
    }
    case 'client_users':
      return table<TeamUserRow>('team_users').list({
        where: u => u.role === 'client' && u.client_id === item.client_id && u.active_status,
      })
    case 'creator': {
      // whoever raised the card. They are the person the client's answer is
      // really for, and they are not always its owner or its manager.
      const id = typeof item.assigned_by === 'string' ? item.assigned_by : null
      if (!id) return []
      return table<TeamUserRow>('team_users')
        .list({ where: u => u.id === id && u.active_status && u.role !== 'client' })
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
    // a sanity bound, not a quota: a shoot day can be hundreds of files
    .slice(0, 5000)
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
    const owner = await table<TeamUserRow>('team_users').get(item.owner_id!)
    const editor = owner && owner.active_status ? owner : null
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
      subject: `${item.title} is yours to make`,
      bodyHtml: renderEmail(
        `${item.title} is yours to make`,
        `<p><strong>${escapeHtml(item.title)}</strong> (${escapeHtml(item.content_type)}) has been assigned to you by ${escapeHtml(actor.name || actor.email)}.</p>` +
        (item.brief ? `<p><strong>Notes:</strong><br>${String(item.brief).slice(0, 2000).replace(/\n/g, '<br>')}</p>` : '') +
        (item.raw_assets_url ? `<p><strong>Raw assets folder:</strong> <a href="${escapeHtml(item.raw_assets_url)}">${escapeHtml(item.raw_assets_url)}</a></p>` : '') +
        ((item.raw_assets?.length ?? 0) > 0
          ? `<p><strong>Files:</strong><br>${item.raw_assets!.slice(0, 20).map(a => `<a href="${escapeHtml(a.url)}">${escapeHtml(a.name || a.url)}</a>`).join('<br>')}</p>`
          : '') +
        (longDate(item.due_date) ? `<p><strong>Due:</strong> ${escapeHtml(longDate(item.due_date)!)}</p>` : ''),
        OPEN_ITEM_CTA,
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
    const label = to === 'locked' ? 'Shoot booked' : to === 'shot' ? 'Shoot marked as shot' : `Shoot ${to}`
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
            'Open the shoot plan',
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
  const rows = await table<TeamUserRow>('team_users').list({ where: u => ids.includes(u.id) })
  // anyone on the team can be handed scheduling now — the hat follows the
  // assignment, not the job title. Only clients (and the actor) are excluded.
  const people = rows.filter(u =>
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
    subject: `${item.title} needs a posting date`,
    bodyHtml: renderEmail(
      `${item.title} needs a posting date`,
      `<p><strong>${escapeHtml(item.title)}</strong> is signed off, and ${escapeHtml(actor.name || actor.email)} picked you to schedule it.</p>` +
      `<p><strong>What happens next:</strong> ${escapeHtml(whatHappensNext('approved_for_scheduling'))}</p>` +
      (longDate(item.due_date) ? `<p><strong>Due:</strong> ${escapeHtml(longDate(item.due_date)!)}</p>` : ''),
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
  opts: {
    jobId: string; publishNow: boolean; recipientIds?: string[]
    /** when it goes out, and the CLIENT's zone to say it in. An email is read
     *  in a different country from the one that sent it more often than any
     *  other surface here, and "queued for its scheduled time" told a manager
     *  nothing they could act on. */
    scheduledFor?: string | null
    timezone?: string | null
  },
) {
  void (async () => {
    let recipients: { id: string; email: string; name: string }[]
    if (opts.recipientIds && opts.recipientIds.length > 0) {
      const wanted = opts.recipientIds.slice(0, 20)
      recipients = await table<TeamUserRow>('team_users').list({
        where: u => wanted.includes(u.id) && u.active_status && u.role !== 'client',
      })
    } else {
      recipients = await resolveAudience('account_managers', item)
    }
    const tz = safeZone(opts.timezone)
    const at = opts.publishNow ? null : formatWithZone(opts.scheduledFor, tz)
    const when = opts.publishNow
      ? 'is being published now'
      : at ? `is scheduled for ${at}` : 'is queued for its scheduled time'
    const heading = opts.publishNow
      ? `Publishing: ${item.title}`
      : at ? `Scheduled for ${at}: ${item.title}` : `Scheduled: ${item.title}`
    await Promise.all(recipients.filter(r => r.id !== actor.id).map(r => notify({
      actorName: actor.name,
      actorEmail: actor.email,
      actorClerkId: actor.clerk_user_id,
      eventType: 'publish_queued',
      entityType: 'content_item',
      entityId: `${item.id}#${opts.jobId}`,
      recipientId: r.id,
      recipientEmail: r.email,
      subject: heading,
      bodyHtml: renderEmail(
        heading,
        `<p><strong>${escapeHtml(item.title)}</strong> ${when} on the client's connected accounts, sent by ${escapeHtml(actor.name || actor.email)}.</p>`
        // the zone is the client's, and the email says so outright — the
        // reader may well be in another one
        + (at ? `<p>Times are ${zoneLabel(tz)} time (${zoneAbbrev(tz, opts.scheduledFor)}), where the audience is.</p>` : ''),
        'Open the item',
        `${DASHBOARD_URL}/dashboard/production/${item.id}`
      ),
    })))
  })().catch(e => console.error('publish notification error:', e))
}

/**
 * A move nobody pressed a button for.
 *
 * Instagram publishing a post at its scheduled time is a real event with a
 * real consequence for the board, and it has no actor — inventing one (the
 * scheduler who queued it three days ago) would put a person's name on
 * something they did not do. So the system moves it, wearing a label that says
 * where the news came from: "Posted by Instagram".
 *
 * A system actor wears no hat and is bound by `SYSTEM_EDGES` instead — it can
 * only ever record what the provider already did.
 */
export type SystemActor = { system: true; label: string }
export function systemActor(label: string): SystemActor {
  return { system: true, label }
}
function isSystemActor(a: TeamUser | SystemActor): a is SystemActor {
  return (a as SystemActor).system === true
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
/**
 * Wrap a shoot whose every produced piece is published — the derivation
 * shoot-lifecycle-core states, applied. The status is re-checked immediately
 * before the write, so a shoot someone reopened stays reopened; wrapping is
 * idempotent, so the worst a lost race can do is write 'wrapped' twice.
 */
async function autoWrapBatch(batchId: string, byWord: string): Promise<void> {
  try {
    const [batch, siblings] = await Promise.all([
      table<Batch>('batches').get(batchId),
      table<ContentItemRow>('content_items')
        .list({ by: { batch_id: batchId }, limit: 200 })
        .then(rows => attachOne(rows, 'work_kind_id', 'work_kinds', ['slug'])),
    ])
    if (!batch) return
    if (!shouldAutoWrap(batch.status as 'brief' | 'locked' | 'shot' | 'wrapped',
      siblings as unknown as { status: string; work_kinds?: { slug?: string } | null }[])) return
    // the status filter is the optimistic-concurrency guard: a shoot someone
    // reopened, or one another publish already wrapped, is left alone
    if (!['locked', 'shot'].includes(batch.status ?? '')) return
    const wrapped = await table<Batch>('batches').update(batchId, { status: 'wrapped' })
    if (!wrapped) return
    await logActivity({
      actor: null, clientId: batch.client_id,
      entityType: 'batch', entityId: batchId,
      action: 'status_change', oldValue: batch.status ?? undefined, newValue: 'wrapped',
      detail: `closed itself — every piece is published (last one by ${byWord})`,
    })
    announceBatchChange({ batch_id: batchId, client_id: batch.client_id, status: 'wrapped', kind: 'transition' })
  } catch (e) {
    console.error('autoWrapBatch: could not close the shoot', e instanceof Error ? e.message : e)
  }
}

export async function performTransition(
  actor: TeamUser | SystemActor,
  item: ContentItem,
  to: ItemStatus,
  opts?: {
    /** Hats the CALLER has already established by another route, merged into
     *  the ones the item grants. The publish endpoint is the only user: it is
     *  role-gated to schedulers, so anyone who got far enough to hand a post
     *  to a client's live account holds the scheduling for it by definition —
     *  refusing them the status change afterwards is the app disagreeing with
     *  itself. */
    grantedHats?: Role[]
    /** Chosen reviewers: when the actor picked who should hear about this,
     *  the manager audience becomes exactly those people (validated to be
     *  active managing roles) instead of everyone assigned. */
    reviewerIds?: string[]
    schedulerIds?: string[]
    /** A note travelling with the transition (e.g. what to revise) — shown
     *  in the team's notification emails, never the client's. */
    note?: string
    /** Audiences another notification in the same request already reached.
     *  Queueing a post emails the people the scheduler picked, saying exactly
     *  "this is scheduled"; the transition it performs would then say the same
     *  thing again, to the same inboxes, in different words. */
    skipAudiences?: Audience[]
    /** this transition is the APP's own move, not a person pressing a button
     *  — the only way past an `auto` edge. Two callers: the versions route,
     *  and the schedule composer's new-media path. */
    auto?: boolean
  },
): Promise<ContentItem> {
  const from = item.status
  const system = isSystemActor(actor)
  const actorId = system ? null : actor.id
  const actorName = system ? actor.label : actor.name
  const actorEmail = system ? null : actor.email
  /** how the emails name whoever did this — a person, or the channel itself */
  const actorWord = actorName || actorEmail || 'MD Media'

  // a shoot-BRIEF task rides the same machine wearing its own words and
  // evidence: the "asset" under review is the brief itself, and "scheduled"
  // means the shoot is booked — which requires its date to be locked
  const itemRow = item.id ? await table<ContentItemRow>('content_items').get(item.id) : null
  const kindRow = itemRow
    ? (await attachOne(
        await attachOne([itemRow], 'work_kind_id', 'work_kinds', ['slug', 'uses_media']),
        'batch_id', 'batches', ['status', 'concept', 'shot_list'],
      ))[0]
    : null
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
  const hats = system
    ? []
    : [...new Set([
      ...actingRoles({ id: actor.id, role: actor.role }, item),
      ...(opts?.grantedHats ?? []),
    ])]

  // the system is not a role and cannot be given one — it may only record the
  // two edges the provider itself decides, and nothing else, ever
  const check = system
    ? (() => {
      if (!systemMayMove(from, to)) {
        throw new AuthzError(`Nothing may move ${from} → ${to} automatically`, 403)
      }
      const rule = TRANSITIONS[from]?.[to]
      if (!rule) throw new AuthzError(`No transition from ${from} to ${to}`, 400)
      return { ok: true as const, rule }
    })()
    // `auto` goes to ALL THREE forms, not just the asset one. A shoot brief
    // and an internal task ride the same machine and reach the same `auto`
    // edges; forwarding it to only one of them is how the new-version
    // pull-back silently stopped working for two of the three item kinds.
    : isBriefTask
      ? checkBriefTaskTransitionAs(hats, from, to, { auto: opts?.auto })
      : isInternal ? checkTaskTransitionAs(hats, from, to, { auto: opts?.auto })
      : checkTransitionAs(hats, from, to, { auto: opts?.auto })
  if (!check.ok) throw new AuthzError(check.reason, 403)

  /**
   * THE CLIENT'S OWN POLICY, ENFORCED RATHER THAN DISPLAYED.
   *
   * `presentTransitions` hides the `→ approved_for_scheduling` edge on every
   * status except `client_review` when the item requires the client's
   * sign-off — but only on the item page, and only by not drawing a button.
   * Any other surface reaching this function got a different answer to the
   * same question, which is a client policy that holds on one screen and not
   * on another.
   *
   * WHOSE POLICY IT IS (ruled 5 Sep 2026). It is the CLIENT'S:
   * `clients.client_approval_required`, and only when it is explicitly true.
   * This used to read the ITEM's column of the same name, which defaults to
   * true on every piece ever made — so an account manager could not sign off
   * their own client's work without first sending it to a client the agency
   * never agreed to send it to. The item column still routes work through
   * `client_review` in the ordinary way; what it no longer does is speak for
   * the client's contract.
   *
   * The system's own moves are exempt: those are the provider reporting what
   * has already happened, not somebody deciding to skip the client.
   */
  if (!system && to === 'approved_for_scheduling' && from !== 'client_review') {
    /**
     * AND IT FAILS CLOSED.
     *
     * This read used to end in `.catch(() => null)`, which made a dropped
     * connection say "the ordinary arrangement" — i.e. go ahead. The whole
     * job of this gate is the one client who insisted on signing every post
     * off, so "we could not check" has to mean no, said in a sentence that
     * blames us and invites another go. A client row that is genuinely
     * ABSENT is a different answer: there is no policy to honour, and every
     * other gate still applies.
     */
    let client: { id: string; client_approval_required?: unknown } | null
    try {
      client = await table<{ id: string; client_approval_required?: unknown }>('clients')
        .get(item.client_id)
    } catch {
      throw new AuthzError(CLIENT_POLICY_UNREADABLE, 503)
    }
    if (clientSignsOffEveryPost(client)) {
      throw new AuthzError(
        'This client signs their work off themselves — send it to them first', 403)
    }
  }

  if (!system && isBriefTask && 'requires' in check && check.requires === 'batch_locked') {
    if (!briefBatch || !['locked', 'shot'].includes(briefBatch.status ?? '')) {
      // "the brief page" is this page; the date lives on the SHOOT page
      throw new AuthzError('Book the shoot on its page first — the date is set there', 400)
    }
  }

  // Requirement evidence — for people. The system's evidence is the post
  // itself: the provider has already published it, and refusing to record that
  // because a schedule row is missing would leave the board claiming a live
  // post is still waiting.
  if (!system && check.rule.requires === 'reviewable_asset') {
    if (isBriefTask) {
      const ok = briefSatisfiesSubmission(item as { brief_url?: string | null }, briefBatch)
      if (!ok.ok) throw new AuthzError(ok.missing, 400)
    } else if (typeof (item as { link_url?: string | null }).link_url === 'string'
        && (item as { link_url?: string | null }).link_url) {
      // A CARD WITH A LINK IS EVIDENCE ENOUGH.
      //
      // Since the board reset a card is one deliverable with one pasted link —
      // Google Drive or Dropbox — instead of nested versions carrying slides.
      // The old check only ever looked at `asset_versions`, so a link-only card
      // was refused at "Submit for review" with a message telling the person to
      // add the link they had already added.
    } else {
      const latest = (await table<AssetVersion>('asset_versions')
        .list({ by: { item_id: item.id }, orderBy: [['version_number', 'desc']], limit: 1 }))[0] ?? null
      if (isInternal) {
        // a task's evidence is the work itself: a file or a link. No master
        // file — there is no footage to archive
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
  if (!system && !isBriefTask && from === 'revision_required' && to === 'revision_complete') {
    // fetched here rather than borrowed from the requirement branch above: if
    // this edge ever stops requiring a reviewable asset, a borrowed null would
    // block the move forever with a message about a version nobody asked for
    const latestVersion = (await table<AssetVersion>('asset_versions')
      .list({ by: { item_id: item.id }, orderBy: [['version_number', 'desc']], limit: 1 }))[0] ?? null
    const lastRequest = (await table<WorkflowActivity>('workflow_activity').list({
      where: r => r.entity_type === 'content_item' && r.entity_id === item.id
        && r.action === 'status_change' && r.new_value === 'revision_required',
      orderBy: [['created_at', 'desc']],
      limit: 1,
    }))[0] ?? null
    if (needsNewVersion(latestVersion?.created_at ?? null, lastRequest?.created_at ?? null)) {
      throw new AuthzError('Add a new version with the revisions first.', 400)
    }
  }
  // A LINK CARD MOVES ON THE SCHEDULER'S WORD.
  //
  // Since the board reset a card is one deliverable with one pasted link and
  // what needs doing. The scheduler takes the link, posts it where they post
  // (the Schedule page, or the platform itself), and moves the card — Ready
  // to post → Posted. The card never asks for a channel, a time or a live
  // link, so the two evidence checks below apply only to the older media
  // cards, whose posting is recorded in `schedule_entries`.
  const linkCard = typeof (item as { link_url?: string | null }).link_url === 'string'
    && !!(item as { link_url?: string | null }).link_url
  if (!system && !linkCard && check.rule.requires === 'schedule_entry' && !isBriefTask) {
    const count = await table<ScheduleEntry>('schedule_entries')
      .count({ by: { item_id: item.id }, where: r => r.scheduled_at != null })
    if (!count) throw new AuthzError('Add at least one platform with a date/time before marking scheduled', 400)
  }
  if (!system && !linkCard && check.rule.requires === 'live_url') {
    // a platform is "published" once it has a live link OR was marked posted
    // in-app (publish_status flips to 'published' either way) — Stories have
    // no link, so requiring a URL would strand them
    const count = await table<ScheduleEntry>('schedule_entries')
      .count({ by: { item_id: item.id }, where: r => r.publish_status === 'published' })
    if (!count) throw new AuthzError('Add a live link, or mark a platform posted in-app, before publishing', 400)
  }

  // the race-condition guard: the row's CURRENT status is re-read immediately
  // before the write, so a request working from a stale snapshot — the two
  // Approve clicks that arrive together — is refused rather than replaying a
  // transition somebody already made
  const before = await table<ContentItemRow>('content_items').get(item.id)
  if (!before || before.status !== from) {
    throw new AuthzError('This item was just updated by someone else — refresh and try again', 409)
  }
  let updated: ContentItemRow | null
  try {
    updated = await table<ContentItemRow>('content_items').update(item.id, { status: to })
  } catch (e) {
    throw new AuthzError(e instanceof Error ? e.message : 'Could not update the item', 500)
  }
  if (!updated) {
    throw new AuthzError('This item was just updated by someone else — refresh and try again', 409)
  }

  await logActivity({
    // no actor_id for the system, and the label carries who told us instead —
    // "Posted by Instagram" reads correctly in a trail of human names
    actor: system ? null : actor,
    clientId: item.client_id,
    entityType: 'content_item',
    entityId: item.id,
    action: 'status_change',
    oldValue: from,
    newValue: to,
    detail: system ? actor.label : check.rule.label,
  })

  // approvals history for the decisions that matter
  if (!system && (to === 'approved_for_scheduling' || to === 'client_changes_requested')) {
    /**
     * WHO ACTUALLY GAVE THIS APPROVAL.
     *
     * The actor, and nothing else. This line used to read
     * `from === 'client_review' ? 'client' : 'internal'` as well, which was a
     * fair inference for as long as only a client could cause that move — and
     * became a lie the day an account manager could make it too. It filed the
     * manager's own decision in the `approvals` table under the client's name,
     * so a client asking "who approved this?" was answered with themselves.
     *
     * An approval record is a record of a person. Infer nothing.
     */
    await table('approvals').insert({
      item_id: item.id,
      approval_type: actor.role === 'client' ? 'client' : 'internal',
      decided_by: actor.id,
      decision: to === 'approved_for_scheduling' ? 'approved' : 'changes_requested',
    })
  }

  // Sharing a plan with the client IS showing it to them. The shoot's own
  // portal switch used to stay off after this move, so the brief read
  // "Plan with client" while the client could see nothing — two switches
  // for one intention. Turn it on here; an AM can still hide it again.
  if (isBriefTask && to === 'client_review' && item.batch_id) {
    try {
      await table<Batch>('batches').update(item.batch_id, { shared_with_client: true })
    } catch (e) {
      console.error('share plan with client: could not flag the shoot', e instanceof Error ? e.message : e)
    }
  }

  // ── the shoot closes itself ──
  // The last piece going live is the moment a shoot is finished; nobody
  // should have to remember a "Wrapped" button the day after. Best-effort and
  // fire-and-forget: a shoot that cannot wrap right now wraps on the next
  // publish, and a failure here never touches the publish itself.
  if (to === 'published' && item.batch_id) {
    void autoWrapBatch(item.batch_id, actorName || 'the app')
  }

  // ── the archive follows the decision ──
  // Approving a cut is what makes it THE cut, so that is the moment a copy
  // belongs in the shoot's finals; giving it a date is what commits it to a
  // month, so that is the moment a copy belongs under that month. Assets
  // only: a brief has no footage and an internal task has nothing to post.
  if (!isBriefTask && !isInternal) {
    if (to === 'approved_for_scheduling') mirrorLatestVersionSoon(item.id, 'final')
    if (to === 'scheduled') mirrorLatestVersionSoon(item.id, 'scheduled')
  }

  // notifications — fire-and-forget; the outbox dedupe makes retries safe
  const skip = new Set(opts?.skipAudiences ?? [])
  const audiences = (TRANSITION_NOTIFICATIONS[`${from}>${to}`] ?? []).filter(a => !skip.has(a))
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
        const picked = await table<TeamUserRow>('team_users')
          .list({ where: u => reviewerIds.includes(u.id) })
        const chosen = picked.filter(u =>
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
          const picked = await table<TeamUserRow>('team_users')
            .list({ where: u => schedulerIds.includes(u.id) })
          // the actor is NOT filtered out here: an approver who picks only
          // themselves would leave chosen empty and fall back to the default
          // broadcast — the whole team emailed. The loop below skips them.
          const chosen = picked.filter(u =>
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
        if (actorId && person.id === actorId) continue // don't notify yourself
        const label = audience === 'client_users' ? CLIENT_LABELS[to] : check.rule.label
        // The subject used to be the BUTTON THE SENDER PRESSED: "Ask for
        // changes: Winter Reel 3" lands in the editor's inbox reading as an
        // instruction to them, when it means the opposite. It now says what
        // the RECIPIENT has to do, or plainly reports the new stage when the
        // move is not theirs.
        const subject = audience === 'client_users'
          ? `${item.title} — ${label}`
          : transitionSubject({
              title: item.title,
              to,
              stageLabel: stageLabel(to),
              recipientRole: (person as { role?: Role }).role ?? null,
              turns: isBriefTask ? BRIEF_STATUS_TURN : undefined,
            })
        const dueWords = longDate(item.due_date)
        await notify({
          actorName,
          actorEmail,
          actorClerkId: system ? null : actor.clerk_user_id,
          eventType: `transition_${from}_${to}`,
          entityType: 'content_item',
          // keyed on THIS successful write (updated_at bumps on every update):
          // a repeated edge — even at the same version — notifies again, while
          // a retried request cannot double-send because the optimistic guard
          // 409s before a second write ever happens
          entityId: `${item.id}#${updated.updated_at ?? `v${item.current_version_number}`}`,
          recipientId: person.id,
          recipientEmail: person.email,
          // so PAUSE_CLIENT_NOTIFICATIONS can hold the client's side back
          // during a rebuild while the team keeps hearing everything
          toClient: audience === 'client_users',
          subject,
          bodyHtml: renderEmail(
            subject,
            isClientFacing && audience === 'client_users'
              ? isBriefTask
                // the plan and the piece are different things to a client, and
                // the portal shows each in its own place
                ? `<p>Your shoot plan for <strong>${item.title}</strong> is ready for you to look over.</p>` +
                  `<p>Open your portal to approve it or tell us what to change — it&rsquo;s under Shoot plans.</p>`
                // a piece coming BACK from approved carries a different
                // sentence: they already said yes to the old version once
                : `<p><strong>${item.title}</strong> — ${clientArrivalLine(from)}</p>`
              // the raw status is a database value, not a sentence — every
              // human-facing surface says the same plain words, and a shoot
              // brief says them its own way ("Shoot booked", not "Published")
              : `<p><strong>${escapeHtml(item.title)}</strong> moved from “${escapeHtml(stageLabel(from))}” to “${escapeHtml(stageLabel(to))}” by ${escapeHtml(actorWord)}.</p>` +
                // it never said what the reader had to do, or by when,
                // with the due date sitting right there in scope
                `<p><strong>What happens next:</strong> ${escapeHtml(whatHappensNext(to))}</p>` +
                (dueWords ? `<p><strong>Due:</strong> ${escapeHtml(dueWords)}</p>` : '') +
                (opts?.note?.trim() && audience !== 'client_users'
                  ? `<p><strong>Note:</strong><br>${escapeHtml(opts.note.trim()).replace(/\n/g, '<br>')}</p>`
                  : ''),
            // a client account cannot open the team dashboard — send them to
            // their portal; the team gets the item itself
            audience === 'client_users' ? 'Open your portal' : OPEN_ITEM_CTA,
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
  links: {
    file_url?: string; dropbox_url?: string; drive_url?: string; notes?: string
    /** the ordered slides of a carousel — already normalised by the caller */
    files?: Slide[]
  },
) {
  // `file_url` is slide one, always. Every reader written before carousels
  // existed — the portal preview, the mirror, the publish planner — points at
  // that column, so a multi-slide version still shows and still publishes
  // something real to anything that has not been taught about `files` yet.
  const slides = links.files ?? []
  const firstUrl = links.file_url ?? slides[0]?.url ?? ''
  /**
   * WHERE THE FILES CAME FROM, recorded on the version itself.
   *
   * Read off the slides rather than passed in, so there is one answer and no
   * caller can disagree with the files it just handed over. `'drive'` the
   * moment ANY slide was picked out of the agency's Drive: the point of the
   * column is "this version contains files that are already in Drive", and
   * one of them is enough to make copying the set back wrong. The Drive file
   * id is the first picked slide's — the rest travel on `files`, one per
   * slide.
   */
  const picked = slides.filter(s => s.source === 'drive')
  const source = picked.length > 0 ? 'drive' : null
  for (let attempt = 0; attempt < 5; attempt++) {
    const existing = await table<AssetVersion>('asset_versions')
      .list({ by: { item_id: itemId }, orderBy: [['version_number', 'desc']] })
    const nextNumber = (existing[0]?.version_number ?? 0) + 1

    // (item_id, version_number) was unique in Postgres, and it still is: a
    // version row's id IS `<item_id>__<version_number>`, so the insert of a
    // number a concurrent upload already took is refused rather than
    // overwriting it — which is what sends us round the loop below.
    let data: AssetVersion
    try {
      data = await table('asset_versions').insert({
        item_id: itemId,
        version_number: nextNumber,
        file_url: firstUrl,
        files: slides,
        dropbox_url: links.dropbox_url ?? '',
        drive_url: links.drive_url ?? '',
        notes: links.notes ?? null,
        uploaded_by: actor.id,
        source,
        source_drive_file_id: picked[0]?.drive_file_id ?? null,
      }) as unknown as AssetVersion
    } catch (e) {
      if (e instanceof DbError && e.code === 'unique') continue
      throw new AuthzError(e instanceof Error ? e.message : 'Could not add the version', 500)
    }

    const item = await table<ContentItemRow>('content_items').get(itemId)
    // never move backwards
    if (item && item.current_version_number < nextNumber) {
      await table<ContentItemRow>('content_items')
        .update(itemId, { current_version_number: nextNumber })
    }
    await logActivity({
      actor,
      entityType: 'content_item',
      entityId: itemId,
      action: 'version_added',
      newValue: `v${nextNumber}`,
    })
    return data
  }
  throw new AuthzError('Could not allocate a version number — please retry', 409)
}
