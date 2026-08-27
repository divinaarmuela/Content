import 'server-only'
import { supabase } from '@/lib/supabase'
import { CLIENT_LABELS, type ItemStatus } from './workflow-core'
import {
  sanitiseCanvasCards, sanitiseShotList, sanitisePlannedDeliverables,
} from './batch-brief-core'
import { accountManagerName, type PortalItem, type PortalShoot } from './portal-data'
import { isInternalKind } from './task-kind-core'
import { planState, shootStatusLabel } from './portal-words'

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
  const { data } = await supabase
    .from('clients').select('id, name').eq('share_token', token).maybeSingle()
  return data ? { ...data, token } : null
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
  const { data: item } = await supabase
    .from('content_items')
    .select('id, title, content_type, status, updated_at, work_kinds(slug, uses_media)')
    .eq('id', itemId).eq('client_id', client.id)
    .maybeSingle()
  // an internal brief task is not a client-facing item — same rule as the
  // portal overview: the shoot itself lives in SHOOT PLANS, and no other
  // internal work (research, strategy, admin) is the client's content either
  const kind = item?.work_kinds as { slug?: string | null; uses_media?: boolean | null } | null
  if (!item || kind?.slug === 'shoot_brief' || isInternalKind(kind)) return null

  const status = item.status as ItemStatus
  const clientFacing = !['draft_uploaded', 'internal_review', 'revision_required', 'revision_complete'].includes(status)
  const [versionRes, commentsRes, amName] = await Promise.all([
    clientFacing
      ? supabase.from('asset_versions').select('file_url, drive_url')
          .eq('item_id', item.id).order('version_number', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('item_comments')
      // two FKs point at team_users (author, assignee) — name the author one
      .select('id, created_at, body, team_users!item_comments_author_id_fkey(name, role)')
      .eq('item_id', item.id).eq('visibility', 'client')
      .order('created_at', { ascending: true })
      .limit(200),
    accountManagerName(client.id),
  ])
  const latest = versionRes.data as { file_url?: string; drive_url?: string } | null

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
      preview_url: latest?.file_url ?? null,
      drive_url: latest?.drive_url ?? null,
      schedule: [],
    },
    comments: ((commentsRes.data ?? []) as unknown as {
      id: string; created_at: string; body: string; team_users: AuthorRow
    }[]).map(toComment(client.name)),
  }
}

export async function getPortalShootDetail(rawToken: string, batchId: string): Promise<PortalShootDetail | null> {
  const client = await resolvePortalClient(rawToken)
  if (!client) return null
  const { data: b } = await supabase
    .from('batches')
    .select('id, title, status, shoot_date, location, concept, board_name, share_board, planned_deliverables, shot_list, canvas_cards, shared_with_client')
    .eq('id', batchId).eq('client_id', client.id)
    .maybeSingle()
  // an unshared shoot is simply not there, as far as the client can tell
  if (!b || !b.shared_with_client) return null

  // thread degrades to empty until the batch_comments migration runs
  const [commentsRes, briefRes, amName] = await Promise.all([
    supabase.from('batch_comments')
      .select('id, created_at, body, team_users!batch_comments_author_id_fkey(name, role)')
      .eq('batch_id', b.id)
      .order('created_at', { ascending: true })
      .limit(200),
    // the plan's own brief task, at WHATEVER stage it is at: at client_review
    // the page has to carry the two moves the state machine says are theirs,
    // and at every other stage it has to say what became of the last one
    supabase.from('content_items')
      .select('id, status, work_kinds(slug)')
      .eq('batch_id', b.id).eq('client_id', client.id)
      .order('updated_at', { ascending: false })
      .limit(10),
    accountManagerName(client.id),
  ])
  const brief = ((briefRes.data ?? []) as { id: string; status: string; work_kinds: { slug?: string } | null }[])
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
    comments: ((commentsRes.error ? [] : commentsRes.data ?? []) as unknown as {
      id: string; created_at: string; body: string; team_users: AuthorRow
    }[]).map(toComment(client.name)),
  }
}
