import 'server-only'
import { table } from '@/lib/db'
import type { Client, ContentItem, PostAnalytic, SocialPost } from '@/lib/db-types'
import { resolvePortalClient } from './portal-thread'
import { analyticsForPost, networkName } from './post-page-core'
import {
  portalPerformance, readPerformance, type PortalPerformance,
} from './post-performance-core'
import { readInteractors, settingsOf } from './followers-core'
import { slidesOf } from './version-files-core'
import { safeZone } from './timezone-core'
import type { AssetVersion } from '@/lib/db-types'

/**
 * ONE POST, IN THE CLIENT'S WORDS — the share link's version of the post page.
 *
 * The same numbers, sanitised the way every other portal payload is: no ids,
 * no provider, no service name, no job, no error text, no internal link. The
 * client sees what went out, when, where, how it did, and how the account
 * moved around it.
 *
 * NAMES ARE THE ONE CONDITIONAL THING. Who liked a post and who followed from
 * it are only carried when THIS client's Followers switch is on — the same
 * switch that decides whether the portal has a Followers section at all. With
 * it off the counts still go out (they are the client's own numbers) and not
 * one handle does.
 *
 * Read tolerantly, like the intake tab: anything that fails is a section the
 * page does not draw, never a portal that will not load.
 */

export type PortalPostPerson = {
  name: string
  picture: string | null
}

export type PortalPostComment = {
  id: string
  /** the commenter's handle — only when the Followers switch is on */
  name: string | null
  text: string
  at: string | null
}

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
  /** how many people said something, and — with the switch on — what they said */
  comment_count: number
  comments: PortalPostComment[]
  /** how many liked, and — with the switch on — who */
  liked_count: number
  liked: PortalPostPerson[]
  /** who followed and then liked or commented; names only with the switch on */
  followed_count: number
  followed: PortalPostPerson[]
  /** is this client allowed to see the people at all */
  shows_people: boolean
}

/** One post, for one share token. Null when the token or the post is wrong. */
export async function getPortalPost(rawToken: string, postId: string): Promise<PortalPost | null> {
  try {
    const who = await resolvePortalClient(rawToken)
    if (!who) return null
    const row = await table<SocialPost>('social_posts').get(postId)
    if (!row || row.client_id !== who.id) return null

    // a post the client has never been shown is not their page: the same
    // gate the board uses — only a piece that has reached them
    const item = await table<ContentItem>('content_items').get(row.item_id)
    if (!item || item.client_id !== who.id) return null
    const hidden = ['draft_uploaded', 'internal_review', 'revision_required', 'revision_complete']
    if (hidden.includes(String(item.status))) return null

    const [clientRow, versions, analyticRows] = await Promise.all([
      table<Client>('clients').get(who.id).catch(() => null),
      table<AssetVersion>('asset_versions')
        .list({ by: { item_id: row.item_id }, orderBy: [['version_number', 'desc']], limit: 1 })
        .catch(() => [] as AssetVersion[]),
      table<PostAnalytic>('post_analytics').list({ by: { item_id: row.item_id } }).catch(() => [] as PostAnalytic[]),
    ])

    const showsPeople = settingsOf(clientRow).onPortal
    const rows = analyticsForPost(analyticRows, {
      item_id: row.item_id, publish_job_ids: row.publish_job_ids,
    })
    const main = rows[0] ?? null
    const performance = readPerformance(main?.performance)
    const interactors = readInteractors(main?.interactors)

    // the approved cut is what the client is shown — the same reader the
    // portal's own item page uses, so both pages show one set of pictures
    const slides = slidesOf(versions[0] ?? null)
    const networks = [...new Set(rows.map(r => networkName(r.platform)).filter(Boolean))]

    const person = (p: { username: string; full_name: string | null; profile_pic: string | null }): PortalPostPerson => ({
      name: p.full_name?.trim() || `@${p.username}`,
      picture: p.profile_pic,
    })
    const likedAll = (interactors?.likers ?? [])
      .map(u => interactors?.people?.[u])
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
    const followedAll = interactors?.followed ?? []

    return {
      client: { id: who.id, name: who.name },
      title: item.title,
      caption: row.caption ?? null,
      slides: slides.map(s => ({ url: s.url, type: s.type, name: s.name })),
      networks,
      posted_at: main?.published_at ?? row.sent_at ?? row.scheduled_for ?? null,
      timezone: safeZone(row.timezone ?? (clientRow?.timezone as string | null) ?? null),
      live_urls: rows.map(r => r.platform_post_url).filter((u): u is string => Boolean(u)),
      performance: portalPerformance(performance),
      metrics: main
        ? {
          views: main.views, reach: main.reach, impressions: main.impressions,
          likes: main.likes, comments: main.comments, shares: main.shares, saves: main.saves,
          sync_status: main.sync_status, synced_at: main.synced_at ?? undefined,
        }
        : null,
      comment_count: performance?.comments.length ?? 0,
      comments: showsPeople
        ? (performance?.comments ?? []).map(c => ({
          id: c.id, name: `@${c.author}`, text: c.text, at: c.at,
        }))
        : [],
      liked_count: likedAll.length,
      liked: showsPeople ? likedAll.slice(0, 60).map(person) : [],
      followed_count: followedAll.length,
      followed: showsPeople ? followedAll.slice(0, 60).map(person) : [],
      shows_people: showsPeople,
    }
  } catch {
    return null
  }
}
