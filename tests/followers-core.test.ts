import { describe, expect, it } from 'vitest'
import fixture from './fixtures/hiker-followers.json'
import {
  applySeen, costNote, dayKey, followedFromPost, followedWords, fromPostChip, fromThisPostLine,
  fullReadComplete, lastLookWords, leftWords, markLeft, matchesSearch, mergeInteractors, modeForDay,
  parseChunk, parseCommentsChunk, parseLikers, parseMediaId, parseProfile, piles, portalFollowers,
  postWindowOpen, readFinished, refreshAllowed, settingsOf, shiftDay, snapshotBucket, snapshotId,
  withFromThisPost, type FollowerRow, type SourceFollower,
} from '../app/lib/followers-core'

/**
 * WHO FOLLOWS — the pure half, against what the provider really answered.
 *
 * The fixture is trimmed from live responses (nasa, public, 7 Sep 2026):
 * the profile, one followers page in the TUPLE shape the OpenAPI promises,
 * the likers list, and a comments page. The help page shows the object
 * shape instead, so both are read here.
 */

const person = (pk: string, username: string, extra: Partial<SourceFollower> = {}): SourceFollower => ({
  pk, username, full_name: null, profile_pic: null, is_private: false, is_verified: false, ...extra,
})
const ACC = 'acc-1'
const CLIENT = 'client-1'

