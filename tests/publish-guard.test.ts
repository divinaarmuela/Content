import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import { DbError, table } from '@/lib/db'
import type { Row } from '@/lib/db-types'

/**
 * The two rules Postgres used to enforce with an index and that this database
 * cannot, so the code has to.
 *
 * Both are about the least reversible thing the system does: you cannot
 * un-post to somebody's real Instagram, and you cannot un-overwrite the cut a
 * reviewer signed off. Each was a real constraint in docs/schema-history/*.sql,
 * so each gets a test that fails if the replacement is dropped.
 */

vi.mock('../app/lib/publisher', () => ({
  getPublisher: () => ({ configured: () => true }),
}))
// workflow.ts reaches these two only from performTransition, never from
// addVersion — stubbed so this file does not drag in a module that builds a
// client at import time (CLAUDE.md trap 7) from modules a later task rewrites
vi.mock('../app/lib/gdrive-mirror', () => ({ mirrorLatestVersionSoon: vi.fn() }))
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(), renderEmail: () => '', escapeHtml: (s: string) => s,
}))

const { queuePublishJob } = await import('../app/lib/publish')
const { addVersion } = await import('../app/lib/workflow')

const ITEM = 'a1b2c3d4-0000-4000-8000-000000000001'
const ACTOR = '3548cc71-5a34-4fe9-9130-11579d1a4137'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const actor = { id: ACTOR, role: 'editor', name: 'Ed', email: 'e@x.invalid' } as any

/** a post that passes validatePost, so the guard is what decides the outcome */
/** THE POST the job books: the door onto a client's account asks the post, not the card
 *  (publish-core.publishDoorRefusal) — Booked in, holding an approval of the version it sends */
const bookedPost = (): Row => ({
  id: 'post-1', client_id: 'client-1', item_id: ITEM, source_item_id: ITEM, stage: 'booked', rev: 3,
  sent_version: 1, draft_version: 2,
  approval: { version: 1, by: 'qr-1', hat: 'quality_reviewer', at: '2026-09-01T00:00:00.000Z' },
  booking: { job_ids: [], pending: true, at: '2026-09-01T00:00:00.000Z', for_time: null },
  slides: [], channels: [], caption: 'Hello', timezone: 'Australia/Melbourne',
}) as unknown as Row
const validPost = {
  clientId: 'client-1',
  contentItemId: ITEM,
  postId: 'post-1',
  caption: 'Hello',
  media: [{ url: 'https://media.mdmmarketing.com.au/a.jpg', type: 'image' as const }],
  targets: [{ platform: 'instagram' as const, accountId: 'acc-1' }],
}

const job = (id: string, status: string): Row =>
  ({
    id, content_item_id: ITEM, status, client_id: 'client-1',
    caption: '', media: [], targets: [], timezone: 'Australia/Melbourne',
    attempts: 0, created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  }) as unknown as Row

let fake: ReturnType<typeof seedDb>
afterEach(() => fake?.restore())

describe('one live publish job per item — publish_jobs_one_live_per_item', () => {
  // docs/schema-history/social_publishing.sql recreates the partial unique
  // index over status in ('queued','publishing','scheduled')
  for (const status of ['queued', 'publishing', 'scheduled']) {
    it(`refuses a second job while one is ${status}`, async () => {
      fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job('j1', status)] })
      const result = await queuePublishJob(validPost)
      expect(result).toEqual({ error: 'These files are already queued to publish on this card' })
      // …and nothing was written
      expect(fake.rows('publish_jobs')).toHaveLength(1)
    })
  }

  it('a SCHEDULED job still holds the slot — the provider is holding that post until its time', async () => {
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job('j1', 'scheduled')] })
    expect(await queuePublishJob(validPost))
      .toEqual({ error: 'These files are already queued to publish on this card' })
  })

  for (const status of ['published', 'duplicate', 'failed', 'cancelled']) {
    it(`lets the item be queued again once the last job is ${status}`, async () => {
      fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job('j1', status)] })
      const result = await queuePublishJob(validPost)
      expect(result).toHaveProperty('id')
      expect(fake.rows('publish_jobs')).toHaveLength(2)
    })
  }

  it('another item is never blocked by this one', async () => {
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job('j1', 'scheduled')] })
    const result = await queuePublishJob({ ...validPost, contentItemId: 'other-item' })
    expect(result).toHaveProperty('id')
  })
})

