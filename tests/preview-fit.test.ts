import { describe, it, expect } from 'vitest'
import { fitRange, fittedAspect } from '../app/lib/post-preview-core'

describe('Instagram preview keeps the picture shape (12 Nov 2026, Capila logo cut off)', () => {
  const r = fitRange('instagram', 'carousel')!
  it('a 4:5 carousel slide shows 4:5, not cropped to a square', () => expect(fittedAspect(r, 1080, 1350)).toBe('800 / 1000'))
  it('a square stays square', () => expect(fittedAspect(r, 1080, 1080)).toBe('1000 / 1000'))
  it('taller than 4:5 is held at 4:5, wider than 1.91 at 1.91', () => {
    expect(fittedAspect(r, 1080, 1920)).toBe('800 / 1000')
    expect(fittedAspect(r, 3000, 1000)).toBe('1910 / 1000')
  })
  it('Reels, Stories and other networks keep their fixed frame', () => {
    expect(fitRange('instagram', 'reel')).toBeNull()
    expect(fitRange('instagram', 'story')).toBeNull()
    expect(fitRange('tiktok', 'feed')).toBeNull()
  })
})
