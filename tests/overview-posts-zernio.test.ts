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
    expect(liveCountsLine({ ...row, waiting: [{ post_id: 'a', at: null, booked: true }] })).toBe('Went out 8 · Booked 2 · Waiting on the client 1')
    expect(liveCountsLine({ ...row, booked: 0, went_out: 0 })).toBe('Nothing this month')
  })
  it('the Overview asks the server, and no longer listens to every job and analytics row', () => {
    const page = readFileSync('app/dashboard/page.tsx', 'utf8')
    expect(page).toContain("fetch('/api/overview/posts-month', { cache: 'no-store' })")
    expect(page).not.toContain("useTable<PublishJob>('publish_jobs'")
    expect(page).not.toContain("useTable<PostAnalytic>('post_analytics'")
    expect(page).toContain('<NotifyClientButton clientId={r.client_id!} tab="scheduling" id={w.post_id}')
    const route = readFileSync('app/api/overview/posts-month/route.ts', 'utf8')
    expect(route).toContain("if (user.role !== 'super_admin' && user.role !== 'account_manager') throw new AuthzError('Managers only', 403)")
    expect(route).toContain('zernioMonthCounts(zernio as ZernioPostLite[], byProvider, inMonth)')
  })
})
