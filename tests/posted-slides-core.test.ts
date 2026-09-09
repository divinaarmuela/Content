import { describe, expect, it } from 'vitest'
import {
  fullyPosted, postedLine, postedProgress, publishedSlideUrls, readPostedSlides, remainingSlides, takenSlideUrls,
} from '../app/lib/posted-slides-core'

/* ── a piece posted in parts (9 Sep 2026) ──────────────────────────────── */

const S = [{ url: 'a' }, { url: 'b' }, { url: 'c' }, { url: 'd' }]
const posts = [
  { status: 'published', slides: [{ url: 'a' }, { url: 'b' }] },
  { status: 'scheduled', slides: [{ url: 'c' }] },
  { status: 'cancelled', slides: [{ url: 'd' }] },
  { status: 'failed', slides: [{ url: 'd' }] },
]

describe('which files have gone, and which are free', () => {
  it('a booked or published post takes its files; a draft, a cancelled or a failed one does not', () => {
    expect([...takenSlideUrls(posts)]).toEqual(['a', 'b', 'c'])
    expect(remainingSlides(S, takenSlideUrls(posts)).map(s => s.url)).toEqual(['d'])
    // a forgotten draft must not swallow the files (9 Sep 2026)
    expect([...takenSlideUrls([{ status: 'draft', slides: [{ url: 'a' }] }, { status: 'approved', slides: [{ url: 'b' }] }])]).toEqual([])
  })
  it('only a published post counts as posted — by its row, or by a job of its that published', () => {
    expect([...publishedSlideUrls(posts)]).toEqual(['a', 'b'])
    const booked = [{ status: 'scheduled', slides: [{ url: 'c' }], publish_job_ids: ['job-1'] }]
    expect([...publishedSlideUrls(booked)]).toEqual([])
    expect([...publishedSlideUrls(booked, new Set(['job-1']))]).toEqual(['c'])
  })
  it('progress counts the piece’s own files, published or marked by hand', () => {
    expect(postedProgress(S, publishedSlideUrls(posts))).toEqual({ urls: ['a', 'b'], posted: 2, total: 4 })
    expect(postedProgress(S, publishedSlideUrls(posts), ['d'])).toEqual({ urls: ['a', 'b', 'd'], posted: 3, total: 4 })
    // a url no longer on the piece is not counted
    expect(postedProgress(S, new Set(['zzz']))).toEqual({ urls: [], posted: 0, total: 4 })
  })
  it('is fully posted only when every file has gone', () => {
    expect(fullyPosted(postedProgress(S, new Set(['a', 'b', 'c', 'd'])))).toBe(true)
    expect(fullyPosted(postedProgress(S, new Set(['a'])))).toBe(false)
    expect(fullyPosted(postedProgress([], new Set()))).toBe(false)
    expect(fullyPosted(null)).toBe(false)
  })
  it('says so on the card only while part-way', () => {
    expect(postedLine({ urls: ['a', 'b'], posted: 2, total: 4 })).toBe('2 of 4 posted')
    expect(postedLine({ urls: [], posted: 0, total: 4 })).toBeNull()
    expect(postedLine({ urls: ['a'], posted: 1, total: 1 })).toBeNull()
    expect(postedLine(null)).toBeNull()
  })
  it('reads the row back, and refuses rubbish', () => {
    expect(readPostedSlides({ urls: ['a'], posted: 1, total: 3 })).toEqual({ urls: ['a'], posted: 1, total: 3 })
    expect(readPostedSlides('x')).toBeNull()
    expect(readPostedSlides(null)).toBeNull()
  })
})

describe('posted by hand carries when and where (9 Sep 2026)', () => {
  it('keeps the hand map through progress and reads it back', () => {
    const hand = [{ url: 'b', at: '2026-09-08T09:30:00.000Z', link: 'https://www.instagram.com/p/x/' }]
    const p = postedProgress(S, new Set(['a']), ['b'], hand)
    expect(p).toEqual({ urls: ['a', 'b'], posted: 2, total: 4, hand })
    expect(readPostedSlides(JSON.parse(JSON.stringify(p)))).toEqual(p)
    // rubbish in the list is dropped, the count is kept
    expect(readPostedSlides({ urls: ['a'], posted: 1, total: 2, hand: [{ at: 5 }] })).toEqual({ urls: ['a'], posted: 1, total: 2 })
  })
})
