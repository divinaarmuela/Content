import { inngest } from './client'
import { scanSingleMailbox } from '../lib/email-lead'
import { getScanSettings, enabledMailboxEmails } from '../lib/scan-settings'
import { dueJobIds, runPublishJob } from '../lib/publish'
import { runLeadsReportTick } from '../lib/report-send'

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

/** Every 15 minutes during the day, decide which mailboxes are due and
 *  dispatch one scan event each. Times are Melbourne local. */
export const scanInboxScheduled = inngest.createFunction(
  {
    id: 'scan-inbox-scheduled',
    name: 'Dispatch inbox scans',
    triggers: [{ cron: 'TZ=Australia/Melbourne */15 6-22 * * *' }],
    retries: 2,
    // the dispatcher is cheap; one at a time is plenty and avoids double-sends
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const settings = await step.run('load-settings', async () => getScanSettings())
    if (!settings.schedule_enabled) {
      return { skipped: 'scheduled scanning is switched off in settings' }
    }

    const mailboxes = await step.run('list-mailboxes', async () => enabledMailboxEmails())
    if (mailboxes.length === 0) return { skipped: 'no mailboxes enabled' }

    await step.sendEvent(
      'dispatch-mailbox-scans',
      mailboxes.map(email => ({
        name: 'app/inbox.mailbox.scan.requested',
        data: { email, trigger: 'scheduled' as const },
      }))
    )
    return { dispatched: mailboxes.length, mailboxes }
  }
)

/** Scan one mailbox. The unit of work, of retry, and of failure.
 *
 *  `concurrency` caps how many mailboxes are in flight at once so a large team
 *  cannot stampede the Anthropic API; `idempotency` collapses duplicate events
 *  for the same mailbox inside a short window, which matters when a manual
 *  scan lands on top of a scheduled one. */
export const scanMailbox = inngest.createFunction(
  {
    id: 'scan-mailbox',
    name: 'Scan one mailbox',
    triggers: [{ event: 'app/inbox.mailbox.scan.requested' }],
    retries: 2,
    concurrency: { limit: 3, key: 'event.data.email' },
    idempotency: 'event.data.email',
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
  async ({ step }) => {
    const mailboxes = await step.run('list-mailboxes', async () => enabledMailboxEmails())
    if (mailboxes.length === 0) return { skipped: 'no mailboxes enabled' }

    await step.sendEvent(
      'dispatch-mailbox-scans',
      mailboxes.map(email => ({
        name: 'app/inbox.mailbox.scan.requested',
        data: { email, trigger: 'event' as const },
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
    triggers: [{ cron: '* * * * *' }],
    retries: 1,
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const ids = await step.run('find-due', async () => dueJobIds())
    if (ids.length === 0) return { due: 0 }

    await step.sendEvent(
      'dispatch-publish',
      ids.map(id => ({ name: 'app/post.publish.requested', data: { jobId: id } }))
    )
    return { due: ids.length }
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

export const functions = [
  scanInboxScheduled,
  scanMailbox,
  leadsReportScheduled,
  scanInboxOnDemand,
  publishDispatcher,
  publishPost,
]
