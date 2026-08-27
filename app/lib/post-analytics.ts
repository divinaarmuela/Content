import 'server-only'
import { after } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getPublisher } from './publisher'
import {
  isStale, shapePostAnalytics,
  type PostAnalyticsRow,
} from './post-analytics-core'

/**
 * The per-post numbers, fetched, cached and back-filled.
 *
 * Everything here talks to exactly two things: the provider's per-post
 * analytics endpoint and the `post_analytics` cache. The shaping is in
 * post-analytics-core.ts and is tested there; this file is the plumbing.
 *
 * Three deliberate choices:
 *
 * 1. **Per post, never the list.** `/analytics` with no postId is a cached
 *    roll-up that lags the platform by an hour or more (the same lag
 *    reconcilePublishedJobs works around). Asking about ONE post answers from
 *    the live platform. A page of stale numbers is worse than none.
 * 2. **The permalink is back-filled here.** A post's live URL is assigned by
 *    the platform some time AFTER our job flips to published, and reconcile
 *    only looks back fourteen days. Every analytics refresh carries the URL,
 *    so a post whose link was null at flip time gets one the next time its
 *    numbers are read — which is within half an hour, forever.
 * 3. **Nothing here may throw into a caller.** It runs inside a cron and
 *    behind `after()` on a page the client is already looking at. A provider
 *    outage degrades a metrics row; it never degrades a portal.
 */

/** A published job, as the refresh needs it. */
type PublishedJob = {
  id: string
  content_item_id: string | null
  provider_post_id: string
  permalink: string | null
  published_at: string | null
  targets: unknown
}

export type RefreshResult = { scanned: number; updated: number; linked: number }

/** The platform names off a job's stored targets, however loosely typed. */
function platformsOf(targets: unknown): string[] {
  if (!Array.isArray(targets)) return []
  return targets
    .map(t => String((t as { platform?: unknown })?.platform ?? ''))
    .filter(Boolean)
}

/**
 * Refresh one post, and carry its permalink back to everything that wanted it.
 *
 * Returns whether a row was written and whether a link was newly captured, so
 * the cron can report something an operator can read.
 */
export async function refreshOnePost(job: PublishedJob): Promise<{ updated: boolean; linked: boolean }> {
  const raw = await getPublisher().postAnalytics(job.provider_post_id).catch(() => null)
  const shaped = shapePostAnalytics(job.provider_post_id, raw)
  if (!shaped) return { updated: false, linked: false }

  const { raw: body, ...row } = shaped
  const { error } = await supabase.from('post_analytics').upsert({
    ...row,
    raw: body,
    item_id: job.content_item_id,
    publish_job_id: job.id,
    // the provider's own publish time wins; ours is the fallback for a post it
    // has forgotten the timestamp of
    published_at: row.published_at ?? job.published_at ?? null,
  }, { onConflict: 'provider_post_id' })
  if (error) {
    console.error('could not cache post analytics', job.provider_post_id, error.message)
    return { updated: false, linked: false }
  }

  const url = row.platform_post_url
  if (!url) return { updated: true, linked: false }

  let linked = false
  // the job's own permalink — only when it has none, so a link corrected by
  // hand is never stamped over by a provider that changed its mind
  if (!job.permalink) {
    await supabase.from('publish_jobs').update({ permalink: url }).eq('id', job.id).is('permalink', null)
    linked = true
  }

  if (job.content_item_id) {
    // the client-facing link. `is('live_url', null)` makes this a back-fill
    // rather than an overwrite, and means the common case (already linked)
    // costs one indexed update that matches nothing.
    const { data: filled } = await supabase
      .from('schedule_entries')
      .update({ live_url: url })
      .eq('item_id', job.content_item_id)
      .is('live_url', null)
      .select('id')
    if ((filled ?? []).length === 0) {
      // Nothing matched. Either every row already carries a link — the happy
      // case — or the item has NO schedule row at all, which is the one way a
      // live post ends up with nowhere to put its URL and therefore no link in
      // the client's portal. recordQueuedSchedule normally creates the row at
      // queue time; a post that reached the provider by some other path never
      // got one.
      const { data: existing } = await supabase
        .from('schedule_entries').select('id').eq('item_id', job.content_item_id).limit(1)
      if ((existing ?? []).length === 0) {
        const platform = row.platform ?? platformsOf(job.targets)[0] ?? null
        if (platform) {
          await supabase.from('schedule_entries').upsert({
            item_id: job.content_item_id,
            platform,
            scheduled_at: row.published_at ?? job.published_at ?? null,
            live_url: url,
            publish_status: 'published',
            published_at: row.published_at ?? job.published_at ?? new Date().toISOString(),
          }, { onConflict: 'item_id,platform' })
          linked = true
        }
      }
    } else {
      linked = true
    }

    if (linked) {
      // A live post whose link never reached the schedule row was also a post
      // that may never have been recorded as published — the two are written
      // together by recordPublishOnItem and they go missing together.
      // Idempotent: an item already published moves nothing.
      const { recordPublishOnItem } = await import('./production-publish')
      await recordPublishOnItem(job.content_item_id, url, platformsOf(job.targets))
    }
  }
  return { updated: true, linked }
}

