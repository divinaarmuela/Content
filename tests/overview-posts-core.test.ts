import { describe, it, expect } from 'vitest'
import {
  accountHandle, jobMonthStamp, jobTargets, monthPostsByAccount,
  postCountsLine, postMetricsLine,
  type MonthAccount, type MonthAnalytic, type MonthJob,
} from '../app/lib/overview-posts-core'
import { compactCount } from '../app/lib/post-analytics-core'
import type { ByHandRow } from '../app/lib/post-outcome-core'

/**
 * "Posts this month" on the Overview: one row per client account, counted
 * with the Posts page's own core, in the client's own month.
 */

const NOW = '2026-09-10T02:00:00.000Z' // 12:00 pm Melbourne, 10 Sep

const clients = [
  { id: 'c1', name: 'Sunset Co', timezone: 'Australia/Melbourne' },
  { id: 'c2', name: 'Northline', timezone: 'Europe/London' },
]

const account = (over: Partial<MonthAccount> = {}): MonthAccount => ({
  id: 'a1', client_id: 'c1', platform: 'instagram',
  provider_account_id: 'p1', username: 'sunsetco', active: true, ...over,
})

const job = (over: Partial<MonthJob> = {}): MonthJob => ({
  id: 'j1', client_id: 'c1', status: 'published',
  targets: [{ platform: 'instagram', accountId: 'p1' }] as never,
  published_at: '2026-09-05T04:00:00.000Z',
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-05T04:00:00.000Z',
  ...over,
})

const build = (over: Partial<Parameters<typeof monthPostsByAccount>[0]> = {}) =>
  monthPostsByAccount({
    now: NOW, accounts: [account()], clients, jobs: [job()],
    byHand: [], analytics: [], clientIds: null, ...over,
  })

describe('jobMonthStamp', () => {
  it('uses the time it went out for a post that is out', () => {
    expect(jobMonthStamp(job())).toBe('2026-09-05T04:00:00.000Z')
  })

  it('uses the booked time for one still to go', () => {
    expect(jobMonthStamp(job({
      status: 'scheduled', published_at: null, scheduled_for: '2026-09-20T09:00:00.000Z',
    }))).toBe('2026-09-20T09:00:00.000Z')
  })

  it('falls back to when it last moved', () => {
    expect(jobMonthStamp(job({ status: 'failed', published_at: null })))
      .toBe('2026-09-05T04:00:00.000Z')
  })
})

describe('jobTargets', () => {
  it('reads the channel and the provider account id off a job', () => {
    expect(jobTargets(job())).toEqual([{ platform: 'instagram', accountId: 'p1' }])
  })

  it('is empty, never a throw, for a job with no targets', () => {
    expect(jobTargets(job({ targets: null }))).toEqual([])
  })
})