/**
 * THE DOOR ASKS THE POST (the posting rebuild, 29 Sep 2026). The item-wide
 * approval gate is gone (audit V1: one gate per ITEM), so a card's files go
 * out only for a post that is Booked in and approved at the version it sends —
 * the item page and the old composer cannot walk round the post's approval.
 */
describe('the one door onto a client account asks the post', () => {
  it('refuses a card\'s files with no post behind them', async () => {
    fake = seedDb({ social_posts: [bookedPost()] })
    const { postId: _none, ...noPost } = validPost
    expect(await queuePublishJob(noPost)).toEqual({ error: 'Book this from its post on Schedule. A post has to pass its approval before it goes out.', blocked: true })
    expect(fake.rows('publish_jobs')).toHaveLength(0)
  })

  for (const [what, change, words] of [
    ['a post in Ready to post (not booked)', { stage: 'ready' }, 'This post is not booked in, so it cannot go out.'],
    ['a post approved at an older version', { sent_version: 2 }, 'This version of the post is not approved, so it cannot go out.'],
    ['a post with no approval at all', { approval: null }, 'This version of the post is not approved, so it cannot go out.'],
    ['another client\'s post', { client_id: 'client-2' }, 'That post belongs to another client.'],
  ] as const) {
    it(`refuses ${what}`, async () => {
      fake = seedDb({ social_posts: [{ ...bookedPost(), ...change } as unknown as Row] })
      expect(await queuePublishJob(validPost)).toEqual({ error: words, blocked: true })
      expect(fake.rows('publish_jobs')).toHaveLength(0)
    })
  }

  it('refuses a post that is gone', async () => {
    fake = seedDb({})
    expect(await queuePublishJob(validPost)).toEqual({ error: 'That post no longer exists.', blocked: true })
  })

  it('lets a text post from the composer through, as before (no card, no post)', async () => {
    fake = seedDb({})
    const { postId: _p, ...text } = validPost
    expect(await queuePublishJob({ ...text, contentItemId: null })).toHaveProperty('id')
  })
})

/**
 * TIKTOK'S CONSENT IS NEVER ASSERTED BY THE APP ALONE.
 *
 * Every TikTok target goes out with `content_preview_confirmed` and
 * `express_consent_given` true — TikTok requires both — and they say a human
 * saw how the post would look and agreed to TikTok's terms. `queuePublishJob`
 * is the one door onto a client's real account, so it is the place that has
 * to hold the post until somebody has actually said so.
 */
describe('the TikTok tick, on every path that queues a post', () => {
  const tiktokPost = {
    ...validPost,
    contentItemId: null,
    media: [{ url: 'https://media.mdmmarketing.com.au/a.mp4', type: 'video' as const }],
    targets: [{ platform: 'tiktok' as const, accountId: 'acc-tt' }],
  }

  it('refuses a TikTok post nobody has ticked, in words a person can act on', async () => {
    fake = seedDb({ social_posts: [bookedPost()] })
    const result = await queuePublishJob(tiktokPost) as { error: string; issues?: string[] }
    expect(result.error).toBe('This post is not valid for every selected platform')
    expect((result.issues ?? []).join(' ')).toMatch(/Tick the TikTok box/)
    expect(fake.rows('publish_jobs')).toHaveLength(0)
  })

  it('lets it through the moment the tick is there', async () => {
    fake = seedDb({ social_posts: [bookedPost()] })
    const result = await queuePublishJob({
      ...tiktokPost,
      targets: [{ platform: 'tiktok' as const, accountId: 'acc-tt', options: { tiktokConsent: true } }],
    })
    expect(result).toHaveProperty('id')
  })

  it('leaves every other network alone', async () => {
    fake = seedDb({ social_posts: [bookedPost()] })
    expect(await queuePublishJob({ ...validPost, contentItemId: null })).toHaveProperty('id')
  })
})

