import 'server-only'
import { randomUUID } from 'node:crypto'
import { table } from '@/lib/db'
import type {
  Client, ClientContact, PostComment, PostEvent, PostVersion,
  PublishJob as PublishJobRow, SocialAccount, SocialPost,
} from '@/lib/db-types'
import type { TeamUser } from './authz'
import { autoBookAfter,
  CLIENT_ACTIONS, ROW_OF, SYSTEM_ACTIONS, anyNetworkLive, defaultApproveBy, failedNetworks, hatsFor,
  isPostAction, mayWorkOnPost, planPostTransition, postVersionId, readPostState,
  type AccountRef, type FrozenFor, type NotifyTarget, type Plan, type PostAction, type PostActor,
  type PostEventRow, type PostHat, type PostStage, type PostState, type Refusal, type RefusalCode,
  type TransitionContext, type TransitionInput,
} from './post-stage-core'
import type { PostActRefused, PostActRequest, PostActResponse } from './post-act-contract'
import { clientRecipients, pickRecipients, type ClientRecipient } from './client-recipients-core'
import { portalPostHref } from './post-page-core'
import type { ChannelExtras } from './schedule-compose-core'
import type { Slide } from './version-files-core'
import { CANCELLED_REASON, TAKEN_OFF_REASON, readPostAutomation, type PostAutomation } from './comment-automation-core'
import { META_PROVIDER } from './meta-route-core'
import { insideLastSlot, nextFreeSlot, onePortal } from './one-portal-core'

/**
 * THE ONE WRITER OF A POST'S STAGE (the posting rebuild, 29 Sep 2026 — SPEC §3.1, §5).
 *
 * Read docs/posting-rebuild/OWNER_DECISIONS.md, SPEC.md and AUDIT_EVIDENCE.md first. The rules — who may
 * do what, from which stage, and what it changes — are app/lib/post-stage-core.ts, pure. This file is the
 * I/O around them, and it is the ONLY file that writes `social_posts.stage` (a source pin keeps it so).
 *
 * What the audit taught, and where each lesson lives here:
 *
 *   - Check-then-write let two answers both land (V4, V17, V18). Every move is ONE `claim()` on the post,
 *     and the rules run INSIDE it against the row the claim just read, with the `rev` the page drew.
 *     A lost race is a refusal that carries the fresh post, never a silent overwrite.
 *   - Nothing was frozen, so the client approved whatever the post held when they pressed (V6, V7, P2).
 *     Sending to the quality check or the client, and every new time, writes `post_versions/<post>_v<n>`
 *     BEFORE the claim that adopts it. A version row is created once and never overwritten.
 *   - "Sent to client" was stamped before anything was sent (P9). The email goes first; the post moves
 *     only once something reached the client, and a failed send changes nothing.
 *   - The booking email went out before the booking existed, and a thrown queue left a post "booked"
 *     with no job (V14, V15, W4). Booking is: claim `ready → booked` with a PENDING booking, queue inside
 *     try/catch, then claim the job ids — or claim back to Ready to post with the reason. Only then any
 *     email, and the page draws from the post that comes back.
 *   - Cancelling one post wiped its siblings' approval (V2, V20). Approval is per POST: nothing here
 *     reads or writes another post or the edit card, except the item-delete cascade, which is about
 *     every post of that card on purpose.
 *   - Re-send jobs were not linked, so cancel ignored them (V11): `link_jobs` (the recorder in
 *     production-publish.ts moves it through `performSystemTransition`) adds them to the booking.
 *   - Saving a draft emailed the managers (V12): creating or saving a draft tells nobody.
 *
 * The provider, the mailer and the notifications are DEPENDENCIES (`PostEngineDeps`), so the tests run
 * the real claims over the in-memory database without reaching a channel or an inbox. Team emails are
 * package P7's (app/lib/post-notify.ts): this file hands every notice to `deps.notify`, whose default
 * is P7's `sendPostNotice`. The one email that IS part of a move — the send to the
 * client, which has to succeed before the post moves — goes through P7's round sender
 * (`sendClientRound`, a round of one for a single post) before the claim that moves it.
 */

/* ── tables ─────────────────────────────────────────────────────────────── */

const posts = () => table<SocialPost>('social_posts')
const versionsT = () => table<PostVersion>('post_versions')
const eventsT = () => table<PostEvent>('post_events')

/**
 * One open post per piece with the same files — the claim-lock key `insertPost` takes. Defined here so
 * the delete that frees it and the insert that takes it cannot drift apart.
 */
export const postLockKey = (itemId: string) => `social_post__${itemId}`

/* ── the actor ──────────────────────────────────────────────────────────── */

/** Who is pressing, as the engine sees them: the hats they wear on THIS post, and who they are. */
export type EngineActor = PostActor & {
  email?: string | null
  /** the signed-in team member, when a person is pressing (needed by the booking bookkeeping) */
  user?: TeamUser | null
}

/** The actor a signed-in team member is on this post. Editors and designers wear no hat (decision 7). */
export function teamActorFor(user: TeamUser, post: Pick<PostState, 'created_by'>): EngineActor {
  return {
    id: user.id,
    name: user.name || user.email,
    email: user.email,
    hats: hatsFor({ id: user.id, role: user.role, quality_reviewer: user.quality_reviewer }, post),
    user,
  }
}

const SYSTEM_ACTOR: EngineActor = { id: null, hats: ['system'], name: 'the app' }

/* ── the answer ─────────────────────────────────────────────────────────── */

/**
 * What every move answers: the post as it now stands, so a page redraws from the server and never from
 * what it assumed would happen (audit W4). `created_post_id` names a post a move made (Post the missing
 * networks, Duplicate); `link` is the client's page when the send was a copied link.
 */
export type PostActResult = PostActResponse

function refusal(
  code: PostActRefused['code'], reason: string, post: PostState | null, problems?: string[],
): PostActRefused {
  return problems && problems.length > 0 ? { ok: false, code, reason, post, problems } : { ok: false, code, reason, post }
}
const fromRefusal = (r: Refusal, post: PostState | null): PostActRefused => refusal(r.code, r.reason, post, r.problems)

const STALE = 'Someone changed this post while you had it open. It has been reloaded — look at it again and try once more.'
const NOT_MIGRATED = 'This post is from before the new stages and has not been moved across yet — it cannot change until then.'
const NOT_FOUND = 'That post no longer exists.'

/* ── what the engine needs from the outside ─────────────────────────────── */

/** The frozen copy a booking publishes — the version that was approved, never the working copy. */
export type FrozenCopy = {
  n: number | null
  slides: Slide[]
  per_channel: Record<string, ChannelExtras>
  channels: string[]
  caption: string
  scheduled_for: string | null
  timezone: string | null
  /** the comment-to-DM automation, frozen with the caption (comment-automation-core) */
  automation?: PostAutomation | null
}

export type QueueInput = {
  post: PostState
  copy: FrozenCopy
  /** the connected channels the post goes to */
  accounts: SocialAccount[]
  /** null with `now`: the provider publishes it straight away (never a time that has gone, decision 11) */
  forTime: string | null
  now: boolean
  actor: EngineActor
}

export type DeliveryInput = {
  post: PostState
  version: number
  client: Client
  emails: string[]
  via: 'email' | 'link'
  approveBy: string | null
  actor: EngineActor
  note: string | null
  /** Remind the client: the same version again — its own email (never deduplicated into the first), worded as a reminder */
  reminder?: boolean
}

/** A round: the posts at the versions being sent, to addresses already checked against the client's list. */
export type RoundDelivery = {
  clientId: string
  posts: { post_id: string; version: number; approve_by: string | null }[]
  emails: string[]
  note: string | null
  actor: EngineActor
}

/**
 * A notice for the team (or the client) that something HAPPENED. Handed over after the claim landed, so
 * a press that lost the race tells nobody. P7 turns these into emails and bells.
 */
export type PostNotice = {
  to: NotifyTarget
  action: PostAction
  person_id: string | null
  post: PostState
  actor: { id: string | null; name: string | null; hat: PostHat }
  event: PostEventRow
  /** the posting time before the move, when the move changed it (a bump to the next 15-minute slot) */
  previous_time?: string | null
}

export type PostEngineDeps = {
  now: () => Date
  /** an approval with a time books the post straight away (autoBookAfter, the owner 30 Sep 2026) — on in the app;
   *  a test of Book in itself switches it off */
  autoBook: boolean
  /** Hand the frozen copy to the provider. May throw; the engine treats a throw like a refusal. */
  /** `ids`: every job the booking made — two when the post's Instagram goes through our own Meta app and
   *  its other networks through Zernio (meta-route-core.ts); absent means just `id` */
  queuePublish: (input: QueueInput) => Promise<{ id: string; ids?: string[] } | { error: string; issues?: string[] }>
  /**
   * Pull one job back from the provider, then mark it cancelled. ok for a job that never went anywhere;
   * NOT ok (`live`) for a job that says a network already went out — a "cancelled" row over a live post
   * is how a second booking double-posts (review fix, 29 Sep 2026).
   */
  cancelJob: (jobId: string) => Promise<{ ok: true } | { ok: false; error: string; live?: boolean }>
  /** The networks these jobs (and every re-send of them) say already went out. */
  liveOnJobs: (jobIds: readonly string[]) => Promise<string[]>
  /** Email the client the link to the frozen version (or only build the link, for 'link'). */
  deliverToClient: (input: DeliveryInput) => Promise<{ delivered: string[]; failed: string[]; link: string }>
  /** One email per person listing several posts (decision 15). */
  deliverRound: (input: RoundDelivery) => Promise<{ delivered: string[]; message: string }>
  notify: (notice: PostNotice) => Promise<void>
  /** "Something changed" for the open pages — a hint, never data. */
  announce: (post: Pick<PostState, 'id' | 'client_id'>, kind: string) => void
  /** Is this client one this person may act on? */
  mayActOnClient: (user: TeamUser, clientId: string) => Promise<boolean>
  /**
   * A cancelled post stops DMing people: every comment-to-DM automation on it is switched off
   * (app/lib/comment-automation.ts, 29 Sep 2026). Best-effort — never refuses the move.
   */
  pauseAutomations: (postId: string, reason: string) => Promise<void>
}

