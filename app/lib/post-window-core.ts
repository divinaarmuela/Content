/**
 * THE POST WINDOW'S PURE HALF (package P3 of the posting rebuild, 29 Sep 2026).
 *
 * Read docs/posting-rebuild/OWNER_DECISIONS.md first, then SPEC.md §4.1. The
 * window is one component (`PostWindow.tsx`) that opens the same way from a
 * Schedule tile, a list row, a Post approval card and a Waiting row. This file
 * is everything in it that can be decided without a screen:
 *
 *   - what the top says (the stage, who has it, which version);
 *   - whether the middle can be edited (only a draft — decision 8);
 *   - what each button asks before it goes (a note, a time, how the client
 *     agreed, who gets it, a yes) and the request it becomes;
 *   - the clock's choices (5-minute steps, the post's own odd minute kept,
 *     the next quarter-hour at least 15 minutes out, no hour that has gone);
 *   - Instagram's ten (decision 10): drop, split, or give Instagram its own;
 *   - notes pinned to a file, in a Team thread (default) or a Client thread;
 *   - the press itself, with the server injected, so a test drives it with a
 *     fake and the component only draws what comes back.
 *
 * WHAT IT NEVER DOES: decide a stage or a button. Those are `postActions` and
 * `checkPostTransition` in post-stage-core (P0). The window renders that list
 * as it is (decision 2), and the server's answer is what it shows after a
 * press — never what it guessed (audit W4).
 */

import {
  ACTION_LABEL, AGREED_VIA, AGREED_VIA_WORDS, APPROVAL_STEPS, ROW_OF, STAGE_WORDS,
  approvalLine, approveByOf, bookableTimeProblem, changesAskedLine, clientSendLine, instagramOverflow,
  isReminderSend, readPostState, waitingOn, INSTAGRAM_MAX, MISSED_LABEL,
  type AccountRef, type AgreedVia, type ApprovalSteps, type CommentVisibility, type InputNeed,
  type NowLike, type OfferedAction, type PostAction, type PostActionList, type PostStage,
  type PostState, type StageTone,
} from './post-stage-core'
import type { PostActRequest, PostActResponse } from './post-act-contract'
import { joinClock, type ChannelExtras, type ClockValue } from './schedule-compose-core'
import { formatInZone } from './timezone-core'
import { cleanEmail } from './client-recipients-core'
import type { Slide } from './version-files-core'
import type { PostAutomation } from './comment-automation-core'

const ms = (t: NowLike | null | undefined): number => {
  if (t == null) return NaN
  return t instanceof Date ? t.getTime() : typeof t === 'number' ? t : new Date(t).getTime()
}

/* ── the working copy ───────────────────────────────────────────────────── */

/** What the middle of the window holds and a Save writes. */
export type WorkingCopy = {
  slides: Slide[]
  caption: string
  channels: string[]
  perChannel: Record<string, ChannelExtras>
  scheduledFor: string | null
  /** the comment-to-DM automation, set up while scheduling (comment-automation-core) */
  automation?: PostAutomation | null
}

/**
 * A POST THAT IS NOT SAVED YET, as the rules read it: a draft with no id, made
 * by the person looking. It lets the window ask `postActions` for its buttons
 * before anything exists, so a new post and a saved draft show the same
 * footer — one list, wherever it opens.
 */
export function unsavedPost(input: {
  clientId: string
  createdBy: string | null
  working: WorkingCopy
  timezone?: string | null
  sourceItemId?: string | null
}): PostState {
  return {
    id: '',
    client_id: input.clientId,
    created_by: input.createdBy,
    stage: 'draft',
    rev: 0,
    stage_at: null,
    draft_version: 1,
    sent_version: null,
    scheduled_for: input.working.scheduledFor,
    timezone: input.timezone ?? null,
    channels: [...input.working.channels],
    slides: [...input.working.slides],
    caption: input.working.caption,
    per_channel: { ...input.working.perChannel },
    ...(input.working.automation ? { automation: input.working.automation } : {}),
    approval_steps: null,
    approval: null,
    qc_pass: null,
    changes_asked: null,
    client_send: null,
    last_client_send: null,
    booking: null,
    outcomes: {},
    problem: null,
    cancelled: null,
    assigned_to: null,
    source_item_id: input.sourceItemId ?? null,
    source_deleted: false,
  }
}

/**
 * The post with what is ON SCREEN as its working copy — only while it is a
 * draft, the one stage the middle can be changed in. The guards then judge
 * exactly what Send would send (the caption someone is typing, the eleventh
 * picture they just added), not what was saved an hour ago.
 */
