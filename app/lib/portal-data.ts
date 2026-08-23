import 'server-only'
import { supabase } from '@/lib/supabase'
import { CLIENT_LABELS, type ItemStatus } from './workflow-core'
import {
  sanitiseCanvasCards, sanitiseShotList, sanitisePlannedDeliverables,
  type CanvasCard, type ShotRow,
} from './batch-brief-core'

/**
 * Client-safe portal payload — shared by the logged-in portal and the
 * view-only share link. Everything here is already stripped to what a client
 * may see: no Dropbox links, no internal comments, client-facing labels.
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
  schedule: { platform: string; scheduled_at: string | null; live_url: string | null }[]
}

export type PortalShoot = {
  id: string
  title: string
  status_label: string
  shoot_date: string | null
  location: string | null
  planned_deliverables: { type: string; qty: number }[]
  shot_list: ShotRow[]
  canvas_cards: CanvasCard[]
}

/** What a shoot's internal status means to the client reading their portal. */
const SHOOT_LABELS: Record<string, string> = {
  brief: 'In planning',
  locked: 'Shoot booked',
  shot: 'Shot',
  wrapped: 'Wrapped',
}

export type PortalData = {
  client: { id: string; name: string }
  /** the client's scanned brand profile — the portal dresses in it */
  brand: Record<string, unknown> | null
  commitment: {
    month: number; year: number
    quotas: { type: string; quota: number; published: number }[]
  } | null
  needs_review: PortalItem[]
  in_production: PortalItem[]
  approved: PortalItem[]
  scheduled: PortalItem[]
  published: PortalItem[]
  shoots: PortalShoot[]
}

export async function getPortalData(clientId: string): Promise<PortalData | null> {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()

  const [clientRes, itemsRes, commitmentRes, brandRes, shootsRes] = await Promise.all([
    supabase.from('clients').select('id, name').eq('id', clientId).maybeSingle(),
    supabase
      .from('content_items')
      .select('id, title, content_type, status, updated_at')
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
    // shoots an AM chose to share; errors (column not migrated yet) degrade to none
    supabase
      .from('batches')
      .select('id, title, status, shoot_date, location, planned_deliverables, shot_list, canvas_cards')
      .eq('client_id', clientId)
      .eq('shared_with_client', true)
      .order('shoot_date', { ascending: false, nullsFirst: false })
      .limit(6),
  ])
  if (!clientRes.data) return null
  const items = itemsRes.data ?? []

  const ids = items.map(i => i.id)
  const [versionsRes, scheduleRes] = await Promise.all([
    ids.length
      ? supabase
          .from('asset_versions')
          .select('item_id, version_number, file_url, drive_url')
          .in('item_id', ids)
          .order('version_number', { ascending: false })
      : Promise.resolve({ data: [] as { item_id: string; version_number: number; file_url: string; drive_url: string }[] }),
    ids.length
      ? supabase
          .from('schedule_entries')
          .select('item_id, platform, scheduled_at, live_url')
          .in('item_id', ids)
      : Promise.resolve({ data: [] as { item_id: string; platform: string; scheduled_at: string | null; live_url: string | null }[] }),
  ])

  // latest version per item (rows are ordered desc — first wins)
  const latestByItem = new Map<string, { file_url: string; drive_url: string }>()
  for (const v of versionsRes.data ?? []) {
    if (!latestByItem.has(v.item_id)) latestByItem.set(v.item_id, v)
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
    return {
      id: i.id,
      title: i.title,
      content_type: i.content_type,
      status,
      status_label: CLIENT_LABELS[status],
      updated_at: i.updated_at,
      preview_url: clientFacing ? latest?.file_url || null : null,
      drive_url: clientFacing ? latest?.drive_url || null : null,
      schedule: scheduleByItem.get(i.id) ?? [],
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

  const shoots: PortalShoot[] = (shootsRes.error ? [] : shootsRes.data ?? []).map(b => ({
    id: b.id,
    title: b.title,
    status_label: SHOOT_LABELS[b.status as string] ?? 'In planning',
    shoot_date: b.shoot_date ?? null,
    location: b.location ?? null,
    planned_deliverables: sanitisePlannedDeliverables(b.planned_deliverables),
    shot_list: sanitiseShotList(b.shot_list),
    canvas_cards: sanitiseCanvasCards(b.canvas_cards),
  }))

  return {
    client: clientRes.data,
    brand: (brandRes.data?.profile as Record<string, unknown> | undefined) ?? null,
    commitment,
    needs_review: bucket(['client_review']),
    in_production: bucket(['draft_uploaded', 'internal_review', 'revision_required', 'revision_complete', 'client_changes_requested']),
    approved: bucket(['approved_for_scheduling']),
    scheduled: bucket(['scheduled']),
    published: bucket(['published']),
    shoots,
  }
}

export async function getPortalDataByToken(token: string): Promise<PortalData | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null
  const { data } = await supabase.from('clients').select('id').eq('share_token', token).maybeSingle()
  if (!data) return null
  return getPortalData(data.id)
}
