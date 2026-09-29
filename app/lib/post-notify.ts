import 'server-only'
import { table } from '@/lib/db'
import type {
  Client, ClientContact, ContentItem, PostEvent, PostVersion, SocialAccount, SocialPost, TeamUser as TeamUserRow,
  TeamUserClient,
} from '@/lib/db-types'
import { notify, renderEmail, escapeHtml, type NotifyResult } from './mailer'
import { DASHBOARD_URL } from './app-url'
import { formatWithZone, safeZone } from './timezone-core'
import {
  defaultApproveBy, postTitle, postVersionId, readPostState,
  type NotifyTarget, type Plan, type PostAction, type PostEventRow, type PostState,
} from './post-stage-core'
import {
  clientRoundEmail, clientRoundKey, dueApprovalReminder, moveWords,
  planMoveEmails, recipientsFor, reminderWords, roundOutcomeWords,
  teamPostPath, type RoundPost, type Roster, type TeamPerson, type Words,
} from './post-notify-core'
import { clientRecipients, pickRecipients } from './client-recipients-core'
import { portalWaitingPath } from './portal-core'
import { portalPostHref } from './post-page-core'
import { POST_APPROVAL_BOARD } from './overview-links-core'

/**
 * EVERY POSTING EMAIL — the server half (the posting rebuild, 29 Sep 2026;
 * SPEC §7 row P7). The rules and the words are in post-notify-core.ts; this
 * file loads what they need and hands each email to `notify()` (mailer.ts),
 * whose outbox sends each one exactly once.
 *
 * THREE WAYS IN, and who calls each:
 *
 *   notifyPostMove   — the post-stage writer (app/lib/post-stage.ts, P1), AFTER
 *                      its claim has landed, with the plan it ran and the post
 *                      it wrote. The email reports what the landed post says,
 *                      never what the press asked for (audit V14): a Book press
 *                      sends nothing; booking_done sends "Booked in".
 *   sendClientRound  — the act route (P1), for a manager's or the quality
 *                      checker's deliberate send to the client. One email per
 *                      person per round, in Divina's name. It returns who it
 *                      reached, and the route plans the move only when that is
 *                      somebody (audit P9: a failed email changes nothing).
 *   sendApprovalReminders — a cron (see the report: the existing 15-minute
 *                      sweep in app/inngest/functions.ts, owned by P2), for the
 *                      24-hour and 1-hour reminders before an approve-by time.
 *
 * Nothing here writes to `social_posts`. Nothing here emails a client on its
 * own: the client hears only through `sendClientRound`, which is a person's
 * press to addresses on the client's own list.
 */

/* ── the client-facing sender ───────────────────────────────────────────── */

/**
 * WHO THE CLIENT HEARS FROM (the owner, 28 Sep 2026: "it should be from
 * Divina"). Every client email goes out in Divina's name and a reply reaches
 * her, whoever pressed Send. CLIENT_EMAIL_SENDER_ID overrides; an inactive
 * sender falls back to whoever pressed Send, so a client email never goes out
 * in the name of somebody who has left.
 */
export const CLIENT_EMAIL_SENDER_ID = () => process.env.CLIENT_EMAIL_SENDER_ID || '54926a48-335e-46e9-a080-df8c1ad42ac9'

export async function clientFacingSender(fallback: { name?: string | null; email: string }): Promise<{ name: string; email: string }> {
  const u = await table<TeamUserRow>('team_users').get(CLIENT_EMAIL_SENDER_ID()).catch(() => null)
  if (u && u.active_status && u.email) return { name: u.name || u.email, email: u.email }
  return { name: fallback.name || fallback.email, email: fallback.email }
}

/* ── shared loading ─────────────────────────────────────────────────────── */

type Actor = { id: string; name?: string | null; email?: string | null; clerk_user_id?: string | null }

