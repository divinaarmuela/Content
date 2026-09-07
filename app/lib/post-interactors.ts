import 'server-only'
import { table } from '@/lib/db'
import type { ContentItem, PostAnalytic, SocialAccount } from '@/lib/db-types'
import { configuredSource, followersEnabled, type FollowerSource } from './follower-source'
import { followersOf } from './followers'
import {
  COMMENT_PAGES_MAX, dayKey, followedFromPost, mergeInteractors, postWindowOpen, readInteractors,
  type FollowedFromPost, type Interactors,
} from './followers-core'

/**
 * WHO LIKED AND COMMENTED on a post that went out through the board — and,
 * crossed with the account's new followers, who FOLLOWED FROM THIS POST.
 *
 * Read once a day for the post's first week (a media lookup the first time,
 * one likers request, up to three comment pages — a handful, never a loop),
 * then never again. Stored on the post's own `post_analytics` row beside
 * `performance`, so the board and the card read it off the subscription
 * they already hold.
 *
 * Only posts published AFTER the client's Instagram account was connected:
 * the follower baseline starts at connection, so an older post has no "new
 * followers" to be crossed with and reading it would spend money on nothing.
 *
 * The once-a-day guard is a claim on the post row (`fetched_day` = today
 * stands down), so two ticks landing together read once.
 */

const analytics = () => table<PostAnalytic>('post_analytics')

function isInstagramPost(r: PostAnalytic): boolean {
  if (!r.platform_post_url) return false
  if (r.platform && r.platform !== 'instagram') return false
  return /instagram\.com\//i.test(r.platform_post_url)
}

/** the posts whose likers should be read today, with the account they belong to */
export async function duePosts(now: Date = new Date()): Promise<{ post: PostAnalytic; account: SocialAccount }[]> {
  const today = dayKey(now)
  const posts = (await analytics().list({ where: r => isInstagramPost(r) && postWindowOpen(r.published_at, today) }))
    .filter(r => !!r.item_id)
  if (posts.length === 0) return []
  const items = await table<ContentItem>('content_items').list({ where: i => posts.some(p => p.item_id === i.id) })
  const clientOf = new Map(items.map(i => [i.id, i.client_id]))
  const accounts = await table<SocialAccount>('social_accounts').list({
    where: a => a.platform === 'instagram' && !!a.client_id && a.active !== false,
  })
  const out: { post: PostAnalytic; account: SocialAccount }[] = []
  for (const post of posts) {
    const clientId = clientOf.get(post.item_id as string)
    if (!clientId) continue
    const account = accounts.find(a => a.client_id === clientId)
    if (!account) continue
    // nothing retroactive: the baseline starts when the account was connected
    if (post.published_at && account.connected_at && post.published_at < account.connected_at) continue
    const cur = readInteractors(post.interactors)
    if (cur?.fetched_day === today) continue
    out.push({ post, account })
  }
  return out
}

/** read one post's likers and commenters, once for today */
export async function readPostInteractors(
  postId: string, opts: { now?: Date; source?: FollowerSource | null } = {},
): Promise<{ status: 'read' | 'skipped' | 'failed'; reason?: string; likers?: number; commenters?: number }> {
  const now = opts.now ?? new Date()
  const source = opts.source === undefined ? configuredSource() : opts.source
  if (!source) return { status: 'skipped', reason: 'not switched on' }
  const today = dayKey(now)
  const stamp = now.toISOString()

  // the claim: whoever stamps today's day does today's read
  const seat = await analytics().claim(postId, cur => {
    if (!cur) return null
    const it = readInteractors(cur.interactors)
    if (it?.fetched_day === today) return null
    const running: Interactors = { ...(it ?? { ...emptyLike(), followed: [] }), status: 'running', fetched_day: today }
    return { ...cur, interactors: running }
  })
  if (!seat.claimed) return { status: 'skipped', reason: 'already read today' }
  const row = seat.row
  const prev = readInteractors(row.interactors)
  const settle = async (patch: Partial<Interactors>) => {
    const it = readInteractors((await analytics().get(postId, { fresh: true }))?.interactors) ?? emptyLike()
    await analytics().update(postId, { interactors: { ...it, ...patch } })
  }

  let mediaId = prev?.media_id ?? null
  if (!mediaId) {
    const m = await source.mediaId(row.platform_post_url as string)
    if (!m.ok) { await settle({ status: 'failed', error: m.error }); return { status: 'failed', reason: m.error } }
    mediaId = m.value
  }
  const likers = await source.likers(mediaId)
  if (!likers.ok) { await settle({ status: 'failed', error: likers.error, media_id: mediaId }); return { status: 'failed', reason: likers.error } }

  const commenters: Interactors['people'][string][] = []
  let cursor: string | null = null
  for (let page = 0; page < COMMENT_PAGES_MAX; page++) {
    const c = await source.commenters(mediaId, cursor)
    if (!c.ok) { await settle({ status: 'failed', error: c.error, media_id: mediaId }); return { status: 'failed', reason: c.error } }
    commenters.push(...c.value.people)
    cursor = c.value.people.length === 0 ? null : c.value.next
    if (!cursor) break
  }

  const merged = mergeInteractors(prev, { media_id: mediaId, likers: likers.value, commenters, now: stamp, today })
  await analytics().update(postId, { interactors: merged })
  return { status: 'read', likers: likers.value.length, commenters: commenters.length }
}

