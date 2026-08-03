import { describe, expect, it } from 'vitest'
import { moveItem, normalizeUrls } from '../app/lib/website-gallery-core'

describe('moveItem', () => {
  it('moves an item down by one', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
  })
  it('moves an item up by one', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
  })
  it('clamps moves past the ends', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 5)).toEqual(['a', 'c', 'b'])
    expect(moveItem(['a', 'b', 'c'], 1, -5)).toEqual(['b', 'a', 'c'])
  })
  it('returns an unchanged copy for an invalid index', () => {
    expect(moveItem(['a', 'b'], 7, 1)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], -1, 1)).toEqual(['a', 'b'])
  })
  it('does not mutate the input', () => {
    const arr = ['a', 'b']
    moveItem(arr, 0, 1)
    expect(arr).toEqual(['a', 'b'])
  })
})

describe('normalizeUrls', () => {
  it('trims entries and drops empties and non-strings', () => {
    expect(normalizeUrls([' https://x/a.jpg ', '', 3, null, 'b.mp4'])).toEqual([
      'https://x/a.jpg', 'b.mp4',
    ])
  })
  it('returns [] for non-array input', () => {
    expect(normalizeUrls(undefined)).toEqual([])
    expect(normalizeUrls('nope')).toEqual([])
    expect(normalizeUrls({})).toEqual([])
  })
})
