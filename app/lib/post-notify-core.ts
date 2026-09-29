/**
 * EVERY POSTING EMAIL — the pure half (the posting rebuild, 29 Sep 2026; SPEC
 * §2.6/§7 row P7; the owner's decisions 11, 14 and 15). No I/O: the server
 * half is app/lib/post-notify.ts.
 *
 * What the audit taught, and the rule each lesson became here:
 *
 *   - V14 "The booking email goes out before the booking exists": managers were
 *     told a post was booked when the provider had refused it. RULE: an email
 *     reports a FACT, and the fact is read off the post AFTER the write landed
 *     (`factProblem`). No fact, no email — "Booked in" needs a booking with a
 *     job, not a press of Book.
 *   - V12 "Saving a draft emails the managers that it is being published": a
 *     draft emailed "Publishing now". RULE: only a move the table plans a
 *     notification for (or a move that hands the post to a named person) sends
 *     anything. A save sends nothing.
 *   - B8/W5 "Waiting on you" that nobody was told about. RULE (decision 14):
 *     every stage change that leaves the post with a named person tells that
 *     person (`nextPersonId`), and "the schedulers" means the post's own
 *     scheduler first, then the client's default schedulers — never the whole
 *     team.
 *   - P9 "waiting on you before anyone emailed it", and the owner's rule "never
 *     send any email to the client" (13 Sep) with its one exception, a
 *     manager's deliberate press (28 Sep): nothing here ever emails a client on
 *     its own. A move whose plan says "tell the client" tells the client's
 *     account managers instead, in words that ask them to pass it on. The only
 *     client email is the batched round a person sends (`clientRoundEmail`).
 *   - Research S4 / decision 15: one email per client per round, not one per
 *     post, pointing at the one link that lists everything waiting on them.
 */

import {
  APPROVAL_REMINDERS_MS, ROW_OF, approvalReminderTimes, STAGE_LABEL, STAGE_PAGE, approvalLine, approveByOf, failedNetworks,
  isPostAction, liveNetworks, postedWords, readPostState, waitingOn,
  type NotifyTarget, type PostAction, type PostEffect, type PostStage, type PostState,
} from './post-stage-core'
import { networkName } from './publish-core'
import { POST_APPROVAL_BOARD } from './overview-links-core'

/* ── people ─────────────────────────────────────────────────────────────── */

export type TeamPerson = {
  id: string
  email: string
  name: string
  role: string
  active_status: boolean
  quality_reviewer?: boolean | null
}

/** Everyone a posting email could go to, as the server loaded them for ONE post's client. */
export type Roster = {
  /** team_users (the server may pass them all; the rules pick) */
  people: readonly TeamPerson[]
  /** team_user_clients: who is on this client */
  clientTeamIds: readonly string[]
  /** clients.default_scheduler_ids */
  defaultSchedulerIds: readonly string[]
}

const reachable = (p: TeamPerson | undefined | null): p is TeamPerson =>
  !!p && p.active_status === true && p.role !== 'client' && typeof p.email === 'string' && p.email.includes('@')

const isReviewer = (p: TeamPerson) => p.role === 'quality_checker' || p.quality_reviewer === true
const isManager = (p: TeamPerson) => p.role === 'account_manager' || p.role === 'super_admin'
const isScheduler = (p: TeamPerson) => p.role === 'scheduler' || p.role === 'general'

/**
 * Who a notify target names on THIS post. The actor is never told about their
 * own press; a client, an inactive person and an address-less row never are.
 *
 *   quality_checkers  the quality checkers (the role or the flag); with nobody
 *                     flagged, the super admins — they are the reviewer then
 *   account_managers  the account managers and super admins on this client
 *   team              the same (the booked email: "IF SOMETHING IS SCHEDULED,
 *                     NOTIFY THE AM", the owner, 9 Sep 2026)
 *   schedulers        AUTO-ASSIGN (decision 14): the one person the post is
 *                     assigned to; else the client's default schedulers; else
 *                     the post's maker; else the schedulers on the client
 *   person            that one person
 *   client            never the client: its account managers (see the header)
 */