export function withWorkingCopy(post: PostState, working: WorkingCopy): PostState {
  if (post.stage !== 'draft') return post
  return {
    ...post,
    slides: working.slides,
    caption: working.caption,
    channels: working.channels,
    per_channel: working.perChannel,
    scheduled_for: working.scheduledFor,
    automation: working.automation ?? null,
  }
}

/**
 * ARE THERE REAL UNSAVED CHANGES? (the owner's live test, 29 Sep 2026: edits vanished on close.)
 * True only when the person has touched the working copy (`touched` — the reducer's `dirty`) AND
 * what is on screen differs from what was last saved (`base`: the saved post's working copy, or
 * what a new post opened with). A caption typed and rubbed out, a channel ticked and unticked, is
 * not a change — nothing is asked and no browser prompt fires.
 */
export function hasUnsavedChanges(base: WorkingCopy | null | undefined, working: WorkingCopy, touched: boolean): boolean {
  if (!touched) return false
  if (!base) return true
  return workingKey(base) !== workingKey(working)
}

function workingKey(w: WorkingCopy): string {
  const t = w.scheduledFor ? new Date(w.scheduledFor).getTime() : null
  return stableJson({
    slides: w.slides ?? [], caption: (w.caption ?? '').replace(/\s+$/, ''), channels: w.channels ?? [],
    perChannel: w.perChannel ?? {}, scheduledFor: t != null && Number.isFinite(t) ? t : null,
    automation: w.automation ?? null,
  })
}

/** Keys sorted, empty values dropped — two reads of the same content compare equal. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().filter(k => o[k] !== undefined && o[k] !== null)
      .map(k => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

/** The three answers to "Save your changes?" when a window with unsaved changes is closed. */
export type CloseChoice = { key: 'save' | 'discard' | 'keep'; label: string }
export const CLOSE_QUESTION = 'Save your changes?'
/** Save is offered only when this person may save this post right now (the `save` button is theirs and unblocked). */
export function closeChoices(list: PostActionList): CloseChoice[] {
  const save = [list.primary, ...list.secondary].find(a => a?.action === 'save')
  return [
    ...(save && !save.blocked ? [{ key: 'save' as const, label: 'Save' }] : []),
    { key: 'discard', label: 'Discard' },
    { key: 'keep', label: 'Keep editing' },
  ]
}

/** The working copy a post holds, for the window to start from. */
export function workingCopyOf(post: Pick<PostState, 'slides' | 'caption' | 'channels' | 'per_channel' | 'scheduled_for' | 'automation'>): WorkingCopy {
  return {
    slides: post.slides,
    caption: post.caption,
    channels: post.channels,
    perChannel: post.per_channel,
    scheduledFor: post.scheduled_for,
    // only when there is one, so a post without an automation reads exactly as it always did
    ...(post.automation ? { automation: post.automation } : {}),
  }
}

/**
 * A FROZEN VERSION (a `post_versions` row) read as a working copy, so the
 * middle can draw it. Parsed by the same reader as a post, so a slide or an
 * option reads the same in both. Null for a row that is not there yet.
 */
export function frozenCopyOf(row: Record<string, unknown> | null | undefined): (WorkingCopy & { frozenAt: string | null; n: number | null; fromMigration: boolean }) | null {
  if (!row) return null
  const read = readPostState({ ...row, id: String(row.id ?? 'version'), client_id: String(row.client_id ?? ''), stage: 'draft' })
  if (!read) return null
  return {
    ...workingCopyOf(read),
    frozenAt: typeof row.frozen_at === 'string' ? row.frozen_at : null,
    n: typeof row.n === 'number' ? row.n : null,
    fromMigration: row.from_migration === true,
  }
}

/**
 * CAN THE MIDDLE BE CHANGED? Only in a draft (decision 8). Anywhere else the
 * window shows the frozen version, read-only, and "Edit — makes version N" is
 * a button in the footer like every other move. Saving files in a draft
 * never asks for a time; only a send or a booking checks it.
 */
export function bodyEditable(post: Pick<PostState, 'stage'>): boolean {
  return post.stage === 'draft'
}

/* ── the top of the window ──────────────────────────────────────────────── */

type NameOf = (id: string | null | undefined) => string | null | undefined

export type WindowHeader = {
  /** the stage chip — the words every page uses (STAGE_WORDS) */
  label: string
  tone: StageTone
  /** what the stage means, in one sentence */
  meaning: string
  /** who has it now and what happens next (waitingOn) */
  line: string
  /** "Missed — needs a new time" when the time has passed while it waited */
  missed: string | null
  /** "Version 2 · frozen Tue 29 Sep, 3:00 pm" */
  versionLine: string | null
  /** "Approved by Akmal for the client — on WhatsApp" — only from the record */
  approvalLine: string | null
  /** "Emailed to jordan@…" — only from a send that happened */
  sendLine: string | null
  /** "Answer needed by Tue 29 Sep, 3:00 pm" — while the client has it and the time is still open (decision 11) */
  answerByLine: string | null
  /** "The client asked for a change" with the note */
  changeLine: string | null
  changeNote: string | null
  /** why it came back from booked, a network that did not go out */
  problem: string | null
  /** what the quality check of a card's post is for — the caption, the channels and the time; the files
   *  were checked and approved on the edit (the owner, 1 Oct 2026) */
  checkLine: string | null
}

