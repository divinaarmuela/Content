import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * Two workers, one job. Two operators, one content item.
 *
 * Publishing is the least reversible thing this system does, so the claim is
 * not "read the status, then write it" — that is two operations and both
 * workers can pass the read. It is one conditional write, and these tests
 * stage the race that used to slip through: a rival's write landing between
 * the claimant's read and its own.
 *
 * The assertion that matters is not only that one of them lost, but that the
 * loser never reached the provider.
 */

const created: string[] = []
const original = async (p: { requestId: string }) => {
  created.push(p.requestId)
  return { kind: 'published' as const, postId: 'prov-1' }
}
const publisher = {
  configured: () => true,
  createPost: original,
  uploadMedia: async () => { throw new Error('should not relay') },
}
vi.mock('../app/lib/publisher', () => ({ getPublisher: () => publisher }))
// closing the loop back into production is a different job's business
vi.mock('../app/lib/production-publish', () => ({ recordPublishOnItem: vi.fn(async () => {}), recordPostOutcome: vi.fn(async () => ({ job_id: '', posts: [], schedule_rows: 0 })) }))

const { runPublishJob, queuePublishJob } = await import('../app/lib/publish')

const ITEM = 'a1b2c3d4-0000-4000-8000-000000000001'
const job = (id: string, status: string): Row => ({
  id, content_item_id: null, status, client_id: 'client-1',
  caption: 'Hello', request_id: `req-${id}`,
  // already on the provider's host, so nothing is relayed
  media: [{ url: 'https://zernio.com/a.jpg', type: 'image' }],
  targets: [{ platform: 'instagram', accountId: 'acc-1' }],
  timezone: 'Australia/Melbourne', scheduled_for: null, attempts: 0,
  created_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z',
}) as unknown as Row

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
  media: [{ url: 'https://zernio.com/a.jpg', type: 'image' as const }],
  targets: [{ platform: 'instagram' as const, accountId: 'acc-1' }],
}

let fake: ReturnType<typeof seedDb> | null = null
afterEach(() => { fake?.restore(); fake = null; created.length = 0 })

describe('runPublishJob claims queued → publishing exactly once', () => {
  it('the winner publishes and the loser never calls the provider', async () => {
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job('j1', 'queued')] })
    const [a, b] = await Promise.all([runPublishJob('j1'), runPublishJob('j1')])
    expect([a, b].filter(r => r === 'published')).toHaveLength(1)
    expect([a, b].filter(r => r === null)).toHaveLength(1)
    expect(created).toHaveLength(1)          // one post, not two
  })

  it('a rival taking the job between the read and the write is not overwritten', async () => {
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job('j1', 'queued')] })
    const off = fake.onBeforeWrite('/mdm/tables/publish_jobs/j1', () => {
      off()
      fake!.tree().mdm.tables.publish_jobs.j1.status = 'publishing'
    })
    expect(await runPublishJob('j1')).toBeNull()
    expect(created).toEqual([])
    expect(fake.rows('publish_jobs')[0]).toMatchObject({ status: 'publishing' })
  })

  it('the claim stamps updated_at, so the stale sweep cannot re-dispatch it', async () => {
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job('j1', 'queued')] })
    // the job sat in the queue for an hour before a worker picked it up
    fake.tree().mdm.tables.publish_jobs.j1.updated_at = '2026-09-01T00:00:00.000Z'
    await runPublishJob('j1')
    const settled = fake.rows('publish_jobs')[0] as unknown as { updated_at: string }
    expect(Date.now() - Date.parse(settled.updated_at)).toBeLessThan(1000)
  })

  it('a claim that is still running is NOT reclaimed as stale', async () => {
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job('j1', 'queued')] })
    fake.tree().mdm.tables.publish_jobs.j1.updated_at = '2026-09-01T00:00:00.000Z'
    // hold the provider call open, so the row is observed mid-publish
    let release = () => {}
    const held = new Promise<void>(r => { release = r })
    const slow = { ...publisher, createPost: async (p: { requestId: string }) => {
      created.push(p.requestId)
      await held
      return { kind: 'published' as const, postId: 'prov-1' }
    } }
    Object.assign(publisher, slow)
    const running = runPublishJob('j1')
    await new Promise(r => setTimeout(r, 0))
    const { reclaimStalePublishing } = await import('../app/lib/publish')
    expect(await reclaimStalePublishing(15)).toBe(0)   // claimed just now, not abandoned
    release()
    await running
    Object.assign(publisher, { createPost: original })
  })

  it('a job nobody else wants is still claimed and published', async () => {
    fake = seedDb({ social_posts: [bookedPost()], publish_jobs: [job('j1', 'queued')] })
    expect(await runPublishJob('j1')).toBe('published')
    expect(created).toEqual(['req-j1'])
  })
})

