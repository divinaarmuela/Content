/**
 * THE POST'S STAGE — pure rules, no I/O, no `server-only`.
 *
 * The posting rebuild (29 Sep 2026). Read docs/posting-rebuild/OWNER_DECISIONS.md
 * first (it overrides the spec), then SPEC.md §2-§3, then AUDIT_EVIDENCE.md.
 *
 * WHY THIS FILE EXISTS. The old posting pages broke 82 ways, and nearly every
 * one came from the same root: a post's place was worked out in several spots
 * from several fields (`content_items.status`, `posting_approval_state`,
 * `posting_client_required`, `client_sent`, `delivered_at`, the job status), so
 * a card was drawn in one column and acted on as another, "Sent to client" was
 * printed for posts nobody sent, and a cancelled post had no way back. The
 * answer is one field and one set of rules:
 *
 *   1. A post's stage is `social_posts.stage`. Every page reads it. Nothing
 *      derives a stage from anything else, and `laneOf(post)` is `post.stage`.
 *   2. Every button on every surface comes from `postActions`, and every move
 *      the server makes goes through `checkPostTransition` /
 *      `planPostTransition`, which read the SAME table (`POST_TRANSITIONS`).
 *      A button that is drawn is a move the server accepts, and the reverse.
 *   3. Approval is per POST. The edit card the media came from is a source of
 *      files, never a gate: nothing here reads a content item.
 *   4. What was sent is frozen (`post_versions`). Reviewers and the client act
 *      on a version number; a stale page is refused, never applied.
 *   5. Nothing moves by itself when a time passes. A missed time is worked out
 *      at read time (`slotMissed`) and shown; a person picks a new one.
 *   6. Every stage has a way forward for the people who own it (the
 *      `no-dead-ends` test pins it).
 *
 * The OWNER'S DECISIONS applied over the spec:
 *   - Quality check is REQUIRED. There is no "send to the client unchecked"
 *     move: a post reaches the client only from the quality check (Passed —
 *     send to client) or, once passed, from Ready to post (Send to client).
 *     An account manager who is not the quality checker cannot pass a post.
 *     The one exception (the owner, 29 Sep 2026): a SUPER ADMIN may "Schedule it" from Draft or
 *     Quality check — booked at its time, recorded as scheduled without the check. Never Post now.
 *   - Schedulers may cancel ANY post, not only their own.
 *   - Client approval is optional per post. Each client has a default
 *     (`clients.client_approval_required` true = team then client), and a
 *     manager may change it for one post (`set_steps`).
 *   - A manager's yes on the client's behalf is recorded as theirs, with how
 *     the client agreed, and is never worded "Client approved".
 *   - Notes are per file/slide, in a Team thread (default) or a Client thread.
 *   - Instagram takes at most 10 files per post through the API; LinkedIn and
 *     TikTok may keep more when Instagram has its own ten (per-network media).
 *
 * The one writer of `social_posts.stage` is app/lib/post-stage.ts (package P1),
 * which runs `planPostTransition` inside a `table('social_posts').claim()` that
 * also checks `rev`. This file never writes anything.
 */

import { PLATFORM_RULES, networkName } from './publish-core'
import { MIN_LEAD_MS, TIME_TOO_SOON, TIME_TOO_SOON_OR_NOW, validateComposition } from './social-schedule-core'
import { optionsFromExtras, readChannelExtras, type ChannelExtras } from './schedule-compose-core'
import type { PostKind } from './publish-core'
import type { Slide } from './version-files-core'
import { readPostAutomation, type PostAutomation } from './comment-automation-core'
import { isTestClient } from './test-clients-core'
import { readPostBatch, type PostBatch } from './post-batch-core'
import {
  ANSWER_LIVE, ANSWER_NOTE_NEEDED, clientAnswerProblem, holdDue, insideLastSlot, onePortal, readClientReview, readReviewAsked,
  type ClientReview, type ClientVerdict, type IfNoAnswer, type ReviewAsked,
} from './one-portal-core'

/* ── stages ─────────────────────────────────────────────────────────────── */

export const POST_STAGES = [
  'draft', 'quality_check', 'with_client', 'ready', 'booked', 'posted', 'cancelled',
] as const
export type PostStage = (typeof POST_STAGES)[number]

export function isPostStage(v: unknown): v is PostStage {
  return typeof v === 'string' && (POST_STAGES as readonly string[]).includes(v)
}

/** The tones a Chip takes (`app/dashboard/ui/Chip.tsx` `ChipTone`), named here
 *  so this pure file imports no component. Amber needs a person, blue is
 *  booked, green is approved, ink is live, red went wrong. */
export type StageTone = 'ink' | 'surface' | 'blue' | 'green' | 'amber' | 'red' | 'muted'

/**
 * THE ONE LIST OF STAGE WORDS AND COLOURS (the owner's decision 12). The Post
 * approval board, the Schedule grid and list, the post window, Waiting on you,
 * the Overview tiles and the client portal all read their words from here.
 * A second spelling anywhere is the bug.
 */
export const STAGE_WORDS: Record<PostStage, { label: string; meaning: string; tone: StageTone }> = {
  draft:         { label: 'Draft',         meaning: 'Being made. Nobody else sees it yet.',        tone: 'muted' },
  quality_check: { label: 'Quality check', meaning: 'Waiting for the quality check.',              tone: 'surface' },
  with_client:   { label: 'With client',   meaning: 'Sent to the client. Waiting for their answer.', tone: 'amber' },
  // amber, not green (the owner, 30 Sep 2026: a Ready card and a Booked card both read as done) — approved, NOT booked
  ready:         { label: 'Ready to post', meaning: 'Approved, not booked yet. It needs Book in.',   tone: 'amber' },
  booked:        { label: 'Booked in',     meaning: 'Booked in. It goes out at its time.',          tone: 'blue' },
  posted:        { label: 'Posted',        meaning: 'Live on its networks.',                        tone: 'ink' },
  cancelled:     { label: 'Cancelled',     meaning: 'Cancelled. It will not go out.',               tone: 'muted' },
}
export const STAGE_LABEL = Object.fromEntries(POST_STAGES.map(s => [s, STAGE_WORDS[s].label])) as Record<PostStage, string>
export const STAGE_MEANING = Object.fromEntries(POST_STAGES.map(s => [s, STAGE_WORDS[s].meaning])) as Record<PostStage, string>
export const STAGE_TONE = Object.fromEntries(POST_STAGES.map(s => [s, STAGE_WORDS[s].tone])) as Record<PostStage, StageTone>

/** A time that has passed while the post waited (the owner's decision 11). */
export const MISSED_LABEL = 'Missed — needs a new time'
export const MISSED_TONE: StageTone = 'red'

/**
 * The tone a card or tile wears: its stage's, unless something is wrong with
 * it — a missed time, or a problem it came back with — which is red, so a
 * post that will not go out never looks like one that will (audit S13).
 */
export function postTone(post: PostState, now: NowLike): StageTone {
  if (slotMissed(post, now) || (post.problem && post.stage !== 'cancelled')) return 'red'
  return STAGE_TONE[post.stage]
}

/**
 * WHICH PAGE A STAGE BELONGS TO (the owner's decision 1). Post approval gets a
 * post approved; Schedule gets approved posts out. Both read the one stage.
 */
export const STAGE_PAGE: Record<PostStage, 'post_approval' | 'schedule' | 'both'> = {
  draft: 'post_approval', quality_check: 'post_approval', with_client: 'post_approval',
  ready: 'schedule', booked: 'schedule', posted: 'schedule', cancelled: 'both',
}

export type Lane = { key: string; label: string; stages: readonly PostStage[] }

/** Post approval's columns. "Approved" holds every post that has left the
 *  approval road; its cards still wear their own stage chip. */
export const POST_APPROVAL_LANES: readonly Lane[] = [
  { key: 'draft', label: STAGE_LABEL.draft, stages: ['draft'] },
  { key: 'quality_check', label: STAGE_LABEL.quality_check, stages: ['quality_check'] },
  { key: 'with_client', label: STAGE_LABEL.with_client, stages: ['with_client'] },
  { key: 'approved', label: 'Approved', stages: ['ready', 'booked', 'posted'] },
]

/** Schedule's columns. Missed times are not a stage: `slotMissed` marks them. */
export const SCHEDULE_LANES: readonly Lane[] = [
  { key: 'ready', label: STAGE_LABEL.ready, stages: ['ready'] },
  { key: 'booked', label: STAGE_LABEL.booked, stages: ['booked'] },
  { key: 'posted', label: STAGE_LABEL.posted, stages: ['posted'] },
]

/** The lane a card is drawn in IS its stage — one line, no rewriting (audit B1, B9-B13). */
export function laneOf(post: Pick<PostState, 'stage'>): PostStage {
  return post.stage
}

/** The board lane (by `Lane.key`) that holds this stage on the given page, or null when that page does not show it. */
export function pageLaneOf(lanes: readonly Lane[], stage: PostStage): string | null {
  return lanes.find(l => l.stages.includes(stage))?.key ?? null
}

/**
 * THE CLIENT'S WORDS (SPEC §4.4; research M1: name client stages separately so
 * "waiting on the client" never means "waiting on the quality check"). Stages
 * the client never sees map to null.
 */
export type PortalColumn = 'review' | 'approved' | 'going_out' | 'done'
export const PORTAL_COLUMN: Record<PostStage, PortalColumn | null> = {
  draft: null, quality_check: null, with_client: 'review',
  ready: 'approved', booked: 'going_out', posted: 'done', cancelled: null,
}

/* ── who: hats ──────────────────────────────────────────────────────────── */

/**
 * A HAT is what a person is while acting on ONE post (SPEC §3).
 *   creator   — made this post
 *   scheduler — the scheduler or general role
 *   am        — account manager
 *   qr        — the quality checker (the role, or the quality_reviewer flag)
 *   sa        — super admin; listed on every team row it may use
 *   tester    — an account manager on a TEST client's post (100M, ZZ E2E, ZZ TEST). Meta's App Review
 *               signs in as a 100M-only account manager and has to book a post alone, with nobody there to
 *               pass a quality check (the owner, 5 Oct 2026: "allow them to publish"). Worn on test clients
 *               only, and it opens one row: Schedule it. A real client's post is never touched by it.
 *   client    — the portal link holder; valid only on the client rows
 *   system    — the publish recorder and the booking steps
 * Editors and designers are not in the posting flow (the owner's decision 7).
 */
export type PostHat = 'creator' | 'scheduler' | 'am' | 'qr' | 'sa' | 'tester' | 'client' | 'system'
export const POST_HATS: readonly PostHat[] = ['creator', 'scheduler', 'am', 'qr', 'sa', 'tester', 'client', 'system']

export const HAT_WORDS: Record<PostHat, string> = {
  creator: 'the person who made it',
  scheduler: 'a scheduler',
  am: 'an account manager',
  qr: 'the quality checker',
  sa: 'a super admin',
  tester: 'an account manager on a test client',
  client: 'the client',
  system: 'the app',
}

export type Viewer = {
  id?: string | null
  role?: string | null
  quality_reviewer?: boolean | null
}

/** The hats a team member wears on this post. */
export function hatsFor(viewer: Viewer | null | undefined, post: { created_by?: string | null; client_id?: string | null } | null | undefined): PostHat[] {
  if (!viewer) return []
  const role = String(viewer.role ?? '')
  if (role === 'client') return ['client']
  const hats = new Set<PostHat>()
  if (role === 'super_admin') hats.add('sa')
  if (role === 'account_manager') hats.add('am')
  if (role === 'account_manager' && isTestClient(post?.client_id)) hats.add('tester')
  if (role === 'scheduler' || role === 'general') hats.add('scheduler')
  if (role === 'quality_checker' || viewer.quality_reviewer === true) hats.add('qr')
  // editors and designers make the EDIT, not the post: never the creator hat
  const inFlow = ['super_admin', 'account_manager', 'scheduler', 'general', 'quality_checker'].includes(role)
  if (inFlow && viewer.id && post?.created_by && viewer.id === post.created_by) hats.add('creator')
  return POST_HATS.filter(h => hats.has(h))
}

