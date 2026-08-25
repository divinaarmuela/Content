import 'server-only'
import { randomUUID } from 'node:crypto'
import { supabase } from '@/lib/supabase'
import { inngest } from '../inngest/client'
import { trackerChannel } from '../inngest/channels'
import { buildDestUrl, mintCode, zernioEventToAsset } from './tracker-core'

/**
 * Attribution tracker, Phase 1: the Content Register and its click log.
 *
 * The click log is MD Media's own tracking record — the primary evidence in
 * any Tracked Sale dispute (services agreement clause 9.4) — so a click is
 * WRITTEN BEFORE the visitor is redirected, and asset registration happens on
 * every path a post can take into the world (publish pipeline, Zernio
 * webhooks, manual entry).
 */

export type ContentAsset = {
  id: string
  client_id: string | null
  title: string
  platform: string | null
  slug: string
  dest_url: string | null
  post_url: string | null
  provider_post_id: string | null
  source: 'published' | 'external' | 'manual'
  offer_code: string | null
  keyword: string | null
  published_at: string | null
  created_at: string
  clients?: { name: string } | null
}

const rand = () => Array.from({ length: 8 }, () => Math.random())

/** Insert with a freshly minted slug, retrying on the astronomically unlikely
 *  collision rather than pre-checking (never check-then-write). */
async function insertWithSlug(row: Record<string, unknown>): Promise<ContentAsset> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = mintCode(rand())
    const { data, error } = await supabase
      .from('content_assets')
      .insert({ ...row, slug })
      .select('*, clients(name)')
      .single()
    if (!error) return data as ContentAsset
    if (!/content_assets_slug_key/.test(error.message)) throw new Error(error.message)
  }
  throw new Error('Could not mint a unique tracked-link slug')
}

export async function createAsset(input: {
  client_id?: string | null
  title: string
  platform?: string | null
  dest_url?: string | null
  post_url?: string | null
  offer_code?: string | null
  keyword?: string | null
  published_at?: string | null
  source?: 'published' | 'external' | 'manual'
  provider_post_id?: string | null
}): Promise<ContentAsset> {
  const asset = await insertWithSlug({
    client_id: input.client_id ?? null,
    title: input.title,
    platform: input.platform ?? null,
    dest_url: input.dest_url ?? null,
    post_url: input.post_url ?? null,
    offer_code: input.offer_code ?? null,
    keyword: input.keyword ?? null,
    published_at: input.published_at ?? null,
    source: input.source ?? 'manual',
    provider_post_id: input.provider_post_id ?? null,
  })
  announce('asset', asset.id, asset.client_id, asset.title)
  return asset
}

/**
 * Auto-registration from the publish pipeline or a Zernio webhook.
 * Idempotent on provider_post_id: a webhook retry or a second event for the
 * same post updates the permalink rather than duplicating the asset.
 */
export async function registerFromZernioEvent(
  event: string, payload: Record<string, unknown>, clientId: string | null,
): Promise<ContentAsset | null> {
  const mapped = zernioEventToAsset(event, payload)
  if (!mapped) return null

  const { data: existing } = await supabase
    .from('content_assets')
    .select('id, post_url, published_at')
    .eq('provider_post_id', mapped.providerPostId)
    .maybeSingle()

  if (existing) {
    // second sighting: the platform may have assigned the permalink by now
    const patch: Record<string, unknown> = {}
    if (!existing.post_url && mapped.postUrl) patch.post_url = mapped.postUrl
    if (!existing.published_at && mapped.publishedAt) patch.published_at = mapped.publishedAt
    if (Object.keys(patch).length > 0) {
      await supabase.from('content_assets').update(patch).eq('id', existing.id)
    }
    return null
  }

  const asset = await insertWithSlug({
    client_id: clientId,
    title: mapped.title,
    platform: mapped.platform,
    post_url: mapped.postUrl,
    provider_post_id: mapped.providerPostId,
    source: mapped.source,
    published_at: mapped.publishedAt,
  })
  announce('asset', asset.id, asset.client_id, asset.title)
  return asset
}

/**
 * Log a click and return where to send the visitor.
 *
 * The log row is the evidence, so it is written before the redirect resolves.
 * The destination falls back to the asset's client's website, then the
 * marketing site — a tracked link must never dead-end.
 */
export async function logClickAndResolve(slug: string): Promise<string | null> {
  const { data: asset } = await supabase
    .from('content_assets')
    .select('id, client_id, title, dest_url, clients(website)')
    .eq('slug', slug)
    .maybeSingle()
  if (!asset) return null

  const clickId = `c_${randomUUID().slice(0, 12)}`
  const { error } = await supabase.from('asset_clicks').insert({
    asset_id: asset.id,
    click_id: clickId,
  })
  if (error) console.error('click log failed:', error)

  announce('click', asset.id, asset.client_id as string | null, asset.title as string)

  const clientSite = (asset.clients as { website?: string | null } | null)?.website
  const dest = (asset.dest_url as string | null) || clientSite || 'https://www.mdmmarketing.com.au'
  return buildDestUrl(dest, slug, clickId)
}

/** Register with per-asset click counts, newest first. */
export async function listAssetsWithStats(clientId?: string | null): Promise<(ContentAsset & { clicks: number })[]> {
  let query = supabase
    .from('content_assets')
    .select('*, clients(name), asset_clicks(count)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (clientId) query = query.eq('client_id', clientId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map(row => {
    const { asset_clicks, ...asset } = row as ContentAsset & { asset_clicks: { count: number }[] }
    return { ...asset, clicks: asset_clicks?.[0]?.count ?? 0 }
  })
}

const EDITABLE = ['title', 'platform', 'dest_url', 'post_url', 'offer_code', 'keyword', 'client_id', 'published_at'] as const

export async function updateAsset(id: string, patch: Record<string, unknown>): Promise<ContentAsset> {
  const clean: Record<string, unknown> = {}
  for (const key of EDITABLE) {
    if (key in patch) clean[key] = patch[key] === '' ? null : patch[key]
  }
  const { data, error } = await supabase
    .from('content_assets').update(clean).eq('id', id)
    .select('*, clients(name)').single()
  if (error) throw new Error(error.message)
  return data as ContentAsset
}

export async function deleteAsset(id: string): Promise<void> {
  const { error } = await supabase.from('content_assets').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** Realtime hint: something changed — open Tracker pages refetch. Publishing
 *  outside an Inngest function is not retry-safe, so subscribers treat the
 *  message as a hint and refetch rather than trusting it. */
function announce(kind: 'click' | 'asset', assetId: string, clientId: string | null, label: string) {
  void inngest.realtime.publish(trackerChannel.activity, {
    kind, asset_id: assetId, client_id: clientId, label, ts: Date.now(),
  }).catch(e => console.error('tracker realtime publish failed:', e))
}
