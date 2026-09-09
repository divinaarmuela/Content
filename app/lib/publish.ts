import 'server-only'
import { randomUUID } from 'node:crypto'
import { table } from '@/lib/db'
import type {
  ContentAsset, ContentItem, PublishJob as PublishJobRow, SocialAccount,
} from '@/lib/db-types'
import { publishBlockReason } from './posting-approval-core'
import { getPublisher } from './publisher'
import { takeClaimLock, releaseClaimLock } from './claim-lock'
import { encoderConfigured } from './encoder'
import { measuredDurationOf, smallerCopyOf } from './stream'
import { headStoredObject, publicBase } from './storage'
import { channelsNeedingCopy, cleanCopyWords } from './shrink-core'
import { PLATFORM_MEDIA, copyTooBigReason, type AssetProbe } from './media-fit-core'
import { resultsForAll, resultsFromRemote, type OutcomeJob } from './post-outcome-core'
import {
  validatePost, isPlatform, describeRemoteOutcome, isStillProcessing, LIVE_JOB_STATUSES,
  type MediaItem, type PostKind, type Platform, type PostOptions, type Target,
  type RemotePlatformRow,
} from './publish-core'
export { LIVE_JOB_STATUSES }

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

export const publishLockKey = (contentItemId: string) => `publish__${contentItemId}`

/** The platform names off a job's stored targets, however loosely typed. */
function platformsOf(targets: unknown): string[] {
  if (!Array.isArray(targets)) return []
  return targets
    .map(t => String((t as { platform?: unknown })?.platform ?? ''))
    .filter(Boolean)
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
}): Promise<{ id: string } | { error: string; issues?: string[]; blocked?: boolean }> {
  const platforms = input.targets.map(t => t.platform).filter(isPlatform)
  // carry each target's intent into validation, so a Reel with a still image
  // or a Story with a carousel is refused here rather than by the platform
  const kinds: Partial<Record<Platform, PostKind>> = {}
  const mediaByPlatform: Partial<Record<Platform, MediaItem[]>> = {}
  const captionByPlatform: Partial<Record<Platform, string>> = {}
  /**
   * EVERY path is judged on its per-network options, this one included.
   *
   * This function is the one door onto a client's real account, and TikTok's
   * two consent flags are attached to every TikTok target by `buildPostBody`.
   * Leaving the options out of validation here meant the app told TikTok that
   * a human had confirmed the preview and agreed to its terms on a path where
   * no human was ever shown the sentence. That is a legal assertion, not a
   * default, so the tick is required wherever a post is queued.
   */
  const optionsByPlatform: Partial<Record<Platform, PostOptions>> = {}
  for (const t of input.targets) {
    if (t.options?.kind) kinds[t.platform] = t.options.kind
    // a channel with its own media or words is judged on THOSE
    if (t.options?.media?.length) mediaByPlatform[t.platform] = t.options.media
    if (t.options?.caption?.trim()) captionByPlatform[t.platform] = t.options.caption
    optionsByPlatform[t.platform] = t.options ?? {}
  }

  const issues = validatePost({
    caption: input.caption, media: input.media, platforms, kinds, mediaByPlatform,
    captionByPlatform, optionsByPlatform,
  })
  if (issues.length > 0) {
    return {
      error: 'This post is not valid for every selected platform',
      issues: issues.map(i => `${i.platform}: ${i.problem}`),
    }
  }

  // ── the approval gate ────────────────────────────────────────────────
  // Nothing reaches a client's real account without their sign-off, on EVERY
  // path — this one included. The ad-hoc composer used to walk straight past
  // the gate the item page enforces, which made "the post is locked until it
  // is approved" true of one screen and false of the system.
  //
  // Tolerant by design: no item link, no row, or a database without the
  // column all read as "the gate is not in use", which is exactly how this
  // behaved before the gate existed.
  if (input.contentItemId) {
    const item = await table<ContentItem>('content_items')
      .get(input.contentItemId).catch(() => null)
    const blocked = publishBlockReason(item?.posting_approval_state)
    if (blocked) return { error: blocked, blocked: true }
  }

  // only one LIVE job per content item, ever — the rule the partial unique
  // index enforced in Postgres. Queueing the same item twice is the one
  // mistake that double-posts to a client's real account.
  // 'scheduled' counts as live: the provider is HOLDING that post until its
  // time, so the item is still spoken for — queueing a second job would put
  // the same post out twice.
  //
  // "Is there a live job?" spans rows, so it cannot be a compare-and-set on
  // one of them; it is a lock row per content item instead, taken atomically
  // (see app/lib/claim-lock.ts). The lock names the job that holds it, and
  // is handed on the moment that job stops being live — so a settled or
  // deleted job can never leave an item unqueueable.
  const jobId = randomUUID()
  if (input.contentItemId) {
    // the read first, because it is the only thing that knows about jobs
    // queued before this lock existed — but it is not the guarantee
    const live = await table<PublishJobRow>('publish_jobs').list({
      where: j => j.content_item_id === input.contentItemId
        && LIVE_JOB_STATUSES.includes(j.status),
      limit: 1,
    })
    if (live.length > 0) return { error: 'This content item is already queued to publish' }

    const gate = await takeClaimLock(
      publishLockKey(input.contentItemId), jobId,
      async holder => {
        const held = await table<PublishJobRow>('publish_jobs').get(holder)
        return !!held && LIVE_JOB_STATUSES.includes(held.status)
      },
    )
    if (!gate.ok) return { error: 'This content item is already queued to publish' }
  }

  try {
    const now = new Date().toISOString()
    const row = await table('publish_jobs').insert({
      id: jobId,
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
      // stable across every retry of this job — layer 2 of the duplicate
      // defence, and no column default mints it any more
      request_id: randomUUID(),
      attempts: 0,
      updated_at: now,
    })
    return { id: row.id }
  } catch (e) {
    // the lock is only worth holding while there is a job behind it
    if (input.contentItemId) await releaseClaimLock(publishLockKey(input.contentItemId), jobId).catch(() => {})
    return { error: e instanceof Error ? e.message : 'Could not queue this post' }
  }
}

