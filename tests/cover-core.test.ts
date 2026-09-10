import { describe, expect, it } from 'vitest'
import { coverFrameTimes, coverPatchFor, coverPlatforms, coverProblems, currentCover } from '../app/lib/cover-core'

/* ── one cover, sent to each network the way it takes it (10 Sep 2026) ──── */

describe('the cover', () => {
  it('goes into the field each network reads, and nowhere for a network with none', () => {
    expect(coverPatchFor('instagram', 'https://r2/c.jpg')).toEqual({ thumbnailUrl: 'https://r2/c.jpg' })
    expect(coverPatchFor('youtube', 'https://r2/c.jpg')).toEqual({ thumbnailUrl: 'https://r2/c.jpg' })
    expect(coverPatchFor('tiktok', 'https://r2/c.jpg')).toEqual({ videoCoverImageUrl: 'https://r2/c.jpg' })
    expect(coverPatchFor('linkedin', 'https://r2/c.jpg')).toEqual({})
    // clearing writes undefined, which the reducer drops
    expect(coverPatchFor('tiktok', null)).toEqual({ videoCoverImageUrl: undefined })
    expect(coverPlatforms(['tiktok', 'linkedin', 'instagram', 'instagram'])).toEqual(['tiktok', 'instagram'])
  })
  it('reads the cover chosen in the window first, then the editor’s', () => {
    const accounts = [{ id: 'ig', platform: 'instagram' }, { id: 'tt', platform: 'tiktok' }]
    expect(currentCover({ tt: { videoCoverImageUrl: 'https://r2/w.jpg' } }, accounts, 'https://r2/e.jpg')).toEqual({ url: 'https://r2/w.jpg', source: 'window' })
    expect(currentCover({}, accounts, 'https://r2/e.jpg')).toEqual({ url: 'https://r2/e.jpg', source: 'editor' })
    expect(currentCover({}, accounts, null)).toBeNull()
  })
  it('refuses a file a network would refuse, by name', () => {
    expect(coverProblems({ name: 'c.webp', size: 1000 }, ['instagram', 'tiktok'])).toEqual([
      'Instagram does not take a .webp cover — use JPEG, PNG.',
    ])
    expect(coverProblems({ name: 'c.jpg', size: 3 * 1024 * 1024 }, ['youtube', 'tiktok'])).toEqual([
      'YouTube takes a cover of up to 2 MB — this one is 3.0 MB.',
    ])
    expect(coverProblems({ name: 'c.png', size: 100 }, ['instagram', 'youtube', 'tiktok'])).toEqual([])
  })
  it('takes stills along the clip, never its first or last frame', () => {
    const t = coverFrameTimes(108)
    expect(t).toHaveLength(8)
    expect(t[0]).toBeGreaterThan(0)
    expect(t[t.length - 1]).toBeLessThan(108)
    expect(coverFrameTimes(2)).toHaveLength(2)
    expect(coverFrameTimes(0)).toEqual([])
  })
})
