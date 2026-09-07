import 'server-only'
import { table } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type {
  AssetVersion, Batch, BatchComment, Client, ContentItem, IntakeForm, ItemComment,
  MonthlyCommitment, ScheduleEntry, TeamUserClient, WorkflowActivity,
} from '@/lib/db-types'
import { CLIENT_LABELS, type ItemStatus } from './workflow-core'
import {
  sanitiseCanvasCards, sanitiseShotList, sanitisePlannedDeliverables,
  type CanvasCard, type PlannedDeliverable, type ShotRow,
} from './batch-brief-core'
import { isInternalKind } from './task-kind-core'
import { slidesOf } from './version-files-core'
import {
  clientStatusWord, planState, progressLine, scheduledWhen, shootStatusLabel,
  type LastStatusChange, type PlanState,
} from './portal-words'
import { analyticsForItems, refreshStaleAnalyticsInBackground } from './post-analytics'
import { portalPerformance, readPerformance, type PortalPerformance } from './post-performance-core'
import {
  monthTotals, typeTotals,
  type MonthTotals, type PostMetrics, type TypeTotals,
} from './post-analytics-core'
import { monthInZone, safeZone } from './timezone-core'
import { normaliseProfile, toScanShape } from './brand-profile-core'
import { awaitsClientPostApproval } from './posting-approval-core'
import { portalIntakeForms, type PortalIntakeForm } from './intake-portal-core'
import { loadPortalFollowers } from './portal-followers'
import type { PortalFollowers } from './followers-core'
import {
  brandLogoUrl, cardLine, isClientFacing, kindWord, linkFor, portalActions, portalCardTone,
  portalColumnFor, shootDayLabel, shootStanding, toPortalComment,
  type PortalActions, type PortalCardComment, type PortalCardTone, type PortalColumnKey, type PortalLink,
} from './portal-core'
import { canvasCardLabel, findCanvasCard } from './canvas-comments-core'

/**
 * Client-safe portal payload — shared by the logged-in portal and the
 * view-only share link. Everything here is already stripped to what a client
 * may see: no internal master links, no internal comments, client-facing labels.
 * Two queries total (items + schedule entries) — no N+1.
 */

export type PortalItem = {
  id: string
  title: string
  content_type: string
  status: ItemStatus
  status_label: string
  updated_at: string
  preview_url: string | null
  drive_url: string | null
  /** a carousel is one post of many cards — the card shows the first three
   *  and says how many there are. Empty for a single-file piece. */
  preview_slides: { url: string; type: 'image' | 'video' }[]
  /** the WHOLE post, in posting order, so the portal can show it as the
   *  carousel it is rather than card one plus a row of stamps. Single-file
   *  pieces carry exactly one entry; a piece with no client-facing media
   *  carries none. */
  slides: { url: string; type: 'image' | 'video'; name: string }[]
  slide_count: number
  /** one sentence about where this piece actually is, when the status word
   *  alone would leave the client wondering — a piece pulled back out of their
   *  review says so. Null on everything else, which is nearly everything. */
  progress_line: string | null
  schedule: { platform: string; scheduled_at: string | null; live_url: string | null }[]
  /** the post text, exactly as it will publish — carried ONLY on a card that
   *  is asking the client to approve the final post; absent everywhere else */
  caption?: string | null
  /** how the live post is doing, once the platform has counted it. Null on
   *  anything not published, and on a post whose numbers have not arrived. */
  metrics: PortalItemMetrics | null
}

/** A published piece's numbers, already client-safe: no engagement rate, no
 *  sync plumbing beyond "are these ready", no provider ids. */
export type PortalItemMetrics = PostMetrics & {
  /** the provider's readiness word — the card says "arriving" for 'pending' */
  sync_status: string | null
  synced_at: string
  /** the live post, when the platform has assigned a URL */
  post_url: string | null
  published_at: string | null
  /** how it did, in the client's slice: interactions, followers since, the
   *  sparkline's points. Null until the platform has counted. */
  performance: PortalPerformance | null
}

