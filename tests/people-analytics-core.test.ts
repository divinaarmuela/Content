import { describe, expect, it } from 'vitest'
import {
  buildPeople, csvFilename, dayOfInstant, emptyLine, firstDirFor, foldTouches, followedWordsFor,
  fromUsWords, inboxPersonHref, inPeriod, instagramProfileHref, likelyFromUs, matchesPerson,
  nextTouch, peopleCounts, peopleCsv, reachedOutWords, sinceDay, sortPeople, touchesFromComments,
  touchesFromConversations, touchHandle, viewPeople, whatTheyDidWords, actionWords,
  type PeopleFollower, type PeoplePost, type InboxTouch,
} from '../app/lib/people-analytics-core'

/**
 * The join, the rule, the counts and the download — the whole pure half of
 * the People table. The rule is the one that matters: "likely from us" is a
 * claim about two soft dates, and the tests here are what stop it quietly
 * becoming a claim about causation.
 */

const follower = (over: Partial<PeopleFollower> & { username: string }): PeopleFollower => ({
  full_name: null, profile_pic: null, is_private: false, is_verified: false,
  first_seen_at: null, gone_at: null, ...over,
})

const post = (over: Partial<PeoplePost> & { title: string }): PeoplePost => ({
  item_id: over.title, href: `/dashboard/social/posts/${over.title}`, day: '2026-09-01',
  likers: [], commenters: [], people: {}, ...over,
})

describe('addresses', () => {
  it('links a handle to their Instagram profile', () => {
    expect(instagramProfileHref('@Mika')).toBe('https://www.instagram.com/Mika/')
  })
  it('links a handle into the Inbox, filtered to them', () => {
    expect(inboxPersonHref('mika')).toBe('/dashboard/social/inbox?who=mika')
  })
})

describe('the join', () => {
  const rows = buildPeople({
    followers: [
      follower({ username: 'Mika', full_name: 'Mika R', first_seen_at: '2026-09-03' }),
      follower({ username: 'quietone', first_seen_at: '2026-09-05' }),
      follower({ username: 'oldtimer', first_seen_at: null }),
      follower({ username: 'leaver', first_seen_at: '2026-08-01', gone_at: '2026-09-04' }),
    ],
    posts: [
      post({ title: 'Hero reel', day: '2026-09-01', likers: ['mika', 'oldtimer'], commenters: ['mika'],
        people: { mika: { username: 'Mika', full_name: 'Mika R', profile_pic: 'https://x/p.jpg' } } }),
      post({ title: 'Menu carousel', day: '2026-09-08', likers: ['mika'], commenters: ['stranger'] }),
    ],
    inbox: [{ username: 'mika', name: 'Mika R', kind: 'message', last_at: '2026-09-06T02:00:00Z' }],
  })
  const at = (u: string) => rows.find(r => r.key === u)!

  it('is the union of everybody, not the intersection', () => {
    expect(rows.map(r => r.key).sort()).toEqual(
      ['leaver', 'mika', 'oldtimer', 'quietone', 'stranger'])
  })

  it('keeps a person who only ever liked something', () => {
    expect(at('stranger').followed_on).toBeNull()
    expect(at('stranger').actions).toHaveLength(1)
  })

  it('folds a like and a comment on the same post into one line', () => {
    expect(at('mika').actions.map(a => a.kind)).toEqual(['liked', 'liked and commented'])
  })

  it('shows a person’s actions newest first', () => {
    expect(at('mika').actions.map(a => a.title)).toEqual(['Menu carousel', 'Hero reel'])
  })

  it('takes the face from whichever list carried one', () => {
    expect(at('mika').profile_pic).toBe('https://x/p.jpg')
    expect(at('mika').full_name).toBe('Mika R')
  })

  it('carries the day somebody left', () => {
    expect(at('leaver').gone_on).toBe('2026-09-04')
  })

  it('records the last day somebody was seen in the Inbox', () => {
    expect(at('mika').reached_out_on).toBe('2026-09-06')
    expect(at('quietone').reached_out_on).toBeNull()
  })

  it('orders the newest follower first, and a person with no follow day last', () => {
    expect(rows[0].key).toBe('quietone')
    expect(rows.at(-1)!.key).toBe('stranger')
  })
})

