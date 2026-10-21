import { NextResponse } from 'next/server'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { watchSources } from '@/app/lib/drive-scan'
import { inngest } from '@/app/inngest/client'

/**
 * THE EDITOR PREVIEW'S "CHECK NOW": the minute check, run once on request — every card's Drive links read (read
 * only) and new files recorded. Writes only the inbox's own tables. Super admins only.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  try {
    await requireRole('super_admin')
    const r = await watchSources()
    // every new file goes to the AI scan (drive-scan-file)
    if (r.toScan.length) await inngest.send(r.toScan.map(id => ({ name: 'drive/scan.file', data: { seen_id: id, item_id: id.split('~')[0] } })))
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