/** The quality check of a post made from an approved card: it checks the post, not the files again. */
export const BATCH_CHECK_LINE = 'This check is for the caption, the channels and the time. The files were checked and approved on the edit.'

/**
 * THE TOP OF THE WINDOW: the stage and what happens next (decision 2). Read
 * from the post alone — never from the edit card the media came from (audit
 * B5), and never "waiting on you" while the client has it (audit W5).
 */
export function windowHeader(
  post: PostState,
  now: NowLike,
  opts: { nameOf?: NameOf; tz?: string | null; frozenAt?: string | null; unsaved?: boolean } = {},
): WindowHeader {
  const nameOf = opts.nameOf ?? (() => null)
  const words = STAGE_WORDS[post.stage]
  const wait = waitingOn(post, now, nameOf)
  const when = (iso: string | null | undefined) => (iso && opts.tz ? formatInZone(iso, opts.tz, 'full') : null)
  let versionLine: string | null = null
  if (opts.unsaved) versionLine = 'New post — not saved yet'
  else if (post.stage === 'draft') {
    versionLine = post.sent_version != null
      ? `Working copy — becomes version ${post.draft_version} when it is sent. Version ${post.sent_version} was the last one sent.`
      : `Working copy — becomes version ${post.draft_version} when it is sent`
  } else if (post.sent_version != null) {
    const at = when(opts.frozenAt)
    versionLine = `Version ${post.sent_version}${at ? ` · frozen ${at}` : ''}`
  }
  const showApproval = post.approval && post.approval.version === post.sent_version && ['ready', 'booked', 'posted'].includes(post.stage)
  const showSend = post.stage === 'with_client' && post.client_send && post.client_send.version === post.sent_version
  const ca = post.stage === 'draft' ? post.changes_asked : null
  return {
    label: words.label,
    tone: wait.missed ? 'red' : words.tone,
    meaning: words.meaning,
    line: opts.unsaved ? 'Nothing is saved yet. Save it, or send it for quality check when it is ready.' : wait.line,
    missed: wait.missed ? MISSED_LABEL : null,
    versionLine,
    approvalLine: showApproval ? approvalLine(post.approval, nameOf) : null,
    sendLine: showSend ? clientSendLine(post.client_send, opts.tz ?? undefined) : null,
    answerByLine: showSend && !wait.missed && when(approveByOf(post)) ? `Answer needed by ${when(approveByOf(post))}` : null,
    changeLine: ca ? changesAskedLine(ca, nameOf) : null,
    changeNote: ca?.note?.trim() ? ca.note.trim() : null,
    problem: post.problem && post.stage !== 'cancelled' ? post.problem : null,
    checkLine: post.batch && (post.stage === 'quality_check' || post.stage === 'draft') ? BATCH_CHECK_LINE : null,
  }
}

/* ── the buttons: what each one asks before it goes ─────────────────────── */

/** What a person gives with a press. */
export type Answers = {
  note?: string | null
  agreed_via?: AgreedVia | null
  assign_to?: string | null
  scheduled_for?: string | null
  confirm?: boolean | null
  steps?: ApprovalSteps | null
  send_to?: string[] | null
  via?: 'email' | 'link' | null
  /** when the client's answer closes — shown with its default, and changeable (decision 11) */
  approve_by?: string | null
}

export type Question = {
  action: PostAction
  /** the button's own words */
  label: string
  needs: readonly InputNeed[]
  /** the sentence at the top of the question */
  prompt: string
  /** the button that sends it */
  go: string
  /** the button that stands down */
  stay: string
}

