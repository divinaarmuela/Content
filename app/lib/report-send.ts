import 'server-only'
import { table } from '@/lib/db'
import type { ReportSetting } from '@/lib/db-types'
import { buildLeadsReportData } from './report-data'
import { renderLeadsReportPdf } from './report-pdf'
import { sendRawEmail, renderEmail } from './mailer'

/**
 * The monthly report tick. Safe to call as often as you like (every ingest
 * run, a daily cron, a manual poke): it no-ops unless reporting is enabled,
 * today is the configured send day, and this period hasn't been sent.
 * Double-send safe via a claim on last_sent_for: the period is written back
 * before the report is built, and a tick that finds the period already
 * recorded does nothing.
 */
export async function runLeadsReportTick(): Promise<{ sent?: boolean; skipped?: string; period?: string; error?: string }> {
  const settings = await table<ReportSetting>('report_settings').get('leads_report')
  if (!settings?.enabled) return { skipped: 'disabled' }
  const recipients = (settings.recipients ?? []) as unknown as string[]
  if (recipients.length === 0) return { skipped: 'no recipients' }

  const now = new Date()
  if (now.getUTCDate() !== settings.send_day) {
    return { skipped: `not send day (${settings.send_day})` }
  }

  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const periodKey = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`

  // claim the period before doing the work, so a second tick sees it taken
  if (settings.last_sent_for === periodKey) return { skipped: `already sent for ${periodKey}` }
  const claimed = await table<ReportSetting>('report_settings')
    .update('leads_report', { last_sent_for: periodKey })
  if (!claimed) return { skipped: `already sent for ${periodKey}` }

  try {
    const data = await buildLeadsReportData(prev.getUTCMonth() + 1, prev.getUTCFullYear(), settings.data_from)
    const pdf = await renderLeadsReportPdf(data)
    await sendRawEmail({
      to: recipients,
      subject: `Leads report — ${data.monthLabel}`,
      html: renderEmail(
        `Leads report — ${data.monthLabel}`,
        `<p><strong>${data.totals.leads}</strong> leads this period — ` +
        `${data.totals.fromForm} from the website form, ${data.totals.fromInbox} from the inbox scanner, ` +
        `and <strong>${data.totals.prospectsCreated}</strong> new prospects created. Full detail attached.</p>`
      ),
      attachments: [{
        filename: `md-media-leads-report-${periodKey}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      }],
    })
    return { sent: true, period: periodKey }
  } catch (e) {
    // release the claim so the next tick can retry
    await table<ReportSetting>('report_settings')
      .update('leads_report', { last_sent_for: null })
    return { error: e instanceof Error ? e.message : 'send failed' }
  }
}