/**
 * MAY THIS TEAM MEMBER WORK ON THIS POST AT ALL? One rule for what the boards
 * show and what the server lets them press (review, 29 Sep 2026: the board
 * showed the quality checker every post waiting on the check while the act
 * route refused them on clients they were not on).
 *
 *   `clientIds` — the clients they are on (`accessibleClientIds`); null means
 *   every client (super admin, scheduler, general).
 *   The quality reviewer's desk: every post waiting on the quality check,
 *   whoever's client it is (the same exception the edit card has,
 *   production-access.ts `loadItemForUser`).
 * Nothing else widens it — not having made the post, not being named on it:
 * a person taken off a client is off its posts. Which buttons they then get
 * is still the stage rules' hats, per post.
 */
export function mayWorkOnPost(
  person: { id: string; role?: string | null; quality_reviewer?: boolean | null },
  post: { client_id: string; stage: PostStage; created_by?: string | null; assigned_to?: string | null; changes_asked?: { to?: string | null } | null },
  clientIds: readonly string[] | null,
): boolean {
  if (!person || person.role === 'client') return false
  if (clientIds === null) return true
  const reviewer = person.role === 'quality_checker' || person.quality_reviewer === true
  if (reviewer && post.stage === 'quality_check') return true
  return clientIds.includes(post.client_id)
}

/**
 * MAY THIS ROLE EVER DO THIS MOVE? Asked of the one transition table, for pages that describe a role rather
 * than act on a post (the client's access page: "Can plan · Can approve · Can post"). The creator hat is left
 * out on purpose — it belongs to one person on one post, not to a role.
 */
export function roleMayAct(role: string, action: string, qualityReviewer = false): boolean {
  const hats = hatsFor({ id: '', role, quality_reviewer: qualityReviewer }, null)
  return POST_TRANSITIONS.some(r => r.action === action && r.who.some(h => hats.includes(h)))
}

/* ── approval steps, per client and per post ────────────────────────────── */

/**
 * Loomly-style approval steps (the owner's decisions 6 and 13). The client's
 * default is its EXISTING `client_approval_required` flag — one question, one
 * column, never a second one meaning the same thing — and a post may override it.
 */
export type ApprovalSteps = 'team' | 'team_then_client'
export const APPROVAL_STEPS: readonly ApprovalSteps[] = ['team', 'team_then_client']
export const APPROVAL_STEPS_LABEL: Record<ApprovalSteps, string> = {
  team: 'Team only',
  team_then_client: 'Team, then the client',
}
export function isApprovalSteps(v: unknown): v is ApprovalSteps {
  return v === 'team' || v === 'team_then_client'
}

export function approvalStepsOf(
  post: Pick<PostState, 'approval_steps'>,
  client?: { client_approval_required?: boolean | null; portal_one?: boolean | null } | null,
): ApprovalSteps {
  // ONE PORTAL (docs/ONE_PORTAL_SPEC.md R2): booked first, the client answers after — never a client step before booking
  if (onePortal(client)) return 'team'
  if (isApprovalSteps(post.approval_steps)) return post.approval_steps
  return client?.client_approval_required === true ? 'team_then_client' : 'team'
}

/* ── the records a post carries ─────────────────────────────────────────── */

/** How the client said yes when a manager approves for them (decision 5). */
export type AgreedVia = 'call' | 'email' | 'whatsapp' | 'in_person' | 'other'
export const AGREED_VIA: readonly AgreedVia[] = ['call', 'email', 'whatsapp', 'in_person', 'other']
export const AGREED_VIA_WORDS: Record<AgreedVia, string> = {
  call: 'on a call', email: 'by email', whatsapp: 'on WhatsApp', in_person: 'in person', other: 'another way',
}
export function isAgreedVia(v: unknown): v is AgreedVia {
  return typeof v === 'string' && (AGREED_VIA as readonly string[]).includes(v)
}

/** Who approved WHICH version. A manager's yes for the client is theirs, with `on_behalf_of_client`. */
export type ApprovalHat = 'quality_reviewer' | 'account_manager' | 'super_admin' | 'client'
export type Approval = {
  version: number
  by: string | null
  hat: ApprovalHat
  on_behalf_of_client: boolean
  agreed_via: AgreedVia | null
  note: string | null
  at: string
  /**
   * Schedule it (the owner, 29 Sep 2026: "super admin should be able to schedule posts not post now"):
   * a super admin booked this version with NO quality check. Present only then, so the record never
   * reads as a pass.
   */
  skipped_check?: true
  /** …and the post's steps were team then the client, so the client did not see it either */
  without_client?: true
}
export type QcPass = { version: number; by: string | null; at: string }
export type ChangesAsked = {
  version: number | null
  by: string | null
  who: 'client' | 'team'
  /** the named person who makes the change (decision 9) */
  to: string | null
  note: string
  at: string
}
export type ClientSend = {
  version: number
  at: string
  to: string[]
  via: 'email' | 'link'
  /** after this the client's approve and ask-for-a-change close (decision 11) */
  approve_by: string | null
  /** the posting time the client was shown */
  for_time: string | null
  /**
   * The last "Remind the client" (29 Sep 2026): the SAME version's link emailed again. It changes
   * nothing else — not the version, not the approve-by, not the posting time.
   */
  reminded_at?: string | null
  reminded_to?: string[]
}
export type Booking = { job_ids: string[]; pending: boolean; at: string; for_time: string | null }
export type OutcomeStatus = 'published' | 'failed' | 'duplicate' | 'scheduled'
export type NetworkOutcome = { status: OutcomeStatus; url: string | null; at: string | null; error: string | null }
export type Cancelled = { by: string | null; at: string; from_stage: PostStage | null; reason: string | null }

/**
 * A post as the rules read it. `readPostState` builds one from a raw
 * `social_posts` row; the rules never see the raw row.
 */
export type PostState = {
  id: string
  client_id: string
  created_by: string | null
  stage: PostStage
  rev: number
  stage_at: string | null
  draft_version: number
  sent_version: number | null
  // the working copy
  scheduled_for: string | null
  timezone: string | null
  channels: string[]
  slides: Slide[]
  caption: string
  per_channel: Record<string, ChannelExtras>
  /** the comment-to-DM automation set up while scheduling (comment-automation-core); frozen with the rest */
  automation?: PostAutomation | null
  // the stage's records
  approval_steps: ApprovalSteps | null
  approval: Approval | null
  qc_pass: QcPass | null
  changes_asked: ChangesAsked | null
  client_send: ClientSend | null
  last_client_send: ClientSend | null
  booking: Booking | null
  outcomes: Record<string, NetworkOutcome>
  problem: string | null
  cancelled: Cancelled | null
  assigned_to: string | null
  source_item_id: string | null
  source_deleted: boolean
  /** one of a card's posts, made by the hand-over (post-batch-core) — absent on every other post */
  batch?: PostBatch | null
  // ── ONE PORTAL (docs/ONE_PORTAL_SPEC.md) — present only when written, so every other post reads as before ──
  if_no_answer?: IfNoAnswer | null
  client_review?: ClientReview | null
  review_asked?: ReviewAsked | null
  client_reviews?: ClientReview[]
}

/* ── reading a raw row ──────────────────────────────────────────────────── */

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : isObj(v) ? Object.values(v).filter((x): x is string => typeof x === 'string' && x.length > 0) : []
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : isObj(v) ? Object.values(v) : [])

function readSlides(v: unknown): Slide[] {
  return list(v).filter((s): s is Slide => isObj(s) && typeof s.url === 'string' && s.url.length > 0)
    .map(s => ({ ...s, name: typeof s.name === 'string' ? s.name : '', type: s.type === 'video' ? 'video' : 'image' } as Slide))
}

function readApproval(v: unknown): Approval | null {
  if (!isObj(v)) return null
  const version = num(v.version)
  const hat = v.hat
  if (version == null || !['quality_reviewer', 'account_manager', 'super_admin', 'client'].includes(String(hat))) return null
  return {
    version, by: str(v.by), hat: hat as ApprovalHat,
    on_behalf_of_client: v.on_behalf_of_client === true,
    agreed_via: isAgreedVia(v.agreed_via) ? v.agreed_via : null,
    note: str(v.note), at: str(v.at) ?? '',
    ...(v.skipped_check === true ? { skipped_check: true as const } : {}),
    ...(v.without_client === true ? { without_client: true as const } : {}),
  }
}

function readClientSend(v: unknown): ClientSend | null {
  if (!isObj(v)) return null
  const version = num(v.version)
  if (version == null) return null
  return {
    version, at: str(v.at) ?? '', to: strList(v.to), via: v.via === 'link' ? 'link' : 'email',
    approve_by: str(v.approve_by), for_time: str(v.for_time),
    ...(str(v.reminded_at) ? { reminded_at: str(v.reminded_at), reminded_to: strList(v.reminded_to) } : {}),
  }
}

function readOutcomes(v: unknown): Record<string, NetworkOutcome> {
  const out: Record<string, NetworkOutcome> = {}
  if (!isObj(v)) return out
  for (const [platform, raw] of Object.entries(v)) {
    if (!isObj(raw)) continue
    const status = raw.status
    if (!['published', 'failed', 'duplicate', 'scheduled'].includes(String(status))) continue
    out[platform] = { status: status as OutcomeStatus, url: str(raw.url), at: str(raw.at), error: str(raw.error) }
  }
  return out
}

/**
 * A raw `social_posts` row as the rules read it, or null when the row has no
 * valid stage. Only a row the migration has not reached yet has none; the
 * migration gives every row one before the new pages go live.
 */
export function readPostState(row: Record<string, unknown> | null | undefined): PostState | null {
  if (!row || !isPostStage(row.stage)) return null
  const perChannel: Record<string, ChannelExtras> = {}
  if (isObj(row.per_channel)) for (const [k, raw] of Object.entries(row.per_channel)) perChannel[k] = readChannelExtras(raw)
  const qc = isObj(row.qc_pass) && num(row.qc_pass.version) != null
    ? { version: num(row.qc_pass.version)!, by: str(row.qc_pass.by), at: str(row.qc_pass.at) ?? '' } : null
  const ca = row.changes_asked
  const changes: ChangesAsked | null = isObj(ca) && (ca.who === 'client' || ca.who === 'team')
    ? { version: num(ca.version), by: str(ca.by), who: ca.who, to: str(ca.to), note: typeof ca.note === 'string' ? ca.note : '', at: str(ca.at) ?? '' }
    : null
  const bk = row.booking
  const booking: Booking | null = isObj(bk)
    ? { job_ids: strList(bk.job_ids), pending: bk.pending === true, at: str(bk.at) ?? '', for_time: str(bk.for_time) }
    : null
  const cx = row.cancelled
  const cancelled: Cancelled | null = isObj(cx)
    ? { by: str(cx.by), at: str(cx.at) ?? '', from_stage: isPostStage(cx.from_stage) ? cx.from_stage : null, reason: str(cx.reason) }
    : null
  return {
    id: String(row.id ?? ''),
    client_id: String(row.client_id ?? ''),
    created_by: str(row.created_by),
    stage: row.stage,
    rev: num(row.rev) ?? 0,
    stage_at: str(row.stage_at),
    draft_version: Math.max(1, num(row.draft_version) ?? 1),
    sent_version: num(row.sent_version),
    scheduled_for: str(row.scheduled_for),
    timezone: str(row.timezone),
    channels: strList(row.channels),
    slides: readSlides(row.slides),
    caption: typeof row.caption === 'string' ? row.caption : '',
    per_channel: perChannel,
    approval_steps: isApprovalSteps(row.approval_steps) ? row.approval_steps : null,
    approval: readApproval(row.approval),
    qc_pass: qc,
    changes_asked: changes,
    client_send: readClientSend(row.client_send),
    last_client_send: readClientSend(row.last_client_send),
    booking,
    outcomes: readOutcomes(row.outcomes),
    problem: str(row.problem),
    cancelled,
    assigned_to: str(row.assigned_to),
    source_item_id: str(row.source_item_id) ?? str(row.item_id),
    source_deleted: row.source_deleted === true,
    // only when there is one, so a post without an automation reads exactly as it always did
    ...(readPostAutomation(row.automation) ? { automation: readPostAutomation(row.automation) } : {}),
    // …and its batch, only when it is one of a card's posts
    ...(readPostBatch(row.batch) ? { batch: readPostBatch(row.batch) } : {}),
    // …and the one portal's records, only when there are some
    ...(row.if_no_answer === 'wait' || row.if_no_answer === 'post' ? { if_no_answer: row.if_no_answer } : {}),
    ...(readClientReview(row.client_review) ? { client_review: readClientReview(row.client_review) } : {}),
    ...(readReviewAsked(row.review_asked) ? { review_asked: readReviewAsked(row.review_asked) } : {}),
    ...(list(row.client_reviews).map(readClientReview).some(Boolean)
      ? { client_reviews: list(row.client_reviews).map(readClientReview).filter((r): r is ClientReview => !!r) } : {}),
  }
}

