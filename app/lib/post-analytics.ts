import 'server-only'
import { after } from 'next/server'
import { table } from '@/lib/db'
import type { PostAnalytic, PublishJob, ScheduleEntry } from '@/lib/db-types'
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

export type RefreshResult = {
  scanned: number
  updated: number
  linked: number
  /** posts published BY HAND: newly matched to a provider post, and re-read */
  externalMatched: number
  externalRefreshed: number
}

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
  try {
    await table('post_analytics').upsert({
      ...row,
      raw: body,
      item_id: job.content_item_id,
      publish_job_id: job.id,
      // the provider's own publish time wins; ours is the fallback for a post it
      // has forgotten the timestamp of
      published_at: row.published_at ?? job.published_at ?? null,
    }, { onConflict: 'provider_post_id' })
  } catch (e) {
    console.error('could not cache post analytics', job.provider_post_id,
      e instanceof Error ? e.message : e)
    return { updated: false, linked: false }
  }

  const url = row.platform_post_url
  if (!url) return { updated: true, linked: false }

  let linked = false
  // the job's own permalink — only when it has none, so a link corrected by
  // hand is never stamped over by a provider that changed its mind
  if (!job.permalink) {
    // written only while the column is still empty, as one conditional write
    await table<PublishJob>('publish_jobs').claim(job.id, cur =>
      cur && cur.permalink == null ? { ...cur, permalink: url } : null)
    linked = true
  }

  if (job.content_item_id) {
    // the client-facing link. Only a row with no link is written, so this is a
    // back-fill rather than an overwrite, and the common case (already linked)
    // writes nothing at all.
    const entries = table<ScheduleEntry>('schedule_entries')
    const onItem = await entries.list({ by: { item_id: job.content_item_id } })
    const filled = onItem.filter(e => e.live_url == null)
    await Promise.all(filled.map(e => entries.update(e.id, { live_url: url })))
    if (filled.length === 0) {
      // Nothing matched. Either every row already carries a link — the happy
      // case — or the item has NO schedule row at all, which is the one way a
      // live post ends up with nowhere to put its URL and therefore no link in
      // the client's portal. recordQueuedSchedule normally creates the row at
      // queue time; a post that reached the provider by some other path never
      // got one.
      if (onItem.length === 0) {
        const platform = row.platform ?? platformsOf(job.targets)[0] ?? null
        if (platform) {
          // (item_id, platform) was a composite unique key; find-then-write is
          // what enforces it now
          const patch = {
            item_id: job.content_item_id,
            platform,
            scheduled_at: row.published_at ?? job.published_at ?? null,
            live_url: url,
            publish_status: 'published',
            published_at: row.published_at ?? job.published_at ?? new Date().toISOString(),
          }
          const held = (await entries.list({ by: { item_id: job.content_item_id, platform } }))[0]
          if (held) await entries.update(held.id, patch as Partial<ScheduleEntry>)
          else await table('schedule_entries').insert(patch)
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
 * Refresh ONE post, named by the provider's post id.
 *
 * The webhook's entry point. `post.published` tells us the exact post that
 * just went live, so the first set of numbers can be fetched for that post
 * alone instead of waiting for the half-hourly sweep to come round to it. A
 * post id with no job behind it is a no-op, not an error: the provider can
 * publish posts that never came from this dashboard.
 */
export async function refreshPostById(
  providerPostId: string,
): Promise<{ updated: boolean; linked: boolean }> {
  const found = await table<PublishJob>('publish_jobs').list({
    where: j => j.provider_post_id === providerPostId,
    limit: 1,
  })
  const job = found[0] as unknown as PublishedJob | undefined
  if (!job) return { updated: false, linked: false }
  return refreshOnePost(job)
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
  const jobs = await table<PublishJob>('publish_jobs').list({
    // 'duplicate' is a live post too — the provider refused to make a second
    // one because the first is already up, and it has numbers like any other
    where: j => ['published', 'duplicate'].includes(j.status)
      && j.created_at >= since
      && j.provider_post_id != null,
    orderBy: [['created_at', 'desc']],
    limit,
  })

  const rows = jobs as unknown as PublishedJob[]
  const out: RefreshResult = {
    scanned: rows.length, updated: 0, linked: 0, externalMatched: 0, externalRefreshed: 0,
  }
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

  // The posts nobody here published. They have no publish_jobs row, so the
  // loop above cannot see them at all: this half both matches the ones that
  // have never been matched (everything marked by hand before the feature
  // shipped, and anything whose live lookup found nothing because the
  // provider's own sync had not noticed the post yet) and re-reads the numbers
  // of the ones that have. Isolated: a failure here leaves the ordinary result
  // intact rather than losing a whole sweep of real posts.
  try {
    const { sweepExternalPosts } = await import('./external-post-match')
    const external = await sweepExternalPosts()
    out.externalMatched = external.matched
    out.externalRefreshed = external.refreshed
    out.scanned += external.scanned
  } catch (e) {
    console.error('external post sweep failed', e)
  }
  return out
}

/** The cached rows for a set of content items, newest post per item. */
export async function analyticsForItems(itemIds: string[]): Promise<Map<string, PostAnalyticsRow>> {
  const out = new Map<string, PostAnalyticsRow>()
  if (itemIds.length === 0) return out
  const wanted = new Set(itemIds)
  // a read failure shows no numbers, which is exactly what the portal showed
  // before these rows existed — never an error into the render
  let data: PostAnalytic[]
  try {
    data = await table<PostAnalytic>('post_analytics').list({
      where: r => r.item_id != null && wanted.has(r.item_id),
      orderBy: [['published_at', 'desc']],
    })
  } catch {
    return out
  }
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
      const jobs = await table<PublishJob>('publish_jobs').list({
        by: { client_id: clientId },
        where: j => ['published', 'duplicate'].includes(j.status)
          && j.created_at >= since
          && j.provider_post_id != null,
        orderBy: [['created_at', 'desc']],
        limit: 30,
      })
      const rows = jobs as unknown as PublishedJob[]
      if (rows.length === 0) return

      const ids = new Set(rows.map(r => r.provider_post_id))
      const cached = await table<PostAnalytic>('post_analytics').list({
        where: r => ids.has(r.provider_post_id),
      })
      const syncedAt = new Map(cached.map(r => [r.provider_post_id, r.synced_at]))

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
