import { NextResponse } from 'next/server'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { scanSeen } from '@/app/lib/drive-scan-ai'

/**
 * THE EDITOR PREVIEW'S "SCAN AGAIN": one file's AI scan run now — for a scan that failed, or to watch it happen.
 * Writes only the inbox's own tables. Super admins only.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request) {
  try {
    await requireRole('super_admin')
    const body = await req.json().catch(() => ({})) as { seen_id?: unknown }
    const id = String(body.seen_id ?? '')
    if (!id) return NextResponse.json({ error: 'Which file?' }, { status: 400 })
    return NextResponse.json(await scanSeen(id))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