const PROMPT: Partial<Record<PostAction, { prompt: string; go: string; stay?: string }>> = {
  pass_send_client: { prompt: 'Who should get it? It is emailed to them with a link to approve it.', go: 'Pass and send' },
  send_to_client: { prompt: 'Who should get it? It is emailed to them with a link to approve it.', go: 'Send to client' },
  resend_new_time: { prompt: 'Pick the new posting time, then who gets it.', go: 'Resend' },
  remind_client: { prompt: 'Who gets the reminder? The same version is emailed again — the posting time and the answer-by time stay as they are.', go: 'Send the reminder' },
  ask_change: { prompt: 'What needs changing, and who should change it?', go: 'Ask for the change' },
  approve_for_client: { prompt: 'How did the client say yes? It is saved as your approval, for the client.', go: 'Approve for the client' },
  team_decides: { prompt: 'Why is the team deciding without the client? Their page will say the team decided it.', go: 'Approve without the client' },
  change_time: { prompt: 'Pick the new posting time.', go: 'Move it' },
  schedule_direct: { prompt: 'Pick the posting time. It is booked in for that time without the quality check, and the record says so.', go: 'Schedule it' },
  post_now: { prompt: 'This goes out on the client\'s accounts now.', go: 'Post now', stay: 'Not yet' },
  edit_booked: { prompt: 'This takes it off the schedule. It needs checking again after the change.', go: 'Take it off and edit', stay: 'Keep it booked' },
  cancel: { prompt: 'Cancel this post? It will not go out. You can Re-book it later.', go: 'Cancel post', stay: 'Keep it' },
  delete_draft: { prompt: 'Delete this draft? It has never been sent, so nothing else changes.', go: 'Delete draft', stay: 'Keep it' },
  set_steps: { prompt: 'Who approves this post?', go: 'Save' },
}

/**
 * The question a button asks, or null when a press goes straight through.
 * Drawn next to the button that asked it, never below the fold (decision 2).
 */
export function questionFor(offered: Pick<OfferedAction, 'action' | 'label' | 'needs' | 'confirm'>): Question | null {
  if (offered.needs.length === 0) return null
  const words = PROMPT[offered.action]
  return {
    action: offered.action,
    label: offered.label,
    needs: offered.needs,
    prompt: words?.prompt ?? offered.confirm ?? offered.label,
    go: words?.go ?? offered.label,
    stay: words?.stay ?? 'Never mind',
  }
}

/**
 * What is missing from the answers, said next to the button — or null. The
 * server checks it all again; this only stops a press that is sure to be
 * refused.
 */
export function answerProblem(
  q: Pick<Question, 'action' | 'needs'>,
  a: Answers,
  now: NowLike,
  opts: { postNowOffered?: boolean } = {},
): string | null {
  const note = String(a.note ?? '').trim()
  for (const need of q.needs) {
    switch (need) {
      case 'time': {
        const t = bookableTimeProblem(a.scheduled_for, now, opts.postNowOffered === true)
        if (t) return t
        break
      }
      case 'agreed_via':
        if (!a.agreed_via || !(AGREED_VIA as readonly string[]).includes(a.agreed_via)) {
          return 'Say how the client agreed — on a call, by email, on WhatsApp, in person, or another way.'
        }
        if (a.agreed_via === 'other' && !note) return 'Say how the client agreed.'
        break
      case 'note':
        // on "Approve for the client" the note is only owed for "another way"
        if (q.action === 'team_decides' && !note) return 'Say why the team is deciding without the client.'
        if (q.action !== 'approve_for_client' && !note) return 'Say what needs changing — a short note is enough.'
        break
      case 'recipients':
        if (isReminderSend(q.action) && !(a.send_to ?? []).some(x => cleanEmail(x) != null)) return 'Tick who gets the reminder.'
        if (a.via !== 'link' && !(a.send_to ?? []).some(x => cleanEmail(x) != null)) {
          return 'Tick who gets it, or choose "Copy the link instead".'
        }
        break
      case 'confirm':
        break
      case 'steps':
        if (!a.steps || !(APPROVAL_STEPS as readonly string[]).includes(a.steps)) return 'Choose team only, or team then the client.'
        break
      case 'assign_to':
        break
    }
  }
  return null
}

/**
 * THE REQUEST A PRESS BECOMES — for `POST /api/posts/<id>/act`. It carries the
 * `rev` the window drew (a stale window is refused with the fresh post) and,
 * on a versioned move, the version the person looked at.
 */
export function buildActRequest(post: Pick<PostState, 'rev' | 'sent_version' | 'created_by'>, action: PostAction, a: Answers): PostActRequest {
  const row = ROW_OF[action]
  const needs = row.needs ?? []
  const req: PostActRequest = { action, expect_rev: post.rev }
  if (row.versioned && post.sent_version != null) req.version = post.sent_version
  const note = String(a.note ?? '').trim()
  if (note) req.note = note
  if (needs.includes('time') && a.scheduled_for) req.scheduled_for = a.scheduled_for
  if (needs.includes('agreed_via') && a.agreed_via) req.agreed_via = a.agreed_via
  if (needs.includes('assign_to')) req.assign_to = a.assign_to || post.created_by || null
  if (needs.includes('confirm')) req.confirm = true
  if (needs.includes('steps') && a.steps) req.steps = a.steps
  if (needs.includes('recipients')) {
    // a reminder is an email of the same send: never a copied link, never a new answer-by time
    const reminder = isReminderSend(action)
    if (a.via === 'link' && !reminder) req.via = 'link'
    else { req.via = 'email'; req.send_to = [...new Set((a.send_to ?? []).map(x => x.trim()).filter(Boolean))] }
    if (a.approve_by && !reminder) req.approve_by = a.approve_by
  }
  return req
}

