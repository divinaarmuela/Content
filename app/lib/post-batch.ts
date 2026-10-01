import 'server-only'
import { table } from '@/lib/db'
import { announceAfter } from '@/lib/live'
import type { AssetVersion, Client } from '@/lib/db-types'
import { deliverOnlyFor } from './deliver-only'
import { DELIVER_ONLY_REASON } from './deliver-only-core'
import { eligibility } from './social-schedule-core'
import { slidesOf } from './version-files-core'
import { finalFilesOf } from './final-files-core'
import { safeZone } from './timezone-core'
import { claimDraftPost } from './post-stage'
import { batchApprovalSteps, planBatch } from './post-batch-core'

/**
 * A CARD BECOMES ITS POSTS — the server half of app/lib/post-batch-core.ts (the owner, 1 Oct 2026).
 *
 * Called by the hand-over (the Hand to… popup's route, and the automatic hand-over when a client with a
 * scheduler set approves) while the card is still approved, because the files are read off the client's
 * sign-off: the approved version's files, every one. Each draft is CLAIMED under an id made of the card,
 * the version and the file, so this may run any number of times and the posts exist once.
 *
 * Nobody is emailed from here (a draft tells nobody, audit V12); the hand-over sends its one notice.
 */

export type CardForBatch = {
  id: string
  client_id: string
  title: string
  status: string
  content_type?: string | null
  final_files?: unknown
  edit_round?: unknown
  deliver_only?: boolean | null
}

export type BatchResult =
  | { ok: true; postIds: string[]; made: number; total: number }
  | { ok: false; reason: string }

export async function createBatchForCard(item: CardForBatch, opts: { scheduler: string }): Promise<BatchResult> {
  // DELIVER ONLY: the client posts it themselves — never a post here
  if (await deliverOnlyFor(item as never)) return { ok: false, reason: DELIVER_ONLY_REASON }
  const versions = await table<AssetVersion>('asset_versions').list({ where: v => v.item_id === item.id })
  // the CLIENT's sign-off (approved_for_scheduling / scheduled): the files of the version they approved
  const elig = eligibility(item as never, versions as never)
  if (!elig.ok) return { ok: false, reason: elig.reason }
  const client = await table<Client>('clients').get(item.client_id).catch(() => null)
  const planned = planBatch({
    itemId: item.id,
    title: item.title,
    round: Number(elig.version.version_number ?? 1),
    contentType: item.content_type ?? null,
    slides: slidesOf(elig.version),
    filesCard: finalFilesOf(item as never).length > 0,
  })
  if (planned.length === 0) return { ok: false, reason: 'No media yet' }
  const zone = safeZone((client as { timezone?: string | null } | null)?.timezone ?? null)
  const steps = batchApprovalSteps(client as never)
  const ids: string[] = []
  let made = 0
  for (const d of planned) {
    const res = await claimDraftPost({
      id: d.id,
      client_id: item.client_id,
      item_id: item.id,
      // the scheduler makes these posts: theirs to send, and theirs to change when the check asks
      created_by: opts.scheduler,
      assigned_to: opts.scheduler,
      version_id: (elig.version as { id?: string }).id ?? null,
      version_number: Number(elig.version.version_number ?? 1),
      slides: d.slides,
      caption: '',
      channels: [],
      per_channel: {},
      scheduled_for: null,
      timezone: zone,
      approval_steps: steps,
      batch: d.batch as unknown as Record<string, unknown>,
    })
    ids.push(d.id)
    if (res.created) {
      made++
      announceAfter('schedule', { client_id: item.client_id, post_id: d.id, kind: 'created' })
    }
  }
  return { ok: true, postIds: ids, made, total: planned.length }
}
