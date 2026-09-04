import { inngest } from './client'
import { table, withRequestCache } from '@/lib/db'
import { scanSingleMailbox } from '../lib/email-lead'
import { getScanSettings, enabledMailboxEmails } from '../lib/scan-settings'
import {
  dueJobIds, runPublishJob, reclaimStalePublishing, reconcilePublishedJobs,
} from '../lib/publish'
import { runLeadsReportTick } from '../lib/report-send'
import { reconcileAll } from '../lib/asana-sync'

/**
 * Background jobs. Each is a thin wrapper around a plain function that the
 * dashboard buttons also call — one code path, two triggers.
 *
 * Why Inngest over Vercel Cron: any schedule on the free tier, automatic
 * retries with backoff, and a run history you can inspect and replay.
 * (Inngest v4 API: triggers live inside the options object.)
 *
 * Fan-out, not a loop: the scheduler dispatches one event per mailbox and
 * each mailbox is scanned by its own invocation. That keeps a single slow or
 * broken mailbox from consuming the whole function's time budget, gives each
 * one independent retries, and means adding the tenth mailbox costs no more
 * wall-clock than the first.
 */

/** Every 5 minutes during the day, decide which mailboxes are due and
 *  dispatch one scan event each. Times are Melbourne local.
 *
 *  Frequency does not multiply Anthropic spend: scanSingleMailbox claims each
 *  Gmail message id via a unique constraint *before* classifying, so a message
 *  is sent to the model exactly once no matter how often we look. */
export const scanInboxScheduled = inngest.createFunction(
  {
    id: 'scan-inbox-scheduled',
    name: 'Dispatch inbox scans',
    // Every five minutes, around the clock. The 6am-10:45pm window meant an
    // enquiry arriving at 11pm sat unseen until the morning — and enquiries
    // do not keep office hours. Frequency does not multiply Anthropic spend:
    // each message id is claimed once in email_ingest_log, so only genuinely
    // new mail is ever classified.
    triggers: [{ cron: '*/5 * * * *' }],
    retries: 2,
    // the dispatcher is cheap; one at a time is plenty and avoids double-sends
    concurrency: { limit: 1 },
  },
  async ({ step }) => withRequestCache(async () => {
    // One step, not three. Inngest bills the run plus every step inside it, and
    // at a 5-minute cadence three cheap lookups cost as much as the work. They
    // are all reads with no side effects, so collapsing them loses nothing on
    // retry.
    const prep = await step.run('prepare-tick', async () => {
      const settings = await getScanSettings()
      if (!settings.schedule_enabled) return { enabled: false, mailboxes: [] as string[], bucket: 0 }
      return {
        enabled: true,
        mailboxes: await enabledMailboxEmails(),
        bucket: Math.floor(Date.now() / (5 * 60 * 1000)),
      }
    })

    if (!prep.enabled) return { skipped: 'scheduled scanning is switched off in settings' }
    const { mailboxes, bucket } = prep
    if (mailboxes.length === 0) return { skipped: 'no mailboxes enabled' }

    // The dedupe key must change every tick. Inngest's function-level
    // idempotency window is 24 HOURS, so keying on the mailbox alone would
    // have collapsed every scan after the first into a no-op — the schedule
    // would have run once a day regardless of the cron. Bucketing by the
    // 5-minute tick keeps the intended protection (a manual scan landing on
    // top of a scheduled one is still collapsed) without disabling the
    // schedule itself.
    //
    // The bucket is computed inside the step above so a retry reuses it
    // instead of minting a new one and re-dispatching.
    await step.sendEvent(
      'dispatch-mailbox-scans',
      mailboxes.map(email => ({
        name: 'app/inbox.mailbox.scan.requested',
        data: { email, trigger: 'scheduled' as const, dedupe: `${email}:${bucket}` },
      }))
    )
    return { dispatched: mailboxes.length, mailboxes }
  })
)