/* ── time ───────────────────────────────────────────────────────────────── */

export type NowLike = string | number | Date
const ms = (t: NowLike | null | undefined): number => {
  if (t == null) return NaN
  return t instanceof Date ? t.getTime() : typeof t === 'number' ? t : new Date(t).getTime()
}
const iso = (t: NowLike): string => new Date(ms(t)).toISOString()

/** The default "approve by": this long before the posting time, so the team can still book it after the client's yes. */
export const APPROVE_BY_LEAD_MS = 2 * 60 * 60_000
/** Reminders before the "approve by" time (decision 11). */
export const APPROVAL_REMINDERS_MS = { '24h': 24 * 60 * 60_000, '1h': 60 * 60_000 } as const

export const TIME_MISSING = 'Pick a time — this post has none'
export const TIME_GONE = 'That time has already gone — pick a later one'
export const TIME_UNREADABLE = 'That is not a time we can read — pick one from the calendar'

/** null when `when` is a bookable time (15 or more minutes ahead), else the sentence that says why not. */
export function bookableTimeProblem(when: string | null | undefined, now: NowLike, postNowOffered = false): string | null {
  if (!when) return TIME_MISSING
  const t = ms(when)
  if (!Number.isFinite(t)) return TIME_UNREADABLE
  if (t <= ms(now)) return TIME_GONE
  if (t < ms(now) + MIN_LEAD_MS) return postNowOffered ? TIME_TOO_SOON_OR_NOW : TIME_TOO_SOON
  return null
}

/**
 * The default "approve by": two hours before the posting time, or — when that
 * has already gone — the last moment a yes could still be booked (15 minutes
 * before). Null with no posting time.
 */
export function defaultApproveBy(scheduledFor: string | null | undefined, now: NowLike): string | null {
  const t = ms(scheduledFor)
  if (!Number.isFinite(t)) return null
  const early = t - APPROVE_BY_LEAD_MS
  return iso(early > ms(now) + MIN_LEAD_MS ? early : t - MIN_LEAD_MS)
}

/** When the client's approval closes for a post that is with them. */
export function approveByOf(post: Pick<PostState, 'client_send' | 'scheduled_for'>): string | null {
  if (post.client_send?.approve_by) return post.client_send.approve_by
  const t = ms(post.client_send?.for_time ?? post.scheduled_for)
  return Number.isFinite(t) ? iso(t - MIN_LEAD_MS) : null
}

/**
 * HAS THIS POST'S TIME BEEN MISSED (decision 11)? Derived at read time — nothing
 * moves by itself.
 *   with_client:   the "approve by" time has come. The client can no longer
 *                  answer; the team sets a new time and resends.
 *   quality_check, ready: the posting time is closer than 15 minutes (or gone),
 *                  so it can no longer be booked at that time.
 *   anything else: never — a draft's time is asked for at the send, a booked
 *                  post belongs to the provider, and a posted one is done.
 */
export function slotMissed(post: Pick<PostState, 'stage' | 'client_send' | 'scheduled_for'>, now: NowLike): boolean {
  const n = ms(now)
  if (!Number.isFinite(n)) return false
  if (post.stage === 'with_client') {
    const by = ms(approveByOf(post))
    return Number.isFinite(by) && n >= by
  }
  if (post.stage === 'quality_check' || post.stage === 'ready') {
    const t = ms(post.scheduled_for)
    return Number.isFinite(t) && n > t - MIN_LEAD_MS
  }
  return false
}

/** The reminder moments before the client's approve-by time (decision 11), the latest first. */
export function approvalReminderTimes(approveBy: string | null | undefined): { kind: keyof typeof APPROVAL_REMINDERS_MS; at: string }[] {
  const by = ms(approveBy)
  if (!Number.isFinite(by)) return []
  return (Object.entries(APPROVAL_REMINDERS_MS) as [keyof typeof APPROVAL_REMINDERS_MS, number][])
    .map(([kind, lead]) => ({ kind, at: by - lead }))
    .sort((a, b) => b.at - a.at)
    .map(r => ({ kind: r.kind, at: iso(r.at) }))
}

/* ── composition: THE rule, reused ──────────────────────────────────────── */

/** One connected channel, as the caller has loaded it. */
export type AccountRef = { id: string; platform: string; live?: boolean | null; name?: string | null }


/** Instagram's ceiling through the API (publish-core: 28 Sep 2026, fifteen sent, ten went out). */
export const INSTAGRAM_MAX = PLATFORM_RULES.instagram.carousel

export const CHANNEL_NOT_FOUND = 'One of this post\'s channels is not connected any more — choose its channels again'

/**
 * Everything wrong with this post's working copy, in plain words — by
 * `validateComposition`, the same rule the composer shows while typing. The
 * time is checked by the guards, not here, and the edit card is not read.
 */
export function compositionProblems(
  post: Pick<PostState, 'slides' | 'caption' | 'channels' | 'per_channel' | 'scheduled_for'>,
  accounts: readonly AccountRef[],
  now: NowLike,
): string[] {
  const byId = new Map(accounts.map(a => [a.id, a]))
  const found = post.channels.map(id => byId.get(id)).filter((a): a is AccountRef => !!a)
  const problems: string[] = []
  if (found.length < post.channels.length) problems.push(CHANNEL_NOT_FOUND)
  const result = validateComposition({
    item: null,
    version: null,
    slides: post.slides,
    caption: post.caption,
    channels: found.map(a => {
      const extras = post.per_channel[a.id] ?? {}
      return {
        id: a.id,
        platform: a.platform,
        kind: (extras.kind as PostKind | undefined) ?? null,
        options: optionsFromExtras(extras),
        slides: extras.slides ?? null,
      }
    }),
    scheduledFor: post.scheduled_for,
    // the edit card is a source of files, never a gate (SPEC §1.3)
    saving: true,
    draft: false,
    requireTime: false,
    now: iso(now),
  })
  return [...problems, ...result.problems]
}

/**
 * MORE THAN TEN FOR INSTAGRAM (decision 10): what the window offers instead of
 * sending the eleventh. Null when Instagram is not on the post or has ten or fewer.
 */
export type InstagramChoice = { key: 'drop' | 'split' | 'own'; label: string }
export function instagramOverflow(
  post: Pick<PostState, 'slides' | 'channels' | 'per_channel'>,
  accounts: readonly AccountRef[],
): { count: number; max: number; over: number; choices: InstagramChoice[] } | null {
  const byId = new Map(accounts.map(a => [a.id, a]))
  const ig = post.channels.find(id => byId.get(id)?.platform === 'instagram')
  if (!ig) return null
  const own = post.per_channel[ig]?.slides
  const count = (own && own.length > 0 ? own : post.slides).length
  if (count <= INSTAGRAM_MAX) return null
  const others = post.channels.some(id => id !== ig && byId.get(id)?.platform !== 'instagram')
  const choices: InstagramChoice[] = [
    { key: 'drop', label: `Keep ${INSTAGRAM_MAX} — take ${count - INSTAGRAM_MAX} out` },
    { key: 'split', label: 'Split it into two posts' },
  ]
  if (others) choices.push({ key: 'own', label: `Give Instagram its own ${INSTAGRAM_MAX} — the other networks keep all ${count}` })
  return { count, max: INSTAGRAM_MAX, over: count - INSTAGRAM_MAX, choices }
}

/** The channels on this post that are not connected, by network name (audit S13). */
export function lostChannels(post: Pick<PostState, 'channels'>, accounts: readonly AccountRef[]): string[] {
  const byId = new Map(accounts.map(a => [a.id, a]))
  return post.channels
    .filter(id => { const a = byId.get(id); return !a || a.live === false })
    .map(id => { const a = byId.get(id); return a ? networkName(a.platform) : 'A channel' })
}

/* ── outcomes, per network ──────────────────────────────────────────────── */

const WENT_OUT: readonly OutcomeStatus[] = ['published', 'duplicate']

/** The networks this post already went out on ('duplicate' = the provider says it is already live, audit S5). */
export function liveNetworks(post: Pick<PostState, 'outcomes'>): string[] {
  return Object.entries(post.outcomes).filter(([, o]) => WENT_OUT.includes(o.status)).map(([p]) => p)
}
export function failedNetworks(post: Pick<PostState, 'outcomes'>): string[] {
  return Object.entries(post.outcomes).filter(([, o]) => o.status === 'failed').map(([p]) => p)
}
export function anyNetworkLive(post: Pick<PostState, 'outcomes'>): boolean {
  return liveNetworks(post).length > 0
}

/**
 * Where a booking stands across the networks it targeted:
 *   pending — some network has no answer yet (or is still scheduled)
 *   posted  — every one went out
 *   partial — some went out, some failed
 *   failed  — none went out and at least one failed
 */
export type OutcomeVerdict = 'pending' | 'posted' | 'partial' | 'failed'
export function outcomeVerdict(outcomes: Record<string, NetworkOutcome>, targets: readonly string[]): OutcomeVerdict {
  const want = targets.length > 0 ? targets : Object.keys(outcomes)
  if (want.length === 0) return 'pending'
  let live = 0, failed = 0
  for (const p of want) {
    const o = outcomes[p]
    if (!o || o.status === 'scheduled') return 'pending'
    if (WENT_OUT.includes(o.status)) live++
    else failed++
  }
  if (failed === 0) return 'posted'
  return live > 0 ? 'partial' : 'failed'
}

/** The system action for a set of outcomes, or null while any network is still pending. */
export function outcomeAction(outcomes: Record<string, NetworkOutcome>, targets: readonly string[]): 'record_posted' | 'record_partial' | 'record_failed' | null {
  const v = outcomeVerdict(outcomes, targets)
  return v === 'posted' ? 'record_posted' : v === 'partial' ? 'record_partial' : v === 'failed' ? 'record_failed' : null
}

const joinNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/** What a post is called — on a card and in an email: the edit it came from, else its caption's first line. */
export function postTitle(post: Pick<PostState, 'caption'> & { batch?: PostBatch | null }, sourceTitle?: string | null): string {
  // one of a card's batch: "WALK TEST · 3 of 8", so eight posts of one card are told apart
  if (post.batch?.title?.trim()) return post.batch.title.trim()
  const title = String(sourceTitle ?? '').trim()
  if (title) return title
  const line = String(post.caption ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? ''
  if (!line) return 'Untitled post'
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line
}

/** "Posted on 3 of 4" — never "Did not go out" for a post that is live somewhere (audit S7). */
export function postedWords(post: Pick<PostState, 'outcomes'>): string {
  const all = Object.keys(post.outcomes)
  const live = liveNetworks(post)
  const failed = failedNetworks(post)
  if (failed.length === 0) return STAGE_LABEL.posted
  return `Posted on ${live.length} of ${all.length} — ${joinNames(failed.map(networkName))} did not go out`
}

/* ── the transition table ───────────────────────────────────────────────── */

export const POST_ACTIONS = [
  'save', 'send_to_qc', 'pass', 'pass_send_client', 'ask_change',
  'client_approve', 'client_ask_change', 'approve_for_client', 'team_decides', 'take_back', 'resend_new_time',
  'remind_client', 'send_to_client', 'book', 'schedule_direct', 'post_now', 'change_time', 'unbook',
  'edit', 'edit_booked', 'cancel', 'rebook', 'missing_networks', 'duplicate', 'delete_draft', 'set_steps',
  'booking_done', 'booking_failed', 'link_jobs', 'record_posted', 'record_partial', 'record_failed',
  'auto_book',
  // ONE PORTAL (docs/ONE_PORTAL_SPEC.md) — refused unless the client is on it
  'client_ok', 'client_not_approved', 'client_ok_book', 'hold_for_client', 'set_if_no_answer',
] as const
export type PostAction = (typeof POST_ACTIONS)[number]
export function isPostAction(v: unknown): v is PostAction {
  return typeof v === 'string' && (POST_ACTIONS as readonly string[]).includes(v)
}

/** What a person has to give with the press, so the window asks for it next to the button. */
export type InputNeed = 'note' | 'time' | 'agreed_via' | 'assign_to' | 'confirm' | 'recipients' | 'steps' | 'if_no_answer'

export type TransitionRow = {
  action: PostAction
  /** SPEC §3 row number, for the reader */
  spec: string
  from: readonly PostStage[]
  /** 'same': the post stays where it is (a new post may be made); 'deleted': the row goes */
  to: PostStage | 'same' | 'deleted'
  who: readonly PostHat[]
  label: string
  needs?: readonly InputNeed[]
  /** the act needs the version the person saw (a stale page is refused) */
  versioned?: true
  /** the question the window asks before the press goes through */
  confirm?: string
}

const TEAM_BUILD: readonly PostHat[] = ['creator', 'scheduler', 'am', 'sa']
const BOOKERS: readonly PostHat[] = ['scheduler', 'am', 'sa']
const MANAGERS: readonly PostHat[] = ['am', 'sa']
const REVIEWERS: readonly PostHat[] = ['qr', 'sa']
const PRE_POST: readonly PostStage[] = ['draft', 'quality_check', 'with_client', 'ready', 'booked']

/**
 * THE TABLE (SPEC §3 with the owner's decisions applied). Anything absent is
 * illegal. Every button is a row; every row the server runs is a button or a
 * system step. Differences from the spec, all from OWNER_DECISIONS.md:
 *   - T2 (draft → with_client, unchecked) is GONE. Quality check is required.
 *   - T4 (Passed — send to client) is the quality checker's or a super admin's
 *     only: it records a pass, and an account manager cannot pass.
 *   - T2b (ready → with_client) is new: "Send to client" after a pass, for a
 *     manager who chooses to show the client a post the team approved.
 *   - T20 (Cancel) is open to every scheduler, on any post.
 *   - set_steps is new: team only, or team then the client, for this post.
 *   - booking_done / booking_failed / link_jobs are the booking order of §3.1
 *     and the resend link of §5, as system rows so they go through one claim.
 */
export const POST_TRANSITIONS: readonly TransitionRow[] = [
  { action: 'save', spec: '—', from: ['draft'], to: 'same', who: TEAM_BUILD, label: 'Save' },
  { action: 'send_to_qc', spec: 'T1', from: ['draft'], to: 'quality_check', who: TEAM_BUILD, label: 'Send for quality check' },
  { action: 'pass', spec: 'T3', from: ['quality_check'], to: 'ready', who: REVIEWERS, label: 'Passed', versioned: true },
  { action: 'pass_send_client', spec: 'T4', from: ['quality_check'], to: 'with_client', who: REVIEWERS, label: 'Passed — send to client', versioned: true, needs: ['recipients'] },
  { action: 'ask_change', spec: 'T5', from: ['quality_check'], to: 'draft', who: ['qr', 'am', 'sa'], label: 'Ask for a change', versioned: true, needs: ['note', 'assign_to'] },
  { action: 'client_approve', spec: 'T6', from: ['with_client'], to: 'ready', who: ['client'], label: 'Approve', versioned: true },
  { action: 'client_ask_change', spec: 'T8', from: ['with_client'], to: 'draft', who: ['client'], label: 'Ask for a change', versioned: true, needs: ['note'] },
  { action: 'approve_for_client', spec: 'T7', from: ['with_client'], to: 'ready', who: MANAGERS, label: 'Approve for the client', versioned: true, needs: ['agreed_via', 'note'] },
  // decision 6: the team may decide without waiting for the client. Recorded as the TEAM's decision,
  // never as the client agreeing, and the client's page says the team decided it.
  { action: 'team_decides', spec: 'decision 6', from: ['with_client'], to: 'ready', who: MANAGERS, label: 'Approve without the client', versioned: true, needs: ['note'] },
  { action: 'take_back', spec: 'T9', from: ['with_client'], to: 'draft', who: BOOKERS, label: 'Take back' },
  { action: 'resend_new_time', spec: 'T10', from: ['with_client'], to: 'with_client', who: MANAGERS, label: 'New time and resend', needs: ['time', 'recipients'] },
  // the owner's live test, 29 Sep 2026: a one-press nudge. The SAME frozen version's link again, to the
  // client's own addresses; no new version, the approve-by and the posting time stay. A missed slot is
  // refused — the client could not answer any more, so New time and resend is the way.
  { action: 'remind_client', spec: 'live test 29 Sep', from: ['with_client'], to: 'with_client', who: MANAGERS, label: 'Remind the client', needs: ['recipients'] },
  { action: 'send_to_client', spec: 'T2b', from: ['ready'], to: 'with_client', who: MANAGERS, label: 'Send to client', versioned: true, needs: ['recipients'] },
  { action: 'book', spec: 'T11', from: ['ready'], to: 'booked', who: BOOKERS, label: 'Book in' },
  // the owner, 29 Sep 2026: "super admin should be able to schedule posts not post now". A super admin
  // books a Draft (its working copy frozen, as Send for quality check freezes it) or a post waiting on
  // the check (the version sent), at its time, WITHOUT the check. Never now: Post now stays on Ready.
  // Versioned from the quality check only — a Draft has no version the person saw (see the check).
  { action: 'schedule_direct', spec: 'owner 29 Sep', from: ['quality_check', 'draft'], to: 'booked', who: ['sa', 'tester'], label: 'Schedule it', needs: ['time'], versioned: true },
  { action: 'post_now', spec: 'T12', from: ['ready'], to: 'booked', who: BOOKERS, label: 'Post now', needs: ['confirm'], confirm:'This goes out on the client\'s accounts now.' },
  // …and from the quality check: a time that has passed (or will) is fixed there, without a full re-check
  { action: 'change_time', spec: 'T13/T15', from: ['quality_check', 'ready', 'booked'], to: 'same', who: BOOKERS, label: 'Change time', needs: ['time'] },
  { action: 'unbook', spec: 'T14', from: ['booked'], to: 'ready', who: BOOKERS, label: 'Take off the schedule' },
  { action: 'edit', spec: 'T19', from: ['quality_check', 'with_client', 'ready'], to: 'draft', who: TEAM_BUILD, label: 'Edit' },
  { action: 'edit_booked', spec: 'T19b', from: ['booked'], to: 'draft', who: BOOKERS, label: 'Edit', needs: ['confirm'], confirm: 'This takes it off the schedule.' },
  { action: 'cancel', spec: 'T20', from: PRE_POST, to: 'cancelled', who: TEAM_BUILD, label: 'Cancel post', needs: ['confirm'], confirm: 'Cancel this post? It will not go out.' },
  { action: 'rebook', spec: 'T22', from: ['cancelled'], to: 'draft', who: TEAM_BUILD, label: 'Re-book' },
  { action: 'missing_networks', spec: 'T21', from: ['posted'], to: 'same', who: BOOKERS, label: 'Post the missing networks' },
  { action: 'duplicate', spec: 'T21', from: ['posted', 'cancelled'], to: 'same', who: TEAM_BUILD, label: 'Duplicate' },
  { action: 'delete_draft', spec: 'T23', from: ['draft'], to: 'deleted', who: ['creator', 'am', 'sa'], label: 'Delete draft', needs: ['confirm'], confirm: 'Delete this draft? It has never been sent, so nothing else changes.' },
  { action: 'set_steps', spec: 'decision 13', from: ['draft', 'quality_check', 'ready'], to: 'same', who: MANAGERS, label: 'Change approval steps', needs: ['steps'] },
  { action: 'booking_done', spec: '§3.1', from: ['booked'], to: 'same', who: ['system'], label: 'Booked in' },
  // APPROVED WITH A TIME BOOKS ITSELF (the owner, 30 Sep 2026: "if we move to approved and the time is there, make sure
  // it's auto scheduled, or if client approved") — Book in, made by the app straight after the approval (autoBookAfter)
  { action: 'auto_book', spec: 'owner 30 Sep', from: ['ready'], to: 'booked', who: ['system'], label: 'Booked in automatically' },
  { action: 'booking_failed', spec: '§3.1', from: ['booked'], to: 'ready', who: ['system'], label: 'Booking failed' },
  { action: 'link_jobs', spec: '§5', from: ['booked', 'posted'], to: 'same', who: ['system'], label: 'Re-send linked' },
  // …and from posted: a re-send of the missing networks reports back on the same post
  { action: 'record_posted', spec: 'T16', from: ['booked', 'posted'], to: 'posted', who: ['system'], label: 'Posted' },
  { action: 'record_partial', spec: 'T17', from: ['booked', 'posted'], to: 'posted', who: ['system'], label: 'Posted in part' },
  { action: 'record_failed', spec: 'T18', from: ['booked'], to: 'ready', who: ['system'], label: 'Did not go out' },
  // ── ONE PORTAL (docs/ONE_PORTAL_SPEC.md R3-R8): the client answers a BOOKED post; a manager may record it for them ──
  { action: 'client_ok', spec: 'one portal R3', from: ['booked'], to: 'same', who: ['client', 'am', 'sa'], label: 'Approve', versioned: true },
  { action: 'client_not_approved', spec: 'one portal R4', from: ['booked'], to: 'draft', who: ['client', 'am', 'sa'], label: 'Not approved', versioned: true, needs: ['note'] },
  // a "wait" post that came off unanswered, approved late: booked for the next free 15-minute slot (R8)
  { action: 'client_ok_book', spec: 'one portal R8', from: ['ready'], to: 'booked', who: ['client', 'am', 'sa'], label: 'Approve', versioned: true },
  { action: 'hold_for_client', spec: 'one portal R7', from: ['booked'], to: 'ready', who: ['system'], label: 'Waiting for the client' },
  { action: 'set_if_no_answer', spec: 'one portal R5', from: ['draft', 'quality_check', 'ready', 'booked'], to: 'same', who: TEAM_BUILD, label: "If the client hasn't approved", needs: ['if_no_answer'] },
]

/**
 * A reminder of the send the client already has (Remind the client): it asks WHO to email and
 * nothing else — no copied link (it is an email), no new answer-by time (the first one stands).
 * The board's dialog and the window both read this, so they ask the same questions.
 */
export function isReminderSend(action: PostAction | string | null | undefined): boolean {
  return action === 'remind_client'
}

export const ROW_OF: Record<PostAction, TransitionRow> =
  Object.fromEntries(POST_TRANSITIONS.map(r => [r.action, r])) as Record<PostAction, TransitionRow>

export const ACTION_LABEL = Object.fromEntries(POST_TRANSITIONS.map(r => [r.action, r.label])) as Record<PostAction, string>

/** Actions only the app performs — never drawn as a button. */
export const SYSTEM_ACTIONS: readonly PostAction[] = POST_TRANSITIONS.filter(r => r.who.includes('system')).map(r => r.action)
/** Actions only the client performs, through the portal. */
export const CLIENT_ACTIONS: readonly PostAction[] = POST_TRANSITIONS.filter(r => r.who.includes('client')).map(r => r.action)

/* ── checking a move ────────────────────────────────────────────────────── */

export type PostActor = { id: string | null; hats: readonly PostHat[]; name?: string | null }

export type TransitionInput = {
  /** the `rev` the page had; a mismatch is a stale page */
  expect_rev?: number | null
  /** the version the person saw (reviewer, client, manager on the client's behalf) */
  version?: number | null
  note?: string | null
  /** a new posting time (change_time, resend_new_time) */
  scheduled_for?: string | null
  /** when the client's approval closes; defaulted from the posting time */
  approve_by?: string | null
  agreed_via?: AgreedVia | null
  /** who makes the change asked for; defaults to the post's maker */
  assign_to?: string | null
  confirm?: boolean | null
  steps?: ApprovalSteps | null
  /** one portal: the team's choice for an unanswered post */
  if_no_answer?: IfNoAnswer | null
  /** one portal: who answered (the name the client gave, or the manager's) */
  answered_by?: string | null
  /** client sends: the addresses something actually reached — set only AFTER delivery */
  delivered_to?: readonly string[] | null
  via?: 'email' | 'link' | null
  // system rows
  job_ids?: readonly string[] | null
  problem?: string | null
  outcomes?: Record<string, NetworkOutcome> | null
  /** the networks the booking targeted, by platform */
  platforms?: readonly string[] | null
  reason?: string | null
}

export type TransitionContext = {
  now: NowLike
  /** the client's connected channels; required for sends and bookings */
  accounts?: readonly AccountRef[] | null
  /** false when the client has nobody to send to */
  clientHasContact?: boolean | null
  /** the client's own default (clients.client_approval_required) */
  client?: { client_approval_required?: boolean | null; portal_one?: boolean | null } | null
  /**
   * ONE PORTAL: the next free 15-minute slot on this post's channels (one-portal-core nextFreeSlot), worked out
   * by the writer — the time an answer inside the last 15 minutes, a late approval, or a pass too close to its
   * time books instead (R8). Absent = no bump possible.
   */
  bumpTo?: string | null
  /**
   * The networks the booking's publish jobs (re-sends included) say already went out, read by the
   * writer from `publish_jobs` BEFORE the move. The recorder writes `outcomes` only once every network
   * has answered, so a post live on Instagram with a LinkedIn re-send still queued is `booked` with no
   * outcomes; without this it could be taken off, cancelled or edited, then booked again (a double post).
   */
  liveOnJobs?: readonly string[] | null
}

export type RefusalCode =
  | 'unknown_action' | 'wrong_stage' | 'not_allowed' | 'stale' | 'version'
  | 'invalid' | 'time' | 'channels' | 'context' | 'contact' | 'delivery'
  | 'note' | 'agreed_via' | 'assignee' | 'confirm' | 'steps'
  | 'missed' | 'unchecked' | 'unapproved' | 'already' | 'live'
  | 'use_delete' | 'use_cancel' | 'nothing_missing' | 'jobs' | 'outcome' | 'portal'

export type Refusal = { ok: false; code: RefusalCode; reason: string; problems?: string[] }
export type Allowed = { ok: true; row: TransitionRow; hat: PostHat }

const refuse = (code: RefusalCode, reason: string, problems?: string[]): Refusal =>
  problems ? { ok: false, code, reason, problems } : { ok: false, code, reason }

const hatList = (hats: readonly PostHat[]) => {
  const words = [...new Set(hats.map(h => HAT_WORDS[h]))]
  return joinNames(words).replace(/ and /, ' or ')
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** The acting hat: the first of the row's hats the actor wears, in the row's order. */
function actingHat(row: TransitionRow, actor: PostActor): PostHat | null {
  return row.who.find(h => actor.hats.includes(h)) ?? null
}

const STALE = 'Someone changed this post while you had it open. It has been reloaded — look at it again and try once more.'
const VERSION_MISSING = 'This page did not say which version you saw — reload it and try again.'
const VERSION_CHANGED = 'This is not the version you looked at — it has changed since. Reload and look again.'
export const MISSED_FOR_CLIENT = 'The time for this post has passed — the team will send you a new time.'
export const REMIND_MISSED = 'Its time has passed, so the client can no longer answer — set a new time and resend instead.'

/** The one portal's own moves (docs/ONE_PORTAL_SPEC.md) — refused for every client not on it. */
export const ONE_PORTAL_ACTIONS: readonly PostAction[] = ['client_ok', 'client_not_approved', 'client_ok_book', 'hold_for_client', 'set_if_no_answer']
export const NOT_ON_ONE_PORTAL = 'This client is not on the one portal yet.'
export const BOOKED_FIRST = 'This client answers on their portal once the post is booked — pass it and it is booked.'

/** `lenient`: skip the guards that need data a board may not have loaded (channels). Only `postActions` uses it. */
type CheckOpts = { lenient?: boolean }

/**
 * May this actor make this move on this post, now? One answer, used by the
 * server (inside the claim) and by `postActions` (to draw the buttons).
 * Order: the move exists, the stage, the hat, a stale page, then the guards.
 */
export function checkPostTransition(
  post: PostState,
  action: PostAction | string,
  actor: PostActor,
  input: TransitionInput,
  ctx: TransitionContext,
  opts: CheckOpts = {},
): Allowed | Refusal {
  if (!isPostAction(action)) return refuse('unknown_action', 'That is not something a post can do.')
  const row = ROW_OF[action]
  if (!row.from.includes(post.stage)) {
    return refuse('wrong_stage', `This post is in ${STAGE_LABEL[post.stage]} — "${row.label}" is not possible there.`)
  }
  const hat = actingHat(row, actor)
  if (!hat) return refuse('not_allowed', `Only ${hatList(row.who)} can do "${row.label}".`)
  if (input.expect_rev != null && input.expect_rev !== post.rev) return refuse('stale', STALE)
  // Schedule it from a Draft freezes the working copy now, like Send for quality check: there is no
  // earlier version the person looked at (the rev guards a stale page)
  const versionless = action === 'schedule_direct' && post.stage === 'draft'
  if (row.versioned && !versionless) {
    if (input.version == null) return refuse('version', VERSION_MISSING)
    if (input.version !== post.sent_version) return refuse('version', VERSION_CHANGED)
  }
  const now = ctx.now
  const note = String(input.note ?? '').trim()
  const accounts = ctx.accounts ?? null
  const needAccounts = (): Refusal | null =>
    accounts || opts.lenient ? null : refuse('context', 'The channels were not loaded, so this cannot be checked — reload and try again.')
  const channelsProblem = (): Refusal | null => {
    if (!accounts) return needAccounts()
    const lost = lostChannels(post, accounts)
    return lost.length > 0
      ? refuse('channels', `${joinNames(lost)} ${lost.length === 1 ? 'is' : 'are'} not connected — reconnect ${lost.length === 1 ? 'it' : 'them'} before booking.`)
      : null
  }
  const clientSendProblem = (when: string | null): Refusal | null => {
    const t = bookableTimeProblem(when, now)
    // at the quality check nobody here can book: say who can fix the time, and how
    if (t) return refuse('time', post.stage === 'quality_check' ? `${t} A scheduler or account manager can press Change time on this post.` : t)
    const by = input.approve_by ?? defaultApproveBy(when, now)
    if (!by || ms(by) <= ms(now)) return refuse('time', 'The client would have no time to answer — pick a later posting time or a later "approve by".')
    if (ms(by) >= ms(when)) return refuse('time', 'The "approve by" time has to come before the posting time.')
    if (ctx.clientHasContact === false) return refuse('contact', 'This client has nobody to send to — add a contact on the client\'s page first.')
    return null
  }
  /** THE booking checks — Book in and Schedule it both ask these: a bookable time, every channel connected. */
  const bookingProblem = (when: string | null, postNowOffered: boolean): Refusal | null => {
    const t = bookableTimeProblem(when, now, postNowOffered)
    if (t) return refuse('time', t)
    return channelsProblem()
  }
  const approvedNow = post.approval != null && post.approval.version === post.sent_version
  const liveNow = () => [...new Set([...liveNetworks(post), ...(ctx.liveOnJobs ?? [])])]

  // ONE PORTAL (docs/ONE_PORTAL_SPEC.md): its moves exist only for a client on it; and for such a client the
  // client never looks BEFORE booking — the pass books, and they answer on their portal after (R2)
  const onPortal = onePortal(ctx.client)
  if (ONE_PORTAL_ACTIONS.includes(action) && !onPortal) return refuse('portal', NOT_ON_ONE_PORTAL)
  if (onPortal && (action === 'pass_send_client' || action === 'send_to_client' || action === 'set_steps')) {
    return refuse('portal', BOOKED_FIRST)
  }
  // the 15-minute bump (R8): an answer, a late approval or a pass inside the last 15 minutes books the next free slot
  const bumping = onPortal && (action === 'client_ok_book'
    || ((action === 'client_ok' || action === 'auto_book') && insideLastSlot(post.scheduled_for, ms(now))))

  switch (action) {
    case 'client_ok':
    case 'client_not_approved':
    case 'client_ok_book': {
      const verdict: ClientVerdict = action === 'client_not_approved' ? 'not_approved' : 'approved'
      const problem = clientAnswerProblem(post, { version: input.version ?? -1, verdict, note: input.note }, liveNow())
      if (problem) return refuse(problem === ANSWER_LIVE ? 'live' : problem === ANSWER_NOTE_NEEDED ? 'note' : 'wrong_stage', problem)
      // a manager recording it for the client says how the client answered, as Approve for the client does
      if (hat !== 'client') {
        if (!isAgreedVia(input.agreed_via)) return refuse('agreed_via', 'Say how the client answered — on a call, by email, on WhatsApp, in person, or another way.')
        if (input.agreed_via === 'other' && !note) return refuse('note', 'Say how the client answered.')
      }
      if (bumping) {
        if (!ctx.bumpTo) return refuse('time', 'There is no free time in the next while to move it to — the team has been told.')
        if (action === 'client_ok_book') {
          if (!approvedNow) return refuse('unapproved', 'This version has not passed the quality check.')
          const c = channelsProblem()
          if (c) return c
        }
      }
      break
    }

    case 'hold_for_client': {
      if (!holdDue(post, ms(now))) return refuse('time', 'It is not time to take it off yet, or the client has approved it.')
      const live = liveNow()
      if (live.length > 0) return refuse('live', `It has already gone out on ${joinNames(live.map(networkName))}.`)
      break
    }

    case 'set_if_no_answer':
      if (input.if_no_answer !== 'post' && input.if_no_answer !== 'wait') return refuse('invalid', 'Choose "Post anyway" or "Wait for the client".')
      break

    case 'save':
    case 'take_back':
    case 'rebook':
    case 'duplicate':
    case 'edit':
      break

    case 'send_to_qc': {
      if (!post.scheduled_for) return refuse('time', TIME_MISSING)
      const t = ms(post.scheduled_for)
      if (!Number.isFinite(t)) return refuse('time', TIME_UNREADABLE)
      if (t <= ms(now)) return refuse('time', TIME_GONE)
      if (!accounts) { const r = needAccounts(); if (r) return r; break }
      const problems = compositionProblems(post, accounts, now)
      if (problems.length > 0) return refuse('invalid', problems[0], problems)
      break
    }

    case 'pass': {
      // team then the client: a pass alone would skip the client. A super
      // admin may still choose it; anyone else asks a manager to change the steps.
      if (approvalStepsOf(post, ctx.client) === 'team_then_client' && hat !== 'sa') {
        return refuse('steps', 'This post goes to the client after the check. Choose "Passed — send to client", or ask an account manager to make it team only.')
      }
      break
    }

    case 'pass_send_client':
    case 'resend_new_time':
    case 'send_to_client': {
      if (action === 'send_to_client') {
        if (!post.qc_pass || post.qc_pass.version !== post.sent_version) {
          return refuse('unchecked', 'This version has not passed the quality check — send it for quality check first.')
        }
        if (post.approval?.hat === 'client' && approvedNow) return refuse('already', 'The client has already approved this version.')
      }
      const when = action === 'resend_new_time' ? (input.scheduled_for ?? null) : post.scheduled_for
      if (action === 'resend_new_time' && !when) return refuse('time', TIME_MISSING)
      const r = clientSendProblem(when)
      if (r) return r
      break
    }

    case 'remind_client': {
      if (slotMissed(post, now)) return refuse('time', REMIND_MISSED)
      if (!post.client_send || post.client_send.version !== post.sent_version) {
        return refuse('delivery', 'This version was never sent to the client — there is nothing to remind them about.')
      }
      if (input.via === 'link') return refuse('invalid', 'A reminder is an email — choose who gets it.')
      if (ctx.clientHasContact === false) return refuse('contact', 'This client has nobody to send to — add a contact on the client\'s page first.')
      break
    }

    case 'ask_change':
    case 'client_ask_change': {
      if (action === 'client_ask_change' && slotMissed(post, now)) return refuse('missed', MISSED_FOR_CLIENT)
      if (!note) return refuse('note', 'Say what needs changing.')
      if (action === 'ask_change' && !(input.assign_to ?? post.created_by)) return refuse('assignee', 'Choose who should make the change.')
      break
    }

    case 'client_approve':
      if (slotMissed(post, now)) return refuse('missed', MISSED_FOR_CLIENT)
      break

    case 'team_decides':
      if (!note) return refuse('note', 'Say why the team is deciding without the client. The client sees that the team decided.')
      break

    case 'approve_for_client':
      if (!isAgreedVia(input.agreed_via)) return refuse('agreed_via', 'Say how the client agreed — on a call, by email, on WhatsApp, in person, or another way.')
      if (input.agreed_via === 'other' && !note) return refuse('note', 'Say how the client agreed.')
      break

    case 'book':
    case 'auto_book': {
      if (!approvedNow) return refuse('unapproved', 'This version is not approved yet.')
      if (action === 'auto_book' && bumping && !ctx.bumpTo) return refuse('time', 'There is no free time in the next while to book it — pick a time.')
      const b = bookingProblem(action === 'auto_book' && bumping ? ctx.bumpTo! : post.scheduled_for, true)
      if (b) return b
      break
    }

    case 'schedule_direct': {
      // no approval asked (that is the point), but everything Book in asks, never Post now's "or post
      // now", and — as nobody checked it — the composition rule Send for quality check asks
      const when = input.scheduled_for ?? post.scheduled_for
      const b = bookingProblem(when, false)
      if (b) return b
      if (!accounts) break
      const problems = compositionProblems({ ...post, scheduled_for: when }, accounts, now)
      if (problems.length > 0) return refuse('invalid', problems[0], problems)
      break
    }

    case 'post_now': {
      if (!approvedNow) return refuse('unapproved', 'This version is not approved yet.')
      const c = channelsProblem()
      if (c) return c
      if (input.confirm !== true) return refuse('confirm', 'This goes out now — confirm to go on.')
      break
    }

    case 'change_time': {
      if (!input.scheduled_for) return refuse('time', TIME_MISSING)
      const t = bookableTimeProblem(input.scheduled_for, now, post.stage === 'ready' && actor.hats.some(h => ROW_OF.post_now.who.includes(h)))
      if (t) return refuse('time', t)
      break
    }

    case 'unbook':
    case 'edit_booked': {
      const live = liveNow()
      if (live.length > 0) return refuse('live', `It has already gone out on ${joinNames(live.map(networkName))} — it cannot come off the schedule.`)
      if (action === 'edit_booked' && input.confirm !== true) return refuse('confirm', 'This takes it off the schedule — confirm to go on.')
      break
    }

    case 'cancel': {
      if (post.stage === 'draft' && post.sent_version == null && post.booking == null) {
        return refuse('use_delete', 'This draft was never sent — delete it instead.')
      }
      const live = liveNow()
      if (live.length > 0) return refuse('live', `It has already gone out on ${joinNames(live.map(networkName))} — it cannot be cancelled.`)
      if (input.confirm !== true) return refuse('confirm', 'Confirm to cancel this post.')
      break
    }

    case 'delete_draft':
      if (post.sent_version != null || post.booking != null) return refuse('use_cancel', 'This post has been sent before — cancel it instead of deleting it.')
      if (input.confirm !== true) return refuse('confirm', 'Confirm to delete this draft.')
      break

    case 'missing_networks':
      if (failedNetworks(post).length === 0) return refuse('nothing_missing', 'Every network went out — nothing is missing.')
      break

    case 'set_steps':
      if (!isApprovalSteps(input.steps)) return refuse('steps', 'Choose team only, or team then the client.')
      // a Ready post the TEAM approved could still be booked without the client, so "team, then the
      // client" would be a label that is not true. The way to show it to the client is Send to client.
      if (post.stage === 'ready' && input.steps === 'team_then_client'
        && !(post.approval && (post.approval.hat === 'client' || post.approval.on_behalf_of_client))) {
        return refuse('steps', 'The team has already approved this post, so it could be booked without the client. To show it to the client first, press Send to client.')
      }
      break

    case 'booking_done':
    case 'link_jobs':
      if (!input.job_ids || input.job_ids.length === 0) return refuse('jobs', 'No job to record.')
      break

    case 'booking_failed':
      if (!String(input.problem ?? '').trim()) return refuse('note', 'Say why the booking failed.')
      break

    case 'record_posted':
    case 'record_partial':
    case 'record_failed': {
      const merged = { ...post.outcomes, ...(input.outcomes ?? {}) }
      const want = outcomeAction(merged, input.platforms ?? [])
      if (want !== action) return refuse('outcome', `The networks' answers say ${want ?? 'nothing yet'}, not ${action}.`)
      break
    }
  }
  return { ok: true, row, hat }
}

/* ── planning a move: the pure half of the one writer ──────────────────── */

/**
 * What the writer does around the claim. `before`: done first, and the claim
 * only follows if it worked (cancel the provider's jobs, write the frozen
 * version). `after`: done once the claim has landed (queue the job, emails).
 * Every email is sent after the fact it reports (audit V14).
 */
export type PostEffect =
  /** `time`: the posting time the frozen copy carries, when the move sets one (Schedule it) */
  | { when: 'before'; kind: 'freeze'; n: number; frozen_for: FrozenFor; time?: string }
  | { when: 'before'; kind: 'cancel_jobs'; job_ids: string[] }
  | { when: 'before'; kind: 'reschedule_jobs'; job_ids: string[]; for_time: string }
  | { when: 'after'; kind: 'queue_publish'; for_time: string; now: boolean }
  | { when: 'after'; kind: 'notify'; to: NotifyTarget; action: PostAction; person_id?: string | null }
  | { when: 'after'; kind: 'create_post'; stage: 'ready' | 'draft'; platforms: string[] | null; carry_approval: boolean }
  | { when: 'instead'; kind: 'delete_post' }

/** Why a version was frozen. 'schedule': a super admin's Schedule it froze a Draft's working copy. */
export type FrozenFor = 'quality_check' | 'client' | 'retime' | 'schedule'

export type NotifyTarget = 'quality_checkers' | 'account_managers' | 'schedulers' | 'client' | 'person' | 'team'

/** The fields of `social_posts` a move writes. The writer adds the working-copy
 *  fields itself for `save` / `edit` and stamps `updated_at`. */
export type StagePatch = Partial<Pick<PostState,
  'stage' | 'rev' | 'stage_at' | 'draft_version' | 'sent_version' | 'scheduled_for' | 'approval_steps'
  | 'approval' | 'qc_pass' | 'changes_asked' | 'client_send' | 'last_client_send' | 'booking'
  | 'outcomes' | 'problem' | 'cancelled' | 'assigned_to'
  | 'if_no_answer' | 'client_review' | 'client_reviews' | 'review_asked'>>

export type PostEventRow = {
  id: string
  post_id: string
  client_id: string
  rev: number
  from: PostStage
  to: PostStage | 'deleted'
  action: PostAction
  actor_id: string | null
  hat: PostHat
  on_behalf_of_client: boolean
  version: number | null
  note: string | null
  at: string
}

export type Plan = {
  ok: true
  action: PostAction
  from: PostStage
  to: PostStage | 'deleted'
  patch: StagePatch
  event: PostEventRow
  effects: PostEffect[]
  /** the toast, from the stage the post lands in (audit B9) */
  words: string
}

function eventNote(act: PostAction, note: string | null, post: PostState, input: TransitionInput, patch: StagePatch): string | null {
  if (note) return note
  if (act === 'change_time' && post.approval) return 'Time changed after approval'
  if (act === 'booking_failed') return String(input.problem ?? '').trim() || null
  if (act === 'remind_client') return `Reminded ${joinNames((input.delivered_to ?? []).filter(Boolean))}`
  if (act === 'schedule_direct') return `Scheduled by ${patch.approval?.hat === 'account_manager' ? 'an account manager on a test client' : 'a super admin'} without the quality check${patch.approval?.without_client ? ' and without the client' : ''}`
  return null
}

const APPROVAL_HAT: Partial<Record<PostHat, ApprovalHat>> = {
  qr: 'quality_reviewer', am: 'account_manager', sa: 'super_admin', tester: 'account_manager', client: 'client',
}

/** The event row's id: one per rev, so a retried write cannot log twice. */
export const postEventId = (postId: string, rev: number) => `${postId}_r${rev}`
/** The frozen version's id: `claim()` against a null current, so the first writer wins. */
export const postVersionId = (postId: string, n: number) => `${postId}_v${n}`

/**
 * The whole of a move, worked out without touching anything: the check, the
 * fields to write, the event, and what has to happen before and after. The
 * writer (P1) runs this INSIDE the claim against the row it just read, so the
 * check and the write see the same post.
 *
 * A send to the client is planned only once something has reached the client
 * (`delivered_to`), so a failed email changes nothing (audit P9): the writer
 * checks, delivers, then plans and claims.
 */
export function planPostTransition(
  post: PostState,
  action: PostAction | string,
  actor: PostActor,
  input: TransitionInput,
  ctx: TransitionContext,
): Plan | Refusal {
  const checked = checkPostTransition(post, action, actor, input, ctx)
  if (!checked.ok) return checked
  const { row, hat } = checked
  const act = row.action
  const at = iso(ctx.now)
  const note = String(input.note ?? '').trim() || null
  const clientSend = ['pass_send_client', 'send_to_client', 'resend_new_time', 'remind_client'].includes(act)
  const delivered = (input.delivered_to ?? []).filter(x => typeof x === 'string' && x.trim())
  if (clientSend && delivered.length === 0 && input.via !== 'link') {
    return refuse('delivery', 'Nothing reached the client, so nothing has changed. Check the address and try again.')
  }

  const to: PostStage | 'deleted' = row.to === 'same' ? post.stage : row.to
  const patch: StagePatch = { rev: post.rev + 1 }
  const effects: PostEffect[] = []
  let version: number | null = post.sent_version
  const notify = (t: NotifyTarget, person_id?: string | null) =>
    effects.push({ when: 'after', kind: 'notify', to: t, action: act, ...(person_id !== undefined ? { person_id } : {}) })
  const freeze = (frozen_for: FrozenFor, time?: string) => {
    const n = post.draft_version
    effects.push({ when: 'before', kind: 'freeze', n, frozen_for, ...(time !== undefined ? { time } : {}) })
    patch.sent_version = n
    patch.draft_version = n + 1
    version = n
    return n
  }
  const approveBy = (when: string | null) => input.approve_by ?? defaultApproveBy(when, ctx.now)
  const sendRecord = (v: number, when: string | null): ClientSend => ({
    version: v, at, to: delivered, via: input.via === 'link' ? 'link' : 'email',
    approve_by: approveBy(when), for_time: when,
  })
  const leaveClient = () => {
    if (post.client_send) { patch.client_send = null; patch.last_client_send = post.client_send }
  }
  const jobs = post.booking?.job_ids ?? []
  // ONE PORTAL: the client's word, appended to the history (two people may answer — the latest wins, L1)
  const bumpPlanned = onePortal(ctx.client) && !!ctx.bumpTo && (act === 'client_ok_book'
    || ((act === 'client_ok' || act === 'auto_book') && insideLastSlot(post.scheduled_for, ms(ctx.now))))
  const answer = (verdict: ClientVerdict): ClientReview => {
    const r: ClientReview = {
      version: post.sent_version!, verdict, note,
      by: String(input.answered_by ?? '').trim() || (hat === 'client' ? 'the client' : String(actor.name ?? actor.id ?? '')), at,
    }
    patch.client_review = r
    patch.client_reviews = [...(post.client_reviews ?? []), r]
    return r
  }
  /** move the post to the bump slot: a new time is not new content (as Change time) */
  const bumpTime = () => {
    const when = ctx.bumpTo!
    patch.scheduled_for = when
    const n = freeze('retime', when)
    if (post.approval) patch.approval = { ...post.approval, version: n }
    if (post.qc_pass && post.qc_pass.version === post.sent_version) patch.qc_pass = { ...post.qc_pass, version: n }
    return when
  }
  const tellMakerAndHolder = () => {
    const holder = post.assigned_to ?? post.created_by
    if (post.created_by) notify('person', post.created_by)
    if (holder && holder !== post.created_by) notify('person', holder)
  }

  switch (act) {
    case 'client_ok':
      answer('approved')
      if (bumpPlanned) {
        const when = bumpTime()
        effects.unshift({ when: 'before', kind: 'reschedule_jobs', job_ids: jobs, for_time: when })
        patch.booking = { ...(post.booking ?? { job_ids: [], pending: false, at }), for_time: when }
        notify('schedulers')
      }
      notify('account_managers')
      break
    case 'client_not_approved': {
      // off the schedule at once (R4): the jobs are pulled BEFORE the claim; it needs the quality check again
      effects.push({ when: 'before', kind: 'cancel_jobs', job_ids: jobs })
      answer('not_approved')
      const holder = post.assigned_to ?? post.created_by
      patch.booking = null
      patch.approval = null
      patch.changes_asked = { version: post.sent_version, by: actor.id, who: 'client', to: holder, note: note ?? '', at }
      patch.assigned_to = holder
      tellMakerAndHolder()
      notify('account_managers')
      break
    }
    case 'client_ok_book': {
      answer('approved')
      const when = bumpTime()
      patch.booking = { job_ids: [], pending: true, at, for_time: when }
      patch.problem = null
      effects.push({ when: 'after', kind: 'queue_publish', for_time: when, now: false })
      notify('schedulers')
      notify('account_managers')
      break
    }
    case 'hold_for_client':
      // a "wait" post the client has not approved, 15 minutes out (R7): off, and it keeps waiting on their link
      effects.push({ when: 'before', kind: 'cancel_jobs', job_ids: jobs })
      patch.booking = null
      tellMakerAndHolder()
      break
    case 'set_if_no_answer':
      patch.if_no_answer = input.if_no_answer as IfNoAnswer
      break
    case 'save':
      break
    case 'send_to_qc':
      freeze('quality_check')
      patch.changes_asked = null
      patch.problem = null
      patch.assigned_to = null
      notify('quality_checkers')
      break
    case 'pass':
      patch.qc_pass = { version: post.sent_version!, by: actor.id, at }
      patch.approval = { version: post.sent_version!, by: actor.id, hat: APPROVAL_HAT[hat]!, on_behalf_of_client: false, agreed_via: null, note, at }
      patch.assigned_to = null
      notify('schedulers')
      break
    case 'pass_send_client':
      patch.qc_pass = { version: post.sent_version!, by: actor.id, at }
      patch.client_send = sendRecord(post.sent_version!, post.scheduled_for)
      patch.assigned_to = null
      break
    case 'send_to_client':
      // the team's approval steps aside while the client looks: the client's
      // answer (or a manager's yes for them) is what books it now
      patch.approval = null
      patch.client_send = sendRecord(post.sent_version!, post.scheduled_for)
      patch.assigned_to = null
      break
    case 'resend_new_time': {
      patch.scheduled_for = input.scheduled_for!
      const n = freeze('retime')
      // a new time is not new content: the pass of the version it re-times carries to it, as Change time does
      if (post.qc_pass && post.qc_pass.version === post.sent_version) patch.qc_pass = { ...post.qc_pass, version: n }
      patch.client_send = sendRecord(version!, input.scheduled_for!)
      break
    }
    case 'remind_client':
      // the same send, reminded: version, approve-by and posting time untouched; no freeze
      patch.client_send = { ...post.client_send!, reminded_at: at, reminded_to: delivered }
      break
    case 'ask_change':
    case 'client_ask_change': {
      const who = act === 'client_ask_change' ? 'client' : 'team'
      const assignee = input.assign_to ?? post.created_by
      patch.changes_asked = { version: post.sent_version, by: actor.id, who, to: assignee, note: note ?? '', at }
      patch.assigned_to = assignee
      if (act === 'client_ask_change') leaveClient()
      notify('person', assignee)
      break
    }
    case 'client_approve':
    case 'approve_for_client':
      patch.approval = {
        version: post.sent_version!, by: actor.id, hat: APPROVAL_HAT[hat]!,
        on_behalf_of_client: act === 'approve_for_client',
        agreed_via: act === 'approve_for_client' ? (input.agreed_via as AgreedVia) : null,
        note, at,
      }
      patch.changes_asked = null
      leaveClient()
      patch.assigned_to = null
      notify('schedulers')
      if (act === 'client_approve') notify('account_managers')
      break
    case 'team_decides':
      patch.approval = { version: post.sent_version!, by: actor.id, hat: APPROVAL_HAT[hat]!, on_behalf_of_client: false, agreed_via: null, note, at }
      patch.changes_asked = null
      leaveClient()
      patch.assigned_to = null
      notify('schedulers')
      break
    case 'take_back':
      leaveClient()
      patch.assigned_to = actor.id
      break
    case 'book':
    case 'auto_book':
    case 'post_now': {
      // a pass inside the last 15 minutes books the next free slot instead of missing (R8, the one portal only)
      const forTime = act === 'post_now' ? at : act === 'auto_book' && bumpPlanned ? bumpTime() : post.scheduled_for!
      if (act === 'post_now') patch.scheduled_for = at
      patch.booking = { job_ids: [], pending: true, at, for_time: forTime }
      patch.problem = null
      patch.assigned_to = null
      effects.push({ when: 'after', kind: 'queue_publish', for_time: forTime, now: act === 'post_now' })
      break
    }
    case 'schedule_direct': {
      const when = input.scheduled_for ?? post.scheduled_for!
      // the version that goes out: a Draft's working copy, frozen now; from the quality check the version
      // already sent — re-frozen with only the time replaced when a new time was picked (as Change time)
      const n = post.stage === 'draft'
        ? freeze('schedule', when)
        : ms(when) !== ms(post.scheduled_for) ? freeze('retime', when) : post.sent_version!
      patch.scheduled_for = when
      patch.approval = {
        version: n, by: actor.id, hat: APPROVAL_HAT[hat]!, on_behalf_of_client: false, agreed_via: null, note, at,
        skipped_check: true,
        ...(approvalStepsOf(post, ctx.client) === 'team_then_client' ? { without_client: true as const } : {}),
      }
      patch.changes_asked = null
      patch.booking = { job_ids: [], pending: true, at, for_time: when }
      patch.problem = null
      patch.assigned_to = null
      // at its time, never now — then the same booking steps as Book in (runBooking, the door, the lock)
      effects.push({ when: 'after', kind: 'queue_publish', for_time: when, now: false })
      break
    }
    case 'change_time': {
      // a time is not content: the approval (and the pass) carry forward to the
      // re-timed version (the owner's decision 8; SPEC T13/T15)
      patch.scheduled_for = input.scheduled_for!
      const n = freeze('retime')
      if (post.approval) patch.approval = { ...post.approval, version: n }
      if (post.qc_pass && post.qc_pass.version === post.sent_version) patch.qc_pass = { ...post.qc_pass, version: n }
      if (post.stage === 'booked') {
        effects.unshift({ when: 'before', kind: 'reschedule_jobs', job_ids: jobs, for_time: input.scheduled_for! })
        patch.booking = { ...(post.booking ?? { job_ids: [], pending: false, at }), for_time: input.scheduled_for! }
      }
      if (post.approval?.hat === 'client' && !post.approval.on_behalf_of_client) notify('client')
      break
    }
    case 'unbook':
      effects.push({ when: 'before', kind: 'cancel_jobs', job_ids: jobs })
      patch.booking = null
      break
    case 'edit':
    case 'edit_booked':
      if (act === 'edit_booked') effects.push({ when: 'before', kind: 'cancel_jobs', job_ids: jobs })
      // the next version starts; approvals stay in history only (post_events)
      patch.approval = null
      patch.booking = null
      patch.changes_asked = null
      patch.problem = null
      leaveClient()
      patch.assigned_to = actor.id
      break
    case 'cancel':
      if (post.stage === 'booked') effects.push({ when: 'before', kind: 'cancel_jobs', job_ids: jobs })
      patch.cancelled = { by: actor.id, at, from_stage: post.stage, reason: String(input.reason ?? '').trim() || note }
      patch.booking = null
      leaveClient()
      patch.assigned_to = null
      // never another post, never the edit card (audit V2, V20)
      break
    case 'rebook':
      patch.cancelled = null
      patch.scheduled_for = null
      patch.approval = null
      patch.booking = null
      patch.problem = null
      patch.assigned_to = actor.id
      break
    case 'missing_networks':
      effects.push({ when: 'after', kind: 'create_post', stage: 'ready', platforms: failedNetworks(post), carry_approval: true })
      break
    case 'duplicate':
      effects.push({ when: 'after', kind: 'create_post', stage: 'draft', platforms: null, carry_approval: false })
      break
    case 'delete_draft':
      effects.push({ when: 'instead', kind: 'delete_post' })
      break
    case 'set_steps':
      patch.approval_steps = input.steps as ApprovalSteps
      break
    case 'booking_done':
      patch.booking = { ...(post.booking ?? { at, for_time: post.scheduled_for }), job_ids: [...new Set([...jobs, ...input.job_ids!])], pending: false }
      notify('team')
      break
    case 'booking_failed':
      patch.booking = null
      patch.problem = String(input.problem).trim()
      notify('schedulers')
      break
    case 'link_jobs':
      patch.booking = { ...(post.booking ?? { pending: false, at, for_time: post.scheduled_for }), job_ids: [...new Set([...jobs, ...input.job_ids!])] }
      break
    case 'record_posted':
    case 'record_partial':
    case 'record_failed': {
      const merged = { ...post.outcomes, ...(input.outcomes ?? {}) }
      patch.outcomes = merged
      const failed = failedNetworks({ outcomes: merged }).map(networkName)
      if (act === 'record_posted') patch.problem = null
      if (act === 'record_partial') { patch.problem = `Did not go out on ${joinNames(failed)}.`; notify('schedulers') }
      if (act === 'record_failed') {
        patch.booking = null
        patch.problem = `Did not go out on ${joinNames(failed)}.`
        notify('schedulers')
      }
      break
    }
  }

  if (to !== 'deleted' && to !== post.stage) {
    patch.stage = to
    patch.stage_at = at
  }
  const newRev = post.rev + 1
  const event: PostEventRow = {
    id: postEventId(post.id, newRev),
    post_id: post.id,
    client_id: post.client_id,
    rev: newRev,
    from: post.stage,
    to,
    action: act,
    actor_id: actor.id,
    hat,
    on_behalf_of_client: act === 'approve_for_client',
    version,
    note: eventNote(act, note, post, input, patch),
    at,
  }
  const words = to === 'deleted' ? 'Draft deleted'
    : act === 'remind_client' ? `Reminder sent to ${joinNames(delivered)} — still ${STAGE_LABEL[to]}`
    : `${row.label} — now in ${STAGE_LABEL[to]}`
  return { ok: true, action: act, from: post.stage, to, patch, event, effects, words }
}

/* ── the buttons: one list for every surface ───────────────────────────── */

export type OfferedAction = {
  action: PostAction
  label: string
  /** null when it can be pressed; else the sentence to show beside it */
  blocked: string | null
  needs: readonly InputNeed[]
  confirm: string | null
}
export type PostActionList = { primary: OfferedAction | null; secondary: OfferedAction[]; danger: OfferedAction | null }

const DANGER: readonly PostAction[] = ['cancel', 'delete_draft']

/** The order a stage's buttons are listed in; the first unblocked entry of `PRIMARY` is the main button. */
const ORDER: Record<PostStage, readonly PostAction[]> = {
  draft: ['send_to_qc', 'schedule_direct', 'save', 'set_steps', 'delete_draft', 'cancel'],
  quality_check: ['pass', 'pass_send_client', 'schedule_direct', 'ask_change', 'change_time', 'edit', 'set_steps', 'cancel'],
  with_client: ['client_approve', 'client_ask_change', 'remind_client', 'resend_new_time', 'approve_for_client', 'team_decides', 'take_back', 'cancel'],
  ready: ['book', 'change_time', 'post_now', 'send_to_client', 'edit', 'set_steps', 'cancel'],
  booked: ['change_time', 'unbook', 'edit_booked', 'cancel'],
  posted: ['missing_networks', 'duplicate'],
  cancelled: ['rebook', 'duplicate'],
}

/**
 * The buttons this viewer gets on this post, now — THE list for the post
 * window, the board card, the Move menu, drag-and-drop and Waiting on you
 * (the owner's decision 2: identical wherever it opens).
 *
 * An action the hat may take but a guard stops is still listed, with
 * `blocked` saying why, so the reason sits beside the button instead of the
 * button vanishing. Two kinds are left out: a move the hat may not make, and
 * one refused only because it is the wrong kind for this post (a delete on a
 * sent post, a pass that would skip the client).
 */
export function postActions(
  post: PostState,
  hats: readonly PostHat[],
  now: NowLike,
  ctx: Omit<TransitionContext, 'now'> = {},
): PostActionList {
  const actor: PostActor = { id: null, hats }
  const probeTime = iso(ms(now) + 24 * 60 * 60_000)
  const offered: OfferedAction[] = []
  const missed = slotMissed(post, now)
  for (const action of ORDER[post.stage]) {
    const row = ROW_OF[action]
    if (!row.who.some(h => hats.includes(h)) || row.who.includes('system')) continue
    const probe: TransitionInput = {
      expect_rev: post.rev,
      version: post.sent_version,
      note: 'x',
      agreed_via: 'call',
      assign_to: post.created_by ?? 'someone',
      confirm: true,
      steps: 'team',
      scheduled_for: probeTime,
    }
    const r = checkPostTransition(post, action, actor, probe, { ...ctx, now }, { lenient: true })
    if (!r.ok && ['not_allowed', 'wrong_stage', 'use_delete', 'use_cancel', 'steps', 'nothing_missing', 'already', 'unchecked'].includes(r.code)) continue
    // the client gets words, not buttons, once their time has gone (SPEC §4.4)
    if (!r.ok && r.code === 'missed') continue
    // ONE PASS BUTTON, the one the post's approval route takes (the owner, 30 Sep 2026: a Team-only
    // post offered "Passed — send to client" beside "Passed"). The other way round is "Change approval
    // steps", which is offered at the quality check too.
    if (post.stage === 'quality_check' && (action === 'pass' || action === 'pass_send_client')) {
      const steps = approvalStepsOf(post, ctx.client)
      if (action !== (steps === 'team_then_client' ? 'pass_send_client' : 'pass')) continue
    }
    const label = action === 'edit' || action === 'edit_booked'
      ? `Edit — makes version ${post.draft_version}`
      : action === 'resend_new_time' && missed ? 'Set a new time and resend'
      // THE BUTTON SAYS WHAT PRESSING IT DOES (the owner, 5 Oct 2026: the black "Passed" pill "can be confusing…
      // it should be something like mark it as passed" — it read as the post's state, not as something to press).
      // The record and the answer keep the past tense: "Passed — now in Ready to post".
      : action === 'pass' ? 'Mark as passed'
      : action === 'pass_send_client' ? 'Mark as passed — send to client'
      : row.label
    offered.push({ action, label, blocked: r.ok ? null : r.reason, needs: row.needs ?? [], confirm: row.confirm ?? null })
  }

  const danger = offered.find(a => DANGER.includes(a.action)) ?? null
  const rest = offered.filter(a => !DANGER.includes(a.action))
  const primaryAction = pickPrimary(post, rest, missed, ctx)
  const primary = primaryAction ? rest.find(a => a.action === primaryAction) ?? null : null
  return { primary, secondary: rest.filter(a => a !== primary), danger }
}

function pickPrimary(
  post: PostState,
  offered: readonly OfferedAction[],
  missed: boolean,
  ctx: Omit<TransitionContext, 'now'>,
): PostAction | null {
  const has = (a: PostAction) => offered.some(o => o.action === a && !o.blocked)
  switch (post.stage) {
    case 'draft': return has('send_to_qc') ? 'send_to_qc' : null
    case 'quality_check': {
      const steps = approvalStepsOf(post, ctx.client)
      const first: PostAction = steps === 'team_then_client' ? 'pass_send_client' : 'pass'
      const second: PostAction = first === 'pass' ? 'pass_send_client' : 'pass'
      return has(first) ? first : has(second) ? second : null
    }
    case 'with_client':
      // never Approve as the manager's main button while the client has it (audit B7)
      if (has('client_approve')) return 'client_approve'
      return missed && has('resend_new_time') ? 'resend_new_time' : null
    case 'ready':
      if (has('book')) return 'book'
      return missed && has('change_time') ? 'change_time' : null
    case 'booked': return null
    case 'posted': return has('missing_networks') ? 'missing_networks' : null
    case 'cancelled': return has('rebook') ? 'rebook' : null
  }
}

/* ── who has it now ─────────────────────────────────────────────────────── */

export type WaitingWho = 'maker' | 'quality_check' | 'client' | 'account_manager' | 'scheduler' | 'nobody'

export type Waiting = {
  who: WaitingWho
  /** the one person, when it is one person */
  person_id: string | null
  /** the line on the card, in plain words */
  line: string
  /** when the post entered its stage — the "since" (audit B14) */
  since: string | null
  missed: boolean
}

type NameOf = (id: string | null | undefined) => string | null | undefined

/**
 * WHO THE POST IS WAITING ON, and the line that says so. The clock is passed in,
 * so a page that ticks re-reads it (audit S12).
 */
export function waitingOn(post: PostState, now: NowLike, nameOf: NameOf = () => null): Waiting {
  const since = post.stage_at
  const missed = slotMissed(post, now)
  const w = (who: WaitingWho, line: string, person_id: string | null = null): Waiting => ({ who, person_id, line, since, missed })
  switch (post.stage) {
    case 'draft': {
      const ca = post.changes_asked
      if (ca) {
        const by = ca.who === 'client' ? 'The client' : (nameOf(ca.by) || 'The team')
        const fixer = nameOf(ca.to)
        return w('maker', `${by} asked for a change${fixer ? ` — ${fixer} to make it` : ''}`, ca.to ?? post.created_by)
      }
      if (post.sent_version != null) return w('maker', 'Being changed — send it for quality check again when it is ready', post.assigned_to ?? post.created_by)
      return w('maker', 'Draft — send it for quality check when it is ready', post.created_by)
    }
    case 'quality_check':
      return w('quality_check', missed ? 'Waiting on the quality check — its time has passed, it will need a new one' : 'Waiting on the quality check')
    case 'with_client':
      return missed
        ? w('account_manager', `${MISSED_LABEL}. The client can no longer approve it.`)
        : w('client', 'Waiting on the client')
    case 'ready':
      if (post.problem) return w('scheduler', `${post.problem.replace(/\.?$/, '.')} Pick a time and book it again.`)
      if (missed) return w('scheduler', MISSED_LABEL)
      return w('scheduler', 'Approved — not booked yet')
    case 'booked':
      return w('nobody', post.booking?.pending ? 'Being booked in' : 'Booked in — it goes out at its time')
    case 'posted':
      return failedNetworks(post).length > 0 ? w('scheduler', postedWords(post)) : w('nobody', STAGE_LABEL.posted)
    case 'cancelled':
      return w('nobody', 'Cancelled — Re-book to start it again')
  }
}

/** Is this post waiting on THIS viewer? The rule behind "Waiting on you" (audit B8, W5). */
export function waitingOnViewer(post: PostState, viewer: { id: string | null; hats: readonly PostHat[] }, now: NowLike): boolean {
  const wait = waitingOn(post, now)
  if (wait.person_id) return wait.person_id === viewer.id
  // a super admin may do what each of these may (REVIEWERS and MANAGERS include sa), so it waits on them too
  const has = (...hats: PostHat[]) => hats.some(h => viewer.hats.includes(h))
  switch (wait.who) {
    case 'quality_check': return has('qr', 'sa')
    case 'account_manager': return has('am', 'sa')
    case 'scheduler': return has('scheduler', 'am', 'sa')
    default: return false
  }
}

/* ── lines that state facts ─────────────────────────────────────────────── */

/**
 * WHO APPROVED IT, true to the record (the owner's decision 5, audit P6):
 * "Approved by the client", "Approved by Akmal for the client — on a call",
 * "Passed quality check — Joy". A manager's yes is never "Client approved".
 */
export function approvalLine(approval: Approval | null | undefined, nameOf: NameOf = () => null): string | null {
  if (!approval) return null
  // a super admin's Schedule it: never worded as a pass (the owner, 29 Sep 2026)
  if (approval.skipped_check) {
    return `Scheduled without the quality check${approval.without_client ? ' and without the client' : ''} by ${nameOf(approval.by) || (approval.hat === 'account_manager' ? 'an account manager' : 'a super admin')}`
  }
  const name = nameOf(approval.by) || 'the team'
  if (approval.hat === 'client') return 'Approved by the client'
  if (approval.on_behalf_of_client) {
    const how = approval.agreed_via === 'other' && approval.note ? approval.note
      : approval.agreed_via ? AGREED_VIA_WORDS[approval.agreed_via] : null
    return `Approved by ${name} for the client${how ? ` — ${how}` : ''}`
  }
  return `Passed quality check — ${cap(name)}`
}

/**
 * "Emailed to jordan@…" — only from a send that happened, for the version it was (audit B4, B16) —
 * with "· Reminded 29 Sep" once Remind the client has gone.
 */
export function clientSendLine(send: ClientSend | null | undefined, timeZone = 'Australia/Melbourne'): string | null {
  if (!send) return null
  const reminded = reminderWords(send, timeZone)
  const base = send.via === 'link' ? 'Link shared with the client' : send.to.length > 0 ? `Emailed to ${joinNames(send.to)}` : null
  return base && reminded ? `${base} · ${reminded}` : base ?? reminded
}

/** "Reminded 29 Sep" — the day the last reminder went, in the agency's time zone; null when none has. */
export function reminderWords(send: ClientSend | null | undefined, timeZone = 'Australia/Melbourne'): string | null {
  const t = ms(send?.reminded_at ?? null)
  if (!Number.isFinite(t)) return null
  const day = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone }).format(new Date(t))
  return `Reminded ${day}`
}

