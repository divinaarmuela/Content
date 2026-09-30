import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { canEditItemFields } from '../../../../../lib/item-edit-core'
import { listDriveHandIn, startDriveHandIn } from '../../../../../lib/drive-handin'
import { defaultMap } from '../../../../../lib/drive-handin-core'

/**
 * A VERSION HANDED IN FROM GOOGLE DRIVE (the owner, 30 Sep 2026) — drive-handin-core.ts has the why.
 *
 *   GET  ?url=<Drive link>   what the link holds (read from Drive, read only), and which piece each file would
 *                            replace by default — for the editor to pick, order and confirm
 *   POST { url, ids, map }   hand those files in: recorded on the card, copied in the background by the existing
 *                            drive-pull-folder job, put on the card as this version's files when all have landed
 *
 * WHO: whoever may put finished files on the card today — the same rule the PATCH of `final_files` (the upload)
 * follows: the person holding it, whoever holds its scheduling, or a manager (item-edit-core.canEditItemFields).
 * Nothing here writes to Google Drive (CLAUDE.md trap 13).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const item = await loadItemForUser(user, id)
      if (!canEditItemFields(user, item)) {
        return NextResponse.json({ error: 'Only whoever holds this card — or a manager — can hand in its files' }, { status: 403 })
      }
      const url = new URL(req.url).searchParams.get('url')
      const listing = await listDriveHandIn(url)
      if (!listing.ok) return NextResponse.json({ error: listing.error }, { status: listing.status })
      return NextResponse.json({ ...listing, map: defaultMap(listing.files, item as never) })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const item = await loadItemForUser(user, id)
      if (!canEditItemFields(user, item)) {
        return NextResponse.json({ error: 'Only whoever holds this card — or a manager — can hand in its files' }, { status: 403 })
      }
      const body = await req.json().catch(() => ({})) as { url?: unknown; ids?: unknown; map?: unknown }
      const started = await startDriveHandIn(user, item as never, body)
      if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status })
      return NextResponse.json({ ok: true, round: started.round, hand_in: started.handIn })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
