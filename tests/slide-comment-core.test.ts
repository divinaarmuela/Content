import { describe, expect, it } from 'vitest'
import { commentsBySlide, slideTag, splitSlideTag, tagComment } from '../app/lib/slide-comment-core'

/* ── a comment on one asset (8 Sep 2026) ────────────────────────────────── */

describe('a comment on one asset of a post', () => {
  it('is written as a sentence anybody can read', () => {
    expect(tagComment('the logo is too small', slideTag(1, 4, 'image'))).toBe('On photo 2 of 4: the logo is too small')
    expect(tagComment('  cut the intro ', slideTag(0, 1, 'video'))).toBe('On video 1 of 1: cut the intro')
    expect(tagComment('fine as is', null)).toBe('fine as is')
  })
  it('is read back out as a label and the words', () => {
    expect(splitSlideTag('On photo 2 of 4: the logo is too small')).toEqual({ label: 'Photo 2 of 4', rest: 'the logo is too small', index: 1 })
    expect(splitSlideTag('On video 1 of 1: cut the intro\n— Rondo')).toEqual({ label: 'Video 1 of 1', rest: 'cut the intro\n— Rondo', index: 0 })
    expect(splitSlideTag('Love it')).toEqual({ label: null, rest: 'Love it', index: null })
  })
  it('counts the comments under each asset', () => {
    const m = commentsBySlide([
      { body: 'On photo 2 of 4: a' }, { body: 'On photo 2 of 4: b' }, { body: 'On photo 4 of 4: c' }, { body: 'overall fine' },
    ])
    expect([...m.entries()]).toEqual([[1, 2], [3, 1]])
  })
})
