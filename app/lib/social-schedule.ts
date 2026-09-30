import 'server-only'
import { deliverOnlyFor, selfPostingClientIds } from './deliver-only'
import { DELIVER_ONLY_REASON } from './deliver-only-core'
import { randomUUID } from 'node:crypto'
import { table } from '@/lib/db'
import { announceAfter } from '@/lib/live'
import type {
  Asset,
  AssetVersion, Batch, Client, ContentItem, EncodeJob, FollowerSnapshot, PublishJob,
  ScheduleNote, SocialAccount, SocialPost, TeamUserClient, WorkKind,
} from '@/lib/db-types'
import { NextResponse } from 'next/server'
import { AuthzError, authzErrorResponse, type TeamUser } from './authz'
import { accessibleClientIds, createdItemIds, loadItemForUser, reviewedItemIds, taggedBatchIds, taggedItemIds } from './production-access'
import { scopeContextOf, visibleItems } from './scope-client'
import { actingRoles } from './workflow-core'
import { notifyTeamOfNote } from './booked-notify'
import { takeClaimLock, releaseClaimLock } from './claim-lock'
import {
  isPlatform, validatePost,
  type MediaItem, type PostKind, type Platform, type PostOptions, type Target,
} from './publish-core'
import {
  optionsFromExtras, readChannelExtras, type ChannelExtras } from './schedule-compose-core'
import {
  anyVersionSlides, applySlideLimit, channelBlockReason, coverForSlide, eligibility,
  mayEditNote, mayPostPiece, postingEligibility, samePostKey, validateComposition,
  type CoverSource, type Eligibility } from './social-schedule-core'
import {
  normaliseSlides, postSlides, slidesOf, slidesSatisfyType, uploadedForPost, type Slide,
} from './version-files-core'
import { addVersion, performTransition } from './workflow'
import { mirrorVersionSlides } from './gdrive-mirror'
import { askForCopiesAhead } from './encode-ahead'
import { previewVideos } from './stream'
import { ourStorageUrl } from './storage-core'
import { formatInZone, safeZone } from './timezone-core'
import { copiesLateWords, copiesReadyAt, earliestSafeTime } from './encode-eta-core'
import { isTrialTarget, latestFollowerCount, trialFollowersProblem } from './trial-reel-core'
import { networkName } from './publish-core'
import {
  insertDraftPost, loadPostState, mayActOn, postLockKey, saveWorkingCopy, teamActorFor,
  type PostActResult,
} from './post-stage'
import { STAGE_LABEL, readPostState, type PostStage, type PostState } from './post-stage-core'
import { jobIdsOfPost, type PostJobsLike } from './post-outcome-core'
import { postAutomationProblem, readPostAutomation, type PostAutomation } from './comment-automation-core'

/**
 * The planned post, server side — the calendar's reads, the composer's working copy, and the media.
 *
 * WHERE A POST IS lives in ONE field, `social_posts.stage`, written only by app/lib/post-stage.ts
 * (the posting rebuild, 29 Sep 2026; docs/posting-rebuild/SPEC.md). Nothing here reads the item's
 * approval, the jobs or a stored status to decide where a post is, and nothing here moves a stage:
 *
 *   • a new post is born a draft through `insertDraftPost` — and tells nobody (audit V12);
 *   • the working copy is saved through the rules' `save`, so it changes only in Draft;
 *   • every other move is `POST /api/posts/<id>/act` — the calendar's drag (Change time) and its bin
 *     (Cancel post, Delete draft) included.
 *
 * The one invariant that is still this module's is a claim, never check-then-write:
 *
 *   • one open post per item with the same files — a claim lock keyed by the item (`postLockKey`)
 */

/* ── plumbing ───────────────────────────────────────────────────────────── */

const posts = () => table<SocialPost>('social_posts')
const notes = () => table<ScheduleNote>('schedule_notes')

/** The stages in which a post still holds its files against a second post of the same files. */
const OPEN_STAGES: readonly PostStage[] = ['draft', 'quality_check', 'with_client', 'ready']

/** A refusal that carries every problem at once, so the composer can list
 *  them rather than revealing them one at a time. */
export class ComposeError extends AuthzError {
  problems: string[]
  constructor(problems: string[], status = 400) {
    super(problems[0] ?? 'This post is not ready yet', status)
    this.problems = problems
  }
}

/**
 * "There is already a post with these files" — WITH the post, so the window
 * can open it rather than tell the person to go and find it (the owner, 9
 * Sep 2026: "why is this coming up" — a second press with the same file was
 * refused in words that named no way forward).
 */
export class DuplicatePostError extends AuthzError {
  postId: string
  itemId: string
  constructor(postId: string, itemId: string) {
    super('This item already has a post with these files — open that one instead of starting a second', 409)
    this.postId = postId
    this.itemId = itemId
  }
}

