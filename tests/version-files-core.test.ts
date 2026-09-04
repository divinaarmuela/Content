import { describe, it, expect } from 'vitest'
import {
  MAX_SLIDES, isCarouselType, normaliseSlides, postSlides, reorder, slideCountLabel,
  slideFileName, slideNameFromUrl, slideTypeFromUrl, slidesOf, slidesSatisfyType,
} from '../app/lib/version-files-core'

const u = (n: string) => `https://media.mdmmarketing.com.au/${n}`

describe('slideTypeFromUrl', () => {
  it('reads the extension, ignoring the query string', () => {
    expect(slideTypeFromUrl(u('hook.mp4?sig=abc'))).toBe('video')
    expect(slideTypeFromUrl(u('card-1.PNG'))).toBe('image')
    expect(slideTypeFromUrl(u('cut.mov'))).toBe('video')
  })
  it('treats anything unknown as an image rather than refusing it', () => {
    expect(slideTypeFromUrl(u('poster'))).toBe('image')
  })
})

describe('slideNameFromUrl', () => {
  it('takes the last path segment and un-escapes it', () => {
    expect(slideNameFromUrl(u('Hook%20cut.mp4?x=1'))).toBe('Hook cut.mp4')
  })
  it('never returns an empty name', () => {
    expect(slideNameFromUrl('https://x.test/')).toBe('file')
  })
})

describe('normaliseSlides', () => {
  it('keeps order, fills in name and type', () => {
    expect(normaliseSlides([{ url: u('a.jpg') }, { url: u('b.mp4') }])).toEqual([
      { url: u('a.jpg'), name: 'a.jpg', type: 'image' },
      { url: u('b.mp4'), name: 'b.mp4', type: 'video' },
    ])
  })
  /**
   * A slide made in the composer's Drive tab carries where it came from all
   * the way to the stored version — and that is the mark the mirror reads to
   * know not to copy the file back into the folder it was picked out of.
   */
  it('keeps where a file came from, and the Drive file it was', () => {
    expect(normaliseSlides([
      { url: u('a.jpg'), source: 'drive', drive_file_id: 'gd-1' },
      { url: u('b.jpg'), source: 'upload' },
      { url: u('c.jpg'), source: 'somewhere else', drive_file_id: '  ' },
    ])).toEqual([
      { url: u('a.jpg'), name: 'a.jpg', type: 'image', source: 'drive', drive_file_id: 'gd-1' },
      { url: u('b.jpg'), name: 'b.jpg', type: 'image', source: 'upload' },
      // an origin nobody recognises is dropped rather than carried, so
      // "source" can only ever be one of the two things it means
      { url: u('c.jpg'), name: 'c.jpg', type: 'image' },
    ])
  })

  it('allows a mixed image + video carousel', () => {
    const slides = normaliseSlides([{ url: u('a.jpg') }, { url: u('b.mp4') }])
    expect(slides.map(s => s.type)).toEqual(['image', 'video'])
  })
  it('accepts a bare URL string', () => {
    expect(normaliseSlides([u('a.jpg')])[0].url).toBe(u('a.jpg'))
  })
  it('drops anything that is not an https URL', () => {
    expect(normaliseSlides([
      { url: 'blob:https://app.test/9f2a' },
      { url: 'data:image/png;base64,AAA' },
      { url: 'http://insecure.test/a.jpg' },
      { url: '' },
      { url: u('good.jpg') },
    ])).toEqual([{ url: u('good.jpg'), name: 'good.jpg', type: 'image' }])
  })
  it('drops the same file dropped twice', () => {
    expect(normaliseSlides([{ url: u('a.jpg') }, { url: u('a.jpg') }])).toHaveLength(1)
  })
  it('caps at the Instagram ceiling', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ url: u(`s${i}.jpg`) }))
    expect(normaliseSlides(many)).toHaveLength(MAX_SLIDES)
  })
  it('keeps a positive byte count and ignores nonsense', () => {
    expect(normaliseSlides([{ url: u('a.jpg'), bytes: 1234.7 }])[0].bytes).toBe(1234)
    expect(normaliseSlides([{ url: u('a.jpg'), bytes: -3 }])[0].bytes).toBeUndefined()
  })
  it('trusts an explicit type over the extension', () => {
    expect(normaliseSlides([{ url: u('clip'), type: 'video' }])[0].type).toBe('video')
  })
  it('is empty for anything that is not an array', () => {
    expect(normaliseSlides(null)).toEqual([])
    expect(normaliseSlides('nope')).toEqual([])
  })
})