export function recipientsFor(
  target: NotifyTarget,
  post: Pick<PostState, 'assigned_to' | 'created_by'>,
  roster: Roster,
  actorId: string | null,
  personId?: string | null,
): TeamPerson[] {
  const byId = new Map(roster.people.map(p => [p.id, p]))
  const onClient = new Set(roster.clientTeamIds)
  const all = roster.people.filter(reachable)
  const pick = (people: readonly (TeamPerson | undefined)[]) => {
    const seen = new Set<string>()
    return people.filter(reachable).filter(p => p.id !== actorId && !seen.has(p.id) && (seen.add(p.id), true))
  }
  switch (target) {
    case 'quality_checkers': {
      const flagged = all.filter(isReviewer)
      return pick(flagged.length > 0 ? flagged : all.filter(p => p.role === 'super_admin'))
    }
    case 'account_managers':
    case 'team':
    case 'client':
      return pick(all.filter(p => isManager(p) && onClient.has(p.id)))
    case 'person':
      return pick([byId.get(String(personId ?? ''))])
    case 'schedulers': {
      const assigned = pick([byId.get(String(post.assigned_to ?? ''))])
      if (assigned.length > 0) return assigned
      const defaults = pick(roster.defaultSchedulerIds.map(id => byId.get(id)))
      if (defaults.length > 0) return defaults
      const maker = pick([byId.get(String(post.created_by ?? ''))])
      if (maker.length > 0) return maker
      return pick(all.filter(p => isScheduler(p) && onClient.has(p.id)))
    }
  }
}

/* ── the fact an email reports ──────────────────────────────────────────── */

/**
 * Is the fact this move's email reports TRUE of the post as it now stands?
 * Null when it is; else why not, and no email goes. `post` is the row read
 * AFTER the claim landed (never the one the page sent), and `version` the
 * version the move acted on, so an email about version 2 is never sent once
 * the post has moved on to version 3.
 */
export function factProblem(action: PostAction | string, post: PostState, version?: number | null): string | null {
  if (!isPostAction(action)) return 'Not a posting move'
  const at = (s: PostStage) => (post.stage === s ? null : `The post is in ${STAGE_LABEL[post.stage]}, not ${STAGE_LABEL[s]}`)
  const sameVersion = () =>
    version == null || post.sent_version === version ? null : `The post is on version ${post.sent_version ?? 'none'} now, not ${version}`
  switch (action) {
    case 'send_to_qc':
      return at('quality_check') ?? sameVersion()
    case 'pass':
      return at('ready') ?? sameVersion()
        ?? (post.qc_pass?.version === post.sent_version ? null : 'This version has no quality-check pass')
    case 'pass_send_client':
    case 'send_to_client':
    case 'resend_new_time':
    case 'remind_client':
      return at('with_client') ?? sameVersion()
        ?? (post.client_send && post.client_send.version === post.sent_version ? null : 'Nothing reached the client for this version')
    case 'ask_change':
      return at('draft') ?? (post.changes_asked?.who === 'team' ? null : 'No change is asked by the team')
    case 'client_ask_change':
      return at('draft') ?? (post.changes_asked?.who === 'client' ? null : 'No change is asked by the client')
    case 'client_approve':
      return at('ready') ?? (post.approval?.hat === 'client' && post.approval.version === post.sent_version ? null : 'The client has not approved this version')
    case 'approve_for_client':
      return at('ready') ?? (post.approval?.on_behalf_of_client === true && post.approval.version === post.sent_version ? null : 'Nobody approved this version for the client')
    case 'team_decides':
      return at('ready') ?? (post.approval != null && post.approval.hat !== 'client' && !post.approval.on_behalf_of_client && post.approval.version === post.sent_version ? null : 'The team did not decide this version')
    case 'book':
    case 'post_now':
      // the press is not the booking: "Booked in" waits for booking_done (audit V14)
      return 'Booking is under way — the booked email waits until the booking exists'
    case 'booking_done':
      return at('booked') ?? (post.booking && !post.booking.pending && post.booking.job_ids.length > 0 ? null : 'There is no finished booking with a job')
    case 'booking_failed':
      return at('ready') ?? (post.booking == null && post.problem ? null : 'The post does not say why the booking failed')
    case 'change_time':
      return post.stage === 'ready' || post.stage === 'booked' ? null : `The post is in ${STAGE_LABEL[post.stage]}`
    case 'record_posted':
      return at('posted') ?? (failedNetworks(post).length === 0 && liveNetworks(post).length > 0 ? null : 'Not every network went out')
    case 'record_partial':
      return at('posted') ?? (failedNetworks(post).length > 0 && liveNetworks(post).length > 0 ? null : 'It did not go out in part')
    case 'record_failed':
      return at('ready') ?? (post.problem ? null : 'The post does not say what did not go out')
    default: {
      const to = ROW_OF[action].to
      if (to === 'deleted') return 'The post is gone'
      return to === 'same' || to === post.stage ? null : `The post is in ${STAGE_LABEL[post.stage]}, not ${STAGE_LABEL[to]}`
    }
  }
}

