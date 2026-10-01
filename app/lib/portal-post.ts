import 'server-only'
import { table } from '@/lib/db'
import type { Client, ContentItem, PostAnalytic, PostVersion, SocialPost } from '@/lib/db-types'
import { portalOwnerByToken } from './portal-owner'
import { belongsToPortal } from './portal-owner-core'
import { analyticsForPost, networkName } from './post-page-core'
import { liveNetworks, postVersionId, readPostState } from './post-stage-core'
import { postLiveLinks, postedAt, readFrozenPost, reviewFiles } from './portal-core'
import {
  portalPerformance, readPerformance, type PortalPerformance,
} from './post-performance-core'
import { safeZone } from './timezone-core'

/**
 * ONE POST, IN THE CLIENT'S WORDS — the share link's version of the post page.
 *
 * The same numbers, sanitised the way every other portal payload is: no ids,
 * no provider, no service name, no job, no error text, no internal link. The
 * client sees what went out, when, where, how it did, and how the account
 * moved around it.
 *
 * NO NAMES. The comment count goes out (it is the client's own number) and not
 * one handle does. (Until 1 Oct 2026 a per-client Followers switch could add
 * the commenters', likers' and new followers' names; that switch was removed
 * with the third-party follower read it belonged to.)
 *
 * Read tolerantly, like the intake tab: anything that fails is a section the
 * page does not draw, never a portal that will not load.
 */

export type PortalPost = {
  client: { id: string; name: string }
  title: string
  /** the post as it published */
  caption: string | null
  slides: { url: string; type: 'image' | 'video'; name: string }[]
  /** the networks it went to, by their own names */
  networks: string[]
  /** when it went out, as an instant — the page formats it in the client's zone */
  posted_at: string | null
  timezone: string
  live_urls: string[]
  /** how it did, already client-safe */
  performance: PortalPerformance | null
  /** the platform's own figures, in the order the portal row shows them */
  metrics: {
    views: number | null; reach: number | null; impressions: number | null
    likes: number | null; comments: number | null; shares: number | null; saves: number | null
    sync_status: string | null; synced_at?: string
  } | null
  /** how many people said something */
  comment_count: number
}

/**
 * One LIVE post, for one share token. Null when the token or the post is
 * wrong, or the post is not out yet — a post before it goes out is its review
 * page (`getPortalPostPage`), read from its frozen version.
 *
 * Since the posting rebuild (29 Sep 2026) this reads the post's own stage and
 * its per-network record (`outcomes`), never the edit card's status or its
 * files: the pictures are the version that went out, and each network's link
 * is that network's (audit L1, P5).
 */
export async function getPortalPost(rawToken: string, postId: string): Promise<PortalPost | null> {
  try {
    const owner = await portalOwnerByToken(rawToken)
    if (!owner) return null
    const who = owner.client
    const row = await table<SocialPost>('social_posts').get(postId)
    const post = readPostState(row as unknown as Record<string, unknown> | null)
    if (!post || post.client_id !== who.id || post.stage !== 'posted') return null
    const item = post.source_item_id ? await table<ContentItem>('content_items').get(post.source_item_id).catch(() => null) : null
    // a person's portal holds only their own pieces' posts
    if (item ? !belongsToPortal(item as { for_contact_id?: string | null }, owner.scope) : owner.scope.kind !== 'business') return null

    const jobIds = post.booking?.job_ids ?? []
    const [clientRow, version, analyticRows] = await Promise.all([
      table<Client>('clients').get(who.id).catch(() => null),
      post.sent_version != null
        ? table<PostVersion>('post_versions').get(postVersionId(post.id, post.sent_version)).catch(() => null)
        : Promise.resolve(null),
      post.source_item_id
        ? table<PostAnalytic>('post_analytics').list({ by: { item_id: post.source_item_id } }).catch(() => [] as PostAnalytic[])
        : jobIds.length
          ? table<PostAnalytic>('post_analytics').list({ where: r => jobIds.includes(String(r.publish_job_id ?? '')) }).catch(() => [] as PostAnalytic[])
          : Promise.resolve([] as PostAnalytic[]),
    ])

    const rows = analyticsForPost(analyticRows, { item_id: post.source_item_id ?? '', publish_job_ids: jobIds })
    const main = rows[0] ?? null
    const performance = readPerformance(main?.performance)

    // what went out: the frozen version, or — for a post from before versions
    // were kept — the post as it went. Never the edit card's newest cut.
    const shown = readFrozenPost((version ?? {
      n: 0, slides: post.slides, per_channel: post.per_channel, channels: post.channels,
      caption: post.caption, scheduled_for: post.scheduled_for, timezone: post.timezone,
    }) as unknown as Record<string, unknown>)
    const slides = shown ? reviewFiles(shown) : []
    const links = postLiveLinks(post)
    const live = liveNetworks(post).map(networkName)
    const networks = live.length > 0 ? live : [...new Set(rows.map(r => networkName(r.platform)).filter(Boolean))]

    return {
      client: { id: who.id, name: who.name },
      title: String(item?.title ?? '').trim() || 'Your post',
      caption: shown?.caption || null,
      slides: slides.map(s => ({ url: s.url, type: s.type, name: s.name })),
      networks,
      posted_at: main?.published_at ?? postedAt(post),
      timezone: safeZone(post.timezone ?? (clientRow?.timezone as string | null) ?? null),
      live_urls: links.map(l => l.url),
      performance: portalPerformance(performance),
      metrics: main
        ? {
          views: main.views, reach: main.reach, impressions: main.impressions,
          likes: main.likes, comments: main.comments, shares: main.shares, saves: main.saves,
          sync_status: main.sync_status, synced_at: main.synced_at ?? undefined,
        }
        : null,
      comment_count: performance?.comments.length ?? 0,
    }
  } catch {
    return null
  }
}