describe('slidesOf', () => {
  it('prefers files when it has any', () => {
    const v = { files: [{ url: u('a.jpg') }, { url: u('b.jpg') }], file_url: u('a.jpg') }
    expect(slidesOf(v).map(s => s.url)).toEqual([u('a.jpg'), u('b.jpg')])
  })
  it('falls back to the single file_url of an old version', () => {
    expect(slidesOf({ files: [], file_url: u('old.mp4') })).toEqual([
      { url: u('old.mp4'), name: 'old.mp4', type: 'video' },
    ])
  })
  it('gives nothing for a version that is only a review link', () => {
    expect(slidesOf({ files: [], file_url: '' })).toEqual([])
    expect(slidesOf(null)).toEqual([])
  })
})

describe('reorder', () => {
  const list = ['a', 'b', 'c', 'd']
  it('moves forwards and backwards', () => {
    expect(reorder(list, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(reorder(list, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
  })
  it('changes nothing for a drop that went nowhere', () => {
    expect(reorder(list, 1, 1)).toEqual(list)
    expect(reorder(list, -1, 2)).toEqual(list)
    expect(reorder(list, 0, 9)).toEqual(list)
  })
  it('returns a copy, never the same array', () => {
    expect(reorder(list, 0, 1)).not.toBe(list)
  })
})

describe('slidesSatisfyType', () => {
  const slides = (n: number) => normaliseSlides(
    Array.from({ length: n }, (_, i) => ({ url: u(`s${i}.jpg`) })))

  it('refuses a carousel with one slide, in the words the editor sees', () => {
    expect(slidesSatisfyType('carousel', slides(1))).toBe('A carousel needs at least 2 slides')
  })
  it('accepts a carousel from two slides up', () => {
    expect(slidesSatisfyType('carousel', slides(2))).toBeNull()
    expect(slidesSatisfyType('carousel', slides(10))).toBeNull()
  })
  it('says nothing about a carousel that has no files yet — a pasted link is still a version', () => {
    expect(slidesSatisfyType('carousel', [])).toBeNull()
  })
  it('lets a reel carry a cover image alongside it', () => {
    expect(slidesSatisfyType('reel', slides(2))).toBeNull()
  })
  it('is a rule about the type, not about single files', () => {
    expect(slidesSatisfyType('static', slides(1))).toBeNull()
  })
})

describe('isCarouselType / slideCountLabel', () => {
  it('knows a carousel', () => {
    expect(isCarouselType('carousel')).toBe(true)
    expect(isCarouselType('Carousel')).toBe(true)
    expect(isCarouselType('reel')).toBe(false)
    expect(isCarouselType(null)).toBe(false)
  })
  it('counts in words', () => {
    expect(slideCountLabel(1)).toBe('1 slide')
    expect(slideCountLabel(6)).toBe('6 slides')
    expect(slideCountLabel(0)).toBeNull()
  })
})

describe('postSlides', () => {
  const three = normaliseSlides([{ url: u('a.jpg') }, { url: u('b.jpg') }, { url: u('c.jpg') }])
  const reelPack = normaliseSlides([{ url: u('cut.mp4') }, { url: u('cover.jpg') }])

  it('posts the whole carousel, in order', () => {
    expect(postSlides('carousel', three).map(s => s.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
  })
  it('posts only the video of a reel — the cover is a working file', () => {
    expect(postSlides('reel', reelPack).map(s => s.name)).toEqual(['cut.mp4'])
  })
  it('posts one item for a story and a static post', () => {
    expect(postSlides('story', three)).toHaveLength(1)
    expect(postSlides('static', three)).toHaveLength(1)
  })
  it('lets an unmapped type carry everything and be judged on the count', () => {
    expect(postSlides('other', three)).toHaveLength(3)
  })
})

describe('slideFileName', () => {
  it('keeps the old single-file name so nothing is mirrored twice', () => {
    expect(slideFileName(3, 0, 'Hook cut.mp4', 1)).toBe('v3 - Hook cut.mp4')
  })
  it('numbers the slides of a carousel so Drive sorts them in order', () => {
    expect(slideFileName(2, 0, 'card-a.jpg', 6)).toBe('v2 - 01 - card-a.jpg')
    expect(slideFileName(2, 9, 'card-j.jpg', 10)).toBe('v2 - 10 - card-j.jpg')
  })
  it('survives a missing name and a nonsense version number', () => {
    expect(slideFileName(0, 1, '', 3)).toBe('v1 - 02 - file')
  })
})