async function loadRoster(clientId: string): Promise<{ roster: Roster; client: Client | null }> {
  const [people, links, client] = await Promise.all([
    table<TeamUserRow>('team_users').list({ where: u => u.active_status === true && u.role !== 'client' }),
    table<TeamUserClient>('team_user_clients').list({ by: { client_id: clientId } }).catch(() => [] as TeamUserClient[]),
    table<Client>('clients').get(clientId).catch(() => null),
  ])
  // the Realtime Database may hand a stored list back as a keyed object
  const raw = client?.default_scheduler_ids
  const defaults = (Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [])
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
  return {
    client,
    roster: {
      people: people.map(p => ({
        id: p.id, email: p.email, name: p.name, role: p.role, active_status: p.active_status, quality_reviewer: p.quality_reviewer,
      })),
      clientTeamIds: links.map(l => l.team_user_id),
      defaultSchedulerIds: defaults,
    },
  }
}

async function sourceTitle(post: Pick<PostState, 'source_item_id' | 'caption'>): Promise<string> {
  const item = post.source_item_id
    ? await table<ContentItem>('content_items').get(post.source_item_id).catch(() => null)
    : null
  return postTitle(post, item?.title ?? null)
}

async function platformsOf(channelIds: readonly string[]): Promise<string[]> {
  if (channelIds.length === 0) return []
  const accounts = await table<SocialAccount>('social_accounts')
    .list({ where: a => channelIds.includes(a.id) }).catch(() => [] as SocialAccount[])
  return [...new Set(accounts.map(a => String(a.platform)))]
}

const whenIn = (iso: string | null | undefined, tz: string | null | undefined) =>
  iso ? formatWithZone(iso, safeZone(tz ?? undefined), 'full') : null

function html(words: Words, link: string): string {
  return renderEmail(escapeHtml(words.subject), words.lines.map(l => `<p>${escapeHtml(l)}</p>`).join(''), words.cta, link)
}

/* ── after a move ───────────────────────────────────────────────────────── */

export type PostNotifyReport = {
  /** each person reached, and what the mailer said (sent, muted, failed, duplicate) */
  told: { id: string; name: string; result: NotifyResult }[]
  /** why nobody was emailed, when nobody was */
  skipped: string | null
}

/**
 * Tell the right people about a move that has LANDED. `post` is the row the
 * writer read back after its claim (or the claim's own result), not the page's
 * copy. `actor` is null for the app's own moves (booking_done, the recorder).
 * Never throws: a failed email is recorded in notification_log and reported.
 */
