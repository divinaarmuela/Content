import 'server-only'
import { supabase } from '@/lib/supabase'
import { CLIENT_LABELS, type ItemStatus } from './workflow-core'
import {
  sanitiseCanvasCards, sanitiseShotList, sanitisePlannedDeliverables,
} from './batch-brief-core'
import type { PortalShoot } from './portal-data'

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
  item: {
    id: string
    title: string
    content_type: string
    status_label: string
    preview_url: string | null
  }
  comments: PortalComment[]
}

export type PortalShootDetail = {
  client: { id: string; name: string }
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
    .select('id, title, content_type, status')
    .eq('id', itemId).eq('client_id', client.id)
    .maybeSingle()
  if (!item) return null

  const status = item.status as ItemStatus
  const clientFacing = !['draft_uploaded', 'internal_review', 'revision_required', 'revision_complete'].includes(status)
  const [versionRes, commentsRes] = await Promise.all([
    clientFacing
      ? supabase.from('asset_versions').select('file_url')
          .eq('item_id', item.id).order('version_number', { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('item_comments')
      // two FKs point at team_users (author, assignee) — name the author one
      .select('id, created_at, body, team_users!item_comments_author_id_fkey(name, role)')
      .eq('item_id', item.id).eq('visibility', 'client')
      .order('created_at', { ascending: true })
      .limit(200),
  ])

  return {
    client: { id: client.id, name: client.name },
    item: {
      id: item.id,
      title: item.title,
      content_type: item.content_type,
      status_label: CLIENT_LABELS[status],
      preview_url: (versionRes.data as { file_url?: string } | null)?.file_url ?? null,
    },
    comments: ((commentsRes.data ?? []) as unknown as {
      id: string; created_at: string; body: string; team_users: AuthorRow
    }[]).map(toComment(client.name)),
  }
}

const SHOOT_LABELS: Record<string, string> = {
  brief: 'In planning', locked: 'Shoot booked', shot: 'Shot', wrapped: 'Wrapped',
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
  const commentsRes = await supabase.from('batch_comments')
    .select('id, created_at, body, team_users!batch_comments_author_id_fkey(name, role)')
    .eq('batch_id', b.id)
    .order('created_at', { ascending: true })
    .limit(200)

  return {
    client: { id: client.id, name: client.name },
    shoot: {
      id: b.id,
      title: b.title,
      status_label: SHOOT_LABELS[b.status as string] ?? 'In planning',
      shoot_date: b.shoot_date ?? null,
      location: b.location ?? null,
      concept: b.concept ?? null,
      board_name: b.board_name ?? null,
      planned_deliverables: sanitisePlannedDeliverables(b.planned_deliverables),
      shot_list: sanitiseShotList(b.shot_list),
      canvas_cards: (b.share_board ?? true) ? sanitiseCanvasCards(b.canvas_cards) : [],
    },
    comments: ((commentsRes.error ? [] : commentsRes.data ?? []) as unknown as {
      id: string; created_at: string; body: string; team_users: AuthorRow
    }[]).map(toComment(client.name)),
  }
}
