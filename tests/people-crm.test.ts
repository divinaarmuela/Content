import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildPeople } from '../app/lib/people-analytics-core'
import { crmCounts, crmFilter, crmRow, crmSort, dayWords, PEOPLE_CRM_CLIENTS } from '../app/lib/people-crm-core'

/** THE PEOPLE CRM (the owner, 28 Sep 2026: "data per user — new follower, interactions — if DMed — track every touch point") */
const people = buildPeople({
  followers: [
    { username: 'old_friend', full_name: 'Old', profile_pic: null, is_private: false, is_verified: false, first_seen_at: null, gone_at: null },
    { username: 'tom_b', full_name: 'Tom Burgess', profile_pic: null, is_private: false, is_verified: false, first_seen_at: '2026-09-27', gone_at: null },
    { username: 'left_one', full_name: null, profile_pic: null, is_private: false, is_verified: false, first_seen_at: null, gone_at: '2026-09-26' },
    { username: 'mdmedia._', full_name: 'MD Media', profile_pic: null, is_private: false, is_verified: false, first_seen_at: '2026-09-27', gone_at: null },
  ],
  posts: [{ item_id: 'i1', title: 'Builder broker reel', href: '/dashboard/social/posts/p1', day: '2026-09-25',
    likers: ['tom_b', 'fan_only'], commenters: ['tom_b'], people: {} }],
  inbox: [{ username: 'dm_person', name: 'Dee', kind: 'message', last_at: '2026-09-28T02:00:00Z', first_at: '2026-09-27T01:00:00Z' }],
})
const rows = crmSort(people.map(p => crmRow(p, new Set(['mdmedia._']))))
const by = (u: string) => rows.find(r => r.username === u)!

describe('one row per person, every touch dated', () => {
  it('a new follower who liked and commented on the reel first: commented, likely from the reel', () => {
    const t = by('tom_b')
    expect(t.status).toBe('commented')
    expect([t.likes, t.comments]).toEqual([1, 1])
    expect(t.from_post).toBe('Builder broker reel')
    expect(t.first_seen).toBe('2026-09-25')
    expect(t.last_active).toBe('2026-09-27')
    expect(t.timeline.map(e => e.what)).toEqual(['Started following', 'Commented on a post', 'Liked a post'])
    expect(t.following).toBe(true)
  })
  it('a DM is its own touch, with View DM', () => {
    const d = by('dm_person')
    expect(d.status).toBe('dmed')
    expect(d.dmed).toBe(true)
    expect(d.timeline[0]).toMatchObject({ what: 'Sent a DM', link: 'View DM', day: '2026-09-28' })
    expect(d.first_seen).toBe('2026-09-27')
  })
  it('a like from someone who does not follow is a Liked, not a Follower', () => {
    expect(by('fan_only').status).toBe('liked')
    expect(by('fan_only').following).toBe(false)
  })
  it('an unfollow is kept, an old follower has no touch, our own account is marked', () => {
    expect(by('left_one').status).toBe('unfollowed')
    expect(by('old_friend').status).toBe('follower')
    expect(by('old_friend').timeline).toEqual([])
    expect(by('mdmedia._').status).toBe('ours')
  })
  it('the counts leave our own accounts out', () => {
    expect(crmCounts(rows)).toEqual({ people: 4, new_followers: 1, engaged: 2, dmed: 1, likely_from_posts: 1, unfollowed: 1 })
  })
  it('the filters and the newest-first order', () => {
    expect(crmFilter(rows, 'active').map(r => r.username)).not.toContain('old_friend')
    expect(crmFilter(rows, 'all')).toHaveLength(rows.length)
    expect(crmFilter(rows, 'dmed').map(r => r.username)).toEqual(['dm_person'])
    expect(crmFilter(rows, 'new').map(r => r.username)).toEqual(['tom_b'])
    expect(crmFilter(rows, 'active', '@TOM').map(r => r.username)).toEqual(['tom_b'])
    expect(rows[0].username).toBe('dm_person')
  })
  it('days read like the screenshot', () => {
    expect(dayWords('2026-09-28', '2026-09-28')).toBe('Today')
    expect(dayWords('2026-09-27', '2026-09-28')).toBe('Yesterday')
    expect(dayWords('2026-09-20', '2026-09-28')).toBe('20 Sep')
    expect(dayWords(null, '2026-09-28')).toBe('—')
  })
})

describe('the page and its wiring', () => {
  it('is for Justin and Jordan, team only, scoped by client', () => {
    expect(PEOPLE_CRM_CLIENTS.map(c => c.name)).toEqual(['Justin Engelke', 'Jordan Wilson'])
    const route = readFileSync('app/api/social/people-crm/route.ts', 'utf8')
    expect(route).toContain("requireRole('scheduler')")
    expect(route).toContain('assertClientAccess(user, clientId)')
    expect(route).toContain('PEOPLE_CRM_CLIENTS.some(c => c.id === clientId)')
  })
  it('an incoming DM and a comment are noted as they arrive, not only when the Inbox is opened', () => {
    const wh = readFileSync('app/lib/zernio-webhook.ts', 'utf8')
    expect(wh).toContain("kind: 'message', account_id: action.accountId")
    expect(wh).toContain("kind: 'comment', account_id: action.accountId")
    expect(wh).toContain('!action.own')
  })
  it('sits in the Social menu', () => {
    expect(readFileSync('app/dashboard/ui/Shell.tsx', 'utf8')).toContain("{ href: '/dashboard/social/people',      label: 'People',      icon: Users }")
  })
})