/**
 * Does this raw `social_posts` row prove a booking? Null when it does. A
 * rebuilt row (it has a `stage`) must be Booked in with a finished booking that
 * holds a job; an older row must carry a publish job id. No row, a pending
 * booking, a failed one: no booking, so no "Booked in" email (audit V14).
 */
export function bookedFactProblem(row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return 'No post to check'
  const state = readPostState(row)
  if (state) return factProblem('booking_done', state)
  const jobs = row.publish_job_ids
  const ids = Array.isArray(jobs) ? jobs : jobs && typeof jobs === 'object' ? Object.values(jobs) : []
  return ids.some(x => typeof x === 'string' && x.length > 0) ? null : 'The post has no publish job yet'
}

/* ── who hears about one move ───────────────────────────────────────────── */

/** The named person the post is with after a stage change, when that is somebody other than the actor (decision 14). */
export function nextPersonId(
  move: { from: PostStage; to: PostStage | 'deleted' },
  post: PostState,
  actorId: string | null,
  now: string | number | Date,
): string | null {
  if (move.to === 'deleted' || move.from === move.to) return null
  const id = waitingOn(post, now).person_id
  return id && id !== actorId ? id : null
}

export type MoveEmail = {
  person: TeamPerson
  /** which of the plan's targets named them (the first that did) */
  target: NotifyTarget | 'next_person'
}

export type MoveEmailPlan =
  | { ok: true; emails: MoveEmail[] }
  | { ok: false; reason: string }

/**
 * Everyone who hears about one landed move, once each. The plan's notify
 * effects decide the audiences (post-stage-core `planPostTransition`); a stage
 * change that leaves the post with a named person adds that person. The fact
 * is checked first: when it is not true of the landed post, nobody hears.
 */
export function planMoveEmails(input: {
  action: PostAction | string
  from: PostStage
  to: PostStage | 'deleted'
  version: number | null
  effects: readonly PostEffect[]
  post: PostState
  roster: Roster
  actorId: string | null
  now: string | number | Date
}): MoveEmailPlan {
  const targets = input.effects.filter((e): e is Extract<PostEffect, { kind: 'notify' }> => e.kind === 'notify')
  const next = nextPersonId({ from: input.from, to: input.to }, input.post, input.actorId, input.now)
  if (targets.length === 0 && !next) return { ok: true, emails: [] }
  const problem = factProblem(input.action, input.post, input.version)
  if (problem) return { ok: false, reason: problem }
  const out: MoveEmail[] = []
  const seen = new Set<string>()
  const add = (people: TeamPerson[], target: MoveEmail['target']) => {
    for (const p of people) if (!seen.has(p.id)) { seen.add(p.id); out.push({ person: p, target }) }
  }
  // a named person first, so their email is the one that says it is theirs
  for (const t of targets.filter(t => t.to === 'person')) add(recipientsFor('person', input.post, input.roster, input.actorId, t.person_id), 'person')
  for (const t of targets.filter(t => t.to !== 'person')) add(recipientsFor(t.to, input.post, input.roster, input.actorId, t.person_id), t.to)
  if (next) add(recipientsFor('person', input.post, input.roster, input.actorId, next), 'next_person')
  return { ok: true, emails: out }
}

/* ── the words ──────────────────────────────────────────────────────────── */

