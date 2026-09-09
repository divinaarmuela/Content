import { describe, expect, it } from 'vitest'
import {
  byHandRows, clientStats, fileBooking, kindWords, kindsLine, outcomesForJob, parseOutcomeSentence, postsTabs,
  readPlatformResults, resultsForAll, resultsFromRemote, sortForTab,
  type OutcomeJob,
} from '../app/lib/post-outcome-core'

/* ── the 15:45 post of 8 Sep 2026: Instagram out, TikTok refused ───────── */

const video = [{ url: 'https://r2/x.mp4', type: 'video' as const }]
const job = (over: Partial<OutcomeJob & { client_id?: string | null }> = {}): OutcomeJob & { client_id: string | null } => ({
  id: 'j1', client_id: 'c1', status: 'failed', media: video,
  targets: [{ platform: 'instagram', options: { kind: 'reel' } }, { platform: 'tiktok' }],
  scheduled_for: '2026-09-08T05:45:00Z', published_at: null,
  created_at: '2026-09-08T05:30:00Z', updated_at: '2026-09-08T05:46:00Z',
  error: 'Went out on instagram. Did not go out on tiktok: too big.', permalink: null,
  ...over,
})

describe('what kind of post it was', () => {
  it('uses the chosen kind, else reads the media', () => {
    expect(kindWords('instagram', 'reel', [])).toBe('Reel')
    expect(kindWords('instagram', null, video)).toBe('Reel')
    expect(kindWords('tiktok', null, video)).toBe('Video')
    expect(kindWords('youtube', undefined, video)).toBe('Video')
    expect(kindWords('instagram', null, [{ type: 'image' }])).toBe('Feed post')
    expect(kindWords('instagram', null, [{ type: 'image' }, { type: 'image' }])).toBe('Carousel')
    expect(kindWords('linkedin', null, [])).toBe('Text post')
  })
})

describe('the record written at settle', () => {
  it('gives every channel one outcome when the provider said nothing per channel', () => {
    const r = resultsForAll(job(), 'scheduled', { at: '2026-09-08T05:45:00Z' })
    expect(r).toEqual([
      { platform: 'instagram', status: 'scheduled', kind: 'Reel', reason: null, url: null, at: '2026-09-08T05:45:00Z' },
      { platform: 'tiktok', status: 'scheduled', kind: 'Video', reason: null, url: null, at: '2026-09-08T05:45:00Z' },
    ])
  })
  it('logs one channel live and the other refused, with the reason on the one that failed', () => {
    const r = resultsFromRemote(job(), [
      { platform: 'instagram', status: 'published', platformPostUrl: 'https://www.instagram.com/p/x/' },
      { platform: 'tiktok', status: 'failed', errorMessage: 'Video too large' },
    ], 'failed', '2026-09-08T05:46:00Z')
    expect(r).toEqual([
      { platform: 'instagram', status: 'published', kind: 'Reel', reason: null, url: 'https://www.instagram.com/p/x/', at: '2026-09-08T05:46:00Z' },
      { platform: 'tiktok', status: 'failed', kind: 'Video', reason: 'Video too large', url: null, at: '2026-09-08T05:46:00Z' },
    ])
  })
  it('reads a TikTok "still processing" as a wait, and keeps a channel the provider left out', () => {
    const r = resultsFromRemote(job(), [
      { platform: 'tiktok', status: 'failed', errorMessage: 'Video is still processing, do not repost' },
    ], 'scheduled', '2026-09-08T05:46:00Z')
    expect(r.find(o => o.platform === 'tiktok')?.status).toBe('pending')
    expect(r.find(o => o.platform === 'instagram')).toMatchObject({ status: 'scheduled', at: '2026-09-08T05:45:00Z' })
  })
  it('reads the record back and drops rubbish', () => {
    const r = resultsForAll(job(), 'published', { at: 'x' })
    expect(readPlatformResults(JSON.parse(JSON.stringify(r)))).toEqual(r)
    expect(readPlatformResults([{ platform: 'instagram', status: 'nope' }, 5, null])).toBeNull()
    expect(readPlatformResults('x')).toBeNull()
  })
})

