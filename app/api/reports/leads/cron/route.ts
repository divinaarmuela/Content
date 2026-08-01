import { NextResponse } from 'next/server'
import { runLeadsReportTick } from '../../../../lib/report-send'

export const maxDuration = 120

/** Standalone report tick for external schedulers (optional — the email
 *  ingest endpoint also runs the tick, so a single schedule suffices). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!secret || bearer !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runLeadsReportTick()
  return NextResponse.json(result, { status: result.error ? 500 : 200 })
}