const defaultDeps: PostEngineDeps = {
  autoBook: true,
  now: () => new Date(),
  queuePublish: input => defaultQueuePublish(input),
  cancelJob: jobId => defaultCancelJob(jobId),
  liveOnJobs: jobIds => defaultLiveOnJobs(jobIds),
  deliverToClient: input => defaultDeliver(input),
  deliverRound: async input => {
    const { sendClientRound } = await import('./post-notify')
    const sent = await sendClientRound({
      clientId: input.clientId, posts: input.posts, emails: input.emails, note: input.note,
      pressedBy: { id: String(input.actor.id ?? ''), name: input.actor.name ?? null, email: String(input.actor.email ?? '') },
    })
    if (!sent.ok) { console.error('client round refused:', sent.error); return { delivered: [], message: sent.error } }
    return { delivered: sent.delivered, message: sent.message }
  },
  // Team emails are package P7's (app/lib/post-notify.ts). It checks the fact against the landed post
  // before anyone is emailed: never BEFORE the fact it reports, never for a draft (audit V12, V14).
  notify: async notice => { const { sendPostNotice } = await import('./post-notify'); await sendPostNotice(notice) },
  announce: (post, kind) => {
    void import('@/lib/live')
      .then(({ announceAfter }) => announceAfter('schedule', { client_id: post.client_id, post_id: post.id, kind }))
      .catch(() => {})
  },
  mayActOnClient: async (user, clientId) => {
    const { accessibleClientIds } = await import('./production-access')
    const ids = await accessibleClientIds(user)
    return ids === null || ids.includes(clientId)
  },
  pauseAutomations: async (postId, reason) => {
    const { pauseAutomationsForPost } = await import('./comment-automation')
    await pauseAutomationsForPost(postId, reason)
  },
}

let deps: PostEngineDeps = defaultDeps

/** Swap some dependencies (tests; P7 wiring its notifier). Returns the undo. */
export function usePostEngineDeps(over: Partial<PostEngineDeps>): () => void {
  const before = deps
  deps = { ...deps, ...over }
  return () => { deps = before }
}

/* ── reading ────────────────────────────────────────────────────────────── */

/** One post as the rules read it, straight from the network (never a cached copy a guard would trust). */
export async function loadPostState(postId: string): Promise<{ row: SocialPost | null; post: PostState | null }> {
  const row = await posts().get(postId, { fresh: true })
  return { row, post: readPostState(row as unknown as Record<string, unknown>) }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : isObj(v) ? Object.values(v) : [])
const strList = (v: unknown): string[] => list(v).filter((x): x is string => typeof x === 'string' && x.length > 0)

function slidesOf(v: unknown): Slide[] {
  return list(v).filter((s): s is Slide => isObj(s) && typeof s.url === 'string' && s.url.length > 0)
    .map(s => ({ ...s, name: typeof s.name === 'string' ? s.name : '', type: s.type === 'video' ? 'video' : 'image' } as Slide))
}

/** A frozen version as a copy the booking and the email can read. */
export function copyOfVersion(v: PostVersion | null | undefined): FrozenCopy | null {
  if (!v) return null
  const perChannel: Record<string, ChannelExtras> = {}
  if (isObj(v.per_channel)) for (const [k, raw] of Object.entries(v.per_channel)) perChannel[k] = (isObj(raw) ? raw : {}) as ChannelExtras
  return {
    n: typeof v.n === 'number' ? v.n : null,
    slides: slidesOf(v.slides),
    per_channel: perChannel,
    channels: strList(v.channels),
    caption: typeof v.caption === 'string' ? v.caption : '',
    scheduled_for: typeof v.scheduled_for === 'string' ? v.scheduled_for : null,
    timezone: typeof v.timezone === 'string' ? v.timezone : null,
    ...(readPostAutomation(v.automation) ? { automation: readPostAutomation(v.automation) } : {}),
  }
}

function copyOfPost(post: PostState, time?: string | null): FrozenCopy {
  return {
    n: null,
    slides: post.slides,
    per_channel: post.per_channel,
    channels: post.channels,
    caption: post.caption,
    scheduled_for: time === undefined ? post.scheduled_for : time,
    timezone: post.timezone,
    ...(post.automation ? { automation: post.automation } : {}),
  }
}

/** The frozen version a post points at, or null. */
export async function loadFrozenVersion(postId: string, n: number | null | undefined): Promise<PostVersion | null> {
  if (n == null) return null
  return versionsT().get(postVersionId(postId, n), { fresh: true }).catch(() => null)
}

/* ── canonical content, so "the same version" is a fact, not a guess ─────── */

/** Stable JSON: keys sorted at every level, so two reads of the same content compare equal. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (isObj(v)) return `{${Object.keys(v).sort().filter(k => v[k] !== undefined && v[k] !== null).map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
  return JSON.stringify(v ?? null)
}

function contentKey(c: Pick<FrozenCopy, 'slides' | 'per_channel' | 'channels' | 'caption' | 'scheduled_for' | 'timezone' | 'automation'>): string {
  return stable({
    slides: c.slides, per_channel: c.per_channel, channels: c.channels,
    caption: c.caption ?? '', scheduled_for: c.scheduled_for ?? null, timezone: c.timezone ?? null,
    automation: c.automation ?? null,
  })
}

/* ── freezing ───────────────────────────────────────────────────────────── */

type FreezeFor = FrozenFor

/**
 * WRITE VERSION n OF THIS POST (SPEC §2.2, the owner's decision 8), before the claim that adopts it.
 *
 * A version row is created ONCE and never overwritten, so an adopted version — one a reviewer or the
 * client has seen — can never change underneath them. Three answers:
 *   - created: n is ours;
 *   - already there with the SAME content: an earlier attempt that never landed (a send whose email
 *     failed); it is reused;
 *   - already there with OTHER content: that leftover is skipped — the post's `draft_version` moves past
 *     it in a claim of its own, and the caller freezes again at the next number. Version numbers may
 *     then have a gap; they never have two contents.
 */
export async function freezeVersion(
  post: PostState, frozenFor: FreezeFor, frozenBy: string | null, time: string | null | undefined, at: string,
): Promise<{ ok: true; n: number } | { ok: false; skipped: boolean }> {
  const n = post.draft_version
  const when = time === undefined ? post.scheduled_for : time
  // A NEW TIME IS NOT NEW CONTENT (review fix, 29 Sep 2026): a retime copies the version that was checked
  // or approved, with only the time replaced — never the working copy, which something outside the
  // writer (a crop) may have changed, and whose picture nobody checked
  const base = frozenFor === 'retime' && post.sent_version != null
    ? copyOfVersion(await loadFrozenVersion(post.id, post.sent_version))
    : null
  const copy: FrozenCopy = base ? { ...base, n: null, scheduled_for: when } : copyOfPost(post, when)
  const next: PostVersion = {
    id: postVersionId(post.id, n),
    post_id: post.id,
    client_id: post.client_id,
    n,
    slides: copy.slides,
    per_channel: copy.per_channel,
    channels: copy.channels,
    caption: copy.caption,
    scheduled_for: copy.scheduled_for,
    timezone: copy.timezone ?? 'Australia/Melbourne',
    frozen_for: frozenFor,
    frozen_by: frozenBy,
    frozen_at: at,
    from_migration: false,
    automation: copy.automation ?? null,
  }
  const res = await versionsT().claim(next.id, cur => (cur ? null : next))
  if (res.claimed) return { ok: true, n }
  const existing = copyOfVersion(res.current)
  if (existing && contentKey(existing) === contentKey(copy)) return { ok: true, n }
  // a leftover with other content: step the post's next number past it (no rev bump — nothing the page
  // drew changes), but only while the post still says n is next; otherwise someone adopted it
  const moved = await posts().claim(post.id, cur =>
    cur && Number(cur.draft_version ?? 1) === n && cur.sent_version !== n
      ? { ...cur, draft_version: n + 1 } as SocialPost
      : null)
  return { ok: false, skipped: moved.claimed }
}

/* ── the events ─────────────────────────────────────────────────────────── */

/** Append the move's event. One per rev by id, so a retry cannot log twice. Best effort: the move stands. */
async function writeEvent(event: PostEventRow): Promise<void> {
  const row: PostEvent = { ...event, from: event.from, to: event.to }
  await eventsT().claim(row.id, cur => (cur ? null : row)).catch(e =>
    console.error('post event not written', event.id, e instanceof Error ? e.message : e))
}

/* ── context ────────────────────────────────────────────────────────────── */

type Loaded = {
  client: Client | null
  accounts: SocialAccount[]
  recipients: ClientRecipient[]
}