describe('a job read as per-channel outcomes', () => {
  it('falls back to the job status per channel for a job written before the record existed', () => {
    const r = outcomesForJob(job({ status: 'published', published_at: '2026-09-08T05:46:00Z', permalink: 'https://ig/p' }))
    expect(r.map(o => [o.platform, o.status, o.at, o.url])).toEqual([
      ['instagram', 'published', '2026-09-08T05:46:00Z', 'https://ig/p'],
      ['tiktok', 'published', '2026-09-08T05:46:00Z', 'https://ig/p'],
    ])
    const plain = job({ error: 'This file is too big to send as it is' })
    expect(outcomesForJob(plain).map(o => [o.status, o.reason])).toEqual([['failed', plain.error], ['failed', plain.error]])
  })
  it('reads the reconcile sentence on a job failed before the record existed', () => {
    const r = outcomesForJob(job({ error: 'Went out on instagram. Did not go out on tiktok: Video too large.' }))
    expect(r.map(o => [o.platform, o.status, o.reason])).toEqual([
      ['instagram', 'published', null],
      ['tiktok', 'failed', 'Video too large'],
    ])
    const only = outcomesForJob(job({ error: 'Did not go out — instagram: token expired; tiktok: no reason given.' }))
    expect(only.map(o => [o.status, o.reason])).toEqual([['failed', 'token expired'], ['failed', 'no reason given']])
    expect(parseOutcomeSentence('This file is too big to send')).toBeNull()
    // the 31 Aug job: a reason with full stops of its own, and a wait tail
    const real = parseOutcomeSentence('Went out on tiktok, youtube. Did not go out on instagram: Instagram could not fetch your media from the URL. Make sure it is publicly accessible (not Google Drive) and try again.; linkedin: Publishing timed out during platform API call. Check the platform before retrying. Still going out on threads — the platform is processing it; do not resend.')
    expect(real?.live).toEqual(['tiktok', 'youtube'])
    expect([...real!.failed.entries()]).toEqual([
      ['instagram', 'Instagram could not fetch your media from the URL. Make sure it is publicly accessible (not Google Drive) and try again'],
      ['linkedin', 'Publishing timed out during platform API call. Check the platform before retrying'],
    ])
  })
  it('a cancelled job overrides a stored booking', () => {
    const stored = resultsForAll(job(), 'scheduled', { at: 'x' })
    expect(outcomesForJob(job({ status: 'cancelled', platform_results: stored })).map(o => o.status)).toEqual(['cancelled', 'cancelled'])
  })
})

describe('the Posts page tabs', () => {
  const partial = job({ platform_results: resultsFromRemote(job(), [
    { platform: 'instagram', status: 'published' }, { platform: 'tiktok', status: 'failed', errorMessage: 'too big' },
  ], 'failed', '2026-09-08T05:46:00Z') })
  it('puts a partial on both Posted and Did not post', () => {
    expect([...postsTabs(partial)].sort()).toEqual(['did_not_post', 'posted'])
    expect([...postsTabs(job({ status: 'scheduled' }))]).toEqual(['scheduled'])
    expect([...postsTabs(job({ status: 'queued' }))]).toEqual(['scheduled'])
    expect([...postsTabs(job({ status: 'cancelled' }))]).toEqual(['did_not_post'])
    expect([...postsTabs(job({ status: 'published', published_at: 'x' }))]).toEqual(['posted'])
  })
  it('sorts booked soonest first and the rest newest first', () => {
    const a = job({ id: 'a', status: 'scheduled', scheduled_for: '2026-09-10T00:00:00Z' })
    const b = job({ id: 'b', status: 'scheduled', scheduled_for: '2026-09-09T00:00:00Z' })
    expect(sortForTab([a, b], 'scheduled').map(j => j.id)).toEqual(['b', 'a'])
    const c = job({ id: 'c', status: 'published', published_at: '2026-09-01T00:00:00Z' })
    const d = job({ id: 'd', status: 'published', published_at: '2026-09-02T00:00:00Z' })
    expect(sortForTab([c, d, a], 'posted').map(j => j.id)).toEqual(['d', 'c'])
  })
})

