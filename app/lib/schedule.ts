import 'server-only'
import { table } from '@/lib/db'
import type { ScheduleEntry } from '@/lib/db-types'
import { AuthzError, type TeamUser } from './authz'
import { actingRoles } from './workflow-core'
import { logActivity } from './workflow'
import { announceItemChange } from './production-live'
import { mirrorLatestVersionSoon } from './gdrive-mirror'
import { linkExternalPostSoon } from './external-post-match'

export type ScheduleEntryInput = {
  platform?: unknown
  scheduled_at?: unknown
  tool_url?: unknown
  live_url?: unknown
  mark_posted?: unknown
}

type SchedulableItem = {
  id: string
  client_id: string
  status: string
  owner_id?: string | null
  scheduler_ids?: unknown
}

/**
 * Write a platform's schedule row — the one place the scheduling hat is
 * enforced.
 *
 * The hat, not the job title: whoever was HANDED the scheduling holds it,
 * whatever their role, and a scheduler by title holds it only when nobody was
 * handed the item. That is `actingRoles`, the same reading the detail page
 * uses to decide whether to draw this form — so the button and the write can
 * no longer disagree. The route is a thin wrapper around this; the E2E calls
 * it directly, which is the point of it living here.
 *
 * One row per (item, platform): an existing row for the platform is patched
 * rather than duplicated, so saving a time twice cannot leave the calendar
 * showing the same post on two days.
 */
export async function upsertScheduleEntry(
  actor: TeamUser,
  item: SchedulableItem,
  input: ScheduleEntryInput,
) {
  const hats = actingRoles({ id: actor.id, role: actor.role }, item)
  if (!(hats.includes('scheduler') || actor.role === 'super_admin')) {
    throw new AuthzError('Only the person holding the scheduling may schedule this', 403)
  }
  if (!input.platform) throw new AuthzError('platform is required', 400)

  const patch: Record<string, unknown> = {
    item_id: item.id,
    platform: String(input.platform).toLowerCase(),
    scheduler_id: actor.id,
  }
  if ('scheduled_at' in input) patch.scheduled_at = input.scheduled_at
  if ('tool_url' in input) patch.tool_url = input.tool_url
  if ('live_url' in input) {
    patch.live_url = input.live_url
    if (input.live_url) {
      patch.publish_status = 'published'
      patch.published_at = new Date().toISOString()
    }
  }
  // posted natively in the platform's own app (Stories, no link) — mark it
  // published without demanding a URL. A published entry with no live_url
  // reads as an in-app post everywhere.
  if (input.mark_posted === true) {
    patch.publish_status = 'published'
    patch.published_at = new Date().toISOString()
  }

  const platform = patch.platform as string
  const existing = (await table<ScheduleEntry>('schedule_entries')
    .list({ by: { item_id: item.id }, where: r => r.platform === platform, limit: 1 }))[0] ?? null
  // 'scheduled' is what a brand-new entry is until something publishes it; a
  // row deleted between the read and the write is simply written fresh
  const data = (existing ? await table('schedule_entries').update(existing.id, patch) : null)
    ?? await table('schedule_entries').insert({ publish_status: 'scheduled', ...patch })

  await logActivity({
    actor, clientId: item.client_id,
    entityType: 'content_item', entityId: item.id,
    action: input.live_url ? 'live_link_added' : 'schedule_set',
    detail: `${patch.platform}${input.scheduled_at ? ` @ ${input.scheduled_at}` : ''}`,
  })
  // a date arriving — or moving — decides which month folder the piece lives
  // in. The mirror job re-parents an existing file rather than copying it
  // again, so a post pushed from August to September empties the August folder
  // instead of leaving it claiming a post that is not happening then.
  if ('scheduled_at' in input && input.scheduled_at) {
    mirrorLatestVersionSoon(item.id, 'scheduled')
  }

  // Posted by hand: the client is owed the same numbers as an item we
  // published ourselves. Nothing here holds a provider post id — there is no
  // publish job — so the provider's own list of posts made directly on the
  // platform is asked which post this link is, and the answer is cached as an
  // ordinary post_analytics row. Detached: a scheduler saving a link must not
  // wait on two provider round trips, and a provider outage must not turn
  // saving a link into an error on their screen.
  if (input.live_url || input.mark_posted === true) {
    linkExternalPostSoon({
      itemId: item.id,
      clientId: item.client_id,
      platform: String(patch.platform),
      liveUrl: (input.live_url as string | null) ?? null,
      at: (patch.published_at as string | undefined)
        ?? (data?.published_at as string | null)
        ?? (input.scheduled_at as string | null)
        ?? null,
    })
  }

  announceItemChange({
    item_id: item.id, client_id: item.client_id, status: item.status, kind: 'schedule',
  })
  return data
}
