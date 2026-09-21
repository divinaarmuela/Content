import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { adoptClips } from '../../../../../lib/adopt-clips'

/**
 * A LINK CARD'S COPIED CLIPS BECOME ITS FILES (final-files-core.ts, "adopted").
 * Pressed by the send-back dialog and the editor's card when they meet a link
 * card that has no files of its own. Safe to press twice: decided inside a
 * claim, and a card that already has files is left exactly as it is.
 */
export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const item = await loadItemForUser(user, id)
      const result = await adoptClips(item as ContentItem, user.id)
      return NextResponse.json(result)
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
