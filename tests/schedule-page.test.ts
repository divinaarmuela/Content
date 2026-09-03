import { describe, expect, it } from 'vitest'
import {
  dayKeyOfUtc, layoutLanes, monthLabel, rangeLabel, shiftDays, shiftMonths,
} from '@/app/dashboard/social/schedule/week-nav'
import { filterMedia, RAIL_FILTERS, type RailFilter } from '@/app/dashboard/social/schedule/MediaRail'
import {
  initialsOf, NETWORK_ORDER, profileSlots, PUBLISHABLE_NETWORKS, VIEWS,
} from '@/app/dashboard/social/schedule/ProfilesBar'
import { STATUS_WORDS } from '@/app/dashboard/social/schedule/tiles'
import {
  jobsForPost, matchesChannel, nowLineTop, onOneOfDays, postPlatforms,
  postTileFacts, scheduleWeekGrid, SOCIAL_POST_STATUSES, tileTone,
  type TileJob,
} from '@/app/lib/social-schedule-core'
import type { RailMedia } from '@/app/dashboard/social/schedule/useSchedulePosts'
import type { SocialAccount } from '@/lib/db-types'

/**
 * The Schedule page's own decisions — the ones that are rules rather than
 * pixels: which week you are looking at, what the rail's filters mean, and
 * that every status a post can be in has words for a person.
 *
 * The grid maths itself is `social-schedule-core` and is tested there; this
 * file only pins what the page adds on top of it.
 */

describe('paging through weeks', () => {
  it('steps seven days on a plain week', () => {
    expect(shiftDays('2026-09-07', 7)).toBe('2026-09-14')
    expect(shiftDays('2026-09-07', -7)).toBe('2026-08-31')
  })

  it('steps seven days across the weekend the clocks change', () => {
    // Melbourne's DST start, 2026-10-04: a week is still seven days because
    // the key is stepped in UTC, never by adding hours to an instant
    expect(shiftDays('2026-09-28', 7)).toBe('2026-10-05')
  })

  it('leaves a key it cannot read alone rather than inventing a date', () => {
    expect(shiftDays('not-a-day', 7)).toBe('not-a-day')
  })

  it('names a day from a UTC instant', () => {
    expect(dayKeyOfUtc(Date.UTC(2026, 8, 7))).toBe('2026-09-07')
  })
})

describe('the week on screen has a name', () => {
  const week = (from: [number, number, number], to: [number, number, number]) => [
    { year: from[0], month: from[1], day: from[2] },
    { year: to[0], month: to[1], day: to[2] },
  ]

  it('says the month once when the week sits inside one', () => {
    expect(rangeLabel(week([2026, 9, 7], [2026, 9, 13]))).toBe('7 – 13 September 2026')
  })

  it('says both months when the week crosses one', () => {
    expect(rangeLabel(week([2026, 8, 31], [2026, 9, 6]))).toBe('31 August – 6 September 2026')
  })

  it('says both years at new year', () => {
    expect(rangeLabel(week([2026, 12, 28], [2027, 1, 3])))
      .toBe('28 December 2026 – 3 January 2027')
  })

  it('says nothing rather than half a range with no days', () => {
    expect(rangeLabel([])).toBe('')
  })
})

describe('the media rail filters', () => {
  const media = (over: Partial<RailMedia>): RailMedia => ({
    itemId: 'i1', title: 'A piece', contentType: 'static',
    slides: [], cover: { url: 'u', name: 'n', type: 'image' },
    ok: true, reason: null, used: false, knownUrls: [],
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  })
  const photo = media({ itemId: 'photo' })
  const video = media({ itemId: 'video', cover: { url: 'u', name: 'n', type: 'video' } })
  const usedPhoto = media({ itemId: 'used', used: true })
  const all = [photo, video, usedPhoto]
  const filters = (...f: RailFilter[]) => new Set<RailFilter>(f)

  it('shows everything when nothing is chosen', () => {
    expect(filterMedia(all, filters(), new Set())).toHaveLength(3)
  })

  it('"Unused" drops what a post already uses — one post, one item', () => {
    expect(filterMedia(all, filters('Unused'), new Set()).map(m => m.itemId))
      .toEqual(['photo', 'video'])
  })

  it('"Photos" and "Videos" each keep their own kind', () => {
    expect(filterMedia(all, filters('Photos'), new Set()).map(m => m.itemId))
      .toEqual(['photo', 'used'])
    expect(filterMedia(all, filters('Videos'), new Set()).map(m => m.itemId))
      .toEqual(['video'])
  })

  it('choosing both kinds means both, not neither', () => {
    expect(filterMedia(all, filters('Photos', 'Videos'), new Set())).toHaveLength(3)
  })

  it('"Starred" is this person\'s own shortlist', () => {
    expect(filterMedia(all, filters('Starred'), new Set(['video'])).map(m => m.itemId))
      .toEqual(['video'])
  })

  it('combines with the others rather than replacing them', () => {
    expect(filterMedia(all, filters('Starred', 'Unused'), new Set(['used', 'photo']))
      .map(m => m.itemId)).toEqual(['photo'])
  })

  it('offers exactly the four filters the design named', () => {
    expect([...RAIL_FILTERS]).toEqual(['Unused', 'Videos', 'Photos', 'Starred'])
  })
})

