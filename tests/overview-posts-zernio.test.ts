import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { liveCountsLine, metaQueueCounts, zernioMonthCounts } from '../app/lib/overview-posts-core'

// 29 Oct 2026: Justin's Instagram read "Went out 7 · Did not go out 16"; Zernio held 8 published and none failed
const acct = new Map([['zIG', { id: 'ig', client_id: 'c1' }], ['zTT', { id: 'tt', client_id: 'c1' }]])
const inOct = (iso: string | null | undefined) => !!iso && iso.startsWith('2026-10')

describe('the month, from Zernio', () => {
  it('published, still to go and failed — per network; cancelled is not a post', () => {
    const posts = [
      { _id: 'p1', status: 'published', platforms: [{ platform: 'instagram', status: 'published', publishedAt: '2026-10-28T07:32:30Z', accountId: { _id: 'zIG' } }, { platform: 'tiktok', status: 'published', publishedAt: '2026-10-28T07:31:57Z', accountId: { _id: 'zTT' } }] },
      { _id: 'p2', status: 'scheduled', platforms: [{ platform: 'instagram', status: 'pending', scheduledFor: '2026-10-30T03:30:00Z', accountId: { _id: 'zIG' } }] },
      { _id: 'p3', status: 'failed', platforms: [{ platform: 'tiktok', status: 'failed', scheduledFor: '2026-10-12T03:30:00Z', accountId: 'zTT' }] },
      { _id: 'p4', status: 'cancelled', platforms: [{ platform: 'instagram', status: 'cancelled', scheduledFor: '2026-10-14T03:30:00Z', accountId: { _id: 'zIG' } }] },
      { _id: 'p5', status: 'scheduled', platforms: [{ platform: 'instagram', status: 'pending', scheduledFor: '2026-11-14T03:30:00Z', accountId: { _id: 'zIG' } }] },
    ]
    const c = zernioMonthCounts(posts, acct, inOct)
    expect(c.get('ig')).toEqual({ went_out: 1, booked: 1, did_not: 0 })
    expect(c.get('tt')).toEqual({ went_out: 1, booked: 0, did_not: 1 })
  })
  it('our own Instagram queue is added; a cancelled job is not a failure', () => {
    const c = zernioMonthCounts([], acct, inOct)
    const jobs = [
      { id: 'j1', provider: 'meta_ig', status: 'queued', scheduled_for: '2026-10-30T01:00:00Z' },
      { id: 'j2', provider: 'meta_ig', status: 'cancelled', scheduled_for: '2026-10-20T01:00:00Z' },
      { id: 'j3', provider: 'zernio', status: 'failed', scheduled_for: '2026-10-20T01:00:00Z' },
    ]
    metaQueueCounts(jobs as never, () => [{ id: 'ig', client_id: 'c1' }], inOct, c)
    expect(c.get('ig')).toEqual({ went_out: 0, booked: 1, did_not: 0 })
  })
  it('the line says what is waiting on the client apart from what is simply booked', () => {
    const row = { key: 'ig', account_id: 'ig', client_id: 'c1', client_name: 'Justin', platform: 'instagram', username: 'j', went_out: 8, booked: 3, did_not: 0, by_hand: 0, metrics: { interactions: null, likes: null, comments: null, views: null } }
    expect(liveCountsLine({ ...row, waiting: [{ post_id: 'a', at: null, booked: true }] })).toBe('8 posts went out · 2 posts scheduled · 1 post waiting on the client')
    expect(liveCountsLine({ ...row, booked: 0, went_out: 0 })).toBe('Nothing this month')
  })
  it('the Overview asks the server, and no longer listens to every job and analytics row', () => {
    const page = readFileSync('app/dashboard/page.tsx', 'utf8')
    expect(page).toContain("const load = () => fetch(`/api/overview/posts-month${qs}`, { cache: 'no-store' })")
    expect(page).not.toContain("useTable<PublishJob>('publish_jobs'")
    expect(page).not.toContain("useTable<PostAnalytic>('post_analytics'")
    expect(page).toContain('<NotifyClientButton clientId={c.client_id!} tab="scheduling" id={w.post_id}')
    const route = readFileSync('app/api/overview/posts-month/route.ts', 'utf8')
    expect(route).toContain("if (user.role !== 'super_admin' && user.role !== 'account_manager') throw new AuthzError('Managers only', 403)")
    expect(route).toContain('zernioMonthCounts(zernio as ZernioPostLite[], byProvider, inMonth, log)')
  })
})

describe('the log, post by post', () => {
  it('each post: when, what happened, its words, every network it was on, and why it failed', async () => {
    const { zernioMonthCounts } = await import('../app/lib/overview-posts-core')
    const log = new Map()
    zernioMonthCounts([
      { _id: 'p1', content: 'Base words', platforms: [
        { platform: 'instagram', status: 'published', publishedAt: '2026-10-28T07:32:30Z', accountId: { _id: 'zIG' }, customContent: 'IG words', platformPostUrl: 'https://instagram.com/reel/x' },
        { platform: 'tiktok', status: 'failed', scheduledFor: '2026-10-28T07:30:00Z', accountId: { _id: 'zTT' }, errorMessage: 'Publishing timed out' },
      ] },
    ], acct, inOct, log)
    expect(log.get('ig')).toEqual([{ id: 'p1:instagram', status: 'went_out', at: '2026-10-28T07:32:30Z', caption: 'IG words', url: 'https://instagram.com/reel/x', error: null,
      networks: [{ platform: 'instagram', status: 'went_out', url: 'https://instagram.com/reel/x' }, { platform: 'tiktok', status: 'did_not', url: null }] }])
    expect(log.get('tt')[0]).toMatchObject({ status: 'did_not', caption: 'Base words', error: 'Publishing timed out' })
  })
  it('each account opens to its posts', () => {
    const page = readFileSync('app/dashboard/page.tsx', 'utf8')
    expect(page).toContain('{openKey === c.key && <PostLog entries={c.log ?? []} />}')
    expect(page).toContain("{openKey === c.key ? 'Hide the posts' : 'See the posts'}")
  })
})

describe('"did not go out" is not shown (29 Oct 2026)', () => {
  it('not in the line, not in the log, and a row with only failures is gone', async () => {
    const { liveCountsLine } = await import('../app/lib/overview-posts-core')
    const row = { key: 'ig', account_id: 'ig', client_id: 'c1', client_name: 'J', platform: 'linkedin', username: 'j', went_out: 7, booked: 0, did_not: 2, by_hand: 0, metrics: { interactions: null, likes: null, comments: null, views: null } }
    expect(liveCountsLine(row)).toBe('7 posts went out')
    const route = readFileSync('app/api/overview/posts-month/route.ts', 'utf8')
    expect(route).toContain(".filter(e => e.status !== 'did_not')")
    expect(route).toContain('.filter(r => r.went_out + r.booked + r.by_hand + r.waiting.length > 0)')
  })
})