/** Scan one mailbox. The unit of work, of retry, and of failure.
 *
 *  `concurrency` caps how many mailboxes are in flight at once so a large team
 *  cannot stampede the Anthropic API; `idempotency` collapses duplicate events
 *  for the same mailbox inside one tick, which matters when a manual scan
 *  lands on top of a scheduled one.
 *
 *  The key is `event.data.dedupe`, which senders build as mailbox + tick (or
 *  mailbox + event id for on-demand). It must NOT be `event.data.email`:
 *  Inngest's idempotency window is 24 hours, so that would allow one scan per
 *  mailbox per day and silently defeat the schedule. */
export const scanMailbox = inngest.createFunction(
  {
    id: 'scan-mailbox',
    name: 'Scan one mailbox',
    triggers: [{ event: 'app/inbox.mailbox.scan.requested' }],
    retries: 2,
    concurrency: { limit: 3, key: 'event.data.email' },
    idempotency: 'event.data.dedupe',
  },
  async ({ event, step }) => withRequestCache(async () => {
    const email = String(event.data?.email ?? '')
    if (!email) return { skipped: 'no mailbox on event' }
    const trigger = (event.data?.trigger ?? 'event') as 'manual' | 'scheduled' | 'event'

    return step.run('scan', async () => scanSingleMailbox(email, trigger))
  })
)

/** Daily tick that sends the monthly leads report on the configured day.
 *  No-ops on every other day; the period claim makes double-sends impossible. */
export const leadsReportScheduled = inngest.createFunction(
  {
    id: 'leads-report-scheduled',
    name: 'Monthly leads report',
    triggers: [{ cron: 'TZ=Australia/Melbourne 0 8 * * *' }],
    retries: 3,
    concurrency: { limit: 1 },
  },
  async ({ step }) => withRequestCache(async () => {
    return step.run('report-tick', async () => runLeadsReportTick())
  })
)

/** Out-of-band trigger: `app/inbox.scan.requested` fans out over every enabled
 *  mailbox, the same way the schedule does. */
export const scanInboxOnDemand = inngest.createFunction(
  {
    id: 'scan-inbox-on-demand',
    name: 'Scan inbox (on demand)',
    triggers: [{ event: 'app/inbox.scan.requested' }],
    retries: 2,
    concurrency: { limit: 1 },
  },
  async ({ event, step }) => withRequestCache(async () => {
    const mailboxes = await step.run('list-mailboxes', async () => enabledMailboxEmails())
    if (mailboxes.length === 0) return { skipped: 'no mailboxes enabled' }

    // Keyed on the triggering event id: an explicit request is never collapsed
    // into an earlier one, but its own retries still are.
    await step.sendEvent(
      'dispatch-mailbox-scans',
      mailboxes.map(email => ({
        name: 'app/inbox.mailbox.scan.requested',
        data: { email, trigger: 'event' as const, dedupe: `${email}:${event.id}` },
      }))
    )
    return { dispatched: mailboxes.length, mailboxes }
  })
)

/** Every minute, dispatch any publish job whose time has come.
 *
 *  The dispatcher never publishes — it only fans out — so a slow provider call
 *  cannot delay the next tick. Each job is claimed by exactly one worker via a
 *  conditional update, so overlapping ticks are harmless. */
export const publishDispatcher = inngest.createFunction(
  {
    id: 'publish-dispatcher',
    name: 'Dispatch due posts',
    // Every 10 minutes, not every minute. Publish *timing* is Zernio's — jobs
    // are handed over immediately with `scheduledFor` and their scheduler
    // fires them — so this loop only needs to pass new jobs along and do
    // housekeeping. At one run a minute it consumed roughly three quarters of
    // the Inngest execution budget and would have starved the inbox scanner.
    triggers: [{ cron: '*/10 * * * *' }],
    retries: 1,
    concurrency: { limit: 1 },
  },
  async ({ step }) => withRequestCache(async () => {
    // Three reads collapsed into one step for the same billing reason as the
    // scan dispatcher. Each is independently idempotent, so a retry replaying
    // all three is safe.
    const { reclaimed, corrected, ids } = await step.run('sweep', async () => ({
      // rescue anything a dead worker left claimed, before looking for new work
      reclaimed: await reclaimStalePublishing(),
      // and correct anything the provider later reported as failed
      corrected: await reconcilePublishedJobs(),
      ids: await dueJobIds(),
    }))
    if (ids.length === 0) return { due: 0, reclaimed, corrected }

    await step.sendEvent(
      'dispatch-publish',
      ids.map(id => ({ name: 'app/post.publish.requested', data: { jobId: id } }))
    )
    return { due: ids.length, reclaimed, corrected }
  })
)