export type Words = {
  subject: string
  /** plain sentences; the server escapes each and wraps it in <p> */
  lines: string[]
  cta: string
}

export type WordsInput = {
  title: string
  /** who pressed it — a name, or "MD Media" for the app */
  actor: string
  /** the posting time, already in the client's zone ("Tue 30 Sep, 6:00 pm AEST") */
  when: string | null
  post: PostState
  /** the note that came with the move */
  note?: string | null
  /** the time before a change_time */
  previousWhen?: string | null
  /** the networks it goes out on, by platform ('instagram', 'linkedin') */
  networks?: readonly string[]
  /** the clock, for the "with you" line */
  now?: string | number | Date
  nameOf?: (id: string | null | undefined) => string | null | undefined
}

const joinNames = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
const atWhen = (when: string | null) => (when ? ` for ${when}` : '')
const quoted = (s: string | null | undefined) => (s && s.trim() ? `“${s.trim()}”` : '')

/**
 * The email for one landed move, to one audience. Short sentences: what
 * happened, then what the reader does next. Null when this move sends nothing
 * to this audience.
 */
export function moveWords(action: PostAction | string, target: MoveEmail['target'], w: WordsInput): Words | null {
  const { title, actor, when, post } = w
  const note = quoted(w.note)
  const nameOf = w.nameOf ?? (() => null)
  const v = post.sent_version
  switch (action) {
    case 'send_to_qc':
      return {
        subject: `Quality check: ${title}`,
        lines: [`${actor} sent ${title} for the quality check${v != null ? ` (version ${v})` : ''}.`, 'Open it, then press Passed, or Ask for a change.'],
        cta: 'Check the post',
      }
    case 'pass':
      return {
        subject: `Ready to post: ${title}`,
        lines: [`${actor} passed the quality check on ${title}. It is approved.`, `Book it in${atWhen(when)} on the Schedule page.`],
        cta: 'Book it in',
      }
    case 'ask_change':
    case 'client_ask_change': {
      const who = action === 'client_ask_change' ? 'The client' : actor
      return {
        subject: action === 'client_ask_change' ? `The client asked for a change: ${title}` : `Change asked: ${title}`,
        lines: [
          `${who} asked for a change to ${title}${note ? `: ${note}` : '.'}`,
          target === 'person' || target === 'next_person' ? 'It is back in Draft with you. Make the change, then send it for quality check again.' : 'It is back in Draft.',
        ],
        cta: 'Make the change',
      }
    }
    case 'client_approve':
      return {
        subject: `The client approved: ${title}`,
        lines: [`The client approved ${title}.`, `Book it in${atWhen(when)}.`],
        cta: 'Book it in',
      }
    case 'team_decides':
      return {
        subject: `The team approved: ${title}`,
        lines: [`${actor} approved ${title} without waiting for the client${post.approval?.note ? `: ${post.approval.note}` : '.'}`, `Book it in${atWhen(when)}.`],
        cta: 'Book it in',
      }
    case 'approve_for_client':
      return {
        subject: `Approved for the client: ${title}`,
        lines: [`${approvalLine(post.approval, nameOf) ?? `Approved by ${actor} for the client`}.`, `Book it in${atWhen(when)}.`],
        cta: 'Book it in',
      }
    case 'booking_done': {
      const nets = (w.networks ?? []).map(networkName)
      return {
        subject: `Booked in: ${title}${when ? ` — ${when}` : ''}`,
        lines: [`${title} is booked in. It goes out ${when ?? 'at its time'}${nets.length ? ` on ${joinNames(nets)}` : ''}.`, 'Nothing is needed from you. This is so you know.'],
        cta: 'See it',
      }
    }
    case 'booking_failed':
      return {
        subject: `Not booked: ${title}`,
        lines: [`${title} could not be booked in. ${post.problem ?? ''}`.trim(), 'It is back in Ready to post. Pick a time and book it again.'],
        cta: 'Book it again',
      }
    case 'record_partial':
      return {
        subject: `Posted in part: ${title}`,
        lines: [`${title}: ${postedWords(post)}.`, 'Use Post the missing networks to send the rest.'],
        cta: 'Post the rest',
      }
    case 'record_failed':
      return {
        subject: `Did not go out: ${title}`,
        lines: [`${title} did not go out. ${post.problem ?? ''}`.trim(), 'It is back in Ready to post. Pick a time and book it again.'],
        cta: 'Book it again',
      }
    case 'change_time':
      if (target !== 'client') return null
      return {
        subject: `New time for a post the client approved: ${title}`,
        lines: [
          `${actor} moved ${title} to ${when ?? 'a new time'}.`,
          `The client approved it${w.previousWhen ? ` for ${w.previousWhen}` : ''}. Please tell them the new time — the app never emails a client on its own.`,
        ],
        cta: 'See the post',
      }
    default:
      if (target !== 'next_person') return null
      return {
        subject: `${title} is with you`,
        lines: [`${actor} moved ${title} to ${STAGE_LABEL[post.stage]}.`, waitingOn(post, w.now ?? new Date(), nameOf).line.replace(/\.?$/, '.')],
        cta: 'Open the post',
      }
  }
}

