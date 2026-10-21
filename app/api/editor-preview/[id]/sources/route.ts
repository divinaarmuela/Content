import { NextResponse } from 'next/server'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { loadItemForUser } from '@/app/lib/production-access'
import { ensureSource } from '@/app/lib/drive-scan'
import { driveLinkTarget } from '@/app/lib/drive-handin-core'

/**
 * THE EDITOR PREVIEW: a Drive link given to a card (a master link, the colourist's own, a new one for Version 2) —
 * recorded as one of the card's sources, read by the minute check. Writes only `drive_sources`, never the card.
 * Super admins only while the preview is walked (drive-scan-core.ts).
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('super_admin')
    const { id } = await ctx.params
    const item = await loadItemForUser(user, id)
    if (!item) return NextResponse.json({ error: 'No such card' }, { status: 404 })
    const body = await req.json().catch(() => ({})) as { link?: unknown }
    const target = driveLinkTarget(body.link)
    if (!target.ok) return NextResponse.json({ error: target.error }, { status: 400 })
    const source = await ensureSource(item as never, String(body.link), user.id)
    if (!source) return NextResponse.json({ error: 'That link could not be added' }, { status: 400 })
    return NextResponse.json({ ok: true, source })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
