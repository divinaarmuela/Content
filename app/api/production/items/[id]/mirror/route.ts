import { NextResponse } from 'next/server'
import { requireSignedIn, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { sweepMissingMirrors } from '../../../../../lib/gdrive-mirror'

/**
 * "Retry Drive copy" — for one item, now.
 *
 * The same arithmetic the half-hourly sweep runs, aimed at a single piece of
 * work: what should be in this item's Drive folder, minus what is recorded as
 * being there, queued. It exists because the half-hourly pass is the right
 * cadence for a background repair and the wrong one for someone standing in
 * front of the item page reading "Copying to Drive… 5 of 7" and wondering
 * whether anything is still happening.
 *
 * Safe to press repeatedly: a file already in Drive is not in the difference,
 * and the `(source_url, target)` claim absorbs anything queued twice.
 *
 * Team roles only. Not because the number is a secret — because a client has
 * no Drive folder, and the whole mirror is the agency's own archive.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSignedIn()
    if (user.role === 'client') {
      return NextResponse.json({ error: 'Client accounts cannot do this' }, { status: 403 })
    }
    const { id } = await params
    // the access check is the item load: a scheduler who holds no hat here
    // never sees the item at all, and so cannot ask us to copy its files
    await loadItemForUser(user, id)

    const { missing, queued } = await sweepMissingMirrors({ itemIds: [id] })
    return NextResponse.json({ missing, queued })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
