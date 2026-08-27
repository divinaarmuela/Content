import { describe, expect, it } from 'vitest'
import {
  SWIPE_THRESHOLD_PX, allSeen, clampIndex, counterLabel, markSeen,
  nextIndex, prevIndex, seenLabel, slidesFor, swipeDecision,
} from '../app/lib/slide-carousel-core'

describe('nextIndex / prevIndex — the ends wrap', () => {
  it('walks forward and comes round', () => {
    expect(nextIndex(0, 5)).toBe(1)
    expect(nextIndex(3, 5)).toBe(4)
    expect(nextIndex(4, 5)).toBe(0)
  })

  it('walks back and comes round the other way', () => {
    expect(prevIndex(4, 5)).toBe(3)
    expect(prevIndex(1, 5)).toBe(0)
    expect(prevIndex(0, 5)).toBe(4)
  })

  it('stays put when there is nowhere to go', () => {
    expect(nextIndex(0, 1)).toBe(0)
    expect(prevIndex(0, 1)).toBe(0)
    expect(nextIndex(0, 0)).toBe(0)
    expect(prevIndex(0, 0)).toBe(0)
  })

  it('recovers from an index the slides no longer have', () => {
    // the version was replaced under an open card: 9 of 3 is not a crash
    expect(nextIndex(9, 3)).toBe(0)
    expect(prevIndex(9, 3)).toBe(1)
    expect(nextIndex(-4, 3)).toBe(1)
  })

  it('survives nonsense', () => {
    expect(nextIndex(Number.NaN, 3)).toBe(1)
    expect(nextIndex(0, Number.NaN)).toBe(0)
    expect(clampIndex(2.7, 5)).toBe(2)
  })
})

describe('swipeDecision — a swipe, a scroll, or neither', () => {
  it('takes a firm drag left as the next slide', () => {
    expect(swipeDecision(-80, 4)).toBe('next')
  })

  it('takes a firm drag right as the previous slide', () => {
    expect(swipeDecision(80, -4)).toBe('prev')
  })

  it('ignores anything under the threshold', () => {
    expect(swipeDecision(-39, 0)).toBe('none')
    expect(swipeDecision(39, 0)).toBe('none')
    expect(swipeDecision(-SWIPE_THRESHOLD_PX, 0)).toBe('next')
  })

  it('never turns the carousel while the page is being scrolled', () => {
    // 60px across but 200px down is a thumb scrolling the portal
    expect(swipeDecision(-60, 200)).toBe('none')
    expect(swipeDecision(60, -200)).toBe('none')
  })

  it('honours a caller-supplied threshold, and refuses nonsense', () => {
    expect(swipeDecision(-20, 0, 10)).toBe('next')
    expect(swipeDecision(Number.NaN, 0)).toBe('none')
  })
})

describe('markSeen / allSeen — has the client looked at the whole post', () => {
  it('collects each slide once, in order', () => {
    let seen = markSeen([], 0, 3)
    seen = markSeen(seen, 2, 3)
    seen = markSeen(seen, 0, 3)
    expect(seen).toEqual([0, 2])
  })

  it('does not count a bounce back and forth as two slides', () => {
    let seen = markSeen([], 0, 4)
    seen = markSeen(seen, 1, 4)
    seen = markSeen(seen, 0, 4)
    seen = markSeen(seen, 1, 4)
    expect(seen).toEqual([0, 1])
    expect(allSeen(seen, 4)).toBe(false)
  })

  it('is all-seen only once every card has been in front of them', () => {
    const seen = [0, 1, 2].reduce((s, i) => markSeen(s, i, 3), [] as number[])
    expect(allSeen(seen, 3)).toBe(true)
  })

  it('drops indexes the post no longer has, so all-seen cannot be faked', () => {
    // seen slide 5 of the old six-card version; the new one has three
    expect(markSeen([0, 1, 5], 2, 3)).toEqual([0, 1, 2])
    expect(allSeen([0, 1, 5], 3)).toBe(false)
    expect(markSeen([0], 7, 3)).toEqual([0])
  })

  it('has nothing to say about an empty post', () => {
    expect(allSeen([], 0)).toBe(false)
  })
})

describe('the lines the viewer prints', () => {
  it('counts position from one, and only for a real carousel', () => {
    expect(counterLabel(0, 5)).toBe('1 / 5')
    expect(counterLabel(4, 5)).toBe('5 / 5')
    expect(counterLabel(0, 1)).toBeNull()
  })

  it('nudges towards the unseen cards, then congratulates', () => {
    expect(seenLabel([0], 5)).toBe('Seen 1 of 5 slides')
    expect(seenLabel([0, 1], 5)).toBe('Seen 2 of 5 slides')
    expect(seenLabel([0, 1, 2, 3, 4], 5)).toBe('All slides seen ✓')
  })

  it('says nothing at all about a single-file piece', () => {
    expect(seenLabel([0], 1)).toBeNull()
    expect(seenLabel([], 0)).toBeNull()
  })
})

describe('slidesFor — what the viewer is given', () => {
  it('hands back the whole post, in order', () => {
    const item = { slides: [{ url: 'https://a/1.jpg' }, { url: 'https://a/2.mp4', type: 'video' as const }] }
    expect(slidesFor(item).map(s => s.url)).toEqual(['https://a/1.jpg', 'https://a/2.mp4'])
  })

  it('falls back to the single preview an older reader would have sent', () => {
    expect(slidesFor({ slides: [], preview_url: 'https://a/1.jpg' }))
      .toEqual([{ url: 'https://a/1.jpg' }])
  })

  it('is empty when there is nothing the client may see', () => {
    expect(slidesFor({ slides: [], preview_url: null })).toEqual([])
    expect(slidesFor(null)).toEqual([])
  })
})
