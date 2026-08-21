import 'server-only'
import { supabase } from '@/lib/supabase'
import { getPublisher } from './publisher'
import {
  validatePost, isPlatform, type MediaItem, type PostKind, type Platform, type Target,
} from './publish-core'

/**
 * Publishing a client's post is the least reversible thing this system does —
 * you cannot un-post to someone's real Instagram. So duplication is designed
 * out at three independent layers:
 *
 *   1. Our claim.       queued → publishing via a conditional UPDATE. Zero rows
 *                       updated means another worker already owns this job.
 *   2. x-request-id.    Stored on the row before the first attempt and reused,
 *                       so a retry inside the provider's window replays.
 *   3. Content hash.    The provider's own 24h duplicate check, surfaced as a
 *                       409 which we record as success, never as a failure.
 *
 * Only layer 1 is ours, and it is the one that must never be skipped.
 */

export type PublishJob = {
  id: string
  client_id: string | null
  caption: string
  media: MediaItem[]
  targets: Target[]
  scheduled_for: string | null
  timezone: string
  request_id: string
  attempts: number
}

export async function queuePublishJob(input: {
  clientId?: string | null
  contentItemId?: string | null
  scheduleEntryId?: string | null
  caption: string
  media: MediaItem[]
  targets: Target[]
  scheduledFor?: string | null
  timezone?: string
  createdBy?: string
}): Promise<{ id: string } | { error: string; issues?: string[] }> {
  const platforms = input.targets.map(t => t.platform).filter(isPlatform)
  // carry each target's intent into validation, so a Reel with a still image
  // or a Story with a carousel is refused here rather than by the platform
  const kinds: Partial<Record<Platform, PostKind>> = {}
  for (const t of input.targets) if (t.options?.kind) kinds[t.platform] = t.options.kind

  const issues = validatePost({ caption: input.caption, media: input.media, platforms, kinds })
  if (issues.length > 0) {
    return {
      error: 'This post is not valid for every selected platform',
      issues: issues.map(i => `${i.platform}: ${i.problem}`),
    }
  }

  const { data, error } = await supabase
    .from('publish_jobs')
    .insert({
      client_id: input.clientId ?? null,
      content_item_id: input.contentItemId ?? null,
      schedule_entry_id: input.scheduleEntryId ?? null,
      caption: input.caption,
      media: input.media,
      targets: input.targets,
      scheduled_for: input.scheduledFor ?? null,
      timezone: input.timezone ?? 'Australia/Melbourne',
      created_by: input.createdBy ?? null,
      status: 'queued',
    })
    .select('id')
    .single()

  if (error) {
    // the partial unique index refuses a second live job for the same item
    if (/publish_jobs_one_live_per_item/.test(error.message)) {
      return { error: 'This content item is already queued to publish' }
    }
    return { error: error.message }
  }
  return { id: data.id }
}

/**
 * Attempt one job. Safe to call concurrently and safe to retry.
 * Returns the terminal status, or null if another worker held the claim.
 */
