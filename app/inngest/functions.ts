import { inngest } from './client'
import { scanInbox } from '../lib/email-lead'
import { runLeadsReportTick } from '../lib/report-send'

/**
 * Background jobs. Each is a thin wrapper around a plain function that the
 * dashboard buttons also call — one code path, two triggers.
 *
 * Why Inngest over Vercel Cron: any schedule on the free tier, automatic
 * retries with backoff, and a run history you can inspect and replay.
 * (Inngest v4 API: triggers live inside the options object.)
 */

/** Scan the shared inbox for new enquiries every 15 minutes during the day.
 *  Times are Melbourne local; the scan itself is idempotent (each Gmail
 *  message id is claimed once), so an extra run can never duplicate a lead. */
export const scanInboxScheduled = inngest.createFunction(
  {
    id: 'scan-inbox-scheduled',
    name: 'Scan inbox for leads',
    triggers: [{ cron: 'TZ=Australia/Melbourne */15 6-22 * * *' }],
    retries: 2,
    // one run at a time — overlapping scans would just contend on claims
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    return step.run('scan-inbox', async () => scanInbox())
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

/** Manual trigger: send an `app/inbox.scan.requested` event to run a scan
 *  out of band (e.g. from another service) without waiting for the cron. */
export const scanInboxOnDemand = inngest.createFunction(
  {
    id: 'scan-inbox-on-demand',
    name: 'Scan inbox (on demand)',
    triggers: [{ event: 'app/inbox.scan.requested' }],
    retries: 2,
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    return step.run('scan-inbox', async () => scanInbox())
  }
)

export const functions = [scanInboxScheduled, leadsReportScheduled, scanInboxOnDemand]
