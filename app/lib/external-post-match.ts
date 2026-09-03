import 'server-only'
import { after } from 'next/server'
import { table } from '@/lib/db'
import type { Client, ContentItem, PostAnalytic, PublishJob, ScheduleEntry } from '@/lib/db-types'
import { getPublisher } from './publisher'
import { shapePostAnalytics } from './post-analytics-core'
import {
  externalPostPlatform, externalPostPublishedAt, externalPostUrl, externalPostsOf,
  matchExternalPost, onlyExternal, platformOfUrl,
  type ExternalPost,
} from './external-post-match-core'

/**
 * Numbers for the posts nobody in this app published.
 *
 * The gap this closes: a scheduler posts on Instagram themselves, presses
 * "Mark as posted" or pastes the live URL onto the item card, and the item goes
 * to Published with no `publish_jobs` row behind it. Every other surface works
 * — the board, the portal, the link — except the one the client cares most
 * about, because `post_analytics` is keyed on a provider post id that this path
 * never produced.
 *
 * The provider's `/analytics` list carries those posts anyway: its background
 * sync sees everything on a connected account, and flags what it did not
 * publish as `isExternal`. So we ask for the list, match the scheduler's link
 * against it (external-post-match-core), and write an ordinary
 * `post_analytics` row with `source = 'external'`. From that moment the
 * refresh cron, the portal and the item card treat it like any other post —
 * which is the whole design: ONE cache, one shape, one set of words.
 *
 * Three places call in: the moment a link is saved (schedule.ts, behind
 * `after()`), the half-hourly sweep (for everything marked before this
 * shipped), and the `post.external.created` webhook.
 *
 * Nothing here throws into a caller. It runs detached and inside a cron; a
 * provider outage leaves a post without numbers, which is where it started.
 */

/** Statuses that mean "this item was handed to the provider by us". */
const OWN_JOB = ['queued', 'publishing', 'scheduled', 'published', 'duplicate']

export type MatchOutcome = 'matched' | 'not_found' | 'skipped'

/** A memo of one client's external posts, so a sweep asks the provider once. */
export type ExternalPostCache = Map<string, ExternalPost[]>

function platformsOfTargets(targets: unknown): string[] {
  if (!Array.isArray(targets)) return []
  return targets
    .map(t => String((t as { platform?: unknown })?.platform ?? '').toLowerCase())
    .filter(Boolean)
}

/**
 * Did WE publish this item to this platform?
 *
 * If so there is nothing to match: the job holds the provider's post id and the
 * ordinary refresh already has it. Matching anyway would be harmless but would
 * spend a provider call per published post, forever.
 */
async function hasOwnJob(itemId: string, platform: string): Promise<boolean> {
  const rows = await table<PublishJob>('publish_jobs').list({
    where: j => j.content_item_id === itemId && OWN_JOB.includes(j.status),
  })
  for (const row of rows) {
    if (!row.provider_post_id) continue
    const platforms = platformsOfTargets(row.targets)
    // a job with no readable targets still means the item went out from here
    if (platforms.length === 0 || platforms.includes(platform)) return true
  }
  return false
}

/** The provider profile that holds one client's accounts. */
async function profileIdOf(clientId: string): Promise<string | null> {
  const row = await table<Client>('clients').get(clientId)
  return row?.social_profile_id ?? null
}

/**
 * One client's external posts, from the LIST endpoint.
 *
 * The list is the only endpoint that answers "what else is on this account?" —
 * the per-post endpoint needs the id we are trying to find. Its hour-long lag
 * does not matter here: we are asking which post this is, not how it did. The
 * numbers come from the per-post call once we know the id.
 */
export async function fetchExternalPosts(
  clientId: string, cache?: ExternalPostCache,
): Promise<ExternalPost[]> {
  const cached = cache?.get(clientId)
  if (cached) return cached
  const raw = await getPublisher().postAnalytics().catch(() => null)
  const posts = onlyExternal(externalPostsOf(raw))
  cache?.set(clientId, posts)
  return posts
}

/**
 * Write the provider's numbers for a matched post onto our item.
 *
 * The per-post endpoint, then the same shaping every other row goes through —
 * so an external post and a published one are indistinguishable downstream
 * apart from `source`. A post the provider has no figures for yet still gets
 * its row: the link and the id are worth keeping, and the cron fills the rest
 * in within half an hour.
 */
