import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import type { FollowerSource } from '../app/lib/follower-source'
import type { Interactor, SourceFollower, SourceProfile } from '../app/lib/followers-core'

/**
 * WHO FOLLOWS — the looks, against a miniature database and a scripted
 * source. What is pinned here is the discipline, not the arithmetic (that is
 * followers-core.test.ts): one look per account per day by CLAIM, a private
 * account settled before a single follower page is paid for, a failed
 * request final, a mega account never told anyone left, and the cross with
 * a post's likers written on the post's own row.
 */

const { beginSnapshot, advanceSnapshot, runSnapshot, followersOf, snapshotsOf } = await import('../app/lib/followers')
const { readPostInteractors, crossFollowersWithPosts, duePosts } = await import('../app/lib/post-interactors')

const ACC = 'acc-1', CLIENT = 'client-1'
const person = (pk: string, username: string): SourceFollower => ({ pk, username, full_name: null, profile_pic: null, is_private: false, is_verified: false })
const who = (username: string): Interactor => ({ username, full_name: null, profile_pic: null })

/** a source that answers from a script and counts what it was asked */
function scripted(s: {
  profile?: Partial<SourceProfile>
  pages?: SourceFollower[][]
  likers?: Interactor[]
  comments?: Interactor[][]
  fail?: 'profile' | 'followers' | 'likers'
}): FollowerSource & { calls: string[] } {
  const calls: string[] = []
  const pages = s.pages ?? [[]]
  return {
    name: 'scripted', calls,
    async profile(username) {
      calls.push(`profile:${username}`)
      if (s.fail === 'profile') return { ok: false, error: 'http_404' }
      return { ok: true, value: { pk: '900', username, is_private: false, follower_count: pages.flat().length, ...s.profile } }
    },
    async followers(_pk, cursor) {
      calls.push(`followers:${cursor ?? 'start'}`)
      if (s.fail === 'followers') return { ok: false, error: 'http_500' }
      const i = cursor ? Number(cursor.slice(1)) : 0
      const users = pages[i] ?? []
      return { ok: true, value: { users, next: i + 1 < pages.length ? `p${i + 1}` : null } }
    },
    async mediaId(url) { calls.push(`media:${url}`); return { ok: true, value: 'media-1' } },
    async likers(id) {
      calls.push(`likers:${id}`)
      if (s.fail === 'likers') return { ok: false, error: 'http_403' }
      return { ok: true, value: s.likers ?? [] }
    },
    async commenters(id, cursor) {
      calls.push(`comments:${id}:${cursor ?? 'start'}`)
      const all = s.comments ?? [[]]
      const i = cursor ? Number(cursor.slice(1)) : 0
      return { ok: true, value: { people: all[i] ?? [], next: i + 1 < all.length ? `c${i + 1}` : null } }
    },
  }
}

const DAY1 = new Date('2026-09-01T00:00:00Z')   // 10:00, 1 Sep, Melbourne
const DAY2 = new Date('2026-09-02T00:00:00Z')
const DAY3 = new Date('2026-09-03T00:00:00Z')

let fake: ReturnType<typeof seedDb>
beforeEach(() => {
  fake = seedDb({
    clients: [{ id: CLIENT, name: 'Nathan Homes', status: 'active' }] as unknown as Row[],
    social_accounts: [{
      id: ACC, client_id: CLIENT, platform: 'instagram', provider_account_id: 'ig-1', username: 'nathanhomes',
      name: null, avatar_url: null, active: true, connected_at: '2026-08-30T00:00:00Z', last_synced_at: '2026-08-30T00:00:00Z',
    }] as unknown as Row[],
    content_items: [{ id: 'item-1', client_id: CLIENT, title: 'Hero reel', status: 'published' }] as unknown as Row[],
    post_analytics: [{
      id: 'pa-1', item_id: 'item-1', provider_post_id: 'zp-1', platform: 'instagram',
      platform_post_url: 'https://www.instagram.com/p/ABC123/', published_at: '2026-09-01T09:00:00Z',
      synced_at: '2026-09-01T09:00:00Z', sync_status: 'ok',
    }] as unknown as Row[],
    follower_snapshots: [], followers: [],
  })
})
afterEach(() => fake.restore())

