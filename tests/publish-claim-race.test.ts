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
const publisher = {
  configured: () => true,
  createPost: async (p: { requestId: string }) => {
    created.push(p.requestId)
    return { kind: 'published' as const, postId: 'prov-1' }
  },
  uploadMedia: async () => { throw new Error('should not relay') },
}
vi.mock('../app/lib/publisher', () => ({ getPublisher: () => publisher }))
// closing the loop back into production is a different job's business
vi.mock('../app/lib/production-publish', () => ({ recordPublishOnItem: vi.fn(async () => {}) }))

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

const validPost = {
  clientId: 'client-1',
  contentItemId: ITEM,
  caption: 'Hello',
  media: [{ url: 'https://zernio.com/a.jpg', type: 'image' as const }],
  targets: [{ platform: 'instagram' as const, accountId: 'acc-1' }],
}

let fake: ReturnType<typeof seedDb> | null = null
afterEach(() => { fake?.restore(); fake = null; created.length = 0 })

describe('runPublishJob claims queued → publishing exactly once', () => {
  it('the winner publishes and the loser never calls the provider', async () => {
    fake = seedDb({ publish_jobs: [job('j1', 'queued')] })
    const [a, b] = await Promise.all([runPublishJob('j1'), runPublishJob('j1')])
    expect([a, b].filter(r => r === 'published')).toHaveLength(1)
    expect([a, b].filter(r => r === null)).toHaveLength(1)
    expect(created).toHaveLength(1)          // one post, not two
  })

  it('a rival taking the job between the read and the write is not overwritten', async () => {
    fake = seedDb({ publish_jobs: [job('j1', 'queued')] })
    const off = fake.onBeforeWrite('/mdm/tables/publish_jobs/j1', () => {
      off()
      fake!.tree().mdm.tables.publish_jobs.j1.status = 'publishing'
    })
    expect(await runPublishJob('j1')).toBeNull()
    expect(created).toEqual([])
    expect(fake.rows('publish_jobs')[0]).toMatchObject({ status: 'publishing' })
  })

  it('a job nobody else wants is still claimed and published', async () => {
    fake = seedDb({ publish_jobs: [job('j1', 'queued')] })
    expect(await runPublishJob('j1')).toBe('published')
    expect(created).toEqual(['req-j1'])
  })
})

describe('one live publish job per content item, under a race', () => {
  it('two enqueues at the same moment leave exactly one job', async () => {
    fake = seedDb({})
    const [a, b] = await Promise.all([queuePublishJob(validPost), queuePublishJob(validPost)])
    const results = [a, b]
    expect(results.filter(r => 'id' in r)).toHaveLength(1)
    expect(results.filter(r => 'error' in r)).toEqual([
      { error: 'This content item is already queued to publish' },
    ])
    expect(fake.rows('publish_jobs')).toHaveLength(1)
  })

  it('the item is queueable again once its job settles', async () => {
    fake = seedDb({})
    const first = await queuePublishJob(validPost)
    expect(first).toHaveProperty('id')
    // …the job runs and reaches a terminal state, which hands the lock back
    await runPublishJob((first as { id: string }).id)
    expect(await queuePublishJob(validPost)).toHaveProperty('id')
    expect(fake.rows('publish_jobs')).toHaveLength(2)
  })
})
