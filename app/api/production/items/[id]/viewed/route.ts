import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { CardView } from '@/lib/db-types'
import { requireSignedIn, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'

/**
 * WHEN A PERSON LAST OPENED A CARD (the owner, 21 Sep 2026): stamped when the
 * card sheet or the card page opens, one row per person per card, so the
 * board can be ordered by "Last viewed". Nothing else is written, nobody is
 * told, and a card the person may not open is not stamped.
 */
export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireSignedIn()
    const { id } = await params
    await loadItemForUser(user, id)
    const viewed_at = new Date().toISOString()
    await table<CardView>('card_views').upsert({ id: `${user.id}__${id}`, user_id: user.id, item_id: id, viewed_at })
    return NextResponse.json({ viewed_at })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