export type PortalShoot = {
  id: string
  title: string
  status_label: string
  shoot_date: string | null
  location: string | null
  concept: string | null
  board_name: string | null
  planned_deliverables: PlannedDeliverable[]
  shot_list: ShotRow[]
  canvas_cards: CanvasCard[]
  /** false = a booked shoot whose PLAN was not shared: the client sees that
   *  it's happening (status, date, location) but none of the working detail */
  details_shared: boolean
  /** the shoot's brief task, when the plan is sitting with the client for a
   *  decision. The brief itself never appears in the portal as an item — but
   *  the state machine gives the CLIENT the turn at client_review, so the
   *  decision has to be reachable somewhere, and the plan card is where the
   *  plan is. Null at every other stage. */
  awaiting_decision?: { item_id: string } | null
  /** where the plan stands with the CLIENT — waiting on them, notes received,
   *  approved, date confirmed. Their own last action, said back to them. */
  plan_state: PlanState
  /** the brief task behind this plan, whatever stage it is at — the card acts
   *  on it, and only the client_review stage may act at all */
  brief_item_id?: string | null
}

/**
 * ONE CARD ON THE CLIENT'S BOARD — a piece of work or a shoot.
 *
 * A card is a thing, never a stage: the column and the one `line` say where
 * it stands. Everything a card offers (`actions`) is decided by portal-core,
 * and the routes consult the same rules, so a card cannot offer more than the
 * server will accept.
 */
export type PortalCard = {
  kind: 'work' | 'shoot'
  /** the item id, or the shoot's batch id */
  id: string
  title: string
  /** the kind of work in the team's own word ("Reel", "Menu carousel"), the
   *  old format word as a fallback — or null when there is no plain word for it */
  word: string | null
  /** the post's caption, once the team has written one — shown to the client
   *  under the title, since it is what will go out with the work */
  caption: string | null
  column: PortalColumnKey
  tone: PortalCardTone | undefined
  /** the one sentence under the title */
  line: string
  /** where the work lives (Drive / Dropbox / the file) — only once it has reached the client */
  link: PortalLink | null
  /** a shared shoot plan has a PDF; the page builds the href from its token */
  pdf: boolean
  preview_url: string | null
  slides: PortalItem['slides']
  updated_at: string
  /** the booked posting time, in the client's words, for a scheduled post */
  posted_when: string | null
  /** the live post, once there is one */
  live_url: string | null
  metrics: PortalItemMetrics | null
  actions: PortalActions
  /** the item the approve / ask-for-a-change acts on: the piece itself, or a shoot's brief */
  act_item_id: string | null
  /** where a comment on this card is filed: the item's thread, or the shoot's */
  comment_target: { kind: 'item'; id: string } | { kind: 'shoot'; id: string } | null
  comments: PortalCardComment[]
  /** the item's own status — null on a shoot */
  status: ItemStatus | null
  /** the plan, on the same card */
  shoot?: {
    date_label: string | null
    location: string | null
    concept: string | null
    planned_deliverables: PlannedDeliverable[]
    shot_list: ShotRow[]
    board_cards: number
    /** the planning board itself, the same cards the team's page draws — the
     *  portal renders it read-only, open, under the shoot's card. Empty for
     *  an unshared shoot. */
    canvas_cards: CanvasCard[]
    board_name: string | null
    shared: boolean
    /** the plan's brief item — the signed-in portal files a comment on it,
     *  having no token for the shoot's own thread */
    brief_item_id: string | null
  }
}

