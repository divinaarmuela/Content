import 'server-only'
import { supabase } from '@/lib/supabase'
import { getPublisher } from './publisher'
import { validatePost, isPlatform, type MediaItem, type Platform } from './publish-core'

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
  targets: { platform: Platform; accountId: string }[]
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
  targets: { platform: Platform; accountId: string }[]
  scheduledFor?: string | null
  timezone?: string
  createdBy?: string
}): Promise<{ id: string } | { error: string; issues?: string[] }> {
  const platforms = input.targets.map(t => t.platform).filter(isPlatform)
  const issues = validatePost({ caption: input.caption, media: input.media, platforms })
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
      case 'published':
        await settle({
          status: 'published',
          provider_post_id: outcome.postId,
          published_at: new Date().toISOString(),
          attempts: job.attempts + 1,
          error: null,
        })
        return 'published'

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

/** Jobs whose scheduled time has arrived (or that publish immediately). */
export async function dueJobIds(now = new Date()): Promise<string[]> {
  const { data } = await supabase
    .from('publish_jobs')
    .select('id')
    .eq('status', 'queued')
    .or(`scheduled_for.is.null,scheduled_for.lte.${now.toISOString()}`)
    .lt('attempts', 5)               // stop hammering a job that keeps failing
    .order('scheduled_for', { ascending: true })
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
      last_synced_at: new Date().toISOString(),
    })),
    { onConflict: 'provider_account_id' }
  )
  if (error) throw new Error(error.message)
  return accounts.length
}