const nowIso = () => new Date().toISOString()

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
  /** the post as the stage rules read it — null only for a row the migration has not reached */
  state: PostState | null
}

const shape = (row: SocialPost): PlannedPost => ({
  ...row,
  slides: asArray<Slide>(row.slides),
  channels: asArray<string>(row.channels).map(String),
  per_channel: readPerChannel(row.per_channel),
  // the booking's jobs, re-sends included — the new engine writes only `booking.job_ids`; the old
  // `publish_job_ids` is read only for a row the migration has not reached (audit V11, review fix)
  publish_job_ids: jobIdsOfPost(row as unknown as PostJobsLike),
  state: readPostState(row as unknown as Record<string, unknown>),
})

/* ── who may do what ────────────────────────────────────────────────────── */

/**
 * May this person compose — create, edit, send for approval?
 *
 * The scheduling hats plus the account manager, and an EDITOR only on an item
 * that is theirs (`actingRoles` decides "theirs"). This gates the MEDIA (the image editor, new files);
 * who may MOVE a post is the stage rules' hats (app/lib/post-stage-core.ts), and editors wear none.
 */
export function mayCompose(user: TeamUser, item: { owner_id?: string | null; scheduler_ids?: unknown }): boolean {
  if (user.role === 'super_admin' || user.role === 'account_manager' || user.role === 'scheduler' || user.role === 'general') return true
  if (user.role === 'client') return false
  const hats = actingRoles({ id: user.id, role: user.role }, item)
  return hats.includes('scheduler') || hats.includes('editor')
    || hats.includes('account_manager') || hats.includes('super_admin')
}

function assertCompose(user: TeamUser, item: ContentItem): void {
  if (!mayCompose(user, item)) {
    throw new AuthzError('Only the people scheduling this client can change this post', 403)
  }
}

/**
 * MAY THIS PERSON POST WITH NO APPROVAL STEP IN THE WAY? (ruled 5 Sep 2026;
 * the client's switch dropped from it 9 Sep 2026)
 *
 * The client's account manager, or a super admin — read off the hats they
 * wear on THIS item, so an editor handed the scheduling of a piece does not
 * inherit the manager's signature with it — or a piece the board already
 * signed off. The client's "signs off every post" switch is NOT consulted:
 * the owner ruled that a manager posts straight out "even when the client
 * has that lock", and a read of the client row here (it failed closed) was
 * a 503 standing in the way of a policy that binds nobody on this path.
 *
 * The answer decides two things and nothing else: which media this person may
 * build a post out of (`eligibleFor`), and whether the app performs the two
 * approvals for them when the post goes out. Every state the post passes
 * through is the ordinary one.
 */
export async function mayPostStraightOut(user: TeamUser, item: ContentItem): Promise<boolean> {
  return mayPostPiece(actingRoles({ id: user.id, role: user.role }, item), null, item)
}

/** The media this person may build a post out of. */
async function eligibleFor(
  user: TeamUser, item: ContentItem, versions: readonly AssetVersion[],
): Promise<Eligibility> {
  // DELIVER ONLY (11 Sep 2026): the client posts it themselves — delivered,
  // never booked here, whoever is asking
  if (await deliverOnlyFor(item)) return { ok: false, reason: DELIVER_ONLY_REASON }
  return postingEligibility(item, versions, await mayPostStraightOut(user, item))
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
  if (e instanceof DuplicatePostError) {
    return NextResponse.json({ error: e.message, post_id: e.postId, item_id: e.itemId }, { status: e.status })
  }
  const { error, status } = authzErrorResponse(e)
  return NextResponse.json({ error }, { status })
}

/* ── loading ────────────────────────────────────────────────────────────── */

/**
 * One post, with the edit card its files came from.
 *
 * WHO MAY OPEN IT IS THE POST'S QUESTION, NOT THE CARD'S (review fix, 29 Sep 2026; SPEC §1.3). The
 * old gate was the card's visibility, so a scheduler could see a post on Post approval, press Edit on
 * it, and then be told "Item not found" when saving it — the card was another scheduler's upload, or
 * still at Draft. Now the gate is the one every posting surface uses (`mayActOn`: the person's clients,
 * a post they made or are named on, the reviewer's desk). The card is only a title and a file source;
 * when it has been deleted, a stand-in marked `adhoc_post` takes its place, so a cancelled post from a
 * deleted card can still be re-booked, given a time, and sent (audit W2).
 */
