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

  // last_scan_at is the newest row: the scanner writes a row the moment it
  // claims a message, so this is when the scanner last actually did work.
  return NextResponse.json({
    entries: data ?? [],
    last_scan_at: data?.[0]?.created_at ?? null,
  })
}