async function loadAround(post: PostState): Promise<Loaded> {
  const [client, accounts, contacts] = await Promise.all([
    table<Client>('clients').get(post.client_id).catch(() => null),
    table<SocialAccount>('social_accounts').list({ where: a => a.client_id === post.client_id }).catch(() => [] as SocialAccount[]),
    table<ClientContact>('client_contacts').list({ where: c => c.client_id === post.client_id }).catch(() => [] as ClientContact[]),
  ])
  return { client, accounts, recipients: clientRecipients(client, contacts) }
}

const accountRefs = (accounts: readonly SocialAccount[]): AccountRef[] =>
  accounts.map(a => ({ id: a.id, platform: String(a.platform), live: a.active !== false, name: a.name ?? null }))

function contextOf(loaded: Loaded, now: Date, via: 'email' | 'link'): TransitionContext {
  return {
    now,
    accounts: accountRefs(loaded.accounts),
    clientHasContact: via === 'link' ? !!loaded.client?.share_token : loaded.recipients.length > 0,
    client: loaded.client ? {
      client_approval_required: loaded.client.client_approval_required === true,
      // the one portal (docs/ONE_PORTAL_SPEC.md): only an explicit true; everyone else reads exactly as before
      ...(onePortal(loaded.client) ? { portal_one: true } : {}),
    } : null,
  }
}

/** Moves that may bump a post to the next free 15-minute slot (one portal R8). */
const MAY_BUMP: readonly PostAction[] = ['client_ok', 'client_ok_book', 'auto_book']

/**
 * THE NEXT FREE 15-MINUTE SLOT for this post (one portal R8): the first quarter hour 15 minutes out that no other
 * booked post on any of its channels holds. Worked out only when the move could bump, for a client on the one
 * portal; null when it cannot be read (the move is then refused rather than guessed).
 */
async function bumpSlotFor(post: PostState, action: PostAction | string, loaded: Loaded, now: Date): Promise<string | null | undefined> {
  if (!onePortal(loaded.client) || !MAY_BUMP.includes(action as PostAction)) return undefined
  if (action !== 'client_ok_book' && !insideLastSlot(post.scheduled_for, now.getTime())) return undefined
  try {
    const mine = new Set(post.channels)
    const others = await posts().list({ where: r => r.client_id === post.client_id && r.id !== post.id && r.stage === 'booked' })
    const taken = others
      .filter(r => (Array.isArray(r.channels) ? r.channels : []).some(c => mine.has(String(c))))
      .map(r => Date.parse(String(r.scheduled_for ?? '')))
      .filter(t => Number.isFinite(t))
    return new Date(nextFreeSlot(now.getTime(), taken)).toISOString()
  } catch (e) {
    console.error('could not work out the next free slot', post.id, e instanceof Error ? e.message : e)
    return null
  }
}

/* ── the move ───────────────────────────────────────────────────────────── */

const CLIENT_SENDS: readonly PostAction[] = ['pass_send_client', 'send_to_client', 'resend_new_time', 'remind_client']

/** Moves that take a booked post off the provider — refused once any network went out (audit V11, S5). */
const TAKES_OFF: readonly PostAction[] = ['unbook', 'edit_booked', 'cancel', 'client_not_approved', 'hold_for_client']

/**
 * How long a claimed client send holds the post (review fix, 29 Sep 2026). The email goes while the
 * post says `sending`; any other move is refused until the send finishes or this runs out, so a press
 * that died halfway never locks a post for good.
 */
export const SENDING_HOLD_MS = 3 * 60_000
const SENDING_NOW = 'This post is being sent to the client right now. Wait a moment, then look again.'

type SendingMark = { token: string; action: string; by: string | null; at: string }
function sendingOf(row: unknown): SendingMark | null {
  const s = isObj(row) ? row.sending : null
  if (!isObj(s) || typeof s.token !== 'string' || typeof s.at !== 'string') return null
  return { token: s.token, action: String(s.action ?? ''), by: typeof s.by === 'string' ? s.by : null, at: s.at }
}
/** A send somebody else holds, still fresh — every other move waits for it. */
function heldByOtherSend(row: unknown, now: Date, token: string | null): boolean {
  const mark = sendingOf(row)
  if (!mark || mark.token === token) return false
  const at = Date.parse(mark.at)
  return Number.isFinite(at) && now.getTime() - at < SENDING_HOLD_MS
}

/** What a move asks for beyond the rules: who to email, and the working-copy fields of a save. */
export type MoveInput = TransitionInput & {
  send_to?: readonly string[] | null
  /** save: the working-copy fields (the rules check the stage; this file writes them) */
  working?: WorkingCopy | null
  /** no notices for this move (see the after steps) */
  quiet?: boolean

}

export type WorkingCopy = Partial<{
  slides: Slide[]
  caption: string
  channels: string[]
  per_channel: Record<string, ChannelExtras>
  scheduled_for: string | null
  timezone: string
  /** the comment-to-DM automation (comment-automation-core readPostAutomation) — saved like the caption */
  automation: PostAutomation | null
  note: string | null
  version_id: string | null
  version_number: number | null
}>

/**
 * MAKE ONE MOVE ON ONE POST — the only way a post's stage changes.
 *
 *   1. read the post fresh, and the client, its channels and its people;
 *   2. check the move against the rules (a refusal comes back with the fresh post, nothing touched);
 *   3. the BEFORE steps: freeze the version; pull the provider's jobs back (a take-off, an edit or a
 *      cancel of a booked post; a new time on a booked post). A step that fails refuses the move;
 *   4. a send to the client: the post is CLAIMED for the send first (`sending`), then the email goes
 *      (or the link is made); nothing reached anyone → the claim is let go and nothing changed;
 *   5. ONE claim on the post: the rules run again, inside it, against the row as it now is — with the
 *      rev the page drew, so a stale page is refused rather than applied;
 *   6. the event, then the AFTER steps: queue the booking (§3.1), make the new post, delete a never-sent
 *      draft, and the notices — each after the fact it reports.
 */
export async function performPostTransition(
  postId: string,
  action: PostAction | string,
  actor: EngineActor,
  input: MoveInput = {},
): Promise<PostActResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await attemptMove(postId, action, actor, input)
    if (r === 'again') continue
    // approved and it has a time: the app books it now (autoBookAfter). A refusal — the time too close, a channel
    // gone — leaves it on Ready to post with the reason in the answer, for a person to book.
    if (deps.autoBook && r.ok && autoBookAfter(String(action), r.post)) {
      const b = await performSystemTransition(postId, 'auto_book')
      if (b.ok) return { ...b, words: `${r.words.split(' — ')[0]} — booked in automatically for its time` }
      return { ...r, words: `${r.words}. Not booked automatically: ${b.reason}` }
    }
    return r
  }
  const { post } = await loadPostState(postId)
  return refusal('stale', STALE, post)
}

/** A client send that holds its post: checked, frozen, claimed — waiting for the email. */
type PreparedSend = {
  postId: string
  action: PostAction
  actor: EngineActor
  input: MoveInput
  post: PostState
  loaded: Loaded
  ctx: TransitionContext
  via: 'email' | 'link'
  emails: string[]
  frozenN: number | null
  token: string
  at: string
  /** the version that goes to the client, and when the client's answer closes */
  version: number
  approveBy: string | null
}

/** The live networks the booking's jobs report — the check the recorder's silence would otherwise skip. */
async function liveOnBooking(post: PostState): Promise<string[]> {
  const ids = post.booking?.job_ids ?? []
  if (ids.length === 0) return []
  try {
    return await deps.liveOnJobs(ids)
  } catch (e) {
    console.error('could not read the booking jobs', post.id, e instanceof Error ? e.message : e)
    return []
  }
}

