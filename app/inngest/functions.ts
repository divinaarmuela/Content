import { inngest } from './client'
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
    triggers: [{ cron: 'TZ=Australia/Melbourne */5 6-22 * * *' }],
    retries: 2,
    // the dispatcher is cheap; one at a time is plenty and avoids double-sends
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
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
  }
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
  async ({ event, step }) => {
    const email = String(event.data?.email ?? '')
    if (!email) return { skipped: 'no mailbox on event' }
    const trigger = (event.data?.trigger ?? 'event') as 'manual' | 'scheduled' | 'event'

    return step.run('scan', async () => scanSingleMailbox(email, trigger))
  }
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
  async ({ step }) => {
    return step.run('report-tick', async () => runLeadsReportTick())
  }
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
  async ({ event, step }) => {
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
  }
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
  async ({ step }) => {
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
  }
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
  async ({ event, step }) => {
    const jobId = String(event.data?.jobId ?? '')
    if (!jobId) return { skipped: 'no jobId' }
    return step.run('publish', async () => ({ status: await runPublishJob(jobId) }))
  }
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
  async ({ step }) => step.run('reconcile', () => reconcileAll())
)

export const functions = [
  scanInboxScheduled,
  scanMailbox,
  leadsReportScheduled,
  scanInboxOnDemand,
  publishDispatcher,
  publishPost,
  asanaReconcile,
]
