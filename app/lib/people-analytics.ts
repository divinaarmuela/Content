import 'server-only'
import { table } from '@/lib/db'
import type { ContentItem, PostAnalytic, SocialAccount, SocialPost } from '@/lib/db-types'
import { followersEnabled, followersOf, snapshotsOf } from './followers'
import { dayKey, latestOf, postDay, readInteractors, type FollowerRow } from './followers-core'
import { postPageHref } from './post-page-core'
import { inboxTouchesFor } from './inbox-people'
import { buildPeople, type PeoplePost, type PeopleRow, type PeopleState } from './people-analytics-core'

/**
 * THE PEOPLE BEHIND THE NUMBERS — the database half.
 *
 * Every list this reads was written by a job that already runs: the morning
 * follower look, the daily read of a post's likers and commenters in its first
 * week, and the note the Inbox leaves of who it has seen. NOTHING HERE
 * FETCHES ANYTHING — no provider is called, on this path or any path it
 * touches, so opening the People view costs nothing and can be done all day.
 *
 * Scoped to ONE client, because a follower list belongs to an account and an
 * audience mixed across clients is a table nobody can read. The route enforces
 * that the caller is allowed that client.
 */

export type PeoplePayload = {
  state: PeopleState
  client: { id: string; name: string } | null
  today: string
  /** every person we know of for this client */
  rows: PeopleRow[]
  /** the day each of the client's posts went out — the "posts published" count */
  post_days: string[]
  /** the day of the last finished look, for the line under the table */
  as_of: string | null
}

const empty = (state: PeopleState, client: { id: string; name: string } | null, today: string): PeoplePayload => ({
  state, client, today, rows: [], post_days: [], as_of: null,
})

/** the post page a `post_analytics` row belongs to, when we can name one */
function hrefFor(row: PostAnalytic, posts: readonly SocialPost[]): string | null {
  const jobId = row.publish_job_id
  if (jobId) {
    const byJob = posts.find(p => Array.isArray(p.publish_job_ids) && (p.publish_job_ids as unknown[]).includes(jobId))
    if (byJob) return postPageHref(byJob.id)
  }
  if (row.item_id) {
    const byItem = posts.filter(p => p.item_id === row.item_id)
    if (byItem.length === 1) return postPageHref(byItem[0].id)
  }
  return null
}

export async function loadPeople(
  client: { id: string; name: string },
  now: Date = new Date(),
): Promise<PeoplePayload> {
  const today = dayKey(now)

  const accounts = await table<SocialAccount>('social_accounts').list({
    where: a => a.client_id === client.id && a.platform === 'instagram' && a.active !== false,
  })
  if (accounts.length === 0) return empty('not_instagram', client, today)
  if (!followersEnabled()) return empty('off', client, today)

  const [followerLists, lookLists, items, socialPosts, inbox] = await Promise.all([
    Promise.all(accounts.map(a => followersOf(a.id).catch(() => [] as FollowerRow[]))),
    Promise.all(accounts.map(a => snapshotsOf(a.id).catch(() => []))),
    table<ContentItem>('content_items').list({ by: { client_id: client.id } as Partial<ContentItem> }),
    table<SocialPost>('social_posts').list({ by: { client_id: client.id } as Partial<SocialPost> }).catch(() => [] as SocialPost[]),
    inboxTouchesFor(client.id),
  ])

  const followers = followerLists.flat()
  const looks = lookLists.flat()
  const latest = latestOf(looks)
  const finished = latestOf(looks.filter(s => s.status !== 'running'))
  const isPrivate = finished?.status === 'private' && (!latest || latest.status !== 'done')
  if (isPrivate) return { ...empty('private', client, today), as_of: finished?.day ?? null }
  if (followers.length === 0 && !latest) return empty('waiting', client, today)

  const titles = new Map(items.map(i => [i.id, i.title ?? null]))
  const analytics = titles.size === 0
    ? []
    : await table<PostAnalytic>('post_analytics').list({ where: r => !!r.item_id && titles.has(r.item_id) })

  const posts: PeoplePost[] = analytics.map(row => {
    const it = readInteractors(row.interactors)
    return {
      item_id: row.item_id,
      title: row.item_id ? titles.get(row.item_id) ?? null : null,
      href: hrefFor(row, socialPosts),
      day: postDay(row.published_at),
      likers: it?.likers ?? [],
      commenters: it?.commenters ?? [],
      people: it?.people ?? {},
    }
  })

  return {
    state: 'ready',
    client,
    today,
    rows: buildPeople({ followers, posts, inbox }),
    post_days: posts.map(p => p.day).filter((d): d is string => d !== null),
    as_of: finished?.day ?? null,
  }
}
