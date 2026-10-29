import { describe, it, expect } from 'vitest'
import { postsByClient, type MonthRow } from '../app/lib/overview-posts-core'

// 29 Oct 2026, the owner: "why does it show two social platforms from same client it should be one … like justin
// engelke and then underneath its the booked / posted for those platforms"
const m: MonthRow['metrics'] = { interactions: null, likes: null, comments: null, views: null }
const row = (key: string, platform: string, went: number, log: MonthRow['log'], metrics = m): MonthRow => ({
  key, account_id: key, client_id: 'justin', client_name: 'Justin Engelke', platform, username: key,
  went_out: went, booked: 0, did_not: 0, by_hand: 0, metrics, waiting: [], log,
})
const e = (post: string, net: string, status: 'went_out' | 'booked', at: string) => ({ id: `${post}:${net}`, status, at, caption: post, url: null, error: null })

describe('posts this month, one line per client', () => {
  it('a post on three networks is one post; each account keeps its own numbers under the client', () => {
    const rows = [
      row('ig', 'instagram', 2, [e('p1', 'instagram', 'went_out', '2026-10-02'), e('p2', 'instagram', 'went_out', '2026-10-09')], { interactions: 10, likes: 8, comments: 2, views: 100 }),
      row('li', 'linkedin', 2, [e('p1', 'linkedin', 'went_out', '2026-10-02'), e('p2', 'linkedin', 'booked', '2026-10-09')]),
      row('tt', 'tiktok', 1, [e('p1', 'tiktok', 'went_out', '2026-10-02')], { interactions: 5, likes: 5, comments: 0, views: 50 }),
    ]
    const [c] = postsByClient(rows)
    expect(c.client_name).toBe('Justin Engelke')
    expect(c.went_out).toBe(2)
    expect(c.booked).toBe(0)
    expect(c.log!.map(x => x.id)).toEqual(['p2', 'p1'])
    expect(c.accounts.map(a => a.key)).toEqual(['ig', 'li', 'tt'])
    expect(c.metrics).toEqual({ interactions: 15, likes: 13, comments: 2, views: 150 })
  })
  it('two clients stay two lines, busiest first', () => {
    const other = { ...row('k', 'tiktok', 6, [1, 2, 3, 4, 5, 6].map(i => e(`k${i}`, 'tiktok', 'went_out', '2026-10-0' + i))), client_id: 'kode', client_name: 'Anthony Chimirri' }
    expect(postsByClient([row('ig', 'instagram', 1, [e('p1', 'instagram', 'went_out', '2026-10-02')]), other]).map(c => c.client_name)).toEqual(['Anthony Chimirri', 'Justin Engelke'])
  })
})
