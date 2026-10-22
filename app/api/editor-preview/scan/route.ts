import { NextResponse } from 'next/server'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { inngest } from '@/app/inngest/client'
import { loadItemForUser } from '@/app/lib/production-access'

/**
 * THE EDITOR PREVIEW'S "SCAN AGAIN": one file's AI scan queued now — for a scan that failed, or to watch it happen.
 * Writes only the inbox's own tables. Anyone on the team who can open the card (22 Oct 2026: the new Editor is the Editor).
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const user = await requireRole('scheduler')
    const body = await req.json().catch(() => ({})) as { seen_id?: unknown }
    const id = String(body.seen_id ?? '')
    if (!id) return NextResponse.json({ error: 'Which file?' }, { status: 400 })
    if (!(await loadItemForUser(user, id.split('~')[0]).catch(() => null))) return NextResponse.json({ error: 'No such card' }, { status: 404 })
    // queued, not run here: the scan is several steps and runs in the background job (drive-scan-file)
    await inngest.send({ name: 'drive/scan.file', data: { seen_id: id, item_id: id.split('~')[0] } })
    return NextResponse.json({ ok: true, note: 'queued' })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
