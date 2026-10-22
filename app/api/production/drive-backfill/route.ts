import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { finalFilesOf } from '@/app/lib/final-files-core'
import { inngest } from '@/app/inngest/client'

/**
 * FILE EVERY CARD'S EXISTING FILES INTO ITS DRIVE FOLDER (card-upload.ts backfillPlan; the owner, 22 Oct 2026: "merge
 * all existing ones to the folders correctly"). Super admins only. One `drive/card.backfill` event per card with files;
 * the job does the rest, and running it again copies nothing that is already in Drive.
 *   POST {}                 every card with files
 *   POST { item_id }        one card
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      await requireRole('super_admin')
      const body = await req.json().catch(() => ({})) as { item_id?: unknown }
      const one = typeof body.item_id === 'string' && body.item_id ? body.item_id : null
      const cards = (await table<ContentItem>('content_items').list())
        .filter(i => !(i as { deleted_at?: unknown }).deleted_at && finalFilesOf(i as never).length > 0 && (!one || i.id === one))
      if (cards.length > 0) await inngest.send(cards.map(i => ({ name: 'drive/card.backfill', data: { item_id: i.id } })))
      return NextResponse.json({ cards: cards.length, files: cards.reduce((n, i) => n + finalFilesOf(i as never).length, 0) })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