export async function loadPostForUser(
  user: TeamUser, id: string,
): Promise<{ post: PlannedPost; item: ContentItem; cardGone: boolean }> {
  const row = await posts().get(id)
  if (!row) throw new AuthzError('That post no longer exists', 404)
  const state = readPostState(row as unknown as Record<string, unknown>)
  if (state) {
    if (!(await mayActOn(user, state))) throw new AuthzError('That client is not one of yours', 403)
  } else {
    await assertClientAccess(user, row.client_id)
  }
  const sourceId = String((row as { source_item_id?: string | null }).source_item_id ?? row.item_id ?? '')
  const card = sourceId ? await table<ContentItem>('content_items').get(sourceId).catch(() => null) : null
  if (card) return { post: shape(row), item: card, cardGone: false }
  return { post: shape(row), item: standInCard(row), cardGone: true }
}

/** The card a post whose card was deleted stands on: its title from the caption, nothing to move. */
function standInCard(row: SocialPost): ContentItem {
  return {
    id: row.item_id, client_id: row.client_id, title: String(row.caption ?? '').trim().split(/\r?\n/)[0].slice(0, 80) || 'Post',
    status: 'published', adhoc_post: true, owner_id: null, scheduler_ids: [],
  } as unknown as ContentItem
}

/**
 * THE SAME, FOR A POST WHOSE CARD IS GONE — a manager's read only.
 *
 * The owner, 9 Sep 2026: "I just want to see the post I posted here shows
 * there." Six cards were deleted at 23:12 the night before; the posts that
 * had gone out through them stayed live on Instagram, with their numbers
 * still in `post_analytics`, and their pages refused to open because the
 * card behind them was null. A published post is a record in its own
 * right: an account manager or a super admin on that client may still read
 * it. The stand-in card is marked so nothing tries to move it.
 */
export async function loadPostOrRecordForUser(
  user: TeamUser, id: string,
): Promise<{ post: PlannedPost; item: ContentItem; cardGone: boolean }> {
  const row = await posts().get(id)
  if (!row) throw new AuthzError('That post no longer exists', 404)
  const card = await table<ContentItem>('content_items').get(row.item_id).catch(() => null)
  if (card) {
    const item = await loadItemForUser(user, row.item_id)
    return { post: shape(row), item, cardGone: false }
  }
  if (user.role !== 'account_manager' && user.role !== 'super_admin') {
    throw new AuthzError('Item not found', 404)
  }
  await assertClientAccess(user, row.client_id)
  return { post: shape(row), item: standInCard(row), cardGone: true }
}

async function versionsOf(itemId: string): Promise<AssetVersion[]> {
  return table<AssetVersion>('asset_versions').list({ where: v => v.item_id === itemId })
}

async function zoneOf(clientId: string, given?: string | null): Promise<string> {
  if (given) return safeZone(given)
  const client = await table<Client>('clients').get(clientId).catch(() => null)
  return safeZone((client?.timezone as string | null) ?? null)
}

/**
 * A BOOKED TIME IS A PROMISE THE COPIES HAVE TO KEEP.
 *
 * The clean copies a video needs are made by the encoder after the file is
 * attached, and a 4K master takes real minutes. A post booked for before
 * they are done goes out late, or with the copy still missing — so the
 * time is refused, with the earliest safe one in the sentence, in the
 * client's clock. The window bumps its own clock to the same time by
 * default; this is the backstop for a drag on the calendar, a typed time,
 * or a second tab (the owner, 10 Sep 2026: "ensure that the timing is
 * accurate… show them the right moment to post… because a super admin,
 * scheduler or AM can schedule").
 *
 * Null when there is nothing to wait for: no video, a carousel, copies
 * already done, or a time comfortably after them.
 */
async function copiesNotReadyBy(
  post: Pick<SocialPost, 'slides' | 'timezone'>,
  accounts: readonly SocialAccount[],
  whenMs: number,
  now = Date.now(),
): Promise<string | null> {
  const slides = Array.isArray(post.slides) ? post.slides : []
  const video = slides.length === 1 && slides[0]?.type === 'video' ? slides[0] : null
  if (!video?.url) return null
  const platforms = [...new Set(accounts.map(a => String(a.platform)))]
  const rows = await table<EncodeJob>('encode_jobs')
    .list({ where: r => r.source_url === video.url })
    .catch(() => [] as EncodeJob[])
  const readyAt = copiesReadyAt(rows, platforms, now)
  if (readyAt === null) return null
  const safeAt = earliestSafeTime(now, readyAt)
  if (whenMs >= safeAt) return null
  const zone = safeZone(post.timezone ?? null)
  const fmt = (ms: number) => formatInZone(new Date(ms).toISOString(), zone, 'time') ?? new Date(ms).toISOString()
  const open = new Set(
    rows.filter(r => (r.status === 'queued' || r.status === 'running') && platforms.includes(String(r.platform)))
      .map(r => String(r.platform)),
  )
  return copiesLateWords([...open].map(networkName), readyAt, safeAt, fmt)
}