describe('the “likely from us” rule', () => {
  const acted = (day: string | null, title = 'Hero reel') => ({ title, day })

  it('is likely when the post went out before the follow', () => {
    const v = likelyFromUs('2026-09-05', [acted('2026-09-01')])
    expect(v).toEqual({ likely: true, title: 'Hero reel', day: '2026-09-01' })
  })

  it('is likely on the same day — the platform gives no finer resolution', () => {
    expect(likelyFromUs('2026-09-05', [acted('2026-09-05')]).likely).toBe(true)
  })

  it('is NOT likely when the interaction came after the follow', () => {
    expect(likelyFromUs('2026-09-05', [acted('2026-09-06')]).likely).toBe(false)
  })

  it('is never likely for somebody who was already following', () => {
    expect(likelyFromUs(null, [acted('2026-09-01')]).likely).toBe(false)
  })

  it('ignores an interaction whose post never published', () => {
    expect(likelyFromUs('2026-09-05', [acted(null)]).likely).toBe(false)
  })

  it('names the LAST post before the follow, the one closest to it', () => {
    const v = likelyFromUs('2026-09-10', [acted('2026-09-01', 'Hero reel'), acted('2026-09-08', 'Menu carousel')])
    expect(v.title).toBe('Menu carousel')
  })

  it('never says more than “Likely”', () => {
    const words = fromUsWords({ likely: true, title: 'Hero reel', day: '2026-09-01' })
    expect(words).toBe('Likely — after ‘Hero reel’')
    expect(words).not.toMatch(/came from|because of|caused/i)
  })

  it('says nothing at all when it is not likely', () => {
    expect(fromUsWords({ likely: false, title: null, day: null })).toBe('—')
  })
})

describe('the period', () => {
  it('counts back from today, inclusive', () => {
    expect(sinceDay('2026-09-30', 30)).toBe('2026-09-01')
    expect(sinceDay('2026-09-30', 90)).toBe('2026-07-03')
    expect(sinceDay('2026-09-30', null)).toBeNull()
  })

  const row = buildPeople({
    followers: [follower({ username: 'mika', first_seen_at: '2026-08-01' })],
    posts: [], inbox: [],
  })[0]

  it('keeps a person whose follow is inside it', () => {
    expect(inPeriod(row, '2026-07-01')).toBe(true)
  })
  it('drops a person nothing happened about', () => {
    expect(inPeriod(row, '2026-09-01')).toBe(false)
  })
  it('keeps everybody when the period is all time', () => {
    expect(inPeriod(row, null)).toBe(true)
  })
})

describe('the four counts', () => {
  const rows = buildPeople({
    followers: [
      follower({ username: 'mika', first_seen_at: '2026-09-03' }),
      follower({ username: 'quietone', first_seen_at: '2026-09-05' }),
      follower({ username: 'oldtimer', first_seen_at: null }),
    ],
    posts: [post({ title: 'Hero reel', day: '2026-09-01', likers: ['mika', 'oldtimer'] })],
    inbox: [{ username: 'quietone', name: null, kind: 'comment', last_at: '2026-09-06T00:00:00Z' }],
  })
  const counts = peopleCounts(rows, [{ day: '2026-09-01' }, { day: '2026-08-01' }], '2026-09-01')

  it('counts only follows whose day falls inside the period', () => {
    expect(counts.followersGained).toBe(2)
  })
  it('counts how many of those engaged with a post first', () => {
    expect(counts.interactedFirst).toBe(1)
  })
  it('counts who has been in the Inbox', () => {
    expect(counts.reachedOut).toBe(1)
  })
  it('counts the posts that went out in the period', () => {
    expect(counts.postsPublished).toBe(1)
  })
  it('an all-time period counts everything datable', () => {
    expect(peopleCounts(rows, [{ day: null }], null).followersGained).toBe(2)
  })
})

