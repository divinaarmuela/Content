import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * The write path, against a miniature Realtime Database and a fake provider.
 *
 * What has to be true for a client to get numbers on a post their agency
 * published by hand:
 *
 *   - the provider is asked for its list ONCE, matched, and asked for that one
 *     post's figures;
 *   - the row lands in `post_analytics` keyed on the provider's post id, with
 *     `item_id` set and `source: 'external'`, so the existing refresh cron and
 *     the portal pick it up with no changes at all;
 *   - an item we published ourselves is left alone — it already has a job;
 *   - a link that matches nothing is RECORDED as matching nothing, because the
 *     card is only entitled to accuse a link once we have actually looked.
 */

/* ── the provider ──────────────────────────────────────────────────────── */

const LIST_URL = 'https://www.instagram.com/reel/ABC123/'
/**
 * Relative to now, not a fixed date. The webhook path only considers posts
 * published in the last SEVEN days, so a hard-coded timestamp turns this
 * suite into a clock that stops — which is exactly what it did.
 */
const PUBLISHED_AT = new Date(Date.now() - 2 * 3600_000).toISOString()
/** two hours after the post: inside the ±6h "Mark as posted" window */
const TWO_HOURS_LATER = new Date(Date.parse(PUBLISHED_AT) + 2 * 3600_000).toISOString()

type Json = Record<string, unknown>

let externalPosts: Json[] = []
let perPost: Json | null = null
const postAnalytics = vi.fn(async (postId?: string) => {
  if (!postId) return { posts: externalPosts }
  return perPost
})
const configured = vi.fn(() => true)

vi.mock('../app/lib/publisher', () => ({
  getPublisher: () => ({ name: 'fake', configured, postAnalytics }),
}))

const {
  linkExternalPost, linkExternalPostFromWebhook, sweepExternalPosts,
} = await import('../app/lib/external-post-match')

/* ── the database ──────────────────────────────────────────────────────── */

let item: Json
let entryRow: Json
let jobs: Json[]
let fake: ReturnType<typeof seedDb>

/** seed the database as the test left the fixture */
const start = () => {
  fake = seedDb({
    clients: [{ id: 'client-1', social_profile_id: 'profile_1' }] as unknown as Row[],
    content_items: [item] as unknown as Row[],
    schedule_entries: [entryRow] as unknown as Row[],
    publish_jobs: jobs as unknown as Row[],
    post_analytics: [],
  })
}

const analytics = () => fake.rows('post_analytics') as unknown as Json[]
const entry = () => fake.rows('schedule_entries')[0] as unknown as Json

beforeEach(() => {
  postAnalytics.mockClear()
  configured.mockReturnValue(true)

  item = { id: 'item-1', client_id: 'client-1', status: 'published' }
  entryRow = {
    id: 'entry-1',
    item_id: 'item-1',
    platform: 'instagram',
    live_url: 'https://instagram.com/p/ABC123/?utm_source=ig_web_copy_link',
    publish_status: 'published',
    published_at: PUBLISHED_AT,
    scheduled_at: PUBLISHED_AT,
    external_match_state: null,
  }
  jobs = []

  externalPosts = [{
    _id: 'ext_post_1',
    isExternal: true,
    platform: 'instagram',
    profileId: 'profile_1',
    publishedAt: PUBLISHED_AT,
    platformPostUrl: LIST_URL,
  }]
  perPost = {
    _id: 'ext_post_1',
    publishedAt: PUBLISHED_AT,
    syncStatus: 'synced',
    platformAnalytics: [{
      platform: 'instagram',
      syncStatus: 'synced',
      platformPostUrl: LIST_URL,
      analytics: { views: 1204, likes: 84, comments: 3, reach: 900 },
    }],
  }
})

afterEach(() => fake?.restore())

const link = () => linkExternalPost({
  itemId: 'item-1',
  clientId: 'client-1',
  platform: 'instagram',
  liveUrl: (entryRow.live_url as string | null) ?? null,
  at: PUBLISHED_AT,
})