describe('one live publish job per content item, under a race', () => {
  it('two enqueues at the same moment leave exactly one job', async () => {
    fake = seedDb({ social_posts: [bookedPost()] })
    const [a, b] = await Promise.all([queuePublishJob(validPost), queuePublishJob(validPost)])
    const results = [a, b]
    expect(results.filter(r => 'id' in r)).toHaveLength(1)
    expect(results.filter(r => 'error' in r)).toEqual([
      { error: 'This content item is already queued to publish' },
    ])
    expect(fake.rows('publish_jobs')).toHaveLength(1)
  })

  it('the item is queueable again once its job settles', async () => {
    fake = seedDb({ social_posts: [bookedPost()] })
    const first = await queuePublishJob(validPost)
    expect(first).toHaveProperty('id')
    // …the job runs and reaches a terminal state, which hands the lock back
    await runPublishJob((first as { id: string }).id)
    expect(await queuePublishJob(validPost)).toHaveProperty('id')
    expect(fake.rows('publish_jobs')).toHaveLength(2)
  })
})

/**
 * A DUPLICATE IS ANOTHER POST, NOT THE SAME POST TWICE (Renee, 25 Nov 2026: duplicated stories "don't go through or
 * show on the scheduled section"; the owner: "make sure duplicates and schedules"). Duplicate makes one post for
 * each day picked, all of the same card and the same file. The rule above saw the second, third and fourth as the
 * first going out again and refused them: of four copies of a Basfoods story only one was booked. The rule is one
 * live job per POST now: a different post of the same file books in; the same post still cannot go twice.
 */
describe('a duplicated post books in beside the one it was copied from', () => {
  const copyPost = (id: string): Row => ({ ...(bookedPost() as unknown as Record<string, unknown>), id }) as unknown as Row
  const copy = (id: string) => ({ ...validPost, postId: id })

  it('two posts of the same card and the same file are both queued', async () => {
    fake = seedDb({ social_posts: [bookedPost(), copyPost('post-2'), copyPost('post-3')] })
    const results = [await queuePublishJob(validPost), await queuePublishJob(copy('post-2')), await queuePublishJob(copy('post-3'))]
    expect(results.every(r => 'id' in r)).toBe(true)
    expect(fake.rows('publish_jobs')).toHaveLength(3)
  })

  it('each job says which post it books', async () => {
    fake = seedDb({ social_posts: [bookedPost(), copyPost('post-2')] })
    await queuePublishJob(validPost); await queuePublishJob(copy('post-2'))
    expect((fake.rows('publish_jobs') as unknown as { post_id: string }[]).map(j => j.post_id).sort()).toEqual(['post-1', 'post-2'])
  })

  it('the same post still cannot be queued twice — one after the other, or at the same moment', async () => {
    fake = seedDb({ social_posts: [bookedPost(), copyPost('post-2')] })
    expect(await queuePublishJob(copy('post-2'))).toHaveProperty('id')
    expect(await queuePublishJob(copy('post-2'))).toHaveProperty('error')
    const [a, b] = await Promise.all([queuePublishJob(validPost), queuePublishJob(validPost)])
    expect([a, b].filter(r => 'id' in r)).toHaveLength(1)
    expect(fake.rows('publish_jobs')).toHaveLength(2)
  })

  it('a job queued before jobs named their post does not block a copy, when the post that booked it is known', async () => {
    // the original's job, queued before this change: no post_id on it, but post-1's booking lists it
    const older = { ...(job('old-1', 'scheduled') as unknown as Record<string, unknown>), content_item_id: ITEM } as unknown as Row
    const owner = { ...(bookedPost() as unknown as Record<string, unknown>), booking: { job_ids: ['old-1'], pending: false, at: '2026-09-01T00:00:00.000Z', for_time: null } } as unknown as Row
    fake = seedDb({ social_posts: [owner, copyPost('post-2')], publish_jobs: [older] })
    expect(await queuePublishJob(copy('post-2'))).toHaveProperty('id')
    // …and the post that owns that older job still cannot go out a second time
    expect(await queuePublishJob(validPost)).toEqual({ error: 'These files are already queued to publish on this card' })
  })

  it('a job with no post behind it at all still holds the card, as it always did', async () => {
    const orphan = { ...(job('old-2', 'scheduled') as unknown as Record<string, unknown>), content_item_id: ITEM } as unknown as Row
    fake = seedDb({ social_posts: [bookedPost(), copyPost('post-2')], publish_jobs: [orphan] })
    expect(await queuePublishJob(copy('post-2'))).toEqual({ error: 'These files are already queued to publish on this card' })
  })

  it('a copy is queueable again once its own job settles, and that frees nobody else\'s', async () => {
    fake = seedDb({ social_posts: [bookedPost(), copyPost('post-2')] })
    const first = await queuePublishJob(copy('post-2')) as { id: string }
    await queuePublishJob(validPost)
    await runPublishJob(first.id)
    expect(await queuePublishJob(copy('post-2'))).toHaveProperty('id')
    expect(await queuePublishJob(validPost)).toHaveProperty('error')
  })
})