describe('search and sort', () => {
  const rows = buildPeople({
    followers: [
      follower({ username: 'zoe', full_name: 'Zoe Kim', first_seen_at: '2026-09-01' }),
      follower({ username: 'amy', full_name: 'Amy Lee', first_seen_at: '2026-09-09' }),
    ],
    posts: [post({ title: 'Hero reel', likers: ['amy'] })],
    inbox: [],
  })

  it('searches the handle and the name, @ and case blind', () => {
    expect(matchesPerson(rows[0], '@AM')).toBe(rows[0].key === 'amy')
    expect(rows.filter(r => matchesPerson(r, 'kim')).map(r => r.key)).toEqual(['zoe'])
    expect(rows.every(r => matchesPerson(r, '  '))).toBe(true)
  })

  it('sorts by handle A–Z', () => {
    expect(sortPeople(rows, 'person', 'asc').map(r => r.key)).toEqual(['amy', 'zoe'])
    expect(sortPeople(rows, 'person', 'desc').map(r => r.key)).toEqual(['zoe', 'amy'])
  })

  it('sorts by the follow day, newest first', () => {
    expect(sortPeople(rows, 'followed', 'desc').map(r => r.key)).toEqual(['amy', 'zoe'])
  })

  it('opens a date column newest-first and a name column A–Z', () => {
    expect(firstDirFor('followed')).toBe('desc')
    expect(firstDirFor('person')).toBe('asc')
  })

  it('filters, searches and orders in one pass', () => {
    const out = viewPeople(rows, { since: '2026-09-05', q: '', sort: 'person', dir: 'asc' })
    expect(out.map(r => r.key)).toEqual(['amy'])
  })
})

describe('the words', () => {
  it('says what somebody did in plain words', () => {
    expect(actionWords({ kind: 'liked', title: 'Hero reel' })).toBe('liked Hero reel')
    expect(actionWords({ kind: 'commented', title: 'Menu carousel' })).toBe('commented on Menu carousel')
    expect(actionWords({ kind: 'liked and commented', title: 'Hero reel' })).toBe('liked and commented on Hero reel')
  })

  it('counts the rest rather than listing them', () => {
    expect(whatTheyDidWords([
      { kind: 'liked', title: 'A', href: null, item_id: null, day: '2026-09-02' },
      { kind: 'liked', title: 'B', href: null, item_id: null, day: '2026-09-01' },
    ])).toBe('liked A · 1 more')
    expect(whatTheyDidWords([])).toBe('—')
  })

  it('spells the follow day, and says when somebody left', () => {
    expect(followedWordsFor({ followed_on: '2026-09-05', gone_on: null })).toBe('5 Sep')
    expect(followedWordsFor({ followed_on: '2026-09-05', gone_on: '2026-09-09' })).toBe('5 Sep, left 9 Sep')
    expect(followedWordsFor({ followed_on: null, gone_on: null })).toBe('—')
  })

  it('says when and how somebody reached out', () => {
    expect(reachedOutWords({ reached_out_on: '2026-09-06', reached_out_how: 'message' })).toBe('6 Sep — messaged')
    expect(reachedOutWords({ reached_out_on: '2026-09-06', reached_out_how: 'both' })).toBe('6 Sep — messaged and commented')
    expect(reachedOutWords({ reached_out_on: null, reached_out_how: null })).toBe('—')
  })

  it('has a line for every kind of empty, and never a blank', () => {
    for (const state of ['pick_client', 'not_instagram', 'off', 'private', 'waiting', 'ready'] as const) {
      expect(emptyLine(state, 'Sui Kitchen').length).toBeGreaterThan(10)
    }
    expect(emptyLine('private', null)).toContain('private')
  })
})

describe('the download', () => {
  const rows = buildPeople({
    followers: [follower({ username: 'mika', full_name: 'Mika, R "the one"', first_seen_at: '2026-09-05' })],
    posts: [post({ title: 'Hero reel', day: '2026-09-01', likers: ['mika'] })],
    inbox: [{ username: 'mika', name: null, kind: 'message', last_at: '2026-09-06T00:00:00Z' }],
  })
  const csv = peopleCsv(rows)

  it('starts with the column names people see', () => {
    expect(csv.split('\r\n')[0]).toBe('Handle,Name,What they did,Followed,Left,From MD Media,Reached out,Profile')
  })

  it('quotes a name with a comma and doubles its quotes', () => {
    expect(csv).toContain('"Mika, R ""the one"""')
  })

  it('carries the same claim the screen makes, no stronger', () => {
    expect(csv).toContain('Likely — after ‘Hero reel’')
  })

  it('names the file after the client and the day', () => {
    expect(csvFilename('Sui Kitchen', '2026-09-07')).toBe('people-sui-kitchen-2026-09-07.csv')
    expect(csvFilename(null, '2026-09-07')).toBe('people-clients-2026-09-07.csv')
  })
})

