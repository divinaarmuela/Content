import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { seedDb } from './helpers/fake-db'
import {
  analyticsForPost, channelExtraLines, chartLabel, dayChart, likedLine, networkName,
  peopleFrom, portalPostHref, postPageHref, postStatusWords, shortDate, whoLikedNote,
} from '../app/lib/post-page-core'
import { CHANNEL_EXTRA_KEYS, extraLabel, extraValueWords } from '../app/lib/schedule-compose-core'

/**
 * A PAGE FOR EVERY POST.
 *
 * The four things a page like this gets wrong, pinned:
 *
 *   1. It starts fetching. The owner asked for a page nobody has to press
 *      anything on, reading only what the sweeps already store — so the page,
 *      its view and both server halves are swept for a `fetch`.
 *   2. It invents words. A previous attempt turned `firstComment` into
 *      "First Comment" with string munging; every name a channel's settings
 *      wear now comes from the composer's own option rows, and a field with
 *      no row is drawn as nothing rather than as a database key.
 *   3. It leaks names to a client who never asked for them. The portal page
 *      carries counts always and handles only when that client's Followers
 *      switch is on.
 *   4. The links into it go nowhere. The card, the board and Posts all point
 *      at the address the route actually lives at.
 */

const ROOT = join(__dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const DASH_PAGE = 'app/dashboard/social/posts/[id]/page.tsx'
const DASH_VIEW = 'app/dashboard/social/posts/[id]/PostView.tsx'
const DASH_GRAPH = 'app/dashboard/social/posts/[id]/DayGraph.tsx'
const PORTAL_PAGE = 'app/portal/[token]/post/[id]/page.tsx'
const SERVER = 'app/lib/post-page.ts'
const PORTAL_SERVER = 'app/lib/portal-post.ts'

/* ── the page exists, and asks nobody anything ─────────────────────────── */

describe('the post has a page of its own', () => {
  for (const file of [DASH_PAGE, DASH_VIEW, DASH_GRAPH, PORTAL_PAGE, SERVER, PORTAL_SERVER]) {
    it(`${file} is there`, () => {
      expect(existsSync(join(ROOT, file)), `${file} is missing`).toBe(true)
    })
  }

  it('the address the links use is the route on disk', () => {
    expect(postPageHref('p1')).toBe('/dashboard/social/posts/p1')
    expect(portalPostHref('tok', 'p1')).toBe('/portal/tok/post/p1')
    expect(existsSync(join(ROOT, DASH_PAGE))).toBe(true)
    expect(existsSync(join(ROOT, PORTAL_PAGE))).toBe(true)
  })

  it('nothing on either page fetches anything', () => {
    // no provider, no follower reader, no API of our own: every figure was
    // written by a sweep that already runs
    for (const file of [DASH_PAGE, DASH_VIEW, DASH_GRAPH, PORTAL_PAGE, SERVER, PORTAL_SERVER]) {
      const src = read(file)
      expect(src, `${file} fetches`).not.toMatch(/\bfetch\s*\(/)
      expect(src, `${file} names a host`).not.toMatch(/https?:\/\//)
    }
  })

  it('neither page names the service the names come from, nor shows money', () => {
    for (const file of [DASH_PAGE, DASH_VIEW, PORTAL_PAGE, PORTAL_SERVER]) {
      const src = read(file)
      expect(src).not.toMatch(/hiker|apify|scrap(e|er|ing)/i)
      expect(src).not.toMatch(/~\$|\$\d|USD|cost_note|\bcost\b/i)
    }
  })
})

/* ── the links in ──────────────────────────────────────────────────────── */

describe('the ways in', () => {
  it('the card’s How it did offers the full post', () => {
    const src = read('app/dashboard/production/[id]/HowItDid.tsx')
    expect(src).toContain('postPageHref')
    expect(src).toContain('See the full post')
  })

  it('the board card’s stats line is the link', () => {
    expect(read('app/dashboard/board/Board.tsx')).toContain('postPageHref')
    expect(read('app/dashboard/board/BoardCard.tsx')).toContain('statsHref')
  })

  it('a row on Posts offers it, and the list route hands the id over', () => {
    const page = read('app/dashboard/social/activity/page.tsx')
    expect(page).toContain('postPageHref')
    expect(page).toContain('See the full post')
    expect(read('app/api/social/publish/route.ts')).toContain('post_id')
  })

  it('the client’s Published card links to their version', () => {
    expect(read('app/components/portal/PortalBoard.tsx')).toContain('portalPostHref')
  })
})

/* ── which cached rows belong to this post ─────────────────────────────── */

describe('the rows this post owns', () => {
  const rows = [
    { publish_job_id: 'j1', item_id: 'i1', published_at: '2026-09-01' },
    { publish_job_id: 'j2', item_id: 'i1', published_at: '2026-09-03' },
    { publish_job_id: null, item_id: 'i1', published_at: '2026-08-01' },
  ]

  it('matches on the post’s own job ids, newest first', () => {
    const got = analyticsForPost(rows, { item_id: 'i1', publish_job_ids: ['j1', 'j2'] })
    expect(got.map(r => r.publish_job_id)).toEqual(['j2', 'j1'])
  })

  it('a cancelled post’s rows never speak for the new post on the same card', () => {
    expect(analyticsForPost(rows, { item_id: 'i1', publish_job_ids: ['j9'] })).toEqual([])
  })

  it('falls back to the card only for a post with no jobs of its own', () => {
    expect(analyticsForPost(rows, { item_id: 'i1', publish_job_ids: [] })).toHaveLength(3)
  })
})

/* ── the settings, in the composer's own words ─────────────────────────── */

describe('a channel’s settings are read back in the words they were set in', () => {
  it('every extra the composer can store has a name', () => {
    const unnamed = CHANNEL_EXTRA_KEYS.filter(k => extraLabel(k) === null)
    expect(unnamed, `these extras have no label: ${unnamed.join(', ')}`).toEqual([])
  })

  it('the name is the composer’s row, never the key pulled apart', () => {
    expect(extraLabel('firstComment')).toBe('Add first comment')
    expect(extraLabel('allowDuet', 'tiktok')).toBe('Allow duets')
    expect(extraLabel('videoMadeWithAi', 'tiktok')).toBe('Made with AI')
    // the one field two networks share reads as each network calls it
    expect(extraLabel('title', 'youtube')).toBe('Video title')
    expect(extraLabel('title', 'facebook')).toBe('Reel title')
  })

  it('a select reads as the sentence somebody picked, not the network’s code', () => {
    const words = extraValueWords('trialGraduation', 'SS_PERFORMANCE', 'instagram')
    expect(words).toBe('Show it to non-followers first — Instagram decides')
    expect(words).not.toContain('SS_PERFORMANCE')
  })

  it('ticks read as Yes and No, lists as their words, blanks as nothing', () => {
    expect(extraValueWords('allowComment', true, 'tiktok')).toBe('Yes')
    expect(extraValueWords('allowComment', false, 'tiktok')).toBe('No')
    expect(extraValueWords('tags', ['coffee', 'melbourne'], 'youtube')).toBe('coffee, melbourne')
    expect(extraValueWords('firstComment', '   ')).toBeNull()
    expect(extraValueWords('tags', [], 'youtube')).toBeNull()
  })

  it('the page draws label + value lines, and never the media or the caption', () => {
    const lines = channelExtraLines(
      { firstComment: '#coffee', allowDuet: false, caption: 'a different caption', slides: [] },
      'tiktok',
    )
    expect(lines.map(l => l.label)).toEqual(['Add first comment', 'Allow duets'])
    expect(lines.map(l => l.value)).toEqual(['#coffee', 'No'])
  })

  it('a field with no row is silence, not a database key on a page', () => {
    const lines = channelExtraLines({ notAThing: 'x' } as never, 'instagram')
    expect(lines).toEqual([])
  })
})

/* ── the words ─────────────────────────────────────────────────────────── */

describe('where the post got to, and the four kinds of nothing', () => {
  it('the three the owner named have their own headline', () => {
    expect(postStatusWords('published', { whenLabel: 'Fri 5 Sep, 9:00 am' }).headline).toBe('Posted')
    expect(postStatusWords('scheduled', { whenLabel: 'Fri 5 Sep, 9:00 am' }).headline).toBe('Booked in')
    const failed = postStatusWords('failed', { failure: 'Instagram refused the caption' })
    expect(failed.headline).toBe('Failed')
    expect(failed.detail).toBe('Instagram refused the caption')
  })

  it('a failure with no reason still says something', () => {
    expect(postStatusWords('failed').detail).toBeTruthy()
  })

  it('who liked is an Instagram-only question, said so by name', () => {
    expect(whoLikedNote('instagram')).toBeNull()
    expect(whoLikedNote('tiktok')).toContain('Likes aren’t available for TikTok')
  })

  it('the network wears its own name', () => {
    expect(networkName('tiktok')).toBe('TikTok')
    expect(networkName(null)).toBe('The platform')
  })

  it('counts read as sentences', () => {
    expect(likedLine(0)).toBeNull()
    expect(likedLine(1)).toBe('1 person liked it')
    expect(likedLine(4)).toBe('4 people liked it')
  })

  it('a handle with no face still becomes a person', () => {
    const people = peopleFrom({
      media_id: null, likers: ['ana', 'zeddix', 'ana'], commenters: [],
      people: { ana: { username: 'ana', full_name: 'Ana', profile_pic: null } },
      fetched_at: null, fetched_day: null, reads: 0, followed: [], status: 'done', error: null,
    }, 'likers')
    expect(people.map(p => p.username)).toEqual(['ana', 'zeddix'])
    expect(people[0].full_name).toBe('Ana')
  })
})

/* ── the graph ─────────────────────────────────────────────────────────── */

describe('the day-by-day graph', () => {
  const series = [
    { date: '2026-09-01', value: 4 },
    { date: '2026-09-02', value: 11 },
    { date: '2026-09-03', value: 18 },
  ]

  it('is anchored at zero — an area starting at the lowest value is a lie', () => {
    const c = dayChart(series)
    expect(c.grid[0].value).toBe(0)
    expect(c.grid[0].y).toBe(c.base)
    expect(c.area.endsWith('Z')).toBe(true)
    expect(c.area).toContain(`L${c.points[0].x} ${c.base}`)
  })

  it('the top gridline is a round number at or above the highest point', () => {
    expect(dayChart(series).max).toBe(20)
    expect(dayChart([{ date: '2026-09-01', value: 1837 }]).max).toBe(2000)
  })

  it('every day gets a point, left to right, inside the box', () => {
    const c = dayChart(series)
    expect(c.points).toHaveLength(3)
    expect(c.points[0].x).toBeLessThan(c.points[2].x)
    for (const p of c.points) {
      expect(p.x).toBeGreaterThanOrEqual(c.box.left)
      expect(p.y).toBeGreaterThanOrEqual(c.box.top)
      expect(p.y).toBeLessThanOrEqual(c.base)
    }
    expect(c.line.startsWith('M')).toBe(true)
  })

  it('nothing to draw is an empty shape, never a crash', () => {
    const c = dayChart([])
    expect(c.points).toEqual([])
    expect(c.line).toBe('')
    expect(c.max).toBe(1)
  })

  it('says what it is, out loud, and dates its axis in plain words', () => {
    expect(chartLabel(0)).toContain('nothing counted yet')
    expect(chartLabel(1)).toBe('Interactions on the first day')
    expect(chartLabel(12)).toContain('12 days')
    expect(shortDate('2026-09-05')).toBe('5 Sep')
    expect(shortDate('rubbish')).toBe('')
  })

  it('the graph is inline SVG in the page’s own ink, in both themes', () => {
    const src = read(DASH_GRAPH)
    expect(src).toContain('<svg')
    expect(src).toContain('currentColor')
    // tokens, never a literal colour that cannot follow the theme
    expect(src).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(src).toContain('stroke-border')
    expect(src).toContain('fill-muted-foreground')
  })
})

/* ── the client's version ──────────────────────────────────────────────── */

describe('the client’s copy of the page', () => {
  let fake: ReturnType<typeof seedDb> | null = null
  afterEach(() => { fake?.restore(); fake = null })

  const base = (onPortal: boolean) => ({
    clients: [{
      id: 'c1', name: 'Acme', share_token: '11111111-1111-4111-8111-111111111111',
      timezone: 'Australia/Melbourne', followers_on_portal: onPortal,
    }],
    content_items: [{ id: 'i1', client_id: 'c1', title: 'Hero reel', status: 'published' }],
    social_posts: [{
      id: 'p1', client_id: 'c1', item_id: 'i1', caption: 'Morning',
      publish_job_ids: ['j1'], channels: [], per_channel: {}, slides: [],
      status: 'published', timezone: 'Australia/Melbourne',
    }],
    post_analytics: [{
      id: 'a1', item_id: 'i1', publish_job_id: 'j1', provider_post_id: 'z1',
      platform: 'instagram', platform_post_url: null, likes: 12, comments: 2,
      sync_status: 'synced', synced_at: '2026-09-05T00:00:00Z', published_at: '2026-09-04T00:00:00Z',
      performance: {
        interactions: { total: 14, parts: [] }, chips: [],
        timeline: { days: 0, series: [], seen: [], mode: 'daily' },
        followers_since: null, followers_until_next: null,
        comments: [{ id: 'k1', author: 'ana', text: 'love this', at: null }],
        provider_post_id: 'z1', computed_at: '',
      },
      interactors: {
        media_id: 'm1', likers: ['zeddix'], commenters: ['ana'],
        people: { zeddix: { username: 'zeddix', full_name: 'Zeddix', profile_pic: null } },
        fetched_at: null, fetched_day: null, reads: 1,
        followed: [{ username: 'zeddix', full_name: 'Zeddix', profile_pic: null, how: 'liked', followed_on: '2026-09-04' }],
        status: 'done', error: null,
      },
    }],
  })

  const load = async (onPortal: boolean) => {
    fake = seedDb(base(onPortal) as never)
    const { getPortalPost } = await import('../app/lib/portal-post')
    return getPortalPost('11111111-1111-4111-8111-111111111111', 'p1')
  }

  it('carries the numbers with the switch OFF, and not one handle', () => {
    return load(false).then(post => {
      expect(post).not.toBeNull()
      expect(post!.performance?.interactions).toBe(14)
      expect(post!.liked_count).toBe(1)
      expect(post!.followed_count).toBe(1)
      expect(post!.comment_count).toBe(1)
      // the counts are the client's own; the people are not theirs to have
      expect(post!.liked).toEqual([])
      expect(post!.followed).toEqual([])
      expect(post!.comments).toEqual([])
      expect(post!.shows_people).toBe(false)
      expect(JSON.stringify(post)).not.toContain('zeddix')
      expect(JSON.stringify(post)).not.toContain('ana')
    })
  })

  it('carries the people once the client’s Followers switch is on', () => {
    return load(true).then(post => {
      expect(post!.shows_people).toBe(true)
      expect(post!.liked.map(p => p.name)).toEqual(['Zeddix'])
      expect(post!.followed.map(p => p.name)).toEqual(['Zeddix'])
      expect(post!.comments.map(c => c.text)).toEqual(['love this'])
    })
  })

  it('a post that is not this token’s client is not found', async () => {
    fake = seedDb({
      ...base(false),
      social_posts: [{ ...base(false).social_posts[0], client_id: 'other' }],
    } as never)
    const { getPortalPost } = await import('../app/lib/portal-post')
    expect(await getPortalPost('11111111-1111-4111-8111-111111111111', 'p1')).toBeNull()
  })
})
