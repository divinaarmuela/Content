import 'server-only'
import { sanitiseScripts } from './script-core'
import { table } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type {
  AssetVersion, Batch, BatchComment, ContentItem, ItemComment, PostComment, PostVersion, SocialAccount, SocialPost,
  TeamUser as TeamUserRow, WorkflowActivity,
} from '@/lib/db-types'
import { CLIENT_LABELS, type ItemStatus } from './workflow-core'
import {
  sanitiseCanvasCards, sanitiseShotList, sanitisePlannedDeliverables,
} from './batch-brief-core'
import { accountManagerName, type PortalItem, type PortalShoot } from './portal-data'
import { isInternalKind } from './task-kind-core'
import { clientStatusWord, planState, progressLine, shootStatusLabel } from './portal-words'
import { slidesOf } from './version-files-core'
import {
  clientHadEdit, clientPostNotes, clientPostView, pieceReachedClient, postLiveLinks, postTypeLine,
  instagramGrid, postedAt, readFrozenPost, reviewFiles, type ClientPostView, type PortalPostNote,
} from './portal-core'
import { networkName } from './publish-core'
import { postVersionId, readPostState, type PostState } from './post-stage-core'
import { frozenFilesForClient } from './edit-freeze-core'
import { belongsToPortal } from './portal-owner-core'
import { scheduledWhen } from './portal-words'
import { safeZone } from './timezone-core'
import { buildPostPreview, clientPreviews, type ClientPreview } from './post-preview-core'
import { optionsFromExtras, readPerChannel } from './schedule-compose-core'
import { canvasCardLabel, findCanvasCard } from './canvas-comments-core'
import { portalOwnerByToken } from './portal-owner'
import { forTheClient } from './comment-visibility-core'

/**
 * Child-page data for the portal: one item or one shoot, with its comment
 * thread. Same stripping rules as the portal home — clients only ever see
 * client-visible comments and client-facing media.
 */

export type PortalComment = {
  id: string
  created_at: string
  body: string
  author_name: string
  from_team: boolean
  /** the planning-board card this is pinned to; null = the general thread */
  card_id?: string | null
  /** that card, in a person's words */
  card_label?: string | null
}

export type PortalItemDetail = {
  client: { id: string; name: string }
  am_name: string | null
  /** the full card shape — the detail page carries the same Approve /
   *  Request changes block as the list, so it needs the same fields */
  item: PortalItem
  comments: PortalComment[]
}

export type PortalShootDetail = {
  client: { id: string; name: string }
  am_name: string | null
  shoot: PortalShoot
  comments: PortalComment[]
}

export async function resolvePortalClient(rawToken: string) {
  // the client's token, or one of their people's (15 Sep 2026)
  const owner = await portalOwnerByToken(rawToken)
  return owner ? { id: owner.client.id, name: owner.client.name, token: owner.token } : null
}

type AuthorRow = { name: string | null; role: string | null } | null

const toComment = (clientName: string) => (c: {
  id: string; created_at: string; body: string; card_id?: string | null; team_users: AuthorRow
}): PortalComment => {
  const role = c.team_users?.role ?? 'client'
  const fromTeam = role !== 'client'
  return {
    id: c.id,
    created_at: c.created_at,
    body: c.body,
    // the portal identity is named "<client> (client portal)" — clients just
    // see their own company name; team authors keep their real name
    author_name: fromTeam ? (c.team_users?.name ?? 'MD Media') : clientName,
    from_team: fromTeam,
    card_id: c.card_id ?? null,
  }
}

