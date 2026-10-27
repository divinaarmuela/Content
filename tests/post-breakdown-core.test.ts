import { describe, expect, it } from 'vitest'
import type { TopPost } from '../app/lib/client-report-core'
import {
  breakdownLines, buildBreakdownPrompt, codesFor, evidenceFor, indexPosts, modeOf, pickComparison, postKind, postsToExplain,
  readPostsExplained, scoreOf, tidyBreakdown, watchedShare,
} from '../app/lib/post-breakdown-core'

const NOW = Date.parse('2026-10-31T12:00:00Z')
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString()
let seq = 0
const post = (o: Partial<TopPost> & { age: number }): TopPost => ({
  id: `p${++seq}`, platform: 'instagram', publishedAt: day(o.age), url: null, thumbnail: null, caption: `post ${seq}`, format: 'image',
  views: 1000, reach: 800, likes: 100, comments: 10, shares: 5, saves: 5, engagementRate: null, ...o,
})

describe('the performance index (UNLK.AI\'s formula)', () => {
  it('maps the blended log2 value through the anchors: typical 50, twice 75, half 25, four times 90', () => {
    expect(scoreOf(0)).toBe(50)
    expect(scoreOf(1)).toBe(75)
    expect(scoreOf(-1)).toBe(25)
    expect(scoreOf(2)).toBe(90)
    expect(scoreOf(9)).toBe(100)
  })

  it('scores a typical post about 50 and one with four times the likes and comments about 90', () => {
    seq = 0
    const posts = Array.from({ length: 14 }, (_, i) => post({ age: 10 + i * 3 }))
    const big = post({ age: 20, likes: 400, comments: 40 })
    const idx = indexPosts([...posts, big], NOW)
    expect(idx.get(posts[3].id)!.score).toBe(50)
    expect(idx.get(big.id)!.score).toBe(90)
    expect(idx.get(big.id)!.multiple).toBe(4)
  })

  it('pulls a post under three days old towards 50, since it is still collecting', () => {
    seq = 0
    const posts = Array.from({ length: 14 }, (_, i) => post({ age: 10 + i * 3 }))
    const fresh = post({ age: 1.5, likes: 400, comments: 40 })
    expect(indexPosts([...posts, fresh], NOW).get(fresh.id)!.score).toBe(70)
  })

  it('compares a reel\'s views only with reels', () => {
    seq = 0
    const photos = Array.from({ length: 8 }, (_, i) => post({ age: 10 + i, views: 10000 }))
    const reels = Array.from({ length: 8 }, (_, i) => post({ age: 10 + i, format: 'video', views: 500, durationSec: 30 }))
    const idx = indexPosts([...photos, ...reels], NOW)
    expect(idx.get(reels[2].id)!.parts.views).toBe(1)
  })
})

describe('what a post is', () => {
  it('reads Zernio\'s media types', () => {
    expect(postKind({ format: 'carousel' })).toBe('carousel')
    expect(postKind({ format: 'video' })).toBe('reel')
    expect(postKind({ format: 'image' })).toBe('photo')
  })
  it('works out how much of a reel was watched', () => {
    expect(watchedShare({ avgWatchMs: 15113, durationSec: 170 })).toBeCloseTo(0.089, 3)
    expect(watchedShare({ avgWatchMs: null, durationSec: 30 })).toBeNull()
  })
})