describe('one look per account per day', () => {
  it('the first look seeds the list — the whole list, nobody new', async () => {
    const source = scripted({ pages: [[person('1', 'ann'), person('2', 'ben')], [person('3', 'cat')]] })
    const r = await runSnapshot({ accountId: ACC, mode: 'full', trigger: 'scheduled', now: DAY1, source })
    expect(r).toMatchObject({ done: true, status: 'done', seen: 3, requests: 3, left: 0 })
    const rows = await followersOf(ACC)
    expect(rows.map(x => x.username).sort()).toEqual(['ann', 'ben', 'cat'])
    expect(rows.every(x => x.first_seen_at === null && x.last_seen_at === '2026-09-01')).toBe(true)
    const [snap] = await snapshotsOf(ACC)
    expect(snap).toMatchObject({ id: 'acc-1:full:2026-09-01', status: 'done', seeded: false, count: 3, cost_note: '~$0.003' })
  })

  it('two looks the same morning are one look: the claim decides', async () => {
    const source = scripted({ pages: [[person('1', 'ann')]] })
    const [a, b] = await Promise.all([
      beginSnapshot({ accountId: ACC, mode: 'top', trigger: 'scheduled', now: DAY1, source }),
      beginSnapshot({ accountId: ACC, mode: 'top', trigger: 'scheduled', now: DAY1, source }),
    ])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual(['running', 'skipped'])
    expect(source.calls.filter(c => c.startsWith('profile:'))).toHaveLength(1)
    // …and the next day is a new look
    const c = await beginSnapshot({ accountId: ACC, mode: 'top', trigger: 'scheduled', now: DAY2, source })
    expect(c.status).toBe('running')
  })

  it('a "Refresh now" within the hour stands down; an hour later it runs', async () => {
    const source = scripted({ pages: [[person('1', 'ann')]] })
    await runSnapshot({ accountId: ACC, mode: 'top', trigger: 'scheduled', now: DAY1, source })
    const soon = await beginSnapshot({ accountId: ACC, mode: 'top', trigger: 'manual', now: new Date(DAY1.getTime() + 20 * 60_000), source })
    expect(soon).toEqual({ status: 'skipped', reason: 'too_soon' })
    const later = await beginSnapshot({ accountId: ACC, mode: 'top', trigger: 'manual', now: new Date(DAY1.getTime() + 61 * 60_000), source })
    expect(later.status).toBe('running')
    expect((later as { id: string }).id).toBe('acc-1:top:2026-09-01T11')
  })
})