/**
 * After a post fails: ask the provider whether the client's accounts still
 * hold a live token, write the verdict, and tell the team about any that
 * have just died. Best effort — a health read that fails must not turn a
 * recorded failure into an unrecorded one.
 */
async function healthAfterFailure(clientId: string | null | undefined): Promise<void> {
  if (!clientId) return
  try {
    const { refreshClientAccountsHealth } = await import('./account-health')
    await refreshClientAccountsHealth(clientId, { tell: true })
  } catch (e) {
    console.error('[publish] health after failure', clientId, e instanceof Error ? e.message : e)
  }
}

/**
 * Attempt one job. Safe to call concurrently and safe to retry.
 * Returns the terminal status, or null if another worker held the claim.
 */
export async function runPublishJob(jobId: string): Promise<string | null> {
  // ── layer 1: claim it ────────────────────────────────────────────────
  // queued → publishing as ONE conditional write. Reading the status and
  // then writing it is two, and two workers can both pass the read — which
  // on this path means the same post going out twice.
  //
  // `publish_jobs` is not an updated_at trigger table, so the stamp is
  // explicit — and it is not decoration: reclaimStalePublishing re-queues
  // anything that has sat in 'publishing' for 15 minutes by that column. A
  // claim that left it at the job's queue time would look abandoned the
  // moment it was taken, and the same post would be dispatched twice.
  const taken = await table<PublishJobRow>('publish_jobs').claim(jobId, cur =>
    cur && cur.status === 'queued'
      ? { ...cur, status: 'publishing', updated_at: new Date().toISOString() }
      : null)
  if (!taken.claimed) return null                            // ← the gate; not queued means we lost
  const claimed = taken.row

  const job = claimed as unknown as PublishJob & { attempts: number }
  const publisher = getPublisher()

  /** the per-channel record for this settle — what each channel is doing
   *  now, written with every status change (post-outcome-core) */
  const perChannel = (
    status: 'queued' | 'scheduled' | 'published' | 'failed',
    detail: { reason?: string | null; at?: string | null } = {},
  ) => resultsForAll(job as unknown as OutcomeJob, status, { at: new Date().toISOString(), ...detail })

  const settle = async (fields: Record<string, unknown>) => {
    await table('publish_jobs')
      .update(jobId, { ...fields, updated_at: new Date().toISOString() })
    // a job that has stopped being live stops owning its content item
    const status = fields.status
    if (typeof status === 'string' && !LIVE_JOB_STATUSES.includes(status) && claimed.content_item_id) {
      await releaseClaimLock(publishLockKey(String(claimed.content_item_id)), jobId).catch(() => {})
    }
  }

  try {
    /**
     * Wait, if a channel is still having its clean copy made.
     *
     * The alternative — sending the master anyway — is the bug this whole
     * encoder exists to fix: Instagram takes a 2 GB file, silently
     * re-compresses it, and the client sees the loss on their own footage.
     * A post that goes out four minutes late is better than a post that goes
     * out looking wrong.
     *
     * The job goes back to 'queued' with the reason on the row and is woken
     * by `media/encode.finished` the moment the copy lands — no polling loop,
     * and the ten-minute dispatcher is the backstop if that event is missed.
     * `attempts` is deliberately NOT incremented: waiting is not a failed try.
     */
    const waited = await awaitCleanCopies(job)
    if (waited.wait) {
      await settle({ status: 'queued', error: waited.reason, platform_results: perChannel('queued', { reason: waited.reason }) })
      return 'queued'
    }
    if (waited.failed) {
      await settle({ status: 'failed', attempts: job.attempts + 1, error: waited.reason, platform_results: perChannel('failed', { reason: waited.reason }) })
      return 'failed'
    }
    if (waited.targets) {
      job.targets = waited.targets
      await settle({ targets: waited.targets })
    }

    /**
     * When every channel is holding its own file, the master stops travelling.
     *
     * It was relayed regardless: a 900 MB master pushed to the provider and
     * attached to the post as shared media that no channel was ever going to
     * use — the whole cost of the transfer, and the storage at the other end,
     * for nothing. Each channel's own copy is on its own target and is
     * relayed below.
     */
    if (waited.clearMedia && (job.media?.length ?? 0) > 0) {
      job.media = []
      await settle({ media: [] })
    }

    // relay first, and persist the provider URLs so a retry does not re-upload
    const media = await relayMedia(job.media ?? [], waited.targets
      ? 'This file is too big to send as it is — a copy is being made'
      : 'This file is too big to send as it is — post a smaller export')
    if (media !== job.media) await settle({ media })

    // a channel's own media has to make the same trip — it is the same kind
    // of URL the provider cannot fetch — and is persisted for the same reason
    const targets: Target[] = []
    let targetsChanged = false
    for (const t of (job.targets ?? []) as Target[]) {
      if (t.options?.media?.length) {
        const own = await relayMedia(
          t.options.media,
          'This copy is still too big to send — post a shorter or smaller export',
        )
        if (own !== t.options.media) targetsChanged = true
        targets.push({ ...t, options: { ...t.options, media: own } })
      } else {
        targets.push(t)
      }
    }
    if (targetsChanged) await settle({ targets })

    const outcome = await publisher.createPost({
      caption: job.caption,
      media,
      targets,
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
          // every channel booked, or every channel out — the provider's
          // per-channel verdict replaces this on the next reconcile
          platform_results: isFuture
            ? perChannel('scheduled', { at: job.scheduled_for })
            : perChannel('published'),
        })
        if (isFuture) return 'scheduled'
        // close the loop back into production: the board and the scheduler
        // must reflect that this actually went out
        if (claimed.content_item_id) {
          const { recordPublishOnItem } = await import('./production-publish')
          // the platforms travel with it so the audit trail can say WHO posted
          // it — "Posted by Instagram", not "the system"
          await recordPublishOnItem(
            claimed.content_item_id as string, null,
            (job.targets ?? []).map(t => t.platform),
          )
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
          platform_results: perChannel('published'),
        })
        // …and it must close the loop back into production exactly as
        // 'published' does. It did not, which meant a duplicate left the post
        // LIVE on the platform while the board and the client's portal both
        // still said "Scheduled" — and nothing ever corrected it, because
        // reconcilePublishedJobs does not look at duplicates either. The
        // posting card has always called this state "Posted"; now every other
        // screen agrees with it.
        if (claimed.content_item_id) {
          const { recordPublishOnItem } = await import('./production-publish')
          await recordPublishOnItem(
            claimed.content_item_id as string, null,
            (job.targets ?? []).map(t => t.platform),
          )
        }
        return 'duplicate'

      case 'retryable':
        // back to queued so the scheduler picks it up again
        await settle({ status: 'queued', attempts: job.attempts + 1, error: outcome.message, platform_results: perChannel('queued', { reason: outcome.message }) })
        return 'queued'

      case 'permanent':
        await settle({ status: 'failed', attempts: job.attempts + 1, error: outcome.message, platform_results: perChannel('failed', { reason: outcome.message }) })
        // a post that failed on a dead token must turn the account's icon
        // red NOW and tell the team — not at tomorrow's 7 am check. The
        // provider is asked for its verdict rather than the error string
        // parsed; a failure for any other reason changes nothing.
        await healthAfterFailure(job.client_id)
        return 'failed'
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // A file too big to carry is not a bad five minutes: the next attempt
    // would push exactly the same bytes at exactly the same ceiling. It fails,
    // with the sentence a person can act on, rather than going round for ever.
    if (e instanceof MediaTooBigToSend) {
      await settle({ status: 'failed', attempts: job.attempts + 1, error: message, platform_results: perChannel('failed', { reason: message }) })
      return 'failed'
    }
    // never leave a job stuck in 'publishing' — that would be invisible forever
    await settle({ status: 'queued', attempts: job.attempts + 1, error: message, platform_results: perChannel('queued', { reason: message }) })
    return 'queued'
  }
}