describe('one row per (item, version) — asset_versions', () => {
  const version = (n: number) => ({
    item_id: ITEM, version_number: n, file_url: `https://x.invalid/v${n}.mp4`,
    files: [], dropbox_url: '', drive_url: '', notes: null, uploaded_by: ACTOR,
  })

  it('refuses a second row for a version number already taken', async () => {
    fake = seedDb({ social_posts: [bookedPost()] })
    await table('asset_versions').insert(version(1))
    await expect(table('asset_versions').insert(version(1)))
      .rejects.toMatchObject({ code: 'unique' })
    await expect(table('asset_versions').insert(version(1)))
      .rejects.toBeInstanceOf(DbError)
    expect(fake.rows('asset_versions')).toHaveLength(1)
  })

  it('derives the row id from the pair, so the two are the same fact', async () => {
    fake = seedDb({ social_posts: [bookedPost()] })
    const row = await table('asset_versions').insert(version(3))
    expect(row.id).toBe(`${ITEM}__3`)
  })

  it('addVersion allocates n+1 on an item that already has n', async () => {
    fake = seedDb({
      content_items: [{
        id: ITEM, client_id: 'client-1', title: 'Reel', status: 'draft_uploaded',
        current_version_number: 2,
      }] as unknown as Row[],
      asset_versions: [
        { id: `${ITEM}__1`, ...version(1) },
        { id: `${ITEM}__2`, ...version(2) },
      ] as unknown as Row[],
    })
    const added = await addVersion(actor, ITEM, { file_url: 'https://x.invalid/v3.mp4' })
    expect(added.version_number).toBe(3)
    expect(added.id).toBe(`${ITEM}__3`)
    expect(fake.rows('asset_versions')).toHaveLength(3)
    // the item follows the version it now carries
    expect(fake.rows('content_items')[0]).toMatchObject({ current_version_number: 3 })
  })

  it('starts at 1 on an item with no versions yet', async () => {
    fake = seedDb({
      content_items: [{
        id: ITEM, client_id: 'client-1', title: 'Reel', status: 'draft_uploaded',
        current_version_number: 0,
      }] as unknown as Row[],
    })
    const added = await addVersion(actor, ITEM, { file_url: 'https://x.invalid/v1.mp4' })
    expect(added.version_number).toBe(1)
  })

  it('never moves current_version_number backwards', async () => {
    fake = seedDb({
      content_items: [{
        id: ITEM, client_id: 'client-1', title: 'Reel', status: 'draft_uploaded',
        // somebody already recorded a higher number (a concurrent upload)
        current_version_number: 9,
      }] as unknown as Row[],
    })
    await addVersion(actor, ITEM, { file_url: 'https://x.invalid/v1.mp4' })
    expect(fake.rows('content_items')[0]).toMatchObject({ current_version_number: 9 })
  })

  it('retries onto the next number when a rival upload took the one it picked', async () => {
    fake = seedDb({
      content_items: [{
        id: ITEM, client_id: 'client-1', title: 'Reel', status: 'draft_uploaded',
        current_version_number: 0,
      }] as unknown as Row[],
      // v1 already exists…
      asset_versions: [{ id: `${ITEM}__1`, ...version(1) }] as unknown as Row[],
    })

    // …but this caller's read of the version numbers is served STALE, exactly
    // as a rival upload landing between the read and the write would leave it.
    // So addVersion asks for v1, is refused, and has to recover.
    const inner = globalThis.fetch
    let staleReadsLeft = 1
    globalThis.fetch = (async (input: never, init: never) => {
      const url = String(typeof input === 'string' ? input : (input as Request).url)
      const isVersionRead = url.includes('/tables/asset_versions')
        && ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === 'GET'
      if (isVersionRead && staleReadsLeft > 0) {
        staleReadsLeft--
        return new Response('null', { headers: { 'content-type': 'application/json' } })
      }
      return inner(input, init)
    }) as typeof fetch

    try {
      const added = await addVersion(actor, ITEM, { file_url: 'https://x.invalid/mine.mp4' })
      expect(added.version_number).toBe(2)   // not 1, and not an error
    } finally {
      globalThis.fetch = inner
    }
    expect(fake.rows('asset_versions')).toHaveLength(2)
  })
})