/** Instagram's floor for a Trial Reel, judged on the latest follower count
 *  we hold; null when the post is not a trial, the account clears it, or
 *  nobody has counted yet. */
async function trialReelProblem(
  post: Pick<SocialPost, 'per_channel'>,
  accounts: readonly SocialAccount[],
): Promise<string | null> {
  const perChannel = readPerChannel(post.per_channel)
  for (const a of accounts) {
    if (!isTrialTarget(String(a.platform), perChannel[a.id])) continue
    const rows = await table<FollowerSnapshot>('follower_snapshots')
      .list({ where: r => r.account_id === a.id && typeof r.count === 'number' })
      .catch(() => [] as FollowerSnapshot[])
    const why = trialFollowersProblem(latestFollowerCount(rows, a.id), a.username)
    if (why) return why
  }
  return null
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
  /** a draft being saved, not a post going out (see `CompositionInput.saving`) */
  saving?: boolean
  /** only being written down — nothing owed to the networks yet (`CompositionInput.draft`) */
  draft?: boolean
}): string[] {
  const problems = validateComposition({
    item: input.item,
    version: input.version,
    slides: input.slides,
    caption: input.caption,
    // WITH each channel's own options. Without them the TikTok tick was
    // judged missing on every post that had a TikTok channel, whatever the
    // composer had ticked (9 Sep 2026: "cant save as draft and also cant
    // post to tiktok") — the window checked the real options and said fine,
    // the server checked none and said no.
    channels: input.accounts.map(a => ({
      id: a.id,
      platform: a.platform,
      kind: (input.perChannel[a.id]?.kind as PostKind | undefined) ?? null,
      options: optionsFromExtras(input.perChannel[a.id]),
      slides: (input.perChannel[a.id] as { slides?: Slide[] } | undefined)?.slides ?? null,
    })),
    scheduledFor: input.scheduledFor,
    withoutApproval: input.withoutApproval,
    saving: input.saving,
    draft: input.draft,
    // a draft being saved, or a post being sent for review, owes nobody a
    // time — the window says so and the server used to disagree ("Pick a
    // time" under an enabled Save as draft; the audit of 10 Sep 2026)
    requireTime: !input.saving,
    now: nowIso(),
  }).problems.slice()

  const platforms = input.accounts.map(a => a.platform).filter(isPlatform)
  // the publisher's own check is for a post going OUT; a draft being written
  // down is not one, and is not refused for what it does not yet have
  if (platforms.length > 0 && input.slides.length > 0 && !input.draft) {
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
function chooseSlides(approved: Slide[], chosen: unknown, anyVersion: readonly Slide[] = []): Slide[] {
  // nothing chosen: the approved files, exactly as before (the hand-over's fresh post is made this way)
  if (!Array.isArray(chosen)) return approved
  // …a choice may name a file of ANY version of this card (the owner, 30 Sep 2026), never another card's
  const byUrl = new Map([...anyVersion, ...approved].map(s => [s.url, s]))
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
  /** the comment-to-DM automation (comment-automation-core readPostAutomation) */
  automation?: unknown
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
  const versions = await versionsOf(item.id)
  const elig = await eligibleFor(user, item, versions)
  if (!elig.ok) throw new ComposeError([elig.reason])

  const slides = chooseSlides(elig.slides, input.slides, anyVersionSlides(item, versions))
  const channelIds = asArray<unknown>(input.channels).map(String)
  const accounts = await channelsFor(item.client_id, channelIds)
  const perChannel = readPerChannel(input.per_channel)
  const caption = String(input.caption ?? '')
  const scheduledFor = input.scheduled_for ? String(input.scheduled_for) : null
  const automation = checkedAutomation(input.automation)

  // a half-made draft is allowed; a post with real content in it is judged
  if (accounts.length > 0 && slides.length > 0) {
    const problems = problemsWith({
      item, version: (elig.version as AssetVersion) ?? null,
      slides, caption, accounts, perChannel, scheduledFor,
      // media this person may post before the client has seen it is not a
      // problem to hand back to them — the sign-off travels with the post
      withoutApproval: elig.needsClientApproval,
      saving: true,
      draft: true,
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
    automation,
  })
}

/**
 * The post's automation as sent by the window: read, and — when it is switched on — checked, so a DM
 * that cannot go out (no text, a button with no link, a link that is not https) is refused at the save
 * with the reason, not discovered silently when the booking reaches Zernio.
 */
function checkedAutomation(raw: unknown): PostAutomation | null {
  const a = readPostAutomation(raw)
  const problem = postAutomationProblem(a, null)
  if (problem) throw new ComposeError([problem])
  // the window keeps blank lines while someone types; what is stored has none
  return a && {
    ...a,
    dm_variations: a.dm_variations.map(t => t.trim()).filter(Boolean),
    reply_variations: a.reply_variations.map(t => t.trim()).filter(Boolean),
  }
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
    automation?: PostAutomation | null
  },
): Promise<PlannedPost> {
  const id = randomUUID()
  // one OPEN post per item. The lock is handed on the moment the post it
  // names is no longer being written — cancelled, gone, or BOOKED (9 Sep
  // 2026, a piece posted in parts: the first post is on its way with its
  // files, and the next post is made of the files still free).
  // …and a second OPEN post is fine when it is made of DIFFERENT files: the
  // folder's ticks (9 Sep 2026). The lock only stops the same files being
  // put into two posts by two presses.
  // …and the same files going out DIFFERENTLY — a Story of the picture that
  // is also a feed post — are two posts, not one pressed twice (the owner,
  // 15 Sep 2026: "the Story dropdown, when picked, does not allow me to
  // post"): social-schedule-core.samePostKey
  const wanted = samePostKey(input.slides, input.channels, input.perChannel as never)
  const gate = await takeClaimLock(postLockKey(item.id), id, async holder => {
    const held = await posts().get(holder)
    if (!held) return false                       // not written yet, or gone — the lock's age decides
    // booked, out, or cancelled: decisively not held — read off the post's own stage
    if (!OPEN_STAGES.includes(String(held.stage ?? '') as PostStage)) return 'free'
    const theirFiles = asArray<Slide>(held.slides)
    if (theirFiles.length === 0) return true       // not written yet: the lock's age decides
    const theirs = samePostKey(theirFiles, asArray<string>(held.channels), (held.per_channel ?? null) as never)
    if (theirs === wanted) return true
    return 'free'                                 // an open post of OTHER files: the folder's ticks
  })
  if (!gate.ok) throw new DuplicatePostError(gate.holder, item.id)

  try {
    // born a DRAFT through the one writer of a stage
    const row = await insertDraftPost({
      id,
      client_id: item.client_id,
      item_id: item.id,
      created_by: user.id,
      version_id: input.version?.id ?? null,
      version_number: input.version?.version_number ?? null,
      slides: input.slides,
      caption: input.caption,
      per_channel: input.perChannel,
      channels: input.channels,
      scheduled_for: input.scheduledFor,
      timezone: await zoneOf(item.client_id, input.timezone),
      automation: input.automation ?? null,
    })
    // A big video's copy is made NOW, not when the post is due. Fire and
    // forget: nothing about this save waits on it, and the publish job still
    // asks for itself if this never happened.
    askForCopiesAhead({
      clientId: item.client_id,
      slides: input.slides,
      channels: input.channels,
      perChannel: input.perChannel,
    })
    announceAfter('schedule', { client_id: item.client_id, post_id: row.id, kind: 'created' })
    // NOBODY is emailed about a draft (audit V12: saving one told the managers it was "being published
    // now"). The first notice goes when it is sent for quality check.
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

/* ── edit: the working copy, in Draft only ──────────────────────────────── */

export type UpdatePostInput = {
  slides?: unknown
  caption?: string | null
  channels?: unknown
  per_channel?: unknown
  scheduled_for?: string | null
  note?: string | null
  automation?: unknown
  /** the rev the page drew; a stale page is refused rather than overwriting someone else's save */
  expect_rev?: number | null
}

/**
 * SAVE THE COMPOSER'S WORK — the working copy of a post in DRAFT (the owner's decision 8).
 *
 * A post that has been sent is frozen: what the quality check or the client is looking at does not
 * change under them. To change one, the person presses Edit (T19), which makes it a draft of the next
 * version and takes the earlier approvals back — in the open, with the words saying so, never silently
 * the way `stateAfterPostEdit` did it on the ITEM. A new time on a post that is Ready to post or Booked
 * in keeps its approval: it is the act route's Change time, not a save.
 *
 * Saving a draft never asks for a time and never emails anybody.
 */
export async function updatePost(
  user: TeamUser, id: string, input: UpdatePostInput,
): Promise<PlannedPost> {
  const { post, item } = await loadPostForUser(user, id)
  assertCompose(user, item)
  const state = post.state
  if (!state) throw new AuthzError('This post is from before the new stages and cannot change until it is moved across', 409)

  if (state.stage !== 'draft') {
    throw new AuthzError(
      `This post is in ${STAGE_LABEL[state.stage]}, so what was sent is kept as it is. Press Edit to change it — that makes version ${state.draft_version}.`,
      409,
    )
  }

  /**
   * A DRAFT MAY BE WRITTEN WHILE THE PIECE IS STILL BEING CHECKED.
   *
   * `postingEligibility` answers "may this go OUT". The answer is used for ONE thing here — which files
   * may be named on the post — and the item's latest version stands in when the client has not signed
   * anything off yet, so a composer never refuses to keep the words somebody just typed.
   */
  const versions = await versionsOf(item.id)
  const elig = await eligibleFor(user, item, versions)
  const latest = versions.reduce<AssetVersion | null>(
    (best, v) => (Number(v.version_number ?? 0) > Number(best?.version_number ?? 0) ? v : best), null)
  const editableVersion = elig.ok ? (elig.version as AssetVersion) : latest
  const editableSlides = elig.ok
    ? elig.slides
    : postSlides(item.content_type as string, slidesOf(latest))

  // the files already on the post may stay on it (a Schedule upload, a picked Drive file) — only a
  // NEW file has to come from the piece
  const onPost = post.slides
  const allowed = [...editableSlides, ...onPost.filter(s => !editableSlides.some(e => e.url === s.url))]
  // …and any version of this card's files (the owner, 30 Sep 2026: "they can use from any version")
  for (const s of anyVersionSlides(item, versions)) if (!allowed.some(a => a.url === s.url)) allowed.push(s)
  // …and a file uploaded through the app for this post — a client's change is made HERE (uploadedForPost)
  if (input.slides !== undefined) {
    const asked = asArray<{ url?: unknown }>(input.slides).map(r => String(r?.url ?? '')).filter(u => u && !allowed.some(a => a.url === u))
    if (asked.length > 0) {
      const known = new Set((await table<Asset>('assets').list({ where: a => asked.includes(String(a.url)) })).map(a => String(a.url)))
      allowed.push(...uploadedForPost(input.slides, known, allowed))
    }
  }
  if (input.slides !== undefined && allowed.length === 0) {
    throw new ComposeError([elig.ok ? 'No media yet' : elig.reason])
  }

  const slides = input.slides === undefined ? post.slides : chooseSlides(allowed, input.slides)
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
      // saving a draft is never the moment to argue about the sign-off — the quality check is
      withoutApproval: true,
      saving: true,
      draft: true,
    })
    if (problems.length > 0) throw new ComposeError(problems)
  }

  const saved = await saveWorkingCopy(id, teamActorFor(user, state), {
    slides,
    caption,
    channels: channelIds,
    per_channel: perChannel,
    scheduled_for: scheduledFor,
    ...(input.note === undefined ? {} : { note: input.note ? String(input.note) : null }),
    ...(input.automation === undefined ? {} : { automation: checkedAutomation(input.automation) }),
  }, input.expect_rev ?? null)
  if (!saved.ok) throwRefusal(saved)

  // media replaced, or a channel added to a post that already had media —
  // either way the copy is asked for here rather than at the posting time
  askForCopiesAhead({
    clientId: item.client_id,
    slides,
    channels: channelIds,
    perChannel,
  })
  return shape((await posts().get(id, { fresh: true }))!)
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

  // A FILE THE CHANNEL HOLDS, OR THAT HAS GONE OUT, STAYS: a version that
  // drops or swaps it would leave the booking pointing at a file the card no
  // longer shows. Only the UI stopped this (the audit of 9 Sep 2026).
  const itemPosts = await posts().list({ by: { item_id: item.id } })
  const held = itemPosts
    .filter(p => ['booked', 'posted'].includes(String(p.stage ?? '')))
    .flatMap(p => asArray<{ url?: unknown }>(p.slides).map(s => String(s?.url ?? '')))
  const keeping = new Set(slides.map(s => s.url))
  if (held.some(u => u && !keeping.has(u))) {
    throw new AuthzError('A file that is booked in or already posted cannot be replaced or removed — take the booking off first', 409)
  }
  // new files go on a post only while it is a DRAFT: what was sent stays what was sent (decision 8)
  if (input.post_id) {
    const target = itemPosts.find(p => p.id === String(input.post_id))
    const stage = String(target?.stage ?? '')
    if (!target) throw new AuthzError('That post no longer exists', 404)
    if (stage !== 'draft') {
      throw new AuthzError(`This post is in ${STAGE_LABEL[stage as PostStage] ?? 'another stage'}, so what was sent is kept as it is. Press Edit first, then change its files.`, 409)
    }
  }

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
  /* THE SHAPE RULE IS FOR A VERSION, NOT FOR A POST. A carousel piece must
   * hold at least two files — but a POST made from it may take one: the
   * owner, 9 Sep 2026, "I changed my mind from 4 to posting individually,
   * it doesn't allow me to apply that, it locks me in the modal". An edit of
   * the post's own selection (nothing new uploaded) is judged only as
   * non-empty; the piece's files are untouched. */
  if (fresh.length > 0) {
    const shapeProblem = slidesSatisfyType(item.content_type as string, slides)
    if (shapeProblem) throw new ComposeError([shapeProblem])
  }

  const postId = input.post_id ? String(input.post_id) : null

  // -- nothing new: this is an edit of the post, not a version --
  if (fresh.length === 0) {
    if (postId) await claimPostSlides(user, postId, item.id, slides, null, null)
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

  // THE EDIT CARD DOES NOT MOVE, AND NEITHER DOES ANY OTHER POST (the posting rebuild, 29 Sep 2026: the
  // edit's approval and the post's are independent — SPEC §1.3). New files on a post are a change to
  // THAT post's working copy, which is a draft; its own quality check is what looks at them next. The
  // item's `posting_approval_state` used to be reset here, which quietly un-approved every sibling post.
  const status = String(item.status)
  void performTransition; void mayPostStraightOut

  if (postId) await claimPostSlides(user, postId, item.id, slides, version.id ?? null, number)

  announceAfter('schedule', { client_id: item.client_id, item_id: item.id, kind: 'media' })

  return {
    version_number: number,
    slides,
    status,
    created: true,
    message: `Saved as version ${number} of the piece.`,
  }
}

/** The post keeps the arrangement — a save of its working copy, through the one writer, so it lands only
 *  while the post is a draft and never over somebody else's newer save. */
async function claimPostSlides(
  user: TeamUser, postId: string, itemId: string, slides: Slide[],
  versionId: string | null, versionNumber: number | null,
): Promise<void> {
  const { post } = await loadPostState(postId)
  if (!post || post.source_item_id !== itemId) throw new AuthzError('That post is not on this piece', 404)
  const saved = await saveWorkingCopy(postId, teamActorFor(user, post), {
    slides,
    ...(versionId === null ? {} : { version_id: versionId }),
    ...(versionNumber === null ? {} : { version_number: versionNumber }),
  }, post.rev)
  if (!saved.ok) throwRefusal(saved)
  // the media on the post just changed — ask for the copy of it now, while
  // the posting time is still days away
  askForCopiesAhead({
    clientId: saved.post.client_id,
    slides,
    channels: saved.post.channels,
    perChannel: saved.post.per_channel,
  })
}


/* ── moving and stopping: through the one writer ────────────────────────── */

/**
 * WHAT USED TO LIVE HERE, AND WHY IT IS GONE (the posting rebuild, 29 Sep 2026).
 *
 * `sendForApproval`, `scheduleWithoutApproval`, `syncFromItem`, `bookApprovedPosts`, `schedulePost`,
 * `reschedule`, `rewordBooked` and `cancelPost` each worked out where a post was from the ITEM's
 * approval, the jobs and the stored status, and each wrote it in its own way. That is how one approval
 * gated every post of a card (V1), a cancel wiped its siblings (V2), the booking email went before the
 * booking (V14) and a thrown queue left a post booked with no job (V15). Every one of those moves is
 * now a row of POST_TRANSITIONS, made by app/lib/post-stage.ts through `POST /api/posts/<id>/act`.
 *
 * Two doors stay, because the calendar uses them: a drag to a new time, and the post window's bin.
 * Both are thin: they pick the move the rules name and hand it to the one writer.
 */

/** Refuse a booking the provider could not keep: a video's copies not ready by then, or a Trial Reel
 *  on an account under Instagram's floor. Null when there is nothing in the way. */
export async function bookingProblem(
  copy: { slides: Slide[]; per_channel: Record<string, ChannelExtras>; timezone: string | null },
  accounts: readonly SocialAccount[],
  whenMs: number,
): Promise<string | null> {
  const late = await copiesNotReadyBy({ slides: copy.slides, timezone: copy.timezone ?? 'Australia/Melbourne' } as never, accounts, whenMs)
  if (late) return late
  return trialReelProblem({ per_channel: copy.per_channel } as never, accounts)
}

/** A refusal from the one writer, as the error this module's routes answer with. */
export function throwRefusal(r: PostActResult): never {
  if (r.ok) throw new Error('not a refusal')
  const status = r.code === 'not_allowed' ? 403 : r.code === 'not_found' ? 404 : r.code === 'bad_request' ? 400 : 409
  if (r.problems && r.problems.length > 0) throw new ComposeError(r.problems, status)
  throw new AuthzError(r.reason, status)
}

/** The provider payload for one post: one target per channel, each carrying
 *  its own caption, kind and slides where the composer set them. */
export function targetsFor(
  post: Pick<PlannedPost, 'slides' | 'per_channel'>,
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
    // TikTok takes its cover as a different field (`video_cover_image_url`,
    // stitched in as the first frame). The same picture, unless somebody
    // chose TikTok's own — a picture or a frame time (9 Sep 2026 —
    // Instagram and YouTube got the editor's cover, TikTok silently did not).
    if (account.platform === 'tiktok' && options.thumbnailUrl
        && !options.videoCoverImageUrl && typeof options.videoCoverTimestampMs !== 'number') {
      options.videoCoverImageUrl = options.thumbnailUrl
    }
    out.push({
      platform: account.platform,
      accountId: account.provider_account_id || account.id,
      ...(Object.keys(options).length > 0 ? { options } : {}),
    })
  }
  return out
}


/* ── reading the calendar ───────────────────────────────────────────────── */

export type ListedPost = PlannedPost & {
  /** the post's stage — the ONE answer to where it is (null only before the migration reaches it) */
  stage: PostStage | null
  item_title: string | null
  /** why it cannot go out as it stands: a channel that is not connected any more (audit S13) */
  block_reason: string | null
  /** the piece it came from was deleted; the post stays visible (audit S9, L6) */
  source_deleted: boolean
}

/**
 * Every post for one client in a date range, each carrying its own STAGE — never a status worked out
 * from the item's approval or the jobs (audit S2, S5, S15). A post whose piece was deleted stays on the
 * list, marked, instead of vanishing (audit S9); a post whose piece this person may not see is left
 * out, the same rule the page and the items API apply.
 */
export async function listPosts(input: {
  clientId: string
  from?: string | null
  to?: string | null
  /**
   * Who is asking. Optional only so the internal callers that have already proved access (and the
   * tests) need not invent one; every ROUTE passes it, and without it this returns the client's whole
   * calendar.
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

  const itemIds = [...new Set(inRange.map(p => p.source_item_id ?? p.item_id))]
  const [items, accounts] = await Promise.all([
    table<ContentItem>('content_items').list({ where: i => itemIds.includes(i.id) }),
    table<SocialAccount>('social_accounts').list({ where: a => a.client_id === input.clientId }),
  ])
  const existing = new Set(items.map(i => i.id))
  const visible = input.viewer ? await scopeItemsFor(input.viewer, items) : items
  const itemById = new Map(visible.map(i => [i.id, i]))
  // a post whose piece is GONE is a record in its own right: shown to a manager on this client (the
  // same rule `loadPostOrRecordForUser` follows), marked, never silently dropped
  const seesOrphans = !input.viewer || ['account_manager', 'super_admin', 'scheduler', 'general'].includes(String(input.viewer.role))

  return inRange.flatMap(row => {
    const itemId = row.source_item_id ?? row.item_id
    const item = itemById.get(itemId) ?? null
    const gone = !existing.has(itemId) || row.source_deleted === true
    if (!item && !(gone && seesOrphans)) return []
    const post = shape(row)
    return [{
      ...post,
      stage: post.state?.stage ?? null,
      item_title: (item?.title as string | null) ?? null,
      block_reason: channelBlockReason(post.channels, accounts),
      source_deleted: gone,
    }]
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
  // the grants too — tags and creation — or this page shows a person less
  // than the boards do and the items API does
  const [assignments, batches, workKinds, itemTags, batchTags, createdIds, reviewedIds] = await Promise.all([
    table<TeamUserClient>('team_user_clients').list().catch(() => []),
    table<Batch>('batches').list().catch(() => []),
    table<WorkKind>('work_kinds').list().catch(() => []),
    taggedItemIds(viewer).catch(() => [] as string[]),
    taggedBatchIds(viewer).catch(() => [] as string[]),
    createdItemIds(viewer),
    reviewedItemIds(viewer),
  ])
  const who = { id: viewer.id, role: viewer.role, client_id: viewer.client_id ?? null }
  return visibleItems(
    who as never,
    items as unknown as (ContentItem & { work_kinds?: null })[],
    assignments as unknown as { team_user_id: string; client_id: string }[],
    scopeContextOf({
      viewer: who as never,
      batches: batches as unknown as { id: string; client_id: string; owner_id?: string | null }[],
      clients: [...await selfPostingClientIds()].map(id => ({ id, posts_own_content: true })),
      taggedItemIds: itemTags,
      taggedBatchIds: batchTags,
      createdItemIds: createdIds,
      reviewedItemIds: reviewedIds,
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
  // the team on this client hears it (9 Sep 2026) — after the write, off
  // the request's critical path
  const client = await table<Client>('clients').get(input.client_id).catch(() => null)
  void notifyTeamOfNote(user, { id: row.id, client_id: input.client_id, at, text }, client?.name ?? null)
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
    table<PublishJob>('publish_jobs').list({ where: j => j.client_id === clientId }),
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

