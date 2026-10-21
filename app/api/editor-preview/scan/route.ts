import { NextResponse } from 'next/server'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { inngest } from '@/app/inngest/client'

/**
 * THE EDITOR PREVIEW'S "SCAN AGAIN": one file's AI scan queued now — for a scan that failed, or to watch it happen.
 * Writes only the inbox's own tables. Super admins only.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    await requireRole('super_admin')
    const body = await req.json().catch(() => ({})) as { seen_id?: unknown }
    const id = String(body.seen_id ?? '')
    if (!id) return NextResponse.json({ error: 'Which file?' }, { status: 400 })
    // queued, not run here: the scan is several steps and runs in the background job (drive-scan-file)
    await inngest.send({ name: 'drive/scan.file', data: { seen_id: id, item_id: id.split('~')[0] } })
    return NextResponse.json({ ok: true, note: 'queued' })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
