import 'server-only'
import { randomUUID } from 'node:crypto'
import { DbError, table } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { AssetClick, ContentAsset as ContentAssetRow } from '@/lib/db-types'
import { announceAfter as liveAnnounce } from '@/lib/live'
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
    try {
      const created = await table('content_assets').insert({ ...row, slug })
      const joined = await attachOne([created], 'client_id' as never, 'clients', ['name'])
      return joined[0] as unknown as ContentAsset
    } catch (e) {
      if (!(e instanceof DbError && e.code === 'unique')) {
        throw new Error(e instanceof Error ? e.message : 'Could not register the asset')
      }
    }
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

  const existing = (await table<ContentAssetRow>('content_assets')
    .list({ where: a => a.provider_post_id === mapped.providerPostId, limit: 1 }))[0] ?? null

  if (existing) {
    // second sighting: the platform may have assigned the permalink by now
    const patch: Record<string, unknown> = {}
    if (!existing.post_url && mapped.postUrl) patch.post_url = mapped.postUrl
    if (!existing.published_at && mapped.publishedAt) patch.published_at = mapped.publishedAt
    if (Object.keys(patch).length > 0) {
      await table('content_assets').update(existing.id, patch)
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
  const row = (await table<ContentAssetRow>('content_assets')
    .list({ where: a => a.slug === slug, limit: 1 }))[0] ?? null
  if (!row) return null
  const asset = (await attachOne([row], 'client_id', 'clients', ['website']))[0]

  const clickId = `c_${randomUUID().slice(0, 12)}`
  try {
    await table('asset_clicks').insert({
      asset_id: asset.id,
      click_id: clickId,
      clicked_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error('click log failed:', e)
  }

  announce('click', asset.id, asset.client_id as string | null, asset.title as string)

  const clientSite = (asset.clients as { website?: string | null } | null)?.website
  const dest = (asset.dest_url as string | null) || clientSite || 'https://www.mdmmarketing.com.au'
  return buildDestUrl(dest, slug, clickId)
}

/** Register with per-asset click counts, newest first. */
export async function listAssetsWithStats(clientId?: string | null): Promise<(ContentAsset & { clicks: number })[]> {
  const rows = await table<ContentAssetRow>('content_assets').list({
    ...(clientId ? { by: { client_id: clientId } } : {}),
    orderBy: [['created_at', 'desc']],
    limit: 200,
  })
  const withClient = await attachOne(rows, 'client_id', 'clients', ['name'])
  const clicks = await table<AssetClick>('asset_clicks').list()
  const countByAsset = new Map<string, number>()
  for (const c of clicks) countByAsset.set(c.asset_id, (countByAsset.get(c.asset_id) ?? 0) + 1)
  return withClient.map(row => ({
    ...(row as unknown as ContentAsset),
    clicks: countByAsset.get(row.id) ?? 0,
  }))
}

const EDITABLE = ['title', 'platform', 'dest_url', 'post_url', 'offer_code', 'keyword', 'client_id', 'published_at'] as const

export async function updateAsset(id: string, patch: Record<string, unknown>): Promise<ContentAsset> {
  const clean: Record<string, unknown> = {}
  for (const key of EDITABLE) {
    if (key in patch) clean[key] = patch[key] === '' ? null : patch[key]
  }
  const updated = await table('content_assets').update(id, clean)
  if (!updated) throw new Error('That tracked link no longer exists')
  const joined = await attachOne([updated], 'client_id' as never, 'clients', ['name'])
  return joined[0] as unknown as ContentAsset
}

export async function deleteAsset(id: string): Promise<void> {
  await table('content_assets').remove(id)
}

/** Realtime hint: something changed — open Tracker pages refetch. Publishing
 *  outside an Inngest function is not retry-safe, so subscribers treat the
 *  message as a hint and refetch rather than trusting it. */
function announce(kind: 'click' | 'asset', assetId: string, clientId: string | null, label: string) {
  liveAnnounce('tracker', { kind, asset_id: assetId, client_id: clientId, label })
}
