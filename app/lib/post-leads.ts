import 'server-only'
import { table } from '@/lib/db'
import type { PostAnalytic, SocialAccount } from '@/lib/db-types'
import type { TeamUser } from './authz'
import { loadPostPage, type PostPageData } from './post-page'
import { loadPeople, type PeoplePayload } from './people-analytics'
import { followersOf } from './followers'
import { postDay, readInteractors } from './followers-core'
import { leadsForPost, leadCounts, type LeadRow, type LeadCounts } from './post-leads-core'

/**
 * WHO A POST BROUGHT IN — the server half. See `post-leads-core.ts` for the
 * rule; this only gathers what it judges.
 *
 * Gated by the post's own access rule (`loadPostPage`). Reads, never fetches:
 * the likers and commenters the daily read (or "Read who liked now") stored,
 * the follower list the 6 am look keeps, and the Inbox notes written when
 * somebody opened the Inbox. The page says which of those is missing.
 */

export type PostLeadsData = {
  post: PostPageData['post']
  item: PostPageData['item']
  client: PostPageData['client']
  /** the Instagram row this is judged from, or null when the post has none */
  analytics: PostAnalytic | null
  /** the Instagram account the post went out on — for the Inbox check */
  account: { id: string; provider_account_id: string | null } | null
  state: PeoplePayload['state'] | 'no_instagram_post'
  /** the day the post went out, Melbourne */
  post_day: string | null
  rows: LeadRow[]
  counts: LeadCounts
  /** when the follower list was last read in full */
  followers_as_of: string | null
  /** when likers and commenters were last read for this post */
  people_read_at: string | null
  people_status: string | null
  people_error: string | null
  /** has anybody's Inbox visit been noted for this client at all */
  inbox_noted: boolean
  may_read_people: boolean
}

export async function loadPostLeads(user: TeamUser, postId: string): Promise<PostLeadsData> {
  const page = await loadPostPage(user, postId)
  const analytics = page.analytics.find(a => String(a.platform) === 'instagram') ?? null
  const base = {
    post: page.post, item: page.item, client: page.client, analytics,
    account: null, post_day: null, rows: [] as LeadRow[], counts: leadCounts([]),
    followers_as_of: null, people_read_at: null, people_status: null, people_error: null,
    inbox_noted: false, may_read_people: page.may_read_people,
  }
  if (!analytics) return { ...base, state: 'no_instagram_post' }

  // the account the post went out on: the Instagram channel of the post
  const channel = page.channels.find(c => String(c.platform) === 'instagram') ?? null
  const account = channel ? await table<SocialAccount>('social_accounts').get(channel.account_id).catch(() => null) : null
  const people = await loadPeople({ id: page.client.id, name: page.client.name })
  const it = readInteractors(analytics.interactors)
  const day = postDay(analytics.published_at)
  const followers = account ? await followersOf(account.id).catch(() => []) : []
  const followerKeys = new Set(
    followers.filter(f => !f.gone_at).map(f => f.username.trim().replace(/^@/, '').toLowerCase()),
  )
  const rows = people.state === 'ready'
    ? leadsForPost({ rows: people.rows, itemId: page.item.id, postDay: day, followerKeys })
    : []

  return {
    ...base,
    state: people.state,
    account: account ? { id: account.id, provider_account_id: account.provider_account_id ?? null } : null,
    post_day: day,
    rows,
    counts: leadCounts(rows),
    followers_as_of: people.as_of,
    people_read_at: it?.fetched_at ?? null,
    people_status: it?.status ?? null,
    people_error: it?.error ?? null,
    inbox_noted: people.rows.some(r => r.reached_out_on !== null),
  }
}
