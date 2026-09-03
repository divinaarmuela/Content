import { NextResponse } from 'next/server'
import { guard } from '../../../lib/authz'
import { table, withRequestCache } from '@/lib/db'

/** The decision trail for the inbox scanner.
 *
 *  Every message the scanner has ever claimed is recorded in email_ingest_log
 *  with the reason it was or was not turned into a lead. The dashboard reads
 *  this so a scan that produces no leads can still show its work, and so the
 *  history survives a page reload.
 *
 *  Auth is enforced here rather than in middleware, matching the sibling
 *  ingest routes — /api/ingest/* stays outside the protected matcher so the
 *  cron can reach the scan endpoint with a bearer secret. */
export async function GET(req: Request) {
  return withRequestCache(async () => {
    // This returns sender addresses, subject lines and the classifier's
    // reasoning for every scanned message — inbound business correspondence.
    // A signed-in check alone exposed it to clients.
    const denied = await guard('account_manager')
    if (denied) return denied

    const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? 40), 200)

    let data: Record<string, unknown>[]
    try {
      data = await table('email_ingest_log').list({
        orderBy: [['created_at', 'desc']],
        limit,
      })
    } catch (error) {
      console.error('ingest log fetch error:', error)
      return NextResponse.json({ error: (error as Error).message }, { status: 500 })
    }

    // last_scan_at must come from scan_runs, NOT from the newest log row.
    //
    // A row is only written when a message is *claimed*, so on a quiet inbox the
    // newest row stops moving while the scanner keeps running every 5 minutes.
    // The page then read "50 minutes ago" and looked broken when it was working
    // perfectly — it was showing when we last *found* something, labelled as
    // when we last *looked*. scan_runs gets a row on every run, found or not.
    const lastRun = await table('scan_runs')
      .list({ orderBy: [['started_at', 'desc']], limit: 1 })
      .then(r => r[0] ?? null)
      .catch(() => null)

    return NextResponse.json({
      entries: data,
      last_scan_at: lastRun?.started_at ?? data[0]?.created_at ?? null,
      last_run: lastRun ?? null,
      // when the scanner last actually recorded a decision, which is a different
      // question and worth showing as its own line
      last_decision_at: data[0]?.created_at ?? null,
    })
  })
}
