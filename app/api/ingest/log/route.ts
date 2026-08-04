import { NextResponse } from 'next/server'
import { guard } from '../../../lib/authz'
import { supabase } from '@/lib/supabase'

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
  // This returns sender addresses, subject lines and the classifier's
  // reasoning for every scanned message — inbound business correspondence.
  // A signed-in check alone exposed it to clients.
  const denied = await guard('account_manager')
  if (denied) return denied

  const limit = Math.min(Number(new URL(req.url).searchParams.get('limit') ?? 40), 200)

  const { data, error } = await supabase
    .from('email_ingest_log')
    .select('id, created_at, mailbox, from_email, subject, received_at, status, confidence, reasoning, lead_id, error')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('ingest log fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // last_scan_at must come from scan_runs, NOT from the newest log row.
  //
  // A row is only written when a message is *claimed*, so on a quiet inbox the
  // newest row stops moving while the scanner keeps running every 5 minutes.
  // The page then read "50 minutes ago" and looked broken when it was working
  // perfectly — it was showing when we last *found* something, labelled as
  // when we last *looked*. scan_runs gets a row on every run, found or not.
  const { data: lastRun } = await supabase
    .from('scan_runs')
    .select('started_at, status, scanned, claimed, leads_created')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    entries: data ?? [],
    last_scan_at: lastRun?.started_at ?? data?.[0]?.created_at ?? null,
    last_run: lastRun ?? null,
    // when the scanner last actually recorded a decision, which is a different
    // question and worth showing as its own line
    last_decision_at: data?.[0]?.created_at ?? null,
  })
}
