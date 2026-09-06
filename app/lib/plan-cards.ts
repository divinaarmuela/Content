import 'server-only'
import { table } from '@/lib/db'
import type { Batch, ContentItem, WorkKind as WorkKindRow } from '@/lib/db-types'
import type { TeamUser } from './authz'
import { planCards } from './deliverable-group-core'
import { resolveKindForWrite, type WorkKind } from './work-kinds-core'
import { logActivity } from './workflow'
import { announceItemChange } from './production-live'

/**
 * One line of the plan, one card on the board.
 *
 * Booking a shoot is the moment its plan becomes work: every line of "what is
 * coming out of this shoot" becomes its own content item, in Draft, for that
 * client and shoot, titled with the line. Never one card standing for several.
 *
 * Every card's id is fixed by the shoot and the line (`planCardId`), and the
 * write is a claim on that id — a claim on a row that already exists stands
 * down — so booking twice, undoing and re-booking, or two people booking at
 * once cannot make a second card. A line added to the plan AFTER booking runs
 * through here again and gets its card; a line removed keeps its card, because
 * by then it is real work and deleting work is a person's decision.
 */
export async function ensurePlanCards(
  actor: TeamUser,
  batch: Pick<Batch, 'id' | 'client_id' | 'planned_deliverables' | 'owner_id'>,
): Promise<ContentItem[]> {
  const wanted = planCards({ id: batch.id, client_id: batch.client_id }, batch.planned_deliverables)
  if (wanted.length === 0) return []
  const kinds = await table<WorkKindRow>('work_kinds').list() as unknown as WorkKind[]
  const kind = resolveKindForWrite(kinds, undefined)
  const workKindId = kind.ok ? kind.id : null
  const items = table<ContentItem>('content_items')
  const created: ContentItem[] = []
  for (const card of wanted) {
    const now = new Date().toISOString()
    const row = {
      id: card.id,
      created_at: now,
      updated_at: now,
      client_id: card.client_id,
      batch_id: card.batch_id,
      title: card.title,
      content_type: card.content_type,
      platform_targets: [],
      status: 'draft_uploaded',
      owner_id: null,
      assigned_by: null,
      due_date: null,
      priority: 'normal',
      caption: null,
      client_approval_required: true,
      current_version_number: 0,
      raw_assets_url: null,
      brief: null,
      raw_assets: [],
      work_kind_id: workKindId,
    } as unknown as ContentItem
    const claimed = await items.claim(card.id, cur => (cur ? null : row))
    if (claimed.claimed) created.push(claimed.row)
  }
  for (const item of created) {
    await logActivity({
      actor, clientId: item.client_id,
      entityType: 'content_item', entityId: item.id,
      action: 'created', newValue: item.title, detail: 'from the shoot plan',
    })
    announceItemChange({ item_id: item.id, client_id: item.client_id, status: item.status, kind: 'created' })
  }
  return created
}