/**
 * Is every channel that needs a clean copy holding one yet?
 *
 * Only ever relevant to a job whose media is ONE video: a carousel's slides
 * are not one file to shrink, and a channel that already has its own file
 * (the composer usually fills it in before the job is queued) is left alone.
 *
 * Answers one of three things, and never throws — a job must not be lost
 * because a HEAD request had a bad afternoon:
 *   { wait }              a copy is being made; try again when it lands
 *   { failed }            no copy can be made, and the master must not be sent
 *   { targets } or {}     go ahead, with the copies filled in
 *
 * With no encoder configured this does nothing at all, and the job behaves
 * exactly as it did before the encoder existed.
 */
async function awaitCleanCopies(job: PublishJob): Promise<{
  wait?: true; failed?: true; reason?: string; targets?: Target[]; clearMedia?: true
}> {
  if (!encoderConfigured()) return {}
  const media = job.media ?? []
  if (media.length !== 1 || media[0]?.type !== 'video') return {}
  const url = media[0].url
  const targets = (job.targets ?? []) as Target[]
  const platforms = targets.map(t => t.platform).filter(isPlatform)
  if (platforms.length === 0) return {}

  // the size is the whole question, and only the storage host knows it
  const head = await headStoredObject(url).catch(() => null)
  if (head?.bytes == null) return {}

  /**
   * How long the clip runs, if anything knows.
   *
   * It matters more than it looks. The bitrate a copy is made at is derived
   * from the channel's size limit spread over the length being budgeted for,
   * and with no length we have to budget for the channel's whole ceiling:
   * Instagram's 300 MB over fifteen minutes is about 2 Mbps, against the
   * 10 Mbps a twenty-second reel can afford. Because the copy is claimed on
   * `source + channel`, whoever asks first fixes that for good — so an
   * unmeasured automated post would quietly give back most of what this
   * service was built to gain.
   *
   * `MediaItem` carries no duration, but the `video_previews` row for the same
   * file usually does — every upload goes through it for the portal player.
   * That row is OURS: `measuredDurationOf` reads it directly rather than
   * through the Stream accessor, so the number keeps working on the day this
   * workspace drops Cloudflare, which is the point of the encoder. When even
   * that is missing the fallback still applies, and the job row records
   * `target_source: 'fallback'` so the gap is findable.
   */
  const measured = await measuredDurationOf(url)
  const seconds = measured ?? undefined
  if (seconds === undefined) {
    console.warn(`[publish ${job.id}] no measured duration for ${url}; the copy will be budgeted for the channel's whole length ceiling`)
  }

  const probe: AssetProbe = {
    url, type: 'video', bytes: head.bytes,
    ...(seconds !== undefined ? { seconds } : {}),
  }
  const kinds: Partial<Record<Platform, PostKind>> = {}
  const own: Partial<Record<Platform, MediaItem[]>> = {}
  for (const t of targets) {
    if (t.options?.kind) kinds[t.platform] = t.options.kind
    if (t.options?.media?.length) own[t.platform] = t.options.media
  }

  /** Is every channel holding a file of its own, so the master need not go? */
  const allCovered = (list: Target[]) =>
    list.length > 0 && list.every(t => (t.options?.media?.length ?? 0) > 0)

  const needing = channelsNeedingCopy({ probes: [probe], platforms, kinds, own })
  if (needing.length === 0) return allCovered(targets) ? { clearMedia: true } : {}

  const copies = new Map<Platform, { url: string }>()
  for (const platform of needing) {
    const state = await smallerCopyOf(url, platform, kinds[platform], seconds)
    if (state.status === 'encoding') {
      return { wait: true, reason: cleanCopyWords(PLATFORM_MEDIA[platform]?.label ?? platform) }
    }
    if (state.status === 'failed') {
      return {
        failed: true,
        reason: `Could not prepare a copy for ${PLATFORM_MEDIA[platform]?.label ?? platform} — try a smaller export (${state.reason})`,
      }
    }
    /**
     * The copy is weighed against the channel it was made for.
     *
     * `ready` used to be enough. But a copy is only ever as good as the
     * arithmetic that sized it, and this is the last place before a client's
     * account where a copy that came out three times the channel's limit can
     * still be stopped — a Story trimmed to 60 seconds is a promise made by
     * the encoder, not something we had ever checked.
     */
    const tooBig = copyTooBigReason(platform, kinds[platform], state.bytes)
    if (tooBig) return { failed: true, reason: tooBig }
    copies.set(platform, { url: state.url })
  }

  // the copy becomes that channel's OWN file, so everything downstream —
  // the relay, the payload, the provider — treats it like one added by hand
  const next = targets.map(t => {
    const copy = copies.get(t.platform)
    if (!copy || t.options?.media?.length) return t
    return { ...t, options: { ...(t.options ?? {}), media: [{ url: copy.url, type: 'video' as const }] } }
  })
  return allCovered(next) ? { targets: next, clearMedia: true } : { targets: next }
}