async function cacheExternalPost(input: {
  itemId: string
  providerPostId: string
  post: ExternalPost
  platform: string
  liveUrl: string | null
  at: string | null
}): Promise<boolean> {
  const raw = await getPublisher().postAnalytics(input.providerPostId).catch(() => null)
  const shaped = shapePostAnalytics(input.providerPostId, raw)
  const { raw: body, ...metrics } = shaped ?? { raw: {} as unknown }

  const row: Record<string, unknown> = {
    ...metrics,
    provider_post_id: input.providerPostId,
    item_id: input.itemId,
    raw: body ?? {},
    source: 'external',
    platform: (metrics as { platform?: string | null }).platform
      ?? externalPostPlatform(input.post) ?? input.platform,
    platform_post_url: (metrics as { platform_post_url?: string | null }).platform_post_url
      ?? externalPostUrl(input.post) ?? input.liveUrl,
    published_at: (metrics as { published_at?: string | null }).published_at
      ?? externalPostPublishedAt(input.post) ?? input.at,
    synced_at: (metrics as { synced_at?: string }).synced_at ?? new Date().toISOString(),
  }

  try {
    await table('post_analytics').upsert(row, { onConflict: 'provider_post_id' })
    return true
  } catch (e) {
    console.error('could not cache external post analytics', input.providerPostId,
      e instanceof Error ? e.message : e)
    return false
  }
}

/** Record what the lookup found, so the card can say it. Best-effort: a write
 *  that fails must not turn a successful match into a failure. */
async function noteMatchState(
  itemId: string, platform: string, state: 'searching' | 'matched' | 'not_found',
): Promise<void> {
  try {
    const entries = table<ScheduleEntry>('schedule_entries')
    const rows = await entries.list({ by: { item_id: itemId, platform } })
    await Promise.all(rows.map(r => entries.update(r.id, { external_match_state: state })))
  } catch (e) {
    console.error('could not record the external match state', itemId,
      e instanceof Error ? e.message : e)
  }
}

export type LinkInput = {
  itemId: string
  clientId: string
  platform: string
  liveUrl: string | null
  /** the schedule entry's own date — what the ±6h fallback is measured from */
  at: string | null
  cache?: ExternalPostCache
}

/**
 * Find the provider's post for one hand-published item, and cache its numbers.
 *
 * `skipped` means there was nothing to do — we published this ourselves, or the
 * provider is not configured. `not_found` means we looked: the card is entitled
 * to tell the scheduler their link matched nothing.
 */
export async function linkExternalPost(input: LinkInput): Promise<MatchOutcome> {
  const platform = (input.platform || platformOfUrl(input.liveUrl) || '').toLowerCase()
  if (!platform) return 'skipped'
  if (!getPublisher().configured()) return 'skipped'
  if (await hasOwnJob(input.itemId, platform)) return 'skipped'

  const posts = await fetchExternalPosts(input.clientId, input.cache)
  const profileId = await profileIdOf(input.clientId)
  const match = matchExternalPost(input.liveUrl, posts, {
    platform, profileId, at: input.at,
  })

  if (!match) {
    await noteMatchState(input.itemId, platform, 'not_found')
    return 'not_found'
  }

  const cached = await cacheExternalPost({
    itemId: input.itemId,
    providerPostId: match.providerPostId,
    post: match.post,
    platform,
    liveUrl: input.liveUrl,
    at: input.at,
  })
  await noteMatchState(input.itemId, platform, cached ? 'matched' : 'searching')
  return cached ? 'matched' : 'not_found'
}

/**
 * The same lookup, detached from the request that triggered it.
 *
 * A scheduler pressing "Save the live link" must not wait on two provider round
 * trips, and a provider outage must not turn saving a link into an error.
 */
export function linkExternalPostSoon(input: LinkInput): void {
  const job = async () => {
    try {
      await linkExternalPost(input)
    } catch (e) {
      console.error('external post match failed', input.itemId, e)
    }
  }
  try {
    after(job)
  } catch {
    // outside a request scope (a script, a test) — still detached, never awaited
    void job()
  }
}

export type ExternalSweepResult = {
  /** published items with a live link and no numbers */
  scanned: number
  matched: number
  /** existing external rows whose numbers were re-read */
  refreshed: number
}

/**
 * The cron's pass over everything posted by hand.
 *
 * Two halves, and both are needed:
 *
 *   1. **Match what has never been matched.** Every post marked by hand before
 *      this shipped, plus anything whose `after()` lookup ran while the
 *      provider was down, plus a post the provider's own sync had not noticed
 *      yet when the link was pasted (its background scan is not instant, so the
 *      first attempt legitimately finds nothing and the next sweep succeeds).
 *   2. **Refresh what has.** The ordinary refresh walks `publish_jobs`, and an
 *      external post has none — so without this its numbers would be frozen at
 *      whatever they were the minute it was matched.
 */
