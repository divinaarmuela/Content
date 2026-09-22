import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { EmailIngestLog, Prospect as ProspectRow, ProspectEvent } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { listMailboxEntries } from '../../../../lib/scan-settings'
import { agentSummary, findingsList, mailboxSummaries, recentReads, SCAN_CRON_WORDS } from '../../../../lib/acq-scanning-core'

/**
 * WHAT THE SCANNERS READ (the acquisition blueprint's Scanning page; 22 Sep
 * 2026): each mailbox the email scanner is set to read, when it last looked
 * and today's tally; the last messages it looked at and why each was kept
 * or skipped; when the agent last passed over the prospects; and the
 * findings the agent and the scanner put on prospects' timelines. Nothing
 * is written — this page only reads what the system already keeps.
 */
export const dynamic = 'force-dynamic'

const LOG_ROWS = 400

export async function GET() {
  return withRequestCache(async () => {
    try {
      await requireRole('scheduler') // any team role; excludes `client`
      const now = new Date().toISOString()
      const [entries, log, prospects, events] = await Promise.all([
        listMailboxEntries(),
        table<EmailIngestLog>('email_ingest_log').list({ orderBy: [['created_at', 'desc']], limit: LOG_ROWS }).catch(() => []),
        table<ProspectRow>('prospects').list({ limit: 2000 }),
        table<ProspectEvent>('prospect_events').list({ orderBy: [['at', 'desc']], limit: 600 }).catch(() => []),
      ])
      return NextResponse.json({
        words: SCAN_CRON_WORDS,
        mailboxes: mailboxSummaries(entries as never[], log as never[], now),
        recent: recentReads(log as never[]),
        agent: agentSummary(prospects as never[]),
        findings: findingsList(events as never[], prospects as never[]),
      })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
