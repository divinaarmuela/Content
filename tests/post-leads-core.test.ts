import { describe, expect, it } from 'vitest'
import type { PeopleRow } from '../app/lib/people-analytics-core'
import { creditedPost, leadCounts, leadsForPost, leadsSummary, verdictFor } from '../app/lib/post-leads-core'

const person = (over: Partial<PeopleRow> & { username: string }): PeopleRow => ({
  key: over.username.toLowerCase(), full_name: null, profile_pic: null, is_private: false, is_verified: false,
  profile_href: '', actions: [], followed_on: null, gone_on: null,
  from_us: { likely: false, title: null, day: null }, reached_out_on: null, reached_out_how: null, inbox_href: '',
  ...over,
})
const touched = (kind: 'liked' | 'commented' | 'liked and commented' = 'liked', item = 'item-1', day = '2026-09-08') =>
  ({ kind, item_id: item, title: item === 'item-1' ? 'Reel' : 'Other', href: null, day })

/* ── who a post brought in (8 Sep 2026) ─────────────────────────────── */

describe('the verdict', () => {
  const on = (followed_on: string | null, gone_on: string | null = null) => ({ followed_on, gone_on })
  it('a new follower on or after the post day, who touched the post, is a lead', () => {
    expect(verdictFor({ person: on('2026-09-08'), following: true, reached: false, postDay: '2026-09-08' })).toBe('lead')
    expect(verdictFor({ person: on('2026-09-10'), following: true, reached: true, postDay: '2026-09-08' })).toBe('lead')
  })
  it('a follower from before the post is existing — and so is one from the first read', () => {
    expect(verdictFor({ person: on('2026-09-01'), following: true, reached: false, postDay: '2026-09-08' })).toBe('existing')
    expect(verdictFor({ person: on(null), following: true, reached: false, postDay: '2026-09-08' })).toBe('existing')
  })
  it('somebody who wrote in since the post, but is not new, reached out', () => {
    expect(verdictFor({ person: on('2026-09-01'), following: true, reached: true, postDay: '2026-09-08' })).toBe('reached_out')
    expect(verdictFor({ person: on(null), following: false, reached: true, postDay: '2026-09-08' })).toBe('reached_out')
  })
  it('not following, and gone', () => {
    expect(verdictFor({ person: on(null), following: false, reached: false, postDay: '2026-09-08' })).toBe('not_following')
    expect(verdictFor({ person: on('2026-09-01', '2026-09-09'), following: false, reached: false, postDay: '2026-09-08' })).toBe('left')
  })
  it('a post that never went out credits nobody', () => {
    expect(verdictFor({ person: on('2026-09-08'), following: true, reached: false, postDay: null })).toBe('existing')
  })
  it('a new follower credited to a LATER post is not this post’s lead', () => {
    expect(verdictFor({ person: on('2026-09-12'), following: true, reached: false, postDay: '2026-09-08', itemId: 'item-1', creditedItemId: 'item-2' })).toBe('other_post')
    expect(verdictFor({ person: on('2026-09-12'), following: true, reached: false, postDay: '2026-09-08', itemId: 'item-1', creditedItemId: 'item-1' })).toBe('lead')
  })
})

describe('creditedPost — the last post they touched before following', () => {
  it('picks the latest post on or before the follow day', () => {
    const p = person({ username: 'a', followed_on: '2026-09-12', actions: [touched('liked', 'item-1', '2026-09-08'), touched('liked', 'item-2', '2026-09-11'), touched('liked', 'item-3', '2026-09-13')] })
    expect(creditedPost(p)?.item_id).toBe('item-2')
  })
  it('nothing for somebody who never followed', () => {
    expect(creditedPost(person({ username: 'a', actions: [touched()] }))).toBeNull()
  })
})

describe('leadsForPost', () => {
  const rows = [
    person({ username: 'newbie', actions: [touched()], followed_on: '2026-09-09' }),
    person({ username: 'fan', actions: [touched('commented')], followed_on: '2026-08-01' }),
    person({ username: 'writer', actions: [touched()], followed_on: '2026-08-01', reached_out_on: '2026-09-09', reached_out_how: 'message' }),
    person({ username: 'oldnote', actions: [touched()], followed_on: '2026-08-01', reached_out_on: '2026-08-20', reached_out_how: 'message' }),
    person({ username: 'passer', actions: [touched()] }),
    // touched this post, then a later one, THEN followed — the later post's lead
    person({ username: 'later', actions: [touched(), touched('liked', 'item-2', '2026-09-11')], followed_on: '2026-09-12' }),
    // only ever touched another post — not on this page at all
    person({ username: 'elsewhere', actions: [touched('liked', 'item-2', '2026-09-01')], followed_on: '2026-09-09' }),
  ]
  const followerKeys = new Set(['newbie', 'fan', 'writer', 'oldnote', 'later'])
  const out = leadsForPost({ rows, itemId: 'item-1', postDay: '2026-09-08', followerKeys })

  it('keeps only the people who touched THIS post', () => {
    expect(out.map(r => r.person.username)).not.toContain('elsewhere')
    expect(out).toHaveLength(6)
  })
  it('judges each, leads first', () => {
    expect(out.map(r => [r.person.username, r.verdict])).toEqual([
      ['newbie', 'lead'], ['writer', 'reached_out'], ['later', 'other_post'],
      ['fan', 'existing'], ['oldnote', 'existing'], ['passer', 'not_following'],
    ])
  })
  it('a note from before the post is not "reached out" for this post', () => {
    expect(out.find(r => r.person.username === 'oldnote')?.reached).toBe(false)
    expect(out.find(r => r.person.username === 'writer')?.reached).toBe(true)
  })
  it('carries what they did on this post', () => {
    expect(out.find(r => r.person.username === 'fan')?.did).toBe('commented')
  })
  it('counts and says it plainly', () => {
    const counts = leadCounts(out)
    expect(counts).toEqual({ all: 6, lead: 1, other_post: 1, reached_out: 1, existing: 2, not_following: 1, left: 0 })
    expect(leadsSummary(counts, '2026-09-08')).toBe('6 people touched this post: 1 new follower it can be credited with, 1 reached out, 2 already following, 1 not following.')
    expect(leadsSummary(leadCounts([]), null)).toMatch(/not gone out yet/)
    expect(leadsSummary(leadCounts([]), '2026-09-08')).toMatch(/Read who liked now/)
  })
})
