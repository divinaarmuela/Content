import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { canEditItemFields } from '../../../../../lib/item-edit-core'
import { startDriveHandIn } from '../../../../../lib/drive-handin'

/**
 * A NEW CARD WHOSE WORK IS ALREADY DONE (the owner, 26 Oct 2026: "when adding a new card add a new section called Drive
 * link that's ready for client … copy its videos onto the card … it passes through in progress and quality check and
 * goes straight to with client").
 *
 *   POST { url }   the whole Drive link is handed in as this card's Version 1 — copied by the existing drive-pull job —
 *                  and once it has landed the card goes straight to With client (drive-handin.ts sendStraightToClient)
 *                  and its videos are filed into the card's own Drive folder (drive-card-backfill)
 *
 * WHO: whoever may put finished files on the card (item-edit-core.canEditItemFields) — the person who just made it.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const item = await loadItemForUser(user, id)
      if (!canEditItemFields(user, item)) {
        return NextResponse.json({ error: 'Only whoever holds this card — or a manager — can hand in its files' }, { status: 403 })
      }
      if (String((item as { status?: unknown }).status) !== 'draft_uploaded') {
        return NextResponse.json({ error: 'This card is past its first stage — upload its files on the card instead' }, { status: 409 })
      }
      const body = await req.json().catch(() => ({})) as { url?: unknown }
      const started = await startDriveHandIn(user, item as never, { url: body.url }, { anyTime: true, toClient: true })
      if (!started.ok) return NextResponse.json({ error: started.error }, { status: started.status })
      return NextResponse.json({ ok: true, round: started.round })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