async function attemptMove(
  postId: string, action: PostAction | string, actor: EngineActor, input: MoveInput,
): Promise<PostActResult | 'again'> {
  const now = deps.now()
  const at = now.toISOString()
  const { row, post } = await loadPostState(postId)
  if (!row) return refusal('not_found', NOT_FOUND, null)
  if (!post) return refusal('wrong_stage', NOT_MIGRATED, null)
  if (!isPostAction(action)) return refusal('unknown_action', 'That is not something a post can do.', post)
  if (heldByOtherSend(row, now, null)) return refusal('stale', SENDING_NOW, post)

  // a send to the client has its own order: claim, email, then move
  if (CLIENT_SENDS.includes(action)) {
    const prepared = await prepareClientSend(postId, action, actor, input, now)
    if (prepared === 'again') return 'again'
    if (!prepared.ok) return prepared.result
    const delivery = await deliverOne(prepared.prep)
    return finishClientSend(prepared.prep, delivery.delivered, delivery.link)
  }

  const loaded = await loadAround(post)
  const ctx: TransitionContext = contextOf(loaded, now, 'email')
  // a booked post live somewhere, by its jobs, even before the recorder has written it (audit V11, S5) — and
  // before the client's answer on a booked post, which must never land on one already gone (one portal L4)
  if (TAKES_OFF.includes(action) || action === 'client_ok') ctx.liveOnJobs = await liveOnBooking(post)
  const bump = await bumpSlotFor(post, action, loaded, now)
  if (bump !== undefined) ctx.bumpTo = bump

  // 2. the dry run
  const dry = planPostTransition(post, action, actor, input, ctx)
  if (!dry.ok) return fromRefusal(dry, post)

  // 3. the before steps — the freeze FIRST (it can still be refused, and nothing is undone by it), then
  // the provider's jobs, which cannot be taken back once pulled
  const frozen = await runFreezes(post, dry, actor, input, at)
  if (frozen === 'again') return 'again'
  if (!frozen.ok) return refusal('stale', STALE, (await loadPostState(postId)).post)
  const frozenN = frozen.n
  let pulledJobs = false
  for (const effect of dry.effects) {
    if (effect.when !== 'before' || (effect.kind !== 'cancel_jobs' && effect.kind !== 'reschedule_jobs')) continue
    for (const jobId of effect.job_ids) {
      const pulled = await safeCancel(jobId)
      if (!pulled.ok) {
        // one job pulled and the next refused: the post must not go on saying "booked" over a booking
        // that is half gone — it comes back to Ready to post, with the channel's own words
        if (pulledJobs) {
          await performSystemTransition(postId, 'booking_failed', { problem: `Part of the booking was taken off, and the rest would not come off: ${pulled.error}` })
        }
        return refusal(pulled.live ? 'live' : 'jobs', pulled.error, (await loadPostState(postId)).post ?? post)
      }
      pulledJobs = true
    }
  }

  // 5. the one claim
  const box: { plan: Plan | null; refused: Refusal | null } = { plan: null, refused: null }
  const claimed = await posts().claim(postId, cur => {
    box.refused = null
    box.plan = null
    const cp = readPostState(cur as unknown as Record<string, unknown>)
    if (!cp) { box.refused = { ok: false, code: 'wrong_stage', reason: cur ? NOT_MIGRATED : NOT_FOUND }; return null }
    if (heldByOtherSend(cur, now, null)) { box.refused = { ok: false, code: 'stale', reason: SENDING_NOW }; return null }
    const p = planPostTransition(cp, action, actor, input, ctx)
    if (!p.ok) { box.refused = p; return null }
    // the version frozen above is the one this claim adopts, or nobody's
    if (frozenN != null && cp.draft_version !== frozenN) { box.refused = { ok: false, code: 'stale', reason: STALE }; return null }
    box.plan = p
    return rowAfter(cur!, p, at, action, cp, input.working ?? null)
  })

  if (!claimed.claimed || !box.plan) {
    const current = claimed.claimed ? claimed.row : claimed.current
    const fresh = readPostState(current as unknown as Record<string, unknown>)
    // the provider's jobs were pulled for a move that did not land: a booked post must not stay
    // "booked" over cancelled jobs, so it comes back to Ready to post with the reason
    if (pulledJobs && fresh?.stage === 'booked') {
      await performSystemTransition(postId, 'booking_failed', {
        problem: 'The booking was taken off the schedule while someone else changed this post — book it in again.',
      })
    }
    const after = (await loadPostState(postId)).post ?? fresh
    if (!current && !box.refused) return refusal('not_found', NOT_FOUND, null)
    return box.refused ? fromRefusal(box.refused, after) : refusal('stale', STALE, after)
  }

  return afterLanded(box.plan, claimed.row, actor, input, loaded, at, null, post.scheduled_for)
}

/** Every freeze a move plans, in order, before its claim. */
async function runFreezes(
  post: PostState, dry: Plan, actor: EngineActor, input: MoveInput, at: string,
): Promise<{ ok: true; n: number | null } | { ok: false } | 'again'> {
  let frozenN: number | null = null
  for (const effect of dry.effects) {
    if (effect.when !== 'before' || effect.kind !== 'freeze') continue
    // Schedule it names its time on the effect: the frozen copy carries the time it is booked at
    const time = effect.time ?? (effect.frozen_for === 'retime' ? (input.scheduled_for ?? post.scheduled_for) : post.scheduled_for)
    const f = await freezeVersion(post, effect.frozen_for, actor.id, time, at)
    if (!f.ok) return f.skipped ? 'again' : { ok: false }
    frozenN = f.n
  }
  return { ok: true, n: frozenN }
}

/**
 * STEP ONE OF A SEND TO THE CLIENT: check it, freeze what a new time needs, and CLAIM the post for the
 * send — the rules run inside that claim, so the email only ever goes for a post that holds the send
 * (review fix, 29 Sep 2026: the email used to go first, and a claim refused afterwards left the client
 * holding a link to a page that said Not found).
 */
async function prepareClientSend(
  postId: string, action: PostAction, actor: EngineActor, input: MoveInput, now: Date,
): Promise<{ ok: true; prep: PreparedSend } | { ok: false; result: PostActRefused } | 'again'> {
  const at = now.toISOString()
  const { row, post } = await loadPostState(postId)
  if (!row) return { ok: false, result: refusal('not_found', NOT_FOUND, null) }
  if (!post) return { ok: false, result: refusal('wrong_stage', NOT_MIGRATED, null) }
  if (heldByOtherSend(row, now, null)) return { ok: false, result: refusal('stale', SENDING_NOW, post) }
  const via: 'email' | 'link' = input.via === 'link' ? 'link' : 'email'
  const loaded = await loadAround(post)
  const ctx = contextOf(loaded, now, via)
  // checked as if it had reached someone, since that comes later
  const checking: MoveInput = { ...input, delivered_to: ['(checking)'] }
  const dry = planPostTransition(post, action, actor, checking, ctx)
  if (!dry.ok) return { ok: false, result: fromRefusal(dry, post) }

  // a send to the client needs a portal link and real addresses on the client's own list
  if (!loaded.client?.share_token) return { ok: false, result: refusal('contact', 'This client has no portal link yet — make one on the client first.', post) }
  let emails: string[] = []
  if (via === 'email') {
    const picked = pickRecipients(input.send_to ?? [], loaded.recipients)
    if (!picked.ok) return { ok: false, result: refusal('contact', picked.error, post) }
    emails = picked.emails
  }

  const frozen = await runFreezes(post, dry, actor, input, at)
  if (frozen === 'again') return 'again'
  if (!frozen.ok) return { ok: false, result: refusal('stale', STALE, (await loadPostState(postId)).post) }
  const frozenN = frozen.n

  const token = randomUUID()
  const box: { refused: Refusal | null } = { refused: null }
  const held = await posts().claim(postId, cur => {
    box.refused = null
    const cp = readPostState(cur as unknown as Record<string, unknown>)
    if (!cp) { box.refused = { ok: false, code: 'wrong_stage', reason: cur ? NOT_MIGRATED : NOT_FOUND }; return null }
    if (heldByOtherSend(cur, now, null)) { box.refused = { ok: false, code: 'stale', reason: SENDING_NOW }; return null }
    const p = planPostTransition(cp, action, actor, checking, ctx)
    if (!p.ok) { box.refused = p; return null }
    if (frozenN != null && cp.draft_version !== frozenN) { box.refused = { ok: false, code: 'stale', reason: STALE }; return null }
    return { ...cur!, sending: { token, action, by: actor.id, at } } as SocialPost
  })
  if (!held.claimed) {
    const fresh = readPostState((held.current ?? null) as unknown as Record<string, unknown>)
    return { ok: false, result: box.refused ? fromRefusal(box.refused, fresh) : refusal('stale', STALE, fresh) }
  }
  const version = action === 'resend_new_time' ? (frozenN ?? post.draft_version) : (post.sent_version ?? 0)
  const forTime = action === 'resend_new_time' ? (input.scheduled_for ?? null) : post.scheduled_for
  // a reminder keeps the answer-by time the client was first given — it is the same send, again
  const approveBy = action === 'remind_client'
    ? (post.client_send?.approve_by ?? defaultApproveBy(forTime, now))
    : input.approve_by ?? defaultApproveBy(forTime, now)
  return {
    ok: true,
    prep: {
      postId, action, actor, input, post, loaded, ctx, via, emails, frozenN, token, at,
      version, approveBy,
    },
  }
}

/** STEP TWO, for one post: the email (or only the link). Never throws. */
async function deliverOne(prep: PreparedSend): Promise<{ delivered: string[]; link: string | null }> {
  try {
    const sent = await deps.deliverToClient({
      post: prep.post, version: prep.version, client: prep.loaded.client!, emails: prep.emails, via: prep.via,
      approveBy: prep.approveBy,
      actor: prep.actor, note: String(prep.input.note ?? '').trim() || null,
      ...(prep.action === 'remind_client' ? { reminder: true } : {}),
    })
    return { delivered: sent.delivered, link: sent.link }
  } catch (e) {
    console.error('client send failed', prep.postId, e instanceof Error ? e.message : e)
    return { delivered: [], link: null }
  }
}

/** Let go of a send's hold, when the post still carries it. */
async function releaseSend(prep: Pick<PreparedSend, 'postId' | 'token'>): Promise<void> {
  await posts().claim(prep.postId, cur => {
    if (!cur || sendingOf(cur)?.token !== prep.token) return null
    return { ...cur, sending: null } as SocialPost
  }).catch(e => console.error('could not let go of a send', prep.postId, e instanceof Error ? e.message : e))
}

/**
 * STEP THREE: the post moves — only if the send still holds it, and only when something reached the
 * client (audit P9). A refusal here after an email went is said plainly to the person who pressed.
 */