describe('reading the Inbox’s own answers', () => {
  it('reads DM threads however they are wrapped', () => {
    const seen = touchesFromConversations({
      data: [
        { id: 'c1', accountId: 'acc', participantUsername: 'mika', participantName: 'Mika R', updatedTime: '2026-09-06T00:00:00Z' },
        { id: 'c2', accountId: 'acc', participant: { username: 'zoe', name: 'Zoe' }, updatedTime: '2026-09-05T00:00:00Z' },
      ],
    })
    expect(seen.map(t => t.username)).toEqual(['mika', 'zoe'])
    expect(seen[0]).toMatchObject({ kind: 'message', conversation_id: 'c1', account_id: 'acc' })
  })

  it('answers “nobody” to a shape it does not recognise', () => {
    expect(touchesFromConversations(null)).toEqual([])
    expect(touchesFromConversations({ nothing: true })).toEqual([])
    expect(touchesFromComments('surprise', { accountId: null, postId: null })).toEqual([])
  })

  it('skips a thread with no handle rather than inventing one', () => {
    expect(touchesFromConversations([{ id: 'c1', updatedTime: 'x' }])).toEqual([])
  })

  it('reads comment authors, and never counts the client answering themselves', () => {
    const seen = touchesFromComments(
      { comments: [{ id: '1', username: 'mika', createdTime: '2026-09-06T00:00:00Z' }, { id: '2', from: { username: 'SuiKitchen' } }] },
      { accountId: 'acc', postId: 'p1', ours: ['suikitchen'] })
    expect(seen.map(t => t.username)).toEqual(['mika'])
    expect(seen[0]).toMatchObject({ kind: 'comment', post_id: 'p1' })
  })

  it('folds a page of repeats into one sighting per person', () => {
    const folded = foldTouches([
      { username: 'mika', name: null, kind: 'comment', at: '2026-09-01T00:00:00Z', conversation_id: null, post_id: 'p', account_id: 'a' },
      { username: 'Mika', name: 'Mika R', kind: 'message', at: '2026-09-06T00:00:00Z', conversation_id: 'c', post_id: null, account_id: 'a' },
    ])
    expect(folded).toHaveLength(1)
    expect(folded[0]).toMatchObject({ kind: 'both', at: '2026-09-06T00:00:00Z', name: 'Mika R' })
  })

  it('keeps the first and last day a person was seen', () => {
    const first = nextTouch(null, { kind: 'message', at: '2026-09-01T00:00:00Z', name: 'Mika' }, 'now')
    expect(first).toMatchObject({ first_at: '2026-09-01T00:00:00Z', last_at: '2026-09-01T00:00:00Z' })
    const then = nextTouch({ ...first, kind: 'message' }, { kind: 'comment', at: '2026-09-06T00:00:00Z', name: null }, 'now')
    expect(then).toMatchObject({ kind: 'both', first_at: '2026-09-01T00:00:00Z', last_at: '2026-09-06T00:00:00Z', name: 'Mika' })
  })

  it('falls back to now when the payload carried no time', () => {
    expect(nextTouch(null, { kind: 'message', at: null, name: null }, '2026-09-07T00:00:00Z').last_at)
      .toBe('2026-09-07T00:00:00Z')
  })

  it('keys a person by their handle, lower case and without the @', () => {
    expect(touchHandle('@Mika')).toBe('mika')
  })

  it('reads the day out of an instant, and refuses anything else', () => {
    expect(dayOfInstant('2026-09-06T02:00:00Z')).toBe('2026-09-06')
    expect(dayOfInstant('yesterday')).toBeNull()
    expect(dayOfInstant(null)).toBeNull()
  })

  it('takes the newest sighting when the Inbox names somebody twice', () => {
    const rows = buildPeople({
      followers: [],
      posts: [],
      inbox: [
        { username: 'mika', name: null, kind: 'comment', last_at: '2026-09-01T00:00:00Z' },
        { username: 'mika', name: 'Mika', kind: 'message', last_at: '2026-09-06T00:00:00Z' },
      ] satisfies InboxTouch[],
    })
    expect(rows[0].reached_out_on).toBe('2026-09-06')
    expect(rows[0].reached_out_how).toBe('both')
  })
})
