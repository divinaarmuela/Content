import 'server-only'
import { table } from '@/lib/db'
import type {
  Client, ContentItem, PostAnalytic, PublishJob, SocialAccount,
} from '@/lib/db-types'
import type { TeamUser } from './authz'
import { loadPostForUser, type PlannedPost } from './social-schedule'
import { analyticsForPost } from './post-page-core'
import { safeZone } from './timezone-core'

/**
 * A PAGE FOR EVERY POST — the server half.
 *
 * One read, one gate, one shape. The gate is `loadPostForUser`, which scopes
 * a post by the CARD it belongs to, so a post can never be a way round the
 * card's own access rules — a person who cannot open the card cannot read its
 * numbers by pasting an id into this page's address.
 *
 * NOTHING HERE FETCHES ANYTHING. Every figure on the page was written by a
 * sweep that already runs: `post_analytics.performance` (the half-hourly
 * refresh) and `post_analytics.interactors` (the once-a-day look at who
 * liked and who commented). This page reads those rows and nothing else — no
 * provider, no follower reader, no new job. A post the sweeps have not
 * reached yet says so on screen; it does not go and ask.
 */

/** One channel this post went to, as the page draws it. */
export type PostChannel = {
  account_id: string
  platform: string
  /** what the team calls this channel; the network's name when unset */
  name: string | null
  username: string | null
}

/** One publish job behind the post — where the hand-over got to. */
export type PostJob = {
  id: string
  status: string
  error: string | null
  permalink: string | null
  published_at: string | null
  scheduled_for: string | null
  timezone: string | null
  targets: unknown
  caption: string
  attempts: number
  created_at: string
}

export type PostPageData = {
  post: PlannedPost
  item: Pick<ContentItem, 'id' | 'title' | 'client_id' | 'status'>
  client: { id: string; name: string; timezone: string }
  channels: PostChannel[]
  jobs: PostJob[]
  /** the cached rows for this post, newest first — one per provider post */
  analytics: PostAnalytic[]
}

const asIds = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map(x => String(x ?? '')).filter(Boolean)

/** Everything the post's page needs, gated by the card it belongs to. */
export async function loadPostPage(user: TeamUser, id: string): Promise<PostPageData> {
  const { post, item } = await loadPostForUser(user, id)
  const jobIds = asIds(post.publish_job_ids)

  const [clientRow, accountRows, jobRows, analyticRows] = await Promise.all([
    table<Client>('clients').get(item.client_id).catch(() => null),
    table<SocialAccount>('social_accounts')
      .list({ by: { client_id: item.client_id } })
      .catch(() => [] as SocialAccount[]),
    jobIds.length > 0
      ? table<PublishJob>('publish_jobs').list({ where: j => jobIds.includes(j.id) }).catch(() => [] as PublishJob[])
      : Promise.resolve([] as PublishJob[]),
    table<PostAnalytic>('post_analytics')
      .list({ by: { item_id: item.id } })
      .catch(() => [] as PostAnalytic[]),
  ])

  const byId = new Map(accountRows.map(a => [a.id, a]))
  const channels: PostChannel[] = post.channels.map(ref => {
    const a = byId.get(ref)
    return {
      account_id: ref,
      platform: String(a?.platform ?? ref),
      name: a?.name ?? null,
      username: a?.username ?? null,
    }
  })

  return {
    post,
    item: { id: item.id, title: item.title, client_id: item.client_id, status: item.status },
    client: {
      id: item.client_id,
      name: clientRow?.name ?? 'No client',
      timezone: safeZone(post.timezone ?? (clientRow?.timezone as string | null) ?? null),
    },
    channels,
    jobs: jobRows.map(j => ({
      id: j.id,
      status: String(j.status ?? ''),
      error: j.error ?? null,
      permalink: j.permalink ?? null,
      published_at: j.published_at ?? null,
      scheduled_for: j.scheduled_for ?? null,
      timezone: j.timezone ?? null,
      targets: j.targets,
      caption: String(j.caption ?? ''),
      attempts: typeof j.attempts === 'number' ? j.attempts : 0,
      created_at: j.created_at,
    })),
    analytics: analyticsForPost(analyticRows, {
      item_id: item.id, publish_job_ids: post.publish_job_ids,
    }),
  }
}