async function finishClientSend(prep: PreparedSend, delivered: readonly string[], link: string | null): Promise<PostActResult> {
  const { postId, action, actor, input, token, at, ctx } = prep
  if (prep.via === 'email' && delivered.length === 0) {
    await releaseSend(prep)
    return refusal('delivery', `Nothing reached the client, so nothing has changed. ${prep.emails.join(', ')} could not be emailed — check the address and try again, or copy the link instead.`, (await loadPostState(postId)).post ?? prep.post)
  }
  const moveInput: MoveInput = { ...input, delivered_to: [...delivered] }
  const box: { plan: Plan | null; refused: Refusal | null } = { plan: null, refused: null }
  const claimed = await posts().claim(postId, cur => {
    box.refused = null
    box.plan = null
    const cp = readPostState(cur as unknown as Record<string, unknown>)
    if (!cp) { box.refused = { ok: false, code: 'wrong_stage', reason: cur ? NOT_MIGRATED : NOT_FOUND }; return null }
    if (sendingOf(cur)?.token !== token) { box.refused = { ok: false, code: 'stale', reason: STALE }; return null }
    const p = planPostTransition(cp, action, actor, moveInput, ctx)
    if (!p.ok) { box.refused = p; return null }
    if (prep.frozenN != null && cp.draft_version !== prep.frozenN) { box.refused = { ok: false, code: 'stale', reason: STALE }; return null }
    box.plan = p
    return rowAfter(cur!, p, at, action, cp, null)
  })
  if (!claimed.claimed || !box.plan) {
    await releaseSend(prep)
    const fresh = (await loadPostState(postId)).post
    const why = box.refused?.reason ?? STALE
    if (delivered.length > 0) {
      console.error('client send: the email went but the post did not move', postId, action, why)
      return refusal(box.refused?.code ?? 'stale',
        `The email went to ${delivered.join(', ')}, but the post did not move: ${why} Look at it again — the client's link shows what the post says now.`, fresh)
    }
    return box.refused ? fromRefusal(box.refused, fresh) : refusal('stale', STALE, fresh)
  }
  return afterLanded(box.plan, claimed.row, actor, input, prep.loaded, at, prep.via === 'link' ? link : null)
}

/** The event, the after steps and the notices of a move that has landed; the answer the page draws from. */
async function afterLanded(
  done: Plan, row: SocialPost, actor: EngineActor, input: MoveInput, loaded: Loaded, at: string, link: string | null,
  timeBefore: string | null = null,
): Promise<PostActResult> {
  const landed = readPostState(row as unknown as Record<string, unknown>)!
  await writeEvent(done.event)

  // A POST TAKEN OFF STOPS DMING PEOPLE (29 Sep 2026): cancelled, taken off the schedule, opened for an
  // edit, or moved to a new time (its old booking is pulled). Switched off, never deleted — its history
  // stays; a new booking switches it back on when it reaches Zernio (comment-automation.armPostAutomations).
  // Before the re-booking below, so the new booking's own switch-on cannot be undone by this.
  const takenOff = landed.stage === 'cancelled' || TAKES_OFF.includes(done.action) || done.effects.some(e => e.kind === 'reschedule_jobs')
  if (takenOff) {
    await deps.pauseAutomations(landed.id, landed.stage === 'cancelled' ? CANCELLED_REASON : TAKEN_OFF_REASON)
      .catch(e => console.error('could not pause automations', landed.id, e))
  }

  let final: PostState = landed
  let createdId: string | null = null
  let bookingProblem: string | null = null

  for (const effect of done.effects) {
    if (effect.when === 'instead' && effect.kind === 'delete_post') {
      await deleteDraftRow(landed)
    } else if (effect.when === 'after' && effect.kind === 'queue_publish') {
      const booked = await runBooking(landed, effect.for_time, effect.now, actor, loaded)
      final = booked.post ?? final
      bookingProblem = booked.problem
    } else if (effect.when === 'after' && effect.kind === 'create_post') {
      createdId = await createFollowUp(landed, effect, actor, loaded, at)
    }
  }
  // a new time on a booked post: the old jobs were pulled above; the post is booked again at the new time
  if (done.effects.some(e => e.kind === 'reschedule_jobs')) {
    const booked = await runBooking(landed, input.scheduled_for ?? landed.scheduled_for, false, actor, loaded)
    final = booked.post ?? final
    bookingProblem = booked.problem
  }

  // `quiet`: a step whose news the person who pressed is reading right now (a booking that failed
  // under their own press comes back to them as the answer, and nobody else is emailed about it)
  if (!input.quiet) {
    for (const effect of done.effects) {
      if (effect.when === 'after' && effect.kind === 'notify') {
        await sendNotice(effect.to, effect.action, effect.person_id ?? null, landed, actor, done.event,
          timeBefore && timeBefore !== landed.scheduled_for ? timeBefore : null)
      }
    }
  }
  deps.announce(landed, done.to === 'deleted' ? 'deleted' : done.action)

  if (bookingProblem) return refusal('jobs', bookingProblem, final)
  const answer = { ok: true as const, post: final, stage: done.to === 'deleted' ? 'deleted' as const : final.stage, words: done.words }
  return {
    ...answer,
    ...(createdId ? { created_post_id: createdId } : {}),
    ...(link ? { link } : {}),
  }
}

/**
 * The row after a move: the rules' patch, plus — for a save — the working-copy fields, and for a
 * cancel the booking's pending flag cleared. A new time on a booked post starts a fresh pending booking;
 * its jobs are queued after the claim (the old ones were pulled before it). A send's hold is always let
 * go: a move that landed holds nothing.
 */
function rowAfter(
  cur: SocialPost, plan: Plan, at: string, action: PostAction, before: PostState, working: WorkingCopy | null,
): SocialPost {
  const next: Record<string, unknown> = { ...cur, ...plan.patch, updated_at: at, sending: null }
  if (action === 'save' && working) {
    for (const [k, v] of Object.entries(working)) if (v !== undefined) next[k] = v
  }
  if (action === 'change_time' && before.stage === 'booked') {
    next.booking = { job_ids: [], pending: true, at, for_time: plan.patch.scheduled_for ?? before.scheduled_for }
  }
  if (plan.to === 'deleted') {
    // a draft about to be deleted: marked first, in the same claim, so a racing move sees it gone
    next.stage = 'cancelled'
    next.cancelled = { by: plan.event.actor_id, at, from_stage: before.stage, reason: 'Draft deleted' }
  }
  return next as unknown as SocialPost
}

/* ── a round: several posts to one client, in one email (decision 15) ───── */

export type RoundRequest = {
  client_id: string
  posts: readonly { post_id: string; expect_rev: number; version?: number | null }[]
  send_to: readonly string[]
  note?: string | null
  approve_by?: string | null
}

export type RoundResult =
  | { ok: true; delivered: string[]; message: string; results: { post_id: string; ok: boolean; words: string }[] }
  | { ok: false; code: PostActRefused['code']; reason: string; post_id: string | null }

/** Which send a post in a round makes: a pass from the quality check, or a send after it passed. */
function roundAction(post: PostState): PostAction | null {
  return post.stage === 'quality_check' ? 'pass_send_client' : post.stage === 'ready' ? 'send_to_client' : null
}

/**
 * SEND SEVERAL POSTS TO THE CLIENT IN ONE EMAIL (the owner's decision 15: "one batched email per round,
 * not one per post"). Every post is checked and claimed for the send first — each by its own rules and
 * its own rev — and if ANY of them cannot go, none is sent and every claim is let go. Then ONE email per
 * person lists them all and opens on the client's one link (`sendClientRound`). Then each post moves,
 * with the addresses the email actually reached.
 */
export async function sendRoundToClient(user: TeamUser, request: RoundRequest): Promise<RoundResult> {
  if (user.role === 'client') return { ok: false, code: 'not_allowed', reason: 'Clients answer posts on their own page, not here.', post_id: null }
  const wanted = [...new Map(request.posts.map(p => [p.post_id, p])).values()]
  if (wanted.length === 0) return { ok: false, code: 'bad_request', reason: 'Tick at least one post to send.', post_id: null }
  if (wanted.length > 30) return { ok: false, code: 'bad_request', reason: 'Send 30 posts at most in one email.', post_id: null }
  const now = deps.now()
  const prepared: PreparedSend[] = []
  const letGo = async () => { for (const p of prepared) await releaseSend(p) }
  for (const want of wanted) {
    const { post } = await loadPostState(want.post_id)
    if (!post || post.client_id !== request.client_id) {
      await letGo()
      return { ok: false, code: 'not_found', reason: 'One of these posts is not on this client any more. Nothing was sent.', post_id: want.post_id }
    }
    if (!(await mayActOn(user, post))) {
      await letGo()
      return { ok: false, code: 'not_allowed', reason: 'That client is not one of yours. Nothing was sent.', post_id: want.post_id }
    }
    const action = roundAction(post)
    if (!action) {
      await letGo()
      return { ok: false, code: 'wrong_stage', reason: `A post in ${post.stage === 'with_client' ? 'With client' : 'this stage'} cannot join this email. Nothing was sent.`, post_id: post.id }
    }
    const prep = await prepareClientSend(post.id, action, teamActorFor(user, post), {
      expect_rev: want.expect_rev, version: want.version ?? post.sent_version,
      note: request.note ?? null, approve_by: request.approve_by ?? null,
      send_to: request.send_to, via: 'email',
    }, now)
    if (prep === 'again' || !prep.ok) {
      await letGo()
      const reason = prep === 'again' ? STALE : prep.result.reason
      return { ok: false, code: prep === 'again' ? 'stale' : prep.result.code, reason: `${reason} Nothing was sent.`, post_id: post.id }
    }
    prepared.push(prep.prep)
  }

  let delivered: string[] = []
  let message = ''
  try {
    const sent = await deps.deliverRound({
      clientId: request.client_id,
      posts: prepared.map(p => ({ post_id: p.postId, version: p.version, approve_by: p.approveBy })),
      emails: prepared[0].emails,
      note: String(request.note ?? '').trim() || null,
      actor: prepared[0].actor,
    })
    delivered = sent.delivered
    message = sent.message
  } catch (e) {
    console.error('client round failed', e instanceof Error ? e.message : e)
  }

  const results: { post_id: string; ok: boolean; words: string }[] = []
  for (const prep of prepared) {
    const r = await finishClientSend(prep, delivered, null)
    results.push({ post_id: prep.postId, ok: r.ok, words: r.ok ? r.words : r.reason })
  }
  if (delivered.length === 0) {
    return { ok: false, code: 'delivery', reason: 'Nothing reached the client, so nothing has changed. Check the addresses and try again.', post_id: null }
  }
  return { ok: true, delivered, message: message || `Emailed ${delivered.join(', ')}.`, results }
}

