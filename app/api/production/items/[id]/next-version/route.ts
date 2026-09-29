import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import { AuthzError, requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { canEditItemFields } from '../../../../../lib/item-edit-core'
import { finishedEditOf } from '../../../../../lib/card-link-core'
import { finalFilesOf } from '../../../../../lib/final-files-core'
import { nextRoundWords, roundLabel, roundOf } from '../../../../../lib/edit-round-core'
import { logActivity } from '../../../../../lib/workflow'

/**
 * START THE NEXT VERSION (the owner, 24 Sep 2026: "they just wanna upload
 * version 2 with the new files").
 *
 * A round normally moves when a card comes back for changes and is handed in
 * again. An editor who had already handed this round in and then re-exported
 * had nowhere to put the new cut — every upload landed on the round already
 * handed in and the screen kept saying Version 1.
 *
 * This is the deliberate press, by the person holding the card or a manager,
 * and only while the editor holds it (`nextRoundWords` has the rule).
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
      const refused = nextRoundWords({ item: item as never, handedIn }).why
      if (refused) throw new AuthzError(refused, 409)
      const round = roundOf(item) + 1
      // claimed on the round it read, so two presses cannot both move it
      const taken = await table<ContentItem>('content_items').claim(id, ((cur: ContentItem | null): unknown => {
        // re-checked on the row being written: the card may have been handed over since it was read
        if (!cur || roundOf(cur as never) !== round - 1 || nextRoundWords({ item: cur as never, handedIn }).why) return null
        return { ...cur, edit_round: round, updated_at: new Date().toISOString() }
      }) as (c: ContentItem | null) => ContentItem | null)
      if (!taken.claimed) return NextResponse.json({ round: roundOf(taken.current as never), already: true })
      // WHO MOVED IT, ON THE CARD'S HISTORY (29 Sep 2026: a round moved with no line saying who or when)
      await logActivity({
        actor: user, clientId: item.client_id ?? null, entityType: 'content_item', entityId: id,
        action: 'version_started', oldValue: `v${round - 1}`, newValue: `v${round}`, detail: `Started ${roundLabel(round)}`,
      }).catch(() => {})
      return NextResponse.json({ round })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