describe('posted by hand, and the numbers per client', () => {
  const items = [{
    id: 'i1', title: 'Five files', client_id: 'c1',
    posted_slides: { urls: ['b'], posted: 1, total: 5, hand: [{ url: 'b', at: '2026-09-08T09:30:00Z', link: 'https://ig/b' }] },
  }, { id: 'i2', title: 'Nothing by hand', client_id: 'c1', posted_slides: { urls: [], posted: 0, total: 2 } }]
  it('one row per file marked by hand, saying which file of the card', () => {
    const rows = byHandRows(items, item => item.id === 'i1' ? [{ url: 'a' }, { url: 'b' }, { url: 'c' }, { url: 'd' }, { url: 'e' }] : [])
    expect(rows).toEqual([{ item_id: 'i1', title: 'Five files', client_id: 'c1', url: 'b', at: '2026-09-08T09:30:00Z', link: 'https://ig/b', index: 2, total: 5 }])
  })
  it('counts channels out, booked, refused and by hand — and what kinds went out', () => {
    const partial = job({ platform_results: resultsFromRemote(job(), [
      { platform: 'instagram', status: 'published' }, { platform: 'tiktok', status: 'failed', errorMessage: 'too big' },
    ], 'failed', '2026-09-08T05:46:00Z') })
    const booked = job({ id: 'j2', status: 'scheduled', media: [{ url: 'p', type: 'image' }], targets: [{ platform: 'instagram' }] })
    const other = job({ id: 'j3', client_id: 'c2', status: 'published', published_at: '2026-09-07T00:00:00Z' })
    const s = clientStats([partial, booked, other], byHandRows(items))
    // POSTS, the same unit as the tabs: the partial is one post that went out
    // AND one that did not; the other client's post went out once, as a
    // reel on Instagram and a video on TikTok
    expect(s.find(x => x.client_id === 'c1')).toEqual({ client_id: 'c1', went_out: 1, booked: 1, did_not: 1, by_hand: 1, kinds: { Reel: 1 } })
    expect(s.find(x => x.client_id === 'c2')).toEqual({ client_id: 'c2', went_out: 1, booked: 0, did_not: 0, by_hand: 0, kinds: { Reel: 1, Video: 1 } })
    expect(kindsLine({ Reel: 4, 'Feed post': 1, Story: 2 })).toBe('4 reels, 2 stories, 1 feed post')
    // a window leaves old ones out
    expect(clientStats([other], [], { sinceMs: Date.parse('2026-09-08T00:00:00Z') })).toEqual([])
  })
})

describe('one file of a card: booked or out', () => {
  const jobs = new Map<string, OutcomeJob>([
    ['j1', job({ status: 'scheduled', platform_results: resultsForAll(job(), 'scheduled', { at: '2026-09-10T00:00:00Z' }) })],
  ])
  const posts = [
    { status: 'scheduled', slides: [{ url: 'a' }], publish_job_ids: ['j1'], scheduled_for: '2026-09-10T00:00:00Z' },
    { status: 'draft', slides: [{ url: 'b' }] },
    { status: 'published', slides: [{ url: 'c' }], publish_job_ids: [] },
  ]
  it('says booked with the time, out when out, nothing for a draft', () => {
    expect(fileBooking('a', posts, jobs)).toMatchObject({ status: 'scheduled', at: '2026-09-10T00:00:00Z' })
    expect(fileBooking('a', posts, jobs)?.outcomes.map(o => o.platform)).toEqual(['instagram', 'tiktok'])
    expect(fileBooking('b', posts, jobs)).toBeNull()
    expect(fileBooking('c', posts, jobs)).toMatchObject({ status: 'published' })
  })
})