/** Publish one job. Retries are safe: the claim, the stored x-request-id and
 *  the provider's content hash each independently prevent a double post. */
export const publishPost = inngest.createFunction(
  {
    id: 'publish-post',
    name: 'Publish one post',
    triggers: [{ event: 'app/post.publish.requested' }],
    retries: 3,
    concurrency: { limit: 5 },
    idempotency: 'event.data.jobId',
  },
  async ({ event, step }) => withRequestCache(async () => {
    const jobId = String(event.data?.jobId ?? '')
    if (!jobId) return { skipped: 'no jobId' }
    return step.run('publish', async () => ({ status: await runPublishJob(jobId) }))
  })
)

/**
 * Refresh the per-post numbers every half hour.
 *
 * Per post, never the list: `/analytics` with no postId is a cached roll-up
 * that lags the platform by an hour or more, so a client opening their portal
 * would read yesterday's figures about this morning's Reel. Asking about ONE
 * post answers live.
 *
 * Ninety days because a Reel keeps accumulating for weeks — a client looking
 * back at last month should see what the work actually did, not what it had
 * done by the second day. It also back-fills permalinks: the platform assigns
 * a post's URL some time after our job flips to published, and
 * reconcilePublishedJobs only looks back fourteen days. Without this pass a
 * post whose link was null at flip time would never get one.
 *
 * Idempotent by construction: every write is an upsert on provider_post_id or
 * a null-guarded back-fill, so a retry re-reads the same numbers and writes
 * the same row.
 */
