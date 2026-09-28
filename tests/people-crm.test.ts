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