export type PortalData = {
  /** `timezone` is the client's own — every posting time on the portal is
   *  rendered in it, and "this month" is counted by its calendar. */
  client: { id: string; name: string; timezone: string }
  /** the board: every piece and every shoot, one card each, in column order */
  cards: PortalCard[]
  /** the client's logo, from the profile the team keeps — null when none */
  brand_logo_url: string | null
  /** the name of the account manager assigned to this client, when there is
   *  one — the portal says a person's name instead of an org-chart role */
  am_name: string | null
  /** the client's scanned brand profile — the portal dresses in it */
  brand: Record<string, unknown> | null
  commitment: {
    month: number; year: number
    quotas: { type: string; quota: number; published: number }[]
  } | null
  needs_review: PortalItem[]
  /** approved pieces whose FINAL POST — the caption and the timing — is
   *  waiting on the client's sign-off. Distinct from needs_review: the work
   *  was approved earlier; this is the post as it will actually appear. */
  post_approvals: PortalItem[]
  /** shoot plans sitting with the client for approval — they need reviewing
   *  too, and the hero counter counts both */
  plans_awaiting: number
  /** the client asked for changes and the team is making them — its own pile,
   *  because "did my note land?" is the only question that matters then */
  changes_requested: PortalItem[]
  in_production: PortalItem[]
  approved: PortalItem[]
  scheduled: PortalItem[]
  published: PortalItem[]
  /** the month's work added up — the line under the Published heading */
  published_totals: MonthTotals
  /** …and the same month cut by what the piece is, because a Reel's plays and
   *  a graphic's reach are not the same number and must not be summed */
  published_by_type: TypeTotals[]
  shoots: PortalShoot[]
  /** the client's own intake answers, but only the forms a manager toggled to
   *  "show on the client portal" — most recent first. Empty for nearly every
   *  client, and an empty list means the portal shows NO intake tab at all. */
  intake: PortalIntakeForm[]
  /** the client's followers — only when their manager switched "Show
   *  followers to the client" on; null otherwise, and the portal shows
   *  no Followers section at all */
  followers?: PortalFollowers | null
}

/**
 * The client's toggled-on intake forms, read TOLERANTLY.
 *
 * This is its OWN read, so any failure degrades to "no intake tab" without
 * touching the rest of the portal. The portal going down over one not-yet-
 * migrated field has happened before.
 */
async function loadPortalIntake(clientId: string): Promise<PortalIntakeForm[]> {
  try {
    const rows = await table<IntakeForm>('intake_forms').list({
      by: { client_id: clientId },
      where: r => r.show_on_portal === true,
      orderBy: [['created_at', 'desc']],
    })
    return portalIntakeForms(rows as unknown as Parameters<typeof portalIntakeForms>[0])
  } catch {
    return []
  }
}

/** The first name of the manager this client deals with, or null. Shared by
 *  the portal home and the child pages so they name the same person. */
export async function accountManagerName(clientId: string): Promise<string | null> {
  let joined: { team_users: Record<string, unknown> | null }[]
  try {
    const links = await table<TeamUserClient>('team_user_clients')
      .list({ by: { client_id: clientId } })
    joined = await attachOne(links, 'team_user_id', 'team_users', ['name', 'role', 'active_status'])
  } catch {
    return null
  }
  const managers = joined
    .map(r => r.team_users as unknown as { name: string | null; role: string | null; active_status: boolean | null })
    .filter(u => u && u.active_status !== false && (u.role === 'account_manager' || u.role === 'super_admin'))
  const am = managers.find(u => u.role === 'account_manager') ?? managers[0] ?? null
  return (am?.name ?? '').trim().split(/\s+/)[0] || null
}