export async function getPortalItemDetail(rawToken: string, itemId: string): Promise<PortalItemDetail | null> {
  const client = await resolvePortalClient(rawToken)
  if (!client) return null
  const itemRow = await table<ContentItem>('content_items').get(itemId)
  const item = itemRow && itemRow.client_id === client.id
    ? (await attachOne([itemRow], 'work_kind_id', 'work_kinds', ['slug', 'uses_media']))[0]
    : null
  // an internal brief task is not a client-facing item — same rule as the
  // portal overview: the shoot itself lives in SHOOT PLANS, and no other
  // internal work (research, strategy, admin) is the client's content either
  const kind = item?.work_kinds as { slug?: string | null; uses_media?: boolean | null } | null
  if (!item || kind?.slug === 'shoot_brief' || isInternalKind(kind)) return null

  const status = item.status as ItemStatus
  // media only once the piece reached THEM — an edit the team approved and
  // never sent carries none (audit P7, P8)
  const clientFacing = pieceReachedClient(item as never)
  const [version, comments, amName, lastMove] = await Promise.all([
    clientFacing
      ? table<AssetVersion>('asset_versions')
          .list({ by: { item_id: item.id }, orderBy: [['version_number', 'desc']], limit: 1 })
          .then(r => r[0] ?? null)
      : Promise.resolve(null),
    table<ItemComment>('item_comments')
      .list({
        by: { item_id: item.id },
        where: r => r.visibility === 'client',
        orderBy: [['created_at', 'asc']],
        limit: 200,
      })
      // the author, not the assignee — both are team_users ids on the row
      .then(rows => attachOne(rows, 'author_id', 'team_users', ['name', 'role'])),
    accountManagerName(client.id),
    // the piece may have been pulled back out of the client's own review by a
    // new cut landing on it. This page is where they arrive from the email
    // they were sent about it, so it is the last place that may go quiet.
    status === 'internal_review'
      ? table<WorkflowActivity>('workflow_activity').list({
          where: r => r.entity_type === 'content_item' && r.entity_id === item.id
            && r.action === 'status_change',
          orderBy: [['created_at', 'desc']],
          limit: 1,
        }).then(r => r[0] ?? null)
      : Promise.resolve(null),
  ])
  const latest = version as { file_url?: string; files?: unknown; drive_url?: string } | null
  // the conversation is about the whole post: a carousel's cards belong on the
  // page the client is looking at while they write "the third one is wrong"
  const slides = slidesOf(latest)

  return {
    client: { id: client.id, name: client.name },
    am_name: amName,
    item: {
      id: item.id,
      title: item.title,
      content_type: item.content_type,
      status,
      // the same word the overview card uses. Raw CLIENT_LABELS calls a booked
      // post "Approved", so a client tapped a card marked Scheduled and landed
      // on a page headed Approved — one item, two states, on two screens.
      status_label: clientStatusWord(status, CLIENT_LABELS[status]),
      updated_at: item.updated_at,
      preview_url: slides[0]?.url ?? latest?.file_url ?? null,
      drive_url: latest?.drive_url ?? null,
      preview_slides: slides.slice(0, 3).map(s => ({ url: s.url, type: s.type })),
      slides: slides.map(s => ({ url: s.url, type: s.type, name: s.name })),
      adhoc_post: (item as { adhoc_post?: unknown }).adhoc_post === true,
      slide_count: slides.length,
      progress_line: progressLine(status, lastMove),
      schedule: [],
      // this page is the conversation about one piece, not its scoreboard —
      // the numbers live on the card in the Published section
      metrics: null,
    },
    comments: (comments as unknown as {
      id: string; created_at: string; body: string; team_users: AuthorRow
    }[]).map(toComment(client.name)),
  }
}