describe('joined and left', () => {
  it('after seeding, a stranger at the top followed today; a full read to the end says who left', async () => {
    await runSnapshot({ accountId: ACC, mode: 'full', trigger: 'scheduled', now: DAY1, source: scripted({ pages: [[person('1', 'ann'), person('2', 'ben'), person('3', 'cat')]] }) })
    // the morning top-N: dan is new at the top
    const top = await runSnapshot({ accountId: ACC, mode: 'top', trigger: 'scheduled', now: DAY2, source: scripted({ pages: [[person('4', 'dan'), person('1', 'ann')]] }) })
    expect(top).toMatchObject({ status: 'done', seen: 2, left: 0 })
    let rows = await followersOf(ACC)
    expect(rows.find(r => r.username === 'dan')?.first_seen_at).toBe('2026-09-02')
    expect(rows.find(r => r.username === 'cat')?.gone_at).toBeNull()   // a top look never says anyone left
    // the full read: ben and cat are gone
    const full = await runSnapshot({ accountId: ACC, mode: 'full', trigger: 'scheduled', now: DAY3, source: scripted({ profile: { follower_count: 2 }, pages: [[person('4', 'dan'), person('1', 'ann')]] }) })
    expect(full).toMatchObject({ status: 'done', seen: 2, left: 2 })
    rows = await followersOf(ACC)
    expect(rows.filter(r => r.gone_at === '2026-09-03').map(r => r.username).sort()).toEqual(['ben', 'cat'])
    expect(rows.find(r => r.username === 'dan')).toMatchObject({ first_seen_at: '2026-09-02', gone_at: null })
  })

  it('a mega account answers 50 with a null cursor — nobody is marked as gone', async () => {
    await runSnapshot({ accountId: ACC, mode: 'full', trigger: 'scheduled', now: DAY1, source: scripted({ pages: [[person('1', 'ann'), person('2', 'ben')]] }) })
    const r = await runSnapshot({ accountId: ACC, mode: 'full', trigger: 'scheduled', now: DAY2, source: scripted({ profile: { follower_count: 104_399_056 }, pages: [[person('1', 'ann')]] }) })
    expect(r).toMatchObject({ status: 'done', seen: 1, left: 0 })
    expect((await followersOf(ACC)).find(x => x.username === 'ben')?.gone_at).toBeNull()
  })

  it('the daily read stops at the client\'s N, and the pages advance across steps', async () => {
    await fake.restore()
    fake = seedDb({
      clients: [{ id: CLIENT, name: 'N', status: 'active', followers_daily_top: 25 }] as unknown as Row[],
      social_accounts: [{ id: ACC, client_id: CLIENT, platform: 'instagram', provider_account_id: 'ig-1', username: 'x', active: true, connected_at: '2026-08-30T00:00:00Z', last_synced_at: '' }] as unknown as Row[],
    })
    const pages = [0, 1, 2].map(i => Array.from({ length: 20 }, (_, j) => person(`${i}-${j}`, `u${i}-${j}`)))
    const source = scripted({ pages })
    const begun = await beginSnapshot({ accountId: ACC, mode: 'top', trigger: 'scheduled', now: DAY1, source })
    expect(begun.status).toBe('running')
    const step1 = await advanceSnapshot((begun as { id: string }).id, { maxPages: 1, source })
    expect(step1).toMatchObject({ done: false, seen: 20 })
    const step2 = await advanceSnapshot((begun as { id: string }).id, { maxPages: 1, source })
    expect(step2).toMatchObject({ done: true, seen: 40 })   // past N=25, so it stops; page 3 never asked for
    expect(source.calls.filter(c => c.startsWith('followers:'))).toHaveLength(2)
  })
})

describe('what must not cost money', () => {
  it('a private account is settled before a follower page is asked for', async () => {
    const source = scripted({ profile: { is_private: true } })
    const r = await runSnapshot({ accountId: ACC, mode: 'full', trigger: 'scheduled', now: DAY1, source })
    expect(r).toMatchObject({ status: 'private' })
    expect(source.calls).toEqual(['profile:nathanhomes'])
    expect((await snapshotsOf(ACC))[0]).toMatchObject({ status: 'private', requests: 1 })
    expect(await followersOf(ACC)).toEqual([])
  })

  it('a failed request is final — recorded, never asked again', async () => {
    const source = scripted({ fail: 'followers' })
    const r = await runSnapshot({ accountId: ACC, mode: 'top', trigger: 'scheduled', now: DAY1, source })
    expect(r).toMatchObject({ done: true, status: 'failed', reason: 'http_500' })
    expect(source.calls.filter(c => c.startsWith('followers:'))).toHaveLength(1)
    // a second attempt the same day is the claim's business: it stands down
    expect(await beginSnapshot({ accountId: ACC, mode: 'top', trigger: 'scheduled', now: DAY1, source })).toMatchObject({ status: 'skipped' })
  })

  it('nothing happens without a source, and not for a non-Instagram or unlinked account', async () => {
    expect(await beginSnapshot({ accountId: ACC, mode: 'top', trigger: 'scheduled', now: DAY1, source: null })).toEqual({ status: 'skipped', reason: 'not switched on' })
    expect(await beginSnapshot({ accountId: 'nope', mode: 'top', trigger: 'scheduled', now: DAY1, source: scripted({}) })).toEqual({ status: 'skipped', reason: 'no such account' })
  })
})