/* ── system moves (the booking steps, the recorder, resends) ───────────── */

/**
 * A move only the app makes: the booking's own steps, the publish recorder's answers, a resend linked.
 * No rev from a page — the claim still retries on a lost race and runs the rules on the row it lands on.
 */
export async function performSystemTransition(
  postId: string,
  action: PostAction,
  input: TransitionInput & { quiet?: boolean } = {},
): Promise<PostActResult> {
  if (!SYSTEM_ACTIONS.includes(action)) {
    const { post } = await loadPostState(postId)
    return refusal('not_allowed', 'Only the app does that.', post)
  }
  return performPostTransition(postId, action, SYSTEM_ACTOR, { ...input, expect_rev: null })
}

/* ── booking (SPEC §3.1) ────────────────────────────────────────────────── */

/**
 * The post is already claimed as booked with a PENDING booking. Queue the frozen copy; on success claim
 * the job ids, on any refusal or throw claim it back to Ready to post with the reason. Only then is
 * anybody told, and the caller draws from the post this returns.
 */
async function runBooking(
  post: PostState, forTime: string | null, now: boolean, actor: EngineActor, loaded: Loaded,
): Promise<{ post: PostState | null; problem: string | null }> {
  const version = copyOfVersion(await loadFrozenVersion(post.id, post.sent_version)) ?? copyOfPost(post)
  // the frozen version is what was approved — its channels too, never the working copy's
  const copy: FrozenCopy = { ...version, scheduled_for: forTime, channels: version.channels.length ? version.channels : post.channels }
  const accounts = loaded.accounts.filter(a => copy.channels.includes(a.id))
  let queued: { id: string; ids?: string[] } | { error: string; issues?: string[] }
  try {
    queued = accounts.length === 0
      ? { error: 'None of this post\'s channels are connected — choose its channels again.' }
      : await deps.queuePublish({ post, copy, accounts, forTime: now ? null : forTime, now, actor })
  } catch (e) {
    queued = { error: e instanceof Error ? e.message : 'The channel could not take this post.' }
  }

  if ('id' in queued) {
    const jobIds = queued.ids?.length ? queued.ids : [queued.id]
    const done = await performSystemTransition(post.id, 'booking_done', { job_ids: jobIds })
    if (done.ok) return { post: done.post, problem: null }
    // somebody cancelled or took it off while it was being queued: the job must not go out on its own
    for (const id of jobIds) await safeCancel(id)
    return { post: done.post, problem: done.reason }
  }
  const problem = [queued.error, ...(queued.issues ?? [])].filter(Boolean).join(' — ')
  const reason = `It could not be booked in: ${problem.replace(/\.?$/, '.')}`
  // quiet: the person who pressed Book in reads this reason as the answer; no email about a failure
  // they are looking at (SPEC §8.2)
  const back = await performSystemTransition(post.id, 'booking_failed', { problem: reason, quiet: true })
  return { post: back.post, problem: reason }
}

async function safeCancel(jobId: string): Promise<{ ok: true } | { ok: false; error: string; live?: boolean }> {
  try {
    return await deps.cancelJob(jobId)
  } catch (e) {
    return { ok: false, error: `The channel would not let go of this post: ${e instanceof Error ? e.message : 'no answer'}. Try again in a minute.` }
  }
}

/* ── the posts a move makes ─────────────────────────────────────────────── */

/**
 * T21: Post the missing networks (a new post, born Ready to post with the same approval, limited to the
 * networks that failed), or Duplicate (a new draft with the same files and words, no time). The new post
 * gets its own frozen version 1, so its approval is of something it can show.
 */
async function createFollowUp(
  source: PostState,
  effect: { stage: 'ready' | 'draft'; platforms: string[] | null; carry_approval: boolean },
  actor: EngineActor,
  loaded: Loaded,
  at: string,
): Promise<string | null> {
  const frozen = copyOfVersion(await loadFrozenVersion(source.id, source.sent_version)) ?? copyOfPost(source)
  const byId = new Map(loaded.accounts.map(a => [a.id, a]))
  const channels = effect.platforms
    ? frozen.channels.filter(id => effect.platforms!.includes(String(byId.get(id)?.platform ?? '')))
    : frozen.channels
  const perChannel = Object.fromEntries(Object.entries(frozen.per_channel).filter(([id]) => channels.includes(id)))
  const id = randomUUID()
  const base: Record<string, unknown> = {
    id,
    client_id: source.client_id,
    item_id: source.source_item_id ?? '',
    source_item_id: source.source_item_id,
    slides: frozen.slides,
    caption: frozen.caption,
    channels,
    per_channel: perChannel,
    scheduled_for: null,
    timezone: frozen.timezone ?? source.timezone ?? 'Australia/Melbourne',
    // the automation travels with the words it was written for
    ...(frozen.automation ? { automation: frozen.automation } : {}),
    created_by: actor.id,
    created_at: at,
    updated_at: at,
    rev: 0,
    stage_at: at,
  }
  if (effect.stage === 'draft' || !effect.carry_approval || !source.approval) {
    await posts().insert({ ...base, stage: 'draft', draft_version: 1 } as unknown as SocialPost)
    return id
  }
  // born Ready to post: version 1 is the posted version, minus the networks that went out
  const v1: PostVersion = {
    id: postVersionId(id, 1), post_id: id, client_id: source.client_id, n: 1,
    slides: frozen.slides, per_channel: perChannel, channels, caption: frozen.caption,
    scheduled_for: null, timezone: String(base.timezone), frozen_for: 'retime', frozen_by: actor.id,
    frozen_at: at, from_migration: false, automation: frozen.automation ?? null,
  }
  await versionsT().claim(v1.id, cur => (cur ? null : v1))
  await posts().insert({
    ...base,
    stage: 'ready',
    sent_version: 1,
    draft_version: 2,
    approval: { ...source.approval, version: 1 },
    ...(source.qc_pass ? { qc_pass: { ...source.qc_pass, version: 1 } } : {}),
    problem: 'These networks did not go out last time.',
  } as unknown as SocialPost)
  await writeEvent({
    id: `${id}_r0`, post_id: id, client_id: source.client_id, rev: 0, from: 'posted', to: 'ready',
    action: 'missing_networks', actor_id: actor.id, hat: (actor.hats[0] ?? 'system') as PostHat,
    on_behalf_of_client: false, version: 1, note: `From post ${source.id}: ${failedNetworks(source).join(', ')}`, at,
  })
  return id
}

/** A never-sent draft goes for good (T23, audit S1): its row, its notes, and the item's open-post lock. */
async function deleteDraftRow(post: PostState): Promise<void> {
  try {
    await posts().remove(post.id)
  } catch (e) {
    // it stays, marked cancelled "Draft deleted" by the claim — visible, never lost
    console.error('draft delete did not land', post.id, e instanceof Error ? e.message : e)
    return
  }
  await table<PostComment>('post_comments').removeWhere(c => c.post_id === post.id).catch(() => 0)
  if (post.source_item_id) {
    const { releaseClaimLock } = await import('./claim-lock')
    await releaseClaimLock(postLockKey(post.source_item_id), post.id).catch(() => {})
  }
}

/* ── notices ────────────────────────────────────────────────────────────── */

async function sendNotice(
  to: NotifyTarget, action: PostAction, personId: string | null, post: PostState, actor: EngineActor, event: PostEventRow,
  previousTime: string | null = null,
): Promise<void> {
  try {
    await deps.notify({
      to, action, person_id: personId, post, actor: { id: actor.id, name: actor.name ?? null, hat: event.hat }, event,
      ...(previousTime ? { previous_time: previousTime } : {}),
    })
  } catch (e) {
    console.error('post notice failed', post.id, action, e instanceof Error ? e.message : e)
  }
}

/* ── the team's entry: the act route ───────────────────────────────────── */

/**
 * MAY THIS PERSON WORK ON THIS POST? The same rule the boards draw by (`mayWorkOnPost`): their clients,
 * a post they made or are named on, and — for the quality reviewer — every post waiting on the check,
 * whoever's client it is (decision 3; the edit card has the same desk exception).
 */
export async function mayActOn(user: TeamUser, post: PostState): Promise<boolean> {
  if (user.role === 'client') return false
  if (mayWorkOnPost(user, post, [])) return true
  return deps.mayActOnClient(user, post.client_id)
}

/** The same, for a raw row — one the migration has not reached is judged by its client alone. */
export async function mayActOnRow(user: TeamUser, row: Pick<SocialPost, 'client_id'> & Record<string, unknown>): Promise<boolean> {
  const state = readPostState(row as unknown as Record<string, unknown>)
  if (state) return mayActOn(user, state)
  if (user.role === 'client') return false
  return deps.mayActOnClient(user, row.client_id)
}