/**
 * Hand back to the dispatcher every job that was waiting on this file.
 *
 * The wake-up, not a poll: `media/encode.finished` calls this and the jobs it
 * names are dispatched again at once. A job that is not queued is not
 * waiting, and the claim in `runPublishJob` means dispatching one twice is
 * harmless.
 */
export async function jobsWaitingOnCopy(sourceUrl: string): Promise<string[]> {
  if (!sourceUrl) return []
  const rows = await table<PublishJobRow>('publish_jobs').list({
    by: { status: 'queued' },
    where: j => Array.isArray(j.media)
      && (j.media as MediaItem[]).some(m => m?.url === sourceUrl),
    limit: 50,
  })
  return rows.map(r => r.id)
}

/**
 * A file this function cannot carry, said once so the caller can fail the job
 * rather than hand it back to the queue.
 *
 * The generic catch in `runPublishJob` re-queues, which is right for a bad
 * five minutes and exactly wrong for this: a 900 MB master does not get
 * smaller on the next attempt, and the reclaim sweep would push it through
 * the provider again every fifteen minutes for ever.
 */
export class MediaTooBigToSend extends Error {}

/** Is this address on our own storage's public host — a URL the provider
 *  can fetch for itself, with no relay in the way? */
function isOurPublicUrl(url: string): boolean {
  const base = publicBase()
  if (!base) return false
  try { return new URL(url).host === new URL(base).host } catch { return false }
}

