import 'server-only'
import { randomUUID } from 'node:crypto'
import { table } from '@/lib/db'
import { announceAfter } from '@/lib/live'
import type {
  AssetVersion, Batch, Client, ContentItem, PublishJob as PublishJobRow,
  ScheduleNote, SocialAccount, SocialPost, TeamUserClient, WorkKind,
} from '@/lib/db-types'
import { NextResponse } from 'next/server'
import { AuthzError, authzErrorResponse, type TeamUser } from './authz'
import { mayPublish } from './identity-core'
import { accessibleClientIds, loadItemForUser } from './production-access'
import { scopeContextOf, visibleItems } from './scope-client'
import { actingRoles } from './workflow-core'
import { actOnPostingApproval } from './posting-approval'
import {
  mayApprovePost, maySendPostApproval, publishBlockReason, stateAfterPostEdit,
} from './posting-approval-core'
import { takeClaimLock, releaseClaimLock } from './claim-lock'
import { LIVE_JOB_STATUSES, publishLockKey, queuePublishJob } from './publish'
import { getPublisher } from './publisher'
import {
  isPlatform, validatePost,
  type MediaItem, type PostKind, type Platform, type PostOptions, type Target,
} from './publish-core'
import {
  isPostingNow, optionsFromExtras, readChannelExtras, type ChannelExtras,
} from './schedule-compose-core'
import {
  applySlideLimit, canReschedule, channelBlockReason,
  CLIENT_POLICY_UNREADABLE, CLIENT_SIGNS_OFF_REFUSAL, clientSignsOffEveryPost,
  coverForSlide, eligibility,
  mayEditNote, mayPostWithoutApproval, mirrorStatus, postingEligibility, validateComposition,
  type CoverSource, type Eligibility, type SocialPostStatus,
} from './social-schedule-core'
import {
  normaliseSlides, postSlides, slidesOf, slidesSatisfyType, type Slide,
} from './version-files-core'
import { addVersion, performTransition } from './workflow'
import { mirrorVersionSlides } from './gdrive-mirror'
import { previewVideos } from './stream'
import { ourStorageUrl } from './storage-core'
import { safeZone } from './timezone-core'
import { inngest } from '../inngest/client'

/**
 * The planned post, server side.
 *
 * A post exists BEFORE it is handed to the provider, because the owner's rule
 * is that nothing goes out unapproved: the composition sits in `social_posts`,
 * its approval IS the item's `posting_approval_state` (never a second state
 * machine beside it), and only an approved post may be booked.
 *
 * Everything here is a thin, testable wrapper over machinery that already
 * exists: `eligibility` and `validateComposition` (pure rules),
 * `actOnPostingApproval` (the approval and its notifications),
 * `queuePublishJob` (the provider hand-off and its one-live-job claim). The
 * only new invariants are stated as claims, never as check-then-write:
 *
 *   • one live post per item      — a claim lock keyed by the item
 *   • one hand-over per post      — a claim on the post's own status
 *   • one winner on a reschedule  — the same claim, again
 */

/* ── plumbing ───────────────────────────────────────────────────────────── */

const posts = () => table<SocialPost>('social_posts')
const notes = () => table<ScheduleNote>('schedule_notes')
const jobs = () => table<PublishJobRow>('publish_jobs')

/** One live post per content item — the relationship the design calls "one
 *  post ↔ one item", which spans rows and so cannot be a compare-and-set. */
const postLockKey = (itemId: string) => `social_post__${itemId}`

/** A refusal that carries every problem at once, so the composer can list
 *  them rather than revealing them one at a time. */
export class ComposeError extends AuthzError {
  problems: string[]
  constructor(problems: string[], status = 400) {
    super(problems[0] ?? 'This post is not ready yet', status)
    this.problems = problems
  }
}

const nowIso = () => new Date().toISOString()

/** A column the generator does not know about yet, read tolerantly — the same
 *  posture `readPostingApproval` takes on the item page. */