describe('comments carry who, when and what (28 Sep 2026: "there are comments on his posts but I don\'t see any")', () => {
  it('each comment is its own line, with the words and the exact time', () => {
    const rows = buildPeople({
      followers: [],
      posts: [{ item_id: 'i1', title: 'Justin', href: '/dashboard/social/posts/p', day: '2026-09-25', likers: ['kaity.j_'], commenters: [], people: {},
        comment_log: [
          { username: 'kaity.j_', text: 'So grateful for what you do', at: '2026-09-25T11:39:50+0000' },
          { username: 's.jkani', text: 'No wayyyy 20k is crazy', at: '2026-09-25T09:52:27+0000' },
        ] }],
      inbox: [],
    }).map(p => crmRow(p))
    const k = rows.find(r => r.username === 'kaity.j_')!
    expect([k.likes, k.comments]).toEqual([1, 1])
    expect(k.status).toBe('commented')
    expect(k.timeline[0]).toMatchObject({ what: 'Commented “So grateful for what you do”', detail: 'Justin', at: '2026-09-25T11:39:50+0000' })
    expect(k.timeline.map(e => e.what)).toContain('Liked a post')
    expect(rows.find(r => r.username === 's.jkani')!.comments).toBe(1)
  })
  it('Activity is the log alone — no buttons at its head', () => {
    const page = readFileSync('app/dashboard/social/people/page.tsx', 'utf8')
    expect(page).not.toContain('Open their Instagram')
    expect(page).not.toContain('Follows the client')
  })
  it('the comments call carries the account the provider requires', () => {
    expect(readFileSync('app/lib/publisher.ts', 'utf8')).toContain('&accountId=${encodeURIComponent(accountId)}')
    expect(readFileSync('app/lib/post-analytics.ts', 'utf8')).toContain('publisher.postComments(id, commentAccountOf(job.targets))')
    expect(readFileSync('app/api/social/comments/route.ts', 'utf8')).toContain("postComments(postId, params.get('accountId'))")
  })
})

describe('a like is logged on the day our read first saw it (28 Sep 2026)', () => {
  it('the first read that finds a liker stamps that day; a later read keeps it', async () => {
    const { mergeInteractors } = await import('../app/lib/followers-core')
    const me = (u: string) => ({ username: u, full_name: null, profile_pic: null })
    const day1 = mergeInteractors(null, { media_id: 'm', likers: [me('Ann')], commenters: [], now: '2026-09-26T20:00:00Z', today: '2026-09-27' })
    const day2 = mergeInteractors(day1, { media_id: 'm', likers: [me('ann'), me('bob')], commenters: [], now: '2026-09-27T20:00:00Z', today: '2026-09-28' })
    expect(day2.liked_on).toEqual({ ann: '2026-09-27', bob: '2026-09-28' })
  })
  it('an existing follower who comes back and likes a newer post gets a new line, and is active again', () => {
    const rows = buildPeople({
      followers: [{ username: 'loyal', full_name: null, profile_pic: null, is_private: false, is_verified: false, first_seen_at: null, gone_at: null }],
      posts: [
        { item_id: 'a', title: 'Old reel', href: null, day: '2026-09-10', likers: ['loyal'], commenters: [], people: {}, liked_on: { loyal: '2026-09-11' } },
        { item_id: 'b', title: 'New reel', href: null, day: '2026-09-25', likers: ['loyal'], commenters: [], people: {}, liked_on: { loyal: '2026-09-27' } },
      ],
      inbox: [],
    }).map(p => crmRow(p))
    const r = rows[0]
    expect(r.likes).toBe(2)
    expect(r.timeline.map(e => `${e.what} ${e.detail} ${e.day}`)).toEqual(['Liked a post New reel 2026-09-27', 'Liked a post Old reel 2026-09-11'])
    expect(r.last_active).toBe('2026-09-27')
    expect(r.status).toBe('liked')
  })
})

describe('handles with a dot save (28 Sep 2026: Jordan\'s likes failed with a 400)', () => {
  it('people and liked_on go to the database encoded, and come back plain', async () => {
    const { mergeInteractors, interactorsForStorage, readInteractors } = await import('../app/lib/followers-core')
    const me = (u: string) => ({ username: u, full_name: null, profile_pic: null })
    const merged = mergeInteractors(null, { media_id: 'm', likers: [me('s.jkani'), me('manal.rzn')], commenters: [], now: '2026-09-28T06:00:00Z', today: '2026-09-28' })
    const stored = interactorsForStorage(merged)
    for (const k of [...Object.keys(stored.people), ...Object.keys(stored.liked_on ?? {})]) expect(k).not.toMatch(/[.#$[\]/]/)
    const back = readInteractors(JSON.parse(JSON.stringify(stored)))!
    expect(Object.keys(back.people).sort()).toEqual(['manal.rzn', 's.jkani'])
    expect(back.liked_on).toEqual({ 's.jkani': '2026-09-28', 'manal.rzn': '2026-09-28' })
  })
  it('every write of the record goes through the encoder', () => {
    const lib = readFileSync('app/lib/post-interactors.ts', 'utf8')
    expect(lib.match(/interactors: interactorsForStorage\(/g)?.length).toBe(4)
  })
})