export async function notifyPostMove(input: {
  plan: Pick<Plan, 'action' | 'from' | 'to' | 'effects' | 'event'>
  post: PostState
  actor: Actor | null
  /** the posting time before a change_time, for the "tell the client" email */
  previousTime?: string | null
  now?: Date
}): Promise<PostNotifyReport> {
  const { plan, post } = input
  const now = input.now ?? new Date()
  try {
    const { roster, client } = await loadRoster(post.client_id)
    let actor = input.actor
    // a person's own address, when the caller only had their id and name
    if (actor && !actor.email) {
      const me = roster.people.find(p => p.id === actor!.id)
      if (me) actor = { ...actor, name: actor.name || me.name, email: me.email }
    }
    let effects = plan.effects
    // The app's own booking steps are about the person who pressed Book. "Booked in" names them and does not
    // tell them their own news; "Not booked" is told to THEM first — they are the one who thinks it is booked.
    if (!actor && (plan.action === 'booking_done' || plan.action === 'booking_failed')) {
      const pressed = (await table<PostEvent>('post_events').list({ by: { post_id: post.id } }).catch(() => [] as PostEvent[]))
        .filter(e => e.action === 'book' || e.action === 'post_now' || (e.action === 'change_time' && e.from === 'booked'))
        .sort((a, b) => b.rev - a.rev)[0]
      const who = pressed?.actor_id ? roster.people.find(p => p.id === pressed.actor_id) : null
      if (who && plan.action === 'booking_done') actor = { id: who.id, name: who.name, email: who.email }
      if (who && plan.action === 'booking_failed') {
        effects = [{ when: 'after', kind: 'notify', to: 'person', action: 'booking_failed', person_id: who.id }, ...effects]
      }
    }
    const planned = planMoveEmails({
      action: plan.action, from: plan.from, to: plan.to, version: plan.event.version,
      effects, post, roster, actorId: actor?.id ?? null, now,
    })
    if (!planned.ok) return { told: [], skipped: planned.reason }
    if (planned.emails.length === 0) return { told: [], skipped: 'This move tells nobody' }

    const tz = post.timezone ?? client?.timezone ?? null
    const nameOf = (id: string | null | undefined) => roster.people.find(p => p.id === id)?.name ?? null
    const base = {
      title: await sourceTitle(post),
      actor: actor?.name || actor?.email || 'MD Media',
      when: whenIn(post.scheduled_for, tz),
      post,
      note: plan.event.note,
      previousWhen: whenIn(input.previousTime ?? null, tz),
      networks: await platformsOf(post.channels),
      now,
      nameOf,
    }
    const link = `${DASHBOARD_URL}${teamPostPath(post)}`
    const told: PostNotifyReport['told'] = []
    for (const { person, target } of planned.emails) {
      const words = moveWords(plan.action, target, base)
      if (!words) continue
      const result = await notify({
        actorName: actor ? (actor.name ?? null) : 'MD Media',
        actorEmail: actor?.email ?? null,
        actorClerkId: actor?.clerk_user_id ?? null,
        eventType: `post_${plan.action}`,
        entityType: 'social_post',
        // one email per person per landed write: the event's rev is unique per post
        entityId: `${post.id}#r${plan.event.rev}`,
        recipientId: person.id,
        recipientEmail: person.email,
        subject: words.subject,
        bodyHtml: html(words, link),
      }).catch(() => 'failed' as const)
      told.push({ id: person.id, name: person.name || person.email, result })
    }
    return { told, skipped: told.length === 0 ? 'Nobody to tell for this move' : null }
  } catch (e) {
    console.error('post notify:', e)
    return { told: [], skipped: `Could not work out who to tell: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/* ── the approve-by reminders ───────────────────────────────────────────── */

/**
 * The 24-hour and 1-hour reminders before a client's approve-by time (the
 * owner's decision 11). They go to the client's account managers — the app
 * never emails a client on its own — and each is sent once per version and
 * approve-by time (the outbox key), so the sweep can run as often as it likes.
 * Nothing moves: a post whose time passes stays With client, marked missed.
 */
export async function sendApprovalReminders(now: Date = new Date()): Promise<{ checked: number; sent: number }> {
  const rows = await table<SocialPost>('social_posts').list({ where: r => r.stage === 'with_client' })
  let sent = 0
  for (const row of rows) {
    const post = readPostState(row as unknown as Record<string, unknown>)
    if (!post) continue
    const due = dueApprovalReminder(post, now)
    if (!due) continue
    try {
      const { roster, client } = await loadRoster(post.client_id)
      const people: TeamPerson[] = recipientsFor('account_managers', post, roster, null)
      if (people.length === 0) continue
      const tz = post.timezone ?? client?.timezone ?? null
      const words = reminderWords(due.kind, {
        title: await sourceTitle(post),
        sentOn: whenIn(post.client_send?.at ?? null, tz),
        approveBy: whenIn(due.approve_by, tz) ?? due.approve_by,
        to: post.client_send?.to ?? [],
      })
      const link = `${DASHBOARD_URL}${teamPostPath(post)}`
      for (const p of people) {
        const r = await notify({
          eventType: `post_approve_reminder_${due.kind}`,
          entityType: 'social_post',
          entityId: `${post.id}#v${due.version}#${due.approve_by}`,
          recipientId: p.id, recipientEmail: p.email,
          subject: words.subject,
          bodyHtml: html(words, link),
        }).catch(() => 'failed' as const)
        if (r === 'sent') sent++
      }
    } catch (e) {
      console.error('approval reminder:', post.id, e)
    }
  }
  return { checked: rows.length, sent }
}

/* ── the client's round ─────────────────────────────────────────────────── */