/**
 * A SIGNED-IN TEAM MEMBER PRESSES A BUTTON (`POST /api/posts/<id>/act`). Authorization is here, on the
 * server: the person must be on the post's client, and the move must be one their hats allow on this
 * post (the rules say which). A client account is refused outright — the client acts through the portal.
 */
export async function actOnPost(user: TeamUser, postId: string, request: PostActRequest): Promise<PostActResult> {
  const { row, post } = await loadPostState(postId)
  if (!row) return refusal('not_found', NOT_FOUND, null)
  if (!post) return refusal('wrong_stage', NOT_MIGRATED, null)
  if (user.role === 'client') return refusal('not_allowed', 'Clients answer posts on their own page, not here.', null)
  if (!(await mayActOn(user, post))) return refusal('not_allowed', 'That client is not one of yours.', null)
  // a move only the client or the app makes; the one portal's answers are the client's OR a manager's for them
  const teamMay = ROW_OF[request.action].who.some(h => h !== 'client' && h !== 'system')
  if (SYSTEM_ACTIONS.includes(request.action) || (CLIENT_ACTIONS.includes(request.action) && !teamMay)) {
    return refusal('not_allowed', `Only ${ROW_OF[request.action].who.includes('client') ? 'the client' : 'the app'} can do that.`, post)
  }
  return performPostTransition(postId, request.action, teamActorFor(user, post), {
    expect_rev: request.expect_rev,
    version: request.version ?? null,
    note: request.note ?? null,
    scheduled_for: request.scheduled_for ?? null,
    approve_by: request.approve_by ?? null,
    agreed_via: request.agreed_via ?? null,
    assign_to: request.assign_to ?? null,
    confirm: request.confirm ?? null,
    steps: request.steps ?? null,
    via: request.via ?? null,
    reason: request.reason ?? null,
    send_to: request.send_to ?? null,
    ...(request.if_no_answer ? { if_no_answer: request.if_no_answer } : {}),
  })
}

/**
 * THE CLIENT ANSWERS (package P6's `api/portal/act`). The portal has already proved the share token; this
 * refuses a post that is not that client's, and the rules refuse anything but a post that is WITH THE
 * CLIENT, on the version they were sent, before its approve-by time (audit V5, P3).
 */
export async function clientActOnPost(
  clientId: string,
  postId: string,
  request: {
    action: 'client_approve' | 'client_ask_change' | 'client_ok' | 'client_not_approved' | 'client_ok_book'
    version: number; note?: string | null
    /** the one portal: the name the client typed, kept with the answer (L2) */
    answered_by?: string | null
  },
): Promise<PostActResult> {
  const { row, post } = await loadPostState(postId)
  if (!row || !post || post.client_id !== clientId) return refusal('not_found', NOT_FOUND, null)
  if (!CLIENT_ACTIONS.includes(request.action)) return refusal('not_allowed', 'That is not something you can do here.', null)
  return performPostTransition(postId, request.action, { id: null, hats: ['client'], name: 'the client' }, {
    version: request.version, note: request.note ?? null,
    ...(request.answered_by ? { answered_by: request.answered_by } : {}),
  })
}

/* ── the working copy ───────────────────────────────────────────────────── */

/**
 * A NEW DRAFT POST. The only way a post row is born with a stage (a Schedule upload, the composer, a
 * piece's leftover files). Nobody is emailed about a draft (audit V12).
 */
export type DraftPostInput = {
  id?: string
  client_id: string
  item_id: string
  created_by: string | null
  slides: Slide[]
  caption: string
  channels: string[]
  per_channel: Record<string, ChannelExtras>
  scheduled_for: string | null
  timezone: string
  version_id?: string | null
  version_number?: number | null
  approval_steps?: 'team' | 'team_then_client' | null
  automation?: PostAutomation | null
  /** the person who acts next on it — the scheduler a card is handed to */
  assigned_to?: string | null
  /** one of a card's posts (post-batch-core PostBatch) */
  batch?: Record<string, unknown> | null
}

function draftRow(input: DraftPostInput): SocialPost {
  const at = deps.now().toISOString()
  return {
    id: input.id ?? randomUUID(),
    client_id: input.client_id,
    item_id: input.item_id,
    source_item_id: input.item_id,
    version_id: input.version_id ?? null,
    version_number: input.version_number ?? null,
    slides: input.slides,
    caption: input.caption,
    per_channel: input.per_channel,
    channels: input.channels,
    scheduled_for: input.scheduled_for,
    timezone: input.timezone,
    created_by: input.created_by,
    created_at: at,
    updated_at: at,
    note: null,
    stage: 'draft',
    rev: 0,
    stage_at: at,
    draft_version: 1,
    approval_steps: input.approval_steps ?? null,
    ...(input.automation ? { automation: input.automation } : {}),
    ...(input.assigned_to ? { assigned_to: input.assigned_to } : {}),
    ...(input.batch ? { batch: input.batch } : {}),
  } as unknown as SocialPost
}

export async function insertDraftPost(input: DraftPostInput): Promise<SocialPost> {
  return posts().insert(draftRow(input) as never)
}

/**
 * A NEW DRAFT, AT MOST ONCE (a card's batch, post-batch.ts). The id is worked out from the card, the
 * version and the file, and the row is CLAIMED against "nothing there yet": the first writer makes it,
 * every later one — a retried hand-over, the automatic hand-over beside a manual one — finds it and
 * makes nothing. `created: false` names the post that was already there.
 */
export async function claimDraftPost(input: DraftPostInput & { id: string }): Promise<{ created: boolean; row: SocialPost | null }> {
  const row = draftRow(input)
  const res = await posts().claim(input.id, cur => (cur ? null : row))
  return res.claimed ? { created: true, row: res.row } : { created: false, row: res.current }
}

/**
 * SAVE THE WORKING COPY — only in Draft (T19 makes a frozen post a draft first). The rules' `save` row
 * decides who and when; `expectRev` (the page's rev) refuses a stale page when the page sends one.
 */
export async function saveWorkingCopy(
  postId: string, actor: EngineActor, working: WorkingCopy, expectRev: number | null = null,
): Promise<PostActResult> {
  return performPostTransition(postId, 'save', actor, { expect_rev: expectRev, working })
}

/* ── the edit card is deleted (SPEC §5) ─────────────────────────────────── */

/**
 * THE CARD BEHIND THESE POSTS IS BEING DELETED (audit V8, L6). Refused while any of its posts is booked,
 * or has gone out somewhere while not yet recorded as posted — the channel holds it, and the app would
 * lose it. Otherwise every post not yet posted is cancelled ("card deleted") and every post is marked
 * `source_deleted`, so posted history and the cancelled posts stay visible. Called BEFORE the card goes.
 */
export async function cascadeItemDelete(
  itemId: string, actorId: string | null,
): Promise<{ ok: true; cancelled: string[]; marked: string[] } | { ok: false; reason: string }> {
  const rows = await posts().list({ where: p => (p.source_item_id ?? p.item_id) === itemId, fresh: true })
  const blocking = (s: PostState) => s.stage === 'booked' || (anyNetworkLive(s) && s.stage !== 'posted' && s.stage !== 'cancelled')
  const holding = rows.map(r => readPostState(r as unknown as Record<string, unknown>)).filter((s): s is PostState => !!s && blocking(s))
  if (holding.length > 0) {
    return { ok: false, reason: 'A post from this card is booked in with the channel — take it off the schedule first, then delete the card.' }
  }
  const at = deps.now().toISOString()
  const cancelled: string[] = []
  const marked: string[] = []
  for (const r of rows) {
    const box: { event: PostEventRow | null; stoppedBy: PostStage | null } = { event: null, stoppedBy: null }
    const res = await posts().claim(r.id, cur => {
      box.event = null
      box.stoppedBy = null
      if (!cur) return null
      const s = readPostState(cur as unknown as Record<string, unknown>)
      // a row the migration has not reached: only marked
      if (!s) return cur.source_deleted ? null : { ...cur, source_deleted: true } as SocialPost
      if (blocking(s)) { box.stoppedBy = s.stage; return null }
      if (s.stage === 'posted' || s.stage === 'cancelled') return s.source_deleted ? null : { ...cur, source_deleted: true } as SocialPost
      const rev = s.rev + 1
      box.event = {
        id: `${s.id}_r${rev}`, post_id: s.id, client_id: s.client_id, rev, from: s.stage, to: 'cancelled',
        action: 'cancel', actor_id: actorId, hat: 'system', on_behalf_of_client: false, version: s.sent_version,
        note: 'card deleted', at,
      }
      return {
        ...cur, source_deleted: true, stage: 'cancelled', stage_at: at, rev,
        cancelled: { by: actorId, at, from_stage: s.stage, reason: 'card deleted' },
        client_send: null, ...(s.client_send ? { last_client_send: s.client_send } : {}),
        booking: null, assigned_to: null, updated_at: at,
      } as unknown as SocialPost
    })
    if (box.stoppedBy) return { ok: false, reason: 'A post from this card was booked in just now — take it off the schedule first, then delete the card.' }
    if (res.claimed) {
      marked.push(r.id)
      if (box.event) {
        cancelled.push(r.id)
        await writeEvent(box.event)
        await deps.pauseAutomations(r.id, CANCELLED_REASON).catch(e => console.error('could not pause automations', r.id, e))
      }
    }
  }
  return { ok: true, cancelled, marked }
}

