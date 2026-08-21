import 'server-only'
import { announceItemChange } from './production-live'
import { supabase } from '@/lib/supabase'
import { queuePublishJob } from './publish'
import {
  isPlatform, mediaTypeFor,
  type MediaItem, type PostKind, type Target,
} from './publish-core'

/**
 * The bridge from production to the outside world.
 *
 * Production owns the content and its approvals; social channels own the
 * accounts. This joins them: an approved item, its latest asset version, the
 * client's connected accounts for the platforms it targets, and the times the
 * scheduler set — turned into one publish job.
 *
 * One job per item, not per platform: the provider accepts many platforms in a
 * single post, and `publish_jobs` deliberately allows only one live job per
 * content item so an item can never be queued twice.
 */

/** Guess the media kind from a URL when no content type is available. */
function mediaFromUrl(url: string): MediaItem | null {
  const clean = url.split('?')[0].toLowerCase()
  const ext = clean.slice(clean.lastIndexOf('.') + 1)
  const byExt: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo',
    pdf: 'application/pdf',
  }
  const type = mediaTypeFor(byExt[ext] ?? '')
  return type ? { url, type } : null
}

/** Map production's content_type onto a posting intent.
 *
 *  'video' is deliberately left unmapped: a video may be a Reel or an ordinary
 *  feed video, and the provider's own inference (a lone video becomes a Reel)
 *  is the better default than us guessing. */
export function contentTypeToKind(contentType: string, media: MediaItem[]): PostKind | undefined {
  switch (contentType) {
    case 'reel':     return 'reel'
    case 'story':    return 'story'
    case 'carousel': return 'carousel'
    case 'static':   return 'feed'
    default:         return media.length > 1 ? 'carousel' : undefined
  }
}

export type ItemPublishPlan = {
  itemId: string
  clientId: string
  caption: string
  media: MediaItem[]
  targets: Target[]
  scheduledFor: string | null
  /** platforms the item asks for but the client has no connected account for */
  missing: string[]
  blocked: string | null
}

/**
 * Work out exactly what would be published for an item, without doing it.
 *
 * The UI shows this before anyone commits, so a missing channel or an
 * unapproved item is visible up front rather than as a failed job later.
 */
export async function planItemPublish(itemId: string): Promise<ItemPublishPlan> {
  const { data: item } = await supabase
    .from('content_items')
    .select('id, client_id, caption, title, platform_targets, status, content_type')
    .eq('id', itemId)
    .maybeSingle()

  if (!item) throw new Error('Content item not found')

  const plan: ItemPublishPlan = {
    itemId,
    clientId: item.client_id as string,
    caption: (item.caption as string) || (item.title as string) || '',
    media: [],
    targets: [],
    scheduledFor: null,
    missing: [],
    blocked: null,
  }

  // Only content that has cleared approval may go out. This is the whole point
  // of the workflow — publishing an item still in review would bypass it.
  const status = item.status as string
  if (!['approved_for_scheduling', 'scheduled', 'published'].includes(status)) {
    plan.blocked = `This item is "${status.replace(/_/g, ' ')}" — it has not been approved for scheduling yet`
  }

  // newest version wins; that is the one reviewers signed off
  const { data: version } = await supabase
    .from('asset_versions')
    .select('file_url, drive_url, version_number')
    .eq('item_id', itemId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const url = (version?.file_url as string) || (version?.drive_url as string) || ''
  const media = url ? mediaFromUrl(url) : null
  if (media) plan.media = [media]

  // what the client actually has connected
  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('platform, provider_account_id, active')
    .eq('client_id', item.client_id)
    .eq('active', true)

  // no explicit targets (the common case — nothing in the UI set them) means
  // every connected channel, rather than a permanently dead publish button
  let wanted = ((item.platform_targets as string[]) ?? []).map(p => p.toLowerCase())
  if (wanted.length === 0) {
    wanted = [...new Set((accounts ?? []).map(a => (a.platform as string).toLowerCase()))]
  }

  // production already knows what kind of content this is — carry it through
  // so a Reel is published as a Reel rather than a plain video post
  const kind = contentTypeToKind(item.content_type as string, plan.media)

  const byPlatform = new Map((accounts ?? []).map(a => [a.platform as string, a]))
  for (const p of wanted) {
    const account = byPlatform.get(p)
    if (account && isPlatform(p)) {
      plan.targets.push({
        platform: p,
        accountId: account.provider_account_id as string,
        options: kind ? { kind } : undefined,
      })
    } else {
      plan.missing.push(p)
    }
  }

  // the earliest time the scheduler set for this item, if any
  const { data: entries } = await supabase
    .from('schedule_entries')
    .select('scheduled_at')
    .eq('item_id', itemId)
    .not('scheduled_at', 'is', null)
    .order('scheduled_at', { ascending: true })
    .limit(1)
  plan.scheduledFor = (entries?.[0]?.scheduled_at as string) ?? null

  if (!plan.blocked && plan.targets.length === 0) {
    plan.blocked = wanted.length === 0
      ? 'This client has no connected accounts yet'
      : `No connected channel for ${plan.missing.join(', ')}`
  }

  return plan
}

/** Queue an approved item for publishing. Returns the job id. */
export async function queueItemPublish(
  itemId: string,
  opts: { publishNow?: boolean; createdBy?: string } = {}
): Promise<{ id: string } | { error: string; issues?: string[] }> {
  const plan = await planItemPublish(itemId)
  if (plan.blocked) return { error: plan.blocked }

  return queuePublishJob({
    clientId: plan.clientId,
    contentItemId: plan.itemId,
    caption: plan.caption,
    media: plan.media,
    targets: plan.targets,
    scheduledFor: opts.publishNow ? null : plan.scheduledFor,
    createdBy: opts.createdBy,
  })
}

/**
 * Write a publish result back into production.
 *
 * Without this the two halves drift: the post is live on Instagram while the
 * board still says "scheduled", and the scheduler has no live link to give the
 * client. Best-effort by design — a bookkeeping failure must never make a
 * successful publish look failed.
 */
export async function recordPublishOnItem(
  contentItemId: string,
  permalink: string | null
): Promise<void> {
  try {
    const patch: Record<string, unknown> = {
      publish_status: 'published',
      published_at: new Date().toISOString(),
    }
    if (permalink) patch.live_url = permalink

    await supabase.from('schedule_entries').update(patch).eq('item_id', contentItemId)
    const { data: updated } = await supabase
      .from('content_items')
      .update({ status: 'published', updated_at: new Date().toISOString() })
      .eq('id', contentItemId)
      .select('client_id')
      .maybeSingle()
    // open boards must hear about it, not wait for the 60s poll
    if (updated) {
      announceItemChange({ item_id: contentItemId, client_id: updated.client_id, status: 'published', kind: 'transition' })
    }
  } catch (e) {
    console.error('could not record publish on content item', contentItemId, e)
  }
}
