import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { MilanoteMedia } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { copyProgress } from '../../../../lib/milanote-media-core'
import { inngest } from '../../../../inngest/client'

export const dynamic = 'force-dynamic'

/**
 * THE MILANOTE COPY (20 Oct 2026, docs/MILANOTE_MERGE.md) — super admin only.
 * GET: how far the copy of Milanote's images and files has got. POST: start the background copy
 * (`milanote-media-copy`); it works through what is still to do and never copies a file twice.
 */
export async function GET() {
  return withRequestCache(async () => {
    try {
      await requireRole('super_admin')
      const rows = await table<MilanoteMedia>('milanote_media').list({ fresh: true })
      const failed = rows.filter(r => r.status === 'failed').slice(0, 20).map(r => ({ id: r.id, name: r.name, error: r.error }))
      return NextResponse.json({ ...copyProgress(rows), failed })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function POST() {
  try {
    await requireRole('super_admin')
    await inngest.send({ name: 'milanote/media.copy', data: {} })
    return NextResponse.json({ started: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