/** The label beside "how the client agreed". */
export const AGREED_VIA_CHOICES: { value: AgreedVia; label: string }[] =
  AGREED_VIA.map(v => ({ value: v, label: AGREED_VIA_WORDS[v][0].toUpperCase() + AGREED_VIA_WORDS[v].slice(1) }))

/** Every button the footer draws, in order: the main one first, the bin last. */
export function footerButtons(list: PostActionList): { offered: OfferedAction; kind: 'primary' | 'secondary' | 'danger' }[] {
  return [
    ...(list.primary ? [{ offered: list.primary, kind: 'primary' as const }] : []),
    ...list.secondary.map(offered => ({ offered, kind: 'secondary' as const })),
    ...(list.danger ? [{ offered: list.danger, kind: 'danger' as const }] : []),
  ]
}

/** The moves after which the window stays open: the person is still working on the post. */
export const STAYS_OPEN: readonly PostAction[] = ['save', 'edit', 'edit_booked', 'rebook', 'set_steps']

/* ── the clock ──────────────────────────────────────────────────────────── */

/** Minutes offered in the picker: every five. */
export const MINUTE_STEP = 5
const QUARTER_MS = 15 * 60_000

/**
 * The minute choices, with the post's own minute kept when it is off the
 * five-minute steps — a box that cannot show the time the post holds is how
 * the pill read 3:07 while the box said :00 (audit W9).
 */
export function minuteOptions(current: number | null | undefined): number[] {
  const steps = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP)
  const c = typeof current === 'number' && Number.isInteger(current) && current >= 0 && current < 60 ? current : null
  return c == null || steps.includes(c) ? steps : [...steps, c].sort((a, b) => a - b)
}

/**
 * The time a new post starts on: the next quarter-hour that is at least 15
 * minutes away — never "today at 6 pm" after 6 pm (audit W9). Every time zone
 * sits on a quarter-hour offset, so a UTC quarter-hour is a local one too.
 */
export function defaultPostTime(now: NowLike): string {
  const n = ms(now)
  return new Date(Math.ceil((n + QUARTER_MS) / QUARTER_MS) * QUARTER_MS).toISOString()
}

/** Has this whole hour gone, in the client's zone? (A past hour is not offered.) */
export function hourIsPast(value: ClockValue, hour12: number, tz: string, now: NowLike): boolean {
  const last = joinClock({ ...value, hour12, minute: 59 }, tz)
  return last != null && ms(last) <= ms(now)
}

/** Has this minute of the chosen hour gone? */
export function minuteIsPast(value: ClockValue, minute: number, tz: string, now: NowLike): boolean {
  const at = joinClock({ ...value, minute }, tz)
  return at != null && ms(at) <= ms(now)
}

/**
 * THE "NOW" CHIP (audit W3). It is Post now — offered only when the post is
 * approved and the person may book it. Anywhere else it is drawn disabled with
 * the reason on it, so nobody is told to "choose Post now" when there is none.
 */
export function nowChip(list: PostActionList | null | undefined): { enabled: boolean; reason: string | null } {
  const all = list ? [list.primary, ...list.secondary, list.danger].filter((x): x is OfferedAction => !!x) : []
  const now = all.find(a => a.action === 'post_now')
  if (!now) return { enabled: false, reason: 'Approve first — Post now is for an approved post' }
  return now.blocked ? { enabled: false, reason: now.blocked } : { enabled: true, reason: null }
}

/**
 * What is wrong with the time on screen, or null — the TOO_SOON sentence only
 * mentions Post now when Post now is actually offered (audit W3).
 */
export function timeHint(when: string | null | undefined, now: NowLike, postNowOffered: boolean): string | null {
  if (!when) return null
  return bookableTimeProblem(when, now, postNowOffered)
}

/* ── Instagram's ten (decision 10) ──────────────────────────────────────── */

export type InstagramChoiceKey = 'drop' | 'split' | 'own'

/** "Instagram 11 of 10" beside the slides — null when Instagram is not on the post. */
export function instagramCounter(working: WorkingCopy, accounts: readonly AccountRef[]): { count: number; max: number; over: boolean; line: string } | null {
  const byId = new Map(accounts.map(a => [a.id, a]))
  const ig = working.channels.find(id => byId.get(id)?.platform === 'instagram')
  if (!ig) return null
  const own = working.perChannel[ig]?.slides
  const count = (own && own.length > 0 ? own : working.slides).length
  return { count, max: INSTAGRAM_MAX, over: count > INSTAGRAM_MAX, line: `Instagram ${count} of ${INSTAGRAM_MAX}` }
}