const readStamp = (row: object, key: string): string | null => {
  const v = (row as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : null
}

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/**
 * The composer's per-channel overrides, read tolerantly off the stored json.
 *
 * Everything here has to survive BOTH ways: what this drops is what the
 * composer's "More options" collect and the provider never receives — a
 * control that silently does nothing, which is worse than not having it.
 */
export type PerChannel = Record<string, ChannelExtras>

/**
 * Read the composer's per-channel overrides off the stored json.
 *
 * ONE reader, shared with the window itself (`readChannelExtras`). It used to
 * be two, and they disagreed: what the window kept, the server dropped, so a
 * setting collected on screen never reached Zernio — a control that silently
 * does nothing, which is worse than not having it. A second copy of this list
 * is the bug, so there is no second copy.
 */
const readPerChannel = (v: unknown): PerChannel => readChannelExtras_(v)

const readChannelExtras_ = (v: unknown): PerChannel => {
  const out: PerChannel = {}
  for (const [k, raw] of Object.entries(asObject(v))) out[k] = readChannelExtras(raw)
  return out
}

/** The one shape every screen and every route reads a post as. */
export type PlannedPost = SocialPost & {
  slides: Slide[]
  channels: string[]
  per_channel: PerChannel
  publish_job_ids: string[]
}

const shape = (row: SocialPost): PlannedPost => ({
  ...row,
  slides: asArray<Slide>(row.slides),
  channels: asArray<string>(row.channels).map(String),
  per_channel: readPerChannel(row.per_channel),
  publish_job_ids: asArray<string>(row.publish_job_ids).map(String),
})

/* ── who may do what ────────────────────────────────────────────────────── */

/**
 * May this person compose — create, edit, send for approval?
 *
 * The scheduling hats plus the account manager, and an EDITOR only on an item
 * that is theirs. `actingRoles` is what decides "theirs", so the answer here
 * and the answer `actOnPostingApproval` gives cannot drift apart.
 */
export function mayCompose(user: TeamUser, item: { owner_id?: string | null; scheduler_ids?: unknown }): boolean {
  if (user.role === 'super_admin' || user.role === 'account_manager' || user.role === 'scheduler') return true
  if (user.role === 'client') return false
  return maySendPostApproval(actingRoles({ id: user.id, role: user.role }, item))
}

function assertCompose(user: TeamUser, item: ContentItem): void {
  if (!mayCompose(user, item)) {
    throw new AuthzError('Only the people scheduling this client can change this post', 403)
  }
}

/**
 * MAY THIS PERSON POST WITH NO APPROVAL STEP IN THE WAY? (ruled 5 Sep 2026)
 *
 * The client's account manager, or a super admin — read off the hats they
 * wear on THIS item, so an editor handed the scheduling of a piece does not
 * inherit the manager's signature with it. A client whose contract says they
 * see every post first turns it off for everybody.
 *
 * The answer decides two things and nothing else: which media this person may
 * build a post out of (`eligibleFor`), and whether the app performs the two
 * approvals for them when the post goes out. Every state the post passes
 * through is the ordinary one.
 */
async function mayPostStraightOut(user: TeamUser, item: ContentItem): Promise<boolean> {
  return mayPostWithoutApproval(
    actingRoles({ id: user.id, role: user.role }, item),
    await clientSignsOff(item.client_id),
  )
}

/**
 * `clients.client_approval_required`, explicitly true — AND IT FAILS CLOSED.
 *
 * A client we cannot READ used to be treated as the ordinary arrangement,
 * which meant a dropped connection answered "go ahead" to the one question
 * protecting the one client who insisted on seeing every post first. So a
 * read that throws is a refusal, in a sentence that says it is our fault.
 *
 * A client row that is genuinely ABSENT is a different answer: there is no
 * policy on file to honour, and every other gate still applies.
 */
async function clientSignsOff(clientId: string): Promise<boolean> {
  let client: Client | null
  try {
    client = await table<Client>('clients').get(clientId)
  } catch {
    throw new AuthzError(CLIENT_POLICY_UNREADABLE, 503)
  }
  return clientSignsOffEveryPost(client)
}

/** The media this person may build a post out of. */
async function eligibleFor(
  user: TeamUser, item: ContentItem, versions: readonly AssetVersion[],
): Promise<Eligibility> {
  return postingEligibility(item, versions, await mayPostStraightOut(user, item))
}

function assertMayPublish(user: TeamUser): void {
  if (!mayPublish(user.role)) {
    throw new AuthzError('Only a scheduler or an account manager can book a post to go out', 403)
  }
}

/**
 * Refuse a client this person is not on.
 *
 * -- WHO THIS ACTUALLY BINDS, AND WHO IT DOES NOT (ruled 4 Sep 2026) --
 *
 * Account managers and editors: bound to the clients they are assigned to.
 * Schedulers and super admins: NOT bound, and deliberately so.
 * `accessibleClientIds` answers `null` for them because those two roles are
 * scoped by STATUS rather than by client — a scheduler sees every piece that
 * has reached scheduling, whoever it belongs to, which is how the production
 * board, the Editor page and the Scheduler page have all worked since 26
 * August. Binding them here and nowhere else would give the app two different
 * answers to "whose work is this", and the one nobody expects is the one that
 * loses somebody's afternoon.
 *
 * So a sentence like "a scheduler on client A cannot touch client B" is NOT
 * what this guarantees, and no comment on this branch should claim it does.
 * What it guarantees is that a person scoped BY CLIENT stays inside their
 * clients — which is the hole every route on this branch was opened for.
 *
 * If schedulers are ever meant to be client-bound, this is the one function
 * to change: every route in the feature asks it, so they would all move
 * together.
 */
export async function assertClientAccess(user: TeamUser, clientId: string): Promise<void> {
  const ids = await accessibleClientIds(user)
  if (ids !== null && !ids.includes(clientId)) {
    throw new AuthzError('That client is not one of yours', 403)
  }
}

/** Every refusal in this feature, turned into a response — a compose problem
 *  keeps its whole list, so the composer can show all of them at once. */
export function scheduleErrorResponse(e: unknown): NextResponse {
  if (e instanceof ComposeError) {
    return NextResponse.json({ error: e.message, problems: e.problems }, { status: e.status })
  }
  const { error, status } = authzErrorResponse(e)
  return NextResponse.json({ error }, { status })
}

/* ── loading ────────────────────────────────────────────────────────────── */

/** One post, with the item it belongs to — scoped by the item's own access
 *  rules, so a post can never be a way around them. */
export async function loadPostForUser(
  user: TeamUser, id: string,
): Promise<{ post: PlannedPost; item: ContentItem }> {
  const row = await posts().get(id)
  if (!row) throw new AuthzError('That post no longer exists', 404)
  const item = await loadItemForUser(user, row.item_id)
  return { post: shape(row), item }
}

async function versionsOf(itemId: string): Promise<AssetVersion[]> {
  return table<AssetVersion>('asset_versions').list({ where: v => v.item_id === itemId })
}

/**
 * THIS post's jobs -- the ones it queued itself, named in `publish_job_ids`.
 *
 * Never "every job on the item". An item can carry a second post after the
 * first was cancelled (cancelling releases the one-post-per-item lock), and
 * matching by item made the old post's cancelled job speak for the new one:
 * `mirrorStatus` reads "every job cancelled" and marks a brand-new draft
 * `cancelled` without anybody cancelling it. The id list is written on every
 * queue and emptied whenever a hand-over is rolled back, so it is the honest
 * answer to "what is out there for this post".
 */
async function jobsOf(post: { publish_job_ids?: unknown }): Promise<PublishJobRow[]> {
  const ids = asArray<string>(post.publish_job_ids).map(String)
  if (ids.length === 0) return []
  return jobs().list({ where: j => ids.includes(j.id) })
}

/**
 * The status a post really wears, from the item, its own jobs, and two facts
 * `mirrorStatus` cannot see because they are about THIS post rather than the
 * item's approval:
 *
 *   • A post nobody has SENT is a draft, whatever the item's gate says. The
 *     gate is shared with whatever was sent before — cancel an approved post,
 *     start a new one on the same item, and the item still reads 'approved'.
 *     Mirroring that onto the new composition would hand it an approval
 *     nobody gave for these words and these pictures, and let it be booked in
 *     without anybody looking at it.
 *   • A post somebody CANCELLED stays cancelled. It has been taken off the
 *     calendar by a person; an approval arriving on the item afterwards must
 *     not raise it from the dead.
 */
function statusOf(
  item: ContentItem | null,
  post: { status?: string | null; sent_at?: string | null },
  ownJobs: readonly PublishJobRow[],
): SocialPostStatus {
  if (post.status === 'cancelled') return 'cancelled'
  if (!post.sent_at && ownJobs.length === 0) return 'draft'
  return mirrorStatus(item, post, ownJobs)
}

async function zoneOf(clientId: string, given?: string | null): Promise<string> {
  if (given) return safeZone(given)
  const client = await table<Client>('clients').get(clientId).catch(() => null)
  return safeZone((client?.timezone as string | null) ?? null)
}

/** The client's connected accounts, by id — a channel that is not this
 *  client's, or not connected, is not a channel. */
async function channelsFor(clientId: string, ids: readonly string[]): Promise<SocialAccount[]> {
  if (ids.length === 0) return []
  const rows = await table<SocialAccount>('social_accounts')
    .list({ where: a => a.client_id === clientId && ids.includes(a.id) })
  const missing = ids.filter(id => !rows.some(r => r.id === id))
  if (missing.length > 0) {
    throw new ComposeError(['One of the channels is not connected any more — pick it again'])
  }
  const off = rows.filter(r => r.active === false)
  if (off.length > 0) {
    throw new ComposeError([
      `${off[0].name ?? off[0].platform} needs reconnecting before a post can go to it`,
    ])
  }
  return rows
}

/* ── validation ─────────────────────────────────────────────────────────── */

const mediaOf = (slides: readonly Slide[]): MediaItem[] =>
  slides.map(s => ({ url: s.url, type: s.type === 'video' ? 'video' : 'image' }))

/**
 * Everything wrong with this post, composition rules and provider rules
 * together, in one list.
 *
 * `validateComposition` is the sentence somebody sees while typing;
 * `validatePost` is what the provider would refuse. Both run, because the
 * second knows about Reels and documents and the first does not.
 */
function problemsWith(input: {
  item: ContentItem
  version: AssetVersion | null
  slides: Slide[]
  caption: string
  accounts: SocialAccount[]
  perChannel: PerChannel
  scheduledFor: string | null
  /** this person may post with no approval step in the way, so "still with
   *  the client" is not a problem to hand back to them */
  withoutApproval?: boolean
}): string[] {
  const problems = validateComposition({
    item: input.item,
    version: input.version,
    slides: input.slides,
    caption: input.caption,
    channels: input.accounts.map(a => ({ id: a.id, platform: a.platform })),
    scheduledFor: input.scheduledFor,
    withoutApproval: input.withoutApproval,
    now: nowIso(),
  }).problems.slice()

  const platforms = input.accounts.map(a => a.platform).filter(isPlatform)
  if (platforms.length > 0 && input.slides.length > 0) {
    const kinds: Partial<Record<Platform, PostKind>> = {}
    const mediaByPlatform: Partial<Record<Platform, MediaItem[]>> = {}
    const captionByPlatform: Partial<Record<Platform, string>> = {}
    const optionsByPlatform: Partial<Record<Platform, PostOptions>> = {}
    for (const account of input.accounts) {
      if (!isPlatform(account.platform)) continue
      const own = input.perChannel[account.id]
      if (own?.kind) kinds[account.platform] = own.kind as PostKind
      if (own?.slides?.length) mediaByPlatform[account.platform] = mediaOf(own.slides)
      if (own?.caption?.trim()) captionByPlatform[account.platform] = own.caption
      // every channel gets an entry, even an empty one: TikTok's tick is
      // missing exactly when nobody opened the options
      optionsByPlatform[account.platform] = optionsFromExtras(own)
    }
    for (const issue of validatePost({
      caption: input.caption,
      media: mediaOf(input.slides),
      platforms,
      kinds,
      mediaByPlatform,
      captionByPlatform,
      optionsByPlatform,
    })) {
      problems.push(`${issue.platform}: ${issue.problem}`)
    }
  }
  return [...new Set(problems)]
}

/**
 * The media a post may carry: the files the client actually approved.
 *
 * A caller may choose a SUBSET of the approved version's slides and put them
 * in any order, but never a URL that is not in it — that is the whole promise
 * of "only approved media gets posted", and it is enforced here rather than
 * trusted to the screen that draws the picker.
 */
function chooseSlides(approved: Slide[], chosen: unknown): Slide[] {
  if (!Array.isArray(chosen)) return approved
  const byUrl = new Map(approved.map(s => [s.url, s]))
  const out: Slide[] = []
  for (const raw of chosen) {
    const url = String((raw as { url?: unknown })?.url ?? '')
    const match = byUrl.get(url)
    if (!match) {
      throw new ComposeError([
        'One of those files is not part of the approved version — pick from the approved media',
      ])
    }
    out.push(match)
  }
  return out
}

/* ── create ─────────────────────────────────────────────────────────────── */

export type CreatePostInput = {
  item_id: string
  slides?: unknown
  caption?: string | null
  channels?: unknown
  per_channel?: unknown
  scheduled_for?: string | null
  timezone?: string | null
}

/**
 * Start a post from an item the client has already approved.
 *
 * The post lands as a DRAFT: nothing is asked of anybody until it is sent for
 * approval. Composition is checked as far as it can be — a draft with no
 * channel chosen yet is a normal thing to save — and checked in full at
 * `sendForApproval`, which is the door that matters.
 */
export async function createPost(user: TeamUser, input: CreatePostInput): Promise<PlannedPost> {
  const item = await loadItemForUser(user, String(input.item_id ?? ''))
  assertCompose(user, item)

  // an account manager may build a post out of media the client has not seen
  // yet — the approval happens for them when the post goes out
  const elig = await eligibleFor(user, item, await versionsOf(item.id))
  if (!elig.ok) throw new ComposeError([elig.reason])

  const slides = chooseSlides(elig.slides, input.slides)
  const channelIds = asArray<unknown>(input.channels).map(String)
  const accounts = await channelsFor(item.client_id, channelIds)
  const perChannel = readPerChannel(input.per_channel)
  const caption = String(input.caption ?? '')
  const scheduledFor = input.scheduled_for ? String(input.scheduled_for) : null

  // a half-made draft is allowed; a post with real content in it is judged
  if (accounts.length > 0 && slides.length > 0) {
    const problems = problemsWith({
      item, version: (elig.version as AssetVersion) ?? null,
      slides, caption, accounts, perChannel, scheduledFor,
      // media this person may post before the client has seen it is not a
      // problem to hand back to them — the sign-off travels with the post
      withoutApproval: elig.needsClientApproval,
    })
    if (problems.length > 0) throw new ComposeError(problems)
  }

  return insertPost(user, item, {
    slides,
    caption,
    channels: accounts.map(a => a.id),
    perChannel,
    scheduledFor,
    timezone: input.timezone ?? null,
    version: (elig.version as AssetVersion) ?? null,
  })
}

/**
 * THE POST ROW ITSELF — one writer, two ways in.
 *
 * `createPost` above (a piece that already exists and whose media the client
 * has signed off) and `startPostOnItem` below (a file somebody just uploaded,
 * with the piece made for them) both land here, so the one-post-per-item
 * claim, the shape of the row and the announcement cannot drift apart.
 */
async function insertPost(
  user: TeamUser,
  item: ContentItem,
  input: {
    slides: Slide[]
    caption: string
    channels: string[]
    perChannel: PerChannel
    scheduledFor: string | null
    timezone: string | null
    version: AssetVersion | null
  },
): Promise<PlannedPost> {
  const id = randomUUID()
  // one live post per item. The lock is handed on the moment the post it
  // names stops being live (cancelled, or gone), so nothing is ever blocked
  // forever by a post nobody kept.
  const gate = await takeClaimLock(postLockKey(item.id), id, async holder => {
    const held = await posts().get(holder)
    return !!held && held.status !== 'cancelled'
  })
  if (!gate.ok) {
    throw new AuthzError('This item already has a post — open that one instead of starting a second', 409)
  }

  const stamp = nowIso()
  try {
    const row = await posts().insert({
      id,
      client_id: item.client_id,
      item_id: item.id,
      version_id: input.version?.id ?? null,
      version_number: input.version?.version_number ?? null,
      slides: input.slides,
      caption: input.caption,
      per_channel: input.perChannel,
      channels: input.channels,
      scheduled_for: input.scheduledFor,
      timezone: await zoneOf(item.client_id, input.timezone),
      status: 'draft' satisfies SocialPostStatus,
      publish_job_ids: [],
      created_by: user.id,
      created_at: stamp,
      updated_at: stamp,
      sent_at: null,
      approved_at: null,
      approved_by: null,
      note: null,
    } as unknown as SocialPost)
    announceAfter('schedule', { client_id: item.client_id, post_id: row.id, kind: 'created' })
    return shape(row)
  } catch (e) {
    await releaseClaimLock(postLockKey(item.id), id).catch(() => {})
    throw e instanceof AuthzError ? e : new AuthzError(
      e instanceof Error ? e.message : 'Could not start this post', 500,
    )
  }
}

/**
 * START A POST ON A PIECE THIS REQUEST JUST MADE.
 *
 * The one caller is `createPostFromFiles`: somebody uploaded a file, the piece
 * behind it was created for them a few lines earlier, and the version they
 * uploaded IS its latest version.
 *
 * IT DELIBERATELY DOES NOT ASK `postingEligibility`. That question is "has the
 * client signed this media off", and on a brand-new upload the answer is being
 * decided in the same request: an account manager's piece has just travelled
 * to `approved_for_scheduling` and a scheduler's is waiting at
 * `internal_review`, which is precisely the state the composer then shows as
 * "waiting for approval". Refusing to hold the draft at all would only make
 * the upload vanish. Nothing about the PUBLISH gate moves: `publishBlockReason`
 * and `sendForApproval`/`scheduleWithoutApproval` judge the item exactly as
 * they do for every other post, so a piece nobody has approved still cannot go
 * out.
 */
export async function startPostOnItem(
  user: TeamUser,
  item: ContentItem,
  input: {
    slides: Slide[]
    version: AssetVersion | null
    caption?: string | null
    scheduled_for?: string | null
    timezone?: string | null
  },
): Promise<PlannedPost> {
  assertCompose(user, item)
  return insertPost(user, item, {
    slides: input.slides,
    caption: String(input.caption ?? ''),
    channels: [],
    perChannel: {},
    scheduledFor: input.scheduled_for ? String(input.scheduled_for) : null,
    timezone: input.timezone ?? null,
    version: input.version,
  })
}

/* ── edit ───────────────────────────────────────────────────────────────── */

export type UpdatePostInput = {
  slides?: unknown
  caption?: string | null
  channels?: unknown
  per_channel?: unknown
  scheduled_for?: string | null
  note?: string | null
}

const SETTLED: string[] = ['published', 'failed', 'cancelled']

/**
 * Change a post that has not gone out.
 *
 * A change to the WORDS OR MEDIA of an APPROVED post takes the approval
 * back: the yes was given to something that no longer exists, so it has to be
 * asked for again. `stateAfterPostEdit` is the one place that rule lives, and
 * the item's own state is what moves — the post only ever mirrors it.
 *
 * Moving the TIME is not a content change and keeps the approval, which is
 * what makes dragging an approved tile on the calendar sane.
 */
export async function updatePost(
  user: TeamUser, id: string, input: UpdatePostInput,
): Promise<PlannedPost> {
  const { post, item } = await loadPostForUser(user, id)
  assertCompose(user, item)

  if (SETTLED.includes(post.status)) {
    throw new AuthzError('This post is finished — start a new one instead of changing it', 409)
  }
  if (post.status === 'scheduled') {
    throw new AuthzError(
      'This post is already booked with the channel — cancel it first, then change it', 409,
    )
  }

  /**
   * A DRAFT MAY BE WRITTEN WHILE THE PIECE IS STILL BEING CHECKED.
   *
   * `postingEligibility` answers "may this go OUT". Asked here, it also stopped
   * somebody typing a caption while a manager looked at the media — and that
   * is exactly where a post made from a fresh upload starts life: the file is
   * saved as version 1 and the piece is waiting for the manager's check. A
   * composer that refuses to keep the words somebody just typed is how an
   * upload gets lost.
   *
   * So the answer is used for ONE thing — which files may be named on the post
   * — and the item's latest version stands in when the client has not signed
   * anything off yet. Nothing about publishing moves: `sendForApproval`,
   * `scheduleWithoutApproval` and `publishBlockReason` all ask the same
   * questions they always did, and a piece nobody has approved still cannot go
   * out.
   */
  const versions = await versionsOf(item.id)
  const elig = await eligibleFor(user, item, versions)
  const latest = versions.reduce<AssetVersion | null>(
    (best, v) => (Number(v.version_number ?? 0) > Number(best?.version_number ?? 0) ? v : best), null)
  const editableVersion = elig.ok ? (elig.version as AssetVersion) : latest
  const editableSlides = elig.ok
    ? elig.slides
    : postSlides(item.content_type as string, slidesOf(latest))
  if (editableSlides.length === 0) {
    throw new ComposeError([elig.ok ? 'No media yet' : elig.reason])
  }

  const slides = input.slides === undefined
    ? post.slides
    : chooseSlides(editableSlides, input.slides)
  const caption = input.caption === undefined ? String(post.caption ?? '') : String(input.caption ?? '')
  const channelIds = input.channels === undefined
    ? post.channels
    : asArray<unknown>(input.channels).map(String)
  const accounts = await channelsFor(item.client_id, channelIds)
  const perChannel = input.per_channel === undefined ? post.per_channel : readPerChannel(input.per_channel)
  const scheduledFor = input.scheduled_for === undefined
    ? post.scheduled_for
    : (input.scheduled_for ? String(input.scheduled_for) : null)

  if (accounts.length > 0 && slides.length > 0) {
    const problems = problemsWith({
      item, version: editableVersion,
      slides, caption, accounts, perChannel, scheduledFor,
      // media this person may post before the client has seen it is not a
      // problem to hand back to them — the sign-off travels with the post,
      // and saving a draft is never the moment to argue about it
      withoutApproval: elig.ok ? elig.needsClientApproval : true,
    })
    if (problems.length > 0) throw new ComposeError(problems)
  }

  const contentChanged =
    JSON.stringify(slides) !== JSON.stringify(post.slides)
    || caption !== String(post.caption ?? '')
    || JSON.stringify(channelIds) !== JSON.stringify(post.channels)
    || JSON.stringify(perChannel) !== JSON.stringify(post.per_channel)

  // the approval moves FIRST: the item is the record, and a post claiming
  // "waiting on approval" over an item still marked approved would be a lie
  // the publish gate believes.
  let state = item.posting_approval_state
  if (contentChanged) {
    const revert = stateAfterPostEdit(item.posting_approval_state)
    if (revert) {
      const taken = await table<ContentItem>('content_items').claim(item.id, cur =>
        cur && cur.posting_approval_state === 'approved'
          ? {
            ...cur, posting_approval_state: revert,
            posting_approved_by: null, posting_approved_at: null,
          }
          : null)
      if (taken.claimed) state = revert
      else state = taken.current?.posting_approval_state ?? state
    }
  }

  const next = statusOf({ ...item, posting_approval_state: state } as ContentItem, post, [])
  const patch: Partial<SocialPost> = {
    slides: slides as unknown as SocialPost['slides'],
    caption,
    channels: channelIds as unknown as SocialPost['channels'],
    per_channel: perChannel as unknown as SocialPost['per_channel'],
    scheduled_for: scheduledFor,
    status: next,
    updated_at: nowIso(),
    ...(input.note === undefined ? {} : { note: input.note ? String(input.note) : null }),
  }

  // only a post still sitting where this person saw it is written: two
  // editors saving at once resolve to one answer, not a silent overwrite
  const saved = await posts().claim(id, cur =>
    cur && cur.status === post.status ? { ...cur, ...patch } as SocialPost : null)
  if (!saved.claimed) {
    throw new AuthzError('Somebody changed this post while you were editing — refresh to see it', 409)
  }
  announceAfter('schedule', { client_id: item.client_id, post_id: id, kind: 'updated' })
  return shape(saved.row)
}

/* ── media the client has not seen yet ──────────────────────────────────── */

export type AddMediaResult = {
  version_number: number
  slides: Slide[]
  /** the item's status after this — 'client_review' when it went back */
  status: string
  /** did this actually make a version, or was it only a reorder? */
  created: boolean
  /** the one sentence to show in the composer */
  message: string
}

/**
 * Put media into a post that did NOT come from the approved version.
 *
 * The composer's picker can reach a Google Drive file or an upload from
 * somebody's laptop. Neither has been seen by the client, and the whole point
 * of this feature is that only media the client approved goes out — so
 * neither is quietly slipped into the post. Instead:
 *
 *   1. the post's media, in the order it was arranged, becomes a NEW VERSION
 *      of the item — the same `addVersion` the item page uses, so the
 *      numbering, the Drive mirror and the video preview all happen as usual;
 *   2. the piece goes back to the client for approval through the ordinary
 *      state machine (`approved_for_scheduling → client_review`, the `auto`
 *      edge — nobody presses a button called that);
 *   3. the post keeps the media on it as a DRAFT, so the window still shows
 *      what was arranged rather than emptying itself, and the final-post gate
 *      is reset because the yes it holds was given to different pictures.
 *
 * The composer then shows "Waiting for approval" until the client signs the
 * new version off, which is exactly what the picker's footer said would
 * happen.
 *
 * -- ONLY A GENUINELY NEW FILE MAKES A VERSION --
 *
 * The trigger is a FILE THIS ITEM HAS NEVER HELD, judged against every
 * version of it -- not against "the approved version", which is empty the
 * moment the piece goes back to the client. Without that, reopening the
 * picker to drag one slide left made v5, dragging it back made v6, each with
 * its own Drive mirror and its own encode, and the client's portal filled
 * with versions that differed only in slide order. A reorder or a removal is
 * an edit of the post and nothing more.
 */
export async function addMediaVersion(
  user: TeamUser,
  input: { item_id: string; post_id?: string | null; files: unknown },
): Promise<AddMediaResult> {
  const item = await loadItemForUser(user, String(input.item_id ?? ''))
  assertCompose(user, item)

  const slides = normaliseSlides(input.files)
  if (slides.length === 0) throw new ComposeError(['Pick at least one photo or video'])

  /**
   * EVERY file the caller offered, including the ones the slide cap dropped.
   *
   * `normaliseSlides` stops at `MAX_SLIDES`, which is right for what gets
   * SAVED and wrong for what gets tidied up: a file past the tenth was
   * uploaded, is referenced by nothing, and would be left in the bucket for
   * ever because the list that decides the tidy-up had already forgotten it.
   * Read one entry at a time through the same reader, so the cap cannot apply
   * and there is still only one definition of what a slide is.
   */
  const offered: Slide[] = []
  const seen = new Set<string>()
  for (const entry of asArray<unknown>(input.files)) {
    for (const slide of normaliseSlides([entry])) {
      if (seen.has(slide.url)) continue
      seen.add(slide.url)
      offered.push(slide)
    }
  }

  // every file this item has EVER held, across every version -- the honest
  // test of "has the client ever been shown this picture"
  const versions = await versionsOf(item.id)
  const known = new Set(versions.flatMap(v => slidesOf(v).map(s => s.url)))
  const fresh = slides.filter(s => !known.has(s.url))

  /**
   * THE UPLOAD IS ALREADY IN THE BUCKET BY THE TIME THIS RUNS.
   *
   * The picker uploads a file the moment it is chosen and only then asks the
   * server to make a version of it, so a refusal here — a video dropped into
   * a piece that is a photo, a version write that failed — leaves bytes
   * nothing will ever point at. The same tidy-up the crop endpoint does, with
   * the same discipline about WHAT may be deleted (see `image-derive.ts`):
   *
   *  • the item and this person's right to change it are settled ABOVE this
   *    line, so a refusal that has nothing to do with the files cannot reach
   *    it;
   *  • only a file that is genuinely NEW to this item is a candidate — a
   *    caller naming a file the client already approved gets it left exactly
   *    where it is;
   *  • but EVERY file offered is considered, not only the ones that survived
   *    the slide cap, because a file the cap dropped is the most orphaned of
   *    the lot;
   *  • and only a file on our own storage, checked by the same guard, so a
   *    URL pointing anywhere else is not something we would delete.
   *
   * Best effort throughout: a failed tidy-up must never turn into a failed
   * save.
   */
  const tidyUp = async () => {
    // imported here rather than at the top: `./storage` pulls in the whole S3
    // client, and this module is on the path of every schedule route
    const { deleteStoredObject, publicBase } = await import('./storage')
    const base = publicBase()
    if (!base) return
    // "held by ANY version of ANY piece" — the versions table is read whole
    // anyway (lib/db.ts lists the node and filters here), so this costs
    // nothing beyond the read that already happened, and it is what makes a
    // pasted URL belonging to somebody else's piece safe from this.
    const everywhere = new Set(
      (await table<AssetVersion>('asset_versions').list().catch(() => []))
        .flatMap(v => slidesOf(v).map(sl => sl.url)))
    for (const slide of offered) {
      if (known.has(slide.url)) continue
      if (everywhere.has(slide.url)) continue
      const ours = ourStorageUrl(slide.url, base, slide.type === 'video' ? 'video' : 'image')
      if (ours) await deleteStoredObject(ours).catch(() => {})
    }
  }

  try {
    return await writeMediaVersion(user, item, input, slides, versions, fresh)
  } catch (e) {
    await tidyUp().catch(() => {})
    throw e
  }
}

async function writeMediaVersion(
  user: TeamUser,
  item: ContentItem,
  input: { item_id: string; post_id?: string | null; files: unknown },
  slides: Slide[],
  versions: AssetVersion[],
  fresh: Slide[],
): Promise<AddMediaResult> {
  const shapeProblem = slidesSatisfyType(item.content_type as string, slides)
  if (shapeProblem) throw new ComposeError([shapeProblem])

  const postId = input.post_id ? String(input.post_id) : null
  const stamp = nowIso()

  // -- nothing new: this is an edit of the post, not a version --
  if (fresh.length === 0) {
    if (postId) await claimPostSlides(postId, item.id, slides, null, null, stamp)
    announceAfter('schedule', { client_id: item.client_id, item_id: item.id, kind: 'media' })
    const current = versions.reduce((n, v) => Math.max(n, Number(v.version_number ?? 0)), 0)
    return {
      version_number: current,
      slides,
      status: String(item.status),
      created: false,
      message: 'Saved. Nothing new was added, so the client does not need to look again.',
    }
  }

  const version = await addVersion(user, item.id, { file_url: slides[0].url, files: slides })
  const number = Number(version.version_number ?? 0)
  mirrorVersionSlides(item.id, number, slides)
  previewVideos(slides.map(s => s.url))

  // back to the client. Best-effort and never fatal: the version is saved
  // either way, and a piece that stayed put is a piece somebody can still
  // send by hand — losing the upload would not be recoverable.
  let status = String(item.status)
  if (status === 'approved_for_scheduling') {
    try {
      // `auto: true` -- this edge is the app's own move; nobody may press it
      const moved = await performTransition(user, item as never, 'client_review', { auto: true })
      status = String((moved as { status?: string }).status ?? status)
    } catch (e) {
      console.error('new media on an approved piece — could not send it back:', e)
    }
  }

  // the final-post sign-off was given to media that is no longer the media
  const resetTo = stateAfterPostEdit(
    (item as unknown as Record<string, unknown>).posting_approval_state)
  if (resetTo) {
    await table<ContentItem>('content_items').claim(item.id, cur =>
      cur?.posting_approval_state === 'approved'
        ? { ...cur, posting_approval_state: resetTo, posting_approved_by: null, posting_approved_at: null }
        : null).catch(() => ({ claimed: false }))
  }

  if (postId) {
    await claimPostSlides(postId, item.id, slides, version.id ?? null, number, stamp)
  }

  announceAfter('schedule', { client_id: item.client_id, item_id: item.id, kind: 'media' })

  return {
    version_number: number,
    slides,
    status,
    created: true,
    message: status === 'client_review'
      ? `Saved as version ${number}. The client has to approve it before this post can be sent.`
      : `Saved as version ${number}.`,
  }
}

/** The post keeps the arrangement. Claimed rather than read-then-written, and
 *  only while the post is still something a person could change. */
async function claimPostSlides(
  postId: string, itemId: string, slides: Slide[],
  versionId: string | null, versionNumber: number | null, stamp: string,
): Promise<void> {
  await posts().claim(postId, cur =>
    cur && cur.item_id === itemId
      && !SETTLED.includes(String(cur.status)) && cur.status !== 'scheduled'
      ? {
        ...cur,
        slides,
        ...(versionId === null ? {} : { version_id: versionId }),
        ...(versionNumber === null ? {} : { version_number: versionNumber }),
        // a NEW version un-sends the post; a reorder leaves it where it stood
        ...(versionNumber === null ? {} : { status: 'draft', sent_at: null }),
        updated_at: stamp,
      } as unknown as SocialPost
      : null)
}

/* ── approval ───────────────────────────────────────────────────────────── */

/**
 * Send the post for its final sign-off.
 *
 * The approval itself is `actOnPostingApproval` — the same call the item page
 * makes, with the same hat checks, the same emails and the same portal
 * behaviour. This adds the composition check in front of it (nobody should be
 * asked to approve a post that could not go out anyway) and mirrors the
 * answer onto the post.
 */
export async function sendForApproval(
  user: TeamUser, id: string,
  opts: { note?: string; client_too?: boolean; mode?: 'approval' | 'direct' } = {},
): Promise<PlannedPost> {
  if (opts.mode === 'direct') return scheduleWithoutApproval(user, id, opts.note)
  const { post, item } = await loadPostForUser(user, id)
  assertCompose(user, item)
  if (SETTLED.includes(post.status) || post.status === 'scheduled') {
    throw new AuthzError('This post has already been dealt with', 409)
  }

  const elig = eligibility(item, await versionsOf(item.id))
  if (!elig.ok) throw new ComposeError([elig.reason])
  const accounts = await channelsFor(item.client_id, post.channels)
  const problems = problemsWith({
    item, version: (elig.version as AssetVersion) ?? null,
    slides: post.slides, caption: String(post.caption ?? ''), accounts,
    perChannel: post.per_channel, scheduledFor: post.scheduled_for,
  })
  if (problems.length > 0) throw new ComposeError(problems)

  await actOnPostingApproval(user, item as never, {
    action: 'send',
    note: opts.note,
    client_too: opts.client_too,
  })

  // ONLY a post still sitting where this person saw it. The condition used to
  // be "anything that is not already pending", which let a post somebody else
  // had just BOOKED IN be dragged back to pending -- item and post both saying
  // "waiting on approval" over a job the provider was already holding, which
  // is the one outcome this whole gate exists to prevent.
  const stamp = nowIso()
  const saved = await posts().claim(id, cur =>
    cur && cur.status === post.status && cur.status !== 'pending'
      ? {
        ...cur, status: 'pending', sent_at: stamp,
        approval_mode: 'client', updated_at: stamp,
      } as SocialPost
      : null)
  if (!saved.claimed) {
    // a second click landing on an already-pending post is not an error: the
    // ask has been made, which is what the caller wanted
    const live = saved.current ?? await posts().get(id)
    if (live?.status !== 'pending') {
      throw new AuthzError(
        'This post moved on while you were sending it -- refresh to see where it got to', 409,
      )
    }
    announceAfter('schedule', { client_id: item.client_id, post_id: id, kind: 'sent' })
    return shape(live)
  }
  announceAfter('schedule', { client_id: item.client_id, post_id: id, kind: 'sent' })
  return shape(saved.row)
}

/**
 * Schedule a post without sending it out for final approval — the owner's
 * decision of 3 September.
 *
 * Only somebody who could have APPROVED it may skip the asking: the client's
 * account manager or a super admin, the same check `actOnPostingApproval`
 * makes on 'approve'. A scheduler or an editor gets the same refusal they
 * would get for approving.
 *
 * It goes THROUGH the state machine, never around it: send, then approve, as
 * this person — so the item page, the client portal, the publish lock and the
 * activity trail all see an ordinary approved post. The only thing suppressed
 * is the "please approve this" email, which would be this person asking
 * themselves. The post records how it was cleared (`approval_mode: 'self'`)
 * and who cleared it, so nobody has to guess later.
 *
 * The MEDIA's own sign-off travels with it (ruled 5 Sep 2026): a piece still
 * waiting on a signature is approved without the client here, on the ordinary
 * workflow edge and recorded against this person, so the two presses that used
 * to be asked for are one request. A piece still being MADE is not rescued by
 * anything — there is no edge, and the post refuses with the plain reason.
 */
export async function scheduleWithoutApproval(
  user: TeamUser, id: string, note?: string,
): Promise<PlannedPost> {
  const { post, item: loaded } = await loadPostForUser(user, id)
  let item = loaded
  assertCompose(user, item)
  if (!mayApprovePost(actingRoles({ id: user.id, role: user.role }, item))) {
    throw new AuthzError('Only an account manager (or the client) can approve the final post', 403)
  }
  // the client's own contract, checked before anything is written: on such a
  // client this path does not exist, for anybody
  if (await clientSignsOff(item.client_id)) {
    throw new AuthzError(CLIENT_SIGNS_OFF_REFUSAL, 403)
  }
  if (SETTLED.includes(post.status) || post.status === 'scheduled') {
    throw new AuthzError('This post has already been dealt with', 409)
  }

  /**
   * EVERYTHING THAT CAN REFUSE, BEFORE ANYTHING IS WRITTEN.
   *
   * The order here is the whole point. The media's own sign-off used to run
   * FIRST — a real transition, an activity line, an `approvals` row and a
   * notification fan-out — and only then was the composition checked. So a
   * caption one letter too long for LinkedIn, or a channel list that had
   * emptied since the window opened, left the piece signed off in the
   * manager's name, the team emailed, and no post: the person pressed
   * Schedule, saw an error, and reasonably believed nothing had happened.
   *
   * Judged with this person's own rights (`withoutApproval`), so "waiting on
   * your check" is not handed back to them as a problem — it is the thing
   * they are about to fix.
   */
  const versions = await versionsOf(item.id)
  const usable = postingEligibility(item, versions, true)
  if (!usable.ok) throw new ComposeError([usable.reason])

  const accounts = await channelsFor(item.client_id, post.channels)
  const problems = problemsWith({
    item, version: (usable.version as AssetVersion) ?? null,
    slides: post.slides, caption: String(post.caption ?? ''), accounts,
    perChannel: post.per_channel, scheduledFor: post.scheduled_for,
    withoutApproval: true,
  })
  if (problems.length > 0) throw new ComposeError(problems)

  /**
   * THE MEDIA'S OWN SIGN-OFF, PERFORMED RATHER THAN ASKED FOR.
   *
   * A manager posting a piece the client has not signed off used to press
   * "Approve without client" on the rail first. That press was this: the
   * ordinary `internal_review → approved_for_scheduling` edge, through
   * `performTransition`, recorded against them. Nothing is bypassed — the
   * edge, its role check, the client's policy and the activity line are all
   * the ones the button went through.
   *
   * A piece the client is looking at RIGHT NOW never arrives here: it is not
   * usable media on this path at all (`APPROVE_WITHOUT_CLIENT_STATUSES`), so
   * the check above has already refused it with "With the client now".
   */
  if (usable.needsClientApproval) {
    item = await performTransition(
      user, item as never, 'approved_for_scheduling', { note },
    ) as unknown as ContentItem
  }

  // the ask — written and logged, but nobody is emailed to answer a question
  // that is being answered in the same breath
  const asked = await actOnPostingApproval(user, item as never, {
    action: 'send', client_too: false, self_approved: true,
  })
  // …and the answer, from the person entitled to give it
  await actOnPostingApproval(user, { ...item, ...asked } as never, {
    action: 'approve', note,
  })

  const stamp = nowIso()
  const cleared = await posts().claim(id, cur =>
    cur && cur.status === post.status
      ? {
        ...cur, status: 'approved', sent_at: cur.sent_at ?? stamp,
        approval_mode: 'self', approved_by: user.id, approved_at: stamp,
        updated_at: stamp,
      } as SocialPost
      : null)
  // losing here and carrying on would leave a post that WAS cleared by a
  // person with `approval_mode` and `approved_by` unset, and the whole point
  // of those two columns is that nobody has to guess later who cleared it
  if (!cleared.claimed) {
    throw new AuthzError(
      'Somebody else was already dealing with this post -- refresh to see where it got to', 409,
    )
  }

  return schedulePost(user, id)
}

/**
 * Mirror an item's approval onto its post(s).
 *
 * Called after every approval action, wherever it came from: the item page,
 * the client portal, or this module. The post never holds an opinion of its
 * own — `mirrorStatus` reads the item and its jobs and says what the tile is.
 */
export async function syncFromItem(itemId: string): Promise<void> {
  const item = await table<ContentItem>('content_items').get(itemId).catch(() => null)
  if (!item) return
  const rows = await posts().list({ where: p => p.item_id === itemId }).catch(() => [])
  if (rows.length === 0) return

  for (const row of rows) {
    if (row.status === 'cancelled') continue
    const next = statusOf(item, row, await jobsOf(row))
    if (next === row.status) continue
    const stamp = nowIso()
    await posts().claim(row.id, cur =>
      cur && cur.status === row.status
        ? {
          ...cur,
          status: next,
          ...(next === 'approved'
            ? {
              approved_at: readStamp(item, 'posting_approved_at') ?? stamp,
              approved_by: readStamp(item, 'posting_approved_by'),
            }
            : {}),
          updated_at: stamp,
        } as SocialPost
        : null)
  }
  announceAfter('schedule', { client_id: item.client_id, item_id: itemId, kind: 'approval' })
}

/* ── booking it in ──────────────────────────────────────────────────────── */

/** The provider payload for one post: one target per channel, each carrying
 *  its own caption, kind and slides where the composer set them. */
export function targetsFor(
  post: PlannedPost,
  accounts: SocialAccount[],
  /** the item's versions, so a video whose cover somebody chose in the editor
   *  posts with that cover. Empty is not an error: a post with no cover
   *  anywhere behaves exactly as it did before covers existed. */
  versions: readonly CoverSource[] = [],
): Target[] {
  const out: Target[] = []
  for (const account of accounts) {
    if (!isPlatform(account.platform)) continue
    const own = post.per_channel[account.id] ?? {}
    const slides = own.slides?.length ? own.slides : post.slides
    const trimmed = applySlideLimit(slides, account.platform)
    // EVERY extra the composer collects, forwarded by one shared mapping
    // rather than field by field. Copying them by hand is exactly how
    // `locationId`, `firstComment`, `collaborators` and `shareToFeed` were
    // collected on screen, stored, and then dropped on the way to Zernio.
    // `toPlatformData` decides where each one is actually allowed — a
    // location goes to Instagram and never to a Story — so nothing here has
    // to know a platform's rules.
    const options: Target['options'] = optionsFromExtras(own)
    // a channel whose set differs from the shared one carries its own media
    if (JSON.stringify(trimmed) !== JSON.stringify(post.slides)) options.media = mediaOf(trimmed)
    // THE COVER THE EDITOR SAVED, under whatever this channel was given by
    // hand. Somebody who typed a thumbnail into the composer for YouTube meant
    // that one; the version's cover is the answer for everybody who did not,
    // and without this it was stored and never sent.
    if (!options.thumbnailUrl) {
      const cover = coverForSlide(trimmed[0]?.url, versions)
      if (cover) options.thumbnailUrl = cover
    }
    out.push({
      platform: account.platform,
      accountId: account.provider_account_id || account.id,
      ...(Object.keys(options).length > 0 ? { options } : {}),
    })
  }
  return out
}

/**
 * Hand an approved post to the provider.
 *
 * Three gates, in the order they matter: this person may publish, the ITEM is
 * signed off (`publishBlockReason`, the same sentence every other path uses),
 * and the post is still sitting at `approved` when the write lands. That last
 * one is a claim, so two clicks — or two people — produce exactly one set of
 * jobs.
 */
export async function schedulePost(user: TeamUser, id: string): Promise<PlannedPost> {
  assertMayPublish(user)
  // the tile may be looking at an approval that arrived elsewhere
  await syncFromItem((await posts().get(id))?.item_id ?? '').catch(() => {})
  const { post, item } = await loadPostForUser(user, id)

  const blocked = publishBlockReason(item.posting_approval_state)
  if (blocked) throw new AuthzError(blocked, 409)
  if (post.status !== 'approved') {
    throw new AuthzError(
      post.status === 'scheduled'
        ? 'This post is already booked to go out'
        : 'Send the post for approval first',
      409,
    )
  }

  const accounts = await channelsFor(item.client_id, post.channels)
  if (accounts.length === 0) throw new ComposeError(['Choose at least one channel'])
  const versions = await versionsOf(item.id)
  const elig = eligibility(item, versions)
  if (!elig.ok) throw new ComposeError([elig.reason])
  const problems = problemsWith({
    item, version: (elig.version as AssetVersion) ?? null,
    slides: post.slides, caption: String(post.caption ?? ''), accounts,
    perChannel: post.per_channel, scheduledFor: post.scheduled_for,
  })
  if (problems.length > 0) throw new ComposeError(problems)

  // ── the one winner ───────────────────────────────────────────────────
  const stamp = nowIso()
  const taken = await posts().claim(id, cur =>
    cur && cur.status === 'approved'
      ? { ...cur, status: 'scheduled', publish_job_ids: [], updated_at: stamp } as SocialPost
      : null)
  if (!taken.claimed) {
    throw new AuthzError('This post is already on its way out — refresh to see where it got to', 409)
  }

  /**
   * "POST NOW" HAS TO POST NOW.
   *
   * The composer labels the button "Post now" when the chosen time is within
   * two minutes, and the "Post now" menu item books a post for a minute's
   * time. Both then handed the provider a `scheduledFor` — a time that has
   * usually gone by the time the job is picked up — instead of saying
   * "publish". `buildPostBody` sends `publishNow: true` for a job with no
   * time on it, so the honest thing is to send no time.
   *
   * Only for a time that is genuinely NOW: a post booked for Thursday keeps
   * its Thursday, held by the provider's own scheduler exactly as before.
   */
  const rightNow = isPostingNow(post.scheduled_for, Date.now())

  const queued = await queuePublishJob({
    clientId: item.client_id,
    contentItemId: item.id,
    caption: String(post.caption ?? ''),
    media: mediaOf(post.slides),
    targets: targetsFor(post, accounts, versions),
    scheduledFor: rightNow ? null : post.scheduled_for,
    timezone: post.timezone,
    createdBy: user.email,
  })

  if ('error' in queued) {
    // put it back where it was: an approved post that could not be booked is
    // still an approved post, and the person is told why
    await posts().claim(id, cur =>
      cur && cur.status === 'scheduled'
        ? { ...cur, status: 'approved', publish_job_ids: [], updated_at: nowIso() } as SocialPost
        : null)
    throw new ComposeError([queued.error, ...(queued.issues ?? [])], queued.blocked ? 409 : 400)
  }

  const saved = await posts().update(id, {
    publish_job_ids: [queued.id] as unknown as SocialPost['publish_job_ids'],
    updated_at: nowIso(),
  })
  // the provider holds the schedule; the event only makes the hand-over
  // immediate, and a dropped one is picked up by the next dispatcher pass
  await inngest.send({ name: 'app/post.publish.requested', data: { jobId: queued.id } })
    .catch(e => console.error('schedule dispatch failed:', (e as Error).message))
  announceAfter('schedule', { client_id: item.client_id, post_id: id, kind: 'scheduled' })
  return shape(saved ?? (await posts().get(id))!)
}

/* ── moving and stopping ────────────────────────────────────────────────── */

/**
 * Pull one job back from the provider.
 *
 * The same order the job-keyed cancel route uses: the provider FIRST, because
 * a row that says "cancelled" over a post the provider will still publish is
 * the one outcome worth avoiding, and only then our own row — conditionally,
 * so a job that went out while we were asking is not overwritten.
 */
async function cancelJob(job: PublishJobRow): Promise<{ ok: true } | { ok: false; error: string }> {
  if (job.status === 'publishing') {
    return { ok: false, error: 'It is being sent right now — wait for it to finish, then delete the post at the channel' }
  }
  if (!['queued', 'scheduled'].includes(job.status)) return { ok: true }

  if (job.status === 'scheduled' && job.provider_post_id) {
    try {
      await getPublisher().deletePost(String(job.provider_post_id))
    } catch (e) {
      const why = e instanceof Error ? e.message : 'the channel would not cancel it'
      return { ok: false, error: `The channel would not let go of this post: ${why}. Open it at the channel and delete it there.` }
    }
  }
  const cancelled = await jobs().claim(job.id, cur =>
    cur && cur.status === job.status
      ? { ...cur, status: 'cancelled', error: null, updated_at: nowIso() } as PublishJobRow
      : null)
  if (!cancelled.claimed) {
    return { ok: false, error: 'It moved on while you were cancelling — refresh to see where it got to' }
  }
  if (job.content_item_id) {
    await releaseClaimLock(publishLockKey(String(job.content_item_id)), job.id).catch(() => {})
  }
  return { ok: true }
}

async function liveJobsOf(post: PlannedPost): Promise<PublishJobRow[]> {
  return (await jobsOf(post)).filter(j => LIVE_JOB_STATUSES.includes(j.status))
}

export type RescheduleResult =
  | { ok: true; post: PlannedPost; mode: 'move' | 'requeue' }
  /** `status` is the code the route should answer with; 409 unless it says */
  | { ok: false; error: string; status?: number }

/**
 * Move a post to another time.
 *
 * Two costs, and the caller is told which one it paid. A post nobody has
 * handed over yet is a write of one field. A post the provider is HOLDING has
 * to be pulled back and booked again — and when the provider will not let go,
 * the old time stands and the message says so rather than leaving a booking
 * nobody can see.
 */
export async function reschedule(user: TeamUser, id: string, iso: string): Promise<RescheduleResult> {
  const { post, item } = await loadPostForUser(user, id)
  const when = new Date(String(iso)).getTime()
  if (!Number.isFinite(when)) {
    // nothing is in conflict here: what arrived simply is not a time
    return {
      ok: false, status: 400,
      error: 'That is not a time we can read — pick one from the calendar',
    }
  }
  if (when <= Date.now()) return { ok: false, error: 'That time has already gone — pick a later one' }
  const at = new Date(when).toISOString()

  const move = canReschedule(post)
  if (!move.ok) return { ok: false, error: move.reason }

  if (move.mode === 'move') {
    assertCompose(user, item)
    const saved = await posts().claim(id, cur =>
      cur && cur.status === post.status
        ? { ...cur, scheduled_for: at, updated_at: nowIso() } as SocialPost
        : null)
    if (!saved.claimed) return { ok: false, error: 'Somebody moved this post while you were dragging it — refresh to see it' }
    announceAfter('schedule', { client_id: item.client_id, post_id: id, kind: 'moved' })
    return { ok: true, post: shape(saved.row), mode: 'move' }
  }

  // requeue: the provider is holding this post
  assertMayPublish(user)
  const live = await liveJobsOf(post)
  for (const job of live) {
    const pulled = await cancelJob(job)
    if (!pulled.ok) return { ok: false, error: pulled.error }
  }

  const [accounts, versions] = await Promise.all([
    channelsFor(item.client_id, post.channels),
    versionsOf(item.id),
  ])
  const queued = await queuePublishJob({
    clientId: item.client_id,
    contentItemId: item.id,
    caption: String(post.caption ?? ''),
    media: mediaOf(post.slides),
    targets: targetsFor(post, accounts, versions),
    scheduledFor: at,
    timezone: post.timezone,
    createdBy: user.email,
  })
  if ('error' in queued) {
    // the old booking is gone and the new one would not take: say so plainly
    // and leave the post approved, so it can be booked again
    await posts().claim(id, cur =>
      cur ? { ...cur, status: 'approved', publish_job_ids: [], updated_at: nowIso() } as SocialPost : null)
    return { ok: false, error: queued.error }
  }

  // the same one-winner rule the cancel step used: a `cancelPost` landing
  // between the queue and this write must not be overwritten by 'scheduled'
  const saved = await posts().claim(id, cur =>
    cur && cur.status === 'scheduled'
      ? {
        ...cur,
        scheduled_for: at,
        publish_job_ids: [queued.id],
        updated_at: nowIso(),
      } as SocialPost
      : null)
  if (!saved.claimed) {
    return {
      ok: false,
      error: 'This post changed while it was being moved — refresh to see where it got to',
    }
  }
  await inngest.send({ name: 'app/post.publish.requested', data: { jobId: queued.id } })
    .catch(e => console.error('reschedule dispatch failed:', (e as Error).message))
  announceAfter('schedule', { client_id: item.client_id, post_id: id, kind: 'moved' })
  return { ok: true, post: shape(saved.row), mode: 'requeue' }
}

/**
 * Take a post off the calendar.
 *
 * Anything the provider is holding is pulled back first, for the same reason
 * a reschedule does it: a cancelled tile over a live booking is worse than a
 * refusal. Cancelling frees the item to carry a new post.
 */
export async function cancelPost(user: TeamUser, id: string): Promise<PlannedPost> {
  const { post, item } = await loadPostForUser(user, id)
  assertCompose(user, item)
  if (post.status === 'published') {
    throw new AuthzError('This post has already gone out — delete it at the channel instead', 409)
  }

  const live = await liveJobsOf(post)
  if (live.length > 0) assertMayPublish(user)
  for (const job of live) {
    const pulled = await cancelJob(job)
    if (!pulled.ok) throw new AuthzError(pulled.error, 409)
  }

  const stamp = nowIso()
  const saved = await posts().claim(id, cur =>
    cur && cur.status !== 'cancelled'
      ? { ...cur, status: 'cancelled', updated_at: stamp } as SocialPost
      : null)

  // The approval belonged to THIS post, so it goes with it. Without this the
  // item is left saying 'approved' over a post nobody will ever send: the
  // next post on the item would inherit a yes given to different words, and
  // the ad-hoc composer would find the gate open for an item whose only
  // approved post was cancelled. Only when this post ever ASKED — cancelling
  // a draft nobody sent has no answer to take back.
  if (saved.claimed && post.sent_at) {
    await actOnPostingApproval(user, item as never, { action: 'reset' })
      .catch(e => console.error('approval reset failed:', (e as Error).message))
  }
  await releaseClaimLock(postLockKey(item.id), id).catch(() => {})
  announceAfter('schedule', { client_id: item.client_id, post_id: id, kind: 'cancelled' })
  return saved.claimed ? shape(saved.row) : shape(saved.current ?? (await posts().get(id))!)
}

/* ── reading the calendar ───────────────────────────────────────────────── */

export type ListedPost = PlannedPost & {
  /** what the tile actually says, item and jobs included */
  live_status: SocialPostStatus
  item_title: string | null
  block_reason: string | null
}

/**
 * Every post for one client in a date range, each carrying the status the
 * calendar should draw — never the stored one on its own, because an approval
 * or a job may have moved since it was written.
 */
export async function listPosts(input: {
  clientId: string
  from?: string | null
  to?: string | null
  /**
   * Who is asking. Optional only so the two internal callers that have already
   * proved access (and the tests) need not invent one; every ROUTE passes it,
   * and without it this returns the client's whole calendar.
   */
  viewer?: TeamUser | null
}): Promise<ListedPost[]> {
  const rows = await posts().list({ where: p => p.client_id === input.clientId })
  const inRange = rows.filter(p => {
    if (!p.scheduled_for) return true          // a draft with no time yet still belongs on the page
    if (input.from && p.scheduled_for < input.from) return false
    if (input.to && p.scheduled_for > input.to) return false
    return true
  })
  if (inRange.length === 0) return []

  const itemIds = [...new Set(inRange.map(p => p.item_id))]
  const [items, allJobs, accounts] = await Promise.all([
    table<ContentItem>('content_items').list({ where: i => itemIds.includes(i.id) }),
    jobs().list({ where: j => j.content_item_id != null && itemIds.includes(String(j.content_item_id)) }),
    // the channels, because a post whose account has been revoked is blocked
    // by a fact about the ACCOUNT, not about the item — and the calendar and
    // this list have to give the same reason
    table<SocialAccount>('social_accounts').list({ where: a => a.client_id === input.clientId }),
  ])

  /**
   * A POST WHOSE ITEM THIS PERSON MAY NOT SEE IS NOT ON THEIR CALENDAR.
   *
   * The page has always done this (`useSchedulePosts`'s `scopedItems`) and the
   * server did not, so the API was the wider of the two surfaces: the title
   * and the caption of an item somebody was not on, to anybody else on that
   * client. Same rule, same helpers — `visibleItems` with `scopeContextOf`,
   * exactly as the items API and the page both call it — so the browser and
   * the route cannot come to different answers about the same row.
   */
  const visible = input.viewer
    ? await scopeItemsFor(input.viewer, items)
    : items
  const itemById = new Map(visible.map(i => [i.id, i]))

  return inRange.filter(row => itemById.has(row.item_id)).map(row => {
    const post = shape(row)
    const item = itemById.get(post.item_id) ?? null
    // this post's own jobs only -- see jobsOf
    const mine = allJobs.filter(j => post.publish_job_ids.includes(j.id))
    return {
      ...post,
      live_status: statusOf(item, post, mine),
      item_title: (item?.title as string | null) ?? null,
      block_reason: publishBlockReason(item?.posting_approval_state)
        ?? channelBlockReason(post.channels, accounts),
    }
  })
}

/**
 * The items this person may actually see, out of the ones in hand.
 *
 * The same two calls the page makes and the items API makes — `scopeContextOf`
 * for the context a bare item array cannot carry (the shoots they own, the
 * work kinds), then `visibleItems`. Reading the assignments and shoots costs
 * nothing extra: `lib/db.ts` lists the node once per request and the request
 * cache serves the rest.
 */
async function scopeItemsFor(
  viewer: TeamUser, items: ContentItem[],
): Promise<ContentItem[]> {
  const [assignments, batches, workKinds] = await Promise.all([
    table<TeamUserClient>('team_user_clients').list().catch(() => []),
    table<Batch>('batches').list().catch(() => []),
    table<WorkKind>('work_kinds').list().catch(() => []),
  ])
  const who = { id: viewer.id, role: viewer.role, client_id: viewer.client_id ?? null }
  return visibleItems(
    who as never,
    items as unknown as (ContentItem & { work_kinds?: null })[],
    assignments as unknown as { team_user_id: string; client_id: string }[],
    scopeContextOf({
      viewer: who as never,
      batches: batches as unknown as { id: string; client_id: string; owner_id?: string | null }[],
      workKinds: workKinds as unknown as { id: string; slug: string }[],
    }),
  ) as unknown as ContentItem[]
}

/* ── notes on the calendar ──────────────────────────────────────────────── */

export async function listNotes(clientId: string, from?: string | null, to?: string | null): Promise<ScheduleNote[]> {
  const rows = await notes().list({ where: n => n.client_id === clientId }).catch(() => [])
  return rows.filter(n => (!from || n.at >= from) && (!to || n.at <= to))
}

export async function addNote(
  user: TeamUser, input: { client_id: string; at: string; text: string },
): Promise<ScheduleNote> {
  const text = String(input.text ?? '').trim().slice(0, 500)
  if (!text) throw new AuthzError('Write the note first', 400)
  const at = new Date(String(input.at)).toISOString()
  const stamp = nowIso()
  const row = await notes().insert({
    id: randomUUID(),
    client_id: input.client_id,
    at,
    text,
    created_by: user.id,
    created_at: stamp,
    updated_at: stamp,
  } as unknown as ScheduleNote)
  announceAfter('schedule', { client_id: input.client_id, note_id: row.id, kind: 'note' })
  return row
}

/**
 * Take a note off the calendar.
 *
 * The person who wrote it, or an account manager / super admin. A note is
 * often the reason something is NOT being posted ("client is away until the
 * 19th, hold everything"), so anybody who can see the calendar being able to
 * delete anybody's is one mis-click away from losing the only record of a
 * decision.
 */
export async function removeNote(user: TeamUser, id: string): Promise<void> {
  const row = await notes().get(id)
  if (!row) throw new AuthzError('That note is already gone', 404)
  if (!mayEditNote(user, row)) {
    throw new AuthzError(
      'Only the person who wrote this note, or an account manager, can remove it', 403,
    )
  }
  await notes().remove(id)
  announceAfter('schedule', { client_id: row.client_id, note_id: id, kind: 'note' })
}

/**
 * Change a note's words, or the time it is pinned to.
 *
 * The same people who may remove one may rewrite it — the person who wrote it
 * and the account manager for the client. A note is a message between the
 * team, so anybody being able to put words in somebody else's note is the
 * thing to prevent, not the thing to allow because it is only a calendar.
 */
export async function editNote(
  user: TeamUser,
  id: string,
  patch: { text?: string; at?: string },
): Promise<ScheduleNote> {
  const row = await notes().get(id)
  if (!row) throw new AuthzError('That note is already gone', 404)
  if (!mayEditNote(user, row)) {
    throw new AuthzError(
      'Only the person who wrote this note, or an account manager, can change it', 403,
    )
  }
  const text = patch.text === undefined ? row.text : String(patch.text).trim().slice(0, 500)
  if (!text) throw new AuthzError('Write the note first', 400)
  let at = row.at
  if (patch.at !== undefined) {
    const when = new Date(String(patch.at)).getTime()
    if (!Number.isFinite(when)) {
      throw new AuthzError('That is not a time we can read — pick one from the calendar', 400)
    }
    at = new Date(when).toISOString()
  }
  // one winner, like every other write on this page: a note two people opened
  // at once must not be half of each of them
  const saved = await notes().claim(id, cur =>
    cur ? { ...cur, text, at, updated_at: nowIso() } as ScheduleNote : null)
  if (!saved.claimed) throw new AuthzError('That note is already gone', 404)
  announceAfter('schedule', { client_id: row.client_id, note_id: id, kind: 'note' })
  return saved.row
}

/**
 * The client's own numbers, for the suggested-time rules.
 *
 * `post_analytics` carries no client id, so the rows are found the way they
 * are related: through the client's items and the jobs that published them.
 */
export async function analyticsForClient(clientId: string): Promise<Record<string, unknown>[]> {
  const [items, clientJobs] = await Promise.all([
    table<ContentItem>('content_items').list({ where: i => i.client_id === clientId }),
    jobs().list({ where: j => j.client_id === clientId }),
  ])
  const itemIds = new Set(items.map(i => i.id))
  const jobIds = new Set(clientJobs.map(j => j.id))
  if (itemIds.size === 0 && jobIds.size === 0) return []
  const rows = await table('post_analytics').list({
    where: r => (r.item_id != null && itemIds.has(String(r.item_id)))
      || (r.publish_job_id != null && jobIds.has(String(r.publish_job_id))),
    limit: 500,
  }).catch(() => [])
  return rows as unknown as Record<string, unknown>[]
}