export type ClientRoundResult =
  | { ok: true; delivered: string[]; results: { email: string; result: NotifyResult }[]; message: string; link: string }
  | { ok: false; status: 400 | 404 | 409; error: string }

/** Stages a post can be sent to the client from: a pass (quality check), after a pass (ready), a resend (with client). */
const SENDABLE = new Set(['quality_check', 'ready', 'with_client'])

/**
 * ONE EMAIL PER PERSON PER ROUND (decision 15; research S4). A manager, or the
 * quality checker passing and sending, picks addresses on the client's own
 * list and presses Send; each address gets ONE email listing every post in
 * the round, each read from its FROZEN version (never the working copy, audit
 * P2), opening on the client's one link. It goes out in Divina's name.
 *
 * Called BEFORE the move is planned (audit P9): the caller plans and claims
 * only when `delivered` is not empty. A `test` goes to the presser alone, is
 * never marked for the client, and links to the team's page — the client's
 * page would let the presser answer for the client.
 *
 * `again`: send a round that already went (the client lost the email). Without
 * it, a repeated press of the same posts at the same versions is recognised by
 * the outbox and not sent twice.
 */
export async function sendClientRound(input: {
  clientId: string
  /** approve_by: when the client's answer closes — the same value the act route plans the move with */
  posts: readonly { post_id: string; version: number; approve_by?: string | null }[]
  emails: unknown
  note?: string | null
  pressedBy: { id: string; name?: string | null; email: string }
  test?: boolean
  again?: boolean
  now?: Date
}): Promise<ClientRoundResult> {
  const now = input.now ?? new Date()
  const test = input.test === true
  if (input.posts.length === 0) return { ok: false, status: 400, error: 'Choose at least one post to send.' }
  if (input.posts.length > 30) return { ok: false, status: 400, error: 'Send 30 posts at most in one round.' }
  const [client, contacts] = await Promise.all([
    table<Client>('clients').get(input.clientId).catch(() => null),
    table<ClientContact>('client_contacts').list({ by: { client_id: input.clientId } }).catch(() => [] as ClientContact[]),
  ])
  if (!client) return { ok: false, status: 404, error: 'This client was not found.' }
  const token = typeof client.share_token === 'string' ? client.share_token.trim() : ''
  if (!token) return { ok: false, status: 409, error: 'This client has no portal link yet. Make one on the client first.' }

  // each post, at the frozen version being sent
  const roundPosts: (RoundPost & { version: number })[] = []
  for (const want of input.posts) {
    const row = await table<SocialPost>('social_posts').get(want.post_id, { fresh: true }).catch(() => null)
    const post = readPostState(row as unknown as Record<string, unknown> | null)
    if (!post || post.client_id !== client.id) return { ok: false, status: 404, error: 'One of these posts is not on this client.' }
    if (!SENDABLE.has(post.stage)) return { ok: false, status: 409, error: `${await sourceTitle(post)} is not ready to send to the client.` }
    const version = await table<PostVersion>('post_versions').get(postVersionId(post.id, want.version)).catch(() => null)
    if (!version || version.post_id !== post.id) {
      return { ok: false, status: 409, error: `${await sourceTitle(post)} has no frozen version ${want.version} to send. Reload and try again.` }
    }
    const tz = version.timezone || post.timezone || client.timezone
    const approveBy = want.approve_by
      ?? (post.client_send?.version === want.version ? post.client_send.approve_by : null)
      ?? defaultApproveBy(version.scheduled_for, now)
    const channels = Array.isArray(version.channels) ? (version.channels as unknown[]).filter((x): x is string => typeof x === 'string') : post.channels
    roundPosts.push({
      id: post.id,
      version: want.version,
      title: await sourceTitle({ source_item_id: post.source_item_id, caption: version.caption ?? '' }),
      caption: version.caption ?? '',
      when: whenIn(version.scheduled_for, tz),
      networks: await platformsOf(channels),
      link: test ? `${DASHBOARD_URL}${teamPostPath(post)}` : `${DASHBOARD_URL}${portalPostHref(token, post.id)}`,
      approve_by: whenIn(approveBy, tz),
    })
  }

  const allowed = clientRecipients(client, contacts)
  const picked = test ? { ok: true as const, emails: [String(input.pressedBy.email).toLowerCase()] } : pickRecipients(input.emails, allowed)
  if (!picked.ok) return { ok: false, status: 400, error: picked.error }

  const sender = await clientFacingSender(input.pressedBy)
  const key = clientRoundKey(roundPosts.map(p => ({ id: p.id, version: p.version })))
  const stamp = now.toISOString()
  const home = test ? `${DASHBOARD_URL}${POST_APPROVAL_BOARD}` : `${DASHBOARD_URL}${portalWaitingPath(token)}`
  const results: { email: string; result: NotifyResult }[] = []
  for (const email of picked.emails) {
    const who = test ? null : allowed.find(r => r.email === email)
    const hello = who && who.name !== email ? who.name.split(' ')[0] : client.name
    const mail = clientRoundEmail({ clientName: client.name, hello, senderName: sender.name, posts: roundPosts, note: input.note, test })
    const body = mail.lines.map(l => `<p>${escapeHtml(l)}</p>`).join('')
      + mail.items.map(it =>
        `<div style="margin:16px 0;padding:12px 14px;border:1px solid #e4e4e7;border-radius:8px;background:#ffffff;">`
        + `<p style="margin:0 0 6px;"><strong>${escapeHtml(it.title)}</strong></p>`
        + it.lines.map(l => `<p style="margin:0 0 6px;color:#52525b;">${escapeHtml(l)}</p>`).join('')
        + `<p style="margin:8px 0 0;"><a href="${escapeHtml(it.link)}" style="color:#2563eb;">Open this post</a></p>`
        + `</div>`).join('')
    const result = await notify({
      eventType: test ? 'post_round_test' : 'post_round_to_client',
      entityType: 'client',
      entityId: `${client.id}#round#${key}${test || input.again ? `#${stamp}` : ''}`,
      recipientEmail: email,
      toClient: !test,
      deliberateClientSend: !test,
      actorName: sender.name,
      actorEmail: sender.email,
      subject: mail.subject,
      bodyHtml: renderEmail(escapeHtml(mail.heading), body, mail.cta, roundPosts.length === 1 ? roundPosts[0].link : home),
    }).catch(() => 'failed' as const)
    results.push({ email, result })
  }
  const delivered = results.filter(r => r.result === 'sent' || r.result === 'duplicate').map(r => r.email)
  return {
    ok: true,
    delivered,
    results,
    link: test ? home : `${DASHBOARD_URL}${portalWaitingPath(token)}`,
    message: test
      ? (delivered.length ? `Test sent to ${delivered[0]}. Open it to see exactly what ${client.name} gets.` : 'The test could not be emailed. Try again in a moment.')
      : roundOutcomeWords(results),
  }
}

/* ── the seams package P1's engine (app/lib/post-stage.ts) calls ───────── */

/**
 * P1's `deps.notify`: one notice per notify effect of a landed move. Typed by
 * shape, not by importing post-stage.ts, so the two files do not depend on
 * each other's internals. The outbox key is the move's rev, so the same person
 * named by two effects of one move gets one email.
 *
 * Better, when the engine can: call `notifyPostMove` ONCE per landed move with
 * its plan. Then a stage change that plans no notice but leaves the post with
 * a named person still tells that person (decision 14); this adapter only
 * hears about moves that planned a notice.
 */
export async function sendPostNotice(notice: {
  to: NotifyTarget
  action: PostAction
  person_id: string | null
  post: PostState
  actor: { id: string | null; name: string | null }
  event: PostEventRow
}): Promise<void> {
  await notifyPostMove({
    plan: {
      action: notice.action,
      from: notice.event.from,
      to: notice.event.to,
      effects: [{ when: 'after', kind: 'notify', to: notice.to, action: notice.action, person_id: notice.person_id }],
      event: notice.event,
    },
    post: notice.post,
    actor: notice.actor.id ? { id: notice.actor.id, name: notice.actor.name } : null,
  })
}