/* ── links ──────────────────────────────────────────────────────────────── */

/**
 * Where a team email opens the post: the page its stage belongs to (the
 * owner's decision 1). `?post=` opens the post window there (P3/P4/P5 read it).
 */
export function teamPostPath(post: Pick<PostState, 'id' | 'client_id' | 'stage'>): string {
  const id = encodeURIComponent(post.id)
  return STAGE_PAGE[post.stage] === 'schedule'
    ? `/dashboard/social/schedule?client=${encodeURIComponent(post.client_id)}&post=${id}`
    : `${POST_APPROVAL_BOARD}?post=${id}`
}

/* ── approve-by reminders (decision 11) ─────────────────────────────────── */

export type ReminderKind = keyof typeof APPROVAL_REMINDERS_MS

const msOf = (t: string | number | Date | null | undefined) =>
  t == null ? NaN : t instanceof Date ? t.getTime() : typeof t === 'number' ? t : new Date(t).getTime()

/**
 * Which reminder is due for a post with the client, now: the latest of "24
 * hours before" and "1 hour before" the approve-by time that has come, as long
 * as the approve-by time has not passed yet. A reminder whose moment came
 * BEFORE the post was sent is never due — a post sent three hours before its
 * approve-by gets the 1-hour reminder only, not a "24 hours left" that is not
 * true. Null when nothing is due.
 */
export function dueApprovalReminder(
  post: Pick<PostState, 'stage' | 'client_send' | 'scheduled_for'>,
  now: string | number | Date,
): { kind: ReminderKind; approve_by: string; version: number } | null {
  if (post.stage !== 'with_client' || !post.client_send) return null
  const by = approveByOf(post)
  const byMs = msOf(by)
  const n = msOf(now)
  const sent = msOf(post.client_send.at)
  if (!by || !Number.isFinite(byMs) || !Number.isFinite(n) || n >= byMs) return null
  const due = approvalReminderTimes(by)
    .find(r => msOf(r.at) <= n && (!Number.isFinite(sent) || msOf(r.at) > sent))
  return due ? { kind: due.kind, approve_by: by, version: post.client_send.version } : null
}

/** The reminder to the client's account managers. The client is never reminded by the app (see the header). */
export function reminderWords(kind: ReminderKind, w: { title: string; sentOn: string | null; approveBy: string; to: readonly string[] }): Words {
  const who = w.to.length > 0 ? joinNames(w.to) : 'the client'
  const left = kind === '24h' ? 'in 24 hours' : 'in 1 hour'
  return {
    subject: `The client has not answered yet: ${w.title}`,
    lines: [
      `${w.title} was sent to ${who}${w.sentOn ? ` on ${w.sentOn}` : ''}. They have not answered.`,
      `Their approval closes ${left}, at ${w.approveBy}.`,
      kind === '1h'
        ? 'Nudge them now. If they said yes another way, press Approve for the client. If nobody answers, the post will need a new time.'
        : 'Nudge them. If they said yes another way, press Approve for the client.',
    ],
    cta: 'Open the post',
  }
}

/* ── the client's round: one email per person per send ─────────────────── */