/** The three ways out when Instagram has more than ten (post-stage-core's `instagramOverflow`). */
export function instagramChoices(working: WorkingCopy, accounts: readonly AccountRef[]) {
  return instagramOverflow({ slides: working.slides, channels: working.channels, per_channel: working.perChannel }, accounts)
}

/**
 * Apply one of the three choices to the working copy.
 *   drop  — keep the first ten; the rest come out of the post.
 *   split — keep the first ten here; the rest become a second draft (`splitOff`).
 *   own   — Instagram gets its own first ten; the other networks keep them all.
 * The person can reorder in Change media before choosing, so "the first ten"
 * is theirs to decide.
 */
export function applyInstagramChoice(
  working: WorkingCopy,
  key: InstagramChoiceKey,
  accounts: readonly AccountRef[],
): { working: WorkingCopy; splitOff: Slide[] | null; words: string } {
  const byId = new Map(accounts.map(a => [a.id, a]))
  const igIds = working.channels.filter(id => byId.get(id)?.platform === 'instagram')
  const max = INSTAGRAM_MAX
  if (key === 'own') {
    const perChannel = { ...working.perChannel }
    for (const id of igIds) perChannel[id] = { ...(perChannel[id] ?? {}), slides: working.slides.slice(0, max) }
    return {
      working: { ...working, perChannel },
      splitOff: null,
      words: `Instagram now has its own ${max}. The other networks keep all ${working.slides.length}.`,
    }
  }
  // drop and split both keep the first ten here, for every network, and
  // clear any per-network set that would still hold more than ten
  const kept = working.slides.slice(0, max)
  const rest = working.slides.slice(max)
  const perChannel: Record<string, ChannelExtras> = {}
  for (const [id, extras] of Object.entries(working.perChannel)) {
    perChannel[id] = extras.slides && extras.slides.length > max && igIds.includes(id)
      ? { ...extras, slides: extras.slides.slice(0, max) }
      : extras
  }
  const n = rest.length
  return {
    working: { ...working, slides: kept, perChannel },
    splitOff: key === 'split' && n > 0 ? rest : null,
    words: key === 'split'
      ? `Split: this post keeps the first ${max}. The other ${n} ${n === 1 ? 'file is' : 'files are'} a new draft of ${n === 1 ? 'its' : 'their'} own.`
      : `The last ${n} ${n === 1 ? 'file was' : 'files were'} taken out. Use Change media to pick different ones.`,
  }
}

/* ── notes: per file, two threads (decision 9) ──────────────────────────── */

export type PostNote = {
  id: string
  post_id: string
  version: number | null
  file_url: string | null
  slide_index: number | null
  visibility: CommentVisibility
  author_id: string | null
  author_name: string | null
  body: string
  created_at: string
  resolved_at: string | null
}

/** Rows of `post_comments` as the window reads them — oldest first, empty ones dropped. */
export function readPostNotes(rows: readonly Record<string, unknown>[] | null | undefined): PostNote[] {
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null)
  return (rows ?? [])
    .map(r => ({
      id: String(r.id ?? ''),
      post_id: String(r.post_id ?? ''),
      version: typeof r.version === 'number' ? r.version : null,
      file_url: str(r.file_url),
      slide_index: typeof r.slide_index === 'number' ? r.slide_index : null,
      visibility: (r.visibility === 'client' ? 'client' : 'team') as CommentVisibility,
      author_id: str(r.author_id),
      author_name: str(r.author_name),
      body: typeof r.body === 'string' ? r.body : '',
      created_at: str(r.created_at) ?? '',
      resolved_at: str(r.resolved_at),
    }))
    .filter(n => n.id && n.body.trim())
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** How many notes each file carries, for the dot on its thumbnail. */
export function noteCounts(notes: readonly PostNote[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const n of notes) if (n.file_url) out.set(n.file_url, (out.get(n.file_url) ?? 0) + 1)
  return out
}

/** The body of `POST /api/posts/<id>/comments`. */
export type NoteInput = {
  body: string
  file_url: string | null
  slide_index: number | null
  version: number | null
  visibility: CommentVisibility
}

/**
 * Read a note from a request, or say what is wrong with it. Team is the
 * default thread: a note is only for the client when someone chose that.
 */