describe('followed from this post', () => {
  it('reads a post\'s likers once a day, and the cross lands on the post\'s row after a look', async () => {
    // day 1: the baseline
    await runSnapshot({ accountId: ACC, mode: 'full', trigger: 'scheduled', now: DAY1, source: scripted({ pages: [[person('1', 'ann')]] }) })
    // day 2: dan and eve followed; dan liked the post, eve did nothing, ann (old) commented
    const source = scripted({ pages: [[person('4', 'dan'), person('5', 'eve'), person('1', 'ann')]], likers: [who('Dan')], comments: [[who('ann')], [who('zed')]] })
    expect((await duePosts(DAY2)).map(d => d.post.id)).toEqual(['pa-1'])
    const read = await readPostInteractors('pa-1', { now: DAY2, source })
    expect(read).toMatchObject({ status: 'read', likers: 1, commenters: 2 })
    expect(source.calls.filter(c => /^(media|likers|comments)/.test(c))).toEqual(['media:https://www.instagram.com/p/ABC123/', 'likers:media-1', 'comments:media-1:start', 'comments:media-1:c1'])
    expect(await readPostInteractors('pa-1', { now: DAY2, source })).toMatchObject({ status: 'skipped' })
    expect(await duePosts(DAY2)).toEqual([])

    await runSnapshot({ accountId: ACC, mode: 'top', trigger: 'scheduled', now: DAY2, source })
    const cross = await crossFollowersWithPosts(ACC, DAY2)
    expect(cross).toEqual({ posts: 1, followed: 1 })
    const row = fake.rows('post_analytics')[0] as unknown as { interactors: { followed: { username: string; how: string }[]; likers: string[]; media_id: string } }
    expect(row.interactors.media_id).toBe('media-1')
    expect(row.interactors.likers).toEqual(['dan'])
    expect(row.interactors.followed).toEqual([expect.objectContaining({ username: 'dan', how: 'liked', followed_on: '2026-09-02' })])
  })

  it('a post from before the account was connected is never read', async () => {
    await fake.restore()
    fake = seedDb({
      clients: [{ id: CLIENT, name: 'N', status: 'active' }] as unknown as Row[],
      social_accounts: [{ id: ACC, client_id: CLIENT, platform: 'instagram', provider_account_id: 'ig-1', username: 'x', active: true, connected_at: '2026-09-02T00:00:00Z', last_synced_at: '' }] as unknown as Row[],
      content_items: [{ id: 'item-1', client_id: CLIENT, title: 'Old', status: 'published' }] as unknown as Row[],
      post_analytics: [{ id: 'pa-old', item_id: 'item-1', provider_post_id: 'zp-old', platform: 'instagram', platform_post_url: 'https://www.instagram.com/p/OLD/', published_at: '2026-09-01T09:00:00Z', synced_at: '' }] as unknown as Row[],
    })
    expect(await duePosts(DAY2)).toEqual([])
  })

  it('a paid failure on the likers is recorded and the day is not asked for again', async () => {
    const source = scripted({ fail: 'likers' })
    expect(await readPostInteractors('pa-1', { now: DAY2, source })).toMatchObject({ status: 'failed', reason: 'http_403' })
    expect(await readPostInteractors('pa-1', { now: DAY2, source })).toMatchObject({ status: 'skipped' })
    expect(source.calls.filter(c => c.startsWith('likers:'))).toHaveLength(1)
  })
})