export async function getPortalShootDetail(rawToken: string, batchId: string): Promise<PortalShootDetail | null> {
  const client = await resolvePortalClient(rawToken)
  if (!client) return null
  const batch = await table<Batch>('batches').get(batchId)
  const b = batch && batch.client_id === client.id ? batch : null
  // an unshared shoot is simply not there, as far as the client can tell
  if (!b || !b.shared_with_client) return null

  // thread degrades to empty until the batch_comments migration runs
  const [comments, briefRows, amName] = await Promise.all([
    table<BatchComment>('batch_comments')
      .list({ by: { batch_id: b.id }, orderBy: [['created_at', 'asc']], limit: 200 })
      .then(rows => attachOne(rows, 'author_id', 'team_users', ['name', 'role']))
      // THE PLAN'S THREAD IS THE TEAM'S (22 Sep 2026): the client sees the board's card comments and their own words
      .then(rows => forTheClient(rows as never[]))
      .catch(() => []),
    // the plan's own brief task, at WHATEVER stage it is at: at client_review
    // the page has to carry the two moves the state machine says are theirs,
    // and at every other stage it has to say what became of the last one
    table<ContentItem>('content_items')
      .list({
        by: { batch_id: b.id },
        where: r => r.client_id === client.id,
        orderBy: [['updated_at', 'desc']],
        limit: 10,
      })
      .then(rows => attachOne(rows, 'work_kind_id', 'work_kinds', ['slug'])),
    accountManagerName(client.id),
  ])
  const brief = (briefRows as unknown as { id: string; status: string; work_kinds: { slug?: string } | null }[])
    .find(r => (r.work_kinds as { slug?: string } | null)?.slug === 'shoot_brief')
  // the board goes with the plan BY DEFAULT, but a shoot whose switch was
  // deliberately turned off keeps it off — see portal-data.ts
  const canvasCards = (b as { share_board?: boolean | null }).share_board !== false
    ? sanitiseCanvasCards(b.canvas_cards) : []
  const asComment = toComment(client.name)

  return {
    client: { id: client.id, name: client.name },
    am_name: amName,
    shoot: {
      id: b.id,
      title: b.title,
      status_label: shootStatusLabel(b.status as string),
      shoot_date: b.shoot_date ?? null,
      location: b.location ?? null,
      concept: b.concept ?? null,
      board_name: b.board_name ?? null,
      planned_deliverables: sanitisePlannedDeliverables(b.planned_deliverables),
      shot_list: sanitiseShotList(b.shot_list),
      scripts: sanitiseScripts(b.scripts),
      canvas_cards: canvasCards,
      details_shared: true, // this page only exists for shared shoots
      awaiting_decision: brief?.status === 'client_review' ? { item_id: brief.id } : null,
      plan_state: planState(brief?.status, b.status as string, true),
      brief_item_id: brief?.id ?? null,
    },
    comments: (comments as unknown as {
      id: string; created_at: string; body: string; card_id?: string | null; team_users: AuthorRow
    }[]).map(r => {
      const c = asComment(r)
      if (c.card_id) c.card_label = canvasCardLabel(findCanvasCard(canvasCards, c.card_id))
      return c
    }),
  }
}

/** the same mapping for a team board's comments (portal-team-board.ts, 22 Sep 2026) */
export const toPortalComment = toComment

/* ── FOR YOUR APPROVAL: the EDIT a "Send to client" email opens (28 Sep 2026) ──
 *
 * Since the posting rebuild (29 Sep 2026) this is the EDIT's page only. A POST
 * has its own page (`getPortalPostPage`, below), read from its stage and its
 * frozen version; nothing here reads the edit card's posting fields any more.
 */
export type PortalApproval = {
  client: { id: string; name: string }
  am_name: string | null
  title: string
  /** every picture or clip the client is being asked about, in order */
  slides: { url: string; name?: string; type?: 'image' | 'video' }[]
  caption: string
  /** waiting = theirs to answer now; approved / changes = already answered; not_ready = not with them yet */
  state: 'waiting' | 'approved' | 'changes' | 'not_ready'
  /** always the edit now; a post opens its own page */
  kind: 'card'
  /** "Carousel · 14 slides", "Reel", "Video" — what it is, in one line */
  typeLine: string
  whenLine: null
  whereLine: null
  missed?: false
  /** the files were sent before versions were kept: these are the files as they are now (SPEC §2.6) */
  unfrozen?: boolean
  /** the notes on this piece, the client's and the team's — shown beside the slide they are about */
  comments: PortalComment[]
}

const isVideo = (mime: string | null | undefined, name: string) =>
  /^video\//.test(String(mime ?? '')) || /\.(mp4|mov|m4v|webm)$/i.test(name)

