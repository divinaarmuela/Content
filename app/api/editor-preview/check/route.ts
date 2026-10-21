import { NextResponse } from 'next/server'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { watchSources } from '@/app/lib/drive-scan'

/**
 * THE EDITOR PREVIEW'S "CHECK NOW": the minute check, run once on request — every card's Drive links read (read
 * only) and new files recorded. Writes only the inbox's own tables. Super admins only.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST() {
  try {
    await requireRole('super_admin')
    return NextResponse.json({ ok: true, ...(await watchSources()) })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