describe('monthPostsByAccount', () => {
  it('counts a post that went out on the account it went out on', () => {
    const rows = build()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      account_id: 'a1', client_id: 'c1', client_name: 'Sunset Co',
      platform: 'instagram', username: 'sunsetco',
      went_out: 1, booked: 0, did_not: 0, by_hand: 0,
    })
  })

  it('counts booked and refused posts too', () => {
    const rows = build({
      jobs: [
        job(),
        job({ id: 'j2', status: 'scheduled', published_at: null, scheduled_for: '2026-09-20T09:00:00.000Z' }),
        job({ id: 'j3', status: 'failed', published_at: null, error: 'too big' }),
      ],
    })
    expect(rows[0]).toMatchObject({ went_out: 1, booked: 1, did_not: 1 })
  })

  it('leaves out a post from another month', () => {
    expect(build({ jobs: [job({ published_at: '2026-08-30T04:00:00.000Z', updated_at: '2026-08-30T04:00:00.000Z' })] }))
      .toEqual([])
  })

  it('reads the month in the CLIENT’s zone, not the server’s', () => {
    // 00:30 on 1 September in Melbourne is still 31 August in London
    const at = '2026-08-31T14:30:00.000Z'
    const melbourne = monthPostsByAccount({
      now: NOW, accounts: [account()], clients, byHand: [], analytics: [],
      jobs: [job({ published_at: at, updated_at: at })],
    })
    const london = monthPostsByAccount({
      now: NOW, accounts: [account({ id: 'a2', client_id: 'c2', provider_account_id: 'p2' })], clients,
      byHand: [], analytics: [],
      jobs: [job({ id: 'j9', client_id: 'c2', published_at: at, updated_at: at, targets: [{ platform: 'instagram', accountId: 'p2' }] as never })],
    })
    expect(melbourne[0]?.went_out).toBe(1)
    expect(london).toEqual([])
  })

  it('splits one post sent to two accounts onto both rows', () => {
    const rows = build({
      accounts: [account(), account({ id: 'a2', platform: 'tiktok', provider_account_id: 'p2', username: 'sunset.co' })],
      jobs: [job({ targets: [{ platform: 'instagram', accountId: 'p1' }, { platform: 'tiktok', accountId: 'p2' }] as never })],
    })
    expect(rows.map(r => r.account_id).sort()).toEqual(['a1', 'a2'])
    expect(rows.every(r => r.went_out === 1)).toBe(true)
  })

  it('matches a job by channel when the account id is not on the target', () => {
    const rows = build({ jobs: [job({ targets: [{ platform: 'instagram' }] as never })] })
    expect(rows[0]?.account_id).toBe('a1')
  })

  it('keeps an account manager to their own clients', () => {
    const rows = build({
      accounts: [account(), account({ id: 'a2', client_id: 'c2', provider_account_id: 'p2', username: 'northline' })],
      jobs: [job(), job({ id: 'j2', client_id: 'c2', targets: [{ platform: 'instagram', accountId: 'p2' }] as never })],
      clientIds: ['c2'],
    })
    expect(rows.map(r => r.client_name)).toEqual(['Northline'])
  })

  it('leaves out an account that has been switched off', () => {
    expect(build({ accounts: [account({ active: false })] })).toEqual([])
  })

  it('shows nothing at all for a month with nothing in it', () => {
    expect(build({ jobs: [] })).toEqual([])
  })

  it('puts a by-hand post on the client’s one account', () => {
    const hand: ByHandRow = {
      item_id: 'i1', title: 'Photo', client_id: 'c1',
      url: 'u1', at: '2026-09-08T01:00:00.000Z', link: null, index: 1, total: 3,
    }
    const rows = build({ byHand: [hand] })
    expect(rows[0]).toMatchObject({ account_id: 'a1', by_hand: 1 })
  })

  it('gives by hand its own row when the client has several accounts', () => {
    const hand: ByHandRow = {
      item_id: 'i1', title: 'Photo', client_id: 'c1',
      url: 'u1', at: '2026-09-08T01:00:00.000Z', link: null, index: 1, total: 3,
    }
    const rows = build({
      accounts: [account(), account({ id: 'a2', platform: 'tiktok', provider_account_id: 'p2' })],
      byHand: [hand],
    })
    const own = rows.find(r => r.account_id === null)
    expect(own).toMatchObject({ by_hand: 1, client_name: 'Sunset Co', platform: null })
    expect(rows.filter(r => r.by_hand > 0)).toHaveLength(1)
  })

  it('sums the metrics of the month onto the account', () => {
    const a: MonthAnalytic = {
      publish_job_id: 'j1', platform: 'instagram', published_at: '2026-09-05T04:00:00.000Z',
      likes: 100, comments: 20, shares: 5, saves: null, views: 900, impressions: null, reach: null,
    }
    const b: MonthAnalytic = { ...a, likes: 40, comments: 10, shares: null, views: null, impressions: 300 }
    const rows = build({ analytics: [a, b] })
    expect(rows[0].metrics).toEqual({ interactions: 175, likes: 140, comments: 30, views: 1200 })
  })

  it('leaves metrics null when no platform has reported — absent is not zero', () => {
    expect(build()[0].metrics)
      .toEqual({ interactions: null, likes: null, comments: null, views: null })
  })

  it('ignores analytics from another month', () => {
    const rows = build({
      analytics: [{ publish_job_id: 'j1', platform: 'instagram', published_at: '2026-08-05T04:00:00.000Z', likes: 5 }],
    })
    expect(rows[0].metrics.likes).toBeNull()
  })

  it('puts the busiest account first', () => {
    const rows = build({
      accounts: [account(), account({ id: 'a2', platform: 'tiktok', provider_account_id: 'p2' })],
      jobs: [
        job(),
        job({ id: 'j2' }),
        job({ id: 'j3', targets: [{ platform: 'tiktok', accountId: 'p2' }] as never }),
      ],
    })
    expect(rows.map(r => r.account_id)).toEqual(['a1', 'a2'])
  })
})

describe('the words', () => {
  const row = build()[0]

  it('says what happened, leaving zeros out', () => {
    expect(postCountsLine({ ...row, went_out: 6, booked: 3, did_not: 1, by_hand: 2 }))
      .toBe('Went out 6 · Booked 3 · Did not go out 1 · 2 by hand')
    expect(postCountsLine({ ...row, went_out: 0, booked: 3, did_not: 0, by_hand: 0 }))
      .toBe('Booked 3')
  })

  it('prints the metrics compactly, and nothing when there are none', () => {
    expect(postMetricsLine({ ...row, metrics: { interactions: 1240, likes: null, comments: null, views: 3900 } }, compactCount))
      .toBe('1.2k interactions · 3.9k views')
    expect(postMetricsLine(row, compactCount)).toBeNull()
  })

  it('writes the handle the way a person does', () => {
    expect(accountHandle(row)).toBe('@sunsetco')
    expect(accountHandle({ ...row, username: '@already' })).toBe('@already')
    expect(accountHandle({ ...row, username: null })).toBe('instagram')
    expect(accountHandle({ ...row, username: null, platform: null })).toBe('Posted by hand')
  })
})
