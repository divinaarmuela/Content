import 'server-only'
import { table } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type {
  AssetVersion, Batch, BatchComment, Client, ContentItem, ItemComment, WorkflowActivity,
} from '@/lib/db-types'
import { CLIENT_LABELS, type ItemStatus } from './workflow-core'
import {
  sanitiseCanvasCards, sanitiseShotList, sanitisePlannedDeliverables,
} from './batch-brief-core'
import { accountManagerName, type PortalItem, type PortalShoot } from './portal-data'
import { isInternalKind } from './task-kind-core'
import { planState, progressLine, shootStatusLabel } from './portal-words'
import { slidesOf } from './version-files-core'

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
  const token = decodeURIComponent(rawToken).split('--').pop() ?? rawToken
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null
  const row = (await table<Client>('clients').list({ where: r => r.share_token === token, limit: 1 }))[0]
  return row ? { id: row.id, name: row.name, token } : null
}

type AuthorRow = { name: string | null; role: string | null } | null

const toComment = (clientName: string) => (c: {
  id: string; created_at: string; body: string; team_users: AuthorRow
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
  const clientFacing = !['draft_uploaded', 'internal_review', 'revision_required', 'revision_complete'].includes(status)
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
      status_label: CLIENT_LABELS[status],
      updated_at: item.updated_at,
      preview_url: slides[0]?.url ?? latest?.file_url ?? null,
      drive_url: latest?.drive_url ?? null,
      preview_slides: slides.slice(0, 3).map(s => ({ url: s.url, type: s.type })),
      slides: slides.map(s => ({ url: s.url, type: s.type, name: s.name })),
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
      canvas_cards: (b.share_board ?? true) ? sanitiseCanvasCards(b.canvas_cards) : [],
      details_shared: true, // this page only exists for shared shoots
      awaiting_decision: brief?.status === 'client_review' ? { item_id: brief.id } : null,
      plan_state: planState(brief?.status, b.status as string, true),
      brief_item_id: brief?.id ?? null,
    },
    comments: (comments as unknown as {
      id: string; created_at: string; body: string; team_users: AuthorRow
    }[]).map(toComment(client.name)),
  }
}