describe('the provider\'s answers', () => {
  it('reads the profile: pk, private, follower count', () => {
    const p = parseProfile(fixture.profile)
    expect(p).toEqual({ pk: '528817151', username: 'nasa', is_private: false, follower_count: 104399056 })
    expect(parseProfile({})).toBeNull()
    expect(parseProfile(null)).toBeNull()
  })

  it('reads a followers page in the tuple shape, keeping only what we store', () => {
    const page = parseChunk(fixture.followers_chunk)!
    expect(page.users).toHaveLength(4)
    expect(page.users[0]).toEqual({
      pk: '30822275979', username: 'astro.sed', full_name: 'AstroSED',
      profile_pic: expect.stringMatching(/^https:\/\//), is_private: false, is_verified: false,
    })
    // a null cursor came back on the FIRST page of a 104M-follower account —
    // which is exactly why a null cursor is never taken as "the list ended"
    expect(page.next).toBeNull()
  })

  it('reads the object shape the help page shows, and the GraphQL cursor name', () => {
    expect(parseChunk({ users: [person('1', 'a')], next_max_id: 'X' })).toEqual({ users: [person('1', 'a')], next: 'X' })
    expect(parseChunk({ users: [], end_cursor: 'Y' })).toEqual({ users: [], next: 'Y' })
    // a shape that changed under us is "no page", never "the list ended"
    expect(parseChunk({ nope: true })).toBeNull()
    expect(parseChunk('x')).toBeNull()
    expect(parseChunk([])).toBeNull()
  })

  it('drops a person with no pk or no handle, and keeps only https pictures', () => {
    const page = parseChunk([[{ pk: '1' }, { username: 'x' }, { pk: '2', username: 'ok', profile_pic_url: 'http://plain' }], null])!
    expect(page.users).toEqual([person('2', 'ok')])
  })

  it('reads the media id, the likers, and a comments page with its cursor', () => {
    expect(parseMediaId(fixture.media)).toBe('3967213292204992434_528817151')
    const likers = parseLikers(fixture.likers)!
    expect(likers).toHaveLength(4)
    expect(likers[0]).toEqual({ username: 'ankit_yadav_2946', full_name: 'Ankit Yadav', profile_pic: expect.stringMatching(/^https:/) })
    const c = parseCommentsChunk(fixture.comments_chunk)!
    expect(c.people).toHaveLength(3)
    expect(c.people[0].username).toBe('synthiqfuture')
    expect(typeof c.next).toBe('string')
    expect(parseCommentsChunk({ comments: [{ user: person('9', 'z') }] })!.people[0].username).toBe('z')
    expect(parseCommentsChunk(null)).toBeNull()
  })
})

describe('days and buckets', () => {
  it('a look belongs to its Melbourne day; a manual one to its hour', () => {
    const at = new Date('2026-09-06T15:30:00Z')   // 01:30 on 7 Sep in Melbourne
    expect(dayKey(at)).toBe('2026-09-07')
    expect(snapshotBucket('scheduled', at)).toBe('2026-09-07')
    expect(snapshotBucket('manual', at)).toBe('2026-09-07T01')
    expect(snapshotId(ACC, 'top', '2026-09-07')).toBe('acc-1:top:2026-09-07')
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('the full read falls on Monday or the 1st, and never when switched off', () => {
    expect(modeForDay('weekly', '2026-09-07')).toBe('full')   // a Monday
    expect(modeForDay('weekly', '2026-09-08')).toBe('top')
    expect(modeForDay('monthly', '2026-09-01')).toBe('full')
    expect(modeForDay('monthly', '2026-09-07')).toBe('top')
    expect(modeForDay('off', '2026-09-01')).toBe('top')
  })

  it('settings default to the newest 100, monthly, off the portal — and clamp', () => {
    expect(settingsOf(null)).toEqual({ dailyTop: 100, fullCadence: 'monthly', onPortal: false })
    expect(settingsOf({ followers_daily_top: 5, followers_full_cadence: 'weekly', followers_on_portal: true }))
      .toEqual({ dailyTop: 25, fullCadence: 'weekly', onPortal: true })
    expect(settingsOf({ followers_daily_top: 9999, followers_full_cadence: 'daily' }).dailyTop).toBe(500)
    expect(settingsOf({ followers_full_cadence: 'daily' }).fullCadence).toBe('monthly')
  })
})

describe('the diff', () => {
  const day1 = '2026-09-01', day2 = '2026-09-02'

  it('the first look seeds: everybody was already there, nobody joined today', () => {
    const rows = applySeen({ existing: new Map(), seen: [person('1', 'a'), person('2', 'b')], accountId: ACC, clientId: CLIENT, day: day1, seeded: false, offset: 0 })
    expect(rows.map(r => r.id)).toEqual(['acc-1:1', 'acc-1:2'])
    expect(rows.every(r => r.first_seen_at === null && r.last_seen_at === day1 && r.gone_at === null)).toBe(true)
    expect(rows.map(r => r.position_last)).toEqual([0, 1])
  })

  it('after seeding, a stranger at the top followed today; a known face is just seen again', () => {
    const existing = new Map(applySeen({ existing: new Map(), seen: [person('1', 'a')], accountId: ACC, clientId: CLIENT, day: day1, seeded: false, offset: 0 }).map(r => [r.id, r]))
    const rows = applySeen({ existing, seen: [person('3', 'c'), person('1', 'a', { full_name: 'Renamed' })], accountId: ACC, clientId: CLIENT, day: day2, seeded: true, offset: 0 })
    const c = rows.find(r => r.pk === '3')!, a = rows.find(r => r.pk === '1')!
    expect(followedWords(c)).toBe('Followed on 2 Sep')
    expect(c.first_seen_at).toBe(day2)
    expect(a.first_seen_at).toBeNull()
    expect(a.last_seen_at).toBe(day2)
    expect(a.full_name).toBe('Renamed')
    expect(followedWords(a)).toBe('—')
  })

  it('positions continue across pages, and a duplicate on a page is one row', () => {
    const rows = applySeen({ existing: new Map(), seen: [person('5', 'e'), person('5', 'e'), person('6', 'f')], accountId: ACC, clientId: CLIENT, day: day1, seeded: true, offset: 50 })
    expect(rows.map(r => [r.pk, r.position_last])).toEqual([['5', 50], ['6', 51]])
  })

  it('somebody who came back is no longer gone, and keeps their join date', () => {
    const gone: FollowerRow = { ...applySeen({ existing: new Map(), seen: [person('1', 'a')], accountId: ACC, clientId: CLIENT, day: day1, seeded: true, offset: 0 })[0], gone_at: day2 }
    const [back] = applySeen({ existing: new Map([[gone.id, gone]]), seen: [person('1', 'a')], accountId: ACC, clientId: CLIENT, day: '2026-09-03', seeded: true, offset: 0 })
    expect(back.gone_at).toBeNull()
    expect(back.first_seen_at).toBe(day1)
  })

  it('markLeft: everybody not seen today left today, once', () => {
    const seenToday = applySeen({ existing: new Map(), seen: [person('1', 'a')], accountId: ACC, clientId: CLIENT, day: day2, seeded: true, offset: 0 })[0]
    const missed: FollowerRow = { ...seenToday, id: 'acc-1:2', pk: '2', username: 'b', last_seen_at: day1 }
    const already: FollowerRow = { ...missed, id: 'acc-1:3', pk: '3', username: 'c', gone_at: day1 }
    const left = markLeft([seenToday, missed, already], day2)
    expect(left.map(r => r.pk)).toEqual(['2'])
    expect(leftWords(left[0])).toBe('Left on 2 Sep')
  })
})

describe('when a full read may say somebody left', () => {
  it('only a full read, read to the end, of an account under the cap, that reached the count', () => {
    const base = { mode: 'full' as const, cursor: null, seen: 950, count: 1000, limit: 20000 }
    expect(fullReadComplete(base)).toBe(true)
    expect(fullReadComplete({ ...base, mode: 'top' })).toBe(false)
    expect(fullReadComplete({ ...base, cursor: 'more' })).toBe(false)
    expect(fullReadComplete({ ...base, seen: 800 })).toBe(false)
    expect(fullReadComplete({ ...base, count: null })).toBe(false)
    expect(fullReadComplete({ ...base, count: 25000, seen: 20000 })).toBe(false)
  })

  it('the live case: 50 of 104 million with a null cursor is NOT the whole list', () => {
    expect(fullReadComplete({ mode: 'full', cursor: null, seen: 50, count: 104399056, limit: 20000 })).toBe(false)
    expect(readFinished({ cursor: null, seen: 50, limit: 20000 })).toBe(true)
    expect(lastLookWords({ status: 'done', day: '2026-09-07', mode: 'full', seen: 50, count: 104399056, limit: 20000, cursor: null }))
      .toMatch(/couldn.t be read, so nobody is marked as having left/)
  })

  it('reading stops at the cap or the end', () => {
    expect(readFinished({ cursor: 'x', seen: 100, limit: 100 })).toBe(true)
    expect(readFinished({ cursor: 'x', seen: 99, limit: 100 })).toBe(false)
  })
})

describe('guards', () => {
  const at = '2026-09-07T00:00:00.000Z'
  it('a refresh is honoured once an hour, and never while a look runs', () => {
    expect(refreshAllowed(null, new Date(at))).toEqual({ ok: true })
    const soon = new Date(Date.parse(at) + 10 * 60_000)
    expect(refreshAllowed({ status: 'done', taken_at: at }, soon)).toMatchObject({ ok: false, reason: 'too_soon' })
    expect(refreshAllowed({ status: 'running', taken_at: at }, soon)).toMatchObject({ ok: false, reason: 'running' })
    expect(refreshAllowed({ status: 'done', taken_at: at }, new Date(Date.parse(at) + 61 * 60_000))).toEqual({ ok: true })
  })

  it('the cost note is money for the row, never for a screen', () => {
    expect(costNote(400)).toBe('~$0.40')
    expect(costNote(2)).toBe('~$0.002')
  })
})

describe('the piles', () => {
  const row = (pk: string, first: string | null, last: string, gone: string | null = null, pos: number | null = null): FollowerRow => ({
    id: `acc-1:${pk}`, account_id: ACC, client_id: CLIENT, pk, username: `u${pk}`, full_name: pk === '1' ? 'Ann Lee' : null,
    profile_pic: null, is_private: false, is_verified: false, first_seen_at: first, last_seen_at: last, gone_at: gone, position_last: pos,
  })
  const today = '2026-09-07'
  const rows = [
    row('1', null, today, null, 3),
    row('2', '2026-09-06', today, null, 1),
    row('3', today, today, null, 0),
    row('4', '2026-08-20', today, null, 2),
    row('5', '2026-09-05', '2026-09-05', '2026-09-06'),
    row('6', null, '2026-08-01', '2026-08-15'),
  ]

  it('new this week by day, newest first; left this week; all newest first', () => {
    const p = piles(rows, today)
    expect(p.newThisWeek.map(d => [d.day, d.rows.map(r => r.pk)])).toEqual([[today, ['3']], ['2026-09-06', ['2']]])
    expect(p.leftThisWeek.map(r => r.pk)).toEqual(['5'])
    expect(p.all.map(r => r.pk)).toEqual(['3', '2', '4', '1'])
    expect(p.following).toBe(4)
  })

  it('search matches handle or name, case-blind', () => {
    expect(matchesSearch(rows[0], 'ann')).toBe(true)
    expect(matchesSearch(rows[0], 'U1')).toBe(true)
    expect(matchesSearch(rows[1], 'ann')).toBe(false)
    expect(matchesSearch(rows[1], '')).toBe(true)
  })

  it('the portal gets names, faces and days — nothing else', () => {
    const out = portalFollowers({ rows, count: 1234, today, latest: { status: 'done', day: today }, posts: [{ title: 'Hero reel', followed: [{ username: 'u3', full_name: null }] }] })
    expect(out.count).toBe(1234)
    expect(out.new_this_week.map(p => p.username)).toEqual(['u3', 'u2'])
    expect(out.left_this_week.map(p => [p.username, p.day])).toEqual([['u5', '2026-09-06']])
    expect(out.from_posts).toEqual([{ title: 'Hero reel', count: 1, names: ['@u3'] }])
    const text = JSON.stringify(out)
    for (const forbidden of ['hiker', 'apify', 'account_id', 'client_id', 'cost', 'request', 'status', 'error', '$']) {
      expect(text.toLowerCase()).not.toContain(forbidden)
    }
    expect(Object.keys(out.new_this_week[0]).sort()).toEqual(['day', 'full_name', 'is_verified', 'profile_pic', 'username'])
  })
})

describe('followed from this post', () => {
  const f = (username: string, first: string | null): FollowerRow => ({
    id: `acc-1:${username}`, account_id: ACC, client_id: CLIENT, pk: username, username, full_name: null, profile_pic: null,
    is_private: false, is_verified: false, first_seen_at: first, last_seen_at: '2026-09-07', gone_at: null, position_last: null,
  })
  const interactors = { likers: ['amy', 'ben', 'old'], commenters: ['ben', 'cat'], people: { amy: { username: 'Amy', full_name: 'Amy A', profile_pic: 'https://p/amy' } } }
  const publishedAt = '2026-09-03T08:00:00Z'   // 3 Sep in Melbourne

  it('is the cross of followed-on-or-after-the-post with liked-or-commented', () => {
    const out = followedFromPost({
      followers: [f('amy', '2026-09-04'), f('ben', '2026-09-03'), f('cat', '2026-09-02'), f('old', null), f('dan', '2026-09-05')],
      interactors, publishedAt,
    })
    expect(out.map(x => [x.username, x.how])).toEqual([['amy', 'liked'], ['ben', 'liked and commented']])
    expect(out[0].full_name).toBe('Amy A')          // the face fills a blank name
    expect(fromThisPostLine(out)).toBe('2 of them liked or commented on this post')
    expect(withFromThisPost('42 interactions · +12 followers', out)).toBe('42 interactions · +12 followers · 2 from this post')
    expect(withFromThisPost(null, [])).toBeNull()
    expect(fromPostChip('liked', 'Hero reel')).toBe('liked Hero reel')
    expect(fromPostChip('commented', '')).toBe('commented a post')
  })

  it('a join later than the post\'s first week does not count, nor a post with no date', () => {
    expect(followedFromPost({ followers: [f('amy', '2026-09-20')], interactors, publishedAt })).toEqual([])
    expect(followedFromPost({ followers: [f('amy', '2026-09-04')], interactors, publishedAt: null })).toEqual([])
    expect(followedFromPost({ followers: [f('amy', '2026-09-04')], interactors: null, publishedAt })).toEqual([])
  })

  it('the post is read for its first week and merged as a union', () => {
    expect(postWindowOpen(publishedAt, '2026-09-07')).toBe(true)
    expect(postWindowOpen(publishedAt, '2026-09-10')).toBe(false)
    expect(postWindowOpen(publishedAt, '2026-09-02')).toBe(false)
    const m1 = mergeInteractors(null, { media_id: 'm', likers: [{ username: 'Amy', full_name: null, profile_pic: null }], commenters: [], now: 't1', today: '2026-09-04' })
    const m2 = mergeInteractors(m1, { media_id: null, likers: [{ username: 'ben', full_name: null, profile_pic: null }], commenters: [{ username: 'amy', full_name: 'A', profile_pic: null }], now: 't2', today: '2026-09-05' })
    expect(m2.media_id).toBe('m')
    expect(m2.likers).toEqual(['amy', 'ben'])
    expect(m2.commenters).toEqual(['amy'])
    expect(m2.reads).toBe(2)
    expect(m2.fetched_day).toBe('2026-09-05')
  })
})