export async function runPublishJob(jobId: string): Promise<string | null> {
  // ── layer 1: claim it ────────────────────────────────────────────────
  const { data: claimed } = await supabase
    .from('publish_jobs')
    .update({ status: 'publishing', updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'queued')          // ← the gate; zero rows means we lost
    .select('*')
    .maybeSingle()

  if (!claimed) return null

  const job = claimed as unknown as PublishJob & { attempts: number }
  const publisher = getPublisher()

  const settle = async (fields: Record<string, unknown>) => {
    await supabase.from('publish_jobs')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', jobId)
  }

  try {
    // relay first, and persist the provider URLs so a retry does not re-upload
    const media = await relayMedia(job.media ?? [])
    if (media !== job.media) await settle({ media })

    const outcome = await publisher.createPost({
      caption: job.caption,
      media,
      targets: job.targets ?? [],
      scheduledFor: job.scheduled_for,
      timezone: job.timezone,
      requestId: job.request_id,   // ← layer 2, stable across retries
    })

    switch (outcome.kind) {
      case 'published': {
        // A future-dated post is accepted by the provider and held by their
        // scheduler — it is handed over, not live yet. Saying "published"
        // would be a lie the operator acts on.
        const isFuture = Boolean(
          job.scheduled_for && new Date(job.scheduled_for).getTime() > Date.now()
        )
        await settle({
          status: isFuture ? 'scheduled' : 'published',
          provider_post_id: outcome.postId,
          published_at: isFuture ? null : new Date().toISOString(),
          attempts: job.attempts + 1,
          error: null,
        })
        // Content Register (attribution tracker): every post that leaves
        // through here becomes a registered asset. Idempotent on the provider
        // post id, so the Zernio webhook announcing the same post later only
        // fills in the permalink. Best-effort — publishing must never fail
        // because registration did.
        if (outcome.postId) {
          try {
            const { registerFromZernioEvent } = await import('./tracker')
            await registerFromZernioEvent('post.published', {
              id: outcome.postId,
              caption: job.caption,
              platforms: (job.targets ?? []).map(t => ({ platform: t.platform })),
              publishedAt: isFuture ? job.scheduled_for : new Date().toISOString(),
            }, job.client_id)
          } catch (e) {
            console.error('asset auto-registration failed:', e)
          }
        }
        if (isFuture) return 'scheduled'
        // close the loop back into production: the board and the scheduler
        // must reflect that this actually went out
        if (claimed.content_item_id) {
          const { recordPublishOnItem } = await import('./production-publish')
          await recordPublishOnItem(claimed.content_item_id as string, null)
        }
        return 'published'
      }

      case 'duplicate':
        // layer 3 — the post is already live. Recording this as failure would
        // invite a retry that could double-post once the window expires.
        await settle({
          status: 'duplicate',
          provider_post_id: outcome.postId,
          published_at: new Date().toISOString(),
          attempts: job.attempts + 1,
          error: 'Provider reported an identical post already exists',
        })
        return 'duplicate'

      case 'retryable':
        // back to queued so the scheduler picks it up again
        await settle({ status: 'queued', attempts: job.attempts + 1, error: outcome.message })
        return 'queued'

      case 'permanent':
        await settle({ status: 'failed', attempts: job.attempts + 1, error: outcome.message })
        return 'failed'
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // never leave a job stuck in 'publishing' — that would be invisible forever
    await settle({ status: 'queued', attempts: job.attempts + 1, error: message })
    return 'queued'
  }
}

/**
 * Move a job's media onto the provider.
 *
 * The provider will not fetch arbitrary URLs, so assets living in Supabase
 * Storage have to be relayed: download the bytes, presign, PUT, and swap in
 * the returned URL. Already-relayed items are left alone, which makes this
 * safe to run again after a retry.
 */
async function relayMedia(media: MediaItem[]): Promise<MediaItem[]> {
  if (media.length === 0) return media
  const publisher = getPublisher()
  const providerHost = new URL(process.env.ZERNIO_API_URL ?? 'https://zernio.com/api/v1').host

  const out: MediaItem[] = []
  for (const item of media) {
    let host = ''
    try { host = new URL(item.url).host } catch { throw new Error(`Media URL is not valid: ${item.url}`) }
    if (host === providerHost || host.endsWith('.zernio.com')) { out.push(item); continue }

    const res = await fetch(item.url)
    if (!res.ok) throw new Error(`Could not read media (${res.status}): ${item.url}`)

    const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
    const filename = decodeURIComponent(new URL(item.url).pathname.split('/').pop() || 'asset')
    const bytes = await res.arrayBuffer()

    out.push(await publisher.uploadMedia({ bytes, filename, contentType }))
  }
  return out
}

/**
 * Return abandoned claims to the queue.
 *
 * A worker that dies between claiming a job and settling it — a crashed
 * process, a killed dev server, a serverless timeout — leaves the row in
 * 'publishing' where nothing will ever look at it again. Without this, such a
 * job is silently lost: no post, no error, no retry.
 *
 * The window must exceed the longest plausible publish (media relay included),
 * or a slow job would be re-queued while still running. The stored
 * x-request-id means even that case replays rather than double-posts.
 */
export async function reclaimStalePublishing(olderThanMinutes = 15): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString()
  const { data } = await supabase
    .from('publish_jobs')
    .update({
      status: 'queued',
      error: 'Publishing was interrupted; the job was returned to the queue',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'publishing')
    .lt('updated_at', cutoff)
    .select('id')
  return (data ?? []).length
}

/**
 * Reconcile jobs we believe published against what the provider says.
 *
 * Creating a post can succeed while publishing to the platform fails minutes
 * later — the provider's post then reads 'failed' or 'partial' while our row
 * still says 'published'. Trusting only the create response would report
 * success for posts that never appeared.
 */
export async function reconcilePublishedJobs(): Promise<number> {
  const since = new Date(Date.now() - 14 * 24 * 3600_000).toISOString()
  // 'scheduled' jobs are included: the provider posts them at their time and
  // nothing else ever flips our row to published — without this they sit as
  // "scheduled" forever while the post is live
  const { data: jobs } = await supabase
    .from('publish_jobs')
    .select('id, status, provider_post_id, content_item_id')
    .in('status', ['published', 'scheduled'])
    .gte('created_at', since)
    .not('provider_post_id', 'is', null)
    .limit(50)

  if (!jobs?.length) return 0

  const publisher = getPublisher()
  const all = await publisher.postAnalytics() as {
    posts?: { _id?: string; status?: string; platforms?: { platformPostUrl?: string }[] }[]
  } | null
  if (!all?.posts) return 0

  const byId = new Map(all.posts.map(p => [p._id, p]))
  let changed = 0

  for (const job of jobs) {
    const remote = byId.get(job.provider_post_id as string)
    if (!remote?.status) continue

    if (job.status === 'scheduled' && ['published', 'posted', 'success'].includes(remote.status)) {
      const url = remote.platforms?.find(p => p.platformPostUrl)?.platformPostUrl ?? null
      await supabase.from('publish_jobs').update({
        status: 'published',
        published_at: new Date().toISOString(),
        ...(url ? { permalink: url } : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', job.id).eq('status', 'scheduled')
      if (job.content_item_id) {
        const { recordPublishOnItem } = await import('./production-publish')
        await recordPublishOnItem(job.content_item_id as string, url)
      }
      changed++
      continue
    }

    if (remote.status === 'failed' || remote.status === 'partial') {
      await supabase.from('publish_jobs').update({
        status: 'failed',
        error: `Provider reported the post as ${remote.status} after creation`,
        updated_at: new Date().toISOString(),
      }).eq('id', job.id)
      changed++
    } else {
      // capture the permalink once the platform assigns one
      const url = remote.platforms?.find(p => p.platformPostUrl)?.platformPostUrl
      if (url) {
        await supabase.from('publish_jobs').update({ permalink: url }).eq('id', job.id)
        // mirror it onto the registered asset so evidence links to the live post
        await supabase.from('content_assets')
          .update({ post_url: url })
          .eq('provider_post_id', job.provider_post_id as string)
          .is('post_url', null)
        // the platform assigns the permalink after the fact; push it through
        // to the schedule entry so the client-facing live link is populated
        const { data: full } = await supabase
          .from('publish_jobs').select('content_item_id').eq('id', job.id).maybeSingle()
        if (full?.content_item_id) {
          const { recordPublishOnItem } = await import('./production-publish')
          await recordPublishOnItem(full.content_item_id as string, url)
        }
      }
    }
  }
  return changed
}

/**
 * Jobs to hand to the provider now.
 *
 * Scheduled posts are dispatched IMMEDIATELY rather than held until their
 * time: the provider accepts `scheduledFor` and runs its own scheduler, which
 * is infrastructure that exists and stays awake. Holding them here would make
 * a client's post depend on our cron running at the right minute — and if that
 * cron is not wired up, the post never goes out and nothing says so.
 *
 * The job row still tracks the post, so it can be cancelled or edited, and the
 * claim still guarantees it is handed over exactly once.
 */
export async function dueJobIds(): Promise<string[]> {
  const { data } = await supabase
    .from('publish_jobs')
    .select('id')
    .eq('status', 'queued')
    .lt('attempts', 5)               // stop hammering a job that keeps failing
    .order('created_at', { ascending: true })
    .limit(50)
  return (data ?? []).map(r => r.id as string)
}

/** Refresh the cached account list for a client from the provider. */
export async function syncSocialAccounts(clientId: string, profileId: string): Promise<number> {
  const accounts = await getPublisher().listAccounts(profileId)
  if (accounts.length === 0) return 0

  const { error } = await supabase.from('social_accounts').upsert(
    accounts.map(a => ({
      client_id: clientId,
      platform: a.platform,
      provider_account_id: a.providerAccountId,
      name: a.name,
      username: a.username,
      avatar_url: a.avatarUrl,
      // The provider is the source of truth: if it reports the account as
      // connected, it is live again. Without this, an account that was once
      // unlinked stays invisible forever after being reconnected.
      active: true,
      last_synced_at: new Date().toISOString(),
    })),
    { onConflict: 'provider_account_id' }
  )
  if (error) throw new Error(error.message)
  return accounts.length
}