export function parseNoteInput(raw: unknown): { ok: true; note: NoteInput } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'The note is empty.' }
  const b = raw as Record<string, unknown>
  const body = typeof b.body === 'string' ? b.body.trim() : ''
  if (!body) return { ok: false, reason: 'Write the note first.' }
  if (body.length > 4000) return { ok: false, reason: 'That note is too long — keep it under 4,000 characters.' }
  const fileUrl = typeof b.file_url === 'string' && b.file_url.trim() ? b.file_url.trim() : null
  if (fileUrl && !/^https?:\/\//i.test(fileUrl)) return { ok: false, reason: 'That file is not one of this post\'s files.' }
  const idx = typeof b.slide_index === 'number' && Number.isInteger(b.slide_index) && b.slide_index >= 0 ? b.slide_index : null
  const version = typeof b.version === 'number' && Number.isInteger(b.version) && b.version >= 1 ? b.version : null
  if (b.visibility !== undefined && b.visibility !== null && b.visibility !== 'team' && b.visibility !== 'client') {
    return { ok: false, reason: 'Choose the Team thread or the Client thread.' }
  }
  return { ok: true, note: { body, file_url: fileUrl, slide_index: fileUrl ? idx : null, version, visibility: b.visibility === 'client' ? 'client' : 'team' } }
}

/** The version a new note belongs to: the one on screen. */
export function noteVersionOf(post: Pick<PostState, 'stage' | 'sent_version' | 'draft_version'>): number {
  return post.stage === 'draft' || post.sent_version == null ? post.draft_version : post.sent_version
}

/* ── the edit-media launcher: which post an edit lands on (audit S10) ──── */

/**
 * The posts an edit from the week's toolbar may change: this piece's posts
 * that are still drafts. A booked, posted or cancelled post is never quietly
 * changed, and "the first post of the piece" is never guessed.
 */
export function draftPostsOf<T extends { id: string; item_id?: string | null; source_item_id?: string | null; stage?: string | null }>(
  posts: readonly T[], itemId: string,
): T[] {
  return posts.filter(p => (p.source_item_id ?? p.item_id) === itemId && p.stage === 'draft')
}

/* ── the press, with the server injected ────────────────────────────────── */

/** The working copy as the create and save routes take it. */
export type WorkingBody = {
  slides: Slide[]
  caption: string
  channels: string[]
  per_channel: Record<string, ChannelExtras>
  scheduled_for: string | null
  timezone: string | null
  automation?: PostAutomation | null
}

export function workingBody(w: WorkingCopy, timezone: string | null): WorkingBody {
  return {
    slides: w.slides, caption: w.caption, channels: w.channels,
    per_channel: w.perChannel, scheduled_for: w.scheduledFor, timezone,
    ...(w.automation !== undefined ? { automation: w.automation } : {}),
  }
}

/** What the create and save routes answer: the raw row, or a refusal in words. */
export type SaveResponse =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; reason: string; problems?: string[]; row?: Record<string, unknown> | null }

/**
 * THE SERVER, AS THE WINDOW SEES IT (package P1 owns the routes):
 *   create — POST  /api/social/schedule            {item_id, …working copy}
 *   save   — PATCH /api/social/schedule/<id>       {expect_rev, …working copy}
 *   act    — POST  /api/posts/<id>/act             PostActRequest
 * `post-window-api.ts` is the fetch version; tests pass a fake.
 */
export type PostWindowApi = {
  create(body: WorkingBody & { item_id: string }): Promise<SaveResponse>
  save(postId: string, body: WorkingBody & { expect_rev: number }): Promise<SaveResponse>
  act(postId: string, req: PostActRequest): Promise<PostActResponse>
}

export type PressResult =
  | {
    ok: true; words: string; stage: PostStage | 'deleted'; post: PostState | null; postId: string | null
    /** a post the move made (Post the missing networks, Duplicate) */
    createdPostId?: string | null
    /** a client send by link: the client's page, for the person to paste */
    link?: string | null
  }
  | { ok: false; reason: string; problems: string[]; post: PostState | null; postId: string | null }

const SAVED_NO_STAGE = 'The post was saved, but the server did not say which stage it is in. Reload the page and try again.'

/**
 * ONE PRESS, START TO FINISH.
 *
 *   1. A post that is not saved yet is created first (every move needs a post).
 *   2. A draft with unsaved changes is saved first when the move sends or
 *      keeps the working copy (Save, Send for quality check) — so what is sent
 *      is what is on screen, and the save's new `rev` is what the move carries.
 *   3. The move goes to the act route. Its answer is the result: the words from
 *      the stage the post LANDED in, or the refusal with the fresh post.
 *
 * Nothing here decides whether a move is allowed — the server does, inside
 * its claim — and nothing is assumed about where the post ends up.
 */