describe('what a person is told', () => {
  it('gives every status a post can be in plain words', () => {
    for (const status of SOCIAL_POST_STATUSES) {
      expect(STATUS_WORDS[status], status).toBeTruthy()
      expect(STATUS_WORDS[status], status).not.toMatch(/_/)
    }
  })

  it('never says "graphic" — a video is not a graphic', () => {
    for (const status of SOCIAL_POST_STATUSES) {
      expect(STATUS_WORDS[status].toLowerCase()).not.toContain('graphic')
    }
  })

  it('has a tone for every status, so no tile is drawn colourless by accident', () => {
    for (const status of SOCIAL_POST_STATUSES) {
      expect(tileTone(status), status).toBeTruthy()
    }
    // cancelled is deliberately quiet: it is history, not work
    expect(tileTone('cancelled')).toBe('muted')
  })

  it('offers the five views the design named, week among them', () => {
    expect([...VIEWS]).toEqual(['Stories', 'Preview', 'Week', 'Month', 'List'])
  })

  it('shortens a name to two letters for an avatar', () => {
    expect(initialsOf('Sui Kitchen')).toBe('SK')
    expect(initialsOf('  divina ')).toBe('D')
    expect(initialsOf('')).toBe('—')
  })
})

/* ── the join: post + item + jobs → one tile ────────────────────────────── */

describe('a tile is joined from the post, its item and ITS OWN jobs', () => {
  const approved = { status: 'approved_for_scheduling', posting_approval_state: 'approved' }
  const jobs = (...list: [string, string][]) =>
    new Map<string, TileJob>(list.map(([id, status]) => [id, { id, status }]))

  it('mirrors the item when the post has no jobs behind it', () => {
    const facts = postTileFacts(
      { item_id: 'i1', publish_job_ids: [] }, approved, jobs(), [])
    expect(facts.live_status).toBe('approved')
    expect(facts.tone).toBe('green')
  })

  it('follows the precedence table once there are jobs', () => {
    const table: [string[], string][] = [
      // still going out wins: one channel left to go means it has not happened
      [['queued', 'published'], 'scheduled'],
      [['failed', 'published'], 'failed'],
      [['published', 'published'], 'published'],
      [['cancelled', 'cancelled'], 'cancelled'],
    ]
    for (const [statuses, expected] of table) {
      const ids = statuses.map((_, i) => `j${i}`)
      const facts = postTileFacts(
        { item_id: 'i1', publish_job_ids: ids },
        approved,
        jobs(...statuses.map((s, i) => [`j${i}`, s] as [string, string])),
        [],
      )
      expect(facts.live_status, statuses.join('+')).toBe(expected)
    }
  })

  it('a post cancelled by a person reads cancelled even with no jobs', () => {
    const facts = postTileFacts(
      { item_id: 'i1', status: 'cancelled', publish_job_ids: [] }, approved, jobs(), [])
    expect(facts.live_status).toBe('cancelled')
    expect(facts.tone).toBe('muted')
  })

  it('THE CANCELLED-THEN-REMADE CASE: the old job never speaks for the new post', () => {
    // Tuesday's post was cancelled — its publish job is `cancelled` and still
    // sits on the same item. Thursday's replacement carries no jobs at all.
    // Matching jobs by ITEM would read "every job cancelled" and draw a
    // brand-new draft as cancelled, which is the bug `jobsOf` was written to
    // kill on the server.
    const oldJob = jobs(['old-job', 'cancelled'])
    const remade = { item_id: 'i1', publish_job_ids: [] as string[] }
    expect(jobsForPost(remade, oldJob)).toEqual([])
    expect(postTileFacts(remade, approved, oldJob, []).live_status).toBe('approved')
    // and the post that DID own that job still reads cancelled
    const cancelled = { item_id: 'i1', publish_job_ids: ['old-job'] }
    expect(postTileFacts(cancelled, approved, oldJob, []).live_status).toBe('cancelled')
  })

  it('ignores a job id it cannot find rather than inventing a status', () => {
    expect(jobsForPost({ publish_job_ids: ['gone'] }, jobs(['other', 'failed']))).toEqual([])
  })

  it('carries the block reason the server would refuse with', () => {
    const waiting = { status: 'approved_for_scheduling', posting_approval_state: 'pending' }
    expect(postTileFacts({ item_id: 'i1' }, waiting, jobs(), []).block_reason).toBeTruthy()
    expect(postTileFacts({ item_id: 'i1' }, approved, jobs(), []).block_reason).toBeNull()
  })
})