export async function sweepExternalPosts(days = 30, limit = 100): Promise<ExternalSweepResult> {
  const out: ExternalSweepResult = { scanned: 0, matched: 0, refreshed: 0 }
  if (!getPublisher().configured()) return out
  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString()

  // ── half two first: it is the cheap one, and it cannot be starved ───────
  const existing = await table<PostAnalytic>('post_analytics').list({
    where: r => r.source === 'external' && r.published_at != null && r.published_at >= since,
    limit,
  })

  for (const row of existing) {
    try {
      const ok = await cacheExternalPost({
        itemId: row.item_id as string,
        providerPostId: row.provider_post_id,
        post: {},
        platform: row.platform ?? '',
        liveUrl: row.platform_post_url ?? null,
        at: row.published_at ?? null,
      })
      if (ok) out.refreshed++
    } catch (e) {
      console.error('external analytics refresh failed', row.provider_post_id, e)
    }
  }

  // ── half one: published, linked, and still without numbers ──────────────
  const entries = await table<ScheduleEntry>('schedule_entries').list({
    where: e => e.publish_status === 'published'
      && e.published_at != null && e.published_at >= since,
    orderBy: [['published_at', 'desc']],
    limit,
  })

  const candidates = entries.filter(e => e.item_id)
  if (candidates.length === 0) return out

  const candidateIds = new Set(candidates.map(e => e.item_id))
  const cached = await table<PostAnalytic>('post_analytics').list({
    where: r => r.item_id != null && candidateIds.has(r.item_id),
  })
  const known = new Set(cached.map(r => r.item_id as string))

  const items = await table<ContentItem>('content_items').list({
    where: i => candidateIds.has(i.id),
  })
  const clientOf = new Map(items
    .filter(i => i.status === 'published')
    .map(i => [i.id, i.client_id]))

  const cache: ExternalPostCache = new Map()
  for (const entry of candidates) {
    const itemId = entry.item_id
    if (known.has(itemId)) continue
    const clientId = clientOf.get(itemId)
    if (!clientId) continue
    out.scanned++
    try {
      const result = await linkExternalPost({
        itemId,
        clientId,
        platform: String(entry.platform ?? '').toLowerCase(),
        liveUrl: entry.live_url ?? null,
        at: entry.published_at ?? entry.scheduled_at ?? null,
        cache,
      })
      if (result === 'matched') {
        out.matched++
        known.add(itemId)
      }
    } catch (e) {
      console.error('external post sweep failed', itemId, e)
    }
  }
  return out
}

/**
 * `post.external.created` — the provider has just noticed a post nobody
 * published through us.
 *
 * It arrives with the post's own URL, so the match runs the other way round:
 * against every item published in the last week that carries a live link on
 * that platform. Seven days because the provider's sync can be a day or two
 * behind a post, and because a link pasted last month is already covered by the
 * sweep.
 */
export async function linkExternalPostFromWebhook(input: {
  providerPostId: string
  platform: string | null
  url: string | null
  publishedAt: string | null
  profileId: string | null
}): Promise<{ matched: string | null }> {
  const platform = (input.platform || platformOfUrl(input.url) || '').toLowerCase()
  if (!input.providerPostId || !platform) return { matched: null }

  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString()
  const entries = await table<ScheduleEntry>('schedule_entries').list({
    where: e => e.platform === platform
      && e.publish_status === 'published'
      && e.published_at != null && e.published_at >= since
      && e.live_url != null,
    limit: 200,
  })

  const post: ExternalPost = {
    _id: input.providerPostId,
    platform,
    platformPostUrl: input.url ?? undefined,
    publishedAt: input.publishedAt ?? undefined,
    profileId: input.profileId ?? undefined,
    isExternal: true,
  }

  for (const entry of entries) {
    const itemId = entry.item_id
    if (!itemId) continue
    const match = matchExternalPost(entry.live_url ?? null, [post], {
      platform, at: entry.published_at ?? null,
    })
    if (!match || match.matchedBy !== 'url') continue
    // the URL identified it — the ±6h fallback is deliberately not trusted from
    // a webhook, where "one candidate" only means one row came back in a page
    if (await hasOwnJob(itemId, platform)) continue
    const ok = await cacheExternalPost({
      itemId,
      providerPostId: input.providerPostId,
      post,
      platform,
      liveUrl: entry.live_url ?? null,
      at: entry.published_at ?? null,
    })
    if (ok) {
      await noteMatchState(itemId, platform, 'matched')
      return { matched: itemId }
    }
  }
  return { matched: null }
}