describe('linkExternalPost', () => {
  it('caches the matched post as an ordinary analytics row', async () => {
    start()
    expect(await link()).toBe('matched')

    expect(analytics()).toHaveLength(1)
    const row = analytics()[0]
    expect(row.provider_post_id).toBe('ext_post_1')
    expect(row.item_id).toBe('item-1')
    expect(row.source).toBe('external')
    expect(row.platform).toBe('instagram')
    expect(row.platform_post_url).toBe(LIST_URL)
    expect(row.views).toBe(1204)
    expect(row.likes).toBe(84)
    expect(row.published_at).toBe(PUBLISHED_AT)
    expect(entry().external_match_state).toBe('matched')
  })

  it('asks the list once, then that one post for its figures', async () => {
    start()
    await link()
    expect(postAnalytics.mock.calls.map(c => c[0])).toEqual([undefined, 'ext_post_1'])
  })

  it('is idempotent — a second run updates the same row', async () => {
    start()
    await link()
    perPost = {
      ...(perPost as Json),
      platformAnalytics: [{
        platform: 'instagram', syncStatus: 'synced', platformPostUrl: LIST_URL,
        analytics: { views: 2000, likes: 90 },
      }],
    }
    expect(await link()).toBe('matched')
    expect(analytics()).toHaveLength(1)
    expect(analytics()[0].views).toBe(2000)
  })

  it('records that it looked and found nothing', async () => {
    externalPosts = [{
      _id: 'ext_other', isExternal: true, platform: 'instagram', profileId: 'profile_1',
      publishedAt: '2026-01-01T00:00:00.000Z',
      platformPostUrl: 'https://instagram.com/p/SOMETHINGELSE/',
    }]
    start()
    expect(await link()).toBe('not_found')
    expect(analytics()).toHaveLength(0)
    expect(entry().external_match_state).toBe('not_found')
  })

  it('leaves a post WE published alone', async () => {
    jobs = [{
      id: 'job-1', content_item_id: 'item-1', status: 'published',
      provider_post_id: 'post_1', targets: [{ platform: 'instagram' }],
    }]
    start()
    expect(await link()).toBe('skipped')
    expect(postAnalytics).not.toHaveBeenCalled()
    expect(analytics()).toHaveLength(0)
  })

  it('does nothing at all when no provider is configured', async () => {
    configured.mockReturnValue(false)
    start()
    expect(await link()).toBe('skipped')
    expect(postAnalytics).not.toHaveBeenCalled()
  })

  it('finds a Story marked posted with no link, by its time', async () => {
    entryRow.live_url = null
    start()
    expect(await linkExternalPost({
      itemId: 'item-1', clientId: 'client-1', platform: 'instagram',
      liveUrl: null, at: TWO_HOURS_LATER,
    })).toBe('matched')
    expect(analytics()[0].provider_post_id).toBe('ext_post_1')
  })

  it('keeps the row when the provider has no figures yet', async () => {
    perPost = null
    start()
    expect(await link()).toBe('matched')
    expect(analytics()[0].provider_post_id).toBe('ext_post_1')
    expect(analytics()[0].platform_post_url).toBe(LIST_URL)
  })
})

describe('sweepExternalPosts', () => {
  it('matches a post marked by hand before any of this shipped', async () => {
    start()
    const result = await sweepExternalPosts()
    expect(result.matched).toBe(1)
    expect(analytics()[0].item_id).toBe('item-1')
    expect(entry().external_match_state).toBe('matched')
  })

  it('skips an item that already has numbers, and refreshes them instead', async () => {
    start()
    await link()
    postAnalytics.mockClear()
    const result = await sweepExternalPosts()
    expect(result.matched).toBe(0)
    expect(result.refreshed).toBe(1)
    // the refresh half asks about the post it already knows, by id
    expect(postAnalytics.mock.calls.map(c => c[0])).toContain('ext_post_1')
    expect(analytics()).toHaveLength(1)
  })

  it('ignores an item that is not published', async () => {
    item.status = 'scheduled'
    start()
    const result = await sweepExternalPosts()
    expect(result.matched).toBe(0)
    expect(analytics()).toHaveLength(0)
  })
})

describe('linkExternalPostFromWebhook', () => {
  it('links a newly detected external post to the item that carries its link', async () => {
    start()
    const { matched } = await linkExternalPostFromWebhook({
      providerPostId: 'ext_post_1',
      platform: 'instagram',
      url: LIST_URL,
      publishedAt: PUBLISHED_AT,
      profileId: 'profile_1',
    })
    expect(matched).toBe('item-1')
    expect(analytics()[0].source).toBe('external')
    expect(entry().external_match_state).toBe('matched')
  })

  it('is a no-op for somebody else’s post', async () => {
    start()
    const { matched } = await linkExternalPostFromWebhook({
      providerPostId: 'ext_post_9',
      platform: 'instagram',
      url: 'https://instagram.com/p/NOTOURS/',
      publishedAt: PUBLISHED_AT,
      profileId: 'profile_1',
    })
    expect(matched).toBeNull()
    expect(analytics()).toHaveLength(0)
  })

  it('will not steal an item we published ourselves', async () => {
    jobs = [{
      id: 'job-1', content_item_id: 'item-1', status: 'published',
      provider_post_id: 'post_1', targets: [{ platform: 'instagram' }],
    }]
    start()
    const { matched } = await linkExternalPostFromWebhook({
      providerPostId: 'ext_post_1', platform: 'instagram', url: LIST_URL,
      publishedAt: PUBLISHED_AT, profileId: 'profile_1',
    })
    expect(matched).toBeNull()
  })
})