/**
 * The most this function will push through itself, in MB.
 *
 * The relay is one serial R2 → this function → provider transfer inside an
 * Inngest run capped at 300 seconds (`app/api/inngest/route.ts`). A 900 MB
 * master does not finish: the run is killed with no error, the job never
 * settles, and `reclaimStalePublishing` starts the identical transfer again a
 * quarter of an hour later — provider storage, egress and function time,
 * unbounded, for a file that is never going to arrive.
 *
 * Comfortably above the biggest copy any channel takes (Instagram's 300 MB),
 * so a clean copy always travels; a master this size is refused in words.
 */
export const RELAY_MAX_MB = 350

/**
 * Move a job's media onto the provider.
 *
 * The provider will not fetch arbitrary URLs, so assets living in our own
 * storage (Cloudflare R2) have to be relayed: download the bytes, presign, PUT, and swap in
 * the returned URL. Already-relayed items are left alone, which makes this
 * safe to run again after a retry.
 *
 * `tooBigMessage` is what a person is told if one of these files is beyond
 * what this function can carry — the caller knows whether a copy is on its
 * way, and we do not.
 */
async function relayMedia(media: MediaItem[], tooBigMessage: string): Promise<MediaItem[]> {
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
    if (!res.body) throw new Error(`Media had no body: ${item.url}`)

    const contentType = res.headers.get('content-type') ?? 'application/octet-stream'
    const filename = decodeURIComponent(new URL(item.url).pathname.split('/').pop() || 'asset')
    const length = Number(res.headers.get('content-length'))

    // weighed BEFORE a byte is read: past this size the transfer does not
    // finish inside the function's 300 seconds, and an unfinished transfer is
    // a job that never settles and is started again for ever
    if (Number.isFinite(length) && length > RELAY_MAX_MB * 1024 * 1024) {
      await res.body.cancel().catch(() => {})
      /* TOO BIG TO CARRY IS NOT TOO BIG TO SEND. The relay was written when
       * media lived in Supabase Storage, on the belief that "the provider will
       * not fetch arbitrary URLs". Its docs say the opposite: a media URL has
       * to be public, return the bytes with the right Content-Type, not
       * redirect, and sit on a fast host — and our storage's public host is
       * all four. So a master past the relay's ceiling is handed over by its
       * own address and fetched by the provider, which has no 300-second
       * clock. Without this, the 8 Sep ceiling made every video over 350 MB
       * bound for TikTok or YouTube fail — "YouTube and TikTok take the
       * master" was true in shrink-core and false here (the owner, 9 Sep
       * 2026: "what happened to the 3:45 post"). */
      if (isOurPublicUrl(item.url)) { out.push(item); continue }
      throw new MediaTooBigToSend(tooBigMessage)
    }

    // The stream, NOT the bytes. `await res.arrayBuffer()` here read the whole
    // file into memory first, so a 2 GB master allocated 2 GB inside a
    // serverless function and the process was killed for it — no throw, no
    // catch, no error on the job, and the row left in `publishing` for the
    // reclaim to hand back to a retry that did exactly the same thing.
    out.push(await publisher.uploadMedia({
      body: res.body,
      filename,
      contentType,
      contentLength: Number.isFinite(length) && length > 0 ? length : null,
    }))
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
  const stale = await table<PublishJobRow>('publish_jobs')
    .list({ by: { status: 'publishing' }, where: j => j.updated_at < cutoff })
  await Promise.all(stale.map(j => table('publish_jobs').update(j.id, {
    status: 'queued',
    error: 'Publishing was interrupted; the job was returned to the queue',
    updated_at: new Date().toISOString(),
  })))
  return stale.length
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
  const jobs = await table<PublishJobRow>('publish_jobs').list({
    where: j => ['published', 'scheduled'].includes(j.status)
      && j.created_at >= since
      && j.provider_post_id != null,
    limit: 50,
  })

  if (!jobs.length) return 0

  const publisher = getPublisher()
  type Remote = { status?: string; platforms?: RemotePlatformRow[] }
  const all = await publisher.postAnalytics().catch(() => null) as {
    posts?: ({ _id?: string } & Remote)[]
  } | null
  const byId = new Map((all?.posts ?? []).map(p => [p._id, p as Remote]))
  let changed = 0

  // The list endpoint is a cached sync that can lag the platform by an hour or
  // more — a post that went live at 1:30 was still missing from it at 1:45
  // while asking for THAT post answered "published" at once. So a job we still
  // think is scheduled is always asked about by id; the list is only a
  // shortcut for jobs already known to be published.
  const lookup = async (job: { status: string; provider_post_id: unknown }): Promise<Remote | null> => {
    const id = String(job.provider_post_id)
    if (job.status !== 'scheduled' && byId.has(id)) return byId.get(id) ?? null
    const one = await publisher.postAnalytics(id).catch(() => null) as
      | (Remote & {
        publishedAt?: string | null
        platformAnalytics?: { platformPostUrl?: string | null; status?: string }[]
      })
      | null
    if (!one?.status) return byId.get(id) ?? null
    const platforms = one.platforms ?? one.platformAnalytics ?? []
    // The per-post endpoint says `status: "published"` the moment the provider
    // ACCEPTS a future-dated post — with `publishedAt: null` and no platform
    // reporting anything. Read literally, a 3:00 pm post was "live" at 2:40.
    // Live means the provider has a publish time, or a platform says so.
    const LIVE = ['published', 'posted', 'success']
    // One channel live and three refused is NOT "published". A four-channel
    // post with YouTube up and Instagram, LinkedIn and TikTok failed read as
    // Live on our side because one platform said so — the person watching saw
    // a green tick over a post that missed three quarters of its audience.
    // Any failed channel makes it partial, and partial is described per
    // channel further down.
    // …but a TikTok "failed — still processing, do not repost" is a wait, not
    // a failure: the 3:26 pm master went live on TikTok 63 minutes later
    if (platforms.some(p => String(p.status ?? '').toLowerCase() === 'failed' && !isStillProcessing(p))) {
      return { status: 'partial', platforms }
    }
    const platformLive = platforms.some(p => LIVE.includes(String(p.status ?? '').toLowerCase()))
    const live = LIVE.includes(String(one.status).toLowerCase()) && (Boolean(one.publishedAt) || platformLive)
    return { status: live ? 'published' : (LIVE.includes(one.status) ? 'scheduled' : one.status), platforms }
  }

  for (const job of jobs) {
    const remote = await lookup(job)
    if (!remote?.status) continue

    if (job.status === 'scheduled' && ['published', 'posted', 'success'].includes(remote.status)) {
      const url = remote.platforms?.find(p => p.platformPostUrl)?.platformPostUrl ?? null
      // still 'scheduled' at the moment of writing, or somebody else moved it
      const live = await table<PublishJobRow>('publish_jobs').get(job.id)
      if (live?.status === 'scheduled') {
        const now = new Date().toISOString()
        await table('publish_jobs').update(job.id, {
          status: 'published',
          published_at: now,
          ...(url ? { permalink: url } : {}),
          platform_results: resultsFromRemote(job as unknown as OutcomeJob, remote.platforms, 'published', now),
          updated_at: now,
        })
      }
      if (job.content_item_id) {
        const { recordPublishOnItem } = await import('./production-publish')
        await recordPublishOnItem(job.content_item_id as string, url, platformsOf(job.targets))
      }
      changed++
      continue
    }

    if (remote.status === 'failed' || remote.status === 'partial') {
      // keep the per-platform reasons: a post live on YouTube and refused by
      // TikTok is not "failed", it is "went out on youtube; tiktok: <why>"
      const outcome = describeRemoteOutcome(remote.status, remote.platforms as RemotePlatformRow[])
      // nothing has actually failed yet — a channel is still processing. Say
      // so on the row without marking it failed, and without offering a retry
      // that would post the same video twice.
      const now = new Date().toISOString()
      if (outcome.failedPlatforms.length === 0 && outcome.pendingPlatforms.length > 0) {
        await table('publish_jobs').update(job.id, {
          error: outcome.error,
          ...(outcome.permalink ? { permalink: outcome.permalink } : {}),
          platform_results: resultsFromRemote(job as unknown as OutcomeJob, remote.platforms,
            job.status === 'scheduled' ? 'scheduled' : 'published', now),
          updated_at: now,
        })
        continue
      }
      // the one `status` word says failed; the record says WHICH channel went
      // out and which did not — "went out on instagram; tiktok: too big"
      await table('publish_jobs').update(job.id, {
        status: 'failed',
        error: outcome.error,
        ...(outcome.permalink ? { permalink: outcome.permalink } : {}),
        platform_results: resultsFromRemote(job as unknown as OutcomeJob, remote.platforms, 'failed', now),
        updated_at: now,
      })
      changed++
      await healthAfterFailure((job as { client_id?: string | null }).client_id ?? null)
    } else {
      // capture the permalink once the platform assigns one
      const url = remote.platforms?.find(p => p.platformPostUrl)?.platformPostUrl
      if (url) {
        await table('publish_jobs').update(job.id, {
          permalink: url,
          platform_results: resultsFromRemote(job as unknown as OutcomeJob, remote.platforms,
            job.status === 'scheduled' ? 'scheduled' : 'published', new Date().toISOString()),
        })
        // mirror it onto the registered asset so evidence links to the live post
        const assets = await table<ContentAsset>('content_assets').list({
          where: a => a.provider_post_id === job.provider_post_id && a.post_url == null,
        })
        await Promise.all(assets.map(a =>
          table<ContentAsset>('content_assets').update(a.id, { post_url: url })))
        // the platform assigns the permalink after the fact; push it through
        // to the schedule entry so the client-facing live link is populated
        if (job.content_item_id) {
          const { recordPublishOnItem } = await import('./production-publish')
          await recordPublishOnItem(job.content_item_id as string, url, platformsOf(job.targets))
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
  const rows = await table<PublishJobRow>('publish_jobs').list({
    by: { status: 'queued' },
    where: j => j.attempts < 5,      // stop hammering a job that keeps failing
    orderBy: [['created_at', 'asc']],
    limit: 50,
  })
  return rows.map(r => r.id)
}

/** Refresh the cached account list for a client from the provider. */
export async function syncSocialAccounts(clientId: string, profileId: string): Promise<number> {
  const accounts = await getPublisher().listAccounts(profileId)
  if (accounts.length === 0) return 0

  for (const a of accounts) {
    const row = await table<SocialAccount>('social_accounts').upsert({
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
    }, { onConflict: 'provider_account_id' })
    // "when we connect an account, that's where the scraper should start
    // collecting": an Instagram account that has never been looked at gets
    // its baseline — the whole list — now, not at the next 06:00. Once, by
    // the snapshot claim; nothing for anyone to press; best-effort.
    if (a.platform === 'instagram' && a.username) await firstFollowerLook(row.id).catch(() => undefined)
  }
  return accounts.length
}

async function firstFollowerLook(accountId: string): Promise<void> {
  const { followersEnabled, snapshotsOf } = await import('./followers')
  if (!followersEnabled()) return
  if ((await snapshotsOf(accountId)).length > 0) return
  const { dayKey, snapshotId } = await import('./followers-core')
  const { inngest } = await import('../inngest/client')
  const day = dayKey(new Date())
  await inngest.send({
    name: 'app/followers.snapshot.requested',
    data: { accountId, mode: 'full' as const, trigger: 'scheduled' as const, dedupe: snapshotId(accountId, 'full', day) },
  })
}