/** A short, stable hash (FNV-1a, two seeds) so a round's key stays short in the outbox. */
function shortHash(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

/**
 * One round = these posts at these versions. The same round pressed twice (a
 * retried request, a double click) is the same key, so the outbox sends it
 * once. A new version (an edit, a new time) is a new round.
 */
export function clientRoundKey(posts: readonly { id: string; version: number }[]): string {
  const parts = [...posts].map(p => `${p.id}v${p.version}`).sort()
  return `${parts.length}p-${shortHash(parts.join(','))}`
}

export type RoundPost = {
  id: string
  title: string
  /** the frozen version's words — never the working copy (audit P2) */
  caption: string
  when: string | null
  networks: readonly string[]
  link: string
  approve_by: string | null
}

/**
 * THE CLIENT'S EMAIL: one per person per round, however many posts are in it
 * (decision 15). It lists each post with its time and networks, and opens on
 * the one link that lists everything waiting on them. It reads as coming from
 * the person the client knows (the owner, 28 Sep 2026: "it should be from
 * Divina").
 */
export function clientRoundEmail(w: {
  clientName: string
  hello: string
  senderName: string
  posts: readonly RoundPost[]
  note?: string | null
  test?: boolean
  /** Remind the client: the same post(s), still waiting on their answer */
  reminder?: boolean
}): { subject: string; heading: string; lines: string[]; items: { title: string; lines: string[]; link: string }[]; cta: string } {
  const n = w.posts.length
  const one = n === 1 ? w.posts[0] : null
  const subject = (w.test ? `[Test — what ${w.clientName} gets] ` : '')
    + (w.reminder ? 'Reminder: ' : '')
    + (one ? `Your post is ready to approve: ${one.title}` : `${n} posts are ready for you to approve`)
  const byTimes = w.posts.map(p => p.approve_by).filter((x): x is string => !!x)
  const lines = [
    ...(w.test ? [`A test copy for you — exactly what ${w.clientName} receives. Nothing on the posts changes.`] : []),
    `Hi ${w.hello},`,
    w.reminder
      ? `A reminder from ${w.senderName}: ${one ? one.title : `${n} posts`} ${one ? 'is' : 'are'} still waiting for your answer before ${one ? 'it goes' : 'they go'} out.`
      : `${w.senderName} has sent you ${one ? one.title : `${n} posts`} to look over before ${one ? 'it goes' : 'they go'} out.`,
    ...(w.note && w.note.trim() ? [w.note.trim()] : []),
    `Open ${one ? 'it' : 'each one'} to see the post, then press Approve — or Ask for a change and tell us what to change.`,
    ...(byTimes.length > 0 ? [`Please answer by ${byTimes[0]}${byTimes.length > 1 && new Set(byTimes).size > 1 ? ' for the first one' : ''}.`] : []),
  ]
  const items = w.posts.map(p => ({
    title: p.title,
    lines: [
      ...(p.when ? [`Goes out ${p.when}${p.networks.length ? ` on ${joinNames(p.networks.map(networkName))}` : ''}.`] : []),
      ...(p.caption.trim() ? [p.caption.trim().length > 400 ? `${p.caption.trim().slice(0, 397).trimEnd()}…` : p.caption.trim()] : []),
    ],
    link: p.link,
  }))
  return { subject, heading: one ? `Ready for your approval: ${one.title}` : `${n} posts ready for your approval`, lines, items, cta: one ? 'View and approve' : 'See everything waiting on you' }
}

/** What the person who pressed Send is told, from what actually happened to each address. */
export function roundOutcomeWords(results: readonly { email: string; result: string }[]): string {
  const sent = results.filter(r => r.result === 'sent' || r.result === 'duplicate').map(r => r.email)
  const failed = results.filter(r => r.result !== 'sent' && r.result !== 'duplicate').map(r => r.email)
  if (sent.length === 0) return `Nothing was sent — ${joinNames(failed)} could not be emailed. Nothing has changed on the post. Try again, or copy the link and send it yourself.`
  return `Emailed ${joinNames(sent)}.` + (failed.length ? ` Could not email ${joinNames(failed)} — send them the link yourself.` : '')
}