/** The edit, sanitised for the client: the files it was FROZEN with when it went to them (audit P1). */
export async function getPortalApproval(rawToken: string, itemId: string): Promise<PortalApproval | null> {
  const detail = await getPortalItemDetail(rawToken, itemId)
  if (!detail) return null
  const row = await table<ContentItem>('content_items').get(itemId).catch(() => null)
  if (!row || row.client_id !== detail.client.id) return null
  const { finalFilesOf, liveFilesAt } = await import('./final-files-core')
  const { clientSeenRound } = await import('./editing-portal-core')
  // the files as they were when the edit went to the client; only a card sent
  // before versions were kept falls back to its files as they are now, and says so
  const frozen = frozenFilesForClient(row as never)
  const live = frozen == null && finalFilesOf(row as never).length > 0 ? liveFilesAt(row as never, clientSeenRound(row as never)) : []
  const files = frozen ?? live.map(f => ({ url: f.url, name: f.name, mime: f.mime }))
  const slides = files.length > 0
    ? files.map(f => ({ url: f.url, name: f.name, type: (isVideo(f.mime, f.name) ? 'video' : 'image') as 'video' | 'image' }))
    : (detail.item.slides ?? []).filter(s => s && s.url).map(s => ({ url: s.url, name: s.name, type: s.type }))
  const status = String(row.status)
  const kindWord = (n: number) => {
    const t = String((row as { content_type?: string | null }).content_type ?? '').toLowerCase()
    const allVideo = n > 0 && slides.every(s => s.type === 'video')
    const word = t === 'carousel' ? 'Carousel' : t === 'reel' ? 'Reel' : t === 'story' ? 'Story' : allVideo ? (n > 1 ? 'Videos' : 'Video') : n > 1 ? 'Carousel' : 'Photo post'
    return n > 1 ? `${word} · ${n} ${allVideo ? 'clips' : 'slides'}` : word
  }

  return {
    client: detail.client,
    am_name: detail.am_name,
    title: String(detail.item.title ?? 'Your post'),
    slides: slides.length > 0 ? slides : (detail.item.preview_url ? [{ url: detail.item.preview_url }] : []),
    caption: String((row as { caption?: string | null }).caption ?? '').trim(),
    // "approved" only for an edit that was theirs to approve: an edit the team
    // passed without them is not something they said yes to (audit P5, P6)
    state: status === 'client_review' ? 'waiting'
      : ['approved_for_scheduling', 'scheduled', 'published'].includes(status) && clientHadEdit(row as never) ? 'approved'
      : status === 'client_changes_requested' ? 'changes'
      : 'not_ready',
    kind: 'card',
    comments: detail.comments,
    typeLine: kindWord(slides.length),
    whenLine: null,
    whereLine: null,
    ...(frozen == null && files.length > 0 ? { unfrozen: true } : {}),
  }
}

/* ══ ONE POST ON THE CLIENT'S PORTAL (the posting rebuild, SPEC §4.4) ══════ */

export type PortalPostPage = {
  client: { id: string; name: string; timezone: string }
  am_name: string | null
  post_id: string
  title: string
  /** what the client sees of it — from its stage only */
  view: ClientPostView
  /** the version shown; the answer carries it and the server refuses any other */
  version: number | null
  /** frozen by the migration, not at a send: "Sent before versions were kept" */
  from_migration: boolean
  /** a live post from before versions were kept, shown as it went out */
  shown_as_posted: boolean
  /** every file they are asked about, each can take a note */
  files: { url: string; name: string; type: 'image' | 'video' }[]
  caption: string
  type_line: string
  /** "Goes out Thu 10 Sept, 6:00 pm", or when it went out */
  when_line: string | null
  networks: string[]
  /** the post as each network will show it, stripped for the client */
  previews: ClientPreview[]
  /** the Client thread on this version, per file and on the whole post */
  notes: PortalPostNote[]
  /** one link per network it went out on */
  links: { platform: string; network: string; url: string }[]
  /** the team's look through the client's eyes: nothing can be pressed */
  preview_mode: boolean
  /** THE INSTAGRAM GRID (decision 16): this post first, then the newest posts
   *  already live on their Instagram — how it will sit on their profile. Null
   *  when the post is not going to Instagram, or it is already out. */
  grid: { url: string; type: 'image' | 'video' }[] | null
}

