import 'server-only'
import { table } from '@/lib/db'
import type { Batch, ContentItem, TeamUser as TeamUserRow } from '@/lib/db-types'
import type { TeamUser } from './authz'
import { logActivity } from './workflow'
import { announceBatchChange } from './production-live'
import { handOverCards } from './shoot-handover'
import { notifyBriefShared } from './shoot-sop-notify'
import { AUTO_SHARE_WORDS, autoShareReady, planReviewRequired, shootStage } from './shoot-sop-core'

const melbourneToday = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })

/**
 * Share the plan with the team the moment it is ready (`autoShareReady`), with everything the Share button
 * does: the editor's card is made, everyone on the shoot is told. Called after every change that can finish
 * a plan — a save on the shoot page, the quality checker's pass, the client's approval. The claim re-checks
 * on the row being written, so two saves landing together share it once. Best-effort: never fails the save.
 */
export async function autoShareIfReady(actor: TeamUser, batchId: string): Promise<boolean> {
  try {
    const batches = table<Batch>('batches')
    const batch = await batches.get(batchId, { fresh: true })
    if (!batch || batch.brief_shared_at) return false
    const roleOf = async (uid: string | null | undefined) => uid ? (await table<TeamUserRow>('team_users').get(uid))?.role ?? null : null
    const planReview = planReviewRequired(batch, { createdByRole: await roleOf(batch.created_by), ownerRole: await roleOf(batch.owner_id) })
    const itemCount = await table<ContentItem>('content_items').count({ by: { batch_id: batchId } })
    const today = melbourneToday()
    if (!autoShareReady(batch, { today, itemCount, planReview })) return false
    const now = new Date().toISOString()
    const done = await batches.claim(batchId, cur =>
      cur && autoShareReady(cur, { today, itemCount, planReview }) ? { ...cur, brief_shared_at: now, brief_shared_by: actor.id } : null)
    if (!done.claimed) return false
    await logActivity({
      actor, clientId: batch.client_id, entityType: 'batch', entityId: batchId,
      action: 'sop_stage', oldValue: shootStage(batch, today, { planReview }), newValue: 'shared', detail: AUTO_SHARE_WORDS,
    })
    try { await handOverCards(actor, done.row, 'from the shoot') } catch (e) { console.error('card at auto share:', e) }
    await notifyBriefShared(actor, done.row).catch(e => console.error('auto share notify:', e))
    announceBatchChange({ batch_id: batchId, client_id: batch.client_id, status: done.row.status ?? 'brief', kind: 'updated' })
    return true
  } catch (e) {
    console.error('auto share:', e)
    return false
  }
}