export const postAnalyticsRefresh = inngest.createFunction(
  {
    id: 'post-analytics-refresh',
    name: 'Refresh per-post analytics',
    triggers: [{ cron: 'TZ=Australia/Melbourne */30 * * * *' }],
    retries: 1,
    // one sweep at a time: two would ask the provider about the same posts
    concurrency: { limit: 1 },
  },
  async ({ step }) => withRequestCache(async () => {
    const analytics = await step.run('refresh', async () => {
      const { refreshRecentPostAnalytics } = await import('../lib/post-analytics')
      return refreshRecentPostAnalytics()
    })

    // …and while we are here every half hour, heal the Drive mirror.
    //
    // A file whose queue call never left the request left no trace to retry
    // from — no event, no row, no error — so the only way to find it is to
    // recompute what should be in Drive and ask for the difference. It rides
    // this cron rather than a function of its own precisely BECAUSE a new
    // Inngest function does nothing until the app is re-synced (CLAUDE.md
    // trap 5b), and a self-healing job that itself silently did nothing would
    // be the same bug wearing a different hat. Its own step, so a failure here
    // never re-runs the analytics refresh above.
    const mirrors = await step.run('sweep-drive-mirror', async () => {
      const { sweepMissingMirrors } = await import('../lib/gdrive-mirror')
      return sweepMissingMirrors()
    })

    // …and heal the video previews the same way, for the same reason.
    //
    // Two jobs in one step, because they are the same job: find video that
    // ought to have a browser-playable copy and does not, and chase the rows
    // whose `ready` webhook never arrived. The webhook is the live path and
    // answers in seconds; this is what makes a video that will not play a
    // delay rather than a dead end — including for every file uploaded before
    // Cloudflare Stream was wired up.
    //
    // It rides this cron for the same reason the Drive sweep does: a NEW
    // Inngest function does nothing until the app is re-synced (CLAUDE.md
    // trap 5b), and a self-healing job that silently did nothing would be the
    // bug wearing a hat. Its own step, so a Cloudflare outage never re-runs
    // the analytics refresh or the Drive sweep above.
    const previews = await step.run('sweep-video-previews', async () => {
      const { sweepMissingPreviews } = await import('../lib/stream')
      return sweepMissingPreviews()
    })

    // …and keep the database path warm. The first board load of the morning
    // paid ~870ms for its opening read against ~180ms warm — a cold
    // connection, not a slow query. Three trivial reads against the tables
    // every dashboard page opens with keep that path exercised between real
    // requests, riding this cron for the same reason the sweeps do (a NEW
    // function does nothing until re-synced — CLAUDE.md trap 5b).
    // Best-effort: a failed warm-up must never fail the run it rides.
    const warm = await step.run('keep-db-warm', async () => {
      try {
        const started = Date.now()
        await Promise.all([
          table('content_items').list({ limit: 1 }),
          table('team_users').list({ limit: 1 }),
          table('batches').list({ limit: 1 }),
        ])
        return { ok: true, ms: Date.now() - started }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    })

    return { analytics, mirrors, previews, warm }
  })
)

/**
 * Fetch a post's first numbers ten minutes after it goes live.
 *
 * The `post.published` webhook says the exact moment a post landed, but the
 * platforms do not have insights ready at that moment — Meta and TikTok both
 * return zeroes for the first few minutes, and caching a row of zeroes is worse
 * than having no row, because the portal then shows "0 views" about a Reel that
 * is doing fine. Ten minutes is late enough for real figures and early enough
 * that a client opening the portal after a morning post sees them.
 *
 * `step.sleep` is why this is an Inngest function rather than a `setTimeout`:
 * the wait survives the deploy that lands in the middle of it.
 *
 * Idempotent twice over — `idempotency` collapses duplicate deliveries of the
 * same post, and `refreshPostById` upserts on `provider_post_id`, so a replay
 * re-reads the same numbers and writes the same row. The half-hourly sweep
 * remains the backstop; this only shortens the first wait.
 */
export const postAnalyticsFirstFetch = inngest.createFunction(
  {
    id: 'post-analytics-first-fetch',
    name: 'First analytics fetch after publish',
    triggers: [{ event: 'app/social.post.published' }],
    retries: 2,
    concurrency: { limit: 5 },
    idempotency: 'event.data.providerPostId',
  },
  async ({ event, step }) => withRequestCache(async () => {
    const providerPostId = String(event.data?.providerPostId ?? '')
    if (!providerPostId) return { skipped: 'no providerPostId' }

    // the platform needs a few minutes before its insights mean anything
    await step.sleep('let-the-platform-catch-up', '10m')

    return step.run('fetch', async () => {
      const { refreshPostById } = await import('../lib/post-analytics')
      return { providerPostId, ...(await refreshPostById(providerPostId)) }
    })
  })
)

/**
 * Backfill anything the Asana webhooks missed.
 *
 * Asana delivery is at-most-once and its /events history is only 24 hours, so
 * this is not an optimisation — without it, gaps are permanent. It also
 * detects webhooks Asana has self-deleted (24h of failed delivery) so they can
 * be re-registered.
 *
 * The same `reconcileAll` runs behind the dashboard's "Sync now" button — one
 * code path, two triggers, as above.
 */
export const asanaReconcile = inngest.createFunction(
  {
    id: 'asana-reconcile',
    name: 'Reconcile Asana activity',
    // Every 15 minutes: the webhook carries the live path, so this poll is
    // only the gap-filler for Asana's at-most-once delivery. Spending budget
    // here would come straight out of the inbox scanner's.
    triggers: [{ cron: 'TZ=Australia/Melbourne */15 * * * *' }],
    retries: 2,
    // No LLM calls here — this is Asana REST plus upserts, and the paid Asana
    // plan allows 1,500 req/min, so a 5-minute cadence over a dozen projects
    // is a rounding error against that budget.
    concurrency: { limit: 1 },
  },
  async ({ step }) => withRequestCache(async () => step.run('reconcile', () => reconcileAll()))
)

/**
 * Scan one brand-guidelines document into a client's profile.
 *
 * A background job because a 60-page design document is chunked into several
 * model calls and runs for minutes — a request would be killed long before.
 * Retries are safe: a re-run re-reads the same PDF and merges into the same
 * profile, and merging is idempotent by construction (fonts by family,
 * colours by hex, rules by text).
 */
export const brandScan = inngest.createFunction(
  {
    id: 'brand-scan',
    name: 'Scan brand guidelines',
    triggers: [{ event: 'app/brand.scan.requested' }],
    retries: 1,
    // one document at a time: each is many sequential model calls, and two
    // scans of the same client would race on the stored profile
    concurrency: { limit: 2, key: 'event.data.clientId' },
  },
  async ({ event, step }) => withRequestCache(async () => {
    const { clientId, url, filename, by } = (event.data ?? {}) as Record<string, string>
    if (!clientId || !url) return { skipped: 'missing clientId or url' }

    return step.run('scan', async () => {
      const { runBrandScan } = await import('../lib/brand-scan')
      return runBrandScan({ clientId, url, filename: filename ?? 'brand.pdf', by: by ?? '' })
    })
  })
)

/**
 * Enrich a client from a submitted intake form.
 *
 * A background job, not inline in the submit route: the route already runs at
 * its 60s ceiling building the PDF and packing attachments, and this may make a
 * Haiku call — work that must never delay or fail a client's submission. Fired
 * best-effort by `app/intake.enrich.requested` after submit succeeds.
 *
 * Retries are safe by construction: every write is gated on a field being
 * EMPTY (the contact is inserted only if none matches; each brand field is
 * filled only if blank), so a re-run fills nothing already filled and never
 * overwrites a hand edit — the same idempotency a re-submit relies on.
 */
export const intakeEnrich = inngest.createFunction(
  {
    id: 'intake-enrich',
    name: 'Enrich client from intake',
    triggers: [{ event: 'app/intake.enrich.requested' }],
    retries: 1,
    // one enrichment per client at a time: two would race on the stored brand
    // profile, the same reason the brand scan is keyed on the client
    concurrency: { limit: 2, key: 'event.data.client_id' },
  },
  async ({ event, step }) => withRequestCache(async () => {
    const data = (event.data ?? {}) as Record<string, unknown>
    const form_id = String(data.form_id ?? '')
    const client_id = String(data.client_id ?? '')
    // a manual "Fill contacts & brand" click sets force → re-run the brand scan
    // even if a prior one finished empty
    const force = data.force === true || data.force === 'true'
    if (!form_id || !client_id) return { skipped: 'missing form_id or client_id' }

    return step.run('enrich', async () => {
      const { enrichFromIntake } = await import('../lib/intake-enrich')
      return enrichFromIntake({ formId: form_id, clientId: client_id, force })
    })
  })
)

/**
 * Due-date reminders — every weekday morning (Melbourne), whoever owns the
 * next move on an item that is due tomorrow, due today, or overdue gets one
 * email for it:
 *   - pre-approval statuses → the owner editor + the client's managers
 *   - approved_for_scheduling → every scheduler
 * The notification dedupe key includes today's date, so an overdue item
 * reminds once per day, never more.
 */
export const dueReminders = inngest.createFunction(
  {
    id: 'due-reminders',
    name: 'Production due-date reminders',
    triggers: [{ cron: 'TZ=Australia/Melbourne 0 8 * * 1-5' }],
    retries: 1,
  },
  async ({ step }) => withRequestCache(async () => {
    return step.run('remind', async () => {
      const { runDueReminders } = await import('../lib/due-reminders')
      return runDueReminders()
    })
  })
)

/**
 * Copy one file into Google Drive.
 *
 * A background job because the file can be gigabytes and the transfer can
 * fail halfway — the two things a request handler is worst at. The step body
 * throws on a transient failure and Inngest retries it, which is the whole
 * reason this is here rather than behind `after()` like the folder hooks.
 *
 * Retries are safe by construction: `drive_files` has
 * `unique (source_url, target)` and the row is claimed BEFORE the bytes move,
 * so a retry either finds the job finished or finds its own unfinished claim
 * to take back. It never uploads the same file twice.
 *
 * Concurrency is keyed on the ITEM, not globally: a shoot drop is two hundred
 * files that should mirror in parallel across items, while two files on the
 * same item racing to create the same missing folder is exactly how a
 * duplicate folder appears (Drive has no unique-name constraint).
 */
export const driveMirrorFile = inngest.createFunction(
  {
    id: 'drive-mirror-file',
    name: 'Mirror a file into Google Drive',
    triggers: [{ event: 'drive/mirror.file' }],
    retries: 3,
    concurrency: { limit: 3, key: 'event.data.scope' },
  },
  async ({ event, step }) => withRequestCache(async () => {
    const data = (event.data ?? {}) as Record<string, unknown>
    const { isMirrorTarget } = await import('../lib/gdrive-mirror-core')
    const target = data.target
    if (!data.source_url || !isMirrorTarget(target)) {
      return { skipped: 'malformed event' }
    }
    if (!data.item_id && !data.client_id) return { skipped: 'malformed event' }
    return step.run('mirror', async () => {
      const { mirrorFileNow } = await import('../lib/gdrive-mirror')
      return mirrorFileNow({
        item_id: data.item_id ? String(data.item_id) : null,
        client_id: data.client_id ? String(data.client_id) : null,
        source_url: String(data.source_url),
        name: String(data.name ?? ''),
        target,
        received_at: data.received_at ? String(data.received_at) : null,
      })
    })
  })
)

/**
 * Make one publish-grade copy of one video, for one channel.
 *
 * A background job because everything about it is slow or unreliable in a
 * request: presigning an upload, waking a Fly machine that may be asleep, and
 * then a wait of minutes while ffmpeg runs. The request that wants the copy
 * (`smallerCopyOf`) only sends this event and says "a few minutes".
 *
 * Retries are safe by construction. The row is CLAIMED on
 * `<hash of the source url>__<platform>` before the encoder is asked
 * anything, so a duplicate event, a retry, or two schedulers opening the same
 * post are one encode between them — the same discipline as `video_previews`
 * and `drive_files`, and for the same reason: an encode is minutes of a
 * machine's time, so a duplicate is a real cost.
 *
 * (CLAUDE.md trap 5b: a NEW Inngest function does nothing until the app is
 * re-synced. `curl -X PUT https://app.mdmmarketing.com.au/api/inngest`.)
 */
export const mediaEncode = inngest.createFunction(
  {
    id: 'media-encode',
    name: 'Make a publish-grade copy',
    triggers: [{ event: 'media/encode' }],
    // a transient refusal (the machine is busy) is retried with backoff; a
    // real refusal settles the row and never comes back here
    retries: 3,
    // Three at once, unkeyed. What stops two events for the same copy becoming
    // two encodes is NOT this number — it is the claim on the row id
    // (`<hash of source url>__<platform>`), which is atomic and holds however
    // many runs land together. This is only a cap on how much of the encoder's
    // (one-job-at-a-time) attention the app asks for at once.
    concurrency: { limit: 3 },
  },
  async ({ event, step }) => withRequestCache(async () => {
    const data = (event.data ?? {}) as Record<string, unknown>
    const sourceUrl = String(data.sourceUrl ?? '')
    const platform = String(data.platform ?? '')
    if (!sourceUrl || !platform) return { skipped: 'missing sourceUrl or platform' }

    return step.run('encode', async () => {
      const { runEncodeRequest } = await import('../lib/encode-run')
      return runEncodeRequest({
        sourceUrl,
        platform,
        kind: data.kind ? String(data.kind) : null,
        seconds: typeof data.seconds === 'number' ? data.seconds : null,
        assetId: data.assetId ? String(data.assetId) : null,
        versionId: data.versionId ? String(data.versionId) : null,
        slideIndex: typeof data.slideIndex === 'number' ? data.slideIndex : null,
      })
    })
  })
)

/**
 * A copy has landed — hand back every post that was waiting on it.
 *
 * This is the wake-up, and the reason nothing polls. The callback route has
 * already written the row (it must: the composer is watching it, and an
 * unverified body must never become an event); what is left is the follow-on
 * work, which is to dispatch the publish jobs that stopped short because the
 * copy was not ready. `runPublishJob` claims each one, so dispatching a job
 * that was already picked up is harmless.
 *
 * The ten-minute publish dispatcher remains the backstop: if this event is
 * ever missed, the post is late, not lost.
 */
export const mediaEncodeFinished = inngest.createFunction(
  {
    id: 'media-encode-finished',
    name: 'Release posts waiting on a copy',
    triggers: [{ event: 'media/encode.finished' }],
    retries: 2,
    concurrency: { limit: 5 },
  },
  async ({ event, step }) => withRequestCache(async () => {
    const data = (event.data ?? {}) as Record<string, unknown>
    const sourceUrl = String(data.sourceUrl ?? '')
    if (!sourceUrl) return { skipped: 'no sourceUrl on the event' }

    const ids = await step.run('find-waiting-jobs', async () => {
      const { jobsWaitingOnCopy } = await import('../lib/publish')
      return jobsWaitingOnCopy(sourceUrl)
    })
    if (ids.length === 0) return { released: 0 }

    await step.sendEvent(
      'release-waiting-jobs',
      ids.map(id => ({ name: 'app/post.publish.requested', data: { jobId: id } }))
    )
    return { released: ids.length }
  })
)

/**
 * Settle every copy nobody is ever going to finish.
 *
 * This is the guarantee, not the housekeeping. Without it a machine killed
 * mid-encode — or a callback lost across a deploy — leaves the row `running`
 * for ever: the publish dispatcher hands the waiting post back every ten
 * minutes, the post never goes out, and NO row anywhere says "failed". That
 * is the one outcome the whole design promises not to have.
 *
 * Three tries with a growing wait (90 minutes, then 180, then 270) so a
 * transient blip does not permanently poison every future post of that clip,
 * and then a plain sentence — at which point the waiting publish job takes
 * the `failed` branch it already has and tells somebody.
 *
 * Every re-ask re-signs the SAME R2 key the row already holds, so a copy can
 * never be recorded against an object it was not written to.
 *
 * (CLAUDE.md trap 5b: a NEW Inngest function does nothing until the app is
 * re-synced. `curl -X PUT https://app.mdmmarketing.com.au/api/inngest`.)
 */
export const encodeSweep = inngest.createFunction(
  {
    id: 'encode-sweep',
    name: 'Settle stale copies',
    triggers: [{ cron: '*/15 * * * *' }],
    retries: 1,
    // one sweep at a time: two would race to re-ask the same rows, and the
    // claim would make one of them a no-op anyway
    concurrency: { limit: 1 },
  },
  async ({ step }) => withRequestCache(async () => step.run('sweep', async () => {
    const { sweepStaleEncodes } = await import('../lib/encode-run')
    return sweepStaleEncodes()
  }))
)

export const functions = [
  dueReminders,
  driveMirrorFile,
  scanInboxScheduled,
  scanMailbox,
  leadsReportScheduled,
  scanInboxOnDemand,
  publishDispatcher,
  publishPost,
  postAnalyticsRefresh,
  postAnalyticsFirstFetch,
  asanaReconcile,
  brandScan,
  intakeEnrich,
  mediaEncode,
  mediaEncodeFinished,
  encodeSweep,
]