export async function getPortalData(clientId: string): Promise<PortalData | null> {
  const now = new Date()

  // The zone has to be read BEFORE "this month" can be worked out: on the last
  // night of a month the server's idea of the date and the client's are one
  // day and one month apart, and the commitment tiles would show the wrong
  // month's quota to the only person who cares about it.
  const clientRow = await table<Client>('clients').get(clientId) as Record<string, unknown> | null
  if (!clientRow) return null
  const tz = safeZone(clientRow.timezone as string | null)
  const { month, year } = monthInZone(now, tz) ?? { month: now.getMonth() + 1, year: now.getFullYear() }

  const [itemRows, commitmentRow, brandRow, shootRows, amRes, intake, followers] = await Promise.all([
    table<ContentItem>('content_items')
      .list({ by: { client_id: clientId }, orderBy: [['updated_at', 'desc']], limit: 300 })
      .then(rows => attachOne(rows, 'work_kind_id', 'work_kinds', ['slug', 'uses_media', 'name'])),
    table<MonthlyCommitment>('monthly_commitments')
      .list({ by: { client_id: clientId }, where: r => r.month === month && r.year === year, limit: 1 })
      .then(r => r[0] ?? null),
    table('client_brand').list({ by: { client_id: clientId }, limit: 1 }).then(r => r[0] ?? null),
    // shoots an AM chose to share — plus any BOOKED shoot: a client should
    // always know their shoot is locked in (date, location), even before the
    // working plan is shared. A failure degrades to none.
    // ONE SHOOT IS ONE CARD, booked through wrapped — so a wrapped shoot stays
    // on the board as the same card, saying so, rather than vanishing
    table<Batch>('batches').list({
      by: { client_id: clientId },
      where: r => r.shared_with_client === true || ['locked', 'shot', 'wrapped'].includes(r.status ?? ''),
      orderBy: [['shoot_date', 'desc']],
      limit: 6,
    }).catch(() => [] as Batch[]),
    // who the client actually deals with — read alongside everything else
    accountManagerName(clientId),
    // the toggled-on intake forms — its own tolerant read (see loadPortalIntake)
    loadPortalIntake(clientId),
    // who follows — only when switched on for this client; its own tolerant read
    loadPortalFollowers(clientId),
  ])
  type KindRow = { slug?: string | null; uses_media?: boolean | null } | null
  // a shoot BRIEF is internal planning work riding the item pipeline — the
  // client sees the shoot in SHOOT PLANS, never as a mystery "other" card
  const isBrief = (i: { work_kinds?: KindRow }) =>
    (i.work_kinds?.slug ?? '') === 'shoot_brief'
  // …and neither is any other work with nothing to post: research, strategy,
  // admin. The client's lists are the things they were promised.
  const isInternal = (i: { work_kinds?: KindRow }) =>
    isBrief(i) || isInternalKind(i.work_kinds)
  const items = itemRows.filter(i => !isInternal(i as unknown as { work_kinds?: KindRow }))
  // …except when the plan is with the client: the brief stays out of the item
  // lists, but its decision has to reach the shoot card it belongs to
  const briefByBatch = new Map<string, { id: string; status: string }>()
  for (const i of itemRows) {
    const row = i as unknown as { id: string; status: string; batch_id?: string | null; work_kinds?: { slug?: string } | null }
    // the newest wins: items come back updated_at desc, so the first brief
    // seen for a shoot is its current one
    if (isBrief(row) && row.batch_id && !briefByBatch.has(row.batch_id)) {
      briefByBatch.set(row.batch_id, { id: row.id, status: row.status })
    }
  }

  const ids = items.map(i => i.id)
  // a piece can be pulled back out of the client's review by a new version
  // landing on it (workflow-core's one `auto` edge). "In production" is the
  // honest word for where it then is, but on its own it is also the word for a
  // piece they have never seen — so the last thing that happened to it is read
  // back out of the trail, for the handful of items sitting at internal_review.
  const backIds = items
    .filter(i => (i.status as ItemStatus) === 'internal_review')
    .map(i => i.id)
  const [versionRows, scheduleRows, analyticsByItem, activityRows] = await Promise.all([
    ids.length
      ? table<AssetVersion>('asset_versions')
          .list({ where: r => ids.includes(r.item_id), orderBy: [['version_number', 'desc']] })
      : Promise.resolve([] as AssetVersion[]),
    ids.length
      ? table<ScheduleEntry>('schedule_entries').list({ where: r => ids.includes(r.item_id) })
      : Promise.resolve([] as ScheduleEntry[]),
    // the cached per-post numbers; the cron keeps them fresh, and the
    // background refresh below shortens the wait for a post that just landed
    analyticsForItems(ids),
    backIds.length
      ? table<WorkflowActivity>('workflow_activity').list({
          where: r => r.entity_type === 'content_item' && r.action === 'status_change'
            && backIds.includes(r.entity_id),
          orderBy: [['created_at', 'desc']],
          // newest first, so the first row seen for an item IS its last move;
          // a bound this generous only ever drops rows that could not have won
          limit: 500,
        })
      : Promise.resolve([] as WorkflowActivity[]),
  ])

  // latest version per item (rows are ordered desc — first wins)
  const latestByItem = new Map<string, { file_url: string; files?: unknown; drive_url: string }>()
  for (const v of versionRows) {
    if (!latestByItem.has(v.item_id)) latestByItem.set(v.item_id, v)
  }
  // the LAST status change per item — rows come back newest first, first wins
  const lastChangeByItem = new Map<string, LastStatusChange>()
  for (const a of activityRows) {
    if (!lastChangeByItem.has(a.entity_id)) {
      lastChangeByItem.set(a.entity_id, { old_value: a.old_value, new_value: a.new_value })
    }
  }
  const scheduleByItem = new Map<string, PortalItem['schedule']>()
  for (const s of scheduleRows) {
    const list = scheduleByItem.get(s.item_id) ?? []
    list.push({ platform: s.platform, scheduled_at: s.scheduled_at, live_url: s.live_url })
    scheduleByItem.set(s.item_id, list)
  }

  const toPortal = (i: (typeof items)[number]): PortalItem => {
    const status = i.status as ItemStatus
    const latest = latestByItem.get(i.id)
    // clients only get preview media once the item has reached client review
    const clientFacing = !['draft_uploaded', 'internal_review', 'revision_required', 'revision_complete'].includes(status)
    const a = status === 'published' ? analyticsByItem.get(i.id) ?? null : null
    // the whole carousel, so the card can show it is one — three thumbnails
    // and a count is enough; the rest is what opening it is for
    const slides = clientFacing ? slidesOf(latest) : []
    return {
      id: i.id,
      title: i.title,
      content_type: i.content_type,
      status,
      // a booked post says so — see clientStatusWord
      status_label: clientStatusWord(status, CLIENT_LABELS[status]),
      updated_at: i.updated_at,
      preview_url: clientFacing ? slides[0]?.url || latest?.file_url || null : null,
      drive_url: clientFacing ? latest?.drive_url || null : null,
      preview_slides: slides.slice(0, 3).map(s => ({ url: s.url, type: s.type })),
      slides: slides.map(s => ({ url: s.url, type: s.type, name: s.name })),
      slide_count: slides.length,
      progress_line: progressLine(status, lastChangeByItem.get(i.id) ?? null),
      schedule: scheduleByItem.get(i.id) ?? [],
      metrics: a
        ? {
          views: a.views, reach: a.reach, impressions: a.impressions, likes: a.likes,
          comments: a.comments, shares: a.shares, saves: a.saves,
          engagement_rate: a.engagement_rate,
          sync_status: a.sync_status,
          synced_at: a.synced_at,
          post_url: a.platform_post_url,
          published_at: a.published_at,
          performance: portalPerformance(readPerformance(a.performance)),
        }
        : null,
    }
  }

  const bucket = (statuses: ItemStatus[]) =>
    items.filter(i => statuses.includes(i.status as ItemStatus)).map(toPortal)

  // published counts by type for the current month's quota bars
  const publishedThisMonth = items.filter(i => i.status === 'published')
  const countType = (t: string) => publishedThisMonth.filter(i => i.content_type === t).length
  const c = commitmentRow
  const commitment = c
    ? {
        month, year,
        quotas: (
          [
            ['reel', c.reel_quota], ['carousel', c.carousel_quota], ['story', c.story_quota],
            ['static', c.static_quota], ['other', c.other_quota],
          ] as [string, number][]
        )
          .filter(([, q]) => q > 0)
          .map(([type, quota]) => ({ type, quota, published: countType(type) })),
      }
    : null

  const shoots: PortalShoot[] = shootRows.map(b => {
    const shared = b.shared_with_client === true
    const brief = briefByBatch.get(b.id)
    return {
      id: b.id,
      title: b.title,
      status_label: shootStatusLabel(b.status as string),
      shoot_date: b.shoot_date ?? null,
      location: b.location ?? null,
      // an unshared booked shoot shows the fact, never the working detail
      concept: shared ? b.concept ?? null : null,
      board_name: shared ? b.board_name ?? null : null,
      planned_deliverables: shared ? sanitisePlannedDeliverables(b.planned_deliverables) : [],
      shot_list: shared ? sanitiseShotList(b.shot_list) : [],
      // the board goes with the plan, by the owner's rule: a shared shoot
      // shows its planning board, open, always. `share_board` stays on the
      // row so old data still parses; it no longer hides anything.
      canvas_cards: shared ? sanitiseCanvasCards(b.canvas_cards) : [],
      details_shared: shared,
      // only a shared plan can be decided on — approving something you were
      // never shown is not a decision
      awaiting_decision: shared && brief?.status === 'client_review'
        ? { item_id: brief.id }
        : null,
      plan_state: planState(brief?.status, b.status as string, shared),
      brief_item_id: brief?.id ?? null,
    }
  })

  // ── posts waiting on the client's FINAL sign-off (caption + timing) ──
  // Read on its own so the page never depends on fields that may not exist
  // yet: an item that has never been through final-post approval simply has
  // no posting_approval_state written, and this pile stays empty for it.
  const approvalCandidates = items
    .filter(i => ['approved_for_scheduling', 'scheduled'].includes(i.status as string))
    .map(i => i.id)
  const captionByAwaiting = new Map<string, string | null>()
  if (approvalCandidates.length > 0) {
    try {
      const gateRows = await table<ContentItem>('content_items')
        .list({ where: r => approvalCandidates.includes(r.id) })
      for (const r of gateRows) {
        if (awaitsClientPostApproval(r as unknown as Record<string, unknown>)) {
          captionByAwaiting.set(r.id, r.caption ?? null)
        }
      }
    } catch { /* the gate is not set up on this database — the pile stays empty */ }
  }
  const post_approvals: PortalItem[] = items
    .filter(i => captionByAwaiting.has(i.id))
    .map(i => ({ ...toPortal(i), caption: captionByAwaiting.get(i.id) ?? null }))

  const published = bucket(['published'])
  // published_at comes from the POST, not the item: an item's updated_at moves
  // every time anyone touches it, and "this month" must mean the month it went
  // out in.
  const publishedRows = published
    .filter(p => p.metrics)
    .map(p => ({ ...p.metrics!, content_type: p.content_type }))

  // ── the board: one card per piece, one card per shoot ──────────────────
  // Comments are pinned to the card they are about. The client sees only
  // client-visible item comments and the shoot's own thread; both reads are
  // tolerant, because a thread that cannot be read is an empty thread, not a
  // portal that cannot load.
  type CommentRow = { id: string; created_at: string; body: string; item_id?: string; batch_id?: string; card_id?: string | null; team_users: { name?: string | null; role?: string | null } | null }
  const facingIds = items.filter(i => isClientFacing(i.status as ItemStatus)).map(i => i.id)
  const briefIds = [...briefByBatch.values()].map(b => b.id)
  const commentItemIds = [...new Set([...facingIds, ...briefIds])]
  const shootIds = shootRows.filter(b => b.shared_with_client === true).map(b => b.id)
  const [itemCommentRows, shootCommentRows] = await Promise.all([
    commentItemIds.length
      ? table<ItemComment>('item_comments').list({
          where: r => commentItemIds.includes(r.item_id) && r.visibility === 'client',
          orderBy: [['created_at', 'asc']],
          limit: 500,
        }).then(rows => attachOne(rows, 'author_id', 'team_users', ['name', 'role'])).catch(() => [])
      : Promise.resolve([]),
    shootIds.length
      ? table<BatchComment>('batch_comments').list({
          where: r => shootIds.includes(r.batch_id),
          orderBy: [['created_at', 'asc']],
          limit: 500,
        }).then(rows => attachOne(rows, 'author_id', 'team_users', ['name', 'role'])).catch(() => [])
      : Promise.resolve([]),
  ])
  const asComment = toPortalComment(clientRow.name as string)
  const commentsByItem = new Map<string, PortalCardComment[]>()
  for (const r of itemCommentRows as unknown as CommentRow[]) {
    const list = commentsByItem.get(r.item_id!) ?? []
    list.push(asComment(r))
    commentsByItem.set(r.item_id!, list)
  }
  // the board each shoot shares, read once — a pinned comment names its card
  const boardByShoot = new Map<string, CanvasCard[]>()
  for (const b of shootRows) {
    boardByShoot.set(b.id, b.shared_with_client === true ? sanitiseCanvasCards(b.canvas_cards) : [])
  }
  const commentsByShoot = new Map<string, PortalCardComment[]>()
  for (const r of shootCommentRows as unknown as CommentRow[]) {
    const list = commentsByShoot.get(r.batch_id!) ?? []
    const c = asComment(r)
    if (c.card_id) c.card_label = canvasCardLabel(findCanvasCard(boardByShoot.get(r.batch_id!) ?? [], c.card_id))
    list.push(c)
    commentsByShoot.set(r.batch_id!, list)
  }

  const workCards: PortalCard[] = items.map(i => {
    const p = toPortal(i)
    const facing = isClientFacing(p.status)
    const booked = p.schedule.find(s => s.scheduled_at && !s.live_url)
    const live = p.schedule.find(s => s.live_url)?.live_url ?? p.metrics?.post_url ?? null
    const postedWhen = booked ? scheduledWhen(booked.scheduled_at, tz) : null
    // the link the team pasted on the card (`link_url`, labelled by its
    // stored `link_kind`) wins; the item's old Drive mirror field and the
    // latest version's Drive link are fallbacks for cards made before it
    const row = i as { link_url?: string | null; link_kind?: string | null; drive_url?: string | null; caption?: string | null; work_kinds?: { name?: string | null } | null }
    const pasted = facing ? row.link_url || null : null
    const url = facing ? (pasted || row.drive_url || p.drive_url || null) : null
    const kind = pasted ? row.link_kind ?? null : null
    return {
      kind: 'work',
      id: p.id,
      title: p.title,
      word: row.work_kinds?.name?.trim() || kindWord(p.content_type),
      caption: facing && typeof row.caption === 'string' && row.caption.trim() ? row.caption.trim() : null,
      column: portalColumnFor(p.status),
      tone: portalCardTone(p.status),
      line: cardLine(p.status, { postedWhen, progress: p.progress_line }),
      link: linkFor(url, kind),
      pdf: false,
      preview_url: p.preview_url,
      slides: p.slides,
      updated_at: p.updated_at,
      posted_when: postedWhen,
      live_url: live,
      metrics: p.metrics,
      actions: portalActions(p.status),
      act_item_id: p.id,
      comment_target: facing ? { kind: 'item', id: p.id } : null,
      comments: facing ? commentsByItem.get(p.id) ?? [] : [],
      status: p.status,
    }
  })

  const shootCards: PortalCard[] = shootRows.map(b => {
    const shared = b.shared_with_client === true
    const brief = briefByBatch.get(b.id)
    const dateLabel = shootDayLabel(b.shoot_date ?? null)
    const standing = shootStanding({
      sharedWithClient: shared, briefStatus: brief?.status, shootStatus: b.status as string, dateLabel,
    })
    const shootComments = shared
      ? [...(commentsByShoot.get(b.id) ?? []), ...(brief ? commentsByItem.get(brief.id) ?? [] : [])]
          .sort((x, y) => x.created_at.localeCompare(y.created_at))
      : []
    return {
      kind: 'shoot',
      id: b.id,
      caption: null,
      title: b.title,
      word: 'Shoot',
      column: standing.column,
      tone: standing.tone,
      line: standing.line,
      link: null,
      pdf: shared,
      preview_url: null,
      slides: [],
      updated_at: (b as { updated_at?: string }).updated_at ?? b.created_at ?? '',
      posted_when: null,
      live_url: null,
      metrics: null,
      actions: standing.actions,
      // the decision acts on the plan's brief item — the same item the
      // dashboard moves, through the same state machine
      act_item_id: standing.actions.approve && brief ? brief.id : null,
      comment_target: shared ? { kind: 'shoot', id: b.id } : null,
      comments: shootComments,
      status: null,
      shoot: {
        date_label: dateLabel,
        location: b.location ?? null,
        // an unshared booked shoot shows the fact, never the working detail
        concept: shared ? b.concept ?? null : null,
        planned_deliverables: shared ? sanitisePlannedDeliverables(b.planned_deliverables) : [],
        shot_list: shared ? sanitiseShotList(b.shot_list) : [],
        board_cards: (boardByShoot.get(b.id) ?? []).length,
        canvas_cards: boardByShoot.get(b.id) ?? [],
        board_name: shared ? b.board_name ?? null : null,
        shared,
        brief_item_id: shared ? brief?.id ?? null : null,
      },
    }
  })
  // the card waiting on the client first, then newest first — the same order
  // sortForColumn gives pieces, said in terms a shoot card shares
  const cards = [...workCards, ...shootCards].sort((a, b) =>
    (Number(b.actions.approve) - Number(a.actions.approve)) || b.updated_at.localeCompare(a.updated_at))

  // freshen anything stale once the response is out — never before it
  refreshStaleAnalyticsInBackground(clientId)

  return {
    client: { id: clientRow.id as string, name: clientRow.name as string, timezone: tz },
    cards,
    brand_logo_url: brandLogoUrl(clientRow.brand_profile ? normaliseProfile(clientRow.brand_profile) : null),
    am_name: amRes,
    // the team's edited profile once it exists (in the scan's shape, which is
    // what the theme reads), the raw scan until then
    brand: clientRow.brand_profile
      ? (toScanShape(normaliseProfile(clientRow.brand_profile)) as Record<string, unknown>)
      : (brandRow?.profile as Record<string, unknown> | undefined) ?? null,
    commitment,
    needs_review: bucket(['client_review']),
    post_approvals,
    // a shoot plan waiting on the client is a thing waiting on the client. The
    // hero counter read "NEEDS YOUR REVIEW 00" over a plan asking them to
    // approve it, which is the page contradicting itself.
    plans_awaiting: shoots.filter(s => s.plan_state === 'awaiting_you').length,
    changes_requested: bucket(['client_changes_requested']),
    in_production: bucket(['draft_uploaded', 'internal_review', 'revision_required', 'revision_complete']),
    approved: bucket(['approved_for_scheduling']),
    scheduled: bucket(['scheduled']),
    published,
    // "this month" is the client's month, counted on the client's calendar —
    // a post that went out at 11 pm on 31 August is August's, wherever the
    // server happened to be standing
    published_totals: monthTotals(publishedRows, now, tz),
    published_by_type: typeTotals(publishedRows, now, tz),
    shoots,
    intake,
    followers,
  }
}

export async function getPortalDataByToken(token: string): Promise<PortalData | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null
  const row = (await table<Client>('clients').list({ where: r => r.share_token === token, limit: 1 }))[0]
  if (!row) return null
  return getPortalData(row.id)
}