describe('a badge is a network, never an account id', () => {
  const accounts = [
    { id: 'acc-1', platform: 'instagram' },
    { id: 'acc-2', platform: 'tiktok' },
  ]

  it('resolves the stored account ids to their networks', () => {
    expect(postPlatforms(['acc-2', 'acc-1'], accounts)).toEqual(['tiktok', 'instagram'])
  })

  it('takes a legacy row that stored the platform name at its word', () => {
    expect(postPlatforms(['instagram'], accounts)).toEqual(['instagram'])
  })

  it('drops an id it cannot resolve rather than drawing it as a logo', () => {
    expect(postPlatforms(['7f3a1c02-dead-beef', 'acc-1'], accounts)).toEqual(['instagram'])
  })

  it('says each network once, however many accounts are on it', () => {
    expect(postPlatforms(['acc-1', 'acc-3'], [...accounts, { id: 'acc-3', platform: 'instagram' }]))
      .toEqual(['instagram'])
  })
})

/* ── what is on screen ──────────────────────────────────────────────────── */

describe('the week filter', () => {
  const week = new Set(['2026-09-07', '2026-09-08', '2026-09-09'])
  const tz = 'Australia/Melbourne'

  it('keeps a post that lands on one of the days in the CLIENT zone', () => {
    // 22:00 UTC on the 7th is 08:00 on the 8th in Melbourne — the audience's
    // day is the one that decides
    expect(onOneOfDays('2026-09-07T22:00:00.000Z', tz, week)).toBe(true)
  })

  it('drops a post outside the days on screen', () => {
    expect(onOneOfDays('2026-09-20T02:00:00.000Z', tz, week)).toBe(false)
  })

  it('drops a post with no time yet — it has no day to sit on', () => {
    expect(onOneOfDays(null, tz, week)).toBe(false)
  })
})

describe('the channel filter', () => {
  const insta = { id: 'acc-1', platform: 'instagram' }

  it('shows everything when no profile is selected', () => {
    expect(matchesChannel(['acc-2'], null)).toBe(true)
  })

  it('matches the account the post was actually written for', () => {
    expect(matchesChannel(['acc-1', 'acc-2'], insta)).toBe(true)
    expect(matchesChannel(['acc-2'], insta)).toBe(false)
  })

  it('still finds a legacy post that stored the platform name', () => {
    expect(matchesChannel(['instagram'], insta)).toBe(true)
  })
})

describe('the now-line', () => {
  const grid = scheduleWeekGrid({ start: '2026-09-09', tz: 'Australia/Melbourne' })

  it('sits at the top of the hours at 6am, measured from the header', () => {
    // 6am Melbourne on 9 Sep 2026 (AEST, +10) = 20:00 UTC the day before
    expect(nowLineTop(grid, '2026-09-08T20:00:00.000Z')).toBe(grid.headerPx)
  })

  it('moves down one row an hour', () => {
    expect(nowLineTop(grid, '2026-09-08T21:00:00.000Z')).toBe(grid.headerPx + grid.rowPx)
    expect(nowLineTop(grid, '2026-09-08T21:30:00.000Z')).toBe(grid.headerPx + grid.rowPx * 1.5)
  })

  it('is not drawn at all before the day starts or after it ends', () => {
    expect(nowLineTop(grid, '2026-09-08T18:00:00.000Z')).toBeNull()   // 4am
    expect(nowLineTop(grid, '2026-09-09T12:00:00.000Z')).toBeNull()   // 10pm
  })

  it('is in the client zone, not the reader one', () => {
    const perth = scheduleWeekGrid({ start: '2026-09-09', tz: 'Australia/Perth' })
    // the same instant is 6am in Melbourne and 4am in Perth: on the page, one
    // has a line and the other does not
    expect(nowLineTop(grid, '2026-09-08T20:00:00.000Z')).not.toBeNull()
    expect(nowLineTop(perth, '2026-09-08T20:00:00.000Z')).toBeNull()
  })
})

