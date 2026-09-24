import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import { AuthzError, requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { canEditItemFields } from '../../../../../lib/item-edit-core'
import { finishedEditOf } from '../../../../../lib/card-link-core'
import { finalFilesOf } from '../../../../../lib/final-files-core'
import { mayStartNextRound, roundOf } from '../../../../../lib/edit-round-core'

/**
 * START THE NEXT VERSION (the owner, 24 Sep 2026: "they just wanna upload
 * version 2 with the new files").
 *
 * A round normally moves when a card comes back for changes and is handed in
 * again. An editor who had already handed this round in and then re-exported
 * had nowhere to put the new cut — every upload landed on the round already
 * handed in and the screen kept saying Version 1.
 *
 * This is the deliberate press, by the person holding the card or a manager.
 * It moves the round by one and nothing else: the files already handed in
 * keep their own round, so the earlier version stays exactly as it was.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const { id } = await params
      const user = await requireRole('editor')
      const item = await loadItemForUser(user, id)
      if (!canEditItemFields(user, item)) {
        throw new AuthzError('Only whoever holds this card — or a manager — can start the next version', 403)
      }
      const handedIn = finishedEditOf(item as never) !== null || finalFilesOf(item as never).length > 0
      if (!mayStartNextRound({ status: item.status, handedIn })) {
        throw new AuthzError(
          handedIn
            ? 'Booked in or already posted — the files are the channel’s now'
            : 'Nothing handed in for this version yet — replace those files instead',
          409,
        )
      }
      const round = roundOf(item) + 1
      // claimed on the round it read, so two presses cannot both move it
      const taken = await table<ContentItem>('content_items').claim(id, ((cur: ContentItem | null): unknown => {
        if (!cur || roundOf(cur as never) !== round - 1) return null
        return { ...cur, edit_round: round, updated_at: new Date().toISOString() }
      }) as (c: ContentItem | null) => ContentItem | null)
      if (!taken.claimed) return NextResponse.json({ round: roundOf(taken.current as never), already: true })
      return NextResponse.json({ round })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