describe('the reasons, ranked (computed, never written by the model)', () => {
  seq = 0
  const reels = Array.from({ length: 8 }, (_, i) => post({ age: 20 + i, format: 'video', durationSec: 30, avgWatchMs: 9000, skipRate: 60, shares: 4, reach: 1000 }))
  const hit = post({ age: 15, format: 'video', durationSec: 30, avgWatchMs: 18000, skipRate: 30, shares: 40, reach: 3000, likes: 600, comments: 60, views: 5000 })
  const all = [...reels, hit]
  const idx = indexPosts(all, NOW)
  const factors = evidenceFor(hit, all, 1000, idx)

  it('finds the real signals: the opening held, people watched more, people sent it on, it reached beyond followers', () => {
    const keys = factors.map(f => f.key)
    expect(keys).toEqual(expect.arrayContaining(['hook', 'watch', 'sends', 'reach']))
    expect(factors.find(f => f.key === 'hook')!.evidence).toContain('70% stayed past the first three seconds')
    expect(factors.find(f => f.key === 'watch')!.evidence).toContain('18s of 30s')
  })
  it('puts strong reasons first', () => {
    const rank = { strong: 0, likely: 1, 'not supported': 2 }
    const order = factors.map(f => rank[f.verdict])
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
  it('says nothing about a signal with fewer than five posts to compare', () => {
    expect(evidenceFor(hit, [hit, ...reels.slice(0, 3)], 1000, idx).some(f => f.key === 'hook')).toBe(false)
  })
  it('marks where a weak post fell short, and lists those after what went well', () => {
    const weak = post({ age: 16, format: 'video', durationSec: 30, avgWatchMs: 4000, skipRate: 80, shares: 4, reach: 1000 })
    const f = evidenceFor(weak, [...reels, weak], 1000, indexPosts([...reels, weak], NOW))
    const hook = f.find(x => x.key === 'hook')!
    expect(hook.below).toBe(true)
    expect(hook.label).toBe('The opening lost people')
    expect(hook.evidence).toContain('20% stayed past the first three seconds, against 40%')
    const firstBelow = f.findIndex(x => x.below)
    expect(f.slice(firstBelow).every(x => x.below)).toBe(true)
  })
  it('compares with every post when there are too few of the same kind, and counts in words', () => {
    seq = 0
    const carousels = [post({ age: 20, format: 'carousel', shares: 1, reach: 1000 }), post({ age: 21, format: 'carousel', shares: 2, reach: 1000 })]
    const photos = Array.from({ length: 6 }, (_, i) => post({ age: 22 + i, shares: 2, reach: 1000 }))
    const all = [...carousels, ...photos]
    const sends = evidenceFor(carousels[0], all, 1000, indexPosts(all, NOW)).find(x => x.key === 'sends')!
    expect(sends.evidence).toMatch(/^1 share, 0\.1% of the accounts it reached, against 0\.2% on a typical post/)
  })
})

describe('which posts to explain, and what to compare them with', () => {
  seq = 0
  const reels = Array.from({ length: 12 }, (_, i) => post({ age: 30 + i, format: 'video', likes: 50 + i * 20, comments: 5 + i }))
  const photos = Array.from({ length: 6 }, (_, i) => post({ age: 30 + i, likes: 100 }))
  const all = [...reels, ...photos]
  const idx = indexPosts(all, NOW)

  it('compares a reel with reels only, best first and worst first', () => {
    const { hits, flops } = pickComparison(all, reels[5].id, idx)
    expect([...hits, ...flops].every(p => postKind(p) === 'reel')).toBe(true)
    expect(idx.get(hits[0].id)!.score).toBeGreaterThanOrEqual(idx.get(hits[1].id)!.score)
    expect(idx.get(flops[0].id)!.score).toBeLessThanOrEqual(idx.get(flops[1].id)!.score)
    // a hit is above the account's normal, a flop below it
    expect(hits.every(p => idx.get(p.id)!.score >= 50)).toBe(true)
    expect(flops.every(p => idx.get(p.id)!.score < 50)).toBe(true)
  })
  it('explains the five best and up to three that fell behind', () => {
    const chosen = postsToExplain(all, idx)
    expect(chosen.slice(0, 5).every(c => c.mode === 'work')).toBe(true)
    expect(chosen.length).toBeLessThanOrEqual(8)
    expect(chosen.slice(5).every(c => idx.get(c.post.id)!.score < 45)).toBe(true)
  })
  it('never calls a post under two weeks old a flop', () => {
    const young = post({ age: 5, likes: 1, comments: 0 })
    expect(modeOf(young, { score: 10, multiple: 0.2, parts: {} }, NOW)).toBe('early')
    expect(modeOf(reels[0], { score: 10, multiple: 0.2, parts: {} }, NOW)).toBe('underperform')
  })
})

describe('the model\'s question and answer', () => {
  seq = 0
  const p = post({ age: 20, caption: 'Save this for later' })
  const h = post({ age: 25 })
  const f = post({ age: 26 })
  const codes = codesFor([p, h, f])
  const idx = indexPosts([p, h, f], NOW)

  it('cites posts by short codes and carries the evidence rows', () => {
    const prompt = buildBreakdownPrompt({ post: p, mode: 'work', account: '@justin', followers: 1000, index: idx, hits: [h], flops: [f], codes,
      factors: [{ key: 'sends', label: 'People sent it to others', verdict: 'strong', evidence: '40 shares' }] })
    expect(prompt).toContain('THIS POST [P1]')
    expect(prompt).toContain('- [P2]')
    expect(prompt).toContain('- [strong] People sent it to others: 40 shares')
    expect(prompt).toContain('CAPTION: Save this for later')
  })
  it('turns the codes a contrast cites back into posts, and refuses an answer with no verdict', () => {
    const b = tidyBreakdown({ verdict: 'Worked because people saved it.', firstLook: 'The headline', whatWorked: ['a', 'b'],
      vsFlops: [{ point: 'Openings', hits: 'Open on a face [P2]', flops: 'Open on text [P3]' }], tryThis: ['x'] }, codes)!
    expect(b.vsFlops[0].hitIds).toEqual([h.id])
    expect(b.vsFlops[0].flopIds).toEqual([f.id])
    expect(tidyBreakdown({ whatWorked: ['a'] }, codes)).toBeNull()
  })
  it('reads a saved set back with every dropped list put back', () => {
    const back = readPostsExplained({ at: 'x', model: 'm', items: [{ postId: p.id, mode: 'work', index: { score: 80, multiple: 2.5 }, breakdown: { verdict: 'v' } }] })!
    expect(back.items[0].factors).toEqual([])
    expect(back.items[0].breakdown!.vsFlops).toEqual([])
    expect(back.items[0].index.parts).toEqual({})
    expect(back.posts).toEqual([])
    expect(readPostsExplained(null)).toBeNull()
  })
  it('hands the report writer each verdict', () => {
    const lines = breakdownLines([{ postId: p.id, mode: 'work', index: { score: 80, multiple: 2.5, parts: {} }, factors: [],
      breakdown: { verdict: 'Worked because people saved it.', firstLook: '', whatWorked: ['17 saves'], vsFlops: [], tryThis: [] } }], [p])
    expect(lines.join('\n')).toContain('score 80 (2.5x typical). Worked because people saved it.')
    expect(breakdownLines([], [p])).toEqual([])
  })
})