const NOT_SENT_PREVIEW: ClientPostView = {
  state: 'review', version: null, canAnswer: false,
  headline: 'Preview — the client cannot see this post yet',
  line: 'This is the version they would see. Nothing on this page can be pressed.',
  tone: undefined, column: 'checking',
}

/**
 * ONE POST, FOR ONE SHARE TOKEN — or null. Reads the post's stage and the
 * FROZEN version the client was shown, never the working copy or the edit
 * card (audit P2, P11). Null when the post is not this portal's, not theirs
 * to see (a draft they never had, a post the team approved without sending,
 * audit P3), or has no frozen version to show.
 *
 * `team`: the signed-in team member's preview (?preview=1, checked by the
 * page against Clerk — never taken from the address alone, audit P4). It
 * shows the version the client would see, with nothing to press.
 */
export async function getPortalPostPage(
  rawToken: string, postId: string, opts: { now?: Date; team?: boolean } = {},
): Promise<PortalPostPage | null> {
  const owner = await portalOwnerByToken(rawToken)
  if (!owner) return null
  const client = owner.client
  const row = await table<SocialPost>('social_posts').get(postId).catch(() => null)
  const post = readPostState(row as unknown as Record<string, unknown> | null)
  if (!post || post.client_id !== client.id) return null
  // a person's portal holds only their own pieces' posts
  const item = post.source_item_id ? await table<ContentItem>('content_items').get(post.source_item_id).catch(() => null) : null
  if (item ? !belongsToPortal(item as { for_contact_id?: string | null }, owner.scope) : owner.scope.kind !== 'business') return null

  const now = opts.now ?? new Date()
  const tz = safeZone((client as { timezone?: string | null }).timezone ?? post.timezone ?? null)
  const when = (iso: string | null | undefined) => scheduledWhen(iso ?? null, tz)
  const approver = post.approval?.on_behalf_of_client && post.approval.by
    ? await table<TeamUserRow>('team_users').get(post.approval.by).catch(() => null) : null
  const seen = clientPostView(post, now, { when, nameOf: id => (id && approver?.id === id ? approver.name : null) })
  const preview = opts.team === true
  if (!seen && !preview) return null
  const view: ClientPostView = seen
    ? (preview ? { ...seen, canAnswer: false } : seen)
    : NOT_SENT_PREVIEW
  const version = seen ? seen.version : post.sent_version

  const versionRow = version != null
    ? await table<PostVersion>('post_versions').get(postVersionId(post.id, version)).catch(() => null) : null
  let frozen = readFrozenPost(versionRow as unknown as Record<string, unknown> | null)
  let shownAsPosted = false
  if (!frozen && post.stage === 'posted') {
    // live before versions were kept: what went out is public, so show it as it went
    frozen = readFrozenPost({
      n: version ?? 0, slides: post.slides, per_channel: post.per_channel, channels: post.channels,
      caption: post.caption, scheduled_for: post.scheduled_for, timezone: post.timezone,
    })
    shownAsPosted = true
  }
  // nothing frozen to show: never fall back to the live post (audit P2)
  if (!frozen) return null

  const [accounts, noteRows, amName] = await Promise.all([
    frozen.channels.length
      ? table<SocialAccount>('social_accounts').list({ by: { client_id: client.id } }).catch(() => [] as SocialAccount[])
      : Promise.resolve([] as SocialAccount[]),
    table<PostComment>('post_comments').list({ by: { post_id: post.id } }).catch(() => [] as PostComment[]),
    accountManagerName(client.id),
  ])
  const accountById = new Map(accounts.map(a => [a.id, a]))
  const files = reviewFiles(frozen)
  const networks = [...new Set(frozen.channels.flatMap(id => { const a = accountById.get(id); return a ? [networkName(String(a.platform))] : [] }))]

  let previews: ClientPreview[] = []
  try {
    const perChannel = readPerChannel((versionRow as { per_channel?: unknown } | null)?.per_channel ?? (shownAsPosted ? post.per_channel : null))
    const built = buildPostPreview({
      caption: frozen.caption,
      media: frozen.slides.map(sl => ({ url: sl.url, type: sl.type, name: sl.name })),
      channels: frozen.channels.flatMap(id => {
        const a = accountById.get(id)
        if (!a) return []
        const own = frozen!.per_channel[id]?.slides ?? []
        return [{
          id: a.id, platform: String(a.platform), handle: a.username, name: a.name, avatarUrl: a.avatar_url,
          options: optionsFromExtras(perChannel[id]),
          media: own.length ? own.map(sl => ({ url: sl.url, type: sl.type, name: sl.name })) : null,
          placeName: null,
        }]
      }),
    })
    previews = clientPreviews(built)
  } catch { previews = [] }

  const posted = view.state === 'posted'
  // how it sits on their Instagram: the first picture Instagram gets, before
  // the newest posts already live there (what is live is public)
  let grid: PortalPostPage['grid'] = null
  if (!posted && frozen.channels.some(acc => String(accountById.get(acc)?.platform ?? '') === 'instagram')) {
    const others = await table<SocialPost>('social_posts').list({ by: { client_id: client.id } }).catch(() => [] as SocialPost[])
    grid = instagramGrid(
      { id: post.id, channels: frozen.channels, slides: frozen.slides, per_channel: frozen.per_channel },
      others.map(r => readPostState(r as unknown as Record<string, unknown>)).filter((p): p is PostState => !!p),
      acc => accountById.get(acc)?.platform ?? null,
    )
  }
  return {
    client: { id: client.id, name: client.name, timezone: tz },
    am_name: amName,
    post_id: post.id,
    title: String(item?.title ?? '').trim() || 'Your post',
    view,
    version,
    from_migration: frozen.from_migration,
    shown_as_posted: shownAsPosted,
    files: files.map(f => ({ url: f.url, name: f.name, type: f.type === 'video' ? 'video' : 'image' })),
    caption: frozen.caption,
    type_line: postTypeLine(files, frozen.channels.map(id => frozen!.per_channel[id]?.kind ?? null)),
    when_line: posted ? when(postedAt(post)) : when(post.stage === 'booked' ? (post.booking?.for_time ?? frozen.scheduled_for) : frozen.scheduled_for),
    networks,
    previews,
    // the Client thread only — a team note never reaches this page (decision 9, audit P10)
    notes: clientPostNotes(noteRows, post.id, version, client.name),
    links: posted ? postLiveLinks(post) : [],
    preview_mode: preview,
    grid,
  }
}

/**
 * THE POST AN OLD LINK MEANT. Links sent before the rebuild carry the edit
 * card's id (`/approve/<item id>`). The post of that piece the client can see
 * — the one waiting on them first, else the newest — or null.
 */
export async function portalPostForItem(rawToken: string, itemId: string): Promise<string | null> {
  const owner = await portalOwnerByToken(rawToken)
  if (!owner) return null
  const rows = await table<SocialPost>('social_posts').list({ by: { client_id: owner.client.id } }).catch(() => [] as SocialPost[])
  const now = new Date()
  const mine = rows
    .map(r => readPostState(r as unknown as Record<string, unknown>))
    .filter((p): p is PostState => !!p && p.source_item_id === itemId)
    .map(p => ({ p, view: clientPostView(p, now) }))
    .filter(x => !!x.view)
  const pick = mine.find(x => x.view!.canAnswer)
    ?? [...mine].sort((a, b) => String(b.p.stage_at ?? '').localeCompare(String(a.p.stage_at ?? '')))[0]
  return pick?.p.id ?? null
}
