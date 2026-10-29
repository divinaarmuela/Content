import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
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

describe('another month, one press', () => {
  it('a month is read in its middle, so every client zone agrees; nonsense and far-off months are refused', async () => {
    const { middleOfMonth } = await import('../app/lib/overview-posts-core')
    const now = new Date('2026-10-29T10:00:00Z')
    expect(middleOfMonth('2026-11', now)?.toISOString()).toBe('2026-11-15T12:00:00.000Z')
    expect(middleOfMonth('2026-13', now)).toBeNull()
    expect(middleOfMonth('nope', now)).toBeNull()
    expect(middleOfMonth('2031-01', now)).toBeNull()
  })
})

describe('scheduled but awaiting the client', () => {
  it('a scheduled post the client has not approved is held back from Zernio — so it is its own line in the log, tagged', () => {
    const route = readFileSync('app/api/overview/posts-month/route.ts', 'utf8')
    expect(route).toContain("if (!waitingForClient(p as never) || !p.client_id || !inMonth(p.scheduled_for ?? null, String(p.client_id))) continue")
    expect(route).toContain("networks: chans.map(ch => ({ platform: platformOf.get(ch)!, status: 'booked' as const, url: null })), awaiting_client: true,")
    expect(readFileSync('app/dashboard/page.tsx', 'utf8')).toContain('{e.awaiting_client && <span className="rounded-full bg-tint-amber px-2 py-0.5 font-semibold">Awaiting client approval</span>}')
  })
  it('the panel steps to any month', () => {
    const page = readFileSync('app/dashboard/page.tsx', 'utf8')
    expect(page).toContain("const qs = shownMonth === thisMonth ? '' : `?month=${shownMonth}`")
    expect(readFileSync('app/api/overview/posts-month/route.ts', 'utf8')).toContain("const asked = middleOfMonth(new URL(req.url).searchParams.get('month'))")
  })
})

describe('held for the client, counted once', () => {
  it('a post awaiting the client is one line on the client, under waiting — not also under scheduled', () => {
    const held = { id: 'post:x', status: 'booked' as const, at: '2026-11-04', caption: 'held', url: null, error: null, awaiting_client: true }
    const r = { ...row('ig', 'instagram', 0, [held, { ...e('z1', 'instagram', 'booked', '2026-11-05') }]), booked: 1, waiting: [{ post_id: 'x', at: '2026-11-04', booked: true }] }
    const r2 = { ...row('li', 'linkedin', 0, [held]), waiting: [{ post_id: 'x', at: '2026-11-04', booked: true }] }
    const [c] = postsByClient([r, r2])
    expect(c.booked).toBe(1)
    expect(c.waiting.length).toBe(1)
    expect(c.log!.map(x => x.id)).toEqual(['z1', 'post:x'])
  })
})