/**
 * Refresh every post published in the last `days`.
 *
 * The window is generous on purpose: a Reel keeps accumulating views for
 * weeks, and a client looking at last month's work should see what it
 * actually did rather than what it had done by the second day.
 */
export async function refreshRecentPostAnalytics(days = 90, limit = 200): Promise<RefreshResult> {
  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString()
  const { data: jobs } = await supabase
    .from('publish_jobs')
    .select('id, content_item_id, provider_post_id, permalink, published_at, targets')
    // 'duplicate' is a live post too — the provider refused to make a second
    // one because the first is already up, and it has numbers like any other
    .in('status', ['published', 'duplicate'])
    .gte('created_at', since)
    .not('provider_post_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  const rows = (jobs ?? []) as unknown as PublishedJob[]
  const out: RefreshResult = { scanned: rows.length, updated: 0, linked: 0 }
  for (const job of rows) {
    try {
      const r = await refreshOnePost(job)
      if (r.updated) out.updated++
      if (r.linked) out.linked++
    } catch (e) {
      // one bad post must not end the sweep
      console.error('post analytics refresh failed', job.provider_post_id, e)
    }
  }
  return out
}

/** The cached rows for a set of content items, newest post per item. */
export async function analyticsForItems(itemIds: string[]): Promise<Map<string, PostAnalyticsRow>> {
  const out = new Map<string, PostAnalyticsRow>()
  if (itemIds.length === 0) return out
  const { data, error } = await supabase
    .from('post_analytics')
    .select('item_id, provider_post_id, platform, platform_post_url, views, reach, impressions, likes, comments, shares, saves, engagement_rate, sync_status, published_at, synced_at')
    .in('item_id', itemIds)
    .order('published_at', { ascending: false, nullsFirst: false })
  // the table may not be migrated yet — an un-migrated portal shows no numbers,
  // which is exactly what it showed yesterday
  if (error || !data) return out
  for (const r of data) {
    const id = r.item_id as string
    if (id && !out.has(id)) out.set(id, r as unknown as PostAnalyticsRow)
  }
  return out
}

/**
 * Freshen a client's published posts while they are looking at the page.
 *
 * Never awaited by the render: it is handed to `after()` so it runs once the
 * response is out, and it stops itself after `budgetMs` regardless. The cron
 * is what guarantees the numbers; this only shortens the wait for a client who
 * opens the portal minutes after a post goes live.
 */
export function refreshStaleAnalyticsInBackground(clientId: string, budgetMs = 2000): void {
  const job = async () => {
    const deadline = Date.now() + budgetMs
    try {
      const since = new Date(Date.now() - 90 * 24 * 3600_000).toISOString()
      const { data: jobs } = await supabase
        .from('publish_jobs')
        .select('id, content_item_id, provider_post_id, permalink, published_at, targets')
        .eq('client_id', clientId)
        .in('status', ['published', 'duplicate'])
        .gte('created_at', since)
        .not('provider_post_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(30)
      const rows = (jobs ?? []) as unknown as PublishedJob[]
      if (rows.length === 0) return

      const { data: cached } = await supabase
        .from('post_analytics')
        .select('provider_post_id, synced_at')
        .in('provider_post_id', rows.map(r => r.provider_post_id))
      const syncedAt = new Map((cached ?? []).map(r => [r.provider_post_id as string, r.synced_at as string]))

      for (const job of rows) {
        if (Date.now() > deadline) return
        if (!isStale(syncedAt.get(job.provider_post_id))) continue
        await refreshOnePost(job)
      }
    } catch (e) {
      console.error('portal analytics refresh failed', clientId, e)
    }
  }
  try {
    after(job)
  } catch {
    // outside a request scope (a script, a test) — still detached, never awaited
    void job()
  }
}