/* ── the team the notices go to ─────────────────────────────────────────── */

/** The client's account managers and the super admins on it — who may approve for the client. */
export async function clientManagers(clientId: string): Promise<{ id: string; email: string; name: string }[]> {
  const { attachOne } = await import('@/lib/db-join')
  const links = await table('team_user_clients').list({ where: l => l.client_id === clientId })
  const joined = await attachOne(links as unknown as { team_user_id: string }[], 'team_user_id', 'team_users',
    ['id', 'email', 'name', 'role', 'active_status'])
  return joined
    .map(r => r.team_users as unknown as { id: string; email: string; name: string; role: string; active_status: boolean } | null)
    .filter((u): u is { id: string; email: string; name: string; role: string; active_status: boolean } =>
      !!u && (u.role === 'account_manager' || u.role === 'super_admin') && u.active_status)
}

/* ── the real provider and mailer (the defaults) ─────────────────────────── */

async function defaultQueuePublish(input: QueueInput): Promise<{ id: string; ids?: string[] } | { error: string; issues?: string[] }> {
  const [{ queuePublishJob }, schedule, { inngest }] = await Promise.all([
    import('./publish'), import('./social-schedule'), import('../inngest/client'),
  ])
  const whenMs = input.forTime ? new Date(input.forTime).getTime() : Date.now()
  const late = await schedule.bookingProblem(input.copy, input.accounts, whenMs)
  if (late) return { error: late }
  const itemVersions = input.post.source_item_id
    ? await table('asset_versions').list({ where: v => v.item_id === input.post.source_item_id }).catch(() => [])
    : []
  const targets = schedule.targetsFor(
    { slides: input.copy.slides, per_channel: input.copy.per_channel } as never,
    input.accounts, itemVersions as never,
  )
  const media = input.copy.slides.map(s => ({ url: s.url, type: s.type === 'video' ? 'video' as const : 'image' as const }))
  const common = {
    clientId: input.post.client_id,
    contentItemId: input.post.source_item_id,
    // the door asks the POST: booked, holding an approval of this version (P2: publish-core.publishDoorRefusal)
    postId: input.post.id,
    caption: input.copy.caption,
    media,
    scheduledFor: input.now ? null : input.forTime,
    timezone: input.copy.timezone ?? input.post.timezone ?? 'Australia/Melbourne',
    createdBy: input.actor.email ?? undefined,
  }
  /* INSTAGRAM THROUGH OUR OWN META APP (1 Oct 2026, branch meta-publish): with the client's switch on and
   * its Instagram connected directly, the Instagram target becomes its own job in the 'meta_ig' lane,
   * and the other networks go to Zernio exactly as before. Switch off (every client but a test one):
   * `meta` is null and this is the one job it always was. The Meta job is queued FIRST — it is held
   * until its time, so nothing can send it before the Zernio job is in too — and taken back if the
   * Zernio job is refused, so a booking is never half made. */
  const { splitBookingForMeta } = await import('./meta-ig-publish')
  const split = await splitBookingForMeta({ clientId: input.post.client_id, targets, accounts: input.accounts, media })
    .catch(e => {
      console.error('could not ask the Meta routing — everything goes through Zernio:', (e as Error).message)
      return { meta: null, rest: targets }
    })
  const ids: string[] = []
  if (split.meta) {
    const metaJob = await queuePublishJob({
      ...common, targets: [split.meta.target], lane: { provider: META_PROVIDER, state: split.meta.state },
    })
    if ('error' in metaJob) return { error: metaJob.error, issues: metaJob.issues }
    ids.push(metaJob.id)
  }
  if (split.rest.length > 0) {
    const queued = await queuePublishJob({ ...common, targets: split.rest })
    if ('error' in queued) {
      for (const id of ids) await defaultCancelJob(id).catch(() => {})
      return { error: queued.error, issues: queued.issues }
    }
    ids.push(queued.id)
  }
  if (ids.length === 0) return { error: 'None of this post\'s channels could be booked.' }
  // the schedule rows the portal and the board read, per network — bookkeeping, best effort
  if (input.actor.user && input.post.source_item_id) {
    const item = await table('content_items').get(input.post.source_item_id).catch(() => null)
    if (item) {
      const { markScheduledAfterQueue } = await import('./production-publish')
      await markScheduledAfterQueue(input.actor.user, item as never, { targets, scheduledFor: input.forTime }, input.now, { moveItem: false })
        .catch(e => console.error('could not record the schedule for a booked post:', (e as Error).message))
    }
  }
  for (const jobId of ids) {
    await inngest.send({ name: 'app/post.publish.requested', data: { jobId } })
      .catch(e => console.error('booking dispatch failed:', (e as Error).message))
  }
  return ids.length > 1 ? { id: ids[ids.length - 1], ids } : { id: ids[0] }
}

/**
 * Pull one job back: the provider FIRST (a row saying "cancelled" over a post the provider will still
 * publish is the one outcome worth avoiding), then our own row, conditionally.
 */
async function defaultCancelJob(jobId: string): Promise<{ ok: true } | { ok: false; error: string; live?: boolean }> {
  const jobs = table<PublishJobRow>('publish_jobs')
  const job = await jobs.get(jobId, { fresh: true })
  if (!job) return { ok: true }
  // a job that says a network went out is NOT pulled back, whatever its own status (a failed parent of
  // a re-send, a published job the recorder has not reached yet)
  const [{ outcomesForJob }, { networkName }] = await Promise.all([import('./post-outcome-core'), import('./publish-core')])
  const live = [...new Set(outcomesForJob(job as never).filter(o => o.status === 'published').map(o => o.platform))]
  if (live.length > 0 || job.status === 'published') {
    const names = live.length > 0 ? live.map(networkName).join(' and ') : 'its networks'
    return { ok: false, live: true, error: `It has already gone out on ${names} — it cannot come off the schedule.` }
  }
  if (job.status === 'publishing') {
    return { ok: false, error: 'It is being sent right now — wait for it to finish, then look again.' }
  }
  if (!['queued', 'scheduled'].includes(job.status)) return { ok: true }
  if (job.status === 'scheduled' && job.provider_post_id) {
    const { getPublisher } = await import('./publisher')
    try {
      await getPublisher().deletePost(String(job.provider_post_id))
    } catch (e) {
      const why = e instanceof Error ? e.message : 'the channel would not cancel it'
      return { ok: false, error: `The channel would not let go of this post: ${why}. Open it at the channel and delete it there.` }
    }
  }
  const done = await jobs.claim(job.id, cur =>
    cur && cur.status === job.status ? { ...cur, status: 'cancelled', error: null, updated_at: new Date().toISOString() } as PublishJobRow : null)
  if (!done.claimed) return { ok: false, error: 'It moved on while it was being cancelled — look again in a minute.' }
  if (job.content_item_id) {
    const [{ releaseClaimLock }, { jobLockKey }] = await Promise.all([import('./claim-lock'), import('./publish')])
    await releaseClaimLock(jobLockKey(job), job.id).catch(() => {})
  }
  return { ok: true }
}

/** The networks a booking's jobs — and every re-send of them — already went out on. */
async function defaultLiveOnJobs(jobIds: readonly string[]): Promise<string[]> {
  if (jobIds.length === 0) return []
  const { bookingJobs, outcomesForJob } = await import('./post-outcome-core')
  const all = await table<PublishJobRow>('publish_jobs').list({ fresh: true })
  const mine = bookingJobs(jobIds, all)
  return [...new Set(mine.flatMap(j => outcomesForJob(j as never).filter(o => o.status === 'published').map(o => o.platform)))]
}

/**
 * THE CLIENT SEND FOR ONE POST IS A ROUND OF ONE (decision 15): the same sender as a round of many
 * (post-notify `sendClientRound`) — in Divina's name, from the frozen version, only to addresses on the
 * client's own list, a deliberate client send under the round's outbox key. 'link' builds the client's
 * page for this post and emails nobody. A refusal comes back as nothing delivered, which
 * `finishClientSend` turns into "Nothing reached the client, so nothing has changed".
 */
async function defaultDeliver(input: DeliveryInput): Promise<{ delivered: string[]; failed: string[]; link: string }> {
  const [{ DASHBOARD_URL }, { sendClientRound }] = await Promise.all([import('./app-url'), import('./post-notify')])
  const link = `${DASHBOARD_URL}${portalPostHref(String(input.client.share_token ?? '').trim(), input.post.id)}`
  if (input.via === 'link') return { delivered: [], failed: [], link }
  const sent = await sendClientRound({
    clientId: input.client.id,
    posts: [{ post_id: input.post.id, version: input.version, approve_by: input.approveBy }],
    emails: input.emails,
    note: input.note,
    pressedBy: { id: String(input.actor.id ?? ''), name: input.actor.name ?? null, email: String(input.actor.email ?? '') },
    // a reminder is its own email: `again` gives it its own outbox key, so it is not taken for the first
    // send and answered "duplicate" (which would count as delivered without anything going)
    ...(input.reminder ? { again: true, reminder: true } : {}),
  })
  if (!sent.ok) {
    console.error('client send refused:', input.post.id, sent.error)
    return { delivered: [], failed: [...input.emails], link }
  }
  return { delivered: sent.delivered, failed: sent.results.filter(r => !sent.delivered.includes(r.email)).map(r => r.email), link }
}