/** the morning's reads, one post after another */
export async function readDueInteractors(now: Date = new Date()): Promise<{ read: number; skipped: number; failed: number }> {
  const tally = { read: 0, skipped: 0, failed: 0 }
  if (!followersEnabled()) return tally
  const due = await duePosts(now)
  for (const { post } of due) {
    const r = await readPostInteractors(post.id, { now })
    if (r.status === 'read') tally.read++
    else if (r.status === 'failed') tally.failed++
    else tally.skipped++
  }
  return tally
}

/**
 * After a look at an account's followers: recompute "followed from this
 * post" for every one of the client's recent posts and write it on the row.
 */
export async function crossFollowersWithPosts(accountId: string, now: Date = new Date()): Promise<{ posts: number; followed: number }> {
  const account = await table<SocialAccount>('social_accounts').get(accountId)
  if (!account?.client_id) return { posts: 0, followed: 0 }
  const items = await table<ContentItem>('content_items').list({ by: { client_id: account.client_id } as Partial<ContentItem> })
  const itemIds = new Set(items.map(i => i.id))
  if (itemIds.size === 0) return { posts: 0, followed: 0 }
  const posts = await analytics().list({ where: r => !!r.item_id && itemIds.has(r.item_id) && !!r.interactors })
  if (posts.length === 0) return { posts: 0, followed: 0 }
  const followers = await followersOf(accountId)
  let total = 0
  for (const post of posts) {
    const it = readInteractors(post.interactors)
    if (!it) continue
    const followed = followedFromPost({ followers, interactors: it, publishedAt: post.published_at })
    total += followed.length
    if (JSON.stringify(followed) === JSON.stringify(it.followed)) continue
    await analytics().update(post.id, { interactors: { ...it, followed } })
  }
  void now
  return { posts: posts.length, followed: total }
}

/** the cross for one piece of work — what the card and the portal show */
export async function followedFromItem(itemId: string): Promise<{ followed: FollowedFromPost[]; published_at: string | null } | null> {
  const rows = await analytics().list({ by: { item_id: itemId } as Partial<PostAnalytic> })
  const row = [...rows].sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))[0]
  if (!row) return null
  const it = readInteractors(row.interactors)
  return { followed: it?.followed ?? [], published_at: row.published_at }
}

/** the cross for every post of a client, by item — the Followers tab's chips */
export async function followedByItemFor(clientId: string): Promise<Map<string, { title: string | null; followed: FollowedFromPost[] }>> {
  const items = await table<ContentItem>('content_items').list({ by: { client_id: clientId } as Partial<ContentItem> })
  const titles = new Map(items.map(i => [i.id, i.title ?? null]))
  const out = new Map<string, { title: string | null; followed: FollowedFromPost[] }>()
  if (titles.size === 0) return out
  const posts = await analytics().list({ where: r => !!r.item_id && titles.has(r.item_id) && !!r.interactors })
  for (const p of posts) {
    const it = readInteractors(p.interactors)
    if (!it || it.followed.length === 0) continue
    out.set(p.item_id as string, { title: titles.get(p.item_id as string) ?? null, followed: it.followed })
  }
  return out
}

function emptyLike(): Interactors {
  return {
    media_id: null, likers: [], commenters: [], people: {}, fetched_at: null, fetched_day: null,
    reads: 0, followed: [], status: 'done', error: null,
  }
}
