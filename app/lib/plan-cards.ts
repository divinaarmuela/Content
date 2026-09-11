import 'server-only'
import { table } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { Batch, ContentItem, WorkKind as WorkKindRow } from '@/lib/db-types'
import type { TeamUser } from './authz'
import { deliverablesBrief, planLines, shootCard } from './deliverable-group-core'
import { kindIdForContentType, type WorkKind } from './work-kinds-core'
import { logActivity } from './workflow'
import { announceItemChange } from './production-live'

/**
 * ONE SHOOT, ONE CARD (the owner, 11 Sep 2026: five reels as five cards
 * "is gonna be cluttered"; making the account manager choose "one line or
 * five" is "too much too").
 *
 * Booking or confirming a shoot is the moment its plan becomes work: the
 * shoot gets a single content item, in Draft, titled with the shoot,
 * briefed with the list of what is coming out and the editor priorities.
 * Every final the editor makes goes onto that card as a file, and the
 * scheduler posts them one at a time ("2 of 6 posted").
 *
 * The card's id is fixed by the shoot (`shootCardId`) and the write is a
 * claim on it — a claim on a row that already exists stands down — so go
 * twice, undo and re-book, or two people at once cannot make a second card.
 * A shoot that already carries deliverable cards (the older one-card-per-
 * line shoots, or cards somebody made by hand and pointed at it) gets no new
 * card: nothing is deleted, nothing is doubled.
 */
export async function ensureShootCard(
  actor: TeamUser,
  batch: Pick<Batch, 'id' | 'client_id' | 'planned_deliverables' | 'owner_id'> & Partial<Pick<Batch, 'title' | 'editor_priorities'>>,
): Promise<ContentItem[]> {
  const card = shootCard({ id: batch.id, client_id: batch.client_id, title: batch.title ?? null }, batch.planned_deliverables)
  if (!card) return []
  const items = table<ContentItem>('content_items')
  const onShoot = await attachOne(
    await items.list({ by: { batch_id: batch.id }, limit: 200 }),
    'work_kind_id', 'work_kinds', ['slug'],
  )
  const hasDeliverable = onShoot.some(i => (i.work_kinds as { slug?: string } | null)?.slug !== 'shoot_brief')
  if (hasDeliverable) return []
  const kinds = await table<WorkKindRow>('work_kinds').list() as unknown as WorkKind[]
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
    brief: deliverablesBrief(planLines(batch.planned_deliverables), batch.editor_priorities ?? null) || null,
    raw_assets: [],
    // anything moving is the editor's; stills and carousels the designer's
    work_kind_id: kindIdForContentType(kinds, card.content_type),
  } as unknown as ContentItem
  const claimed = await items.claim(card.id, cur => (cur ? null : row))
  if (!claimed.claimed) return []
  const item = claimed.row
  await logActivity({
    actor, clientId: item.client_id,
    entityType: 'content_item', entityId: item.id,
    action: 'created', newValue: item.title, detail: 'from the shoot plan',
  })
  announceItemChange({ item_id: item.id, client_id: item.client_id, status: item.status, kind: 'created' })
  return [item]
}

/** @deprecated the old name — one card per plan line. Kept so nothing
 *  imported by name breaks; it makes the one shoot card now. */
export const ensurePlanCards = ensureShootCard
