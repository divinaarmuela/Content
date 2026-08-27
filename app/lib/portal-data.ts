import 'server-only'
import { supabase } from '@/lib/supabase'
import { CLIENT_LABELS, type ItemStatus } from './workflow-core'
import {
  sanitiseCanvasCards, sanitiseShotList, sanitisePlannedDeliverables,
  type CanvasCard, type ShotRow,
} from './batch-brief-core'
import { isInternalKind } from './task-kind-core'
import { slidesOf } from './version-files-core'
import {
  clientStatusWord, planState, progressLine, shootStatusLabel,
  type LastStatusChange, type PlanState,
} from './portal-words'
import { analyticsForItems, refreshStaleAnalyticsInBackground } from './post-analytics'
import {
  monthTotals, typeTotals,
  type MonthTotals, type PostMetrics, type TypeTotals,
} from './post-analytics-core'
import { monthInZone, safeZone } from './timezone-core'
import { normaliseProfile, toScanShape } from './brand-profile-core'

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
}

export type PortalShoot = {
  id: string
  title: string
  status_label: string
  shoot_date: string | null
  location: string | null
  concept: string | null
  board_name: string | null
  planned_deliverables: { type: string; qty: number }[]
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

export type PortalData = {
  /** `timezone` is the client's own — every posting time on the portal is
   *  rendered in it, and "this month" is counted by its calendar. */
  client: { id: string; name: string; timezone: string }
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
}

/** The first name of the manager this client deals with, or null. Shared by
 *  the portal home and the child pages so they name the same person. */
export async function accountManagerName(clientId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('team_user_clients')
    .select('team_users!team_user_clients_team_user_id_fkey(name, role, active_status)')
    .eq('client_id', clientId)
  if (error) return null
  const managers = (data ?? [])
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
  // Columns added by hand-run migrations (timezone, brand_profile) may not
  // exist yet on the live database: asking for a missing column fails the
  // WHOLE select, and a null client here is a 404 for every client's portal.
  // So the select degrades — newest columns first, the bare row last.
  const clientRow = await (async () => {
    for (const cols of ['id, name, timezone, brand_profile', 'id, name, timezone', 'id, name']) {
      const { data, error } = await supabase.from('clients').select(cols).eq('id', clientId).maybeSingle()
      if (!error) return data as Record<string, unknown> | null
      console.error('[portal] client select failed, degrading:', cols, error.message)
    }
    return null
  })()
  if (!clientRow) return null
  const tz = safeZone(clientRow.timezone as string | null)
  const { month, year } = monthInZone(now, tz) ?? { month: now.getMonth() + 1, year: now.getFullYear() }

  const [itemsRes, commitmentRes, brandRes, shootsRes, amRes] = await Promise.all([
    supabase
      .from('content_items')
      .select('id, title, content_type, status, updated_at, batch_id, work_kinds(slug, uses_media)')
      .eq('client_id', clientId)
      .order('updated_at', { ascending: false })
      .limit(300),
    supabase
      .from('monthly_commitments')
      .select('*')
      .eq('client_id', clientId)
      .eq('month', month)
      .eq('year', year)
      .maybeSingle(),
    supabase.from('client_brand').select('profile').eq('client_id', clientId).maybeSingle(),
    // shoots an AM chose to share — plus any BOOKED shoot: a client should
    // always know their shoot is locked in (date, location), even before the
    // working plan is shared. Errors (column not migrated) degrade to none.
    supabase
      .from('batches')
      .select('id, title, status, shoot_date, location, concept, board_name, share_board, shared_with_client, planned_deliverables, shot_list, canvas_cards')
      .eq('client_id', clientId)
      .or('shared_with_client.eq.true,status.in.(locked,shot)')
      .order('shoot_date', { ascending: false, nullsFirst: false })
      .limit(6),
    // who the client actually deals with — read alongside everything else
    accountManagerName(clientId),
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
  const items = (itemsRes.data ?? []).filter(i => !isInternal(i as { work_kinds?: KindRow }))
  // …except when the plan is with the client: the brief stays out of the item
  // lists, but its decision has to reach the shoot card it belongs to
  const briefByBatch = new Map<string, { id: string; status: string }>()
  for (const i of itemsRes.data ?? []) {
    const row = i as { id: string; status: string; batch_id?: string | null; work_kinds?: { slug?: string } | null }
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
  const [versionsRes, scheduleRes, analyticsByItem, activityRes] = await Promise.all([
    ids.length
      ? supabase
          .from('asset_versions')
          .select('item_id, version_number, file_url, files, drive_url')
          .in('item_id', ids)
          .order('version_number', { ascending: false })
      : Promise.resolve({ data: [] as { item_id: string; version_number: number; file_url: string; files: unknown; drive_url: string }[] }),
    ids.length
      ? supabase
          .from('schedule_entries')
          .select('item_id, platform, scheduled_at, live_url')
          .in('item_id', ids)
      : Promise.resolve({ data: [] as { item_id: string; platform: string; scheduled_at: string | null; live_url: string | null }[] }),
    // the cached per-post numbers; the cron keeps them fresh, and the
    // background refresh below shortens the wait for a post that just landed
    analyticsForItems(ids),
    backIds.length
      ? supabase
          .from('workflow_activity')
          .select('entity_id, old_value, new_value, created_at')
          .eq('entity_type', 'content_item')
          .eq('action', 'status_change')
          .in('entity_id', backIds)
          .order('created_at', { ascending: false })
          // newest first, so the first row seen for an item IS its last move;
          // a bound this generous only ever drops rows that could not have won
          .limit(500)
      : Promise.resolve({ data: [] as { entity_id: string; old_value: string | null; new_value: string | null }[] }),
  ])

  // latest version per item (rows are ordered desc — first wins)
  const latestByItem = new Map<string, { file_url: string; files?: unknown; drive_url: string }>()
  for (const v of versionsRes.data ?? []) {
    if (!latestByItem.has(v.item_id)) latestByItem.set(v.item_id, v)
  }
  // the LAST status change per item — rows come back newest first, first wins
  const lastChangeByItem = new Map<string, LastStatusChange>()
  for (const a of activityRes.data ?? []) {
    if (!lastChangeByItem.has(a.entity_id)) {
      lastChangeByItem.set(a.entity_id, { old_value: a.old_value, new_value: a.new_value })
    }
  }
  const scheduleByItem = new Map<string, PortalItem['schedule']>()
  for (const s of scheduleRes.data ?? []) {
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
        }
        : null,
    }
  }

  const bucket = (statuses: ItemStatus[]) =>
    items.filter(i => statuses.includes(i.status as ItemStatus)).map(toPortal)

  // published counts by type for the current month's quota bars
  const publishedThisMonth = items.filter(i => i.status === 'published')
  const countType = (t: string) => publishedThisMonth.filter(i => i.content_type === t).length
  const c = commitmentRes.data
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

  const shoots: PortalShoot[] = (shootsRes.error ? [] : shootsRes.data ?? []).map(b => {
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
      // the board is its own share decision; rows predating the migration
      // (share_board undefined) keep the old behaviour of following the brief
      canvas_cards: shared && (b.share_board ?? true) ? sanitiseCanvasCards(b.canvas_cards) : [],
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

  const published = bucket(['published'])
  // published_at comes from the POST, not the item: an item's updated_at moves
  // every time anyone touches it, and "this month" must mean the month it went
  // out in.
  const publishedRows = published
    .filter(p => p.metrics)
    .map(p => ({ ...p.metrics!, content_type: p.content_type }))

  // freshen anything stale once the response is out — never before it
  refreshStaleAnalyticsInBackground(clientId)

  return {
    client: { id: clientRow.id as string, name: clientRow.name as string, timezone: tz },
    am_name: amRes,
    // the team's edited profile once it exists (in the scan's shape, which is
    // what the theme reads), the raw scan until then
    brand: clientRow.brand_profile
      ? (toScanShape(normaliseProfile(clientRow.brand_profile)) as Record<string, unknown>)
      : (brandRes.data?.profile as Record<string, unknown> | undefined) ?? null,
    commitment,
    needs_review: bucket(['client_review']),
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
  }
}

export async function getPortalDataByToken(token: string): Promise<PortalData | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null
  const { data } = await supabase.from('clients').select('id').eq('share_token', token).maybeSingle()
  if (!data) return null
  return getPortalData(data.id)
}
