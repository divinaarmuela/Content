/**
 * REPORT V2 — driven by Zernio's REAL answers, recorded read-only on 5 Nov 2026 (tests/fixtures/zernio). Every bug the
 * owner found on 5 Nov is one assertion here. No network, no database.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readAccountMonth } from '@/app/lib/report-v2/fetch'
import { normaliseAccount, percentMap } from '@/app/lib/report-v2/normalise'
import { runChecks, shareBlockers } from '@/app/lib/report-v2/checks'
import { changeOf, followerGain, followerPoints, notTracked, postGives, val } from '@/app/lib/report-v2/definitions'
import { followerChange } from '@/app/lib/social-analytics-core'
import type { V2Account, V2Platform, ZernioFetch } from '@/app/lib/report-v2/types'

type Fixture = { today: string; profileId: string | null; accounts: V2Account[]; calls: Record<string, unknown> }
const load = (n: string): Fixture => JSON.parse(readFileSync(`tests/fixtures/zernio/${n}.json`, 'utf8'))
const key = (p: string, q: Record<string, unknown>) => `${p}?${Object.keys(q).filter(k => q[k] !== undefined && q[k] !== '').sort().map(k => `${k}=${q[k]}`).join('&')}`
const fake = (f: Fixture): ZernioFetch => (async (path: string, query: Record<string, string | number | undefined>) => {
  const a = f.calls[key(path, query)]
  if (!a) throw new Error(`not recorded: ${key(path, query)}`)
  return a
}) as ZernioFetch
async function month(n: string, m: string): Promise<V2Platform[]> {
  const f = load(n)
  const out: V2Platform[] = []
  for (const a of f.accounts) out.push(normaliseAccount(await readAccountMonth(fake(f), a, f.profileId, m, f.today)))
  return out
}
const on = (ps: V2Platform[], p: string) => ps.find(x => x.platform === p)!

describe('Anthony Chimirri, October 2026 (real Zernio answers)', () => {
  it("Instagram followers: Instagram's own 82 follows − 38 unfollows = +44; the daily count says +43 (3 → 31 Oct)", async () => {
    const ig = on(await month('anthony', '2026-10'), 'instagram')
    expect(ig.followers.gained).toMatchObject({ state: 'value', value: 44 })
    expect([ig.followers.follows, ig.followers.unfollows]).toEqual([82, 38])
    expect(ig.followers.dailyGained).toMatchObject({ state: 'value', value: 43, since: '2026-10-03' })
    expect([ig.followers.start, ig.followers.end]).toEqual([2371, 2414])
  })
  it("November's 'last month' is October's own gain (+44), not a different number", async () => {
    const oct = on(await month('anthony', '2026-10'), 'instagram')
    const nov = on(await month('anthony', '2026-11'), 'instagram')
    expect(nov.followers.previousGained.value).toBe(oct.followers.gained.value)
    const checks = runChecks(await month('anthony', '2026-11'), [], { platforms: await month('anthony', '2026-10') })
    expect(checks.filter(c => c.key.startsWith('prev_') && !c.ok)).toEqual([])
  })
  it("Zernio's MONTHLY follower bucket is wrong (labels the 16 Oct count 2,390 as 1 Oct) — only daily is read", () => {
    const f = load('anthony')
    const monthly = (f.calls[key('/accounts/follower-stats', { accountIds: '6abf4f8b6594e7e8cc30c79a', fromDate: '2026-09-01', toDate: '2026-10-31', granularity: 'monthly' })] as { data: { stats: Record<string, { date: string; followers: number }[]> } }).data.stats['6abf4f8b6594e7e8cc30c79a']
    expect(monthly).toEqual([{ date: '2026-10-01', followers: 2390 }])
    const used = Object.keys(f.calls).filter(k => k.startsWith('/accounts/follower-stats') && k.includes('granularity=monthly'))
    expect(used).toHaveLength(1) // recorded only as evidence; readAccountMonth never asks for it
  })
  it('Instagram saves are a real number (16), never "not given"; interactions beyond the four parts are "other"', async () => {
    const ig = on(await month('anthony', '2026-10'), 'instagram')
    expect(ig.figures.saves).toMatchObject({ state: 'value', value: 16 })
    expect(ig.figures.interactions.value).toBe(1862)
    expect(ig.interactionsOther).toBe(1862 - (1379 + 146 + 101 + 16))
    for (const p of ig.posts.filter(x => x.kind !== 'story')) expect(p.stats.saves.state).toBe('value')
  })
  it('the same follower definition is used by Social → Analytics', () => {
    const f = load('anthony')
    const stats = (f.calls[key('/accounts/follower-stats', { accountIds: '6abf4f8b6594e7e8cc30c79a', fromDate: '2026-09-01', toDate: '2026-10-31', granularity: 'daily' })] as { data: { stats: Record<string, unknown> } }).data.stats['6abf4f8b6594e7e8cc30c79a']
    const oct = (stats as { date: string }[]).filter(p => p.date.slice(0, 7) === '2026-10')
    expect(followerChange(oct)?.change).toBe(followerGain(followerPoints(stats), '2026-10-01', '2026-10-31').value)
    expect(followerChange(oct)?.change).toBe(43)
  })
  it("LinkedIn on a profile with two LinkedIn accounts is the posts' own numbers, with no last month", async () => {
    const li = on(await month('anthony', '2026-10'), 'linkedin')
    expect(li.countedAs).toBe('posts')
    expect(li.previous.views.state).toBe('not_tracked')
    expect(li.figures.saves.state).toBe('not_given')
  })
})

describe('Basfoods, October 2026: Facebook connected on 5 Nov', () => {
  it("the month's dashboard is all 0, so the totals are the posts' own numbers, said as such", async () => {
    const fb = on(await month('basfoods', '2026-10'), 'facebook')
    expect(fb.countedAs).toBe('posts')
    expect(fb.figures.views).toMatchObject({ state: 'value', value: 7438 })
    expect(fb.notes.join(' ')).toMatch(/connected later/)
    expect(fb.followers.gained.state).toBe('not_tracked')
    expect(fb.previous.reach.state).toBe('not_tracked')
  })
})

describe('Capila Finance, October 2026', () => {
  it("last month's Facebook reach is September's own calendar month: 157", async () => {
    const fb = on(await month('capila', '2026-10'), 'facebook')
    expect(fb.previous.reach).toMatchObject({ state: 'value', value: 157 })
  })
  it('never a % change against a 0 last month', async () => {
    const fb = on(await month('capila', '2026-10'), 'facebook')
    expect(fb.previous.views.value).toBe(0)
    expect(changeOf(fb.figures.views, fb.previous.views)).toBeNull()
  })
})

describe('the definition list and the checks', () => {
  it('what each platform gives per kind of post', () => {
    expect(postGives('instagram', 'carousel')).toContain('saves')
    expect(postGives('instagram', 'story')).toEqual([])
    expect(postGives('facebook', 'reel')).toEqual(['views', 'reach'])
    expect(postGives('facebook', 'image')).toEqual(['reach', 'likes'])
    expect(postGives('linkedin', 'image')).not.toContain('saves')
    expect(postGives('tiktok', 'reel')).toHaveLength(6)
  })
  it('a change only between two real values', () => {
    expect(changeOf(val(12), val(10))).toEqual({ text: '+20%', up: true })
    expect(changeOf(val(12), notTracked('2026-10-03'))).toBeNull()
  })
  it('followers need a week of the month', () => {
    expect(followerGain([{ date: '2026-09-30', followers: 10 }, { date: '2026-09-30', followers: 10 }], '2026-09-01', '2026-09-30').state).toBe('not_tracked')
  })
  it("TikTok's fractions are said as %", () => {
    expect(percentMap({ follower: 0.2, nonFollower: 0.8 })).toEqual({ follower: 20, nonFollower: 80 })
  })
  it('a failed read blocks sharing with a reason', async () => {
    const ps = await month('capila', '2026-10')
    const broken = ps.map(p => ({ ...p, figures: { ...p.figures, views: { state: 'unreadable' as const, reason: 'Zernio 500' } } }))
    expect(shareBlockers(runChecks(broken, []))).toEqual(expect.arrayContaining([expect.stringMatching(/could not read views/)]))
    expect(shareBlockers(runChecks(ps, []))).toEqual([])
  })
})