export async function pressAction(api: PostWindowApi, input: {
  post: PostState | null
  itemId: string | null
  working: WorkingCopy
  dirty: boolean
  timezone: string | null
  action: PostAction
  answers: Answers
}): Promise<PressResult> {
  const { action } = input
  let post = input.post
  let postId = post?.id || null

  if (!postId && action === 'delete_draft') {
    return { ok: true, words: 'Nothing was saved — the draft is gone', stage: 'deleted', post: null, postId: null }
  }

  const body = workingBody(input.working, input.timezone)
  // Schedule it from a Draft freezes the working copy too: what is booked is what is on screen. Changing the approval
  // steps saves it first as well — it reloads the window, which threw unsaved work away (30 Sep 2026, Divina: "it
  // literally gets rid of everything I've done")
  const keepsCopy = action === 'save' || action === 'send_to_qc' || action === 'schedule_direct' || action === 'set_steps'
  try {
    if (!postId) {
      if (!input.itemId) return { ok: false, reason: 'Pick the files for this post first.', problems: [], post: null, postId: null }
      const made = await api.create({ ...body, item_id: input.itemId })
      if (!made.ok) return { ok: false, reason: made.reason, problems: made.problems ?? [], post: null, postId: null }
      post = readPostState(made.row)
      postId = String(made.row.id ?? '') || null
      if (!post || !postId) return { ok: false, reason: SAVED_NO_STAGE, problems: [], post: null, postId }
    } else if (post && post.stage === 'draft' && input.dirty && keepsCopy) {
      const saved = await api.save(postId, { ...body, expect_rev: post.rev })
      if (!saved.ok) {
        const fresh = saved.row ? readPostState(saved.row) : null
        return { ok: false, reason: saved.reason, problems: saved.problems ?? [], post: fresh, postId }
      }
      const next = readPostState(saved.row)
      if (!next) return { ok: false, reason: SAVED_NO_STAGE, problems: [], post, postId }
      post = next
    }
    if (!post || !postId) return { ok: false, reason: SAVED_NO_STAGE, problems: [], post: null, postId }
    if (action === 'save') return { ok: true, words: `Saved — still in ${STAGE_WORDS[post.stage].label}`, stage: post.stage, post, postId }

    const res = await api.act(postId, buildActRequest(post, action, input.answers))
    if (res.ok) {
      return {
        ok: true, words: res.words, stage: res.stage, post: res.post, postId,
        createdPostId: res.created_post_id ?? null, link: res.link ?? null,
      }
    }
    return { ok: false, reason: res.reason, problems: res.problems ?? [], post: res.post, postId }
  } catch {
    return {
      ok: false,
      reason: `"${ACTION_LABEL[action]}" did not reach the server — nothing has changed. Check the connection and try again.`,
      problems: [],
      post,
      postId,
    }
  }
}

/* ── notes placed on the post as it is now (30 Sep 2026) ────────────────── */

/**
 * WHERE EACH NOTE SITS NOW. A note is pinned to the FILE it was written on (so a reorder cannot move it onto the
 * wrong picture). When that file has since been REPLACED — the owner, 30 Sep 2026: Jordan's note on slide 6 vanished
 * once the new slide 6 went in, and when it came back it lit the slide up as if it were still waiting — the note
 * stays under the slide number it was written on, marked `replaced`: it is history, not work still to do.
 */
export type PlacedNote = { note: PostNote; slide: number | null; replaced: boolean }

export function placeNotes(notes: readonly PostNote[], slides: readonly { url: string }[]): PlacedNote[] {
  const urls = slides.map(s => s.url)
  return notes.map(note => {
    if (!note.file_url) return { note, slide: null, replaced: false }
    const at = urls.indexOf(note.file_url)
    if (at >= 0) return { note, slide: at + 1, replaced: false }
    return { note, slide: note.slide_index != null ? note.slide_index + 1 : null, replaced: true }
  })
}

/** The blue number on each slide: its notes still to do — on the file there now, not resolved. By slide number. */
export function openNoteCounts(placed: readonly PlacedNote[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const p of placed) {
    if (p.slide == null || p.replaced || p.note.resolved_at) continue
    out.set(p.slide, (out.get(p.slide) ?? 0) + 1)
  }
  return out
}

/** Which thread the Notes box opens on: the client's, when the client has said anything — that is what needs doing. */
export const firstNoteThread = (notes: readonly PostNote[]): CommentVisibility =>
  notes.some(n => n.visibility === 'client') ? 'client' : 'team'

/**
 * Files uploaded in the media window that are not in the post. An upload into a post that already has slides is
 * usually a REPLACEMENT, so it is never tacked on the end (30 Sep 2026: Divina's new slides 3, 5, 7 and 6 were
 * uploaded and never made it into the post, twice) — the person picks the slide it replaces, and Save stops while
 * one is left over.
 */
export function unplacedUploads<T extends { url: string; source?: string }>(files: readonly T[], tray: readonly { url: string }[]): T[] {
  const inPost = new Set(tray.map(t => t.url))
  return files.filter(f => f.source === 'upload' && !inPost.has(f.url))
}