/** "The client asked for a change" or "Joy asked for a change" — never guessed (audit B6, P13). */
export function changesAskedLine(ca: ChangesAsked | null | undefined, nameOf: NameOf = () => null): string | null {
  if (!ca) return null
  return ca.who === 'client' ? 'The client asked for a change' : `${nameOf(ca.by) || 'The team'} asked for a change`
}

/* ── notes: per file, two threads ───────────────────────────────────────── */

/** The two threads (decision 9). Team is the default and never reaches the client. */
export type CommentVisibility = 'team' | 'client'
export const DEFAULT_COMMENT_VISIBILITY: CommentVisibility = 'team'
export const COMMENT_VISIBILITY_LABEL: Record<CommentVisibility, string> = {
  team: 'Team only — the client never sees this',
  client: 'Client thread — the client sees this',
}

/** May this reader see this note? A client sees only the client thread. */
export function commentVisibleTo(comment: { visibility?: string | null }, reader: 'team' | 'client'): boolean {
  if (reader === 'team') return true
  return comment.visibility === 'client'
}

/**
 * THE NOTES FOR ONE PLACE ON A POST — the one filter the window, the portal
 * and the rules share. `fileUrl` null is the whole post; a file is matched by
 * its URL, never its slot, so a reorder cannot move a note onto another
 * picture (audit P10). `thread` keeps one thread; `version` keeps that
 * version's notes and the ones that name no version.
 */
export function notesForFile<T extends { file_url?: string | null; version?: number | null; visibility?: string | null }>(
  comments: readonly T[], fileUrl: string | null, opts: { thread?: CommentVisibility; version?: number | null } = {},
): T[] {
  return comments.filter(c =>
    (fileUrl == null ? c.file_url == null : c.file_url === fileUrl)
    && (opts.thread == null || c.visibility === opts.thread)
    && (opts.version == null || c.version == null || c.version === opts.version))
}

/**
 * THE APPROVALS THAT BOOK THE POST THEMSELVES when it has a time (the owner, 30 Sep 2026). Only an APPROVAL: a post
 * back on Ready because somebody took it off the schedule, or because a booking failed, is left for a person —
 * booking it again by itself would undo a deliberate "take it off", or retry a refusal for ever.
 */
export const AUTO_BOOK_AFTER: readonly PostAction[] = ['pass', 'client_approve', 'approve_for_client', 'team_decides']

export function autoBookAfter(action: string, landed: Pick<PostState, 'stage' | 'scheduled_for'> | null | undefined): boolean {
  return !!landed && landed.stage === 'ready' && !!landed.scheduled_for && (AUTO_BOOK_AFTER as readonly string[]).includes(action)
}