/* ── two posts at the same time ─────────────────────────────────────────── */

describe('overlapping tiles share the column', () => {
  it('leaves a lone post the full width', () => {
    const { placed, overflow } = layoutLanes([{ id: 'a', top: 100 }])
    expect(placed).toEqual([{ id: 'a', lane: 0, lanes: 1 }])
    expect(overflow).toEqual([])
  })

  it('puts two posts at the same time side by side, both reachable', () => {
    const { placed } = layoutLanes([{ id: 'a', top: 100 }, { id: 'b', top: 100 }])
    expect(placed).toEqual([
      { id: 'a', lane: 0, lanes: 2 },
      { id: 'b', lane: 1, lanes: 2 },
    ])
  })

  it('gives a post an hour later the full width again', () => {
    const { placed } = layoutLanes([{ id: 'a', top: 100 }, { id: 'b', top: 300 }])
    expect(placed.map(p => p.lanes)).toEqual([1, 1])
  })

  it('counts the ones past the third rather than hiding them silently', () => {
    const { placed, overflow } = layoutLanes(
      [0, 1, 2, 3, 4].map(i => ({ id: `p${i}`, top: 100 })))
    expect(placed).toHaveLength(3)
    expect(overflow).toEqual([{ top: 100, count: 2 }])
  })

  it('reuses a lane once its tile has finished', () => {
    // 100 and 180 do not overlap (a tile is 80 tall), so they share lane 0
    const { placed } = layoutLanes(
      [{ id: 'a', top: 100 }, { id: 'b', top: 120 }, { id: 'c', top: 180 }])
    expect(placed.find(p => p.id === 'c')?.lane).toBe(0)
  })
})

/* ── the profiles bar ───────────────────────────────────────────────────── */

describe('the profiles bar shows every network we can post to', () => {
  const account = (id: string, platform: string, over: Partial<SocialAccount> = {}) => ({
    id, platform, active: true, client_id: 'c1', provider_account_id: id,
    name: null, username: null, avatar_url: null,
    connected_at: '', last_synced_at: '', ...over,
  } as SocialAccount)

  it('covers exactly the platforms the publisher supports', () => {
    expect([...NETWORK_ORDER].sort()).toEqual([...PUBLISHABLE_NETWORKS].sort())
  })

  it('draws one slot per network when nothing is connected', () => {
    const slots = profileSlots([])
    expect(slots).toHaveLength(NETWORK_ORDER.length)
    expect(slots.every(s => s.kind === 'empty')).toBe(true)
  })

  it('keeps the order fixed whatever this client happens to have', () => {
    expect(profileSlots([account('a', 'linkedin')]).map(s => s.platform))
      .toEqual([...NETWORK_ORDER])
  })

  it('gives two accounts on one network two slots', () => {
    const slots = profileSlots([account('a', 'instagram'), account('b', 'instagram')])
    const insta = slots.filter(s => s.platform === 'instagram')
    expect(insta).toHaveLength(2)
    expect(insta.every(s => s.kind === 'account')).toBe(true)
    // and the networks with nobody on them are still there to connect
    expect(slots).toHaveLength(NETWORK_ORDER.length + 1)
  })

  it('leaves a disconnected account out — its network reads as empty', () => {
    const slots = profileSlots([account('a', 'tiktok', { active: false })])
    expect(slots.find(s => s.platform === 'tiktok')?.kind).toBe('empty')
  })
})

/* ── paging by month ────────────────────────────────────────────────────── */

describe('Month view pages by month', () => {
  it('steps a whole month, not seven days', () => {
    expect(shiftMonths('2026-09-09', 1)).toBe('2026-10-09')
    expect(shiftMonths('2026-09-09', -1)).toBe('2026-08-09')
  })

  it('clamps rather than rolling over the end of a short month', () => {
    expect(shiftMonths('2026-01-31', 1)).toBe('2026-02-28')
  })

  it('crosses the year', () => {
    expect(shiftMonths('2026-12-15', 1)).toBe('2027-01-15')
  })

  it('names the month on the date bar', () => {
    expect(monthLabel('2026-09-09')).toBe('September 2026')
    expect(monthLabel('nonsense')).toBe('')
  })
})
